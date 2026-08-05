import { useEffect, useState } from 'react';
import { BASE } from '../lib/api';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const bgUrl = (template) => {
  const u = template?.background_url || '';
  if (!u) return '';
  return /^https?:/i.test(u) ? u : `${BASE}${u}`;
};

// Absolute public verification URL for a certificate code (what the QR encodes).
export const verifyUrl = (code) => {
  if (!code) return '';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://iosdc.geu.ac.in';
  return `${origin}${BASE_PATH}/verify/${code}`;
};

// Values for the editor's sample render.
export const sampleValues = () => ({
  name: 'Saksham Joshi',
  date: '14 July – 17 July 2026',
  serial: 'IOSDC-2026-0001',
  issued_on: new Date().toLocaleDateString(),
  verify_url: verifyUrl('SAMPLE-CODE'),
});
export const SAMPLE = sampleValues();

// The concrete value set for an issued certificate (merges auto keys).
export const certValues = (cert) => ({
  ...(cert.values || {}),
  serial: cert.serial || '',
  issued_on: cert.issued_at ? new Date(cert.issued_at).toLocaleDateString() : '',
  verify_url: verifyUrl(cert.verify_code),
});

const imgCache = new Map();
function loadImage(src) {
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(src, img); resolve(img); };
    img.onerror = () => reject(new Error('Could not load the certificate background'));
    img.src = src;
  });
}

// Natural pixel size of a template's background (falls back to stored/default dims).
export async function templateDims(template) {
  try { const img = await loadImage(bgUrl(template)); return { w: img.naturalWidth, h: img.naturalHeight }; }
  catch { return { w: template.width || 1000, h: template.height || 707 }; }
}

// Render template + values to an image data URL. type 'image/jpeg' yields a much
// smaller file (used for bulk PDF export); 'image/png' is used for single downloads/preview.
export async function renderCertificateDataUrl(template, values, { scale = 2, type = 'image/png', quality = 0.95 } = {}) {
  const img = await loadImage(bgUrl(template));
  const w = img.naturalWidth || template.width || 1000;
  const h = img.naturalHeight || template.height || 700;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } // JPEG has no alpha
  ctx.drawImage(img, 0, 0, w, h);
  for (const f of template.fields || []) {
    const val = values?.[f.key];
    if (val == null || val === '') continue;
    if (f.type === 'qr') {
      const side = ((Number(f.size) || 15) / 100) * h;
      const QRCode = (await import('qrcode')).default;
      const qrPx = Math.max(240, Math.round(side * 4));
      const qrDataUrl = await QRCode.toDataURL(String(val), {
        margin: 1, width: qrPx, color: { dark: f.color || '#000000', light: '#ffffff' },
      });
      const qrImg = await new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('QR render failed')); im.src = qrDataUrl;
      });
      const cx = ((Number(f.x) || 85) / 100) * w;
      const cy = ((Number(f.y) || 82) / 100) * h;
      ctx.drawImage(qrImg, cx - side / 2, cy - side / 2, side, side);
      continue;
    }
    const size = ((Number(f.size) || 5) / 100) * h;
    ctx.font = `${f.bold ? '700' : '400'} ${size}px ${f.fontFamily || 'Helvetica, Arial, sans-serif'}`;
    ctx.fillStyle = f.color || '#111111';
    ctx.textAlign = f.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(val), ((Number(f.x) || 50) / 100) * w, ((Number(f.y) || 50) / 100) * h);
  }
  return canvas.toDataURL(type, quality);
}

// PNG data URL (single downloads + preview).
export function renderCertificatePng(template, values, scale = 2) {
  return renderCertificateDataUrl(template, values, { scale, type: 'image/png' });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// WYSIWYG preview: renders through the same canvas the download uses.
export function CertificatePreview({ template, values, style }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setErr('');
    if (!template?.background_url) { setUrl(''); return undefined; }
    renderCertificatePng(template, values, 2)
      .then((u) => { if (alive) setUrl(u); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [template, JSON.stringify(values)]);
  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>;
  if (!url) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Rendering…</div>;
  return <img src={url} alt="certificate" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)', display: 'block', ...style }} />;
}
