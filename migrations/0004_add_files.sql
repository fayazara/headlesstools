CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`account_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_slug_unique` ON `files` (`slug`);