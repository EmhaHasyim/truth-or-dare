-- Track last room activity so the hourly cron cleanup can remove "zombie"
-- rooms whose creator never connected to the WebSocket (no DO alarm is ever
-- armed for them, so they used to linger in the lobby listing forever).
ALTER TABLE `rooms` ADD COLUMN `last_active_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Backfill: existing rooms count their creation time as activity. New rooms
-- also start at 0 and are stamped by createRoom() + on WebSocket connect.
UPDATE `rooms` SET `last_active_at` = `created_at`;
