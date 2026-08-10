/**
 * Auto-backup settings + retention (moved from tests/unit/scheduler.test.ts
 * when the code moved from src/scheduler.ts into the backup domain).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Prevent fs side effects (creating directories, reading files)
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtime: new Date(), size: 0 })),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(() => ({ on: vi.fn(), pipe: vi.fn() })),
  },
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtime: new Date(), size: 0 })),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(() => ({ on: vi.fn(), pipe: vi.fn() })),
}));
vi.mock('../../../src/nest/audit/audit-log.logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

import fs from 'node:fs';
import {
  buildCronExpression,
  cleanupOldBackups,
  loadSettings,
  saveSettings,
  type BackupSettings,
} from '../../../src/nest/backup/auto-backup.settings';

// readdirSync and statSync are overloaded in node:fs, and vi.mocked() picks the last
// overload (Dirent[] / BigIntStats) rather than the one the cleanup calls. These handles
// point at the very same mock functions from the factory above, pinned to the plain
// string[] / Stats signatures that cleanupOldBackups actually uses.
const existsSyncMock = fs.existsSync as unknown as Mock<(path: string) => boolean>;
const readFileSyncMock = fs.readFileSync as unknown as Mock<(path: string, enc: string) => string>;
const writeFileSyncMock = fs.writeFileSync as unknown as Mock<(path: string, data: string) => void>;
const mkdirSyncMock = fs.mkdirSync as unknown as Mock<(path: string, opts?: unknown) => void>;
const readdirSyncMock = fs.readdirSync as unknown as Mock<(path: string) => string[]>;
const statSyncMock = fs.statSync as unknown as Mock<(path: string) => fs.Stats>;
const unlinkSyncMock = fs.unlinkSync as unknown as Mock<(path: string) => void>;

// cleanupOldBackups reads nothing but mtimeMs off a stat result, so the stubs below stay
// deliberately partial instead of faking a whole fs.Stats.
function statStub(partial: Partial<fs.Stats>): fs.Stats {
  return partial as fs.Stats;
}

function settings(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return {
    enabled: true,
    interval: 'daily',
    keep_days: 7,
    hour: 2,
    day_of_week: 0,
    day_of_month: 1,
    ...overrides,
  };
}

describe('buildCronExpression', () => {
  describe('hourly', () => {
    it('returns 0 * * * * regardless of hour/dow/dom', () => {
      expect(buildCronExpression(settings({ interval: 'hourly', hour: 5, day_of_week: 3, day_of_month: 15 }))).toBe('0 * * * *');
    });
  });

  describe('daily', () => {
    it('returns 0 <hour> * * *', () => {
      expect(buildCronExpression(settings({ interval: 'daily', hour: 3 }))).toBe('0 3 * * *');
    });

    it('handles midnight (hour 0)', () => {
      expect(buildCronExpression(settings({ interval: 'daily', hour: 0 }))).toBe('0 0 * * *');
    });

    it('handles last valid hour (23)', () => {
      expect(buildCronExpression(settings({ interval: 'daily', hour: 23 }))).toBe('0 23 * * *');
    });

    it('falls back to hour 2 for invalid hour (24)', () => {
      expect(buildCronExpression(settings({ interval: 'daily', hour: 24 }))).toBe('0 2 * * *');
    });

    it('falls back to hour 2 for negative hour', () => {
      expect(buildCronExpression(settings({ interval: 'daily', hour: -1 }))).toBe('0 2 * * *');
    });
  });

  describe('weekly', () => {
    it('returns 0 <hour> * * <dow>', () => {
      expect(buildCronExpression(settings({ interval: 'weekly', hour: 5, day_of_week: 3 }))).toBe('0 5 * * 3');
    });

    it('handles Sunday (dow 0)', () => {
      expect(buildCronExpression(settings({ interval: 'weekly', hour: 2, day_of_week: 0 }))).toBe('0 2 * * 0');
    });

    it('handles Saturday (dow 6)', () => {
      expect(buildCronExpression(settings({ interval: 'weekly', hour: 2, day_of_week: 6 }))).toBe('0 2 * * 6');
    });

    it('falls back to dow 0 for invalid day_of_week (7)', () => {
      expect(buildCronExpression(settings({ interval: 'weekly', hour: 2, day_of_week: 7 }))).toBe('0 2 * * 0');
    });
  });

  describe('monthly', () => {
    it('returns 0 <hour> <dom> * *', () => {
      expect(buildCronExpression(settings({ interval: 'monthly', hour: 2, day_of_month: 15 }))).toBe('0 2 15 * *');
    });

    it('handles day_of_month 1', () => {
      expect(buildCronExpression(settings({ interval: 'monthly', hour: 2, day_of_month: 1 }))).toBe('0 2 1 * *');
    });

    it('handles max valid day_of_month (28)', () => {
      expect(buildCronExpression(settings({ interval: 'monthly', hour: 2, day_of_month: 28 }))).toBe('0 2 28 * *');
    });

    it('falls back to dom 1 for day_of_month 29', () => {
      expect(buildCronExpression(settings({ interval: 'monthly', hour: 2, day_of_month: 29 }))).toBe('0 2 1 * *');
    });

    it('falls back to dom 1 for day_of_month 0', () => {
      expect(buildCronExpression(settings({ interval: 'monthly', hour: 2, day_of_month: 0 }))).toBe('0 2 1 * *');
    });
  });

  describe('unknown interval', () => {
    it('defaults to daily pattern', () => {
      expect(buildCronExpression(settings({ interval: 'unknown', hour: 4 }))).toBe('0 4 * * *');
    });
  });
});

describe('loadSettings / saveSettings', () => {
  beforeEach(() => {
    existsSyncMock.mockReset().mockReturnValue(false);
    readFileSyncMock.mockReset().mockReturnValue('{}');
    writeFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it('returns the defaults when no settings file exists', () => {
    expect(loadSettings()).toEqual({ enabled: false, interval: 'daily', keep_days: 7, hour: 2, day_of_week: 0, day_of_month: 1 });
  });

  it('merges the saved file over the defaults', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ enabled: true, interval: 'weekly', hour: 6 }));
    expect(loadSettings()).toEqual({ enabled: true, interval: 'weekly', keep_days: 7, hour: 6, day_of_week: 0, day_of_month: 1 });
  });

  it('falls back to the defaults on a corrupt settings file', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('{not json');
    expect(loadSettings()).toEqual({ enabled: false, interval: 'daily', keep_days: 7, hour: 2, day_of_week: 0, day_of_month: 1 });
  });

  it('saveSettings creates the data dir when missing and writes pretty JSON', () => {
    const s = settings({ enabled: true, interval: 'weekly' });
    saveSettings(s);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expect.stringContaining('data'), { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('backup-settings.json'),
      JSON.stringify(s, null, 2),
    );
  });

  it('saveSettings skips the mkdir when the data dir already exists', () => {
    existsSyncMock.mockReturnValue(true);
    saveSettings(settings());
    expect(mkdirSyncMock).not.toHaveBeenCalled();
  });
});

describe('cleanupOldBackups', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-04-27T02:00:00Z').getTime();

  function isoFilename(daysAgo: number, prefix: 'auto-backup' | 'backup' = 'auto-backup'): string {
    const d = new Date(NOW - daysAgo * DAY);
    const stamp = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${prefix}-${stamp}.zip`;
  }

  beforeEach(() => {
    readdirSyncMock.mockReset();
    statSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    statSyncMock.mockReturnValue(statStub({ mtime: new Date(), mtimeMs: NOW, birthtimeMs: NOW, size: 0 }));
  });

  it('never deletes manual backup-*.zip files regardless of age', () => {
    const manual = isoFilename(365 * 5, 'backup');
    const auto = isoFilename(0);
    readdirSyncMock.mockReturnValue([manual, auto]);
    cleanupOldBackups(7, NOW);
    const deleted = unlinkSyncMock.mock.calls.map(([p]) => p);
    expect(deleted.some(p => p.includes(manual))).toBe(false);
  });

  it('keeps auto-backups newer than retention', () => {
    const recent = isoFilename(3);
    readdirSyncMock.mockReturnValue([recent]);
    cleanupOldBackups(7, NOW);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('deletes auto-backups older than retention', () => {
    const old = isoFilename(30);
    readdirSyncMock.mockReturnValue([old]);
    cleanupOldBackups(7, NOW);
    expect(unlinkSyncMock).toHaveBeenCalledOnce();
    const [calledPath] = unlinkSyncMock.mock.calls[0];
    expect(calledPath).toContain(old);
  });

  it('overlayfs regression: birthtimeMs=0 does not delete a same-day backup', () => {
    const fresh = isoFilename(0);
    readdirSyncMock.mockReturnValue([fresh]);
    statSyncMock.mockReturnValue(statStub({ birthtimeMs: 0, mtimeMs: NOW, mtime: new Date(NOW), size: 100 }));
    cleanupOldBackups(7, NOW);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('malformed filename falls back to mtimeMs: keeps recent file', () => {
    readdirSyncMock.mockReturnValue(['auto-backup-garbage.zip']);
    statSyncMock.mockReturnValue(statStub({ birthtimeMs: 0, mtimeMs: NOW - 1 * DAY, mtime: new Date(NOW - 1 * DAY), size: 0 }));
    cleanupOldBackups(7, NOW);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
  });

  it('malformed filename falls back to mtimeMs: deletes stale file', () => {
    readdirSyncMock.mockReturnValue(['auto-backup-garbage.zip']);
    statSyncMock.mockReturnValue(statStub({ birthtimeMs: 0, mtimeMs: NOW - 30 * DAY, mtime: new Date(NOW - 30 * DAY), size: 0 }));
    cleanupOldBackups(7, NOW);
    expect(unlinkSyncMock).toHaveBeenCalledOnce();
  });

  it('ignores non-zip files and does not crash', () => {
    const old = isoFilename(30);
    readdirSyncMock.mockReturnValue([old, 'notes.txt']);
    cleanupOldBackups(7, NOW);
    const calls = unlinkSyncMock.mock.calls;
    expect(calls.every(([p]) => !p.includes('notes.txt'))).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('swallows readdirSync errors without throwing', () => {
    readdirSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => cleanupOldBackups(7, NOW)).not.toThrow();
  });
});
