import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// Customers table (Multi-tenant support)
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  contact: text('contact'),
  email: text('email').unique(),
  phone: text('phone'),
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  username: text('username').unique(),
  password: text('password').default(''),
  role: text('role').default('customer').notNull(),
});

// Licenses table (Acquired Licenses)
export const licenses = sqliteTable('licenses', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  product: text('product').notNull(),
  edition: text('edition'),
  licenseType: text('license_type'),
  metric: text('metric').notNull(),
  quantity: integer('quantity').notNull().default(0),
  startDate: text('start_date'),
  endDate: text('end_date'),
  status: text('status'),
  csi: text('csi'),
  comments: text('comments'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  customerIdx: index('licenses_customer_id_idx').on(table.customerId),
}));

// Hosts table (Physical or Virtual Servers)
export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  cpuModel: text('cpu_model').notNull(),
  serverType: text('server_type').notNull(),
  virtualizationType: text('virtualization_type'),
  hasHardPartitioning: integer('has_hard_partitioning', { mode: 'boolean' }).default(false),
  sockets: integer('sockets').notNull(),
  cores: integer('cores').notNull(),
  threadsPerCore: integer('threads_per_core').notNull(),
  coreFactor: real('core_factor').notNull(),
  physicalHostId: text('physical_host_id'),
  status: text('status').default('Active'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  customerIdx: index('hosts_customer_id_idx').on(table.customerId),
  physicalHostIdx: index('hosts_physical_host_id_idx').on(table.physicalHostId),
}));

// Environments table (Oracle Databases/Services)
export const environments = sqliteTable('environments', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  primaryUse: text('primary_use'),
  edition: text('edition').notNull(),
  version: text('version').notNull(),
  dbType: text('db_type'),
  isDataGuard: integer('is_data_guard', { mode: 'boolean' }).default(false),
  status: text('status').default('active'),
  licensable: integer('licensable', { mode: 'boolean' }).default(true),
  options: text('options'),           // JSON string array
  managementPacks: text('management_packs'), // JSON string array
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  customerIdx: index('environments_customer_id_idx').on(table.customerId),
}));

// Instances table (Link Environment to Host)
export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  environmentId: text('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(true),
  status: text('status').default('Running'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  environmentIdx: index('instances_environment_id_idx').on(table.environmentId),
  hostIdx: index('instances_host_id_idx').on(table.hostId),
}));

// PDBs table (Pluggable Databases for Multitenant)
export const pdbs = sqliteTable('pdbs', {
  id: text('id').primaryKey(),
  environmentId: text('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').default('Open'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  environmentIdx: index('pdbs_environment_id_idx').on(table.environmentId),
}));

// Feature Stats table (Detected usage of licensable options/packs)
export const featureStats = sqliteTable('feature_stats', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  environmentId: text('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  currentlyUsed: integer('currently_used', { mode: 'boolean' }).default(false),
  firstUsageDate: text('first_usage_date'),
  lastUsageDate: text('last_usage_date'),
  detectedUsages: integer('detected_usages').default(0),
  status: text('status').default('Not Licensed'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  environmentIdx: index('feature_stats_environment_id_idx').on(table.environmentId),
}));

// Core Assignments table
export const coreAssignments = sqliteTable('core_assignments', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  coreId: integer('core_id').notNull(),
  physicalCoreId: integer('physical_core_id'),
  physicalHostId: text('physical_host_id'),
}, (table) => ({
  hostIdx: index('core_assignments_host_id_idx').on(table.hostId),
}));

// Core License Mappings table
export const coreLicenseMappings = sqliteTable('core_license_mappings', {
  coreAssignmentId: integer('core_assignment_id').notNull().references(() => coreAssignments.id),
  licenseId: text('license_id').notNull().references(() => licenses.id),
  assignmentDate: text('assignment_date').default(sql`CURRENT_TIMESTAMP`),
  notes: text('notes'),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.coreAssignmentId, table.licenseId] }),
  };
});

// Note: The license_host_mappings table has been removed and replaced by core_license_mappings
// This is kept as a comment for reference of the previous schema

// ─── Reference / Metadata Tables ──────────────────────────────────────────────
// These "int_*" tables hold the allowed values for dropdowns and selectors
// across the application (environments, hosts, licenses, imports).
// They are managed by admins via the System Maintenance page and consumed by
// forms, filters, and the OS-import workflow. Adding/removing a value here
// is immediately reflected in every UI that references the table.
// ──────────────────────────────────────────────────────────────────────────────

