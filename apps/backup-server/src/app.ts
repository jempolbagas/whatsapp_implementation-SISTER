import {
  assertWindowsAndLinuxSafeFilename,
  backupLogs,
  backupUserSchema,
  buildSafeBackupFilename,
  computeBackupChecksum,
  getCloudTime,
  messages,
  restoreFullSchema,
  safeKeyEqual,
  users,
} from '@wa-sister/shared';
import type { BackupEnvelope, BackupPayload, CloudDb } from '@wa-sister/shared';
import { asc, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface BackupServerOptions {
  backupDir: string;
  db: CloudDb;
  backupApiKey: string;
}

export function createBackupServer(opts: BackupServerOptions) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const provided = c.req.header('x-backup-key');
    if (!provided) {
      return c.json({ error: 'Unauthorized: missing x-backup-key' }, 401);
    }
    if (!safeKeyEqual(provided, opts.backupApiKey)) {
      return c.json({ error: 'Forbidden: invalid x-backup-key' }, 403);
    }
    await next();
  });

  app.get('/health', async (c) => {
    let backupDirWritable = false;
    try {
      await mkdir(opts.backupDir, { recursive: true });
      await access(opts.backupDir, constants.W_OK);
      backupDirWritable = true;
    } catch {
      backupDirWritable = false;
    }

    let cloudDbTime: string | null = null;
    let dbReachable = false;
    try {
      cloudDbTime = (await getCloudTime(opts.db)).toISOString();
      dbReachable = true;
    } catch {
      dbReachable = false;
    }

    const ok = backupDirWritable && dbReachable;
    return c.json(
      {
        status: ok ? 'ok' : 'degraded',
        backupDir: opts.backupDir,
        backupDirWritable,
        cloudDbTime,
        dbReachable,
      },
      ok ? 200 : 503,
    );
  });

  app.post('/backup/user', async (c) => {
    const parsed = backupUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid userId', details: parsed.error.flatten() }, 400);
    }

    const { userId } = parsed.data;
    const userRows = await opts.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (userRows.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    const [messageRows, cloudTime] = await Promise.all([
      opts.db
        .select()
        .from(messages)
        .where(or(eq(messages.senderId, userId), eq(messages.recipientId, userId)))
        .orderBy(asc(messages.id)),
      getCloudTime(opts.db),
    ]);

    const cloudTimestamp = cloudTime.toISOString();
    const payload: BackupPayload = {
      version: 1,
      scope: 'user',
      userId,
      cloudTimestamp,
      counts: { users: userRows.length, messages: messageRows.length },
      data: {
        users: userRows.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          createdAt: u.createdAt.toISOString(),
        })),
        messages: messageRows.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          recipientId: m.recipientId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    };

    const checksumSha256 = computeBackupChecksum(cloudTimestamp, payload.data);
    const envelope: BackupEnvelope = { ...payload, checksumSha256 };
    const filename = buildSafeBackupFilename('user', `u${userId}`, cloudTimestamp);

    await mkdir(opts.backupDir, { recursive: true });
    const serialized = JSON.stringify(envelope, null, 2);
    await writeFile(path.join(opts.backupDir, filename), serialized, 'utf8');

    await opts.db.insert(backupLogs).values({
      requestedByUserId: userId,
      scope: 'user',
      filename,
      checksumSha256,
      rowCount: userRows.length + messageRows.length,
    });

    return c.json(
      {
        filename,
        checksumSha256,
        cloudTimestamp,
        counts: payload.counts,
        bytes: Buffer.byteLength(serialized, 'utf8'),
      },
      201,
    );
  });

  app.post('/backup/full', async (c) => {
    const [userRows, messageRows, cloudTime] = await Promise.all([
      opts.db.select().from(users).orderBy(asc(users.id)),
      opts.db.select().from(messages).orderBy(asc(messages.id)),
      getCloudTime(opts.db),
    ]);

    const cloudTimestamp = cloudTime.toISOString();
    const payload: BackupPayload = {
      version: 1,
      scope: 'full',
      userId: null,
      cloudTimestamp,
      counts: { users: userRows.length, messages: messageRows.length },
      data: {
        users: userRows.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          passwordHash: u.passwordHash,
          createdAt: u.createdAt.toISOString(),
        })),
        messages: messageRows.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          recipientId: m.recipientId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    };

    const checksumSha256 = computeBackupChecksum(cloudTimestamp, payload.data);
    const envelope: BackupEnvelope = { ...payload, checksumSha256 };
    const filename = buildSafeBackupFilename('full', 'system', cloudTimestamp);

    await mkdir(opts.backupDir, { recursive: true });
    const serialized = JSON.stringify(envelope, null, 2);
    await writeFile(path.join(opts.backupDir, filename), serialized, 'utf8');

    await opts.db.insert(backupLogs).values({
      requestedByUserId: null,
      scope: 'full',
      filename,
      checksumSha256,
      rowCount: userRows.length + messageRows.length,
    });

    return c.json(
      {
        filename,
        checksumSha256,
        cloudTimestamp,
        counts: payload.counts,
        bytes: Buffer.byteLength(serialized, 'utf8'),
      },
      201,
    );
  });

  app.get('/backups', async (c) => {
    await mkdir(opts.backupDir, { recursive: true });
    const entries = await readdir(opts.backupDir);
    const jsonEntries = entries.filter((name) => name.endsWith('.json'));
    const files = await Promise.all(
      jsonEntries.map(async (name) => {
        const st = await stat(path.join(opts.backupDir, name));
        return {
          filename: name,
          bytes: st.size,
          modifiedAt: st.mtime.toISOString(),
        };
      }),
    );
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return c.json({ backups: files });
  });

  app.post('/restore/full', async (c) => {
    const parsed = restoreFullSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid restore payload', details: parsed.error.flatten() }, 400);
    }

    const { filename } = parsed.data;
    if (!assertWindowsAndLinuxSafeFilename(filename)) {
      return c.json({ error: 'Invalid filename: path traversal or unsafe name rejected' }, 400);
    }

    let raw: string;
    try {
      raw = await readFile(path.join(opts.backupDir, filename), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return c.json({ error: 'Backup file not found' }, 404);
      }
      throw err;
    }

    let envelope: BackupEnvelope;
    try {
      envelope = JSON.parse(raw) as BackupEnvelope;
    } catch {
      return c.json({ error: 'Malformed backup JSON' }, 422);
    }

    if (envelope.scope !== 'full') {
      return c.json({ error: 'Only full-scope snapshots can be used for /restore/full' }, 400);
    }

    if (!envelope.cloudTimestamp || !envelope.data || !envelope.checksumSha256) {
      return c.json({ error: 'Invalid backup envelope structure' }, 422);
    }

    const expectedChecksum = computeBackupChecksum(envelope.cloudTimestamp, envelope.data);
    if (!safeKeyEqual(expectedChecksum, envelope.checksumSha256)) {
      return c.json({ error: 'Checksum mismatch: backup file is tampered or corrupted' }, 422);
    }

    if (envelope.data.users.some((u) => !u.passwordHash)) {
      return c.json({ error: 'Full restore requires passwordHash for every user' }, 422);
    }

    let restoredUsers = 0;
    let restoredMessages = 0;

    await opts.db.transaction(async (tx) => {
      for (const u of envelope.data.users) {
        const inserted = await tx
          .insert(users)
          .values({
            id: u.id,
            username: u.username,
            email: u.email,
            passwordHash: u.passwordHash!,
            createdAt: new Date(u.createdAt),
          })
          .onConflictDoNothing({ target: users.id })
          .returning({ id: users.id });
        restoredUsers += inserted.length;
      }

      for (const m of envelope.data.messages) {
        const inserted = await tx
          .insert(messages)
          .values({
            id: m.id,
            senderId: m.senderId,
            recipientId: m.recipientId,
            body: m.body,
            createdAt: new Date(m.createdAt),
          })
          .onConflictDoNothing({ target: messages.id })
          .returning({ id: messages.id });
        restoredMessages += inserted.length;
      }

      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1), (SELECT MAX(id) IS NOT NULL FROM users))`,
      );
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence('messages', 'id'), COALESCE((SELECT MAX(id) FROM messages), 1), (SELECT MAX(id) IS NOT NULL FROM messages))`,
      );
    });

    const [allUsers, allMessages] = await Promise.all([
      opts.db.select({ id: users.id }).from(users),
      opts.db.select({ id: messages.id }).from(messages),
    ]);

    return c.json({
      restoredUsers,
      restoredMessages,
      currentUsersCount: allUsers.length,
      currentMessagesCount: allMessages.length,
    });
  });

  return app;
}
