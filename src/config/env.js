import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const REQUIRED_AT_BOOT = ['MONGO_URI', 'JWT_SECRET'];

/**
 * Load and validate environment variables.
 * @param {NodeJS.ProcessEnv} [source=process.env]
 * @param {{ requireBootVars?: boolean }} [options]
 */
export function loadEnv(source = process.env, options = {}) {
  const requireBootVars = options.requireBootVars !== false;

  if (requireBootVars) {
    const missing = REQUIRED_AT_BOOT.filter((key) => !source[key] || String(source[key]).trim() === '');
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(', ')}. ` +
          'Copy .env.example to .env and fill in the values.'
      );
    }
  }

  return {
    port: Number(source.PORT) || 3000,
    nodeEnv: source.NODE_ENV || 'development',
    mongoUri: source.MONGO_URI || '',
    jwtSecret: source.JWT_SECRET || '',
    corsOrigin: source.CORS_ORIGIN || '*',
    groqApiKey: source.GROQ_API_KEY || '',
    geminiApiKey: source.GEMINI_API_KEY || '',
    vapidPublicKey: source.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: source.VAPID_PRIVATE_KEY || '',
    vapidSubject: source.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
}

export { REQUIRED_AT_BOOT };