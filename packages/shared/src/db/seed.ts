import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/crypto.js';
import { createDb, loadEnv } from './client.js';
import { users } from './schema.js';

export const PRE_SEEDED_USERS = [
  { username: 'bagas', email: 'bagas@student.uns.ac.id' },
  { username: 'yasmin', email: 'yasmin@student.uns.ac.id' },
  { username: 'fathoni', email: 'fathoni@student.uns.ac.id' },
  { username: 'allia', email: 'allia@student.uns.ac.id' },
  { username: 'allysa', email: 'allysa@student.uns.ac.id' },
  { username: 'lia', email: 'lia@student.uns.ac.id' },
] as const;

async function main() {
  loadEnv();
  const password = process.env.SEED_DEFAULT_PASSWORD || 'SisterDemo2026!';
  const { db, pool } = createDb();

  try {
    const values = PRE_SEEDED_USERS.map((u) => ({
      username: u.username,
      email: u.email,
      passwordHash: hashPassword(password),
    }));

    const inserted = await db
      .insert(users)
      .values(values)
      .onConflictDoNothing({ target: users.username })
      .returning({ id: users.id, username: users.username });

    const all = await db.select({ id: users.id, username: users.username }).from(users);
    console.log(`Seeded ${inserted.length} new user(s). Total users in DB: ${all.length}.`);
  } finally {
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((err) => {
    console.error('Database seed failed:', err);
    process.exitCode = 1;
  });
}
