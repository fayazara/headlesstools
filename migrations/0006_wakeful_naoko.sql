CREATE TABLE `pending_uploads` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`slug` text,
	`file_expires_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `delivery_status` text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `delivery_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `delivery_error` text;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_messages_inbox_idempotency_unique` ON `inbox_messages` (`inbox_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `scheduled_emails` ADD `sending_at` integer;--> statement-breakpoint
ALTER TABLE `scheduled_emails` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_emails_account_idempotency_unique` ON `scheduled_emails` (`account_id`,`idempotency_key`);