import crypto from 'node:crypto';
import { config } from './config.js';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  const got = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export function signAuthToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.authTokenHours * 3600;
  const payload = b64url(JSON.stringify({ sub: user.id, username: user.username, role: user.role, iat: now, exp }));
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyAuthToken(token) {
  try {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) return null;
    const data = `${header}.${payload}`;
    const expected = crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
    if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch { return null; }
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

export function tokenFromRequest(req) {
  const h = String(req.headers?.authorization || req.get?.('authorization') || '');
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7);
  const cookies = parseCookies(req.headers?.cookie || '');
  return cookies[config.cookieName] || '';
}

export function authCookie(token) {
  const maxAge = config.authTokenHours * 3600;
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${config.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearAuthCookie() {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

const nonces = new Map();
const rate = new Map();
const loginRate = new Map();

function cleanupMaps() {
  const now = Date.now();
  for (const [k, t] of nonces) if (now - t > 10 * 60_000) nonces.delete(k);
  for (const [k, v] of rate) if (now - v.window > 10_000) rate.delete(k);
  for (const [k, v] of loginRate) if (now - v.window > config.loginRateWindowSeconds * 1000) loginRate.delete(k);
}
setInterval(cleanupMaps, 60_000).unref();

export function checkLoginRate(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let bucket = loginRate.get(key);
  if (!bucket || now - bucket.window >= config.loginRateWindowSeconds * 1000) bucket = { window: now, count: 0 };
  bucket.count += 1;
  loginRate.set(key, bucket);
  const allowed = bucket.count <= config.loginRateMax;
  const retryAfter = Math.max(1, Math.ceil((config.loginRateWindowSeconds * 1000 - (now - bucket.window)) / 1000));
  return { allowed, retryAfter };
}

export function clearLoginRate(ip) {
  loginRate.delete(String(ip || 'unknown'));
}

export function verifyIngest(req) {
  const serverId = String(req.get('x-hezz-server') || '').trim().toLowerCase();
  const tsRaw = String(req.get('x-hezz-timestamp') || '');
  const nonce = String(req.get('x-hezz-nonce') || '');
  const signature = String(req.get('x-hezz-signature') || '').toLowerCase();
  const secret = config.ingestKeys[serverId];
  if (!serverId || !secret) return { ok: false, status: 401, error: 'Servidor desconhecido' };
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now()/1000) - ts) > config.ingestClockSkewSeconds) {
    return { ok: false, status: 401, error: 'Timestamp invalido' };
  }
  if (!nonce || nonce.length > 128) return { ok: false, status: 401, error: 'Nonce invalido' };
  const nonceKey = `${serverId}:${nonce}`;
  if (nonces.has(nonceKey)) return { ok: false, status: 409, error: 'Replay detectado' };

  const now = Date.now();
  let bucket = rate.get(serverId);
  if (!bucket || now - bucket.window >= 1000) bucket = { window: now, count: 0 };
  bucket.count += 1;
  rate.set(serverId, bucket);
  if (bucket.count > config.ingestRatePerSecond) return { ok: false, status: 429, error: 'Rate limit' };

  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const material = `${tsRaw}\n${nonce}\n${raw.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(material).digest('hex');
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return { ok: false, status: 401, error: 'Assinatura invalida' };
  }
  nonces.set(nonceKey, now);
  return { ok: true, serverId };
}

export function authMiddleware(req, res, next) {
  const user = verifyAuthToken(tokenFromRequest(req));
  if (!user) return res.status(401).json({ error: 'Nao autenticado' });
  req.user = user;
  next();
}
