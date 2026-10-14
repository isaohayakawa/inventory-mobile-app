import { and, eq, isNull, desc, inArray } from 'drizzle-orm';
import type { Ctx } from '@/db/client';
import {
  items,
  packages,
  stockLots,
  locations,
  itemLocationSettings,
  notificationPreferences,
  locationNotificationSettings,
  shoppingListItems,
  inventoryEvents,
  type Item,
  type Location,
  type StockLot,
  type ItemLocationSetting,
  type NotificationPreference,
} from '@/db/schema';
import { type PackageMap, breakdown } from '@/domain/quantity';
import { daysUntil } from '@/lib/time';

export type ExpiryStatus = 'expired' | 'soon' | null;

export interface LocationStock {
  locationId: string;
  qty: number;
  lots: StockLot[];
  minQty: number | null;
  targetQty: number | null;
  low: boolean;
}

export interface ItemSummary {
  item: Item;
  total: number;
  lots: StockLot[];
  byLocation: LocationStock[];
  breakdown: string[];
  lowTotal: boolean;
  lowLocations: LocationStock[];
  isLow: boolean;
  hasOpened: boolean;
  isOut: boolean;
  soonestExpiry: string | null;
  expiryStatus: ExpiryStatus;
  /** Lots that are expired or expiring within the window. */
  expiringLots: StockLot[];
  onShoppingList: boolean;
}

export interface Snapshot {
  items: ItemSummary[];
  archivedItems: Item[];
  locations: Location[];
  packages: PackageMap;
  prefs: NotificationPreference;
  locationAlertsEnabled: Map<string, boolean>;
  settings: ItemLocationSetting[];
}

/** Sorts lots so the one to use first comes first: opened, then soonest expiry, then oldest. */
export function lotUseOrder(a: StockLot, b: StockLot): number {
  if (a.state !== b.state) return a.state === 'opened' ? -1 : 1;
  if (a.expiresOn !== b.expiresOn) {
    if (!a.expiresOn) return 1;
    if (!b.expiresOn) return -1;
    return a.expiresOn < b.expiresOn ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function expiryStatusFor(date: string | null, windowDays: number): ExpiryStatus {
  if (!date) return null;
  const d = daysUntil(date);
  if (d < 0) return 'expired';
  if (d <= windowDays) return 'soon';
  return null;
}

/**
 * Loads the whole household into memory and derives everything the screens need.
 * A household inventory is small (hundreds of rows), so this stays fast and keeps
 * every screen consistent.
 */
export function loadSnapshot(ctx: Ctx): Snapshot {
  const { db, householdId } = ctx;
  const allItems = db.select().from(items).where(eq(items.householdId, householdId)).all();
  const itemIds = allItems.map((i) => i.id);
  const pkgRows = itemIds.length
    ? db.select().from(packages).where(inArray(packages.itemId, itemIds)).all()
    : [];
  const packageMap: PackageMap = new Map(pkgRows.map((p) => [p.id, p]));
  const lots = db
    .select()
    .from(stockLots)
    .where(and(eq(stockLots.householdId, householdId), isNull(stockLots.archivedAt)))
    .all();
  const locs = db
    .select()
    .from(locations)
    .where(eq(locations.householdId, householdId))
    .orderBy(locations.sortOrder)
    .all();
  const settings = itemIds.length
    ? db.select().from(itemLocationSettings).where(inArray(itemLocationSettings.itemId, itemIds)).all()
    : [];
  const prefs = db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.householdId, householdId))
    .get()!;
  const locAlerts = db
    .select()
    .from(locationNotificationSettings)
    .where(eq(locationNotificationSettings.householdId, householdId))
    .all();
  const list = db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.householdId, householdId), isNull(shoppingListItems.checkedAt)))
    .all();
  const onList = new Set(list.map((l) => l.itemId).filter(Boolean));

  const lotsByItem = new Map<string, StockLot[]>();
  for (const lot of lots) {
    const arr = lotsByItem.get(lot.itemId) ?? [];
    arr.push(lot);
    lotsByItem.set(lot.itemId, arr);
  }
  const settingsByItem = new Map<string, ItemLocationSetting[]>();
  for (const s of settings) {
    const arr = settingsByItem.get(s.itemId) ?? [];
    arr.push(s);
    settingsByItem.set(s.itemId, arr);
  }
  const locOrder = new Map(locs.map((l, i) => [l.id, i]));

  const summaries: ItemSummary[] = [];
  for (const item of allItems) {
    if (item.archivedAt) continue;
    const itemLots = (lotsByItem.get(item.id) ?? []).sort(lotUseOrder);
    const total = itemLots.reduce((s, l) => s + l.qtyBase, 0);
    const itemSettings = settingsByItem.get(item.id) ?? [];
    const locIds = new Set([...itemLots.map((l) => l.locationId), ...itemSettings.map((s) => s.locationId)]);
    const byLocation: LocationStock[] = [...locIds]
      .filter((id) => locOrder.has(id))
      .map((locationId) => {
        const ls = itemLots.filter((l) => l.locationId === locationId);
        const qty = ls.reduce((s, l) => s + l.qtyBase, 0);
        const setting = itemSettings.find((s) => s.locationId === locationId);
        const minQty = setting?.minQty ?? null;
        return {
          locationId,
          qty,
          lots: ls,
          minQty,
          targetQty: setting?.targetQty ?? null,
          low: minQty != null && qty <= minQty,
        };
      })
      .sort((a, b) => (locOrder.get(a.locationId)! - locOrder.get(b.locationId)!));
    const lowTotal = item.minTotal != null && total <= item.minTotal;
    const lowLocations = byLocation.filter((b) => b.low);
    const expiringLots = itemLots.filter((l) => expiryStatusFor(l.expiresOn, prefs.expiryWindowDays) != null);
    const dated = itemLots.map((l) => l.expiresOn).filter((d): d is string => !!d).sort();
    const soonestExpiry = dated[0] ?? null;
    summaries.push({
      item,
      total,
      lots: itemLots,
      byLocation,
      breakdown: breakdown(itemLots, item, packageMap),
      lowTotal,
      lowLocations,
      isLow: lowTotal || lowLocations.length > 0,
      hasOpened: itemLots.some((l) => l.state === 'opened'),
      isOut: total <= 0,
      soonestExpiry,
      expiryStatus: expiryStatusFor(soonestExpiry, prefs.expiryWindowDays),
      expiringLots,
      onShoppingList: onList.has(item.id),
    });
  }
  summaries.sort((a, b) => a.item.name.localeCompare(b.item.name));

  return {
    items: summaries,
    archivedItems: allItems.filter((i) => i.archivedAt),
    locations: locs,
    packages: packageMap,
    prefs,
    locationAlertsEnabled: new Map(locAlerts.map((l) => [l.locationId, l.enabled])),
    settings,
  };
}

