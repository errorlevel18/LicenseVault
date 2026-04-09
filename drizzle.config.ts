import type { Config } from 'drizzle-kit';
import * as path from 'path';

export default {
  schema: './shared/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/oralicensemgr.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;