/** Oracle Database editions (e.g. "Enterprise", "Standard 2"). Used in environment forms and filters. */
export const intDatabaseEdition = sqliteTable('int_DatabaseEdition', {
  databaseEdition: text('database_edition').primaryKey(),
});

/** Environment types describing the Oracle topology (e.g. "Standalone", "RAC"). Used in environment forms. */
export const intEnvironmentType = sqliteTable('int_EnvironmentType', {
  envType: text('env_type').primaryKey(),
});

/** Multi-tenant / database container types (e.g. "CDB", "Non-CDB"). Used in environment forms. */
export const intMultiTenant = sqliteTable('int_MultiTenant', {
  tenantType: text('tenant_type').primaryKey(),
});

/**
 * Oracle core-factor table mapping CPU models to their licensing multiplier.
 * Used during host import and compliance calculations.
 * @see https://www.oracle.com/us/corporate/contracts/processor-core-factor-table-702702.pdf
 */
export const intCoreFactor = sqliteTable('int_core_factor', {
  cpuModel: text('cpu_model').notNull().primaryKey(),
  coreFactor: real('core_factor').notNull(),
});

/** Oracle Database version strings (e.g. "19", "21"). Used in environment forms. */
export const intDatabaseVersions = sqliteTable('int_databaseVersions', {
  databaseVersion: text('database_version').primaryKey(),
});

/** Primary use / purpose of an environment (e.g. "Production", "Development", "Test"). Used in environment forms, filters, and OS import. */
export const intPrimaryUse = sqliteTable('int_primaryUse', {
  primaryUse: text('primary_use').primaryKey(),
});

/** Server virtualization technologies (e.g. "VMware", "OVM", "KVM"). Used in host forms and OS import. */
export const intVirtualizationTypes = sqliteTable('int_virtualizationTypes', {
  virtType: text('virt_type').primaryKey(),
});

/**
 * Oracle license product catalog (options, packs, features).
 * - product: display name shown in license and compliance UIs.
 * - onlyEnterprise: if true, the product applies only to Enterprise Edition.
 * - type: product category ("Option Pack", "Feature", etc.).
 * - License_Product: canonical Oracle license metric name.
 * - oracleFeatureNames: comma-separated DBA_FEATURE_USAGE_STATISTICS names used for auto-detection.
 */
export const intLicenseProducts = sqliteTable('int_LicenseProducts', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  product: text('product').notNull().unique(),
  onlyEnterprise: integer('only_enterprise', { mode: 'boolean' }).default(false),
  type: text('type'),
  License_Product: text('License_Product'),
  oracleFeatureNames: text('oracle_feature_names'),
});

// Relations
export const customersRelations = relations(customers, ({ many }) => ({
  environments: many(environments),
  hosts: many(hosts),
  licenses: many(licenses),
}));

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  customer: one(customers, {
    fields: [environments.customerId],
    references: [customers.id],
  }),
  instances: many(instances),
  featureStats: many(featureStats),
  pdbs: many(pdbs),
}));

export const hostsRelations = relations(hosts, ({ one, many }) => ({
  customer: one(customers, {
    fields: [hosts.customerId],
    references: [customers.id],
  }),
  physicalHost: one(hosts, {
    fields: [hosts.physicalHostId],
    references: [hosts.id],
  }),
  instances: many(instances),
  coreAssignments: many(coreAssignments),
}));

export const instancesRelations = relations(instances, ({ one }) => ({
  environment: one(environments, {
    fields: [instances.environmentId],
    references: [environments.id],
  }),
  host: one(hosts, {
    fields: [instances.hostId],
    references: [hosts.id],
  }),
}));

export const licensesRelations = relations(licenses, ({ one, many }) => ({
  customer: one(customers, {
    fields: [licenses.customerId],
    references: [customers.id],
  }),

  coreLicenseMappings: many(coreLicenseMappings),
}));

export const pdbsRelations = relations(pdbs, ({ one }) => ({
  environment: one(environments, {
    fields: [pdbs.environmentId],
    references: [environments.id],
  }),
}));

export const featureStatsRelations = relations(featureStats, ({ one }) => ({
  environment: one(environments, {
    fields: [featureStats.environmentId],
    references: [environments.id],
  }),
}));

export const coreAssignmentsRelations = relations(coreAssignments, ({ one, many }) => ({
  host: one(hosts, {
    fields: [coreAssignments.hostId],
    references: [hosts.id],
  }),
  coreLicenseMappings: many(coreLicenseMappings),
}));

