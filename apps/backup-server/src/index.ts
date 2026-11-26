import { serve } from '@hono/node-server';
import { createDb, getCloudTime, loadEnv, safeKeyEqual } from '@wa-sister/shared';
import { Hono } from 'hono';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

loadEnv();

const backupApiKey = process.env.BACKUP_API_KEY || '';
if (!backupApiKey) {
  throw new Error('BACKUP_API_KEY is required');
}

const backupDir = path.resolve(process.env.BACKUP_DIR || './backups');
const host = process.env.BACKUP_SERVER_HOST || '0.0.0.0';
const port = Number(process.env.BACKUP_SERVER_PORT || 4000);
const { pool } = createDb();

const app = new Hono();

app.use('*', async (c, next) => {
  const provided = c.req.header('x-backup-key');
  if (!provided) {
    return c.json({ error: 'Unauthorized: missing x-backup-key' }, 401);
  }
  if (!safeKeyEqual(provided, backupApiKey)) {
    return c.json({ error: 'Forbidden: invalid x-backup-key' }, 403);
  }
  await next();
});

app.get('/health', async (c) => {
  let backupDirWritable = false;
  try {
    await mkdir(backupDir, { recursive: true });
    await access(backupDir, constants.W_OK);
    backupDirWritable = true;
  } catch {
    backupDirWritable = false;
  }

  let cloudDbTime: string | null = null;
  let dbReachable = false;
  try {
    cloudDbTime = (await getCloudTime(pool)).toISOString();
    dbReachable = true;
  } catch {
    dbReachable = false;
  }

  const ok = backupDirWritable && dbReachable;
  return c.json(
    {
      status: ok ? 'ok' : 'degraded',
      backupDir,
      backupDirWritable,
      cloudDbTime,
      dbReachable,
    },
    ok ? 200 : 503,
  );
});

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Backup Storage Server listening on http://${info.address}:${info.port}`);
});
