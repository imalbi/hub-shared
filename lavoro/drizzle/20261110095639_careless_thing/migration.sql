CREATE TABLE `job_mail_link` (
	`key` text NOT NULL,
	`account` text NOT NULL,
	`message_id` text NOT NULL,
	`linked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_mail_link_unique` ON `job_mail_link` (`key`,`account`,`message_id`);--> statement-breakpoint
CREATE INDEX `job_mail_link_key_idx` ON `job_mail_link` (`key`);