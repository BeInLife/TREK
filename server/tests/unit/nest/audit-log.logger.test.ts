/**
 * Unit tests for nest/audit/audit-log.logger — AUDIT-LOG-001 through
 * AUDIT-LOG-007. The logger is the deliberately side-effectful plain module
 * carved out of the legacy services/auditLog.ts (frozen LOG_LEVEL, import-time
 * mkdir, 10 MB × 5 rotation); it sits inside the src/nest/** coverage gate, so
 * its branches are pinned here with fs fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
  const mock = {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ size: 0 })),
    appendFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
  return { default: mock, ...mock };
});

import fs from 'fs';
import { logInfo, logDebug, logError, logWarn, LOG_LEVEL } from '../../../src/nest/audit/audit-log.logger';

const mocked = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocked.existsSync.mockReturnValue(false);
  mocked.statSync.mockReturnValue({ size: 0 } as unknown as ReturnType<typeof fs.statSync>);
});

describe('log levels + line format', () => {
  it('AUDIT-LOG-001: logInfo writes the ANSI console line and the plain file line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('hello');
    expect(log).toHaveBeenCalledTimes(1);
    const consoleLine = String(log.mock.calls[0][0]);
    expect(consoleLine.startsWith('\x1b[34m[INFO]\x1b[0m ')).toBe(true);
    expect(consoleLine).toMatch(/ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} hello$/);
    expect(mocked.appendFileSync).toHaveBeenCalledTimes(1);
    expect(String(mocked.appendFileSync.mock.calls[0][1])).toMatch(/^\[INFO\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} hello\n$/);
  });

  it('AUDIT-LOG-002: logError/logWarn use console.error/console.warn with their tags', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logError('boom');
    logWarn('careful');
    expect(err.mock.calls[0][0]).toContain('[ERROR]');
    expect(warn.mock.calls[0][0]).toContain('[WARN]');
    expect(String(mocked.appendFileSync.mock.calls[0][1])).toMatch(/^\[ERROR\] /);
    expect(String(mocked.appendFileSync.mock.calls[1][1])).toMatch(/^\[WARN\] /);
  });

  it('AUDIT-LOG-003: logDebug is gated by the import-frozen LOG_LEVEL (tests/setup.ts sets "error")', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(LOG_LEVEL).toBe('error');
    logDebug('invisible');
    expect(log).not.toHaveBeenCalled();
    expect(mocked.appendFileSync).not.toHaveBeenCalled();
  });

  it('AUDIT-LOG-004: the freeze happens at first import — a debug-env reimport logs debug lines', async () => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', 'debug');
    try {
      const fresh = await import('../../../src/nest/audit/audit-log.logger');
      expect(fresh.LOG_LEVEL).toBe('debug');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      fresh.logDebug('now visible');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain('[DEBUG]');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('rotation + resilience', () => {
  it('AUDIT-LOG-005: rotates trek.log through .1… in descending order once the cap is hit', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked.existsSync.mockReturnValue(true);
    mocked.statSync.mockReturnValue({ size: 10 * 1024 * 1024 } as unknown as ReturnType<typeof fs.statSync>);
    logInfo('rotate me');
    // MAX_LOG_FILES=5 → renames .3→.4, .2→.3, .1→.2, trek.log→.1 (descending).
    expect(mocked.renameSync).toHaveBeenCalledTimes(4);
    const dsts = mocked.renameSync.mock.calls.map((c) => String(c[1]));
    expect(dsts[0].endsWith('trek.log.4')).toBe(true);
    expect(dsts[3].endsWith('trek.log.1')).toBe(true);
    expect(String(mocked.renameSync.mock.calls[3][0]).endsWith('trek.log')).toBe(true);
  });

  it('AUDIT-LOG-006: no rotation below the size cap', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked.existsSync.mockReturnValue(true);
    mocked.statSync.mockReturnValue({ size: 10 } as unknown as ReturnType<typeof fs.statSync>);
    logInfo('small');
    expect(mocked.renameSync).not.toHaveBeenCalled();
    expect(mocked.appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('AUDIT-LOG-007: file-IO failures are swallowed (bare catch) — the console line still prints', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocked.appendFileSync.mockImplementation(() => { throw new Error('disk full'); });
    expect(() => logInfo('still up')).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
