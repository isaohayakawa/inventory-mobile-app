CREATE TABLE `alert_state` (
	`item_id` text NOT NULL,
	`scope` text NOT NULL,
	`fired_at` text NOT NULL,
	PRIMARY KEY(`item_id`, `scope`),
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `household_member` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_event` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`item_id` text NOT NULL,
	`lot_id` text,
	`type` text NOT NULL,
	`delta_base` real DEFAULT 0 NOT NULL,
	`from_location_id` text,
	`to_location_id` text,
	`reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`actor_user_id` text,
	`occurred_at` text NOT NULL,
	`meta` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_item_idx` ON `inventory_event` (`item_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `item_location_setting` (
	`item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`min_qty` real,
	`target_qty` real,
	PRIMARY KEY(`item_id`, `location_id`),
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`base_unit` text NOT NULL,
	`tracking` text DEFAULT 'count' NOT NULL,
	`min_total` real,
	`always_keep` integer DEFAULT false NOT NULL,
	`size_amount` real,
	`size_unit` text,
	`last_activity_at` text,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_household_idx` ON `item` (`household_id`);--> statement-breakpoint
CREATE TABLE `location_notification_setting` (
	`household_id` text NOT NULL,
	`location_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`household_id`, `location_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notification_preference` (
	`household_id` text PRIMARY KEY NOT NULL,
	`total_alerts_enabled` integer DEFAULT true NOT NULL,
	`expiry_alerts_enabled` integer DEFAULT true NOT NULL,
	`expiry_window_days` integer DEFAULT 3 NOT NULL,
	`mode` text DEFAULT 'digest' NOT NULL,
	`digest_time` text DEFAULT '08:00' NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '07:00' NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `package` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`contains_qty` real NOT NULL,
	`contains_package_id` text,
	`gtin` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shopping_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`item_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`checked_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_lot` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`package_id` text,
	`state` text NOT NULL,
	`qty_base` real NOT NULL,
	`expires_on` text,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lot_item_idx` ON `stock_lot` (`item_id`);--> statement-breakpoint
CREATE INDEX `lot_location_idx` ON `stock_lot` (`location_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`default_unit_system` text DEFAULT 'imperial' NOT NULL,
	`created_at` text NOT NULL
);