export function activeLocations(s: Snapshot): Location[] {
  return s.locations.filter((l) => !l.archivedAt);
}

export function locationName(s: Snapshot, id: string | null | undefined): string {
  return s.locations.find((l) => l.id === id)?.name ?? 'Unknown';
}

/** Items most recently used, newest first. */
export function recentlyUsedItemIds(ctx: Ctx, limit = 5): string[] {
  const rows = ctx.db
    .select({ itemId: inventoryEvents.itemId, at: inventoryEvents.occurredAt })
    .from(inventoryEvents)
    .where(and(eq(inventoryEvents.householdId, ctx.householdId), inArray(inventoryEvents.type, ['used', 'level_changed', 'emptied'])))
    .orderBy(desc(inventoryEvents.occurredAt))
    .limit(100)
    .all();
  const out: string[] = [];
  for (const r of rows) {
    if (!out.includes(r.itemId)) out.push(r.itemId);
    if (out.length >= limit) break;
  }
  return out;
}

export function itemHistory(ctx: Ctx, itemId: string, limit = 30) {
  return ctx.db
    .select()
    .from(inventoryEvents)
    .where(eq(inventoryEvents.itemId, itemId))
    .orderBy(desc(inventoryEvents.occurredAt))
    .limit(limit)
    .all();
}

/**
 * For a low location, how much of the item sits in other locations, and where the
 * most is (so alerts can say "move it" instead of "buy it").
 */
export function stockElsewhere(summary: ItemSummary, locationId: string) {
  const others = summary.byLocation.filter((b) => b.locationId !== locationId && b.qty > 0);
  const qty = others.reduce((s, b) => s + b.qty, 0);
  const best = [...others].sort((a, b) => b.qty - a.qty)[0];
  return { qty, bestLocationId: best?.locationId ?? null, bestQty: best?.qty ?? 0 };
}

/** Suggested number of units to move into a low location. */
export function suggestedMoveQty(loc: LocationStock, elsewhereBest: number): number {
  const target = loc.targetQty ?? (loc.minQty != null ? loc.minQty * 2 : 0);
  const need = Math.max(0, Math.ceil(target - loc.qty));
  return Math.min(need, Math.floor(elsewhereBest));
}
