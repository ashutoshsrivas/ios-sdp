// Tiny localStorage-backed draft store for in-progress mentor input.
// Drafts live only on the mentor's device — they are never sent to the server,
// so the admin never sees them and they are not counted in results until Saved.
export function readDraft(key) {
  if (!key || typeof window === 'undefined') return null;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}

export function writeDraft(key, value) {
  if (!key || typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota/full — ignore */ }
}

export function clearDraft(key) {
  if (!key || typeof window === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
