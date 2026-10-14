CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`password_revision` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_state` (
	`key` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playback_history` (
	`event_id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`video` text NOT NULL,
	`source` text NOT NULL,
	`played_at` integer NOT NULL
);
