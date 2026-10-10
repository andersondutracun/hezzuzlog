import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { config, validateConfig } from './config.js';
import {
  pool, waitForDatabase, migrate, insertEvents, setHeartbeat,
  markStaleServersOffline, cleanupOldEvents, closeDatabase
} from './db.js';
import {
  hashPassword, verifyPassword, signAuthToken, authMiddleware, verifyIngest,
  authCookie, clearAuthCookie, checkLoginRate, clearLoginRate
} from './security.js';
import { attachWs, broadcastEvents, closeWs } from './ws.js';
import { forwardToDiscord } from './discord.js';

validateConfig();
await waitForDatabase();
await migrate();

async function ensureAdmin() {
  const existing = await pool.query('SELECT * FROM dashboard_users WHERE username=$1', [config.adminUsername]);
  if (existing.rows[0]) return;
  const { salt, hash } = hashPassword(config.adminPassword);
  await pool.query(
    'INSERT INTO dashboard_users(id,username,password_salt,password_hash,role) VALUES($1,$2,$3,$4,$5)',
    [crypto.randomUUID(), config.adminUsername, salt, hash, 'admin']
  );
  console.log(`[HEZZUZ Logs] usuario inicial criado: ${config.adminUsername}`);
}
await ensureAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(express.json({
  limit: config.requestBodyLimit,
  verify(req, _res, buf) { req.rawBody = Buffer.from(buf); }
}));

app.use((req, res, next) => {
  const requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 80);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/livez', (_req, res) => res.json({ ok:true, service:'hezzuz-logs', version:config.version }));
app.get('/readyz', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok:true, service:'hezzuz-logs', version:config.version, database:'ok', time:new Date().toISOString() });
}));
app.get('/healthz', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok:true, service:'hezzuz-logs', version:config.version, database:'ok', time:new Date().toISOString() });
}));
app.get('/api/healthz', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok:true, service:'hezzuz-logs', version:config.version, database:'ok', time:new Date().toISOString() });
}));

app.post('/api/v1/events/batch', asyncRoute(async (req, res) => {
  const auth = verifyIngest(req);
  if (!auth.ok) return res.status(auth.status).json({ error:auth.error });
  const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!incoming.length) return res.status(400).json({ error:'events vazio' });
  if (incoming.length > config.ingestMaxBatch) return res.status(413).json({ error:`max ${config.ingestMaxBatch}` });

  const normalized = [];
  for (const raw of incoming) {
    const occurred = new Date(raw.occurred_at || Date.now());
    if (Number.isNaN(occurred.getTime())) continue;
    normalized.push({
      id: /^[0-9a-f-]{36}$/i.test(String(raw.id || '')) ? raw.id : crypto.randomUUID(),
      server_id: auth.serverId,
      type: String(raw.type || 'UNKNOWN').slice(0, 80).toUpperCase(),
      category: String(raw.category || 'other').slice(0, 80).toLowerCase(),
      severity: String(raw.severity || 'INFO').slice(0, 16).toUpperCase(),
      source: String(raw.source || 'hezzchatdiscord').slice(0, 100),
      player_uuid: raw.player_uuid ? String(raw.player_uuid).slice(0, 64) : null,
      player_name: raw.player_name ? String(raw.player_name).slice(0, 64) : null,
      message: String(raw.message || '').slice(0, 12000),
      data: raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {},
      occurred_at: occurred.toISOString()
    });
  }
  if (!normalized.length) return res.status(400).json({ error:'nenhum evento valido' });

  const inserted = await insertEvents(normalized);
  broadcastEvents(inserted);
  forwardToDiscord(inserted);
  res.status(202).json({ accepted:inserted.length, received:incoming.length });
}));

app.post('/api/v1/heartbeat', asyncRoute(async (req, res) => {
  const auth = verifyIngest(req);
  if (!auth.ok) return res.status(auth.status).json({ error:auth.error });
  await setHeartbeat(auth.serverId, req.body || {});
  res.status(204).end();
}));

app.post('/api/v1/auth/login', asyncRoute(async (req, res) => {
  const gate = checkLoginRate(req.ip);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error:'Muitas tentativas. Aguarde e tente novamente.' });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const r = await pool.query('SELECT * FROM dashboard_users WHERE username=$1', [username]);
  const user = r.rows[0];
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    await pool.query(
      'INSERT INTO admin_audit(username,action,ip,data) VALUES($1,$2,$3,$4::jsonb)',
      [username || null, 'LOGIN_FAILED', req.ip, JSON.stringify({ request_id:req.requestId })]
    );
    return res.status(401).json({ error:'Usuario ou senha invalidos' });
  }

  clearLoginRate(req.ip);
  await pool.query('UPDATE dashboard_users SET last_login_at=now() WHERE id=$1', [user.id]);
  await pool.query(
    'INSERT INTO admin_audit(username,action,ip,data) VALUES($1,$2,$3,$4::jsonb)',
    [username, 'LOGIN_OK', req.ip, JSON.stringify({ request_id:req.requestId })]
  );
  const token = signAuthToken(user);
  res.setHeader('Set-Cookie', authCookie(token));
  res.json({ user:{ username:user.username, role:user.role } });
}));

