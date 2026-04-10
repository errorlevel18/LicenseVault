import Database from 'better-sqlite3';
import logger from './utils/logger.js';

interface ColumnDefinition {
  name: string;
  sql: string;
}

function columnExists(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumns(database: Database.Database, tableName: string, columns: ColumnDefinition[]): void {
  for (const column of columns) {
    if (columnExists(database, tableName, column.name)) {
      continue;
    }

    logger.warn(`Adding missing column ${tableName}.${column.name} to SQLite database`);
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.sql}`);
  }
}

export function applySchemaCompatibilityFixes(database: Database.Database): void {
  ensureColumns(database, 'environments', [
    { name: 'description', sql: 'description TEXT' },
    { name: 'status', sql: "status TEXT DEFAULT 'active'" },
    { name: 'licensable', sql: 'licensable INTEGER DEFAULT 1' },
    { name: 'options', sql: 'options TEXT' },
    { name: 'management_packs', sql: 'management_packs TEXT' },
  ]);

  ensureColumns(database, 'feature_stats', [
    { name: 'status', sql: "status TEXT DEFAULT 'Not Licensed'" },
  ]);

  ensureColumns(database, 'int_LicenseProducts', [
    { name: 'oracle_feature_names', sql: 'oracle_feature_names TEXT' },
  ]);
}