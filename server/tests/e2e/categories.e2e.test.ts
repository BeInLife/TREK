/**
 * Categories module e2e — exercises the migrated /api/categories endpoints
 * through the real JwtAuthGuard + AdminGuard against a temp SQLite db seeded
 * with an admin and a normal user. CategoriesService runs its real SQL via
 * DatabaseModule (the DATABASE_CONNECTION factory picks up the mocked db
 * singleton): listing is open to any authenticated user; writes are admin-only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { seedUser, sessionCookie } from './harness';

const { db } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const tmp = new Database(':memory:');
  tmp.exec('PRAGMA journal_mode = WAL');
  tmp.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'user', password_version INTEGER NOT NULL DEFAULT 0);`);
  tmp.exec(`CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    icon TEXT DEFAULT '📍',
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  return { db: tmp };
});

vi.mock('../../src/db/database', () => ({ db, closeDb: () => {}, reinitialize: () => {} }));

import { CategoriesModule } from '../../src/nest/categories/categories.module';
import { DatabaseModule } from '../../src/nest/database/database.module';
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';

function insertCategory(name: string, color = '#6366f1', icon = '📍', userId = 1): number {
  const res = db
    .prepare('INSERT INTO categories (name, color, icon, user_id) VALUES (?, ?, ?, ?)')
    .run(name, color, icon, userId);
  return Number(res.lastInsertRowid);
}

describe('Categories e2e (real JwtAuthGuard + AdminGuard + temp SQLite)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, CategoriesModule] }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrekExceptionFilter());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    seedUser(db as never, { id: 1, role: 'admin', email: 'admin@example.test' });
    seedUser(db as never, { id: 2, role: 'user', email: 'user@example.test' });
    app = await build();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    db.exec('DELETE FROM categories');
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 without a session cookie', async () => {
    const res = await request(server).get('/api/categories');
    expect(res.status).toBe(401);
  });

  it('200 list for any authenticated user (non-admin allowed), ordered by name', async () => {
    insertCategory('Zoo');
    insertCategory('Aquarium');
    const res = await request(server).get('/api/categories').set('Cookie', sessionCookie(2));
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: { name: string }) => c.name)).toEqual(['Aquarium', 'Zoo']);
  });

  it('403 when a non-admin tries to create', async () => {
    const res = await request(server).post('/api/categories').set('Cookie', sessionCookie(2)).send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n).toBe(0);
  });

  it('201 when an admin creates a category, echoing name/color/icon and user_id', async () => {
    const res = await request(server).post('/api/categories').set('Cookie', sessionCookie(1)).send({ name: 'Food', color: '#fff', icon: '🍔' });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ name: 'Food', color: '#fff', icon: '🍔', user_id: 1 });
    expect(typeof res.body.category.id).toBe('number');
  });

  it('201 on create with the #6366f1/📍 defaults when color and icon are omitted', async () => {
    const res = await request(server).post('/api/categories').set('Cookie', sessionCookie(1)).send({ name: 'Defaults' });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ color: '#6366f1', icon: '📍' });
  });

  it('400 when an admin creates without a name', async () => {
    const res = await request(server).post('/api/categories').set('Cookie', sessionCookie(1)).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Category name is required' });
  });

  it('200 when an admin updates, COALESCE preserving omitted fields', async () => {
    const id = insertCategory('Food', '#fff', '🍔');
    const res = await request(server).put(`/api/categories/${id}`).set('Cookie', sessionCookie(1)).send({ name: 'Drinks' });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ id, name: 'Drinks', color: '#fff', icon: '🍔' });
  });

  it('404 when an admin updates a missing category', async () => {
    const res = await request(server).put('/api/categories/9999').set('Cookie', sessionCookie(1)).send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Category not found' });
  });

  it('200 when an admin deletes an existing category, removing the row', async () => {
    const id = insertCategory('ToDelete');
    const res = await request(server).delete(`/api/categories/${id}`).set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.prepare('SELECT id FROM categories WHERE id = ?').get(id)).toBeUndefined();
  });

  it('404 when an admin deletes a missing category', async () => {
    const res = await request(server).delete('/api/categories/9999').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Category not found' });
  });
});
