/**
 * Inventory mutations. Every action runs in one transaction that writes the
 * inventory_event(s) and updates the affected stock lots together, so history and
 * current quantities can never disagree.
 */
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { Ctx, Db } from '@/db/client';
import {
  items,
  packages,
  stockLots,
  inventoryEvents,
  itemLocationSettings,
  shoppingListItems,
  type EventType,
  type Item,
  type StockLot,
} from '@/db/schema';
import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';
import { unitsPerPackage, type PackageMap } from '@/domain/quantity';
import { lotUseOrder } from './snapshot';

const EPS = 1e-9;

export interface MutationResult {
  /** Items whose stock changed (for alert checks). */
  itemIds: string[];
  /** Items that just reached 0 everywhere and aren't set to "always keep". */
  zeroed: string[];
  eventIds: string[];
  /** Lot created or changed last (useful for follow-up actions). */
  lotId?: string;
}

type Source = 'manual' | 'barcode' | 'receipt' | 'photo';

// ---------- internal helpers ----------

function pkgMapFor(tx: Db, itemId: string): PackageMap {
  const rows = tx.select().from(packages).where(eq(packages.itemId, itemId)).all();
  return new Map(rows.map((p) => [p.id, p]));
}

function getItemOrThrow(tx: Db, itemId: string): Item {
  const item = tx.select().from(items).where(eq(items.id, itemId)).get();
  if (!item) throw new Error(`Item not found: ${itemId}`);
  return item;
}

function getLotOrThrow(tx: Db, lotId: string): StockLot {
  const lot = tx.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
  if (!lot || lot.archivedAt) throw new Error(`Stock lot not found: ${lotId}`);
  return lot;
}

interface EventInput {
  itemId: string;
  type: EventType;
  lotId?: string | null;
  deltaBase?: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason?: string | null;
  source?: Source;
  meta?: Record<string, unknown>;
}

function recordEvent(tx: Db, ctx: Ctx, e: EventInput): string {
  const id = newId();
  const ts = nowIso();
  tx.insert(inventoryEvents)
    .values({
      id,
      householdId: ctx.householdId,
      itemId: e.itemId,
      lotId: e.lotId ?? null,
      type: e.type,
      deltaBase: e.deltaBase ?? 0,
      fromLocationId: e.fromLocationId ?? null,
      toLocationId: e.toLocationId ?? null,
      reason: e.reason ?? null,
      source: e.source ?? 'manual',
      actorUserId: ctx.userId,
      occurredAt: ts,
      meta: e.meta ? JSON.stringify(e.meta) : null,
    })
    .run();
  tx.update(items).set({ lastActivityAt: ts }).where(eq(items.id, e.itemId)).run();
  return id;
}

/** Sets a lot's quantity; a lot at 0 is archived (kept for history). */
function setLotQty(tx: Db, lot: StockLot, qty: number): void {
  if (qty <= EPS) {
    tx.update(stockLots).set({ qtyBase: 0, archivedAt: nowIso() }).where(eq(stockLots.id, lot.id)).run();
  } else {
    tx.update(stockLots).set({ qtyBase: qty }).where(eq(stockLots.id, lot.id)).run();
  }
}

function findSealedMatch(
  tx: Db,
  m: { itemId: string; packageId: string | null; locationId: string; expiresOn: string | null; excludeId?: string },
): StockLot | undefined {
  const rows = tx
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemId, m.itemId),
        eq(stockLots.locationId, m.locationId),
        eq(stockLots.state, 'sealed'),
        isNull(stockLots.archivedAt),
        m.packageId ? eq(stockLots.packageId, m.packageId) : isNull(stockLots.packageId),
        m.expiresOn ? eq(stockLots.expiresOn, m.expiresOn) : isNull(stockLots.expiresOn),
      ),
    )
    .all();
  return rows.find((r) => r.id !== m.excludeId);
}

