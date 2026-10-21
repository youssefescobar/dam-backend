import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { Customer } from '../../src/models/Customer.js';
import { Conversation } from '../../src/models/Conversation.js';

const R2_ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_PUBLIC_BUCKET: 'pub-bucket',
  R2_PRIVATE_BUCKET: 'priv-bucket',
  R2_PUBLIC_URL: 'https://cdn.test',
};

describe('File uploads (presigned R2 URLs)', () => {
  let app;
  let auth;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    Object.assign(process.env, R2_ENV);
    await startTestDb();
    app = createApp();
  });

  afterAll(async () => {
    for (const k of Object.keys(R2_ENV)) delete process.env[k];
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

  it('presigns admin uploads to the public bucket with a server-made key', async () => {
    expect((await request(app).post('/uploads').send({ contentType: 'image/png', size: 10 })).status).toBe(401);

    const bad = await request(app).post('/uploads').set(auth).send({ contentType: 'image/svg+xml', size: 10 });
    expect(bad.status).toBe(400);
    const MB = 1024 * 1024;
    expect((await request(app).post('/uploads').set(auth).send({ contentType: 'image/png', size: 11 * MB })).status).toBe(400);
    expect((await request(app).post('/uploads').set(auth).send({ contentType: 'video/mp4', size: 90 * MB })).status).toBe(200);
    expect((await request(app).post('/uploads').set(auth).send({ contentType: 'video/mp4', size: 101 * MB })).status).toBe(400);

    const res = await request(app).post('/uploads').set(auth).send({ contentType: 'image/png', size: 1234 });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/^admin\/\d{4}-\d{2}\/[a-f0-9-]{36}\.png$/);
    expect(res.body.url).toBe(`https://cdn.test/${res.body.key}`);
    expect(res.body.uploadUrl).toContain('pub-bucket');
    expect(res.body.uploadUrl).not.toMatch(/checksum/i);
    expect(new URL(res.body.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  });

  it('presigns chat uploads only for an open conversation, into the private bucket', async () => {
    const customer = await Customer.create({ name: 'C', phone: '0500000000', contact: '0500000000' });
    const convo = await Conversation.create({ customerId: customer._id });
    const body = { conversationId: String(convo._id), contentType: 'application/pdf', size: 2048 };

    const res = await request(app).post('/chat/upload').send(body);
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(new RegExp(`^chat/${convo._id}/[a-f0-9-]{36}\\.pdf$`));
    expect(res.body.uploadUrl).toContain('priv-bucket');
    expect(res.body.url).toBeUndefined();

    expect((await request(app).post('/chat/upload').send({ ...body, size: 11 * 1024 * 1024 })).status).toBe(400);
    expect((await request(app).post('/chat/upload').send({ ...body, conversationId: 'a'.repeat(24) })).status).toBe(404);
    convo.status = 'closed';
    await convo.save();
    expect((await request(app).post('/chat/upload').send(body)).status).toBe(404);

    const read = await request(app).get('/uploads/private').query({ key: res.body.key }).set(auth);
    expect(read.status).toBe(200);
    expect(read.body.url).toContain('priv-bucket');
    expect((await request(app).get('/uploads/private').query({ key: '../admin/x' }).set(auth)).status).toBe(400);
  });

  it('returns 503 when R2 is not configured', async () => {
    const saved = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;
    const res = await request(app).post('/uploads').set(auth).send({ contentType: 'image/png', size: 10 });
    process.env.R2_ACCOUNT_ID = saved;
    expect(res.status).toBe(503);
  });
});
