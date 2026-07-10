-- Consolidated schema for Truth or Dare
-- Matches src/db/schema.ts exactly

CREATE TABLE `rooms` (
	`id` text PRIMARY KEY,
	`code` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`host_name` text NOT NULL,
	`max_players` integer DEFAULT 2 NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_players_room_id_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_room_name` ON `players` (`room_id`, `name`);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY,
	`room_id` text NOT NULL,
	`status` text DEFAULT 'playing' NOT NULL,
	`player_order` text NOT NULL,
	`current_player_index` integer DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_games_room_id_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`game_id` text NOT NULL,
	`round` integer NOT NULL,
	`player_id` text NOT NULL,
	`type` text NOT NULL,
	`question_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_turns_game_id_games_id_fk` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_turns_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`)
);
