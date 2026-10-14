CREATE TABLE `discord_admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`token_cipher` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `discord_oauth_states` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bot_commands` ADD `guild_id` text;--> statement-breakpoint
ALTER TABLE `playback_history` ADD `guild_id` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `guild_id` text;