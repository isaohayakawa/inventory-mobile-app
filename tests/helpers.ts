import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from '@/db/schema';
import type { Ctx, Db } from '@/db/client';
import { ensureHousehold } from '@/db/seed';
import { loadSnapshot } from '@/services/snapshot';

/** Fresh in-memory database with the real migrations applied and the first-run seed. */
export function makeCtx(): Ctx {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });
  const typed = db as unknown as Db;
  const { householdId, userId } = ensureHousehold(typed);
  return { db: typed, householdId, userId };
}

export function loc(ctx: Ctx, name: string): string {
  const l = loadSnapshot(ctx).locations.find((x) => x.name === name);
  if (!l) throw new Error(`no location ${name}`);
  return l.id;
}

export function summary(ctx: Ctx, itemId: string) {
  const s = loadSnapshot(ctx).items.find((i) => i.item.id === itemId);
  if (!s) throw new Error('item not active');
  return s;
}
