CREATE TABLE `mail_checked` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account` text NOT NULL,
	`message_id` text NOT NULL,
	`subject` text NOT NULL,
	`sender` text NOT NULL,
	`received_at` integer,
	`checked_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`answer` text,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE TABLE `mail_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`account` text NOT NULL,
	`message_id` text NOT NULL,
	`subject` text NOT NULL,
	`why` text NOT NULL,
	`status` text,
	`scheduled_at` integer,
	`label` text,
	`created_at` integer NOT NULL,
	`resolution` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_checked_unique` ON `mail_checked` (`account`,`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_proposals_unique` ON `mail_proposals` (`kind`,`key`,`account`,`message_id`);--> statement-breakpoint
CREATE INDEX `mail_proposals_key_idx` ON `mail_proposals` (`key`);