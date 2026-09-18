import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app.js';
import { startTestDb, stopTestDb } from '../helpers/db.js';
import { boot } from '../../src/server.js';
import { disconnectDb } from '../../src/config/db.js';
import { setIo } from '../../src/sockets/chat.js';

describe('GET /health', () => {
  beforeAll(async () => {
    await startTestDb();
  });

  afterAll(async () => {
    await stopTestDb();
  });

  it('returns 200 with checks for db, sockets, embeddings, llm, push', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.checks.database.detail).toBe('connected');
    expect(res.body.checks.sockets).toBeDefined();
    expect(res.body.checks.embeddings).toBeDefined();
    expect(res.body.checks.llm).toBeDefined();
    expect(res.body.checks.push).toBeDefined();
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('reports sockets ok when Socket.io is attached', async () => {
    setIo({
      engine: { clientsCount: 3 },
      to: () => ({ emit: () => {} }),
      on: () => {},
    });
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.body.checks.sockets.status).toBe('ok');
    expect(res.body.checks.sockets.connections).toBe(3);
    setIo(null);
  });
});

describe('Mongo connection', () => {
  it('succeeds against an in-memory MongoDB (Atlas substitute for CI)', async () => {
    const mem = await MongoMemoryServer.create();
    const uri = mem.getUri();

    const { server } = await boot({
      env: {
        MONGO_URI: uri,
        JWT_SECRET: 'test-secret',
        PORT: '0',
      },
      listen: false,
    });

    expect(server).toBeDefined();

    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.checks.sockets.status).toBe('ok');

    await disconnectDb();
    await mem.stop();
  });
});