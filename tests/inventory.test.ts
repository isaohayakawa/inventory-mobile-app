import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, loc, summary } from './helpers';
import type { Ctx } from '@/db/client';
import { inventoryEvents, stockLots, items, locations, shoppingListItems } from '@/db/schema';
import {
  createItem,
  addStock,
  openPack,
  consumeOne,
  setLevel,
  moveStock,
  removeStock,
  correctLot,
  undoAdd,
  resolveZero,
  setLocationThreshold,
  updateItem,
} from '@/services/inventory';
import { deleteLocation, createLocation, reorderLocation } from '@/services/locations';
import { evaluateLowStock, buildDigest } from '@/services/alerts';
import { loadSnapshot, stockElsewhere, suggestedMoveQty } from '@/services/snapshot';
import { suggest, similarItems, nameOf } from '@/services/search';
import { describeLot } from '@/domain/quantity';
import { setNow } from '@/lib/time';

let ctx: Ctx;
beforeEach(() => {
  setNow(new Date(2026, 9, 5, 12, 0, 0)); // Oct 5 2026, local noon
  ctx = makeCtx();
});
afterEach(() => setNow(null));

function toiletPaper() {
  const { itemId, packageIds } = createItem(ctx, {
    name: 'Toilet paper',
    baseUnit: 'roll',
    packages: [
      { key: 'six', name: '6-pack', containsQty: 6 },
      { key: 'case', name: 'Case', containsQty: 12, containsKey: 'six' },
    ],
  });
  return { itemId, six: packageIds.six, kase: packageIds.case };
}

describe('packages and lots', () => {
  it('stores quantities in base units across nested packages', () => {
    const { itemId, kase, six } = toiletPaper();
    addStock(ctx, { itemId, packageId: kase, count: 1, state: 'sealed', locationId: loc(ctx, 'Garage') });
    addStock(ctx, { itemId, packageId: six, count: 2, state: 'sealed', locationId: loc(ctx, 'Garage') });
    const s = summary(ctx, itemId);
    expect(s.total).toBe(84);
    expect(s.lots).toHaveLength(2);
    expect(s.breakdown).toEqual(['1 × Case', '2 × 6-pack']);
  });

  it('merges sealed stock with the same package, location and expiry', () => {
    const { itemId, six } = toiletPaper();
    addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: loc(ctx, 'Garage') });
    addStock(ctx, { itemId, packageId: six, count: 2, state: 'sealed', locationId: loc(ctx, 'Garage') });
    const s = summary(ctx, itemId);
    expect(s.lots).toHaveLength(1);
    expect(s.total).toBe(18);
  });

  it('opens one level at a time: case → six-packs → loose rolls', () => {
    const { itemId, kase } = toiletPaper();
    const garage = loc(ctx, 'Garage');
    const closet = loc(ctx, 'Closet');
    const added = addStock(ctx, { itemId, packageId: kase, count: 1, state: 'sealed', locationId: garage });
    const r1 = openPack(ctx, { lotId: added.lotId! });
    let s = summary(ctx, itemId);
    expect(s.total).toBe(72);
    expect(s.breakdown).toEqual(['12 × 6-pack']);
    openPack(ctx, { lotId: r1.lotId!, toLocationId: closet });
    s = summary(ctx, itemId);
    expect(s.total).toBe(72);
    const closetStock = s.byLocation.find((b) => b.locationId === closet)!;
    expect(closetStock.qty).toBe(6);
    expect(closetStock.lots[0].state).toBe('opened');
    expect(s.breakdown).toEqual(['11 × 6-pack', '6 loose']);
    const types = ctx.db.select().from(inventoryEvents).where(eq(inventoryEvents.itemId, itemId)).all().map((e) => e.type);
    expect(types.filter((t) => t === 'opened')).toHaveLength(2);
    expect(types).toContain('moved');
  });

  it('Used 1 opens a pack automatically when only sealed packs remain', () => {
    const { itemId, six } = toiletPaper();
    addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: loc(ctx, 'Bathroom') });
    consumeOne(ctx, { itemId });
    const s = summary(ctx, itemId);
    expect(s.total).toBe(5);
    expect(s.lots[0].state).toBe('opened');
  });

  it('describes lots for display', () => {
    const { itemId, six } = toiletPaper();
    addStock(ctx, { itemId, packageId: six, count: 2, state: 'sealed', locationId: loc(ctx, 'Garage') });
    const snap = loadSnapshot(ctx);
    const s = snap.items[0];
    expect(describeLot(s.lots[0], s.item, snap.packages)).toBe('2 × 6-pack · 12 rolls');
  });
});

