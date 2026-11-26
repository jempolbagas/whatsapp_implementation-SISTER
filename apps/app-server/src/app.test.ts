import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  hashPassword,
  PRE_SEEDED_USERS,
  SCHEMA_DDL,
  users,
} from '@wa-sister/shared';
import type { CloudDb } from '@wa-sister/shared';
import { drizzle } from 'drizzle-orm/pglite';
import { createAppServer } from './app.js';

const JWT_SECRET = 'test-jwt-secret-key';
const BACKUP_API_KEY = 'test-backup-api-key';

async function seedUsers(db: CloudDb) {
  const passwordHash = hashPassword('SisterDemo2026!');
  await db
    .insert(users)
    .values(PRE_SEEDED_USERS.map((u) => ({ username: u.username, email: u.email, passwordHash })))
    .onConflictDoNothing({ target: users.username });
}

async function loginAs(app: ReturnType<typeof createAppServer>, identifier: string) {
  const res = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'SisterDemo2026!' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as {
    token: string;
    user: { id: number; username: string; email: string };
  };
}

describe('app-server integration', () => {
  let pglite: PGlite;
  let db: CloudDb;
  let serverA: ReturnType<typeof createAppServer>;
  let serverB: ReturnType<typeof createAppServer>;

  before(async () => {
    pglite = new PGlite();
    await pglite.exec(SCHEMA_DDL);
    db = drizzle(pglite) as unknown as CloudDb;
    await seedUsers(db);

    const mockBackupFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(String(input), 'http://backup.local:4000/backup/user');
      assert.equal(headers.get('x-backup-key'), BACKUP_API_KEY);
      const body = JSON.parse(String(init?.body)) as { userId: number };
      return new Response(
        JSON.stringify({
          filename: `backup_user_u${body.userId}_2026-11-27T04-00-00-000Z.json`,
          checksumSha256: 'a'.repeat(64),
          cloudTimestamp: '2026-11-27T04:00:00.000Z',
          counts: { users: 1, messages: 0 },
          bytes: 512,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    serverA = createAppServer({
      nodeName: 'laptop-bagas',
      clockSkewMs: 2 * 3600 * 1000, // +2h skew
      db,
      backupServerUrl: 'http://backup.local:4000',
      jwtSecret: JWT_SECRET,
      backupApiKey: BACKUP_API_KEY,
      fetchImpl: mockBackupFetch,
    });

    serverB = createAppServer({
      nodeName: 'laptop-yasmin',
      clockSkewMs: -3 * 3600 * 1000, // -3h skew
      db,
      backupServerUrl: 'http://backup.local:4000',
      jwtSecret: JWT_SECRET,
      backupApiKey: BACKUP_API_KEY,
      fetchImpl: mockBackupFetch,
    });
  });

  after(async () => {
    await pglite.close();
  });

  it('authenticates via username or email, rejects wrong password, and omits passwordHash', async () => {
    const bagas = await loginAs(serverA, 'bagas');
    assert.equal(bagas.user.username, 'bagas');
    assert.equal('passwordHash' in bagas.user, false);

    const yasmin = await loginAs(serverB, 'yasmin@student.uns.ac.id');
    assert.equal(yasmin.user.username, 'yasmin');

    const badPass = await serverA.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'bagas', password: 'wrong' }),
    });
    assert.equal(badPass.status, 401);

    const unauth = await serverA.request('/users');
    assert.equal(unauth.status, 401);

    const usersRes = await serverA.request('/users', {
      headers: { authorization: `Bearer ${bagas.token}` },
    });
    assert.equal(usersRes.status, 200);
    const usersBody = (await usersRes.json()) as { users: Array<Record<string, unknown>> };
    assert.equal(usersBody.users.length, 6);
    assert.equal(usersBody.users.every((u) => !('passwordHash' in u)), true);

    const meRes = await serverA.request('/auth/me', {
      headers: { authorization: `Bearer ${bagas.token}` },
    });
    assert.equal(meRes.status, 200);
  });

  it('enforces strict anti-IDOR 403 guards across messages, conversations, and backups', async () => {
    const bagas = await loginAs(serverA, 'bagas');
    const yasmin = await loginAs(serverB, 'yasmin');
    const fathoni = await loginAs(serverA, 'fathoni');

    // Spoofed senderId
    const spoofSend = await serverA.request('/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fathoni.token}`,
      },
      body: JSON.stringify({ recipientId: yasmin.user.id, senderId: bagas.user.id, body: 'hi' }),
    });
    assert.equal(spoofSend.status, 403);

    // Spoofed asUserId query param
    const spoofRead = await serverA.request(
      `/messages?withUserId=${yasmin.user.id}&asUserId=${bagas.user.id}`,
      { headers: { authorization: `Bearer ${fathoni.token}` } },
    );
    assert.equal(spoofRead.status, 403);

    // Unauthorized conversation route
    const spoofConv = await serverA.request(`/conversations/${bagas.user.id}/${yasmin.user.id}`, {
      headers: { authorization: `Bearer ${fathoni.token}` },
    });
    assert.equal(spoofConv.status, 403);

    // Unauthorized backup request for another user
    const spoofBackup = await serverA.request('/backups/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fathoni.token}`,
      },
      body: JSON.stringify({ targetUserId: bagas.user.id }),
    });
    assert.equal(spoofBackup.status, 403);
  });

  it('orders messages strictly by Cloud DB clock despite +2h/-3h skew and forged clientTimestamp', async () => {
    const bagas = await loginAs(serverA, 'bagas');
    const yasmin = await loginAs(serverB, 'yasmin');

    const healthA = await (await serverA.request('/health')).json();
    const healthB = await (await serverB.request('/health')).json();
    assert.notEqual(healthA.localSystemTime, healthB.localSystemTime);
    assert.equal(healthA.dbReachable, true);

    const payloads = [
      { srv: serverA, token: bagas.token, recipientId: yasmin.user.id, body: 'msg-1', ts: '2099-01-01T00:00:00Z' },
      { srv: serverB, token: yasmin.token, recipientId: bagas.user.id, body: 'msg-2', ts: '1999-01-01T00:00:00Z' },
      { srv: serverA, token: bagas.token, recipientId: yasmin.user.id, body: 'msg-3', ts: '2050-01-01T00:00:00Z' },
    ];

    for (const p of payloads) {
      const res = await p.srv.request('/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${p.token}`,
        },
        body: JSON.stringify({ recipientId: p.recipientId, body: p.body, clientTimestamp: p.ts }),
      });
      assert.equal(res.status, 201);
    }

    const threadRes = await serverB.request(`/messages?withUserId=${bagas.user.id}`, {
      headers: { authorization: `Bearer ${yasmin.token}` },
    });
    assert.equal(threadRes.status, 200);
    const thread = (await threadRes.json()) as { messages: Array<{ body: string }> };
    assert.deepEqual(
      thread.messages.map((m) => m.body),
      ['msg-1', 'msg-2', 'msg-3'],
    );
  });

  it('proxies authorized user backup and returns 502 when backup node is unreachable', async () => {
    const bagas = await loginAs(serverA, 'bagas');
    const res = await serverA.request('/backups/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bagas.token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { filename: string };
    assert.match(body.filename, /^backup_user_u1_/);

    const offlineServer = createAppServer({
      nodeName: 'offline-test',
      clockSkewMs: 0,
      db,
      backupServerUrl: 'http://backup.local:4000',
      jwtSecret: JWT_SECRET,
      backupApiKey: BACKUP_API_KEY,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const downRes = await offlineServer.request('/backups/request', {
      method: 'POST',
      headers: { authorization: `Bearer ${bagas.token}` },
    });
    assert.equal(downRes.status, 502);
  });

  it('returns clean 401 USER_NOT_FOUND when DB is wiped while JWT is still held', async () => {
    const bagas = await loginAs(serverA, 'bagas');
    const yasmin = await loginAs(serverB, 'yasmin');
    await pglite.exec('TRUNCATE TABLE backup_logs, messages, users RESTART IDENTITY CASCADE');

    const meRes = await serverA.request('/auth/me', {
      headers: { authorization: `Bearer ${bagas.token}` },
    });
    assert.equal(meRes.status, 401);
    const meBody = (await meRes.json()) as { code: string };
    assert.equal(meBody.code, 'USER_NOT_FOUND');

    const sendRes = await serverA.request('/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bagas.token}`,
      },
      body: JSON.stringify({ recipientId: yasmin.user.id, body: 'after wipe' }),
    });
    assert.equal(sendRes.status, 401);
  });
});
