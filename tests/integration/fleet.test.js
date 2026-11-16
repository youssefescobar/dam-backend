import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { FleetBus } from '../../src/models/FleetBus.js';
import { usedAdminKeys } from '../../src/services/mediaCleanup.js';

describe('Fleet (/fleet)', () => {
  let app;
  let auth;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    await startTestDb();
    app = createApp();
  });

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    await Admin.create({
      name: 'A',
      email: 'a@test.com',
      passwordHash: await bcrypt.hash('pw123456', 10),
      role: 'admin',
    });
    const login = await request(app).post('/auth/login').send({ email: 'a@test.com', password: 'pw123456' });
    auth = { Authorization: `Bearer ${login.body.token}` };
  });

  const bus = {
    slug: 'test-bus',
    quoteClass: 'coach',
    exteriorImages: ['/fleet/test/side.webp', 'https://cdn.test/front.webp'],
    en: { name: 'Coach', seatsLabel: '49 seats', summary: 'Long trips', amenities: ['Wi-Fi'] },
    ar: { name: 'باص', summary: 'رحلات' },
    fr: { name: 'Autocar' },
  };

  it('requires auth for admin routes', async () => {
    expect((await request(app).get('/fleet/all')).status).toBe(401);
    expect((await request(app).post('/fleet').send(bus)).status).toBe(401);
    expect((await request(app).put('/fleet/order').send({ ids: [] })).status).toBe(401);
  });

  it('seeds the six current buses on the first admin list', async () => {
    const all = await request(app).get('/fleet/all').set(auth);
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(6);
    expect((await request(app).get('/fleet/all').set(auth)).body.items).toHaveLength(6);
  });

  it('serves published buses in website shape with per-field language fallback', async () => {
    await FleetBus.create(bus);
    await FleetBus.create({ ...bus, slug: 'hidden', published: false });

    const res = await request(app).get('/fleet?locale=fr');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      id: 'test-bus',
      name: 'Autocar',
      seatsLabel: '49 seats',
      summary: 'Long trips',
      amenities: ['Wi-Fi'],
      coverImage: '/fleet/test/side.webp',
      exteriorImages: bus.exteriorImages,
      interiorImages: [],
      showInShowroom: true,
      quoteClass: 'coach',
    });
    // Odd locale values (incl. prototype keys) fall back to Arabic instead of crashing.
    expect((await request(app).get('/fleet?locale=constructor')).status).toBe(200);
    const [ar] = (await request(app).get('/fleet')).body.items;
    expect(ar).toMatchObject({ name: 'باص', seatsLabel: '49 seats', amenities: ['Wi-Fi'] });
  });

  it('validates image URLs, names and unique slugs', async () => {
    const bad = await request(app).post('/fleet').set(auth).send({ ...bus, coverImage: 'javascript:x' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.coverImage).toBeDefined();
    expect((await request(app).post('/fleet').set(auth).send({ ...bus, interiorImages: ['//evil.test/a.png'] })).status).toBe(400);
    expect((await request(app).post('/fleet').set(auth).send({ ...bus, interiorImages: ['/\\evil.test/a.png'] })).status).toBe(400);
    expect((await request(app).post('/fleet').set(auth).send({ ...bus, en: {}, ar: {} })).status).toBe(400);

    expect((await request(app).post('/fleet').set(auth).send(bus)).status).toBe(201);
    const dup = await request(app).post('/fleet').set(auth).send(bus);
    expect(dup.status).toBe(409);
    expect(dup.body.fields.slug).toBe('already in use');
  });

  it('reorders, updates and deletes buses', async () => {
    const a = await FleetBus.create({ ...bus, slug: 'a', sortOrder: 0 });
    const b = await FleetBus.create({ ...bus, slug: 'b', sortOrder: 1 });
    expect((await request(app).put('/fleet/order').set(auth).send({ ids: [String(b._id), String(a._id)] })).status).toBe(200);
    expect((await request(app).get('/fleet')).body.items.map((x) => x.id)).toEqual(['b', 'a']);

    const put = await request(app).put(`/fleet/${a._id}`).set(auth).send({ ...bus, slug: 'a', fr: {}, published: false });
    expect(put.status).toBe(200);
    expect(put.body.item.fr.name).toBe('');
    expect(put.body.item.sortOrder).toBe(1); // an edit without sortOrder keeps its place
    expect((await request(app).get('/fleet')).body.items.map((x) => x.id)).toEqual(['b']);
    const added = await request(app).post('/fleet').set(auth).send({ ...bus, slug: 'c' });
    expect(added.body.item.sortOrder).toBe(2); // a new bus goes last
    // The slug is fixed after creation: an edit that sends another one keeps the old slug.
    const renamed = await request(app).put(`/fleet/${a._id}`).set(auth).send({ ...bus, slug: 'b' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.item.slug).toBe('a');

    expect((await request(app).delete(`/fleet/${b._id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/fleet/${b._id}`).set(auth)).status).toBe(404);
  });

  it('counts bus photos as used so media cleanup keeps them', async () => {
    const key = 'admin/2026-11/0b0c7d4e-1a2b-4c3d-8e9f-001122334455.webp';
    await FleetBus.create({ ...bus, interiorImages: [`https://media.test/${key}`] });
    expect((await usedAdminKeys()).has(key)).toBe(true);
  });
});
