import { useEffect, useRef, useState } from 'react';
import { BASE } from '../lib/api';

/**
 * Renders a design: the background image with each text area drawn on top.
 *
 * Positions are percentages of the background, so one layout renders at any
 * canvas size. The background is served same-origin by /api/designs/bg/:file
 * precisely so the canvas stays untainted and toDataURL() works — an S3 URL
 * would make every download throw a SecurityError.
 */

// Wrap text to a pixel width, honouring explicit newlines the student typed.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width <= maxWidth || !line) {
        line = attempt;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The largest font size at or below the field's own that still fits the text
 * inside its box. Students type as much as they like and the text shrinks to
 * fit rather than spilling over the artwork.
 *
 * Shared by the canvas renderer and the on-design editor so what a student
 * types looks exactly like what downloads.
 */
export function fitFontSize(ctx, text, f, boxW, boxH) {
  const base = f.fontSize;
  if (!text) return base;
  const MIN = 7;
  const fits = (size) => {
    ctx.font = `${f.bold ? '700' : '400'} ${size}px ${f.fontFamily}`;
    const lines = wrapText(ctx, text, boxW);
    return lines.length * size * f.lineHeight <= boxH;
  };
  if (fits(base)) return base;
  // Binary search rather than stepping down one px at a time: this runs on
  // every keystroke, for every field.
  let lo = MIN;
  let hi = base;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return Math.max(MIN, Math.floor(lo * 2) / 2);
}

// A context used only for measuring, so callers don't each make one.
let measureCtx = null;
export function getMeasureContext() {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

export function drawDesign(canvas, img, design, values, opts = {}) {
  const w = design.width || img.naturalWidth || 1200;
  const h = design.height || img.naturalHeight || 850;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  for (const f of design.fields || []) {
    const text = values?.[f.key];
    // In the editor, show the label so an empty area is still visible.
    const shown = text || (opts.showPlaceholders ? (f.placeholder || f.label) : '');
    if (!shown) continue;

    const boxX = (f.x / 100) * w;
    const boxY = (f.y / 100) * h;
    const boxW = (f.w / 100) * w;
    const boxH = (f.h / 100) * h;
    // Shrink to fit the box rather than overflowing the artwork.
    const size = fitFontSize(ctx, shown, f, boxW, boxH);

    ctx.font = `${f.bold ? '700' : '400'} ${size}px ${f.fontFamily}`;
    ctx.fillStyle = text ? f.color : (opts.placeholderColor || 'rgba(0,0,0,0.35)');
    ctx.textAlign = f.align;
    ctx.textBaseline = 'top';

    const lines = wrapText(ctx, shown, boxW);
    const lineH = size * f.lineHeight;
    // textAlign is relative to this anchor, so it shifts with the alignment.
    const anchorX = f.align === 'center' ? boxX + boxW / 2 : f.align === 'right' ? boxX + boxW : boxX;

    // A CSS line box puts half the leading ABOVE the glyphs, but canvas
    // textBaseline:'top' starts them at the very top. Without this offset the
    // downloaded PNG sits higher than the text the student typed in place.
    const halfLeading = (size * (f.lineHeight - 1)) / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, anchorX, boxY + halfLeading + i * lineH);
    });
  }
  return canvas;
}

/**
 * The API returns a root-relative background path (/api/designs/bg/...). The
 * app is served under a basePath (/sdp), so using that path as-is resolves
 * against the site root and misses the API entirely. Prefix it with the API
 * base, exactly as Certificate.js does for the same reason.
 */
export function bgUrl(design) {
  const u = design?.background_url || '';
  if (!u) return '';
  return /^https?:/i.test(u) ? u : `${BASE}${u}`;
}

// crossOrigin is set so the canvas stays exportable when the API is on another
// origin (local dev: :4000 vs :3000). In production both are same-origin.
export function loadBackground(design) {
  const url = typeof design === 'string' ? design : bgUrl(design);
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error('This design has no background image')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load the design background (${url})`));
    img.src = url;
  });
}

export async function renderToDataUrl(design, values, type = 'image/png', quality = 0.95) {
  const img = await loadBackground(design);
  const canvas = document.createElement('canvas');
  drawDesign(canvas, img, design, values);
  return canvas.toDataURL(type, quality);
}

/** Live preview. */
export default function DesignCanvas({ design, values, showPlaceholders = false, style }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!design?.background_url) return undefined;
    loadBackground(design)
      .then((img) => {
        if (cancelled || !ref.current) return;
        drawDesign(ref.current, img, design, values, { showPlaceholders });
        setErr(null);
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [design, values, showPlaceholders]);

  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>;
  return <canvas ref={ref} style={{ width: '100%', height: 'auto', display: 'block', ...style }} />;
}