/** Adds sealed stock, merging into a lot with the same package, location and expiry. */
function putSealed(
  tx: Db,
  ctx: Ctx,
  v: { itemId: string; packageId: string | null; locationId: string; expiresOn: string | null; qty: number },
): string {
  const match = findSealedMatch(tx, v);
  if (match) {
    tx.update(stockLots).set({ qtyBase: match.qtyBase + v.qty }).where(eq(stockLots.id, match.id)).run();
    return match.id;
  }
  const id = newId();
  tx.insert(stockLots)
    .values({
      id,
      householdId: ctx.householdId,
      itemId: v.itemId,
      locationId: v.locationId,
      packageId: v.packageId,
      state: 'sealed',
      qtyBase: v.qty,
      expiresOn: v.expiresOn,
      createdAt: nowIso(),
    })
    .run();
  return id;
}

function insertOpened(
  tx: Db,
  ctx: Ctx,
  v: { itemId: string; packageId: string | null; locationId: string; expiresOn: string | null; qty: number },
): string {
  const id = newId();
  tx.insert(stockLots)
    .values({
      id,
      householdId: ctx.householdId,
      itemId: v.itemId,
      locationId: v.locationId,
      packageId: v.packageId,
      state: 'opened',
      qtyBase: v.qty,
      expiresOn: v.expiresOn,
      createdAt: nowIso(),
    })
    .run();
  return id;
}

function itemTotal(tx: Db, itemId: string): number {
  return tx
    .select({ q: stockLots.qtyBase })
    .from(stockLots)
    .where(and(eq(stockLots.itemId, itemId), isNull(stockLots.archivedAt)))
    .all()
    .reduce((s, r) => s + r.q, 0);
}

function zeroedAmong(tx: Db, itemIds: string[]): string[] {
  const unique = [...new Set(itemIds)];
  return unique.filter((id) => {
    const item = tx.select().from(items).where(eq(items.id, id)).get();
    return item && !item.archivedAt && !item.alwaysKeep && itemTotal(tx, id) <= EPS;
  });
}

function run(ctx: Ctx, fn: (tx: Db) => Omit<MutationResult, 'zeroed'>, checkZero = true): MutationResult {
  return ctx.db.transaction((tx) => {
    const r = fn(tx);
    return { ...r, zeroed: checkZero ? zeroedAmong(tx, r.itemIds) : [] };
  });
}

// ---------- items & packages ----------

export interface NewPackageInput {
  /** Local key so packages can reference each other before they have ids. */
  key: string;
  name: string;
  containsQty: number;
  /** Key of the package this one contains; omit when it contains base units. */
  containsKey?: string;
}

export interface NewItemInput {
  name: string;
  baseUnit: string;
  category?: string | null;
  tracking?: 'count' | 'level';
  tracksState?: boolean;
  minTotal?: number | null;
  sizeAmount?: number | null;
  sizeUnit?: string | null;
  packages?: NewPackageInput[];
}

export function createItem(ctx: Ctx, input: NewItemInput): { itemId: string; packageIds: Record<string, string> } {
  const name = input.name.trim();
  if (!name) throw new Error('Item name is required');
  const itemId = newId();
  const packageIds: Record<string, string> = {};
  ctx.db.transaction((tx) => {
    tx.insert(items)
      .values({
        id: itemId,
        householdId: ctx.householdId,
        name,
        baseUnit: input.baseUnit.trim() || 'unit',
        category: input.category ?? null,
        tracking: input.tracking ?? 'count',
        tracksState: input.tracksState ?? true,
        minTotal: input.minTotal ?? null,
        sizeAmount: input.sizeAmount ?? null,
        sizeUnit: input.sizeAmount != null ? input.sizeUnit ?? null : null,
        createdAt: nowIso(),
      })
      .run();
    for (const p of input.packages ?? []) packageIds[p.key] = newId();
    for (const p of input.packages ?? []) {
      tx.insert(packages)
        .values({
          id: packageIds[p.key],
          itemId,
          name: p.name.trim(),
          containsQty: p.containsQty,
          containsPackageId: p.containsKey ? packageIds[p.containsKey] ?? null : null,
          createdAt: nowIso(),
        })
        .run();
    }
  });
  return { itemId, packageIds };
}

export function addPackage(
  ctx: Ctx,
  v: { itemId: string; name: string; containsQty: number; containsPackageId?: string | null },
): string {
  if (!(v.containsQty > 0)) throw new Error('A package must contain at least 1');
  const id = newId();
  ctx.db
    .insert(packages)
    .values({
      id,
      itemId: v.itemId,
      name: v.name.trim(),
      containsQty: v.containsQty,
      containsPackageId: v.containsPackageId ?? null,
      createdAt: nowIso(),
    })
    .run();
  return id;
}