describe('using, moving, removing', () => {
  it('uses from opened lots first and empties them', () => {
    const { itemId, six } = toiletPaper();
    const bath = loc(ctx, 'Bathroom');
    addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: bath });
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'opened', locationId: bath });
    const r = consumeOne(ctx, { itemId });
    expect(r.zeroed).toEqual([]);
    const s = summary(ctx, itemId);
    expect(s.total).toBe(6);
    expect(s.lots.every((l) => l.state === 'sealed')).toBe(true);
    const types = ctx.db.select().from(inventoryEvents).where(eq(inventoryEvents.itemId, itemId)).all().map((e) => e.type);
    expect(types).toContain('emptied');
  });

  it('moves part of an opened lot and a whole sealed lot (merging)', () => {
    const { itemId, six } = toiletPaper();
    const garage = loc(ctx, 'Garage');
    const closet = loc(ctx, 'Closet');
    const a = addStock(ctx, { itemId, packageId: null, count: 10, state: 'opened', locationId: garage });
    moveStock(ctx, { lotId: a.lotId!, toLocationId: closet, qty: 4 });
    let s = summary(ctx, itemId);
    expect(s.byLocation.find((b) => b.locationId === garage)!.qty).toBe(6);
    expect(s.byLocation.find((b) => b.locationId === closet)!.qty).toBe(4);

    const b = addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: garage });
    addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: closet });
    moveStock(ctx, { lotId: b.lotId!, toLocationId: closet });
    s = summary(ctx, itemId);
    const sealedInCloset = s.lots.filter((l) => l.locationId === closet && l.state === 'sealed');
    expect(sealedInCloset).toHaveLength(1);
    expect(sealedInCloset[0].qtyBase).toBe(12);
  });

  it('removes with a reason and reports items that reach zero', () => {
    const { itemId } = createItem(ctx, { name: 'Sponges', baseUnit: 'sponge' });
    const a = addStock(ctx, { itemId, packageId: null, count: 2, state: 'sealed', locationId: loc(ctx, 'Kitchen') });
    const r = removeStock(ctx, { lotId: a.lotId!, reason: 'thrown_out' });
    expect(r.zeroed).toEqual([itemId]);
    const ev = ctx.db.select().from(inventoryEvents).where(eq(inventoryEvents.type, 'removed')).get()!;
    expect(ev.reason).toBe('thrown_out');
    expect(ev.deltaBase).toBe(-2);
  });

  it('respects "always keep" and the zero-stock choices', () => {
    const { itemId } = createItem(ctx, { name: 'Coffee beans', baseUnit: 'bag' });
    const a = addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: loc(ctx, 'Pantry') });
    const r = consumeOne(ctx, { itemId });
    expect(r.zeroed).toEqual([itemId]);
    resolveZero(ctx, { itemId, choice: 'list', alwaysKeep: true });
    expect(ctx.db.select().from(shoppingListItems).all().map((x) => x.name)).toEqual(['Coffee beans']);
    // Buying checks it off the list.
    const b = addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: loc(ctx, 'Pantry') });
    expect(ctx.db.select().from(shoppingListItems).get()!.checkedAt).not.toBeNull();
    const r2 = consumeOne(ctx, { itemId, lotId: b.lotId! });
    expect(r2.zeroed).toEqual([]); // always keep → no prompt
    expect(a.lotId).not.toBe(b.lotId);
  });

  it('archives an item and restores it when stock is added again', () => {
    const { itemId } = createItem(ctx, { name: 'Light bulbs', baseUnit: 'bulb' });
    resolveZero(ctx, { itemId, choice: 'archive' });
    expect(loadSnapshot(ctx).archivedItems.map((i) => i.id)).toEqual([itemId]);
    addStock(ctx, { itemId, packageId: null, count: 4, state: 'sealed', locationId: loc(ctx, 'Closet') });
    expect(summary(ctx, itemId).total).toBe(4);
  });

  it('corrects counts and undoes an add', () => {
    const { itemId } = createItem(ctx, { name: 'Paper towels', baseUnit: 'roll' });
    const a = addStock(ctx, { itemId, packageId: null, count: 6, state: 'sealed', locationId: loc(ctx, 'Pantry') });
    correctLot(ctx, { lotId: a.lotId!, newQty: 5 });
    expect(summary(ctx, itemId).total).toBe(5);
    const b = addStock(ctx, { itemId, packageId: null, count: 6, state: 'sealed', locationId: loc(ctx, 'Pantry') });
    expect(summary(ctx, itemId).total).toBe(11);
    undoAdd(ctx, b.eventIds);
    expect(summary(ctx, itemId).total).toBe(5);
  });
});

