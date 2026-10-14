import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

/**
 * Any synchronous Drizzle SQLite database (or transaction) over our schema.
 * The app uses expo-sqlite; tests use better-sqlite3. Both run in 'sync' mode.
 */
export type Db = BaseSQLiteDatabase<'sync', any, typeof schema>;

export interface Ctx {
  db: Db;
  householdId: string;
  userId: string;
}

export { schema };
