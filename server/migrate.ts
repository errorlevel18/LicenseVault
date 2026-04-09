#!/usr/bin/env tsx
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const DB_PATH = path.join(__dirname, '../data/oralicensemgr.db');
const MIGRATIONS_FOLDER = path.join(__dirname, '../drizzle');

console.log(`Migrating database at: ${DB_PATH}`);
console.log(`Using migrations from: ${MIGRATIONS_FOLDER}`);

// Create database connection
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

async function main() {
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('✅ Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}

void main();
