import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js';
import { Customer } from '../../src/models/Customer.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { Admin } from '../../src/models/Admin.js';
import { sweepIdleConversations } from '../../src/services/conversationLifecycle.js';
import { setNotifyAdminImplementation, setPushImplementation } from '../../src/services/push.js';
import bcrypt from 'bcryptjs';

describe('Conversation idle auto-close', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
    process.env.CHAT_CLAIMED_IDLE_MS = '1000';
    process.env.CHAT_NEEDS_HUMAN_IDLE_MS = '1000';
    process.env.CHAT_AI_IDLE_MS = '1000';
    await startTestDb();
  });

  afterAll(async () => {
    delete process.env.CHAT_CLAIMED_IDLE_MS;
    delete process.env.CHAT_NEEDS_HUMAN_IDLE_MS;
    delete process.env.CHAT_AI_IDLE_MS;
    setNotifyAdminImplementation(null);
    setPushImplementation(null);
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    setNotifyAdminImplementation(null);
    setPushImplementation(null);
  });

  it('auto-closes a claimed chat after inactivity', async () => {
    const pushes = [];
    setNotifyAdminImplementation(async (adminId, payload) => {
      pushes.push({ adminId, payload });
    });

    const admin = await Admin.create({
      name: 'A',
      email: 'a@test.com',
      passwordHash: await bcrypt.hash('x', 4),
    });
    const customer = await Customer.create({
      name: 'C',
      email: 'c@test.com',
      phone: '+15555551999',
      contact: '+15555551999',
    });
    const conversation = await Conversation.create({
      customerId: customer._id,
      status: 'claimed',
      assignedAdminId: admin._id,
      lastActivityAt: new Date(Date.now() - 60_000),
    });

    const closed = await sweepIdleConversations();
    expect(closed).toBeGreaterThanOrEqual(1);

    const refreshed = await Conversation.findById(conversation._id);
    expect(refreshed.status).toBe('closed');

    const notices = await Message.find({
      conversationId: conversation._id,
      sender: 'system',
    });
    expect(notices.some((m) => /inactivity/i.test(m.text))).toBe(true);
    expect(pushes.some((p) => String(p.adminId) === String(admin._id))).toBe(true);
  });
});
