PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rooms` (
	`id` text PRIMARY KEY,
	`code` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`host_name` text NOT NULL,
	`max_players` integer DEFAULT 2 NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_rooms`(`id`, `code`, `name`, `host_name`, `max_players`, `password_hash`, `status`, `created_at`) SELECT `id`, `code`, `name`, `host_name`, `max_players`, `password_hash`, `status`, `created_at` FROM `rooms`;--> statement-breakpoint
DROP TABLE `rooms`;--> statement-breakpoint
ALTER TABLE `__new_rooms` RENAME TO `rooms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;