export function updateItem(
  ctx: Ctx,
  itemId: string,
  patch: Partial<
    Pick<Item, 'name' | 'baseUnit' | 'category' | 'tracking' | 'tracksState' | 'minTotal' | 'sizeAmount' | 'sizeUnit' | 'alwaysKeep'>
  >,
): void {
  ctx.db.update(items).set(patch).where(eq(items.id, itemId)).run();
}

export function setLocationThreshold(
  ctx: Ctx,
  v: { itemId: string; locationId: string; minQty: number | null; targetQty?: number | null },
): void {
  const existing = ctx.db
    .select()
    .from(itemLocationSettings)
    .where(and(eq(itemLocationSettings.itemId, v.itemId), eq(itemLocationSettings.locationId, v.locationId)))
    .get();
  if (v.minQty == null && v.targetQty == null) {
    if (existing) {
      ctx.db
        .delete(itemLocationSettings)
        .where(and(eq(itemLocationSettings.itemId, v.itemId), eq(itemLocationSettings.locationId, v.locationId)))
        .run();
    }
    return;
  }
  if (existing) {
    ctx.db
      .update(itemLocationSettings)
      .set({ minQty: v.minQty, targetQty: v.targetQty ?? null })
      .where(and(eq(itemLocationSettings.itemId, v.itemId), eq(itemLocationSettings.locationId, v.locationId)))
      .run();
  } else {
    ctx.db
      .insert(itemLocationSettings)
      .values({ itemId: v.itemId, locationId: v.locationId, minQty: v.minQty, targetQty: v.targetQty ?? null })
      .run();
  }
}

export function archiveItem(ctx: Ctx, itemId: string): void {
  ctx.db.transaction((tx) => {
    tx.update(items).set({ archivedAt: nowIso() }).where(eq(items.id, itemId)).run();
    recordEvent(tx, ctx, { itemId, type: 'item_archived' });
  });
}

export function restoreItem(ctx: Ctx, itemId: string): void {
  ctx.db.transaction((tx) => {
    tx.update(items).set({ archivedAt: null }).where(eq(items.id, itemId)).run();
    recordEvent(tx, ctx, { itemId, type: 'item_restored' });
  });
}

// ---------- adding stock ----------

export interface AddStockInput {
  itemId: string;
  /** null = loose base units. */
  packageId: string | null;
  count: number;
  state: 'sealed' | 'opened';
  locationId: string;
  expiresOn?: string | null;
  /** For level-tracked opened stock: 0–1 of one unit. */
  level?: number | null;
  source?: Source;
}

export function addStock(ctx: Ctx, input: AddStockInput): MutationResult {
  if (!(input.count > 0)) throw new Error('Quantity must be more than 0');
  return run(
    ctx,
    (tx) => {
      const item = getItemOrThrow(tx, input.itemId);
      const pkgs = pkgMapFor(tx, item.id);
      const units = unitsPerPackage(input.packageId, pkgs);
      const expiresOn = input.expiresOn || null;
      let qty = input.count * units;
      let lotId: string;
      if (input.state === 'sealed') {
        lotId = putSealed(tx, ctx, { itemId: item.id, packageId: input.packageId, locationId: input.locationId, expiresOn, qty });
      } else {
        if (item.tracking === 'level' && input.level != null && qty <= 1) qty = input.level;
        lotId = insertOpened(tx, ctx, { itemId: item.id, packageId: input.packageId, locationId: input.locationId, expiresOn, qty });
      }
      const eventIds: string[] = [];
      if (item.archivedAt) {
        tx.update(items).set({ archivedAt: null }).where(eq(items.id, item.id)).run();
        eventIds.push(recordEvent(tx, ctx, { itemId: item.id, type: 'item_restored' }));
      }
      eventIds.push(
        recordEvent(tx, ctx, {
          itemId: item.id,
          type: 'added',
          lotId,
          deltaBase: qty,
          toLocationId: input.locationId,
          source: input.source ?? 'manual',
          meta: { packageName: input.packageId ? pkgs.get(input.packageId)?.name : null, count: input.count },
        }),
      );
      // Buying it checks it off the shopping list.
      tx.update(shoppingListItems)
        .set({ checkedAt: nowIso() })
        .where(and(eq(shoppingListItems.itemId, item.id), isNull(shoppingListItems.checkedAt)))
        .run();
      return { itemIds: [item.id], eventIds, lotId };
    },
    false,
  );
}

