CREATE TABLE `compliance_details` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`feature` text NOT NULL,
	`edition` text NOT NULL,
	`status` text NOT NULL,
	`processor_licenses_required` real DEFAULT 0,
	`processor_licenses_available` real DEFAULT 0,
	`processor_licenses_variance` real DEFAULT 0,
	`nup_licenses_required` integer DEFAULT 0,
	`nup_licenses_available` integer DEFAULT 0,
	`nup_licenses_variance` integer DEFAULT 0,
	`total_cores` integer DEFAULT 0,
	`total_physical_cores` integer DEFAULT 0,
	`core_factor` real DEFAULT 0,
	`processor_calculation_details` text,
	`nup_calculation_details` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`run_id`) REFERENCES `compliance_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compliance_feature_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`compliance_detail_id` text NOT NULL,
	`feature_name` text NOT NULL,
	`feature_type` text NOT NULL,
	`status` text NOT NULL,
	`issue_description` text NOT NULL,
	`is_licensed` integer DEFAULT false,
	`license_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`compliance_detail_id`) REFERENCES `compliance_details`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `compliance_host_details` (
	`id` text PRIMARY KEY NOT NULL,
	`compliance_detail_id` text NOT NULL,
	`host_id` text NOT NULL,
	`host_name` text NOT NULL,
	`server_type` text NOT NULL,
	`total_cores` integer NOT NULL,
	`physical_cores` integer,
	`core_factor` real NOT NULL,
	`processor_licenses_required` real NOT NULL,
	`has_hard_partitioning` integer DEFAULT false,
	`physical_host_id` text,
	`licensed_cores` integer DEFAULT 0,
	`unlicensed_cores` integer DEFAULT 0,
	`license_status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`compliance_detail_id`) REFERENCES `compliance_details`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`physical_host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `compliance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`run_date` text DEFAULT CURRENT_TIMESTAMP,
	`status` text DEFAULT 'completed',
	`summary_total_environments` integer DEFAULT 0,
	`summary_compliant` integer DEFAULT 0,
	`summary_non_compliant` integer DEFAULT 0,
	`summary_warning` integer DEFAULT 0,
	`summary_unknown` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `int_LicenseProducts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product` text NOT NULL,
	`only_enterprise` integer DEFAULT false,
	`type` text,
	`License_Product` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `int_LicenseProducts_product_unique` ON `int_LicenseProducts` (`product`);--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
DROP TABLE `license_host_mappings`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_core_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`core_id` integer NOT NULL,
	`physical_core_id` integer,
	`physical_host_id` text
);
--> statement-breakpoint
INSERT INTO `__new_core_assignments`("id", "host_id", "core_id", "physical_core_id", "physical_host_id") SELECT "id", "host_id", "core_id", "physical_core_id", "physical_host_id" FROM `core_assignments`;--> statement-breakpoint
DROP TABLE `core_assignments`;--> statement-breakpoint
ALTER TABLE `__new_core_assignments` RENAME TO `core_assignments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_core_license_mappings` (
	`core_assignment_id` integer NOT NULL,
	`license_id` text NOT NULL,
	`assignment_date` text DEFAULT CURRENT_TIMESTAMP,
	`notes` text,
	PRIMARY KEY(`core_assignment_id`, `license_id`),
	FOREIGN KEY (`core_assignment_id`) REFERENCES `core_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_core_license_mappings`("core_assignment_id", "license_id", "assignment_date", "notes") SELECT "core_assignment_id", "license_id", "assignment_date", "notes" FROM `core_license_mappings`;--> statement-breakpoint
DROP TABLE `core_license_mappings`;--> statement-breakpoint
ALTER TABLE `__new_core_license_mappings` RENAME TO `core_license_mappings`;--> statement-breakpoint
CREATE TABLE `__new_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`primary_use` text,
	`edition` text NOT NULL,
	`version` text NOT NULL,
	`db_type` text,
	`is_data_guard` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_environments`("id", "customer_id", "name", "type", "primary_use", "edition", "version", "db_type", "is_data_guard", "created_at", "updated_at") SELECT "id", "customer_id", "name", "type", "primary_use", "edition", "version", "db_type", "is_data_guard", "created_at", "updated_at" FROM `environments`;--> statement-breakpoint
DROP TABLE `environments`;--> statement-breakpoint
ALTER TABLE `__new_environments` RENAME TO `environments`;--> statement-breakpoint
CREATE TABLE `__new_feature_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`currently_used` integer DEFAULT false,
	`first_usage_date` text,
	`last_usage_date` text,
	`detected_usages` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_feature_stats`("id", "environment_id", "name", "currently_used", "first_usage_date", "last_usage_date", "detected_usages", "created_at", "updated_at") SELECT "id", "environment_id", "name", "currently_used", "first_usage_date", "last_usage_date", "detected_usages", "created_at", "updated_at" FROM `feature_stats`;--> statement-breakpoint
DROP TABLE `feature_stats`;--> statement-breakpoint
ALTER TABLE `__new_feature_stats` RENAME TO `feature_stats`;--> statement-breakpoint
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
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_hosts`("id", "customer_id", "name", "cpu_model", "server_type", "virtualization_type", "has_hard_partitioning", "sockets", "cores", "threads_per_core", "core_factor", "physical_host_id", "status", "created_at", "updated_at") SELECT "id", "customer_id", "name", "cpu_model", "server_type", "virtualization_type", "has_hard_partitioning", "sockets", "cores", "threads_per_core", "core_factor", "physical_host_id", "status", "created_at", "updated_at" FROM `hosts`;--> statement-breakpoint
DROP TABLE `hosts`;--> statement-breakpoint
ALTER TABLE `__new_hosts` RENAME TO `hosts`;--> statement-breakpoint
CREATE TABLE `__new_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`is_primary` integer DEFAULT true,
	`status` text DEFAULT 'Running',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_instances`("id", "environment_id", "host_id", "name", "is_primary", "status", "created_at", "updated_at") SELECT "id", "environment_id", "host_id", "name", "is_primary", "status", "created_at", "updated_at" FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;--> statement-breakpoint
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
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_licenses`("id", "customer_id", "product", "edition", "license_type", "metric", "quantity", "start_date", "end_date", "status", "csi", "comments", "created_at", "updated_at") SELECT "id", "customer_id", "product", "edition", "license_type", "metric", "quantity", "start_date", "end_date", "status", "csi", "comments", "created_at", "updated_at" FROM `licenses`;--> statement-breakpoint
DROP TABLE `licenses`;--> statement-breakpoint
ALTER TABLE `__new_licenses` RENAME TO `licenses`;--> statement-breakpoint
CREATE TABLE `__new_pdbs` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'Open',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_pdbs`("id", "environment_id", "name", "status", "created_at", "updated_at") SELECT "id", "environment_id", "name", "status", "created_at", "updated_at" FROM `pdbs`;--> statement-breakpoint
DROP TABLE `pdbs`;--> statement-breakpoint
ALTER TABLE `__new_pdbs` RENAME TO `pdbs`;--> statement-breakpoint
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
	`password` text NOT NULL,
	`role` text DEFAULT 'customer' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "name", "description", "contact", "email", "phone", "active", "created_at", "updated_at", "username", "password", "role") SELECT "id", "name", "description", "contact", "email", "phone", "active", "created_at", "updated_at", "username", "password", "role" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_username_unique` ON `customers` (`username`);