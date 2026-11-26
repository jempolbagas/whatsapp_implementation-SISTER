import assert from 'node:assert/strict';
import test from 'node:test';
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
