import { serve } from '@hono/node-server';
import { createDb, loadEnv } from '@wa-sister/shared';
import path from 'node:path';
import { createBackupServer } from './app.js';

loadEnv();

const backupApiKey = process.env.BACKUP_API_KEY || '';
if (!backupApiKey) {
  throw new Error('BACKUP_API_KEY is required');
}

const backupDir = path.resolve(process.env.BACKUP_DIR || './backups');
const host = process.env.BACKUP_SERVER_HOST || '0.0.0.0';
const port = Number(process.env.BACKUP_SERVER_PORT || 4000);
const { db } = createDb();

const app = createBackupServer({ backupDir, db, backupApiKey });

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Backup Storage Server listening on http://${info.address}:${info.port}`);
});
