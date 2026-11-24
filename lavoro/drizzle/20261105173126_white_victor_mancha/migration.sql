CREATE TABLE `blacklist_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`enabled` integer DEFAULT true NOT NULL,
	`field` text NOT NULL,
	`match_type` text NOT NULL,
	`value` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	`new_count` integer NOT NULL,
	`excluded_count` integer NOT NULL,
	`searches` integer NOT NULL,
	`failed_searches` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`key` text PRIMARY KEY,
	`comparison_key` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text NOT NULL,
	`site` text NOT NULL,
	`url` text NOT NULL UNIQUE,
	`apply_url` text,
	`score` real NOT NULL,
	`total` real NOT NULL,
	`reasons` text NOT NULL,
	`categories` text NOT NULL,
	`description` text,
	`description_html` text,
	`work_mode` text,
	`is_remote` integer NOT NULL,
	`details_missing` integer NOT NULL,
	`posted_at` integer,
	`first_seen` integer NOT NULL,
	`imported_at` integer,
	`blacklist_rule` integer
);
--> statement-breakpoint
CREATE TABLE `known_urls` (
	`url` text PRIMARY KEY,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purged_jobs` (
	`key` text PRIMARY KEY,
	`purged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_comparison_key_idx` ON `jobs` (`comparison_key`);