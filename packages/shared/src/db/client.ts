import { existsSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
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

  pool.on('error', (err) => {
    console.error('Idle DB pool error:', err.message);
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

const DB_CONN_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
]);

const DB_CONN_ERROR_MSG_RE =
  /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|57P01)\b|Connection terminated|timeout exceeded when trying to connect/i;

export function isDbConnectionError(err: unknown): boolean {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur == null || seen.has(cur)) continue;
    seen.add(cur);

    if (typeof cur === 'string') {
      if (DB_CONN_ERROR_MSG_RE.test(cur)) return true;
      continue;
    }

    if (typeof cur !== 'object') continue;

    const record = cur as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };

    if (typeof record.code === 'string' && DB_CONN_ERROR_CODES.has(record.code)) {
      return true;
    }
    if (typeof record.message === 'string' && DB_CONN_ERROR_MSG_RE.test(record.message)) {
      return true;
    }

    if (record.cause !== undefined) {
      queue.push(record.cause);
    }
    if (Array.isArray(record.errors)) {
      for (const nested of record.errors) {
        queue.push(nested);
      }
    }
  }

  return false;
}

export type CloudDb = ReturnType<typeof createDb>['db'];

export async function getCloudTime(db: Pick<CloudDb, 'execute'>): Promise<Date> {
  const result = await db.execute(sql`SELECT NOW() AS cloud_time`);
  const rows = (result as unknown as { rows: Array<{ cloud_time: Date | string }> }).rows;
  const raw = rows[0]?.cloud_time;
  if (!raw) throw new Error('Failed to fetch cloud DB time');
  return raw instanceof Date ? raw : new Date(raw);
}
