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
