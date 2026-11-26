PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_playlist_songs` (
	`item_id` integer PRIMARY KEY AUTOINCREMENT,
	`playlist_id` integer NOT NULL,
	`position` integer NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT `fk_playlist_songs_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_playlist_songs`(`playlist_id`, `position`, `id`, `title`, `artist`, `added_at`) SELECT `playlist_id`, `position`, `id`, `title`, `artist`, `added_at` FROM `playlist_songs`;--> statement-breakpoint
DROP TABLE `playlist_songs`;--> statement-breakpoint
ALTER TABLE `__new_playlist_songs` RENAME TO `playlist_songs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;