export const coreLicenseMappingsRelations = relations(coreLicenseMappings, ({ one }) => ({
  coreAssignment: one(coreAssignments, {
    fields: [coreLicenseMappings.coreAssignmentId],
    references: [coreAssignments.id],
  }),
  license: one(licenses, {
    fields: [coreLicenseMappings.licenseId],
    references: [licenses.id],
  }),
}));

// The licenseHostMappingsRelations have been removed since the table no longer exists

// Zod schemas for validation
export const insertCustomerSchema = createInsertSchema(customers);
export const selectCustomerSchema = createSelectSchema(customers);

export const insertEnvironmentSchema = createInsertSchema(environments);
export const selectEnvironmentSchema = createSelectSchema(environments);

export const insertHostSchema = createInsertSchema(hosts);
export const selectHostSchema = createSelectSchema(hosts);

export const insertInstanceSchema = createInsertSchema(instances);
export const selectInstanceSchema = createSelectSchema(instances);

export const insertLicenseSchema = createInsertSchema(licenses);
export const selectLicenseSchema = createSelectSchema(licenses);

// Export types for TypeScript usage
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;

export type Host = typeof hosts.$inferSelect;
export type NewHost = typeof hosts.$inferInsert;

export type Instance = typeof instances.$inferSelect;
export type NewInstance = typeof instances.$inferInsert;

export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;

export type FeatureStat = typeof featureStats.$inferSelect;
export type NewFeatureStat = typeof featureStats.$inferInsert;

export type CoreAssignment = typeof coreAssignments.$inferSelect;
export type NewCoreAssignment = typeof coreAssignments.$inferInsert;

export type CoreLicenseMapping = typeof coreLicenseMappings.$inferSelect;
export type NewCoreLicenseMapping = typeof coreLicenseMappings.$inferInsert;

export type PDB = typeof pdbs.$inferSelect;
export type NewPDB = typeof pdbs.$inferInsert;

// Reference table types
export type DatabaseEdition = typeof intDatabaseEdition.$inferSelect;
export type NewDatabaseEdition = typeof intDatabaseEdition.$inferInsert;

export type EnvironmentType = typeof intEnvironmentType.$inferSelect;
export type NewEnvironmentType = typeof intEnvironmentType.$inferInsert;

export type MultiTenant = typeof intMultiTenant.$inferSelect;
export type NewMultiTenant = typeof intMultiTenant.$inferInsert;

export type CoreFactor = typeof intCoreFactor.$inferSelect;
export type NewCoreFactor = typeof intCoreFactor.$inferInsert;

export type DatabaseVersion = typeof intDatabaseVersions.$inferSelect;
export type NewDatabaseVersion = typeof intDatabaseVersions.$inferInsert;

export type PrimaryUse = typeof intPrimaryUse.$inferSelect;
export type NewPrimaryUse = typeof intPrimaryUse.$inferInsert;

export type VirtualizationType = typeof intVirtualizationTypes.$inferSelect;
export type NewVirtualizationType = typeof intVirtualizationTypes.$inferInsert;

export type LicenseProduct = typeof intLicenseProducts.$inferSelect;
export type NewLicenseProduct = typeof intLicenseProducts.$inferInsert;

