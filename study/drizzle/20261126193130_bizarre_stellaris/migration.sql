CREATE TABLE `resources` (
	`position` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`plan_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`folder` integer,
	`page` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
