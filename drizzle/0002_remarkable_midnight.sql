PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`contact` text,
	`email` text,
	`phone` text,
	`active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`username` text,
	`password` text DEFAULT '',
	`role` text DEFAULT 'customer' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "name", "description", "contact", "email", "phone", "active", "created_at", "updated_at", "username", "password", "role") SELECT "id", "name", "description", "contact", "email", "phone", "active", "created_at", "updated_at", "username", "password", "role" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_username_unique` ON `customers` (`username`);--> statement-breakpoint
CREATE TABLE `__new_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`primary_use` text,
	`edition` text NOT NULL,
	`version` text NOT NULL,
	`db_type` text,
	`is_data_guard` integer DEFAULT false,
	`status` text DEFAULT 'active',
	`licensable` integer DEFAULT true,
	`options` text,
	`management_packs` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_environments`("id", "customer_id", "name", "description", "type", "primary_use", "edition", "version", "db_type", "is_data_guard", "status", "licensable", "options", "management_packs", "created_at", "updated_at") SELECT "id", "customer_id", "name", "description", "type", "primary_use", "edition", "version", "db_type", "is_data_guard", "status", "licensable", "options", "management_packs", "created_at", "updated_at" FROM `environments`;--> statement-breakpoint
DROP TABLE `environments`;--> statement-breakpoint
ALTER TABLE `__new_environments` RENAME TO `environments`;--> statement-breakpoint
CREATE INDEX `environments_customer_id_idx` ON `environments` (`customer_id`);--> statement-breakpoint
CREATE TABLE `__new_feature_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`currently_used` integer DEFAULT false,
	`first_usage_date` text,
	`last_usage_date` text,
	`detected_usages` integer DEFAULT 0,
	`status` text DEFAULT 'Not Licensed',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_feature_stats`("id", "environment_id", "name", "currently_used", "first_usage_date", "last_usage_date", "detected_usages", "status", "created_at", "updated_at") SELECT "id", "environment_id", "name", "currently_used", "first_usage_date", "last_usage_date", "detected_usages", "status", "created_at", "updated_at" FROM `feature_stats`;--> statement-breakpoint
DROP TABLE `feature_stats`;--> statement-breakpoint
ALTER TABLE `__new_feature_stats` RENAME TO `feature_stats`;--> statement-breakpoint
CREATE INDEX `feature_stats_environment_id_idx` ON `feature_stats` (`environment_id`);--> statement-breakpoint
ALTER TABLE `int_LicenseProducts` ADD `oracle_feature_names` text;--> statement-breakpoint
CREATE TABLE `__new_core_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`core_id` integer NOT NULL,
	`physical_core_id` integer,
	`physical_host_id` text,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_core_assignments`("id", "host_id", "core_id", "physical_core_id", "physical_host_id") SELECT "id", "host_id", "core_id", "physical_core_id", "physical_host_id" FROM `core_assignments`;--> statement-breakpoint
DROP TABLE `core_assignments`;--> statement-breakpoint
ALTER TABLE `__new_core_assignments` RENAME TO `core_assignments`;--> statement-breakpoint
CREATE INDEX `core_assignments_host_id_idx` ON `core_assignments` (`host_id`);--> statement-breakpoint
CREATE TABLE `__new_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`cpu_model` text NOT NULL,
	`server_type` text NOT NULL,
	`virtualization_type` text,
	`has_hard_partitioning` integer DEFAULT false,
	`sockets` integer NOT NULL,
	`cores` integer NOT NULL,
	`threads_per_core` integer NOT NULL,
	`core_factor` real NOT NULL,
	`physical_host_id` text,
	`status` text DEFAULT 'Active',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_hosts`("id", "customer_id", "name", "cpu_model", "server_type", "virtualization_type", "has_hard_partitioning", "sockets", "cores", "threads_per_core", "core_factor", "physical_host_id", "status", "created_at", "updated_at") SELECT "id", "customer_id", "name", "cpu_model", "server_type", "virtualization_type", "has_hard_partitioning", "sockets", "cores", "threads_per_core", "core_factor", "physical_host_id", "status", "created_at", "updated_at" FROM `hosts`;--> statement-breakpoint
DROP TABLE `hosts`;--> statement-breakpoint
ALTER TABLE `__new_hosts` RENAME TO `hosts`;--> statement-breakpoint
CREATE INDEX `hosts_customer_id_idx` ON `hosts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `hosts_physical_host_id_idx` ON `hosts` (`physical_host_id`);--> statement-breakpoint
CREATE TABLE `__new_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`is_primary` integer DEFAULT true,
	`status` text DEFAULT 'Running',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_instances`("id", "environment_id", "host_id", "name", "is_primary", "status", "created_at", "updated_at") SELECT "id", "environment_id", "host_id", "name", "is_primary", "status", "created_at", "updated_at" FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;--> statement-breakpoint
CREATE INDEX `instances_environment_id_idx` ON `instances` (`environment_id`);--> statement-breakpoint
CREATE INDEX `instances_host_id_idx` ON `instances` (`host_id`);--> statement-breakpoint
CREATE TABLE `__new_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`product` text NOT NULL,
	`edition` text,
	`license_type` text,
	`metric` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`end_date` text,
	`status` text,
	`csi` text,
	`comments` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_licenses`("id", "customer_id", "product", "edition", "license_type", "metric", "quantity", "start_date", "end_date", "status", "csi", "comments", "created_at", "updated_at") SELECT "id", "customer_id", "product", "edition", "license_type", "metric", "quantity", "start_date", "end_date", "status", "csi", "comments", "created_at", "updated_at" FROM `licenses`;--> statement-breakpoint
DROP TABLE `licenses`;--> statement-breakpoint
ALTER TABLE `__new_licenses` RENAME TO `licenses`;--> statement-breakpoint
CREATE INDEX `licenses_customer_id_idx` ON `licenses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `__new_pdbs` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'Open',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pdbs`("id", "environment_id", "name", "status", "created_at", "updated_at") SELECT "id", "environment_id", "name", "status", "created_at", "updated_at" FROM `pdbs`;--> statement-breakpoint
DROP TABLE `pdbs`;--> statement-breakpoint
ALTER TABLE `__new_pdbs` RENAME TO `pdbs`;--> statement-breakpoint
CREATE INDEX `pdbs_environment_id_idx` ON `pdbs` (`environment_id`);