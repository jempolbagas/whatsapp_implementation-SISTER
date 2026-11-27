import {
  getCloudTime,
  isDbConnectionError,
  loginSchema,
  messages,
  requestBackupSchema,
  sendMessageSchema,
  users,
  verifyPassword,
} from '@wa-sister/shared';
import type { CloudDb } from '@wa-sister/shared';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type AppEnv = {
  Variables: {
    authUserId: number;
  };
};

export interface AppServerOptions {
  nodeName: string;
  clockSkewMs: number;
  db: CloudDb;
  backupServerUrl: string;
  jwtSecret: string;
  backupApiKey: string;
  clientOrigin?: string;
  fetchImpl?: typeof fetch;
}

const safeUserColumns = {
  id: users.id,
  username: users.username,
  email: users.email,
  createdAt: users.createdAt,
};

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function createAppServer(opts: AppServerOptions) {
  const app = new Hono<AppEnv>();
  const fetchFn = opts.fetchImpl ?? fetch;
  const allowedOrigins = Array.from(
    new Set([opts.clientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean)),
  ) as string[];

  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.onError((err, c) => {
    if (isDbConnectionError(err)) {
      return c.json({ error: 'Cloud database unavailable', code: 'DB_UNAVAILABLE' }, 503);
    }
    return c.json({ error: 'Internal server error' }, 500);
  });

  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const payload = await verify(token, opts.jwtSecret, 'HS256');
      const sub = Number(payload.sub);
      if (!Number.isInteger(sub) || sub <= 0) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      c.set('authUserId', sub);
      await next();
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  };

  app.get('/health', async (c) => {
    const now = Date.now();
    const rawSystemTime = new Date(now).toISOString();
    const localSystemTime = new Date(now + opts.clockSkewMs).toISOString();

    try {
      const cloudDbTime = (await getCloudTime(opts.db)).toISOString();
      return c.json({
        nodeName: opts.nodeName,
        localSystemTime,
        rawSystemTime,
        clockSkewMs: opts.clockSkewMs,
        cloudDbTime,
        dbReachable: true,
      });
    } catch {
      return c.json(
        {
          nodeName: opts.nodeName,
          localSystemTime,
          rawSystemTime,
          clockSkewMs: opts.clockSkewMs,
          cloudDbTime: null,
          dbReachable: false,
        },
        503,
      );
    }
  });

  app.post('/auth/login', async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid credentials payload', details: parsed.error.flatten() }, 400);
    }

    const { identifier, password } = parsed.data;
    const [user] = await opts.db
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return c.json({ error: 'Invalid username/email or password' }, 401);
    }

    const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
    const token = await sign(
      { sub: user.id, username: user.username, exp },
      opts.jwtSecret,
      'HS256',
    );

    return c.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  });

  app.use('/auth/me', requireAuth);
  app.use('/users', requireAuth);
  app.use('/messages', requireAuth);
  app.use('/conversations/*', requireAuth);
  app.use('/backups/*', requireAuth);

  app.get('/auth/me', async (c) => {
    const authUserId = c.get('authUserId');
    const [user] = await opts.db
      .select(safeUserColumns)
      .from(users)
      .where(eq(users.id, authUserId))
      .limit(1);

    if (!user) {
      return c.json(
        { error: 'User record missing (database unavailable or wiped)', code: 'USER_NOT_FOUND' },
        401,
      );
    }
    return c.json({ user });
  });

  app.get('/users', async (c) => {
    const rows = await opts.db.select(safeUserColumns).from(users).orderBy(asc(users.id));
    return c.json({ users: rows });
  });

  app.post('/messages', async (c) => {
    const authUserId = c.get('authUserId');
    const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid message payload', details: parsed.error.flatten() }, 400);
    }

    const { recipientId, body, senderId } = parsed.data;
    if (senderId !== undefined && senderId !== authUserId) {
      return c.json({ error: 'Forbidden: senderId spoofing rejected' }, 403);
    }
    if (recipientId === authUserId) {
      return c.json({ error: 'Cannot send a message to yourself' }, 400);
    }

    const foundUsers = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [authUserId, recipientId]));

    if (!foundUsers.some((u) => u.id === authUserId)) {
      return c.json(
        { error: 'User record missing (database unavailable or wiped)', code: 'USER_NOT_FOUND' },
        401,
      );
    }
    if (!foundUsers.some((u) => u.id === recipientId)) {
      return c.json({ error: 'Recipient not found', code: 'RECIPIENT_NOT_FOUND' }, 404);
    }

    // Ignore any clientTimestamp; Neon TIMESTAMPTZ DEFAULT NOW() is the sole clock authority.
    const [created] = await opts.db
      .insert(messages)
      .values({ senderId: authUserId, recipientId, body })
      .returning();

    return c.json({ message: created }, 201);
  });

  async function getConversation(userA: number, userB: number) {
    const [rows, cloudTime] = await Promise.all([
      opts.db
        .select()
        .from(messages)
        .where(
          or(
            and(eq(messages.senderId, userA), eq(messages.recipientId, userB)),
            and(eq(messages.senderId, userB), eq(messages.recipientId, userA)),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id)),
      getCloudTime(opts.db),
    ]);

    return { messages: rows, cloudDbTime: cloudTime.toISOString() };
  }

  app.get('/messages', async (c) => {
    const authUserId = c.get('authUserId');
    const asUserIdRaw = c.req.query('asUserId');
    if (asUserIdRaw !== undefined && Number(asUserIdRaw) !== authUserId) {
      return c.json({ error: 'Forbidden: cannot read messages as another user' }, 403);
    }

    const withUserId = parsePositiveInt(c.req.query('withUserId'));
    if (!withUserId) {
      return c.json({ error: 'Invalid withUserId' }, 400);
    }

    return c.json(await getConversation(authUserId, withUserId));
  });

  app.get('/conversations/:userA/:userB', async (c) => {
    const authUserId = c.get('authUserId');
    const userA = parsePositiveInt(c.req.param('userA'));
    const userB = parsePositiveInt(c.req.param('userB'));

    if (!userA || !userB) {
      return c.json({ error: 'Invalid user IDs' }, 400);
    }
    if (authUserId !== userA && authUserId !== userB) {
      return c.json({ error: 'Forbidden: cannot access another user conversation' }, 403);
    }

    return c.json(await getConversation(userA, userB));
  });

  app.post('/backups/request', async (c) => {
    const authUserId = c.get('authUserId');
    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = requestBackupSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return c.json({ error: 'Invalid backup request', details: parsed.error.flatten() }, 400);
    }

    if (parsed.data.targetUserId !== undefined && parsed.data.targetUserId !== authUserId) {
      return c.json({ error: 'Forbidden: cannot request backup for another user' }, 403);
    }

    const baseUrl = opts.backupServerUrl.replace(/\/+$/, '');
    try {
      const res = await fetchFn(`${baseUrl}/backup/user`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-backup-key': opts.backupApiKey,
        },
        body: JSON.stringify({ userId: authUserId }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({ error: 'Invalid backup server response' }));
      return c.json(data, res.status as ContentfulStatusCode);
    } catch {
      return c.json(
        { error: 'Backup storage node unreachable', code: 'BACKUP_UNREACHABLE' },
        502,
      );
    }
  });

  return app;
}
