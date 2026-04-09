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

// Create the Drizzle ORM database object
const db = drizzle(sqlite, { schema });

logger.info(`SQLite database initialized at ${DB_PATH} with Drizzle ORM`);

// Export the Drizzle database object
export default db;

// Export a function to access the raw SQLite connection for direct SQL operations
// This is used by the legacy DbUtils class
export const getBetterSqlite3Database = () => sqlite;