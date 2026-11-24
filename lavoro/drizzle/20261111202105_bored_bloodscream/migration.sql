CREATE TABLE `bando_texts` (
	`key` text PRIMARY KEY,
	`text` text NOT NULL,
	`fetched_at` integer NOT NULL,
	CONSTRAINT `fk_bando_texts_key_jobs_key_fk` FOREIGN KEY (`key`) REFERENCES `jobs`(`key`) ON DELETE CASCADE
);
