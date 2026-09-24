import mongoose from 'mongoose';
import { getIo } from '../sockets/chat.js';
import { getPushStatus } from './push.js';

const startedAt = Date.now();

/**
 * Build a full system health report.
 * @param {{ deep?: boolean }} [options] deep=true probes LLM APIs
 */
export async function getHealthReport(options = {}) {
  const deep = Boolean(options.deep);
  const checks = {
    database: checkDatabase(),
    sockets: checkSockets(),
    llm: await checkLlm(deep),
    push: checkPush(),
  };

  const statuses = Object.values(checks).map((c) => c.status);
  let status = 'ok';
  if (statuses.includes('error')) status = 'error';
  else if (statuses.includes('degraded')) status = 'degraded';

  return {
    status,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks,
  };
}

function checkDatabase() {
  const readyState = mongoose.connection.readyState;
  const labels = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  const ok = readyState === 1;
  return {
    status: ok ? 'ok' : 'error',
    readyState,
    detail: labels[readyState] ?? `unknown(${readyState})`,
  };
}

function checkSockets() {
  const io = getIo();
  if (!io) {
    return {
      status: 'degraded',
      initialized: false,
      connections: 0,
      detail: 'Socket.io not attached (HTTP-only app instance)',
    };
  }

  let connections = 0;
  try {
    connections = io.engine?.clientsCount ?? 0;
  } catch {
    connections = 0;
  }

  return {
    status: 'ok',
    initialized: true,
    connections,
    detail: 'Socket.io ready',
  };
}

async function checkLlm(deep) {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

  const providers = {
    gemini: {
      configured: geminiConfigured,
      model,
      reachable: null,
    },
  };

  if (!geminiConfigured) {
    return {
      status: 'degraded',
      providers,
      detail: 'No GEMINI_API_KEY configured',
    };
  }

  if (deep) {
    providers.gemini.reachable = await pingGemini();

    return {
      status: providers.gemini.reachable ? 'ok' : 'error',
      providers,
      detail: providers.gemini.reachable
        ? 'Gemini reachable'
        : 'Gemini unreachable',
    };
  }

  return {
    status: 'ok',
    providers,
    detail: 'GEMINI_API_KEY present (use ?deep=1 to ping)',
  };
}

function checkPush() {
  const snap = getPushStatus();
  if (!snap.vapidConfigured) {
    return {
      status: 'degraded',
      ...snap,
      detail: 'VAPID keys not set — push notifications disabled',
    };
  }
  return {
    status: snap.ready ? 'ok' : 'degraded',
    ...snap,
    detail: snap.ready ? 'Web Push ready' : 'VAPID set but push not initialized',
  };
}

async function pingGemini() {
  try {
    const key = process.env.GEMINI_API_KEY;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { signal: AbortSignal.timeout(8000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}
