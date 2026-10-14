import { and, eq, isNull, isNotNull, desc } from 'drizzle-orm';
import type { Ctx } from '@/db/client';
import { shoppingListItems } from '@/db/schema';
import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';
import type { Snapshot, ItemSummary } from './snapshot';

export function listShopping(ctx: Ctx) {
  const open = ctx.db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.householdId, ctx.householdId), isNull(shoppingListItems.checkedAt)))
    .orderBy(shoppingListItems.createdAt)
    .all();
  const done = ctx.db
    .select()
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.householdId, ctx.householdId), isNotNull(shoppingListItems.checkedAt)))
    .orderBy(desc(shoppingListItems.checkedAt))
    .limit(20)
    .all();
  return { open, done };
}

export function addToShoppingList(ctx: Ctx, v: { name: string; itemId?: string | null }): void {
  const name = v.name.trim();
  if (!name) return;
  if (v.itemId) {
    const existing = ctx.db
      .select()
      .from(shoppingListItems)
      .where(and(eq(shoppingListItems.itemId, v.itemId), isNull(shoppingListItems.checkedAt)))
      .get();
    if (existing) return;
  }
  ctx.db
    .insert(shoppingListItems)
    .values({ id: newId(), householdId: ctx.householdId, itemId: v.itemId ?? null, name, createdAt: nowIso() })
    .run();
}

export function setShoppingChecked(ctx: Ctx, id: string, checked: boolean): void {
  ctx.db
    .update(shoppingListItems)
    .set({ checkedAt: checked ? nowIso() : null })
    .where(eq(shoppingListItems.id, id))
    .run();
}

export function removeShoppingItem(ctx: Ctx, id: string): void {
  ctx.db.delete(shoppingListItems).where(eq(shoppingListItems.id, id)).run();
}

export function clearCheckedShopping(ctx: Ctx): void {
  ctx.db
    .delete(shoppingListItems)
    .where(and(eq(shoppingListItems.householdId, ctx.householdId), isNotNull(shoppingListItems.checkedAt)))
    .run();
}

/**
 * Whether an item needs buying (vs. only moving from another location).
 * Low total or out of stock → buy. A low location with stock elsewhere → move only.
 */
export function needsBuying(s: ItemSummary): boolean {
  return s.lowTotal || (s.isOut && !s.item.archivedAt);
}

/** "You may want to buy": low or out items not already on the list. */
export function shoppingSuggestions(snapshot: Snapshot): ItemSummary[] {
  return snapshot.items.filter((s) => needsBuying(s) && !s.onShoppingList);
}
