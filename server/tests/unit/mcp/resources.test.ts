/**
 * Unit tests for MCP resources (resources.ts).
 * Tests the remaining legacy-registrar resources via InMemoryTransport + Client
 * (trek://trips, trek://trips/{tripId} and .../members moved to the
 * DI-discovered TripsMcp — see tools-trips.test.ts;
 * trek://trips/{tripId}/budget, .../budget/per-person and
 * .../budget/settlement moved to the DI-discovered BudgetMcp — see
 * tools-budget.test.ts and tools-budget-advanced.test.ts;
 * trek://categories moved to the DI-discovered CategoriesMcp — see
 * tools-categories.test.ts; trek://trips/{tripId}/todos moved to TodoMcp —
 * see tools-todos.test.ts; trek://trips/{tripId}/packing and .../packing/bags
 * moved to PackingMcp — see tools-packing.test.ts;
 * trek://trips/{tripId}/days/{dayId}/notes moved to DayNotesMcp — see
 * tools-notes.test.ts; trek://trips/{tripId}/collab-notes moved to CollabMcp —
 * see tools-notes.test.ts; trek://trips/{tripId}/days and
 * .../accommodations moved to DaysMcp — see tools-days.test.ts and
 * tools-days-accommodations.test.ts).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

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
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, createPlace, addTripMember, createReservation, createCollabNote, createBucketListItem, createVisitedCountry } from '../../helpers/factories';
import { createMcpHarness, parseResourceResult, type McpHarness } from '../../helpers/mcp-harness';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

async function withHarness(userId: number, fn: (harness: McpHarness) => Promise<void>) {
  const harness = await createMcpHarness({ userId, withTools: false, withResources: true });
  try {
    await fn(harness);
  } finally {
    await harness.cleanup();
  }
}

// trek://trips and trek://trips/{tripId} moved to tools-trips.test.ts: they
// now register via the nest-mcp registry inside registerTools (TripsMcp
// @Resource/@ResourceTemplate), which this file's withTools: false harness
// never attaches.

// The trek://trips/{tripId}/days resource moved to the DI-discovered
// DaysMcp — see tools-days.test.ts.

// The trek://trips/{tripId}/places resource moved to the DI-discovered
// PlacesMcp — its cases live in tools-places.test.ts (the registry attaches
// via registerTools, which this withTools:false harness skips).

// The trek://trips/{tripId}/budget resource moved to the DI-discovered
// src/nest/budget/budget.mcp.ts — its cases live in tools-budget.test.ts (the
// registry attaches via registerTools, which this withTools:false harness skips).

// The trek://trips/{tripId}/packing and .../packing/bags resources moved to the
// DI-discovered PackingMcp — see tools-packing.test.ts.

// The trek://trips/{tripId}/reservations resource moved to the DI-discovered
// ReservationsMcp — see tools-reservations.test.ts.

// The trek://trips/{tripId}/days/{dayId}/notes resource moved to the
// DI-discovered DayNotesMcp — see tools-notes.test.ts.

// The trek://trips/{tripId}/accommodations resource moved to the
// DI-discovered DaysMcp — see tools-days-accommodations.test.ts.

// trek://trips/{tripId}/members moved to tools-trips.test.ts (TripsMcp
// @ResourceTemplate) for the same reason.

// trek://trips/{tripId}/collab-notes moved to tools-notes.test.ts: it now
// registers via the nest-mcp registry inside registerTools (CollabMcp
// @ResourceTemplate), which this file's withTools: false harness never attaches.

// trek://categories moved to tools-categories.test.ts: it now registers via
// the nest-mcp registry inside registerTools (CategoriesMcp @Resource), which
// this file's withTools: false harness never attaches.

describe('Resource: trek://bucket-list', () => {
  it('returns only the current user\'s bucket list items', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    createBucketListItem(testDb, user.id, { name: 'Tokyo' });
    createBucketListItem(testDb, other.id, { name: 'Rome' });

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://bucket-list' });
      const items = parseResourceResult(result) as any[];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Tokyo');
    });
  });

  it('returns empty array for user with no items', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://bucket-list' });
      const items = parseResourceResult(result) as any[];
      expect(items).toEqual([]);
    });
  });
});

describe('Resource: trek://visited-countries', () => {
  it('returns only the current user\'s visited countries', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    createVisitedCountry(testDb, user.id, 'FR');
    createVisitedCountry(testDb, user.id, 'JP');
    createVisitedCountry(testDb, other.id, 'DE');

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://visited-countries' });
      const countries = parseResourceResult(result) as any[];
      expect(countries).toHaveLength(2);
      const codes = countries.map((c) => c.country_code);
      expect(codes).toContain('FR');
      expect(codes).toContain('JP');
      expect(codes).not.toContain('DE');
    });
  });

  it('returns empty array for user with no visited countries', async () => {
    const { user } = createUser(testDb);

    await withHarness(user.id, async (harness) => {
      const result = await harness.client.readResource({ uri: 'trek://visited-countries' });
      const countries = parseResourceResult(result) as any[];
      expect(countries).toEqual([]);
    });
  });
});
