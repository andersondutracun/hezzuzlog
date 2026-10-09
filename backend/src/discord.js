import { config } from './config.js';

const queue = [];
let running = false;

function webhookFor(e) {
  if (e.category === 'moderation') return config.discord.moderation || config.discord.default;
  if (['errors','console'].includes(e.category) && ['ERROR','CRITICAL'].includes(e.severity)) return config.discord.errors || config.discord.default;
  if (['server','activity'].includes(e.category)) return config.discord.server || config.discord.default;
  return config.discord.default;
}

function shouldForward(e) {
  if (config.discord.mode === 'off') return false;
  if (config.discord.mode === 'all') return true;
  return e.category === 'moderation' || ['ERROR','CRITICAL'].includes(e.severity) || ['SERVER_START','SERVER_STOP','KICK','LOGIN_DENIED'].includes(e.type);
}

function format(e) {
  const who = e.player_name ? ` • **${e.player_name}**` : '';
  return `**[${e.server_id}] [${e.category}] [${e.type}]**${who}\n${String(e.message || '').slice(0, 1800)}`;
}

async function postWithRetry(url, payload) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) return true;
      if (r.status === 429) {
        let ms = Number(r.headers.get('retry-after') || 1) * 1000;
        try { const j = await r.json(); if (j?.retry_after) ms = Number(j.retry_after) * 1000; } catch {}
        await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(ms, 500), 15_000)));
        continue;
      }
      if (r.status >= 500) { await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1))); continue; }
      return false;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  return false;
}

async function worker() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const e = queue.shift();
      const url = webhookFor(e);
      if (url) await postWithRetry(url, { username: `HEZZUZ Logs • ${e.server_id}`, content: format(e) });
      if (config.discord.throttleMs > 0) await new Promise(r => setTimeout(r, config.discord.throttleMs));
    }
  } finally { running = false; }
}

export function forwardToDiscord(events) {
  for (const e of events) if (shouldForward(e)) queue.push(e);
  worker();
}