describe('level tracking', () => {
  it('tracks an opened bottle as Full → ½ → Empty', () => {
    const { itemId } = createItem(ctx, { name: 'Shampoo', baseUnit: 'bottle', tracking: 'level' });
    const bath = loc(ctx, 'Bathroom');
    addStock(ctx, { itemId, packageId: null, count: 2, state: 'sealed', locationId: bath });
    const lots = summary(ctx, itemId).lots;
    const opened = openPack(ctx, { lotId: lots[0].id });
    expect(summary(ctx, itemId).total).toBe(2);
    setLevel(ctx, { lotId: opened.lotId!, level: 0.5 });
    expect(summary(ctx, itemId).total).toBe(1.5);
    const r = setLevel(ctx, { lotId: opened.lotId!, level: 0 });
    expect(summary(ctx, itemId).total).toBe(1);
    expect(r.zeroed).toEqual([]);
  });
});

describe('expiry', () => {
  it('keeps separate lots per expiry date and uses the soonest first', () => {
    const { itemId } = createItem(ctx, { name: 'Canned corn', baseUnit: 'can' });
    const pantry = loc(ctx, 'Pantry');
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: pantry, expiresOn: '2027-01-15' });
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: pantry, expiresOn: '2026-10-07' });
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: pantry, expiresOn: '2027-01-15' });
    let s = summary(ctx, itemId);
    expect(s.lots.map((l) => [l.expiresOn, l.qtyBase])).toEqual([
      ['2026-10-07', 1],
      ['2027-01-15', 2],
    ]);
    expect(s.expiryStatus).toBe('soon'); // within the default 3-day window
    consumeOne(ctx, { itemId });
    s = summary(ctx, itemId);
    expect(s.lots.map((l) => l.expiresOn)).toEqual(['2027-01-15']);
    expect(s.expiryStatus).toBeNull();
  });

  it('marks expired lots', () => {
    const { itemId } = createItem(ctx, { name: 'Milk', baseUnit: 'carton' });
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: loc(ctx, 'Refrigerator'), expiresOn: '2026-10-01' });
    expect(summary(ctx, itemId).expiryStatus).toBe('expired');
    expect(buildDigest(loadSnapshot(ctx))!.body).toContain('Milk expired Oct 1');
  });
});

describe('thresholds and alerts', () => {
  it('flags a low location, suggests a move, and alerts once until recovered', () => {
    const { itemId, six } = toiletPaper();
    const garage = loc(ctx, 'Garage');
    const closet = loc(ctx, 'Closet');
    updateItem(ctx, itemId, { minTotal: 12 });
    setLocationThreshold(ctx, { itemId, locationId: closet, minQty: 4, targetQty: 8 });
    addStock(ctx, { itemId, packageId: six, count: 4, state: 'sealed', locationId: garage });
    const opened = addStock(ctx, { itemId, packageId: null, count: 5, state: 'opened', locationId: closet });
    expect(evaluateLowStock(ctx, [itemId])).toEqual([]);

    consumeOne(ctx, { itemId, lotId: opened.lotId! });
    const first = evaluateLowStock(ctx, [itemId]);
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe('Closet is low on Toilet paper');
    expect(first[0].body).toBe('4 rolls left. 24 rolls in Garage.');

    const s = summary(ctx, itemId);
    const low = s.lowLocations[0];
    const elsewhere = stockElsewhere(s, closet);
    expect(suggestedMoveQty(low, elsewhere.bestQty)).toBe(4);

    consumeOne(ctx, { itemId, lotId: opened.lotId! });
    expect(evaluateLowStock(ctx, [itemId])).toEqual([]); // no repeat

    addStock(ctx, { itemId, packageId: null, count: 10, state: 'opened', locationId: closet });
    expect(evaluateLowStock(ctx, [itemId])).toEqual([]); // recovered, state cleared
    const lots = summary(ctx, itemId).lots.filter((l) => l.locationId === closet);
    for (const l of lots) removeStock(ctx, { lotId: l.id, qty: l.qtyBase, reason: 'used_up' });
    expect(evaluateLowStock(ctx, [itemId]).map((a) => a.scope)).toEqual([closet]); // fires again
  });

  it('respects the per-location notification switch', async () => {
    const { setLocationAlerts } = await import('@/services/locations');
    const { itemId } = createItem(ctx, { name: 'Soap', baseUnit: 'bar' });
    const bath = loc(ctx, 'Bathroom');
    setLocationThreshold(ctx, { itemId, locationId: bath, minQty: 1 });
    setLocationAlerts(ctx, bath, false);
    addStock(ctx, { itemId, packageId: null, count: 1, state: 'sealed', locationId: bath });
    expect(evaluateLowStock(ctx, [itemId])).toEqual([]);
    expect(summary(ctx, itemId).isLow).toBe(true); // still shown in the app
  });
});

