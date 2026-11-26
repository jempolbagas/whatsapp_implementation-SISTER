import path from 'node:path';

const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function buildSafeBackupFilename(
  scope: 'user' | 'full',
  label: string,
  cloudIsoTimestamp: string,
): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTs = cloudIsoTimestamp.replace(WINDOWS_FORBIDDEN_CHARS, '-').replace(/\./g, '-');
  return `backup_${scope}_${safeLabel}_${safeTs}.json`;
}

export function assertWindowsAndLinuxSafeFilename(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (WINDOWS_FORBIDDEN_CHARS.test(name)) {
    WINDOWS_FORBIDDEN_CHARS.lastIndex = 0;
    return false;
  }
  WINDOWS_FORBIDDEN_CHARS.lastIndex = 0;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  if (path.basename(name) !== name) return false;
  return true;
}
