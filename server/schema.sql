-- Schema for Oracle License Manager

-- Ensure database is in WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    contact TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    active INTEGER DEFAULT 1 CHECK (active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
);

-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    product TEXT NOT NULL,
    edition TEXT,
    license_type TEXT,
    metric TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    status TEXT,
    csi TEXT,
    comments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Hosts table
CREATE TABLE IF NOT EXISTS hosts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cpu_model TEXT NOT NULL,
    server_type TEXT NOT NULL,
    virtualization_type TEXT,
    has_hard_partitioning INTEGER NOT NULL DEFAULT 0 CHECK(has_hard_partitioning IN (0, 1)),
    cores INTEGER NOT NULL,
    sockets INTEGER NOT NULL,
    threads_per_core INTEGER NOT NULL,
    core_factor REAL NOT NULL,
    physical_host_id TEXT,
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (physical_host_id) REFERENCES hosts(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Core assignments table - represents the cores in hosts and their license assignments
CREATE TABLE IF NOT EXISTS core_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id TEXT NOT NULL,
    core_id INTEGER NOT NULL,
    physical_core_id INTEGER,
    physical_host_id TEXT,
    FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
    UNIQUE(host_id, core_id)
);

-- Many-to-many relationship between cores and licenses
CREATE TABLE IF NOT EXISTS core_license_mappings (
    core_assignment_id INTEGER NOT NULL,
    license_id TEXT NOT NULL,
    assignment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    PRIMARY KEY (core_assignment_id, license_id),
    FOREIGN KEY (core_assignment_id) REFERENCES core_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

-- Many-to-many relationship between hosts and licenses (legacy support)
CREATE TABLE IF NOT EXISTS license_host_mappings (
    license_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    assignment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    PRIMARY KEY (license_id, host_id),
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE
);

-- Environments table
CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    primary_use TEXT,
    edition TEXT NOT NULL,
    version TEXT NOT NULL,
    db_type TEXT,
    is_data_guard INTEGER NOT NULL DEFAULT 0 CHECK (is_data_guard IN (0, 1)),
    status TEXT DEFAULT 'active',
    licensable INTEGER DEFAULT 1,
    options TEXT,
    management_packs TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Instances table (linked to environments)
CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_primary INTEGER DEFAULT 1 CHECK (is_primary IN (0, 1)),
    status TEXT DEFAULT 'Running',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- PDBs table (linked to environments)
CREATE TABLE IF NOT EXISTS pdbs (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- Feature stats table (linked to environments)
CREATE TABLE IF NOT EXISTS feature_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    environment_id TEXT NOT NULL,
    name TEXT NOT NULL,
    currently_used INTEGER DEFAULT 0 CHECK (currently_used IN (0, 1)),
    first_usage_date DATE,
    last_usage_date DATE,
    detected_usages INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Not Licensed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);
-- Reference Tables for Database Management
CREATE TABLE IF NOT EXISTS "int_DatabaseEdition" (
    "database_edition" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_EnvironmentType" (
    "env_type" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_MultiTenant" (
    "tenant_type" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_core_factor" (
    "cpu_model" TEXT NOT NULL PRIMARY KEY,
    "core_factor" NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS "int_databaseVersions" (
    "database_version" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_primaryUse" (
    "primary_use" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_virtualizationTypes" (
    "virt_type" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "int_LicenseProducts" (
	"id"	INTEGER PRIMARY KEY AUTOINCREMENT,
	"product"	TEXT NOT NULL UNIQUE,
	"only_enterprise"	INTEGER DEFAULT 0,
	"type"	TEXT,
    "License_Product"	TEXT,
    "oracle_feature_names"	TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_username ON customers(username);
CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product);
CREATE INDEX IF NOT EXISTS idx_licenses_metric ON licenses(metric);
CREATE INDEX IF NOT EXISTS idx_licenses_end_date ON licenses(end_date);
CREATE INDEX IF NOT EXISTS idx_hosts_customer_id ON hosts(customer_id);
CREATE INDEX IF NOT EXISTS idx_hosts_name ON hosts(name);
CREATE INDEX IF NOT EXISTS idx_hosts_physical_host_id ON hosts(physical_host_id);
CREATE INDEX IF NOT EXISTS idx_environments_customer_id ON environments(customer_id);
CREATE INDEX IF NOT EXISTS idx_environments_name ON environments(name);
CREATE INDEX IF NOT EXISTS idx_instances_environment_id ON instances(environment_id);
CREATE INDEX IF NOT EXISTS idx_instances_host_id ON instances(host_id);
CREATE INDEX IF NOT EXISTS idx_pdbs_environment_id ON pdbs(environment_id);
CREATE INDEX IF NOT EXISTS idx_feature_stats_environment_id ON feature_stats(environment_id);
CREATE INDEX IF NOT EXISTS idx_feature_stats_name ON feature_stats(name);
CREATE INDEX IF NOT EXISTS idx_core_assignments_host_id ON core_assignments(host_id);
CREATE INDEX IF NOT EXISTS idx_core_license_mappings_core_assignment_id ON core_license_mappings(core_assignment_id);
CREATE INDEX IF NOT EXISTS idx_core_license_mappings_license_id ON core_license_mappings(license_id);
CREATE INDEX IF NOT EXISTS idx_license_host_mappings_license_id ON license_host_mappings(license_id);
CREATE INDEX IF NOT EXISTS idx_license_host_mappings_host_id ON license_host_mappings(host_id);

-- Compliance run tracking table
CREATE TABLE IF NOT EXISTS compliance_runs (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    run_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed',
    summary_total_environments INTEGER DEFAULT 0,
    summary_compliant INTEGER DEFAULT 0,
    summary_non_compliant INTEGER DEFAULT 0,
    summary_warning INTEGER DEFAULT 0,
    summary_unknown INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Compliance details table for individual environment results
CREATE TABLE IF NOT EXISTS compliance_details (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    feature TEXT NOT NULL, -- Campo obligatorio que faltaba
    edition TEXT NOT NULL, -- Campo obligatorio que faltaba
    status TEXT NOT NULL, -- 'compliant', 'non-compliant', 'warning', 'unknown'
    processor_licenses_required REAL DEFAULT 0,
    processor_licenses_available REAL DEFAULT 0,
    processor_licenses_variance REAL DEFAULT 0,
    nup_licenses_required INTEGER DEFAULT 0,
    nup_licenses_available INTEGER DEFAULT 0,
    nup_licenses_variance INTEGER DEFAULT 0,
    total_cores INTEGER DEFAULT 0,
    total_physical_cores INTEGER DEFAULT 0,
    core_factor REAL DEFAULT 0,
    processor_calculation_details TEXT, -- JSON string with calculation details
    nup_calculation_details TEXT, -- JSON string with calculation details
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES compliance_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- Compliance host details table for detailed host-level core licensing information
CREATE TABLE IF NOT EXISTS compliance_host_details (
    id TEXT PRIMARY KEY,
    compliance_detail_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    server_type TEXT NOT NULL,
    total_cores INTEGER NOT NULL,
    physical_cores INTEGER,
    core_factor REAL NOT NULL,
    processor_licenses_required REAL NOT NULL,
    has_hard_partitioning BOOLEAN DEFAULT FALSE,
    physical_host_id TEXT,
    licensed_cores INTEGER DEFAULT 0,
    unlicensed_cores INTEGER DEFAULT 0,
    license_status TEXT NOT NULL, -- 'compliant', 'non-compliant', 'partial'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compliance_detail_id) REFERENCES compliance_details(id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
    FOREIGN KEY (physical_host_id) REFERENCES hosts(id) ON DELETE SET NULL
);

-- Compliance feature issues table
CREATE TABLE IF NOT EXISTS compliance_feature_issues (
    id TEXT PRIMARY KEY,
    compliance_detail_id TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    feature_type TEXT NOT NULL, -- 'Feature' or 'Option Pack'
    status TEXT NOT NULL, -- 'compliant', 'non-compliant', 'warning'
    issue_description TEXT NOT NULL,
    is_licensed BOOLEAN DEFAULT FALSE,
    license_id TEXT, -- If it's licensed, which license covers it
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compliance_detail_id) REFERENCES compliance_details(id) ON DELETE CASCADE,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_compliance_runs_customer_id ON compliance_runs(customer_id);
CREATE INDEX IF NOT EXISTS idx_compliance_runs_run_date ON compliance_runs(run_date);
CREATE INDEX IF NOT EXISTS idx_compliance_details_run_id ON compliance_details(run_id);
CREATE INDEX IF NOT EXISTS idx_compliance_details_environment_id ON compliance_details(environment_id);
CREATE INDEX IF NOT EXISTS idx_compliance_details_status ON compliance_details(status);
CREATE INDEX IF NOT EXISTS idx_compliance_host_details_compliance_detail_id ON compliance_host_details(compliance_detail_id);
CREATE INDEX IF NOT EXISTS idx_compliance_host_details_host_id ON compliance_host_details(host_id);
CREATE INDEX IF NOT EXISTS idx_compliance_host_details_license_status ON compliance_host_details(license_status);
CREATE INDEX IF NOT EXISTS idx_compliance_feature_issues_compliance_detail_id ON compliance_feature_issues(compliance_detail_id);
CREATE INDEX IF NOT EXISTS idx_compliance_feature_issues_feature_name ON compliance_feature_issues(feature_name);
