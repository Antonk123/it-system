import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

const { DB_PATH, readAsset } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-architecture.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-architecture-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-architecture-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath, readAsset: vi.fn() };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: (...args: Parameters<typeof original.readFile>) => {
      if (String(args[0]).endsWith('/admin_assets/architecture-map/index.html')) {
        return readAsset(...args);
      }
      return original.readFile(...args);
    },
  };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;
const html = '<!doctype html><html lang="sv"><title>Arkitekturkarta</title><body>Karta</body></html>';

beforeAll(async () => {
  initializeDatabase();
  const hash = await bcrypt.hash('Test-P@ss1234!', 10);
  for (const role of ['admin', 'user']) {
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), `${role}@architecture.local`, hash, role);
  }
  app = createApp();
  const login = async (role: string) => {
    const response = await request(app).post('/api/auth/login')
      .send({ email: `${role}@architecture.local`, password: 'Test-P@ss1234!' });
    expect(response.status).toBe(200);
    return response.body.accessToken as string;
  };
  adminToken = await login('admin');
  userToken = await login('user');
});

beforeEach(() => {
  readAsset.mockReset();
  readAsset.mockResolvedValue(html);
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_PATH + suffix)) rmSync(DB_PATH + suffix);
  }
});

describe('GET /api/architecture-map', () => {
  it('rejects anonymous callers before reading the private asset', async () => {
    const response = await request(app).get('/api/architecture-map');
    expect(response.status).toBe(401);
    expect(readAsset).not.toHaveBeenCalled();
  });

  it('rejects a regular user before reading the private asset', async () => {
    const response = await request(app).get('/api/architecture-map')
      .set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
    expect(readAsset).not.toHaveBeenCalled();
  });

  it('returns HTML to an admin with private no-store and noindex headers', async () => {
    const response = await request(app).get('/api/architecture-map')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.text).toBe(html);
    expect(readAsset).toHaveBeenCalledWith(
      new URL('../../admin_assets/architecture-map/index.html', import.meta.url), 'utf8',
    );
  });

  it('returns a controlled 503 when the asset is missing without leaking its path', async () => {
    readAsset.mockRejectedValueOnce(Object.assign(new Error('ENOENT private asset path'), { code: 'ENOENT' }));
    const response = await request(app).get('/api/architecture-map')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Architecture map is temporarily unavailable' });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('does not expose the asset at a static URL', async () => {
    const response = await request(app).get('/admin_assets/architecture-map/index.html');
    expect(response.status).toBe(404);
    expect(readAsset).not.toHaveBeenCalled();
  });
});