// Compliance Runs table
export const complianceRuns = sqliteTable('compliance_runs', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  runDate: text('run_date').default(sql`CURRENT_TIMESTAMP`),
  status: text('status').default('completed'),
  summaryTotalEnvironments: integer('summary_total_environments').default(0),
  summaryCompliant: integer('summary_compliant').default(0),
  summaryNonCompliant: integer('summary_non_compliant').default(0),
  summaryWarning: integer('summary_warning').default(0),
  summaryUnknown: integer('summary_unknown').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Compliance Details table for individual environment results
export const complianceDetails = sqliteTable('compliance_details', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => complianceRuns.id, { onDelete: 'cascade' }),
  environmentId: text('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(), // Campo obligatorio que faltaba
  edition: text('edition').notNull(), // Campo obligatorio que faltaba
  status: text('status').notNull(), // 'compliant', 'non-compliant', 'warning', 'unknown'
  processorLicensesRequired: real('processor_licenses_required').default(0),
  processorLicensesAvailable: real('processor_licenses_available').default(0),
  processorLicensesVariance: real('processor_licenses_variance').default(0),
  nupLicensesRequired: integer('nup_licenses_required').default(0),
  nupLicensesAvailable: integer('nup_licenses_available').default(0),
  nupLicensesVariance: integer('nup_licenses_variance').default(0),
  totalCores: integer('total_cores').default(0),
  totalPhysicalCores: integer('total_physical_cores').default(0),
  coreFactor: real('core_factor').default(0),
  processorCalculationDetails: text('processor_calculation_details'), // JSON string with calculation details
  nupCalculationDetails: text('nup_calculation_details'), // JSON string with calculation details
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Compliance Host Details table for detailed host-level core licensing information
export const complianceHostDetails = sqliteTable('compliance_host_details', {
  id: text('id').primaryKey(),
  complianceDetailId: text('compliance_detail_id').notNull().references(() => complianceDetails.id, { onDelete: 'cascade' }),
  hostId: text('host_id').notNull().references(() => hosts.id, { onDelete: 'cascade' }),
  hostName: text('host_name').notNull(),
  serverType: text('server_type').notNull(),
  totalCores: integer('total_cores').notNull(),
  physicalCores: integer('physical_cores'),
  coreFactor: real('core_factor').notNull(),
  processorLicensesRequired: real('processor_licenses_required').notNull(),
  hasHardPartitioning: integer('has_hard_partitioning', { mode: 'boolean' }).default(false),
  physicalHostId: text('physical_host_id').references(() => hosts.id, { onDelete: 'set null' }),
  licensedCores: integer('licensed_cores').default(0),
  unlicensedCores: integer('unlicensed_cores').default(0),
  licenseStatus: text('license_status').notNull(), // 'compliant', 'non-compliant', 'partial'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Compliance Feature Issues table
export const complianceFeatureIssues = sqliteTable('compliance_feature_issues', {
  id: text('id').primaryKey(),
  complianceDetailId: text('compliance_detail_id').notNull().references(() => complianceDetails.id, { onDelete: 'cascade' }),
  featureName: text('feature_name').notNull(),
  featureType: text('feature_type').notNull(), // 'Feature' or 'Option Pack'
  status: text('status').notNull(), // 'compliant', 'non-compliant', 'warning'
  issueDescription: text('issue_description').notNull(),
  isLicensed: integer('is_licensed', { mode: 'boolean' }).default(false),
  licenseId: text('license_id').references(() => licenses.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Relations
export const complianceRunsRelations = relations(complianceRuns, ({ many, one }) => ({
  details: many(complianceDetails),
  customer: one(customers, {
    fields: [complianceRuns.customerId],
    references: [customers.id]
  }),
}));

export const complianceDetailsRelations = relations(complianceDetails, ({ many, one }) => ({
  run: one(complianceRuns, {
    fields: [complianceDetails.runId],
    references: [complianceRuns.id]
  }),
  environment: one(environments, {
    fields: [complianceDetails.environmentId],
    references: [environments.id]
  }),
  featureIssues: many(complianceFeatureIssues),
  hostDetails: many(complianceHostDetails)
}));

export const complianceHostDetailsRelations = relations(complianceHostDetails, ({ one }) => ({
  complianceDetail: one(complianceDetails, {
    fields: [complianceHostDetails.complianceDetailId],
    references: [complianceDetails.id]
  }),
  host: one(hosts, {
    fields: [complianceHostDetails.hostId],
    references: [hosts.id]
  }),
  physicalHost: one(hosts, {
    fields: [complianceHostDetails.physicalHostId],
    references: [hosts.id]
  })
}));

export const complianceFeatureIssuesRelations = relations(complianceFeatureIssues, ({ one }) => ({
  detail: one(complianceDetails, {
    fields: [complianceFeatureIssues.complianceDetailId],
    references: [complianceDetails.id]
  }),
  license: one(licenses, {
    fields: [complianceFeatureIssues.licenseId],
    references: [licenses.id]
  })
}));

// Types for use with Zod validation
export type ComplianceRun = typeof complianceRuns.$inferSelect;
export type NewComplianceRun = typeof complianceRuns.$inferInsert;

export type ComplianceDetail = typeof complianceDetails.$inferSelect;
export type NewComplianceDetail = typeof complianceDetails.$inferInsert;

export type ComplianceHostDetail = typeof complianceHostDetails.$inferSelect;
export type NewComplianceHostDetail = typeof complianceHostDetails.$inferInsert;

export type ComplianceFeatureIssue = typeof complianceFeatureIssues.$inferSelect;
export type NewComplianceFeatureIssue = typeof complianceFeatureIssues.$inferInsert;
