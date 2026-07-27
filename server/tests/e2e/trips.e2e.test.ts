/**
 * Trips module e2e — exercises the migrated /api/trips aggregate-root endpoints
 * through the real JwtAuthGuard against a temp SQLite db. tripService, the bundle
 * list-services, auditLog, demo, the permission check, canAccessTrip and the
 * WebSocket broadcast are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { DatabaseModule } from '../../src/nest/database/database.module';
import { Test } from '@nestjs/testing';
import { seedUser, sessionCookie } from './harness';

const { db } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const tmp = new Database(':memory:');
  tmp.exec('PRAGMA journal_mode = WAL');
  tmp.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'user', password_version INTEGER NOT NULL DEFAULT 0,
    avatar TEXT, display_name TEXT, is_guest INTEGER NOT NULL DEFAULT 0);`);
  tmp.exec('CREATE TABLE trips (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);');
  // bundle()'s todoItems now runs TodoService's real SQL (DI-injected, no mock).
  tmp.exec(`CREATE TABLE todo_items (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL,
    name TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, category TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
    due_date TEXT, description TEXT, assigned_user_id INTEGER, priority INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  // bundle()'s packingItems now runs PackingService's real SQL (DI-injected, no
  // mock) — viewer-scoped (#858), so the recipients table must exist too.
  tmp.exec(`CREATE TABLE packing_items (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL,
    name TEXT NOT NULL, checked INTEGER DEFAULT 0, category TEXT, sort_order INTEGER DEFAULT 0,
    weight_grams INTEGER, bag_id INTEGER, quantity INTEGER NOT NULL DEFAULT 1,
    is_private INTEGER NOT NULL DEFAULT 0, owner_id INTEGER, updated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  tmp.exec(`CREATE TABLE packing_item_recipients (item_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (item_id, user_id));`);
  // bundle()'s files now runs FilesService's real SQL (DI-injected, no mock) —
  // empty tables satisfy the FILE_SELECT joins and the file_links batch.
  tmp.exec(`CREATE TABLE trip_files (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL,
    place_id INTEGER, reservation_id INTEGER, filename TEXT NOT NULL, original_name TEXT NOT NULL,
    file_size INTEGER, mime_type TEXT, description TEXT, uploaded_by INTEGER, starred INTEGER DEFAULT 0,
    deleted_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  tmp.exec(`CREATE TABLE file_links (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL,
    reservation_id INTEGER, assignment_id INTEGER, place_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  // bundle()'s reservations now runs ReservationsService's real SQL
  // (DI-injected, no mock) — the joined list query needs the full reservation
  // table set (trimmed from src/db/schema.ts; accommodation_id is TEXT there).
  tmp.exec(`CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER, title TEXT,
    day_id INTEGER, end_day_id INTEGER, place_id INTEGER, assignment_id INTEGER, type TEXT,
    status TEXT DEFAULT 'pending', reservation_time TEXT, reservation_end_time TEXT, location TEXT,
    confirmation_number TEXT, notes TEXT, url TEXT, accommodation_id TEXT, metadata TEXT,
    needs_review INTEGER DEFAULT 0, day_plan_position REAL, external_source TEXT, sync_enabled INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  tmp.exec('CREATE TABLE days (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, day_number INTEGER, date TEXT);');
  tmp.exec(`CREATE TABLE places (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, name TEXT,
    image_url TEXT, address TEXT, lat REAL, lng REAL);`);
  tmp.exec(`CREATE TABLE day_accommodations (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL,
    place_id INTEGER, start_day_id INTEGER, end_day_id INTEGER, check_in TEXT, check_in_end TEXT,
    check_out TEXT, confirmation TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  tmp.exec(`CREATE TABLE reservation_day_positions (reservation_id INTEGER NOT NULL, day_id INTEGER NOT NULL,
    position REAL, PRIMARY KEY (reservation_id, day_id));`);
  tmp.exec(`CREATE TABLE reservation_endpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL,
    role TEXT, sequence INTEGER, name TEXT, code TEXT, lat REAL NOT NULL, lng REAL NOT NULL,
    timezone TEXT, local_time TEXT, local_date TEXT);`);
  tmp.exec(`CREATE TABLE reservation_travelers (reservation_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (reservation_id, user_id));`);
  return { db: tmp };
});

const { canAccessTrip } = vi.hoisted(() => ({ canAccessTrip: vi.fn() }));
vi.mock('../../src/db/database', () => ({
  db, canAccessTrip, isOwner: vi.fn(() => true), getPlaceWithTags: vi.fn(), closeDb: () => {}, reinitialize: () => {},
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/notificationService', () => ({ send: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog', () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => '1.2.3.4'), logInfo: vi.fn(), logError: vi.fn() }));
vi.mock('../../src/services/demo', () => ({ isDemoEmail: vi.fn(() => false) }));

const { checkPermission } = vi.hoisted(() => ({ checkPermission: vi.fn() }));
vi.mock('../../src/services/permissions', () => ({ checkPermission }));

const { tripSvc } = vi.hoisted(() => ({
  tripSvc: {
    listTrips: vi.fn(), createTrip: vi.fn(), getTrip: vi.fn(), updateTrip: vi.fn(), deleteTrip: vi.fn(),
    getTripRaw: vi.fn(), getTripOwner: vi.fn(), deleteOldCover: vi.fn(), updateCoverImage: vi.fn(),
    listMembers: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), exportICS: vi.fn(), copyTripById: vi.fn(),
    verifyTripAccess: vi.fn(), NotFoundError: class NotFoundError extends Error {}, ValidationError: class ValidationError extends Error {}, TRIP_SELECT: 'SELECT',
  },
}));
vi.mock('../../src/services/tripService', () => tripSvc);
// bundle()'s days + accommodations now run DaysService's real SQL (DI-injected,
// no mock) — the days/places/day_accommodations/reservations DDL above serves them.
vi.mock('../../src/services/placeService', () => ({ listPlaces: () => [] }));
vi.mock('../../src/services/budgetService', () => ({ listBudgetItems: () => [] }));

import { TripsModule } from '../../src/nest/trips/trips.module';
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';

describe('Trips e2e (real auth guard + temp SQLite)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, TripsModule] }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrekExceptionFilter());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    seedUser(db as never, { id: 1 });
    app = await build();
    server = app.getHttpServer();
    tripSvc.listTrips.mockReturnValue([{ id: 1, title: 'T' }]);
    tripSvc.createTrip.mockReturnValue({ trip: { id: 9 }, tripId: 9, reminderDays: 0 });
    tripSvc.getTrip.mockImplementation((id: string) => (id === '9' ? { id: 9, user_id: 1 } : undefined));
    tripSvc.listMembers.mockReturnValue({ owner: { id: 1 }, members: [] });
  });

  beforeEach(() => {
    canAccessTrip.mockReturnValue({ user_id: 1 });
    checkPermission.mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 without a cookie', async () => {
    expect((await request(server).get('/api/trips')).status).toBe(401);
  });

  it('200 list', async () => {
    const res = await request(server).get('/api/trips').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trips: [{ id: 1, title: 'T' }] });
  });

  it('201 create, 403 without permission', async () => {
    const ok = await request(server).post('/api/trips').set('Cookie', sessionCookie(1)).send({ title: 'T' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ trip: { id: 9 } });
    checkPermission.mockReturnValue(false);
    const forbidden = await request(server).post('/api/trips').set('Cookie', sessionCookie(1)).send({ title: 'T' });
    expect(forbidden.status).toBe(403);
  });

  it('404 on a missing trip', async () => {
    const res = await request(server).get('/api/trips/77').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Trip not found' });
  });

  it('200 bundle for an accessible trip', async () => {
    const res = await request(server).get('/api/trips/9/bundle').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trip: { id: 9 }, days: [], members: [{ id: 1 }] });
  });
});
