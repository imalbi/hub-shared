CREATE TABLE `days` (
	`plan_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `days_pk` PRIMARY KEY(`plan_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY,
	`version` integer NOT NULL,
	`header` text NOT NULL,
	`active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`plan_id` text PRIMARY KEY,
	`weekly_hours` integer,
	`mix` text
);
--> statement-breakpoint
CREATE TABLE `progress` (
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `progress_pk` PRIMARY KEY(`plan_id`, `kind`, `id`)
);