app.post('/api/v1/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearAuthCookie());
  res.status(204).end();
});

app.get('/api/v1/auth/me', authMiddleware, (req, res) => res.json({ user:req.user }));

function parseRange(req) {
  const hours = Math.min(Math.max(Number(req.query.hours || 24), 1), 24 * 365);
  return { hours, server:String(req.query.server || '').trim() };
}

app.get('/api/v1/dashboard/summary', authMiddleware, asyncRoute(async (req, res) => {
  const { hours, server } = parseRange(req);
  const params = [hours];
  let serverSql = '';
  if (server) { params.push(server); serverSql = ' AND server_id=$2'; }
  const [counts, cats, servers] = await Promise.all([
    pool.query(`SELECT
      count(*)::int total,
      count(*) FILTER (WHERE type IN ('JOIN','FIRST_JOIN'))::int joins,
      count(*) FILTER (WHERE category='death')::int deaths,
      count(*) FILTER (WHERE category='moderation')::int moderation,
      count(*) FILTER (WHERE category='commands')::int commands,
      count(*) FILTER (WHERE severity IN ('ERROR','CRITICAL','SEVERE') OR category='errors')::int errors,
      count(DISTINCT player_uuid) FILTER (WHERE player_uuid IS NOT NULL)::int unique_players
      FROM events WHERE occurred_at >= now() - ($1::text || ' hours')::interval${serverSql}`, params),
    pool.query(`SELECT category, count(*)::int count FROM events
      WHERE occurred_at >= now() - ($1::text || ' hours')::interval${serverSql}
      GROUP BY category ORDER BY count DESC LIMIT 12`, params),
    pool.query('SELECT * FROM servers ORDER BY server_id')
  ]);
  res.json({ range_hours:hours, summary:counts.rows[0], categories:cats.rows, servers:servers.rows });
}));

app.get('/api/v1/events', authMiddleware, asyncRoute(async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const where = [];
  const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (req.query.server) add('server_id=?', String(req.query.server));
  if (req.query.category) add('category=?', String(req.query.category).toLowerCase());
  if (req.query.type) add('type=?', String(req.query.type).toUpperCase());
  if (req.query.severity) add('severity=?', String(req.query.severity).toUpperCase());
  if (req.query.player) { p.push(`%${String(req.query.player)}%`); where.push(`(player_name ILIKE $${p.length} OR player_uuid ILIKE $${p.length})`); }
  if (req.query.q) { p.push(`%${String(req.query.q)}%`); where.push(`message ILIKE $${p.length}`); }
  if (req.query.from) add('occurred_at >= ?', String(req.query.from));
  if (req.query.to) add('occurred_at <= ?', String(req.query.to));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countP = [...p];
  p.push(limit); const lidx = p.length;
  p.push((page - 1) * limit); const oidx = p.length;
  const [rows, count] = await Promise.all([
    pool.query(`SELECT * FROM events ${w} ORDER BY occurred_at DESC LIMIT $${lidx} OFFSET $${oidx}`, p),
    pool.query(`SELECT count(*)::int total FROM events ${w}`, countP)
  ]);
  res.json({ page, limit, total:count.rows[0].total, events:rows.rows });
}));

app.get('/api/v1/events/:id', authMiddleware, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error:'Nao encontrado' });
  res.json(r.rows[0]);
}));

app.get('/api/v1/players', authMiddleware, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const p = [];
  let w = 'WHERE player_uuid IS NOT NULL';
  if (q) { p.push(`%${q}%`); w += ` AND (player_name ILIKE $1 OR player_uuid ILIKE $1)`; }
  const r = await pool.query(`
    SELECT player_uuid,
      (array_agg(player_name ORDER BY occurred_at DESC) FILTER (WHERE player_name IS NOT NULL))[1] player_name,
      count(*)::int events, min(occurred_at) first_seen, max(occurred_at) last_seen,
      count(*) FILTER (WHERE category='death')::int deaths,
      count(*) FILTER (WHERE category='moderation')::int moderation
    FROM events ${w}
    GROUP BY player_uuid ORDER BY last_seen DESC LIMIT 100
  `, p);
  res.json({ players:r.rows });
}));

