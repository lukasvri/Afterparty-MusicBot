CREATE TABLE `activity_test_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`token_cipher` text NOT NULL,
	`guild_id` text NOT NULL,
	`room_code` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_test_sessions_expiry` ON `activity_test_sessions` (`expires_at`);