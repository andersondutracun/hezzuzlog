import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: config.dbConnectTimeoutMs,
  allowExitOnIdle: false
});

pool.on('error', err => console.error('[HEZZUZ Logs] PostgreSQL pool:', err));

export async function waitForDatabase() {
  let last;
  for (let i = 1; i <= config.dbStartupRetries; i++) {
    try {
      await pool.query('SELECT 1');
      if (i > 1) console.log(`[HEZZUZ Logs] PostgreSQL disponivel apos ${i} tentativas.`);
      return;
    } catch (e) {
      last = e;
      console.warn(`[HEZZUZ Logs] aguardando PostgreSQL (${i}/${config.dbStartupRetries}): ${e.message}`);
      await new Promise(r => setTimeout(r, config.dbStartupRetryMs));
    }
  }
  throw last || new Error('PostgreSQL indisponivel');
}

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id uuid PRIMARY KEY,
      username text UNIQUE NOT NULL,
      password_salt text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS servers (
      server_id text PRIMARY KEY,
      display_name text,
      status text NOT NULL DEFAULT 'offline',
      version text,
      players_online integer NOT NULL DEFAULT 0,
      last_heartbeat_at timestamptz,
      last_event_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS events (
      id uuid PRIMARY KEY,
      server_id text NOT NULL,
      type text NOT NULL,
      category text NOT NULL,
      severity text NOT NULL DEFAULT 'INFO',
      source text NOT NULL DEFAULT 'hezzchatdiscord',
      player_uuid text,
      player_name text,
      message text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_occurred_brin ON events USING brin (occurred_at);
    CREATE INDEX IF NOT EXISTS idx_events_server_time ON events (server_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_category_time ON events (category, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (type, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_player_uuid_time ON events (player_uuid, occurred_at DESC) WHERE player_uuid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_events_player_name_lower ON events (lower(player_name)) WHERE player_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_events_severity_time ON events (severity, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS admin_audit (
      id bigserial PRIMARY KEY,
      username text,
      action text NOT NULL,
      ip text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit (created_at DESC);
  `);
}

export async function insertEvents(events) {
  if (!events.length) return [];
  const payload = events.map(e => ({
    id: e.id,
    server_id: e.server_id,
    type: e.type,
    category: e.category,
    severity: e.severity,
    source: e.source,
    player_uuid: e.player_uuid || null,
    player_name: e.player_name || null,
    message: e.message,
    data: e.data || {},
    occurred_at: e.occurred_at
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      INSERT INTO events
        (id, server_id, type, category, severity, source, player_uuid, player_name, message, data, occurred_at)
      SELECT x.id, x.server_id, x.type, x.category, x.severity, x.source,
             x.player_uuid, x.player_name, x.message, x.data, x.occurred_at
      FROM jsonb_to_recordset($1::jsonb) AS x(
        id uuid,
        server_id text,
        type text,
        category text,
        severity text,
        source text,
        player_uuid text,
        player_name text,
        message text,
        data jsonb,
        occurred_at timestamptz
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `, [JSON.stringify(payload)]);

    await client.query(`
      INSERT INTO servers (server_id, display_name, status, last_event_at, updated_at)
      SELECT DISTINCT x.server_id, x.server_id, 'online', now(), now()
      FROM jsonb_to_recordset($1::jsonb) AS x(server_id text)
      ON CONFLICT (server_id) DO UPDATE SET
        status='online', last_event_at=now(), updated_at=now()
    `, [JSON.stringify(payload)]);

    await client.query('COMMIT');
    return r.rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function setHeartbeat(serverId, body = {}) {
  const players = Number.isFinite(Number(body.players_online)) ? Number(body.players_online) : 0;
  const display = String(body.display_name || serverId).slice(0, 100);
  const version = String(body.version || '').slice(0, 160) || null;
  await pool.query(`
    INSERT INTO servers (server_id, display_name, status, version, players_online, last_heartbeat_at, updated_at, metadata)
    VALUES ($1,$2,'online',$3,$4,now(),now(),$5::jsonb)
    ON CONFLICT (server_id) DO UPDATE SET
      display_name=EXCLUDED.display_name,
      status='online',
      version=EXCLUDED.version,
      players_online=EXCLUDED.players_online,
      last_heartbeat_at=now(),
      updated_at=now(),
      metadata=EXCLUDED.metadata
  `, [serverId, display, version, players, JSON.stringify(body.metadata || {})]);
}

export async function markStaleServersOffline() {
  await pool.query(`
    UPDATE servers SET status='offline', players_online=0, updated_at=now()
    WHERE status <> 'offline'
      AND COALESCE(last_heartbeat_at,last_event_at) < now() - ($1::text || ' seconds')::interval
  `, [config.serverOfflineAfterSeconds]);
}

export async function cleanupOldEvents() {
  if (config.retentionDays <= 0) return 0;
  const r = await pool.query(`
    WITH doomed AS (
      SELECT ctid FROM events
      WHERE occurred_at < now() - ($1::text || ' days')::interval
      ORDER BY occurred_at
      LIMIT $2
    )
    DELETE FROM events e USING doomed d WHERE e.ctid=d.ctid
  `, [config.retentionDays, config.retentionBatchSize]);
  return r.rowCount || 0;
}

export async function closeDatabase() {
  await pool.end();
}