app.get('/api/v1/players/:uuid', authMiddleware, asyncRoute(async (req, res) => {
  const uuid = req.params.uuid;
  const [profile, recent] = await Promise.all([
    pool.query(`SELECT player_uuid,
      (array_agg(player_name ORDER BY occurred_at DESC) FILTER (WHERE player_name IS NOT NULL))[1] player_name,
      count(*)::int events, min(occurred_at) first_seen, max(occurred_at) last_seen,
      count(*) FILTER (WHERE type IN ('JOIN','FIRST_JOIN'))::int joins,
      count(*) FILTER (WHERE category='death')::int deaths,
      count(*) FILTER (WHERE category='moderation')::int moderation,
      count(*) FILTER (WHERE category='commands')::int commands,
      count(*) FILTER (WHERE category='trades')::int trades
      FROM events WHERE player_uuid=$1 GROUP BY player_uuid`, [uuid]),
    pool.query('SELECT * FROM events WHERE player_uuid=$1 ORDER BY occurred_at DESC LIMIT 200', [uuid])
  ]);
  if (!profile.rows[0]) return res.status(404).json({ error:'Jogador nao encontrado' });
  res.json({ player:profile.rows[0], events:recent.rows });
}));


app.get('/api/v1/players/:uuid/events', authMiddleware, asyncRoute(async (req, res) => {
  const uuid = req.params.uuid;
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
  const where = ['player_uuid=$1'];
  const params = [uuid];

  const add = (column, value) => {
    params.push(value);
    where.push(`${column}=$${params.length}`);
  };

  if (req.query.server) add('server_id', String(req.query.server));
  if (req.query.category) add('category', String(req.query.category).toLowerCase());
  if (req.query.type) add('type', String(req.query.type).toUpperCase());
  if (req.query.severity) add('severity', String(req.query.severity).toUpperCase());

  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0,200)}%`);
    const idx = params.length;
    where.push(`(message ILIKE $${idx} OR type ILIKE $${idx} OR category ILIKE $${idx} OR server_id ILIKE $${idx})`);
  }

  const hours = Number(req.query.hours || 0);
  if (Number.isFinite(hours) && hours > 0) {
    params.push(Math.min(Math.floor(hours), 24 * 365 * 5));
    where.push(`occurred_at >= now() - make_interval(hours => $${params.length}::int)`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const countParams = [...params];

  params.push(limit);
  const limitIdx = params.length;
  params.push((page - 1) * limit);
  const offsetIdx = params.length;

  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM events ${whereSql} ORDER BY occurred_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    ),
    pool.query(`SELECT count(*)::int total FROM events ${whereSql}`, countParams)
  ]);

  res.json({
    page,
    limit,
    total: count.rows[0].total,
    events: rows.rows
  });
}));

app.get('/api/v1/moderation', authMiddleware, asyncRoute(async (_req, res) => {
  const r = await pool.query("SELECT * FROM events WHERE category='moderation' ORDER BY occurred_at DESC LIMIT 500");
  res.json({ events:r.rows });
}));

app.get('/api/v1/errors', authMiddleware, asyncRoute(async (_req, res) => {
  const r = await pool.query("SELECT * FROM events WHERE category IN ('errors','console') AND severity IN ('WARNING','ERROR','CRITICAL','SEVERE') ORDER BY occurred_at DESC LIMIT 500");
  res.json({ events:r.rows });
}));

app.get('/api/v1/servers', authMiddleware, asyncRoute(async (_req, res) => {
  const r = await pool.query('SELECT * FROM servers ORDER BY server_id');
  res.json({ servers:r.rows });
}));

app.get('/api/v1/system/info', authMiddleware, asyncRoute(async (_req, res) => {
  const [db, eventCount] = await Promise.all([
    pool.query('SELECT current_database() database, version() version'),
    pool.query('SELECT count(*)::bigint total FROM events')
  ]);
  res.json({
    service:'HEZZUZ Logs', version:config.version,
    retention_days:config.retentionDays,
    events_total:eventCount.rows[0].total,
    database:db.rows[0].database
  });
}));

app.use((req, res) => res.status(404).json({ error:'Rota nao encontrada' }));
app.use((err, req, res, _next) => {
  console.error(`[HEZZUZ Logs] request=${req?.requestId || '-'}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error:'Erro interno', request_id:req?.requestId || null });
});

const server = http.createServer(app);
attachWs(server);
server.listen(config.port, '0.0.0.0', () => console.log(`[HEZZUZ Logs] backend ${config.version} em :${config.port}`));

const staleTimer = setInterval(() => markStaleServersOffline().catch(e => console.warn('[HEZZUZ Logs] heartbeat:', e.message)), 30_000);
staleTimer.unref();
const retentionTimer = setInterval(async () => {
  try {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const n = await cleanupOldEvents();
      total += n;
      if (n < config.retentionBatchSize) break;
    }
    if (total) console.log(`[HEZZUZ Logs] retencao removeu ${total} eventos antigos`);
  } catch (e) { console.warn('[HEZZUZ Logs] retencao:', e.message); }
}, 6 * 3600_000);
retentionTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[HEZZUZ Logs] ${signal}: encerramento gracioso...`);
  clearInterval(staleTimer);
  clearInterval(retentionTimer);
  closeWs();
  server.close(async () => {
    try { await closeDatabase(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
