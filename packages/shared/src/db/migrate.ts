import { createDb, loadEnv } from './client.js';

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_pair_time
  ON messages (sender_id, recipient_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_sender_time
  ON messages (recipient_id, sender_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS backup_logs (
  id SERIAL PRIMARY KEY,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  filename TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function main() {
  loadEnv();
  const { pool } = createDb();
  try {
    await pool.query(DDL);
    console.log('Schema pushed successfully (users, messages, backup_logs).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Schema migration failed:', err);
  process.exitCode = 1;
});
