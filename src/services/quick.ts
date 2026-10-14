import type { Ctx } from '@/db/client';
import { unitsPerPackage, type PackageMap } from '@/domain/quantity';
import { lotUseOrder, type ItemSummary } from './snapshot';
import { moveInTx, removeStock, type MutationResult } from './inventory';

/**
 * Plans moving about `need` units from one location to another: loose / opened
 * units first, then whole sealed packs (smallest first), never splitting a pack.
 */
export function planQuickMove(summary: ItemSummary, fromLocationId: string, need: number, packages: PackageMap) {
  const lots = summary.lots
    .filter((l) => l.locationId === fromLocationId && l.qtyBase > 0)
    .sort((a, b) => {
      const ua = a.state === 'opened' ? 1 : unitsPerPackage(a.packageId, packages);
      const ub = b.state === 'opened' ? 1 : unitsPerPackage(b.packageId, packages);
      return ua - ub || lotUseOrder(a, b);
    });
  const moves: { lotId: string; qty: number }[] = [];
  let moved = 0;
  for (const lot of lots) {
    if (moved >= need) break;
    const unit = lot.state === 'opened' ? 1 : unitsPerPackage(lot.packageId, packages);
    if (lot.state === 'opened' || unit === 1) {
      const take = Math.min(lot.qtyBase, need - moved);
      moves.push({ lotId: lot.id, qty: take });
      moved += take;
    } else {
      const packs = Math.min(Math.round(lot.qtyBase / unit), Math.max(1, Math.ceil((need - moved) / unit)));
      moves.push({ lotId: lot.id, qty: packs * unit });
      moved += packs * unit;
    }
  }
  return { moves, moved };
}

export function executeMoves(ctx: Ctx, moves: { lotId: string; qty: number }[], toLocationId: string): MutationResult {
  return ctx.db.transaction((tx) => {
    const itemIds: string[] = [];
    const eventIds: string[] = [];
    for (const m of moves) {
      const r = moveInTx(tx, ctx, { lotId: m.lotId, toLocationId, qty: m.qty });
      itemIds.push(...r.itemIds);
      eventIds.push(...r.eventIds);
    }
    return { itemIds, eventIds, zeroed: [] };
  });
}

/** Expired lot actions: "Used it" and "Throw out" both remove it, with different reasons. */
export function resolveExpired(ctx: Ctx, lotId: string, outcome: 'used' | 'thrown_out'): MutationResult {
  return removeStock(ctx, { lotId, reason: outcome === 'used' ? 'used_up' : 'expired' });
}
