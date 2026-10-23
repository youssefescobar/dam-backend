import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Admin } from '../../src/models/Admin.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';

describe('change password and KB import', () => {
  let app;
  let admin;
  let token;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    await startTestDb();
    app = createApp();
  });

  afterAll(stopTestDb);

  beforeEach(async () => {
    await clearDb();
    admin = await Admin.create({ name: 'A', email: 'a@test.com', passwordHash: await bcrypt.hash('old-password', 4) });
    token = (await request(app).post('/auth/login').send({ email: 'a@test.com', password: 'old-password' })).body.token;
  });

  const change = (body, t = token) =>
    request(app).post('/auth/password').set('Authorization', `Bearer ${t}`).send(body);

  it('changes the password, keeps this device signed in and signs out the others', async () => {
    // A token from an earlier second, like one on another phone.
    const otherDevice = jwt.sign(
      { sub: admin._id.toString(), iat: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET
    );

    const res = await change({ currentPassword: 'old-password', newPassword: 'new-password-1' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    const me = (t) => request(app).get('/conversations').set('Authorization', `Bearer ${t}`);
    expect((await me(res.body.token)).status).toBe(200);
    expect((await me(otherDevice)).status).toBe(401);

    const oldLogin = await request(app).post('/auth/login').send({ email: 'a@test.com', password: 'old-password' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/auth/login').send({ email: 'a@test.com', password: 'new-password-1' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const res = await change({ currentPassword: 'nope', newPassword: 'new-password-1' });
    expect(res.status).toBe(400);
    expect(res.body.fields.currentPassword).toBeTruthy();
  });

  it('rejects a short or unchanged new password', async () => {
    expect((await change({ currentPassword: 'old-password', newPassword: 'short' })).status).toBe(400);
    expect((await change({ currentPassword: 'old-password', newPassword: 'old-password' })).status).toBe(400);
  });

  it('needs a login', async () => {
    const res = await request(app).post('/auth/password').send({ currentPassword: 'old-password', newPassword: 'new-password-1' });
    expect(res.status).toBe(401);
  });

  it('KB import over HTTP never deletes existing entries', async () => {
    await KnowledgeBaseEntry.create({ title: 'Hours', content: 'Nine to five', locale: 'en' });
    const res = await request(app)
      .post('/kb/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ csv: 'title,content,locale\nWifi,Yes,ar', replaceAll: true });
    expect(res.status).toBe(201);
    expect(await KnowledgeBaseEntry.countDocuments()).toBe(2);
  });
});
