import { and, eq, isNull } from 'drizzle-orm';
import type { Ctx } from '@/db/client';
import { items, locations, stockLots, itemLocationSettings, locationNotificationSettings } from '@/db/schema';
import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';
import { moveInTx, removeInTx, type RemoveReason, type MutationResult } from './inventory';

function activeLocs(ctx: Ctx) {
  return ctx.db
    .select()
    .from(locations)
    .where(and(eq(locations.householdId, ctx.householdId), isNull(locations.archivedAt)))
    .orderBy(locations.sortOrder)
    .all();
}

export function createLocation(ctx: Ctx, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Location name is required');
  const existing = activeLocs(ctx);
  if (existing.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`"${trimmed}" already exists`);
  }
  const id = newId();
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.sortOrder), -1);
  ctx.db.transaction((tx) => {
    tx.insert(locations).values({ id, householdId: ctx.householdId, name: trimmed, sortOrder: maxOrder + 1 }).run();
    tx.insert(locationNotificationSettings).values({ householdId: ctx.householdId, locationId: id, enabled: true }).run();
  });
  return id;
}

export function renameLocation(ctx: Ctx, id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Location name is required');
  if (activeLocs(ctx).some((l) => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`"${trimmed}" already exists`);
  }
  ctx.db.update(locations).set({ name: trimmed }).where(eq(locations.id, id)).run();
}

/** Moves a location one step up (-1) or down (+1) in the list. */
export function reorderLocation(ctx: Ctx, id: string, direction: -1 | 1): void {
  const list = activeLocs(ctx);
  const i = list.findIndex((l) => l.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [a, b] = [list[i], list[j]];
  ctx.db.transaction((tx) => {
    tx.update(locations).set({ sortOrder: b.sortOrder }).where(eq(locations.id, a.id)).run();
    tx.update(locations).set({ sortOrder: a.sortOrder }).where(eq(locations.id, b.id)).run();
  });
}

export function setLocationAlerts(ctx: Ctx, locationId: string, enabled: boolean): void {
  const row = ctx.db
    .select()
    .from(locationNotificationSettings)
    .where(
      and(eq(locationNotificationSettings.householdId, ctx.householdId), eq(locationNotificationSettings.locationId, locationId)),
    )
    .get();
  if (row) {
    ctx.db
      .update(locationNotificationSettings)
      .set({ enabled })
      .where(
        and(eq(locationNotificationSettings.householdId, ctx.householdId), eq(locationNotificationSettings.locationId, locationId)),
      )
      .run();
  } else {
    ctx.db.insert(locationNotificationSettings).values({ householdId: ctx.householdId, locationId, enabled }).run();
  }
}

export interface LocationDeletePlan {
  lotActions: (
    | { lotId: string; action: 'move'; toLocationId: string }
    | { lotId: string; action: 'remove'; reason: RemoveReason }
  )[];
  /** What to do with this location's thresholds. */
  thresholds: { action: 'drop' } | { action: 'move'; toLocationId: string };
}

/**
 * Deletes a location through the moving summary: every lot is moved or removed,
 * thresholds are moved or dropped, then the location is archived (its name stays in history).
 * Returns the combined result so the caller can handle items that reached 0.
 */
export function deleteLocation(ctx: Ctx, locationId: string, plan: LocationDeletePlan): MutationResult {
  return ctx.db.transaction((tx) => {
    const lots = tx
      .select()
      .from(stockLots)
      .where(and(eq(stockLots.locationId, locationId), isNull(stockLots.archivedAt)))
      .all();
    const planned = new Set(plan.lotActions.map((a) => a.lotId));
    const missing = lots.filter((l) => !planned.has(l.id));
    if (missing.length > 0) throw new Error('Every item in this location needs a destination');

    const itemIds: string[] = [];
    const eventIds: string[] = [];
    for (const a of plan.lotActions) {
      if (a.action === 'move') {
        if (a.toLocationId === locationId) throw new Error('Pick a different location');
        const r = moveInTx(tx, ctx, { lotId: a.lotId, toLocationId: a.toLocationId });
        itemIds.push(...r.itemIds);
        eventIds.push(...r.eventIds);
      } else {
        const r = removeInTx(tx, ctx, { lotId: a.lotId, reason: a.reason });
        itemIds.push(...r.itemIds);
        eventIds.push(...r.eventIds);
      }
    }

    const settings = tx.select().from(itemLocationSettings).where(eq(itemLocationSettings.locationId, locationId)).all();
    for (const s of settings) {
      if (plan.thresholds.action === 'move') {
        const dest = plan.thresholds.toLocationId;
        const existing = tx
          .select()
          .from(itemLocationSettings)
          .where(and(eq(itemLocationSettings.itemId, s.itemId), eq(itemLocationSettings.locationId, dest)))
          .get();
        // The destination's own threshold wins when it already has one.
        if (!existing) {
          tx.insert(itemLocationSettings)
            .values({ itemId: s.itemId, locationId: dest, minQty: s.minQty, targetQty: s.targetQty })
            .run();
        }
      }
    }
    tx.delete(itemLocationSettings).where(eq(itemLocationSettings.locationId, locationId)).run();
    tx.delete(locationNotificationSettings).where(eq(locationNotificationSettings.locationId, locationId)).run();
    tx.update(locations).set({ archivedAt: nowIso() }).where(eq(locations.id, locationId)).run();

    // Items now at 0 everywhere (and not "always keep") get the keep / list / archive choice.
    const zeroed = [...new Set(itemIds)].filter((id) => {
      const item = tx.select().from(items).where(eq(items.id, id)).get();
      if (!item || item.alwaysKeep || item.archivedAt) return false;
      const remaining = tx
        .select()
        .from(stockLots)
        .where(and(eq(stockLots.itemId, id), isNull(stockLots.archivedAt)))
        .all()
        .reduce((s, l) => s + l.qtyBase, 0);
      return remaining <= 1e-9;
    });
    return { itemIds, eventIds, zeroed };
  });
}

/** All active lots in a location, including those of archived items (for the moving summary). */
export function lotsInLocation(ctx: Ctx, locationId: string) {
  return ctx.db
    .select({ lot: stockLots, item: items })
    .from(stockLots)
    .innerJoin(items, eq(items.id, stockLots.itemId))
    .where(and(eq(stockLots.locationId, locationId), isNull(stockLots.archivedAt)))
    .all();
}
