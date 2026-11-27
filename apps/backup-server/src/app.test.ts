import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  assertWindowsAndLinuxSafeFilename,
  hashPassword,
  messages,
  PRE_SEEDED_USERS,
  SCHEMA_DDL,
  users,
  verifyPassword,
} from '@wa-sister/shared';
import type { BackupEnvelope, CloudDb } from '@wa-sister/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { createBackupServer } from './app.js';

const BACKUP_KEY = 'test-backup-key';

describe('backup-server integration', () => {
  let pglite: PGlite;
  let db: CloudDb;
  let backupDir: string;
  let backupApp: ReturnType<typeof createBackupServer>;

  before(async () => {
    pglite = new PGlite();
    await pglite.exec(SCHEMA_DDL);
    db = drizzle(pglite) as unknown as CloudDb;
    backupDir = await mkdtemp(path.join(os.tmpdir(), 'wa-sister-backup-'));
    backupApp = createBackupServer({ backupDir, db, backupApiKey: BACKUP_KEY });

    const passwordHash = hashPassword('SisterDemo2026!');
    await db
      .insert(users)
      .values(PRE_SEEDED_USERS.map((u) => ({ username: u.username, email: u.email, passwordHash })));

    await db.insert(messages).values([
      { senderId: 1, recipientId: 2, body: 'bagas -> yasmin' },
      { senderId: 2, recipientId: 1, body: 'yasmin -> bagas' },
      { senderId: 3, recipientId: 4, body: 'fathoni -> allia (private)' },
    ]);
  });

  after(async () => {
    await pglite.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  it('rejects missing (401) or wrong (403) x-backup-key and reports healthy (200)', async () => {
    const noKey = await backupApp.request('/health');
    assert.equal(noKey.status, 401);

    const badKey = await backupApp.request('/health', {
      headers: { 'x-backup-key': 'wrong-key' },
    });
    assert.equal(badKey.status, 403);

    const ok = await backupApp.request('/health', {
      headers: { 'x-backup-key': BACKUP_KEY },
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { backupDirWritable: boolean; dbReachable: boolean };
    assert.equal(body.backupDirWritable, true);
    assert.equal(body.dbReachable, true);
  });

  it('creates isolated user-scoped backup without passwordHash or third-party chats', async () => {
    const res = await backupApp.request('/backup/user', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ userId: 1 }),
    });
    assert.equal(res.status, 201);
    const meta = (await res.json()) as { filename: string; counts: { users: number; messages: number } };
    assert.equal(assertWindowsAndLinuxSafeFilename(meta.filename), true);
    assert.deepEqual(meta.counts, { users: 1, messages: 2 });

    const raw = await readFile(path.join(backupDir, meta.filename), 'utf8');
    const envelope = JSON.parse(raw) as BackupEnvelope;
    assert.equal(envelope.scope, 'user');
    assert.equal('passwordHash' in envelope.data.users[0], false);
    assert.equal(
      envelope.data.messages.some((m) => m.body.includes('private')),
      false,
    );

    // Reject restoring user-scoped snapshot via /restore/full
    const wrongScope = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename: meta.filename }),
    });
    assert.equal(wrongScope.status, 400);
  });

  it('rejects path traversal (400), missing file (404), and tampered checksum (422)', async () => {
    const traversal = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename: '../evil.json' }),
    });
    assert.equal(traversal.status, 400);

    const missing = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename: 'does-not-exist.json' }),
    });
    assert.equal(missing.status, 404);

    const fullRes = await backupApp.request('/backup/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({}),
    });
    assert.equal(fullRes.status, 201);
    const { filename } = (await fullRes.json()) as { filename: string };

    // Tamper 1 message character
    const fullPath = path.join(backupDir, filename);
    const tampered = JSON.parse(await readFile(fullPath, 'utf8')) as BackupEnvelope;
    tampered.data.messages[0].body = 'TAMPERED';
    await writeFile(fullPath, JSON.stringify(tampered), 'utf8');

    const tamperRes = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename }),
    });
    assert.equal(tamperRes.status, 422);
  });

  it('performs idempotent full backup, wipe, restore, and sequence reset', async () => {
    const fullRes = await backupApp.request('/backup/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({}),
    });
    assert.equal(fullRes.status, 201);
    const { filename } = (await fullRes.json()) as { filename: string };

    const listRes = await backupApp.request('/backups', {
      headers: { 'x-backup-key': BACKUP_KEY },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as { backups: Array<{ filename: string }> };
    assert.equal(listBody.backups.some((b) => b.filename === filename), true);

    // Simulate Neon wipe
    await pglite.exec('TRUNCATE TABLE backup_logs, messages, users RESTART IDENTITY CASCADE');

    const restore1 = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename }),
    });
    assert.equal(restore1.status, 200);
    const r1Body = (await restore1.json()) as {
      restoredUsers: number;
      restoredMessages: number;
      currentUsersCount: number;
      currentMessagesCount: number;
    };
    assert.equal(r1Body.restoredUsers, 6);
    assert.equal(r1Body.restoredMessages, 3);
    assert.equal(r1Body.currentUsersCount, 6);
    assert.equal(r1Body.currentMessagesCount, 3);

    // Idempotent second restore inserts 0 duplicates
    const restore2 = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename }),
    });
    assert.equal(restore2.status, 200);
    const r2Body = (await restore2.json()) as { restoredUsers: number; restoredMessages: number };
    assert.equal(r2Body.restoredUsers, 0);
    assert.equal(r2Body.restoredMessages, 0);

    // Post-restore insert succeeds at id = 4 (proving setval() reset sequence)
    const [postRestoreMsg] = await db
      .insert(messages)
      .values({ senderId: 1, recipientId: 2, body: 'post-restore message' })
      .returning({ id: messages.id });
    assert.equal(postRestoreMsg.id, 4);

    // Post-restore user login password hash verifies
    const [restoredBagas] = await db.select().from(users).where(eq(users.username, 'bagas')).limit(1);
    assert.ok(restoredBagas);
    assert.equal(verifyPassword('SisterDemo2026!', restoredBagas.passwordHash), true);
    assert.equal(verifyPassword('wrong-password', restoredBagas.passwordHash), false);
  });

  it('rejects malformed JSON and invalid envelope shape in /restore/full with 422 JSON', async () => {
    await writeFile(path.join(backupDir, 'bad-json.json'), '{not valid json', 'utf8');
    const badJsonRes = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename: 'bad-json.json' }),
    });
    assert.equal(badJsonRes.status, 422);
    assert.match(badJsonRes.headers.get('content-type') ?? '', /application\/json/);

    await writeFile(
      path.join(backupDir, 'bad-shape.json'),
      JSON.stringify({ scope: 'full', data: 'bad' }),
      'utf8',
    );
    const badShapeRes = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename: 'bad-shape.json' }),
    });
    assert.equal(badShapeRes.status, 422);
    const badShapeBody = (await badShapeRes.json()) as { error: string };
    assert.equal(badShapeBody.error, 'Invalid backup envelope structure');
  });

  it('restores a full backup with empty messages cleanly and resets sequence to 1', async () => {
    await pglite.exec('TRUNCATE TABLE messages RESTART IDENTITY CASCADE');

    const emptyMsgBackupRes = await backupApp.request('/backup/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({}),
    });
    assert.equal(emptyMsgBackupRes.status, 201);
    const { filename } = (await emptyMsgBackupRes.json()) as { filename: string };

    await pglite.exec('TRUNCATE TABLE backup_logs, messages, users RESTART IDENTITY CASCADE');

    const restoreRes = await backupApp.request('/restore/full', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-backup-key': BACKUP_KEY },
      body: JSON.stringify({ filename }),
    });
    assert.equal(restoreRes.status, 200);
    const restoreBody = (await restoreRes.json()) as {
      restoredUsers: number;
      restoredMessages: number;
      currentUsersCount: number;
      currentMessagesCount: number;
    };
    assert.equal(restoreBody.restoredUsers, 6);
    assert.equal(restoreBody.restoredMessages, 0);
    assert.equal(restoreBody.currentUsersCount, 6);
    assert.equal(restoreBody.currentMessagesCount, 0);

    const [restoredBagas] = await db.select().from(users).where(eq(users.username, 'bagas')).limit(1);
    assert.ok(restoredBagas);
    assert.equal(verifyPassword('SisterDemo2026!', restoredBagas.passwordHash), true);

    const [firstMsg] = await db
      .insert(messages)
      .values({ senderId: 1, recipientId: 2, body: 'first after empty restore' })
      .returning({ id: messages.id });
    assert.equal(firstMsg.id, 1);
  });

  it('returns 503 JSON on DB outages and 500 JSON on unexpected errors', async () => {
    const makeFailingDb = (err: Error) =>
      ({
        select: () => ({
          from: () => ({
            orderBy: async () => {
              throw err;
            },
          }),
        }),
      }) as unknown as CloudDb;

    const outageApp = createBackupServer({
      backupDir,
      db: makeFailingDb(
        new Error('Failed query: select * from users', {
          cause: new AggregateError([
            Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
              code: 'ECONNREFUSED',
            }),
          ]),
        }),
      ),
      backupApiKey: BACKUP_KEY,
    });

    const outageRes = await outageApp.request('/backup/full', {
      method: 'POST',
      headers: { 'x-backup-key': BACKUP_KEY },
    });
    assert.equal(outageRes.status, 503);
    assert.match(outageRes.headers.get('content-type') ?? '', /application\/json/);
    const outageBody = (await outageRes.json()) as { code: string };
    assert.equal(outageBody.code, 'DB_UNAVAILABLE');

    const errorApp = createBackupServer({
      backupDir,
      db: makeFailingDb(new Error('Unexpected failure')),
      backupApiKey: BACKUP_KEY,
    });

    const errorRes = await errorApp.request('/backup/full', {
      method: 'POST',
      headers: { 'x-backup-key': BACKUP_KEY },
    });
    assert.equal(errorRes.status, 500);
    assert.match(errorRes.headers.get('content-type') ?? '', /application\/json/);
    const errorBody = (await errorRes.json()) as { error: string };
    assert.equal(errorBody.error, 'Internal server error');
  });
});
