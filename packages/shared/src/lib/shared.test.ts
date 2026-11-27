import assert from 'node:assert/strict';
import test from 'node:test';
import { backupEnvelopeSchema, computeBackupChecksum } from '../contracts/schemas.js';
import { createDb, isDbConnectionError } from '../db/client.js';
import { hashPassword, safeKeyEqual, sha256Hex, verifyPassword } from './crypto.js';
import { assertWindowsAndLinuxSafeFilename, buildSafeBackupFilename } from './filenames.js';

test('hashPassword and verifyPassword validate matching and reject wrong passwords', () => {
  const hash = hashPassword('SisterDemo2026!');
  assert.equal(verifyPassword('SisterDemo2026!', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  assert.equal(verifyPassword('SisterDemo2026!', 'malformed'), false);
});

test('safeKeyEqual compares keys in constant time and rejects length mismatches', () => {
  assert.equal(safeKeyEqual('secret-123', 'secret-123'), true);
  assert.equal(safeKeyEqual('secret-123', 'secret-124'), false);
  assert.equal(safeKeyEqual('short', 'longer-key'), false);
});

test('sha256Hex returns 64-char hex digest', () => {
  const digest = sha256Hex('hello');
  assert.equal(digest.length, 64);
  assert.equal(digest, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('buildSafeBackupFilename strips Windows-forbidden characters and passes safety check', () => {
  const name = buildSafeBackupFilename('user', 'u1', '2026-11-27T03:30:00.123Z');
  assert.equal(name, 'backup_user_u1_2026-11-27T03-30-00-123Z.json');
  assert.equal(assertWindowsAndLinuxSafeFilename(name), true);
});

test('assertWindowsAndLinuxSafeFilename blocks traversal and illegal names', () => {
  assert.equal(assertWindowsAndLinuxSafeFilename('../evil.json'), false);
  assert.equal(assertWindowsAndLinuxSafeFilename('a/b.json'), false);
  assert.equal(assertWindowsAndLinuxSafeFilename('bad:name.json'), false);
  assert.equal(assertWindowsAndLinuxSafeFilename('..'), false);
  assert.equal(assertWindowsAndLinuxSafeFilename('trailing.'), false);
});

test('createDb attaches an idle error listener to the pg Pool', async () => {
  const { pool } = createDb('postgres://user:pass@127.0.0.1:5432/testdb');
  try {
    assert.equal(pool.listenerCount('error') >= 1, true);
  } finally {
    await pool.end();
  }
});

test('isDbConnectionError detects nested Drizzle/AggregateError outages without false positives', () => {
  const nestedConn = new Error('Failed query: SELECT 1', {
    cause: new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    ]),
  });
  assert.equal(isDbConnectionError(nestedConn), true);

  for (const code of ['ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', '57P01']) {
    const wrapped = new Error('Failed query', { cause: Object.assign(new Error('err'), { code }) });
    assert.equal(isDbConnectionError(wrapped), true);
  }

  assert.equal(isDbConnectionError(new Error('Connection terminated unexpectedly')), true);
  assert.equal(isDbConnectionError(new Error('timeout exceeded when trying to connect')), true);

  // Bare "connect" in unrelated errors must not trigger 503
  assert.equal(isDbConnectionError(new Error('Cannot connect UI widget')), false);

  // Circular cause must not loop infinitely
  const circular: Error & { cause?: unknown } = new Error('unrelated error');
  circular.cause = circular;
  assert.equal(isDbConnectionError(circular), false);
});

test('backupEnvelopeSchema validates valid envelopes and rejects malformed shapes', () => {
  const cloudTimestamp = '2026-11-27T04:00:00.000Z';
  const data = {
    users: [
      {
        id: 1,
        username: 'bagas',
        email: 'bagas@student.uns.ac.id',
        passwordHash: 'scrypt$salt$hash',
        createdAt: cloudTimestamp,
      },
    ],
    messages: [
      {
        id: 1,
        senderId: 1,
        recipientId: 2,
        body: 'hello',
        createdAt: cloudTimestamp,
      },
    ],
  };
  const valid = {
    version: 1,
    scope: 'full' as const,
    userId: null,
    cloudTimestamp,
    counts: { users: 1, messages: 1 },
    data,
    checksumSha256: computeBackupChecksum(cloudTimestamp, data),
  };

  assert.equal(backupEnvelopeSchema.safeParse(valid).success, true);
  assert.equal(backupEnvelopeSchema.safeParse({}).success, false);
  assert.equal(backupEnvelopeSchema.safeParse(null).success, false);
  assert.equal(
    backupEnvelopeSchema.safeParse({
      ...valid,
      data: { users: 'not-an-array', messages: [] },
    }).success,
    false,
  );
  assert.equal(
    backupEnvelopeSchema.safeParse({
      ...valid,
      data: {
        users: [{ ...data.users[0], createdAt: 'not-a-timestamp' }],
        messages: [],
      },
    }).success,
    false,
  );
});
