import Database from 'better-sqlite3';

const databaseEditions = ['Enterprise', 'Express', 'Standard'] as const;
const environmentTypes = ['Oracle SEHA', 'RAC', 'RAC One Node', 'Standalone'] as const;
const multiTenantTypes = ['CDB', 'Non-CDB'] as const;
const databaseVersions = ['9', '10', '11', '12', '18', '19', '21', '23', '26'] as const;
const primaryUses = ['Development', 'Production', 'QA', 'Test'] as const;
const virtualizationTypes = ['Hyper-V', 'KVM', 'LDOM', 'OVM', 'VMware', 'Xen'] as const;

const coreFactors = [
  { cpuModel: 'AMD EPYC / Opteron', coreFactor: 0.5 },
  { cpuModel: 'HP PA-RISC', coreFactor: 0.75 },
  { cpuModel: 'IBM POWER 6 7 8 o 9', coreFactor: 1 },
  { cpuModel: 'IBM POWER5+ o anteriores', coreFactor: 0.75 },
  { cpuModel: 'Intel Itanium', coreFactor: 1 },
  { cpuModel: 'Intel Xeon', coreFactor: 0.5 },
  { cpuModel: 'Other', coreFactor: 1 },
  { cpuModel: 'SPARC T1, T2, T3', coreFactor: 0.25 },
  { cpuModel: 'SPARC T4, T5, M5, M6, M7, M8, S7', coreFactor: 0.5 },
  { cpuModel: 'SPARC64 VI, VII', coreFactor: 0.75 },
  { cpuModel: 'SPARC64 X, X+, XII', coreFactor: 0.5 },
  { cpuModel: 'UltraSPARC IV, IV+', coreFactor: 0.75 },
];

const licenseProducts = [
  { product: 'Oracle Database', onlyEnterprise: 0, type: 'Product Base', licenseProduct: 'Oracle Database', oracleFeatureNames: null },
  { product: 'Diagnostics', onlyEnterprise: 1, type: 'Option Pack', licenseProduct: 'Diagnostics Pack', oracleFeatureNames: '["Diagnostics Pack","AWR Report","AWR Baseline","Active Session History","Automatic Workload Repository","ADDM","EM Performance Page"]' },
  { product: 'Tuning', onlyEnterprise: 1, type: 'Option Pack', licenseProduct: 'Tuning Pack', oracleFeatureNames: '["Tuning Pack","SQL Tuning Advisor","Automatic SQL Tuning Advisor","SQL Tuning Set","Real-Time SQL Monitoring","SQL Tuning Set (system)","Automatic Maintenance - SQL Tuning Advisor"]' },
  { product: 'Partitioning', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Partitioning', oracleFeatureNames: '["Oracle Partitioning","Partitioning (user)","Partitioning (system)"]' },
  { product: 'Real Application Clusters', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Real Application Clusters', oracleFeatureNames: '["Oracle Real Application Clusters","Real Application Clusters (different i"]' },
  { product: 'Advanced Security', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Advanced Security', oracleFeatureNames: '["Oracle Advanced Security","Transparent Data Encryption","Encrypted Tablespaces","Data Redaction"]' },
  { product: 'Label Security', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Advanced Security', oracleFeatureNames: '["Oracle Label Security","Label Security"]' },
  { product: 'Database Vault', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Database Vault', oracleFeatureNames: '["Oracle Database Vault","Database Vault"]' },
  { product: 'OLAP', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'OLAP', oracleFeatureNames: '["Oracle OLAP","OLAP - Analytic Workspaces"]' },
  { product: 'Advanced Analytics', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Advanced Analytics', oracleFeatureNames: '["Oracle Advanced Analytics","Oracle Data Mining","Data Mining"]' },
  // Spatial and Graph removed — included with Oracle Database (EE, SE2, Cloud) since Dec 5 2019
  { product: 'Database In-Memory', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Database In-Memory', oracleFeatureNames: '["Oracle Database In-Memory","In-Memory Column Store","In-Memory Aggregation"]' },
  { product: 'Active Data Guard', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Active Data Guard', oracleFeatureNames: '["Active Data Guard","Oracle Active Data Guard","Active Data Guard - Real-Time Query on Physical Standby"]' },
  { product: 'Real Application Testing', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Real Application Testing', oracleFeatureNames: '["Oracle Real Application Testing","Real Application Testing","Database Replay","SQL Performance Analyzer"]' },
  { product: 'Advanced Compression', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Advanced Compression', oracleFeatureNames: '["Oracle Advanced Compression","HeapCompression","Backup ZLIB Compression","Backup BZIP2 Compression"]' },
  { product: 'Multitenant', onlyEnterprise: 1, type: 'Feature', licenseProduct: 'Multitenant', oracleFeatureNames: '["Oracle Multitenant"]' },
  { product: 'Lifecycle Management', onlyEnterprise: 1, type: 'Option Pack', licenseProduct: 'Lifecycle Management Pack', oracleFeatureNames: '["Lifecycle Management Pack"]' },
  { product: 'Data Masking and Subsetting', onlyEnterprise: 1, type: 'Option Pack', licenseProduct: 'Data Masking and Subsetting Pack', oracleFeatureNames: '["Oracle Data Masking and Subsetting","Data Masking Pack"]' },
  { product: 'Cloud Management', onlyEnterprise: 1, type: 'Option Pack', licenseProduct: 'Cloud Management Pack', oracleFeatureNames: '["Cloud Management Pack for Oracle Database"]' },
];

function countRows(database: Database.Database, tableName: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function columnExists(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

export function seedReferenceData(database: Database.Database): void {
  if (!columnExists(database, 'int_LicenseProducts', 'oracle_feature_names')) {
    database.exec('ALTER TABLE int_LicenseProducts ADD COLUMN oracle_feature_names TEXT');
  }

  if (countRows(database, 'int_DatabaseEdition') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_DatabaseEdition (database_edition) VALUES (?)');
    for (const value of databaseEditions) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_EnvironmentType') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_EnvironmentType (env_type) VALUES (?)');
    for (const value of environmentTypes) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_MultiTenant') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_MultiTenant (tenant_type) VALUES (?)');
    for (const value of multiTenantTypes) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_databaseVersions') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_databaseVersions (database_version) VALUES (?)');
    for (const value of databaseVersions) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_primaryUse') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_primaryUse (primary_use) VALUES (?)');
    for (const value of primaryUses) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_virtualizationTypes') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_virtualizationTypes (virt_type) VALUES (?)');
    for (const value of virtualizationTypes) {
      statement.run(value);
    }
  }

  if (countRows(database, 'int_core_factor') === 0) {
    const statement = database.prepare('INSERT OR IGNORE INTO int_core_factor (cpu_model, core_factor) VALUES (?, ?)');
    for (const item of coreFactors) {
      statement.run(item.cpuModel, item.coreFactor);
    }
  }

  if (countRows(database, 'int_LicenseProducts') === 0) {
    const statement = database.prepare(
      'INSERT OR IGNORE INTO int_LicenseProducts (product, only_enterprise, type, License_Product, oracle_feature_names) VALUES (?, ?, ?, ?, ?)'
    );

    for (const item of licenseProducts) {
      statement.run(item.product, item.onlyEnterprise, item.type, item.licenseProduct, item.oracleFeatureNames);
    }
  }

  // Spatial and Graph is included with Oracle Database since Dec 5, 2019 —
  // remove it from existing databases so it is no longer treated as a
  // separately licensed feature.
  database.prepare("DELETE FROM int_LicenseProducts WHERE product = 'Spatial and Graph'").run();
}