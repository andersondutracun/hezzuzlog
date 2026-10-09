export async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) };
  const r = await fetch(path, { ...options, headers, credentials:'same-origin' });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text ? { raw:text } : null; }
  if (r.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/me')) {
    location.href = '/login';
  }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

export async function logout() {
  try { await api('/api/v1/auth/logout', { method:'POST' }); } catch {}
  location.href = '/login';
}