/** Reverses "added" events (the Undo after Bought more) with `corrected` events. */
export function undoAdd(ctx: Ctx, eventIds: string[]): MutationResult {
  return run(ctx, (tx) => {
    const evs = tx.select().from(inventoryEvents).where(inArray(inventoryEvents.id, eventIds)).all();
    const out: string[] = [];
    const itemIds: string[] = [];
    for (const ev of evs) {
      if (ev.type !== 'added' || !ev.lotId) continue;
      const lot = tx.select().from(stockLots).where(eq(stockLots.id, ev.lotId)).get();
      if (!lot || lot.archivedAt) continue;
      const take = Math.min(lot.qtyBase, ev.deltaBase);
      setLotQty(tx, lot, lot.qtyBase - take);
      out.push(recordEvent(tx, ctx, { itemId: ev.itemId, type: 'corrected', lotId: lot.id, deltaBase: -take, reason: 'undo' }));
      itemIds.push(ev.itemId);
    }
    return { itemIds, eventIds: out };
  }, false);
}

// ---------- using stock ----------

/** Opens one package from a sealed lot. Returns the new (or merged) lot id. */
function openOne(tx: Db, ctx: Ctx, lot: StockLot, item: Item, pkgs: PackageMap, toLocationId: string, eventIds: string[]): string {
  if (lot.state !== 'sealed') throw new Error('Only sealed stock can be opened');
  const pkg = lot.packageId ? pkgs.get(lot.packageId) : undefined;
  const units = unitsPerPackage(lot.packageId, pkgs);
  if (lot.qtyBase + EPS < units) throw new Error('Not enough sealed stock to open');
  setLotQty(tx, lot, lot.qtyBase - units);

  let newLotId: string;
  if (pkg?.containsPackageId) {
    // A case opens into sealed six-packs.
    const childUnits = unitsPerPackage(pkg.containsPackageId, pkgs);
    newLotId = putSealed(tx, ctx, {
      itemId: item.id,
      packageId: pkg.containsPackageId,
      locationId: toLocationId,
      expiresOn: lot.expiresOn,
      qty: pkg.containsQty * childUnits,
    });
  } else if (units > 1 && item.tracking === 'level') {
    // A 3-pack of shampoo opens into 3 sealed bottles.
    newLotId = putSealed(tx, ctx, { itemId: item.id, packageId: null, locationId: toLocationId, expiresOn: lot.expiresOn, qty: units });
  } else {
    newLotId = insertOpened(tx, ctx, { itemId: item.id, packageId: lot.packageId, locationId: toLocationId, expiresOn: lot.expiresOn, qty: units });
  }
  eventIds.push(
    recordEvent(tx, ctx, {
      itemId: item.id,
      type: 'opened',
      lotId: lot.id,
      fromLocationId: lot.locationId,
      toLocationId,
      meta: { packageName: pkg?.name ?? item.baseUnit, newLotId },
    }),
  );
  if (toLocationId !== lot.locationId) {
    eventIds.push(
      recordEvent(tx, ctx, {
        itemId: item.id,
        type: 'moved',
        lotId: newLotId,
        fromLocationId: lot.locationId,
        toLocationId,
        meta: { qty: units },
      }),
    );
  }
  return newLotId;
}

export function openPack(ctx: Ctx, v: { lotId: string; toLocationId?: string }): MutationResult {
  return run(ctx, (tx) => {
    const lot = getLotOrThrow(tx, v.lotId);
    const item = getItemOrThrow(tx, lot.itemId);
    const eventIds: string[] = [];
    const lotId = openOne(tx, ctx, lot, item, pkgMapFor(tx, item.id), v.toLocationId ?? lot.locationId, eventIds);
    return { itemIds: [item.id], eventIds, lotId };
  });
}

/**
 * "Used 1". Takes from the given lot, or picks the one to use first: opened before
 * sealed, then soonest expiry (first expired, first out). Opens a pack when needed.
 */
