import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../shared/schema.js';
import logger from './utils/logger.js';

// Set the database file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../data/oralicensemgr.db');
logger.info(`SQLite database path: ${DB_PATH}`);

// Ensure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '../server/schema.sql'),
  ];

  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Schema file not found. Checked: ${candidates.join(', ')}`);
  }

  return schemaPath;
}

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;

  return Boolean(row?.name);
}

function initializeSchemaIfNeeded(database: Database.Database): void {
  if (tableExists(database, 'customers')) {
    return;
  }

  const schemaPath = resolveSchemaPath();
  logger.warn(`SQLite schema missing. Bootstrapping database from ${schemaPath}`);

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  database.exec(schemaSql);

  logger.info('SQLite schema bootstrapped successfully');
}

function warnIfNoActiveAdminUser(database: Database.Database): void {
  if (!tableExists(database, 'customers')) {
    return;
  }

  try {
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM customers WHERE role = ? AND active = 1')
      .get('admin') as { count: number } | undefined;

    if (!row?.count) {
      logger.warn('No active admin user found in SQLite database. Run npm run admin:reset -- --password <value> to create one.');
    }
  } catch (error) {
    logger.warn({ error }, 'Unable to verify admin user presence');
  }
}

// Create a verbose function compatible with better-sqlite3's requirements
const verboseLogger = (message?: unknown) => {
  if (typeof message === 'string') {
    logger.info(message);
  }
};

// Create SQLite database connection
const sqlite = new Database(DB_PATH, { 
  verbose: process.env.NODE_ENV === 'development' ? verboseLogger : undefined 
});

initializeSchemaIfNeeded(sqlite);
warnIfNoActiveAdminUser(sqlite);

// Create the Drizzle ORM database object
const db = drizzle(sqlite, { schema });

logger.info(`SQLite database initialized at ${DB_PATH} with Drizzle ORM`);

// Export the Drizzle database object
export default db;

// Export a function to access the raw SQLite connection for direct SQL operations
// This is used by the legacy DbUtils class
export const getBetterSqlite3Database = () => sqlite;