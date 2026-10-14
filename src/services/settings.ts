import { eq } from 'drizzle-orm';
import type { Ctx } from '@/db/client';
import { notificationPreferences, users, type NotificationPreference } from '@/db/schema';

export function getPrefs(ctx: Ctx): NotificationPreference {
  return ctx.db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.householdId, ctx.householdId))
    .get()!;
}

export function updatePrefs(ctx: Ctx, patch: Partial<Omit<NotificationPreference, 'householdId'>>): void {
  ctx.db.update(notificationPreferences).set(patch).where(eq(notificationPreferences.householdId, ctx.householdId)).run();
}

export function getUnitSystem(ctx: Ctx): 'metric' | 'imperial' {
  return ctx.db.select().from(users).where(eq(users.id, ctx.userId)).get()?.defaultUnitSystem ?? 'imperial';
}

export function setUnitSystem(ctx: Ctx, system: 'metric' | 'imperial'): void {
  ctx.db.update(users).set({ defaultUnitSystem: system }).where(eq(users.id, ctx.userId)).run();
}

export const METRIC_UNITS = ['ml', 'L', 'g', 'kg'];
export const IMPERIAL_UNITS = ['fl oz', 'oz', 'lb', 'gal'];

/** Size units with the user's default system listed first; both are always available. */
export function sizeUnits(system: 'metric' | 'imperial'): string[] {
  return system === 'metric' ? [...METRIC_UNITS, ...IMPERIAL_UNITS] : [...IMPERIAL_UNITS, ...METRIC_UNITS];
}
