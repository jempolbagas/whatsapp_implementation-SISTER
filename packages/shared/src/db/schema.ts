import { index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    senderId: integer('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_messages_pair_time').on(t.senderId, t.recipientId, t.createdAt, t.id),
    index('idx_messages_recipient_sender_time').on(t.recipientId, t.senderId, t.createdAt, t.id),
  ],
);

export const backupLogs = pgTable('backup_logs', {
  id: serial('id').primaryKey(),
  requestedByUserId: integer('requested_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  scope: text('scope').notNull(),
  filename: text('filename').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  rowCount: integer('row_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
