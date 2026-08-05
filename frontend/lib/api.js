const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

async function request(path, { method = 'GET', body, isForm } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: async (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/uploads', { method: 'POST', body: form, isForm: true });
  },
  uploadTo: async (path, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(path, { method: 'POST', body: form, isForm: true });
  },
  // Upload a chat file (<=100MB) with an optional caption; broadcast happens server-side.
  chatUpload: async (teamId, file, caption) => {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    return request(`/api/chat/${teamId}/upload`, { method: 'POST', body: form, isForm: true });
  },
  // Fetch a binary response (with auth) and trigger a browser download.
  downloadFile: async (path, filename) => {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = `Download failed (${res.status})`;
      try { msg = JSON.parse(text).error || msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};

// Build a ws(s):// URL against the API origin, appending the auth token.
// e.g. wsUrl('/api/ws', '&team=3') → wss://host/bootcamp/api/ws?token=…&team=3
export function wsUrl(path, extra = '') {
  let base = BASE;
  if (!/^https?:/i.test(base) && typeof window !== 'undefined') base = window.location.origin + base;
  const token = getToken() || '';
  return `${base.replace(/^http/i, 'ws')}${path}?token=${encodeURIComponent(token)}${extra}`;
}

export { BASE };
