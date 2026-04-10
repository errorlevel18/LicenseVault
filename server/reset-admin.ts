#!/usr/bin/env tsx
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getBetterSqlite3Database } from './database.js';

type UserRole = 'admin' | 'customer';

interface ResetAdminOptions {
  username: string;
  password: string;
  name: string;
  role: UserRole;
}

function parseArgs(argv: string[]): ResetAdminOptions {
  const options: Partial<ResetAdminOptions> = {
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
    password: process.env.ADMIN_PASSWORD,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (argument === '--username' && nextValue) {
      options.username = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--password' && nextValue) {
      options.password = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--name' && nextValue) {
      options.name = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--role' && nextValue) {
      if (nextValue !== 'admin' && nextValue !== 'customer') {
        throw new Error('Invalid role. Use admin or customer.');
      }

      options.role = nextValue;
      index += 1;
      continue;
    }
  }

  if (!options.password) {
    throw new Error('Password is required. Use --password <value> or set ADMIN_PASSWORD.');
  }

  return options as ResetAdminOptions;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sqlite = getBetterSqlite3Database();
  const passwordHash = await bcrypt.hash(options.password, 10);

  try {
    const existingUser = sqlite
      .prepare('SELECT id FROM customers WHERE username = ?')
      .get(options.username) as { id: string } | undefined;

    if (existingUser) {
      sqlite
        .prepare(
          `UPDATE customers
           SET name = ?, password = ?, role = ?, active = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(options.name, passwordHash, options.role, existingUser.id);

      console.log(`Updated user ${options.username}`);
    } else {
      sqlite
        .prepare(
          `INSERT INTO customers (id, name, username, password, role, active)
           VALUES (?, ?, ?, ?, ?, 1)`
        )
        .run(crypto.randomUUID(), options.name, options.username, passwordHash, options.role);

      console.log(`Created user ${options.username}`);
    }

    const userRecord = sqlite
      .prepare(
        'SELECT id, name, username, role, active, length(password) AS passwordLength FROM customers WHERE username = ?'
      )
      .get(options.username);

    console.log(userRecord);
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});