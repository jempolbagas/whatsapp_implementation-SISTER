import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, loadEnv } from './client.js';

async function main() {
  loadEnv();
  const { pool } = createDb();
  try {
    await pool.query('TRUNCATE TABLE backup_logs, messages, users RESTART IDENTITY CASCADE');
    console.log('Database wiped cleanly (backup_logs, messages, users truncated).');
  } finally {
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((err) => {
    console.error('Database wipe failed:', err);
    process.exitCode = 1;
  });
}
