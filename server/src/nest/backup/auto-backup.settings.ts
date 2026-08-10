import path from 'node:path';
import fs from 'node:fs';
import { logInfo, logError } from '../audit/audit-log.logger';

/**
 * Auto-backup settings and retention — the pure half of the auto-backup cron
 * (moved from src/scheduler.ts). Stays a plain module beside backup.impl.ts
 * for the same reason that does: file I/O against data/backup-settings.json
 * and data/backups, no container state. AutoBackupJob owns the scheduling.
 */

const dataDir = path.join(__dirname, '../../../data');
const backupsDir = path.join(dataDir, 'backups');
const settingsFile = path.join(dataDir, 'backup-settings.json');

export const VALID_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly'];
const VALID_DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]); // 0=Sunday
const VALID_HOURS = new Set(Array.from({ length: 24 }, (_, i) => i));

export interface BackupSettings {
  enabled: boolean;
  interval: string;
  keep_days: number;
  hour: number;
  day_of_week: number;
  day_of_month: number;
}

export function buildCronExpression(settings: BackupSettings): string {
  const hour = VALID_HOURS.has(settings.hour) ? settings.hour : 2;
  const dow = VALID_DAYS_OF_WEEK.has(settings.day_of_week) ? settings.day_of_week : 0;
  const dom = settings.day_of_month >= 1 && settings.day_of_month <= 28 ? settings.day_of_month : 1;

  switch (settings.interval) {
    case 'hourly':  return '0 * * * *';
    case 'daily':   return `0 ${hour} * * *`;
    case 'weekly':  return `0 ${hour} * * ${dow}`;
    case 'monthly': return `0 ${hour} ${dom} * *`;
    default:        return `0 ${hour} * * *`;
  }
}

function getDefaults(): BackupSettings {
  return { enabled: false, interval: 'daily', keep_days: 7, hour: 2, day_of_week: 0, day_of_month: 1 };
}

export function loadSettings(): BackupSettings {
  let settings = getDefaults();
  try {
    if (fs.existsSync(settingsFile)) {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      settings = { ...settings, ...saved };
    }
  } catch {
    /* corrupt settings file — fall back to the defaults */
  }
  return settings;
}

export function saveSettings(settings: BackupSettings): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function autoBackupTimestampMs(filename: string): number | null {
  // auto-backup-2026-04-27T00-00-00.zip → 2026-04-27T00:00:00
  const stamp = filename.slice('auto-backup-'.length, -'.zip'.length);
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function cleanupOldBackups(keepDays: number, now: number = Date.now()): void {
  try {
    const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('auto-backup-') && f.endsWith('.zip'));
    for (const file of files) {
      const filePath = path.join(backupsDir, file);
      const ageMs = autoBackupTimestampMs(file) ?? fs.statSync(filePath).mtimeMs;
      if (ageMs < cutoff) {
        fs.unlinkSync(filePath);
        logInfo(`Auto-Backup old backup deleted: ${file}`);
      }
    }
  } catch (err: unknown) {
    logError(`Auto-Backup cleanup: ${err instanceof Error ? err.message : err}`);
  }
}
