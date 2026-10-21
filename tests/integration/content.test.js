import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';

describe('Website content (/content)', () => {
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

  const news = {
    published: true,
    slug: 'new-fleet-2026',
    en: { title: 'New fleet', excerpt: 'Short', body: 'Long body' },
    ar: { title: 'أسطول جديد', body: 'نص' },
  };

  it('requires auth to write and list drafts', async () => {
    expect((await request(app).post('/content/news').send(news)).status).toBe(401);
    expect((await request(app).get('/content/news/all')).status).toBe(401);
  });

  it('publishes news in website shape with per-field language fallback', async () => {
    const created = await request(app).post('/content/news').set(auth).send(news);
    expect(created.status).toBe(201);
    expect(created.body.item.publishedAt).toBeTruthy();

    const ar = await request(app).get('/content/news?locale=ar');
    expect(ar.body.items).toHaveLength(1);
    expect(ar.body.items[0]).toMatchObject({ slug: 'new-fleet-2026', title: 'أسطول جديد', excerpt: 'Short', coverImage: null });
  });

  it('hides drafts from the public list but shows them to admins', async () => {
    await request(app).post('/content/testimonial').set(auth).send({ en: { quote: 'Great trip', name: 'Ali' } });
    expect((await request(app).get('/content/testimonial')).body.items).toHaveLength(0);
    const all = await request(app).get('/content/testimonial/all').set(auth);
    expect(all.body.items).toHaveLength(1);
  });

  it('keeps several media on a news post, first one as the cover', async () => {
    const media = ['https://cdn.test/a.webp', 'https://cdn.test/b.mp4'];
    const created = await request(app).post('/content/news').set(auth).send({ ...news, image: 'ignored', media });
    expect(created.body.item.image).toBe(media[0]);
    const [post] = (await request(app).get('/content/news?locale=en')).body.items;
    expect(post).toMatchObject({ coverImage: media[0], media });

    const legacy = await request(app).post('/content/news').set(auth).send({ ...news, slug: 'old', image: 'https://cdn.test/old.jpg' });
    expect(legacy.body.item.media).toEqual(['https://cdn.test/old.jpg']);
  });

  it('no longer serves careers', async () => {
    expect((await request(app).get('/content/career')).status).toBe(404);
  });

  it('validates required fields per kind and unique news slugs', async () => {
    const noQuote = await request(app).post('/content/testimonial').set(auth).send({ en: { name: 'Ali' } });
    expect(noQuote.status).toBe(400);
    expect(noQuote.body.fields['en.quote']).toBeDefined();

    await request(app).post('/content/news').set(auth).send(news);
    const dup = await request(app).post('/content/news').set(auth).send(news);
    expect(dup.status).toBe(409);
  });

  it('updates, then deletes an item', async () => {
    const { body } = await request(app)
      .post('/content/testimonial')
      .set(auth)
      .send({ en: { quote: 'Great trip', name: 'Ali' } });
    const id = body.item._id;
    const put = await request(app)
      .put(`/content/testimonial/${id}`)
      .set(auth)
      .send({ published: true, en: { quote: 'Great trip!', name: 'Ali', role: 'School trip' } });
    expect(put.body.item.en.quote).toBe('Great trip!');
    expect((await request(app).get('/content/testimonial?locale=en')).body.items[0]).toMatchObject({ quote: 'Great trip!', role: 'School trip' });

    expect((await request(app).delete(`/content/testimonial/${id}`).set(auth)).status).toBe(200);
    expect((await request(app).get('/content/testimonial')).body.items).toHaveLength(0);
  });

  it('404s an unknown content type', async () => {
    expect((await request(app).get('/content/recipes')).status).toBe(404);
  });
});
