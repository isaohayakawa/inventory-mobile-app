/**
 * Decides WHAT to notify about. Delivery (expo-notifications) lives in src/notifications.
 * Low-stock alerts fire once when stock drops to/below a threshold and don't repeat
 * until stock rises above it again (tracked in alert_state).
 */
import { and, eq } from 'drizzle-orm';
import type { Ctx } from '@/db/client';
import { alertStates } from '@/db/schema';
import { nowIso, parseDate, addDays, formatShortDate, daysUntil } from '@/lib/time';
import { formatUnits } from '@/domain/quantity';
import { loadSnapshot, locationName, stockElsewhere, type Snapshot, type ItemSummary } from './snapshot';

export interface AlertMessage {
  itemId: string;
  scope: string;
  title: string;
  body: string;
}

const TOTAL = 'total';

function lowStockMessage(s: Snapshot, sum: ItemSummary, scope: string): AlertMessage {
  if (scope === TOTAL) {
    return {
      itemId: sum.item.id,
      scope,
      title: `Running low on ${sum.item.name}`,
      body: `${formatUnits(sum.total, sum.item.baseUnit)} left. Add it to your shopping list?`,
    };
  }
  const loc = sum.byLocation.find((b) => b.locationId === scope);
  const elsewhere = stockElsewhere(sum, scope);
  const where = locationName(s, scope);
  const tail =
    elsewhere.qty > 0
      ? `${formatUnits(elsewhere.bestQty, sum.item.baseUnit)} in ${locationName(s, elsewhere.bestLocationId)}.`
      : 'None anywhere else.';
  return {
    itemId: sum.item.id,
    scope,
    title: `${where} is low on ${sum.item.name}`,
    body: `${formatUnits(loc?.qty ?? 0, sum.item.baseUnit)} left. ${tail}`,
  };
}

/**
 * Updates alert_state for the given items and returns alerts that should be sent now
 * (newly crossed thresholds whose notifications are switched on).
 */
export function evaluateLowStock(ctx: Ctx, itemIds: string[], snapshot?: Snapshot): AlertMessage[] {
  if (itemIds.length === 0) return [];
  const s = snapshot ?? loadSnapshot(ctx);
  const out: AlertMessage[] = [];
  for (const id of new Set(itemIds)) {
    const sum = s.items.find((x) => x.item.id === id);
    const states = ctx.db.select().from(alertStates).where(eq(alertStates.itemId, id)).all();
    const active = new Set(states.map((r) => r.scope));
    const lowScopes = new Set<string>();
    if (sum) {
      if (sum.lowTotal) lowScopes.add(TOTAL);
      for (const l of sum.lowLocations) lowScopes.add(l.locationId);
    }
    // Recovered → clear so the alert can fire again next time.
    for (const scope of active) {
      if (!lowScopes.has(scope)) {
        ctx.db.delete(alertStates).where(and(eq(alertStates.itemId, id), eq(alertStates.scope, scope))).run();
      }
    }
    if (!sum) continue;
    for (const scope of lowScopes) {
      if (active.has(scope)) continue;
      ctx.db.insert(alertStates).values({ itemId: id, scope, firedAt: nowIso() }).run();
      const enabled = scope === TOTAL ? s.prefs.totalAlertsEnabled : s.locationAlertsEnabled.get(scope) ?? true;
      if (enabled) out.push(lowStockMessage(s, sum, scope));
    }
  }
  return out;
}

function lotLocationEnabled(s: Snapshot, locationId: string) {
  return s.locationAlertsEnabled.get(locationId) ?? true;
}

/** The daily digest: everything low, out, expiring or expired. Null when there's nothing. */
export function buildDigest(s: Snapshot): { title: string; body: string } | null {
  const lines: string[] = [];
  for (const sum of s.items) {
    const lowHere = sum.lowLocations.filter((l) => lotLocationEnabled(s, l.locationId));
    if ((sum.lowTotal && s.prefs.totalAlertsEnabled) || lowHere.length > 0) {
      lines.push(`${sum.item.name}: ${formatUnits(sum.total, sum.item.baseUnit)} left`);
    }
    if (s.prefs.expiryAlertsEnabled) {
      for (const lot of sum.expiringLots) {
        if (!lotLocationEnabled(s, lot.locationId) || !lot.expiresOn) continue;
        const d = daysUntil(lot.expiresOn);
        lines.push(
          d < 0
            ? `${sum.item.name} expired ${formatShortDate(lot.expiresOn)}`
            : `${sum.item.name} expires ${d === 0 ? 'today' : formatShortDate(lot.expiresOn)}`,
        );
      }
    }
  }
  if (lines.length === 0) return null;
  const n = lines.length;
  return {
    title: `${n} ${n === 1 ? 'thing needs' : 'things need'} attention`,
    body: lines.slice(0, 6).join('\n') + (n > 6 ? `\n+${n - 6} more` : ''),
  };
}

export interface ExpiryAlertPlan {
  lotId: string;
  /** Local date-time to deliver (before quiet-hours adjustment). */
  at: Date;
  title: string;
  body: string;
}

/**
 * Instant mode: one notification per dated lot at the start of its warning window
 * (at `time`, default 9:00), plus one on the expiry day.
 */
export function expiryAlertPlans(s: Snapshot, time = '09:00'): ExpiryAlertPlan[] {
  if (!s.prefs.expiryAlertsEnabled) return [];
  const [h, m] = time.split(':').map(Number);
  const plans: ExpiryAlertPlan[] = [];
  for (const sum of s.items) {
    for (const lot of sum.lots) {
      if (!lot.expiresOn || !lotLocationEnabled(s, lot.locationId)) continue;
      const where = locationName(s, lot.locationId);
      const warnDay = addDays(lot.expiresOn, -s.prefs.expiryWindowDays);
      const at1 = parseDate(warnDay);
      at1.setHours(h, m, 0, 0);
      plans.push({
        lotId: lot.id,
        at: at1,
        title: `${sum.item.name} expires soon`,
        body: `Expires ${formatShortDate(lot.expiresOn)} · ${where}. Use it first.`,
      });
      const at2 = parseDate(lot.expiresOn);
      at2.setHours(h, m, 0, 0);
      plans.push({ lotId: lot.id, at: at2, title: `${sum.item.name} expires today`, body: `${where}. Use it, toss it, or mark it still good.` });
    }
  }
  return plans;
}
