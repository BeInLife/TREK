/**
 * Days + day-notes module e2e — exercises both migrated mounts through the real
 * JwtAuthGuard against a temp SQLite db. The day service (still legacy), the
 * permission check, canAccessTrip and the WebSocket broadcast are mocked; the
 * DI-native DayNotesService runs real SQL against the temp db.
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
    email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'user', password_version INTEGER NOT NULL DEFAULT 0);`);
  // The tables DayNotesService really queries (real SQL, no service mock).
  tmp.exec('CREATE TABLE days (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL);');
  tmp.exec(`CREATE TABLE day_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER NOT NULL,
    trip_id INTEGER NOT NULL, text TEXT NOT NULL, time TEXT, icon TEXT DEFAULT '📝',
    sort_order REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  return { db: tmp };
});

const { canAccessTrip } = vi.hoisted(() => ({ canAccessTrip: vi.fn() }));
vi.mock('../../src/db/database', () => ({
  db, canAccessTrip, isOwner: vi.fn(() => true), getPlaceWithTags: vi.fn(), closeDb: () => {}, reinitialize: () => {},
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn() }));

const { checkPermission } = vi.hoisted(() => ({ checkPermission: vi.fn() }));
vi.mock('../../src/services/permissions', () => ({ checkPermission }));

const { day } = vi.hoisted(() => ({
  day: { listDays: vi.fn(), createDay: vi.fn(), getDay: vi.fn(), updateDay: vi.fn(), deleteDay: vi.fn() },
}));
vi.mock('../../src/services/dayService', () => day);

import { DaysModule } from '../../src/nest/days/days.module';
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';
import { ZodValidationPipe } from '../../src/nest/common/zod-validation.pipe';

describe('Days + day-notes e2e (real auth guard + temp SQLite)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, DaysModule] }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalPipes(new ZodValidationPipe());
    nest.useGlobalFilters(new TrekExceptionFilter());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    seedUser(db as never, { id: 1 });
    db.prepare('INSERT INTO days (id, trip_id) VALUES (3, 5)').run();
    app = await build();
    server = app.getHttpServer();
    day.listDays.mockReturnValue({ days: [{ id: 1 }] });
    day.createDay.mockReturnValue({ id: 9 });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM day_notes').run();
    canAccessTrip.mockReturnValue({ id: 5, user_id: 1 });
    checkPermission.mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 without a cookie', async () => {
    expect((await request(server).get('/api/trips/5/days')).status).toBe(401);
  });

  it('200 list days (the { days } envelope)', async () => {
    const res = await request(server).get('/api/trips/5/days').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: [{ id: 1 }] });
  });

  it('201 create day, 404 trip when not accessible', async () => {
    const ok = await request(server).post('/api/trips/5/days').set('Cookie', sessionCookie(1)).send({ date: '2026-07-01' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ day: { id: 9 } });
    canAccessTrip.mockReturnValue(undefined);
    const miss = await request(server).get('/api/trips/5/days').set('Cookie', sessionCookie(1));
    expect(miss.status).toBe(404);
    expect(miss.body).toEqual({ error: 'Trip not found' });
  });

  it('201 create note (real insert: trim, empty-string coercions), 400 on over-long text (before access)', async () => {
    const ok = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1))
      .send({ text: '  Lunch  ', time: '', icon: '', sort_order: 0 });
    expect(ok.status).toBe(201);
    expect(ok.body.note).toMatchObject({ day_id: 3, trip_id: 5, text: 'Lunch', time: null, icon: '📝', sort_order: 0 });
    const row = db.prepare('SELECT * FROM day_notes WHERE id = ?').get(ok.body.note.id);
    expect(row).toMatchObject({ text: 'Lunch', time: null, icon: '📝', sort_order: 0 });
    const long = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1)).send({ text: 'x'.repeat(501) });
    expect(long.status).toBe(400);
    expect(long.body.error).toContain('text');
  });

  it('201 create accepts null time/icon (moveDayNote re-sends the nullable entity fields)', async () => {
    const res = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1))
      .send({ text: 'Moved', time: null, icon: null, sort_order: 3 });
    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject({ text: 'Moved', time: null, icon: '📝', sort_order: 3 });
  });

  it('404 Day not found when the day is not on the trip', async () => {
    const res = await request(server).post('/api/trips/5/days/99/notes').set('Cookie', sessionCookie(1)).send({ text: 'Lunch' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Day not found' });
  });

  it('400 note without text', async () => {
    const res = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1)).send({ text: '  ' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Text required' });
  });

  it('200 update note merges omitted fields from the current row', async () => {
    const created = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1))
      .send({ text: 'Lunch', time: '12:00' });
    const id = created.body.note.id;
    const res = await request(server).put(`/api/trips/5/days/3/notes/${id}`).set('Cookie', sessionCookie(1))
      .send({ icon: '🍜' });
    expect(res.status).toBe(200);
    expect(res.body.note).toMatchObject({ id, text: 'Lunch', time: '12:00', icon: '🍜' });
    const miss = await request(server).put('/api/trips/5/days/3/notes/9999').set('Cookie', sessionCookie(1)).send({ text: 'x' });
    expect(miss.status).toBe(404);
    expect(miss.body).toEqual({ error: 'Note not found' });
  });

  it('200 delete note removes the row', async () => {
    const created = await request(server).post('/api/trips/5/days/3/notes').set('Cookie', sessionCookie(1)).send({ text: 'Lunch' });
    const id = created.body.note.id;
    const res = await request(server).delete(`/api/trips/5/days/3/notes/${id}`).set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.prepare('SELECT * FROM day_notes WHERE id = ?').get(id)).toBeUndefined();
  });
});
