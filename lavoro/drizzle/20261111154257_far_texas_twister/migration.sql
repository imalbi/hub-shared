CREATE TABLE `opinions` (
	`key` text PRIMARY KEY,
	`verdict` text NOT NULL,
	`model` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_opinions_key_jobs_key_fk` FOREIGN KEY (`key`) REFERENCES `jobs`(`key`) ON DELETE CASCADE -- guard-private: allow SQLite foreign key constraint
);
