/**
 * Fire Web Push notifications to all subscribed admins.
 *
 * Prerequisites:
 *   - Admin PWA/browser has enabled notifications (subscribed)
 *   - .env has MONGO_URI + VAPID_* keys (same as the running API)
 *
 * Usage:
 *   node scripts/testPush.js
 *   node scripts/testPush.js --only=quote
 *   node scripts/testPush.js --only=escalation,test
 *   node scripts/testPush.js --delay=3000
 *   node scripts/testPush.js --list
 *
 * Types:
 *   quote       — new quote request  → opens /quotes
 *   escalation  — chat needs human   → opens /inbox
 *   claimed     — conversation claimed (test)
 *   closed      — conversation closed (test)
 *   test        — generic ping
 *   long        — long body / truncation check
 *   all         — every type above (default)
 */
import dotenv from 'dotenv';
import { loadEnv } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Admin } from '../src/models/Admin.js';
import { initPush, notifyAdmins, getPushStatus } from '../src/services/push.js';

dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const delayMs = Number(args.find((a) => a.startsWith('--delay='))?.slice('--delay='.length) || 2000);
const listOnly = args.includes('--list');

const CATALOG = {
  quote: {
    title: 'New quote request',
    body: 'Push Test Customer: Airport → Hotel',
    data: {
      type: 'quote',
      quoteId: 'test-quote-id',
      url: '/quotes',
    },
  },
  escalation: {
    title: 'Chat waiting',
    body: 'A customer asked to speak with someone.',
    data: {
      type: 'escalation',
      conversationId: 'test-conversation-id',
      reason: 'low_similarity',
      url: '/inbox',
    },
  },
  claimed: {
    title: 'Conversation claimed',
    body: 'An admin claimed a live chat thread',
    data: {
      type: 'claimed',
      conversationId: 'test-conversation-id',
      url: '/inbox',
    },
  },
  closed: {
    title: 'Conversation closed',
    body: 'A live chat was marked closed',
    data: {
      type: 'closed',
      conversationId: 'test-conversation-id',
      url: '/inbox',
    },
  },
  test: {
    title: 'DAMAC test ping',
    body: `Hello from testPush.js @ ${new Date().toISOString()}`,
    data: {
      type: 'test',
      url: '/quotes',
    },
  },
  long: {
    title: 'Long notification body',
    body:
      'This is a longer push body to check truncation and wrapping on phone lock screens. ' +
      'Pickup Riyadh Airport T1 to Durrah Al Munawwara compound — VIP van, 6 passengers, ' +
      'notes: child seat requested, flight SV1234.',
    data: {
      type: 'quote',
      quoteId: 'test-long-quote',
      url: '/quotes',
    },
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveTypes() {
  if (!onlyArg || onlyArg === 'all') return Object.keys(CATALOG);
  const requested = onlyArg.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((t) => !CATALOG[t]);
  if (unknown.length) {
    throw new Error(`Unknown type(s): ${unknown.join(', ')}. Valid: ${Object.keys(CATALOG).join(', ')}, all`);
  }
  return requested;
}

async function main() {
  loadEnv();
  initPush();

  const status = getPushStatus();
  if (!status.vapidConfigured) {
    throw new Error('VAPID keys missing in .env — cannot send push');
  }

  await connectDb(process.env.MONGO_URI);

  const admins = await Admin.find({ 'pushSubscriptions.0': { $exists: true } })
    .select('email name pushSubscriptions')
    .lean();

  const subCount = admins.reduce((n, a) => n + (a.pushSubscriptions?.length || 0), 0);

  console.log(`VAPID: ready`);
  console.log(`Subscribed admins: ${admins.length} (${subCount} endpoint(s))`);
  for (const a of admins) {
    console.log(`  - ${a.email || a.name}: ${a.pushSubscriptions.length} subscription(s)`);
  }

  if (listOnly) {
    await disconnectDb();
    return;
  }

  if (admins.length === 0) {
    console.error('\nNo push subscriptions found.');
    console.error('Open the admin PWA/site → enable Notifications, then re-run.');
    process.exitCode = 1;
    await disconnectDb();
    return;
  }

  const types = resolveTypes();
  console.log(`\nSending ${types.length} notification(s) with ${delayMs}ms gap…\n`);

  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const payload = CATALOG[type];
    console.log(`[${i + 1}/${types.length}] ${type}`);
    console.log(`    title: ${payload.title}`);
    console.log(`    body:  ${payload.body}`);
    console.log(`    data:  ${JSON.stringify(payload.data)}`);
    await notifyAdmins(payload);
    if (i < types.length - 1) await sleep(delayMs);
  }

  console.log('\nDone. Check the installed PWA / browser for notifications.');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
