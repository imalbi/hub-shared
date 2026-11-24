CREATE TABLE `near_misses` (
	`key` text PRIMARY KEY,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text NOT NULL,
	`site` text NOT NULL,
	`score` real NOT NULL,
	`title_score` real NOT NULL,
	`total` real NOT NULL,
	`reasons` text NOT NULL,
	`min_score` real NOT NULL,
	`min_title_score` real NOT NULL,
	`description` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
