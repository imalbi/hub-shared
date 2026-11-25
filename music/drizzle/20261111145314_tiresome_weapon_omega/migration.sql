CREATE TABLE `playlist_songs` (
	`playlist_id` integer NOT NULL,
	`position` integer NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT `fk_playlist_songs_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE -- guard-private: allow generated foreign key name
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
