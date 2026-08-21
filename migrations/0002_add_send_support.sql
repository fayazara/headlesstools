ALTER TABLE `inbox_messages` ADD `direction` text DEFAULT 'inbound' NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `message_id` text;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `in_reply_to` text;