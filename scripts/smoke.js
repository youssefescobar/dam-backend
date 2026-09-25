/**
 * Smoke tests against a running API.
 * Usage: BASE_URL=http://127.0.0.1:3000 node scripts/smoke.js
 *
 * Optional: ADMIN_EMAIL, ADMIN_PASSWORD for authenticated cleanup.
 */
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function main() {
  console.log(`Smoke testing ${BASE}`);

  const health = await fetch(`${BASE}/health`);
  const healthBody = await health.json();
  if (!health.ok || healthBody.status !== 'ok') {
    throw new Error(`/health failed: ${health.status} ${JSON.stringify(healthBody)}`);
  }
  console.log('✓ GET /health');

  const quoteRes = await fetch(`${BASE}/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Smoke Test',
      customerContact: `smoke-${Date.now()}@example.com`,
      pickup: 'Smoke Pickup',
      dropoff: 'Smoke Dropoff',
      date: new Date().toISOString(),
      vehicleType: 'sedan',
      passengers: 2,
      notes: 'smoke-test-cleanup',
    }),
  });
  const quoteBody = await quoteRes.json();
  if (quoteRes.status !== 201) {
    throw new Error(`POST /quotes failed: ${quoteRes.status} ${JSON.stringify(quoteBody)}`);
  }
  console.log('✓ POST /quotes');

  const sessionRes = await fetch(`${BASE}/chat/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Chat',
      email: `smoke-chat-${Date.now()}@example.com`,
      phone: `+1555${String(Date.now()).slice(-7)}`,
    }),
  });
  const sessionBody = await sessionRes.json();
  if (sessionRes.status !== 201 || !sessionBody.conversationId) {
    throw new Error(`POST /chat/session failed: ${sessionRes.status} ${JSON.stringify(sessionBody)}`);
  }
  console.log('✓ POST /chat/session');

  const chatRes = await fetch(`${BASE}/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'talk to a human',
      conversationId: sessionBody.conversationId,
    }),
  });
  const chatBody = await chatRes.json();
  if (!chatRes.ok || !chatBody.escalated) {
    throw new Error(`POST /chat/message unexpected: ${chatRes.status} ${JSON.stringify(chatBody)}`);
  }
  console.log('✓ POST /chat/message (escalation path)');

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = await login.json();
    if (!login.ok) throw new Error(`login failed: ${JSON.stringify(loginBody)}`);

    const patch = await fetch(`${BASE}/quotes/${quoteBody.quote._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ status: 'lost', notes: 'smoke cleanup' }),
    });
    if (!patch.ok) throw new Error(`cleanup patch failed: ${patch.status}`);
    console.log('✓ quote lifecycle patch + cleanup');
  } else {
    console.log('ℹ skip admin cleanup (set ADMIN_EMAIL / ADMIN_PASSWORD to enable)');
  }

  console.log('All smoke checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
