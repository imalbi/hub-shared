CREATE TABLE `learning_backlog` (
	`position` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL
);
