CREATE TABLE `site_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`site` text NOT NULL,
	`at` integer NOT NULL,
	`status` integer,
	`latency` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `site_days` (
	`site` text NOT NULL,
	`day` text NOT NULL,
	`checks` integer NOT NULL,
	`failed` integer NOT NULL,
	`down_minutes` integer NOT NULL,
	`worst_status` text NOT NULL,
	CONSTRAINT `site_days_pk` PRIMARY KEY(`site`, `day`)
);
