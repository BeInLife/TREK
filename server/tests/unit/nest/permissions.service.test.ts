/**
 * Unit tests for the DI-native PermissionsService — PERM-SVC-001 through
 * PERM-SVC-020 (001–013 moved 1:1 from the legacy
 * tests/unit/services/permissions.test.ts, which had no case IDs — the IDs are
 * introduced with the move; 014–016 pin the cache semantics the real DB now
 * makes testable; 017–020 pin the permissions.bridge delegation and the
 * module-scoped cache shared across the DI and bridge instances). Uses a real
 * in-memory SQLite DB so the app_settings SQL is exercised faithfully.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// ── DB setup ──────────────────────────────────────────────────────────────────

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { PermissionsService, PERMISSION_ACTIONS } from '../../../src/nest/permissions/permissions.service';
import {
  checkPermission as bridgeCheckPermission,
  getPermissionLevel as bridgeGetPermissionLevel,
  getAllPermissions as bridgeGetAllPermissions,
  savePermissions as bridgeSavePermissions,
  invalidatePermissionsCache as bridgeInvalidatePermissionsCache,
} from '../../../src/nest/permissions/permissions.bridge';

const svc = new PermissionsService(new DatabaseService(testDb));

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  testDb.prepare("DELETE FROM app_settings WHERE key LIKE 'perm_%'").run();
  svc.invalidatePermissionsCache();
});

afterAll(() => {
  testDb.close();
});

// ── checkPermission ───────────────────────────────────────────────────────────

describe('checkPermission — admin bypass', () => {
  it('PERM-SVC-001: admin always passes regardless of permission level', () => {
    for (const action of PERMISSION_ACTIONS) {
      expect(svc.checkPermission(action.key, 'admin', 1, 1, false)).toBe(true);
      expect(svc.checkPermission(action.key, 'admin', 99, 1, false)).toBe(true);
    }
  });
});

describe('checkPermission — everybody level', () => {
  it('PERM-SVC-002: trip_create (everybody) allows any authenticated user', () => {
    expect(svc.checkPermission('trip_create', 'user', null, 42, false)).toBe(true);
  });
});

describe('checkPermission — trip_owner level', () => {
  const ownerId = 10;
  const memberId = 20;

  it('PERM-SVC-003: trip owner passes trip_owner check', () => {
    expect(svc.checkPermission('trip_delete', 'user', ownerId, ownerId, false)).toBe(true);
  });

  it('PERM-SVC-004: member fails trip_owner check', () => {
    expect(svc.checkPermission('trip_delete', 'user', ownerId, memberId, true)).toBe(false);
  });

  it('PERM-SVC-005: non-member non-owner fails trip_owner check', () => {
    expect(svc.checkPermission('trip_delete', 'user', ownerId, memberId, false)).toBe(false);
  });
});

describe('checkPermission — trip_member level', () => {
  const ownerId = 10;
  const memberId = 20;
  const outsiderId = 30;

  it('PERM-SVC-006: trip owner passes trip_member check', () => {
    expect(svc.checkPermission('day_edit', 'user', ownerId, ownerId, false)).toBe(true);
  });

  it('PERM-SVC-007: trip member passes trip_member check', () => {
    expect(svc.checkPermission('day_edit', 'user', ownerId, memberId, true)).toBe(true);
  });

  it('PERM-SVC-008: outsider fails trip_member check', () => {
    expect(svc.checkPermission('day_edit', 'user', ownerId, outsiderId, false)).toBe(false);
  });
});

// ── getPermissionLevel ────────────────────────────────────────────────────────

describe('getPermissionLevel — defaults', () => {
  it('PERM-SVC-009: returns default level for known actions (no DB overrides)', () => {
    const defaults: Record<string, string> = {
      trip_create: 'everybody',
      trip_delete: 'trip_owner',
      day_edit: 'trip_member',
      budget_edit: 'trip_member',
    };
    for (const [key, expected] of Object.entries(defaults)) {
      expect(svc.getPermissionLevel(key)).toBe(expected);
    }
  });

  it('PERM-SVC-010: returns trip_owner for unknown action key', () => {
    expect(svc.getPermissionLevel('nonexistent_action')).toBe('trip_owner');
  });
});

// ── savePermissions ───────────────────────────────────────────────────────────

describe('savePermissions — invalid input is silently skipped', () => {
  it('PERM-SVC-011: returns skipped array containing invalid action key, writes no row', () => {
    const result = svc.savePermissions({ nonexistent_action: 'trip_member' });
    expect(result.skipped).toContain('nonexistent_action');
    const rows = testDb.prepare("SELECT key FROM app_settings WHERE key LIKE 'perm_%'").all();
    expect(rows).toEqual([]);
  });

  it('PERM-SVC-012: returns skipped array when level is not in allowedLevels for the action', () => {
    // trip_delete only allows ['admin', 'trip_owner'], so 'trip_member' is invalid
    const result = svc.savePermissions({ trip_delete: 'trip_member' });
    expect(result.skipped).toContain('trip_delete');
    const rows = testDb.prepare("SELECT key FROM app_settings WHERE key LIKE 'perm_%'").all();
    expect(rows).toEqual([]);
  });
});

describe('checkPermission — default case', () => {
  it('PERM-SVC-013: returns false when permission level is an unrecognized value', () => {
    testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('perm_trip_edit', 'unknown_level');
    svc.invalidatePermissionsCache();
    expect(svc.checkPermission('trip_edit', 'user', 10, 10, false)).toBe(false);
  });
});

// ── cache semantics (real DB) ─────────────────────────────────────────────────

describe('stored overrides + cache', () => {
  it('PERM-SVC-014: stored perm_ row overrides the default after invalidation', () => {
    testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('perm_trip_edit', 'trip_member');
    svc.invalidatePermissionsCache();
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_member');
    // A plain member now passes what defaults to a trip_owner-only action.
    expect(svc.checkPermission('trip_edit', 'user', 10, 20, true)).toBe(true);
  });

  it('PERM-SVC-015: savePermissions persists the row and self-invalidates the cache', () => {
    // Prime the cache with the defaults first.
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_owner');
    const result = svc.savePermissions({ trip_edit: 'trip_member' });
    expect(result.skipped).toEqual([]);
    const row = testDb.prepare('SELECT value FROM app_settings WHERE key = ?').get('perm_trip_edit') as { value: string };
    expect(row.value).toBe('trip_member');
    // No manual invalidation — savePermissions did it.
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_member');
  });

  it('PERM-SVC-016: the cache memoizes until invalidated', () => {
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_owner');
    // Raw SQL write bypasses savePermissions' self-invalidation → stale value served.
    testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('perm_trip_edit', 'trip_member');
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_owner');
    svc.invalidatePermissionsCache();
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_member');
  });
});

// ── permissions.bridge delegation ─────────────────────────────────────────────

describe('permissions.bridge delegation', () => {
  it('PERM-SVC-017: checkPermission delegates through the bridge instance', () => {
    expect(bridgeCheckPermission('trip_create', 'user', null, 42, false)).toBe(true);
    expect(bridgeCheckPermission('trip_delete', 'user', 10, 20, true)).toBe(false);
  });

  it('PERM-SVC-018: savePermissions via the bridge writes the row and reports skips', () => {
    const result = bridgeSavePermissions({ trip_edit: 'trip_member', bogus: 'trip_member' });
    expect(result.skipped).toEqual(['bogus']);
    const row = testDb.prepare('SELECT value FROM app_settings WHERE key = ?').get('perm_trip_edit') as { value: string };
    expect(row.value).toBe('trip_member');
  });

  it('PERM-SVC-019: getPermissionLevel/getAllPermissions delegate through the bridge', () => {
    expect(bridgeGetPermissionLevel('trip_create')).toBe('everybody');
    const all = bridgeGetAllPermissions();
    expect(all.trip_delete).toBe('trip_owner');
    expect(Object.keys(all)).toHaveLength(PERMISSION_ACTIONS.length);
  });

  it('PERM-SVC-020: the cache is module-scoped — shared by the DI and bridge instances', () => {
    // Save through the DI instance; the bridge instance sees it immediately.
    svc.savePermissions({ trip_edit: 'trip_member' });
    expect(bridgeGetPermissionLevel('trip_edit')).toBe('trip_member');
    // Raw SQL write, then invalidate through the BRIDGE — the DI instance
    // must serve the fresh value (backup-restore relies on exactly this).
    testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('perm_trip_edit', 'trip_owner');
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_member'); // still cached
    bridgeInvalidatePermissionsCache();
    expect(svc.getPermissionLevel('trip_edit')).toBe('trip_owner');
  });
});
