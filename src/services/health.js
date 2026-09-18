import mongoose from 'mongoose';
import { getIo } from '../sockets/chat.js';
import { getEmbeddingStatus, embed } from './embedding.js';
import { getPushStatus } from './push.js';

const startedAt = Date.now();

/**
 * Build a full system health report.
 * @param {{ deep?: boolean }} [options] deep=true probes LLM APIs and runs a tiny embed
 */
export async function getHealthReport(options = {}) {
  const deep = Boolean(options.deep);
  const checks = {
    database: checkDatabase(),
    sockets: checkSockets(),
    embeddings: await checkEmbeddings(deep),
    llm: await checkLlm(deep),
    push: checkPush(),
  };

  const statuses = Object.values(checks).map((c) => c.status);
  let status = 'ok';
  if (statuses.includes('error')) status = 'error';
  else if (statuses.includes('degraded') || statuses.includes('idle')) status = 'degraded';

  // idle embeddings alone shouldn't force degraded if LLM is ready —
  // embeddings load lazily; treat idle as ok for overall unless deep failed
  if (status === 'degraded' && checks.embeddings.status === 'idle') {
    const others = Object.entries(checks)
      .filter(([k]) => k !== 'embeddings')
      .map(([, c]) => c.status);
    if (!others.includes('error') && !others.includes('degraded')) {
      status = 'ok';
    }
  }

  return {
    status,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks,
  };
}

function checkDatabase() {
  const readyState = mongoose.connection.readyState;
  // 0=disconnected 1=connected 2=connecting 3=disconnecting
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

async function checkEmbeddings(deep) {
  const snap = getEmbeddingStatus();
  if (snap.override) {
    return {
      status: 'ok',
      ...snap,
      detail: 'Embed override active (tests)',
    };
  }

  if (!deep) {
    return {
      status: snap.loaded ? 'ok' : 'idle',
      ...snap,
      detail: snap.loaded
        ? 'Model loaded'
        : snap.loading
          ? 'Model loading'
          : 'Model not loaded yet (lazy — use ?deep=1 to warm)',
    };
  }

  try {
    const vec = await embed('health-check');
    return {
      status: 'ok',
      model: snap.model,
      loaded: true,
      loading: false,
      override: false,
      dimensions: vec.length,
      detail: 'Embed probe succeeded',
    };
  } catch (err) {
    return {
      status: 'error',
      ...getEmbeddingStatus(),
      detail: err.message || 'Embed probe failed',
    };
  }
}

async function checkLlm(deep) {
  const groqConfigured = Boolean(process.env.GROQ_API_KEY);
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

  const providers = {
    groq: {
      configured: groqConfigured,
      reachable: null,
    },
    gemini: {
      configured: geminiConfigured,
      reachable: null,
    },
  };

  if (!groqConfigured && !geminiConfigured) {
    return {
      status: 'degraded',
      providers,
      detail: 'No GROQ_API_KEY or GEMINI_API_KEY configured',
    };
  }

  if (deep) {
    if (groqConfigured) {
      providers.groq.reachable = await pingGroq();
    }
    if (geminiConfigured) {
      providers.gemini.reachable = await pingGemini();
    }

    const anyUp =
      providers.groq.reachable === true || providers.gemini.reachable === true;
    const anyConfiguredDown =
      (groqConfigured && providers.groq.reachable === false) ||
      (geminiConfigured && providers.gemini.reachable === false);

    return {
      status: anyUp ? 'ok' : 'error',
      providers,
      detail: anyUp
        ? 'At least one LLM provider reachable'
        : anyConfiguredDown
          ? 'Configured LLM provider(s) unreachable'
          : 'LLM probe inconclusive',
    };
  }

  return {
    status: 'ok',
    providers,
    detail: 'API key(s) present (use ?deep=1 to ping providers)',
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

async function pingGroq() {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
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