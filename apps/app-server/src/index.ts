import { serve } from '@hono/node-server';
import { createDb, loadEnv } from '@wa-sister/shared';
import { createAppServer } from './app.js';

loadEnv();

const jwtSecret = process.env.JWT_SECRET || '';
const backupApiKey = process.env.BACKUP_API_KEY || '';
if (!jwtSecret) throw new Error('JWT_SECRET is required');
if (!backupApiKey) throw new Error('BACKUP_API_KEY is required');

const host = process.env.APP_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.APP_SERVER_PORT || 3001);
const nodeName = process.env.NODE_NAME || 'local-app-server';
const clockSkewMs = Number(process.env.CLOCK_SKEW_MS || 0);
const backupServerUrl = process.env.BACKUP_PC_URL || 'http://127.0.0.1:4000';
const clientOrigin = process.env.CLIENT_ORIGIN;

const { db } = createDb();
const app = createAppServer({
  nodeName,
  clockSkewMs: Number.isFinite(clockSkewMs) ? clockSkewMs : 0,
  db,
  backupServerUrl,
  jwtSecret,
  backupApiKey,
  clientOrigin,
});

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`App Server (${nodeName}) listening on http://${info.address}:${info.port}`);
});
