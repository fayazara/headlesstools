CREATE TABLE `scheduled_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`text_body` text,
	`html_body` text,
	`send_at` integer NOT NULL,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
