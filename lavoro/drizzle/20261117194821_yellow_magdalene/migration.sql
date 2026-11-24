CREATE TABLE `application_address` (
	`key` text NOT NULL,
	`address` text NOT NULL,
	`origin` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `job_mail_link` ADD `link_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `application_address_unique` ON `application_address` (`key`,`address`);