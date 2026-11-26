import { loadEnv } from '@wa-sister/shared';

loadEnv();

const backupApiKey = process.env.BACKUP_API_KEY || '';
if (!backupApiKey) {
  console.error('BACKUP_API_KEY is required in .env');
  process.exit(1);
}

const baseUrl = (
  process.env.BACKUP_PC_URL || `http://127.0.0.1:${process.env.BACKUP_SERVER_PORT || 4000}`
).replace(/\/+$/, '');

const [cmd, arg] = process.argv.slice(2);

async function callBackup(method: 'GET' | 'POST', endpoint: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'x-backup-key': backupApiKey,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({ error: 'Invalid JSON response' }));
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exit(1);
}

switch (cmd) {
  case 'health':
    await callBackup('GET', '/health');
    break;
  case 'full':
    await callBackup('POST', '/backup/full', {});
    break;
  case 'list':
    await callBackup('GET', '/backups');
    break;
  case 'restore':
    if (!arg) {
      console.error('Usage: npm run backup:restore -- <filename>');
      process.exit(1);
    }
    await callBackup('POST', '/restore/full', { filename: arg });
    break;
  default:
    console.error('Usage: cli <health|full|list|restore <filename>>');
    process.exit(1);
}
