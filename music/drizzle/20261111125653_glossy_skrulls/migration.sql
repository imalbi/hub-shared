CREATE TABLE `favorites` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`played_at` integer NOT NULL
);