describe('locations', () => {
  it('deletes a location through the moving summary', () => {
    const { itemId, six } = toiletPaper();
    const soap = createItem(ctx, { name: 'Hand soap', baseUnit: 'bottle' }).itemId;
    const closet = loc(ctx, 'Closet');
    const garage = loc(ctx, 'Garage');
    setLocationThreshold(ctx, { itemId, locationId: closet, minQty: 4 });
    const tp = addStock(ctx, { itemId, packageId: six, count: 1, state: 'sealed', locationId: closet });
    const hs = addStock(ctx, { itemId: soap, packageId: null, count: 1, state: 'opened', locationId: closet });
    const r = deleteLocation(ctx, closet, {
      lotActions: [
        { lotId: tp.lotId!, action: 'move', toLocationId: garage },
        { lotId: hs.lotId!, action: 'remove', reason: 'unknown' },
      ],
      thresholds: { action: 'move', toLocationId: garage },
    });
    expect(r.zeroed).toEqual([soap]);
    const snap = loadSnapshot(ctx);
    expect(snap.locations.find((l) => l.id === closet)!.archivedAt).not.toBeNull();
    const s = summary(ctx, itemId);
    expect(s.byLocation.map((b) => [b.locationId, b.qty, b.minQty])).toEqual([[garage, 6, 4]]);
    // History still points at the archived location.
    const moved = ctx.db.select().from(inventoryEvents).where(eq(inventoryEvents.type, 'moved')).get()!;
    expect(moved.fromLocationId).toBe(closet);
  });

  it('refuses to delete a location with unplanned stock', () => {
    const { itemId } = createItem(ctx, { name: 'Batteries', baseUnit: 'battery' });
    const garage = loc(ctx, 'Garage');
    addStock(ctx, { itemId, packageId: null, count: 4, state: 'sealed', locationId: garage });
    expect(() => deleteLocation(ctx, garage, { lotActions: [], thresholds: { action: 'drop' } })).toThrow();
    expect(ctx.db.select().from(locations).where(eq(locations.id, garage)).get()!.archivedAt).toBeNull();
    expect(ctx.db.select().from(stockLots).all()).toHaveLength(1);
  });

  it('creates, rejects duplicates and reorders', () => {
    const id = createLocation(ctx, 'Storage');
    expect(() => createLocation(ctx, 'storage')).toThrow();
    reorderLocation(ctx, id, -1);
    const names = loadSnapshot(ctx).locations.map((l) => l.name);
    expect(names.slice(-2)).toEqual(['Storage', 'Other']);
  });
});

describe('autocomplete', () => {
  it('ranks own items first, tolerates typos, and offers "add new"', () => {
    toiletPaper();
    const all = ctx.db.select().from(items).all();
    const s = suggest({ query: 'toilt', items: all });
    expect(s[0].kind).toBe('own');
    expect(nameOf(s[0])).toBe('Toilet paper');
    const pap = suggest({ query: 'Pap', items: all }).map((x) => `${x.kind}:${nameOf(x)}`);
    expect(pap).toContain('common:Paper towels');
    expect(pap.at(-1)).toBe('new:Pap');
    expect(pap.some((x) => x === 'common:Toilet paper')).toBe(false); // already own
  });

  it('finds near-duplicate names', () => {
    toiletPaper();
    const all = ctx.db.select().from(items).all();
    expect(similarItems('Toilet papr', all).map((i) => i.name)).toEqual(['Toilet paper']);
    expect(similarItems('Coffee', all)).toEqual([]);
  });
});
