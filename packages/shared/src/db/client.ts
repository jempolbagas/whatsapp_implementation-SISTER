import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export function loadEnv(): void {
  const cwd = process.cwd();
  for (const rel of ['.env', '../.env', '../../.env']) {
    const candidate = path.resolve(cwd, rel);
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure Neon.');
  }

  const requiresSsl = /sslmode=require|neon\.tech/i.test(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3, // Keep per-node pool small across 4 App Servers + 1 Backup PC
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export async function getCloudTime(pool: pg.Pool): Promise<Date> {
  const result = await pool.query<{ cloud_time: Date | string }>('SELECT NOW() AS cloud_time');
  const raw = result.rows[0]?.cloud_time;
  if (!raw) throw new Error('Failed to fetch cloud DB time');
  return raw instanceof Date ? raw : new Date(raw);
}
