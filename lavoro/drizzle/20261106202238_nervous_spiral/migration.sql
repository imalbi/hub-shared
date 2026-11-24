CREATE TABLE `job_interview` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_interview_key_idx` ON `job_interview` (`key`);