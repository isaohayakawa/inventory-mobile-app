/**
 * Local SQLite schema for the MVP (see the spec: "Data model").
 *
 * Rules that hold everywhere:
 * - Quantities are stored in the item's base unit (rolls, cans, bottles).
 * - Current stock = active (non-archived) stock lots. History = inventory_events.
 * - IDs are UUIDs generated on the device so cloud sync can be added later.
 * - Timestamps are ISO strings; dates (expiry) are 'YYYY-MM-DD'.
 */
import { sqliteTable, text, real, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('household', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  /** Empty until sign-in arrives after the MVP. */
  email: text('email'),
  defaultUnitSystem: text('default_unit_system', { enum: ['metric', 'imperial'] }).notNull().default('imperial'),
  createdAt: text('created_at').notNull(),
});

export const householdMembers = sqliteTable(
  'household_member',
  {
    householdId: text('household_id').notNull().references(() => households.id),
    userId: text('user_id').notNull().references(() => users.id),
    role: text('role').notNull().default('owner'),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

export const locations = sqliteTable('location', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  archivedAt: text('archived_at'),
});

export const items = sqliteTable(
  'item',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull().references(() => households.id),
    name: text('name').notNull(),
    category: text('category'),
    /** Singular base unit, e.g. "roll", "can", "bottle". */
    baseUnit: text('base_unit').notNull(),
    /** 'count' = subtract units; 'level' = opened units tracked as Full / ¾ / ½ / Low / Empty. */
    tracking: text('tracking', { enum: ['count', 'level'] }).notNull().default('count'),
    /** Whether stock is shown as Sealed / Opened. Off for things bought loose, like apples. */
    tracksState: integer('tracks_state', { mode: 'boolean' }).notNull().default(true),
    /** Household-total threshold in base units ("buy more"). */
    minTotal: real('min_total'),
    alwaysKeep: integer('always_keep', { mode: 'boolean' }).notNull().default(false),
    /** Optional size, stored exactly as entered (never converted). */
    sizeAmount: real('size_amount'),
    sizeUnit: text('size_unit'),
    lastActivityAt: text('last_activity_at'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('item_household_idx').on(t.householdId)],
);

/**
 * A package an item is bought in. Packages nest: a case contains 12 six-packs,
 * a six-pack contains 6 rolls. contains_package_id = null means it contains base units.
 * The base unit itself is represented by a package with contains_qty = 1 and no child.
 */
export const packages = sqliteTable('package', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id),
  name: text('name').notNull(),
  containsQty: real('contains_qty').notNull(),
  containsPackageId: text('contains_package_id'),
  /** Reserved for barcode scanning after the MVP. */
  gtin: text('gtin'),
  createdAt: text('created_at').notNull(),
});

export const itemLocationSettings = sqliteTable(
  'item_location_setting',
  {
    itemId: text('item_id').notNull().references(() => items.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    minQty: real('min_qty'),
    targetQty: real('target_qty'),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.locationId] })],
);

export const stockLots = sqliteTable(
  'stock_lot',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull().references(() => households.id),
    itemId: text('item_id').notNull().references(() => items.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    /** Sealed: the package level it is sealed at. Opened: the package it came from (optional). */
    packageId: text('package_id'),
    state: text('state', { enum: ['sealed', 'opened'] }).notNull(),
    /** Base units. For level-tracked opened lots this is a fraction (0.5 = half a bottle). */
    qtyBase: real('qty_base').notNull(),
    expiresOn: text('expires_on'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('lot_item_idx').on(t.itemId), index('lot_location_idx').on(t.locationId)],
);

export const EVENT_TYPES = [
  'added',
  'used',
  'opened',
  'level_changed',
  'emptied',
  'moved',
  'removed',
  'corrected',
  'item_archived',
  'item_restored',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const inventoryEvents = sqliteTable(
  'inventory_event',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull().references(() => households.id),
    itemId: text('item_id').notNull().references(() => items.id),
    lotId: text('lot_id'),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    deltaBase: real('delta_base').notNull().default(0),
    fromLocationId: text('from_location_id'),
    toLocationId: text('to_location_id'),
    /** removed: 'used_up' | 'thrown_out' | 'expired' | 'unknown'; corrected: 'count' | 'undo'. */
    reason: text('reason'),
    source: text('source', { enum: ['manual', 'barcode', 'receipt', 'photo'] }).notNull().default('manual'),
    actorUserId: text('actor_user_id'),
    occurredAt: text('occurred_at').notNull(),
    /** Small JSON blob for display (e.g. package name opened). */
    meta: text('meta'),
  },
  (t) => [index('event_item_idx').on(t.itemId, t.occurredAt)],
);

export const locationNotificationSettings = sqliteTable(
  'location_notification_setting',
  {
    householdId: text('household_id').notNull().references(() => households.id),
    locationId: text('location_id').notNull().references(() => locations.id),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.locationId] })],
);

export const notificationPreferences = sqliteTable('notification_preference', {
  householdId: text('household_id').primaryKey().references(() => households.id),
  totalAlertsEnabled: integer('total_alerts_enabled', { mode: 'boolean' }).notNull().default(true),
  expiryAlertsEnabled: integer('expiry_alerts_enabled', { mode: 'boolean' }).notNull().default(true),
  expiryWindowDays: integer('expiry_window_days').notNull().default(3),
  mode: text('mode', { enum: ['digest', 'instant'] }).notNull().default('digest'),
  /** 'HH:MM' local time. */
  digestTime: text('digest_time').notNull().default('08:00'),
  quietStart: text('quiet_start').notNull().default('22:00'),
  quietEnd: text('quiet_end').notNull().default('07:00'),
});

/**
 * Remembers which low-stock alerts already fired so they don't repeat until stock
 * rises above the threshold again. scope = 'total' or a location id.
 */
export const alertStates = sqliteTable(
  'alert_state',
  {
    itemId: text('item_id').notNull().references(() => items.id),
    scope: text('scope').notNull(),
    firedAt: text('fired_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.scope] })],
);

export const shoppingListItems = sqliteTable('shopping_list_item', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id),
  itemId: text('item_id').references(() => items.id),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  checkedAt: text('checked_at'),
});

export type Household = typeof households.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type StockLot = typeof stockLots.$inferSelect;
export type InventoryEvent = typeof inventoryEvents.$inferSelect;
export type ItemLocationSetting = typeof itemLocationSettings.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
