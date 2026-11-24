CREATE TABLE `job_applied` (
	`key` text PRIMARY KEY,
	`applied_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`closed_at` integer,
	`reason` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `job_archive` (
	`key` text PRIMARY KEY,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_deleted` (
	`key` text PRIMARY KEY,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_favorite` (
	`key` text PRIMARY KEY,
	`at` integer NOT NULL
);