export function consumeOne(ctx: Ctx, v: { itemId: string; lotId?: string; locationId?: string }): MutationResult {
  return run(ctx, (tx) => {
    const item = getItemOrThrow(tx, v.itemId);
    const pkgs = pkgMapFor(tx, item.id);
    const eventIds: string[] = [];
    let lot: StockLot | undefined;
    if (v.lotId) {
      lot = getLotOrThrow(tx, v.lotId);
    } else {
      const candidates = tx
        .select()
        .from(stockLots)
        .where(
          and(
            eq(stockLots.itemId, item.id),
            isNull(stockLots.archivedAt),
            v.locationId ? eq(stockLots.locationId, v.locationId) : undefined,
          ),
        )
        .all()
        .filter((l) => l.qtyBase > EPS)
        .sort(lotUseOrder);
      lot = candidates[0];
    }
    if (!lot) throw new Error(`No ${item.name} left${v.locationId ? ' here' : ''}`);

    // Open packs until we reach something a single unit can be taken from.
    let guard = 0;
    while (lot.state === 'sealed' && unitsPerPackage(lot.packageId, pkgs) > 1 && guard++ < 10) {
      const newId_ = openOne(tx, ctx, lot, item, pkgs, lot.locationId, eventIds);
      lot = getLotOrThrow(tx, newId_);
    }

    const take = item.tracking === 'level' && lot.state === 'opened' ? lot.qtyBase : Math.min(1, lot.qtyBase);
    const remaining = lot.qtyBase - take;
    setLotQty(tx, lot, remaining);
    eventIds.push(
      recordEvent(tx, ctx, { itemId: item.id, type: 'used', lotId: lot.id, deltaBase: -take, fromLocationId: lot.locationId }),
    );
    if (remaining <= EPS) {
      eventIds.push(recordEvent(tx, ctx, { itemId: item.id, type: 'emptied', lotId: lot.id, fromLocationId: lot.locationId }));
    }
    return { itemIds: [item.id], eventIds, lotId: lot.id };
  });
}

/** Level-tracked items: Full → ¾ → ½ → Low → Empty. */
export function setLevel(ctx: Ctx, v: { lotId: string; level: number }): MutationResult {
  return run(ctx, (tx) => {
    const lot = getLotOrThrow(tx, v.lotId);
    const level = Math.max(0, Math.min(1, v.level));
    const delta = level - lot.qtyBase;
    setLotQty(tx, lot, level);
    const eventIds: string[] = [];
    if (level <= EPS) {
      eventIds.push(recordEvent(tx, ctx, { itemId: lot.itemId, type: 'used', lotId: lot.id, deltaBase: delta, fromLocationId: lot.locationId }));
      eventIds.push(recordEvent(tx, ctx, { itemId: lot.itemId, type: 'emptied', lotId: lot.id, fromLocationId: lot.locationId }));
    } else {
      eventIds.push(
        recordEvent(tx, ctx, { itemId: lot.itemId, type: 'level_changed', lotId: lot.id, deltaBase: delta, meta: { level } }),
      );
    }
    return { itemIds: [lot.itemId], eventIds, lotId: lot.id };
  });
}

// ---------- moving, removing, correcting ----------

/** Moves `qty` base units (default: the whole lot) to another location. */
export function moveStock(ctx: Ctx, v: { lotId: string; toLocationId: string; qty?: number }): MutationResult {
  return run(
    ctx,
    (tx) => moveInTx(tx, ctx, v),
    false,
  );
}

