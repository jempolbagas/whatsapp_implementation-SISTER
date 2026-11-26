import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.includes('USER:PASSWORD@ep-xxx')) {
  console.error(
    'DATABASE_URL is missing or still a placeholder. Copy .env.example to .env and set your Neon URL.',
  );
  process.exit(1);
}

const { Pool } = pg;
const requiresSsl = /sslmode=require|neon\.tech/i.test(databaseUrl);

function makePool() {
  return new Pool({
    connectionString: databaseUrl,
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
  });
}

// 1. Neon TLS + cold-start latency + 5-node concurrent pool check (4 App Servers + 1 Backup PC)
const t0 = performance.now();
const singlePool = makePool();
try {
  const res = await singlePool.query('SELECT NOW() AS cloud_time');
  const elapsedMs = Math.round(performance.now() - t0);
  console.log(`[Neon] Connected in ${elapsedMs} ms. Cloud time: ${res.rows[0].cloud_time}`);
} finally {
  await singlePool.end();
}

const concurrentPools = Array.from({ length: 5 }, () => makePool());
try {
  const t1 = performance.now();
  const results = await Promise.all(
    concurrentPools.map((pool, i) =>
      pool.query('SELECT NOW() AS cloud_time').then((r) => ({ node: i + 1, time: r.rows[0].cloud_time })),
    ),
  );
  const elapsedMs = Math.round(performance.now() - t1);
  console.log(`[Neon] 5 concurrent pools (max:3 each) queried in ${elapsedMs} ms:`, results.length);
} finally {
  await Promise.all(concurrentPools.map((p) => p.end()));
}

// 2. Backup PC over shared mobile hotspot check
const backupPcUrl = process.env.BACKUP_PC_URL;
const backupApiKey = process.env.BACKUP_API_KEY;
if (!backupPcUrl || !backupApiKey) {
  console.log('[Hotspot] Skipped Backup PC check (set BACKUP_PC_URL and BACKUP_API_KEY in .env).');
  process.exit(0);
}

const healthUrl = `${backupPcUrl.replace(/\/+$/, '')}/health`;
try {
  const unauth = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
  if (unauth.status !== 401) {
    throw new Error(`Expected 401 without x-backup-key, got ${unauth.status}`);
  }
  const auth = await fetch(healthUrl, {
    headers: { 'x-backup-key': backupApiKey },
    signal: AbortSignal.timeout(5000),
  });
  const body = await auth.json();
  if (!auth.ok || !body.dbReachable) {
    throw new Error(`Backup PC /health failed (${auth.status}): ${JSON.stringify(body)}`);
  }
  console.log(`[Hotspot] Backup PC reachable at ${healthUrl}:`, body);
} catch (err) {
  console.error(`[Hotspot] Failed to reach ${healthUrl}:`, err instanceof Error ? err.message : err);
  console.error(
    'Hint: Verify Backup PC is running (npm run dev:backup), hotspot AP/client isolation is off, and inbound TCP port 4000 is allowed in Firewall.',
  );
  process.exit(1);
}
