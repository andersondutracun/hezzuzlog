import 'dotenv/config';

function int(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function json(name, fallback) {
  try { return JSON.parse(process.env[name] || ''); } catch { return fallback; }
}

export const config = {
  version: '3.1.0',
  port: int('PORT', 3001),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool('DATABASE_SSL', false),
  dbPoolMax: int('DB_POOL_MAX', 20),
  dbConnectTimeoutMs: int('DB_CONNECT_TIMEOUT_MS', 10_000),
  dbStartupRetries: int('DB_STARTUP_RETRIES', 30),
  dbStartupRetryMs: int('DB_STARTUP_RETRY_MS', 2_000),
  trustProxy: int('TRUST_PROXY', 1),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '4mb',

  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  authSecret: process.env.AUTH_SECRET || '',
  authTokenHours: int('AUTH_TOKEN_HOURS', 12),
  cookieName: process.env.AUTH_COOKIE_NAME || 'hezzuz_logs_session',
  cookieSecure: bool('AUTH_COOKIE_SECURE', true),
  loginRateMax: int('LOGIN_RATE_MAX', 10),
  loginRateWindowSeconds: int('LOGIN_RATE_WINDOW_SECONDS', 300),

  ingestKeys: json('HEZZUZ_INGEST_KEYS', {}),
  ingestMaxBatch: int('INGEST_MAX_BATCH', 100),
  ingestClockSkewSeconds: int('INGEST_CLOCK_SKEW_SECONDS', 300),
  ingestRatePerSecond: int('INGEST_RATE_PER_SECOND', 500),
  serverOfflineAfterSeconds: int('SERVER_OFFLINE_AFTER_SECONDS', 90),
  retentionDays: int('EVENT_RETENTION_DAYS', 90),
  retentionBatchSize: int('RETENTION_BATCH_SIZE', 50_000),

  discord: {
    mode: (process.env.DISCORD_FORWARD_MODE || 'critical').toLowerCase(),
    default: process.env.DISCORD_WEBHOOK_DEFAULT || '',
    moderation: process.env.DISCORD_WEBHOOK_MODERATION || '',
    errors: process.env.DISCORD_WEBHOOK_ERRORS || '',
    server: process.env.DISCORD_WEBHOOK_SERVER || '',
    throttleMs: int('DISCORD_THROTTLE_MS', 450)
  }
};

export function validateConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.adminPassword || ['CHANGE_THIS_NOW','MUDE_ESTA_SENHA'].includes(config.adminPassword)) missing.push('ADMIN_PASSWORD');
  if (!config.authSecret || config.authSecret.length < 32) missing.push('AUTH_SECRET (>=32 caracteres)');
  if (!Object.keys(config.ingestKeys).length) missing.push('HEZZUZ_INGEST_KEYS');
  if (missing.length) throw new Error(`Variaveis obrigatorias ausentes/inseguras: ${missing.join(', ')}`);
  if (!['off','critical','all'].includes(config.discord.mode)) throw new Error('DISCORD_FORWARD_MODE deve ser off, critical ou all');
}