export function moveInTx(tx: Db, ctx: Ctx, v: { lotId: string; toLocationId: string; qty?: number }) {
  const lot = getLotOrThrow(tx, v.lotId);
  if (lot.locationId === v.toLocationId) return { itemIds: [lot.itemId], eventIds: [], lotId: lot.id };
  const qty = Math.min(v.qty ?? lot.qtyBase, lot.qtyBase);
  if (!(qty > EPS)) throw new Error('Nothing to move');
  const whole = qty >= lot.qtyBase - EPS;
  let targetId: string;
  if (lot.state === 'sealed') {
    const match = findSealedMatch(tx, {
      itemId: lot.itemId,
      packageId: lot.packageId,
      locationId: v.toLocationId,
      expiresOn: lot.expiresOn,
      excludeId: lot.id,
    });
    if (whole && !match) {
      tx.update(stockLots).set({ locationId: v.toLocationId }).where(eq(stockLots.id, lot.id)).run();
      targetId = lot.id;
    } else {
      setLotQty(tx, lot, lot.qtyBase - qty);
      targetId = putSealed(tx, ctx, {
        itemId: lot.itemId,
        packageId: lot.packageId,
        locationId: v.toLocationId,
        expiresOn: lot.expiresOn,
        qty,
      });
    }
  } else if (whole) {
    tx.update(stockLots).set({ locationId: v.toLocationId }).where(eq(stockLots.id, lot.id)).run();
    targetId = lot.id;
  } else {
    setLotQty(tx, lot, lot.qtyBase - qty);
    targetId = insertOpened(tx, ctx, {
      itemId: lot.itemId,
      packageId: lot.packageId,
      locationId: v.toLocationId,
      expiresOn: lot.expiresOn,
      qty,
    });
  }
  const eventId = recordEvent(tx, ctx, {
    itemId: lot.itemId,
    type: 'moved',
    lotId: targetId,
    fromLocationId: lot.locationId,
    toLocationId: v.toLocationId,
    meta: { qty, fromLotId: lot.id },
  });
  return { itemIds: [lot.itemId], eventIds: [eventId], lotId: targetId };
}

export type RemoveReason = 'used_up' | 'thrown_out' | 'expired' | 'unknown';

export function removeStock(ctx: Ctx, v: { lotId: string; qty?: number; reason: RemoveReason }): MutationResult {
  return run(ctx, (tx) => removeInTx(tx, ctx, v));
}

export function removeInTx(tx: Db, ctx: Ctx, v: { lotId: string; qty?: number; reason: RemoveReason }) {
  const lot = getLotOrThrow(tx, v.lotId);
  const qty = Math.min(v.qty ?? lot.qtyBase, lot.qtyBase);
  setLotQty(tx, lot, lot.qtyBase - qty);
  const eventId = recordEvent(tx, ctx, {
    itemId: lot.itemId,
    type: 'removed',
    lotId: lot.id,
    deltaBase: -qty,
    fromLocationId: lot.locationId,
    reason: v.reason,
  });
  return { itemIds: [lot.itemId], eventIds: [eventId], lotId: lot.id };
}

/** Fixes a lot's count (stocktake). */
export function correctLot(ctx: Ctx, v: { lotId: string; newQty: number }): MutationResult {
  return run(ctx, (tx) => {
    const lot = getLotOrThrow(tx, v.lotId);
    const newQty = Math.max(0, v.newQty);
    const delta = newQty - lot.qtyBase;
    if (Math.abs(delta) <= EPS) return { itemIds: [lot.itemId], eventIds: [] };
    setLotQty(tx, lot, newQty);
    const eventId = recordEvent(tx, ctx, { itemId: lot.itemId, type: 'corrected', lotId: lot.id, deltaBase: delta, reason: 'count' });
    return { itemIds: [lot.itemId], eventIds: [eventId], lotId: lot.id };
  });
}

/** Changes a lot's expiry date (e.g. "Still good" on an expired lot clears or pushes it). */
export function setLotExpiry(ctx: Ctx, v: { lotId: string; expiresOn: string | null }): void {
  ctx.db.update(stockLots).set({ expiresOn: v.expiresOn }).where(eq(stockLots.id, v.lotId)).run();
}

/** The choice shown when an item reaches 0 everywhere. */
export function resolveZero(ctx: Ctx, v: { itemId: string; choice: 'keep' | 'list' | 'archive'; alwaysKeep?: boolean }): void {
  if (v.alwaysKeep) updateItem(ctx, v.itemId, { alwaysKeep: true });
  if (v.choice === 'archive') archiveItem(ctx, v.itemId);
  if (v.choice === 'list') {
    const item = ctx.db.select().from(items).where(eq(items.id, v.itemId)).get();
    if (!item) return;
    const already = ctx.db
      .select()
      .from(shoppingListItems)
      .where(and(eq(shoppingListItems.itemId, v.itemId), isNull(shoppingListItems.checkedAt)))
      .get();
    if (!already) {
      ctx.db
        .insert(shoppingListItems)
        .values({ id: newId(), householdId: ctx.householdId, itemId: item.id, name: item.name, createdAt: nowIso() })
        .run();
    }
  }
}
