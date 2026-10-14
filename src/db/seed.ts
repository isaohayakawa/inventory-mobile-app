import { eq } from 'drizzle-orm';
import type { Db } from './client';
import {
  households,
  users,
  householdMembers,
  locations,
  notificationPreferences,
  locationNotificationSettings,
} from './schema';
import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';

export const DEFAULT_LOCATIONS = [
  'Kitchen',
  'Pantry',
  'Refrigerator',
  'Freezer',
  'Bathroom',
  'Bedroom',
  'Garage',
  'Closet',
  'Other',
];

/**
 * First launch: create the household of one, its only user, default locations and
 * notification preferences. Later launches return the existing ids.
 */
export function ensureHousehold(db: Db): { householdId: string; userId: string } {
  const existing = db.select().from(householdMembers).limit(1).all();
  if (existing.length > 0) {
    return { householdId: existing[0].householdId, userId: existing[0].userId };
  }
  const householdId = newId();
  const userId = newId();
  const ts = nowIso();
  db.transaction((tx) => {
    tx.insert(households).values({ id: householdId, name: 'My Home', createdAt: ts }).run();
    tx.insert(users).values({ id: userId, createdAt: ts }).run();
    tx.insert(householdMembers).values({ householdId, userId, role: 'owner' }).run();
    tx.insert(notificationPreferences).values({ householdId }).run();
    DEFAULT_LOCATIONS.forEach((name, i) => {
      const id = newId();
      tx.insert(locations).values({ id, householdId, name, sortOrder: i }).run();
      tx.insert(locationNotificationSettings).values({ householdId, locationId: id, enabled: true }).run();
    });
  });
  return { householdId, userId };
}

export function getUserUnitSystem(db: Db, userId: string): 'metric' | 'imperial' {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  return row?.defaultUnitSystem ?? 'imperial';
}
