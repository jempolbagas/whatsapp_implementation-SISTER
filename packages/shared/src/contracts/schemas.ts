import { z } from 'zod';
import { sha256Hex } from '../lib/crypto.js';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(128),
});

export const sendMessageSchema = z.object({
  recipientId: z.number().int().positive(),
  body: z.string().trim().min(1).max(4000),
  senderId: z.number().int().positive().optional(),
  clientTimestamp: z.string().optional(),
});

export const requestBackupSchema = z.object({
  targetUserId: z.number().int().positive().optional(),
});

export const backupUserSchema = z.object({
  userId: z.number().int().positive(),
});

export const restoreFullSchema = z.object({
  filename: z.string().min(1),
});

export const backupUserRecordSchema = z
  .object({
    id: z.number().int().positive(),
    username: z.string().min(1),
    email: z.string().min(1),
    passwordHash: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const backupMessageRecordSchema = z
  .object({
    id: z.number().int().positive(),
    senderId: z.number().int().positive(),
    recipientId: z.number().int().positive(),
    body: z.string(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const backupEnvelopeSchema = z.object({
  version: z.number().int().positive(),
  scope: z.enum(['user', 'full']),
  userId: z.number().int().positive().nullable(),
  cloudTimestamp: z.string().datetime({ offset: true }),
  counts: z.object({
    users: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }),
  data: z
    .object({
      users: z.array(backupUserRecordSchema),
      messages: z.array(backupMessageRecordSchema),
    })
    .strict(),
  checksumSha256: z.string().min(1),
});

export interface BackupUserRecord {
  id: number;
  username: string;
  email: string;
  passwordHash?: string;
  createdAt: string;
}

export interface BackupMessageRecord {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  createdAt: string;
}

export interface BackupPayload {
  version: number;
  scope: 'user' | 'full';
  userId: number | null;
  cloudTimestamp: string;
  counts: {
    users: number;
    messages: number;
  };
  data: {
    users: BackupUserRecord[];
    messages: BackupMessageRecord[];
  };
}

export interface BackupEnvelope extends BackupPayload {
  checksumSha256: string;
}

export function computeBackupChecksum(cloudTimestamp: string, data: BackupPayload['data']): string {
  return sha256Hex(JSON.stringify({ cloudTimestamp, data }));
}
