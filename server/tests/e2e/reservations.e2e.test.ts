/**
 * Reservations + accommodations module e2e — exercises both migrated mounts
 * through the real JwtAuthGuard against a temp SQLite db. Reservation SQL runs
 * for real (ReservationsService is DI-native, no mock — the temp db carries the
 * full schema via createTables + runMigrations); the day/budget services, the
 * permission check and the WebSocket broadcast stay mocked.
 */
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';
import { ZodValidationPipe } from '../../src/nest/common/zod-validation.pipe';
import { ReservationsModule } from '../../src/nest/reservations/reservations.module';
import { sessionCookie } from './harness';
import { DatabaseModule } from '../../src/nest/database/database.module';
import { Test } from '@nestjs/testing';

import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const tmp = new Database(':memory:');
  tmp.exec('PRAGMA journal_mode = WAL');
  return { db: tmp };
});

const { canAccessTrip } = vi.hoisted(() => ({ canAccessTrip: vi.fn() }));
vi.mock('../../src/db/database', () => ({
  db,
  canAccessTrip,
  isOwner: vi.fn(() => true),
  getPlaceWithTags: vi.fn(),
  closeDb: () => {},
  reinitialize: () => {},
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn() }));
const { notificationSend } = vi.hoisted(() => ({ notificationSend: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/notificationService', () => ({ send: notificationSend }));

const { checkPermission } = vi.hoisted(() => ({ checkPermission: vi.fn() }));
vi.mock('../../src/services/permissions', () => ({ checkPermission }));

const { budget, day } = vi.hoisted(() => ({
  budget: {
    createBudgetItem: vi.fn(),
    updateBudgetItem: vi.fn(),
    deleteBudgetItem: vi.fn(),
    linkBudgetItemToReservation: vi.fn(),
  },
  day: {
    listAccommodations: vi.fn(),
    validateAccommodationRefs: vi.fn(),
    createAccommodation: vi.fn(),
    getAccommodation: vi.fn(),
    updateAccommodation: vi.fn(),
    deleteAccommodation: vi.fn(),
  },
}));
vi.mock('../../src/services/budgetService', () => budget);
vi.mock('../../src/services/dayService', () => day);

import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';

describe('Reservations + accommodations e2e (real auth guard + temp SQLite, real reservation SQL)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;
  let tripId: number;

  async function build() {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ReservationsModule] }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrekExceptionFilter());
    nest.useGlobalPipes(new ZodValidationPipe());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    createTables(db);
    runMigrations(db);
    // The temp db carries the real schema (password_hash NOT NULL), so seed the
    // auth user directly instead of via the trimmed-DDL seedUser helper.
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, password_version) VALUES (1, 'e2e-user', 'e2e@example.test', 'x', 'user', 0)",
    ).run();
    tripId = Number(db.prepare("INSERT INTO trips (user_id, title) VALUES (1, 'E2E Trip')").run().lastInsertRowid);
    app = await build();
    server = app.getHttpServer();
    day.listAccommodations.mockReturnValue([{ id: 1 }]);
    day.validateAccommodationRefs.mockReturnValue([]);
    day.createAccommodation.mockReturnValue({ id: 9 });
  });

  beforeEach(() => {
    canAccessTrip.mockImplementation((id: unknown) => db.prepare('SELECT * FROM trips WHERE id = ?').get(id));
    checkPermission.mockReturnValue(true);
    notificationSend.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 without a cookie (reservations)', async () => {
    expect((await request(server).get(`/api/trips/${tripId}/reservations`)).status).toBe(401);
  });

  it('200 list reservations (real SQL, joins attached)', async () => {
    const rid = db.prepare("INSERT INTO reservations (trip_id, title, type) VALUES (?, 'Hotel', 'hotel')").run(tripId).lastInsertRowid;
    const res = await request(server).get(`/api/trips/${tripId}/reservations`).set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    const row = res.body.reservations.find((r: { id: number }) => r.id === Number(rid));
    expect(row).toMatchObject({ title: 'Hotel', type: 'hotel', endpoints: [], travelers: [] });
  });

  it('401 without a cookie (upcoming feed)', async () => {
    expect((await request(server).get('/api/reservations/upcoming')).status).toBe(401);
  });

  it('200 cross-trip upcoming reservations feed', async () => {
    db.prepare("INSERT INTO reservations (trip_id, title, type, reservation_time) VALUES (?, 'Flight', 'flight', '2999-01-01T10:00:00')").run(tripId);
    const res = await request(server).get('/api/reservations/upcoming').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body.reservations.map((r: { title: string }) => r.title)).toContain('Flight');
  });

  it('404 when trip not accessible (reservations)', async () => {
    canAccessTrip.mockReturnValue(undefined);
    const res = await request(server).get(`/api/trips/${tripId}/reservations`).set('Cookie', sessionCookie(1));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Trip not found' });
  });

  it('201 create reservation (real insert + booking notification), 400 without title', async () => {
    const ok = await request(server)
      .post(`/api/trips/${tripId}/reservations`)
      .set('Cookie', sessionCookie(1))
      .send({ title: 'Hotel' });
    expect(ok.status).toBe(201);
    expect(ok.body.reservation).toMatchObject({ title: 'Hotel', type: 'other', status: 'pending' });
    expect(db.prepare('SELECT title FROM reservations WHERE id = ?').get(ok.body.reservation.id)).toEqual({ title: 'Hotel' });
    // The fire-and-forget booking notification reaches the (mocked) notification service.
    await vi.waitFor(() => expect(notificationSend).toHaveBeenCalled());
    expect(notificationSend).toHaveBeenCalledWith(expect.objectContaining({ event: 'booking_change', actorId: 1 }));

    const bad = await request(server).post(`/api/trips/${tripId}/reservations`).set('Cookie', sessionCookie(1)).send({});
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('title');
  });

  it('200 list accommodations + 201 create', async () => {
    const list = await request(server).get(`/api/trips/${tripId}/accommodations`).set('Cookie', sessionCookie(1));
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ accommodations: [{ id: 1 }] });
    const create = await request(server)
      .post(`/api/trips/${tripId}/accommodations`)
      .set('Cookie', sessionCookie(1))
      .send({ place_id: 2, start_day_id: 10, end_day_id: 11 });
    expect(create.status).toBe(201);
    expect(create.body).toEqual({ accommodation: { id: 9 } });
  });

  it('404 when trip not accessible (accommodations)', async () => {
    canAccessTrip.mockReturnValue(undefined);
    const res = await request(server).get(`/api/trips/${tripId}/accommodations`).set('Cookie', sessionCookie(1));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Trip not found' });
  });

  it('400 accommodation create without refs', async () => {
    const res = await request(server)
      .post(`/api/trips/${tripId}/accommodations`)
      .set('Cookie', sessionCookie(1))
      .send({ place_id: 2 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'place_id, start_day_id, and end_day_id are required' });
  });
});
