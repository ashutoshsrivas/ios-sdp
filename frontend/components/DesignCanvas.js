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

/**
 * Split a single token that is wider than the box into chunks that fit.
 * Without this a pasted URL or an unspaced string is emitted as one line and
 * runs straight off the artwork, because there is no space to wrap at.
 */
function breakToken(ctx, token, maxWidth) {
  const chunks = [];
  let cur = '';
  for (const ch of String(token)) {
    const attempt = cur + ch;
    if (!cur || ctx.measureText(attempt).width <= maxWidth) {
      cur = attempt;
    } else {
      chunks.push(cur);
      cur = ch;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Wrap text to a pixel width, honouring explicit newlines the student typed.
// Every returned line fits maxWidth, except where a single character cannot.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width <= maxWidth) {
        line = attempt;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      // The word alone may still be too wide — break it rather than overflow.
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        const chunks = breakToken(ctx, word, maxWidth);
        lines.push(...chunks.slice(0, -1));
        line = chunks[chunks.length - 1] || '';
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
    if (lines.length * size * f.lineHeight > boxH) return false;
    // Height alone is not enough: a token that cannot be broken any further
    // can still be wider than the box.
    return lines.every((l) => ctx.measureText(l).width <= boxW + 0.5);
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
    // ---- image areas ----
    if (f.type === 'image') {
      const picture = opts.images?.get(f.key);
      const bx = (f.x / 100) * w;
      const by = (f.y / 100) * h;
      const bw = (f.w / 100) * w;
      const bh = (f.h / 100) * h;

      if (!picture) {
        if (opts.showPlaceholders) {
          ctx.save();
          ctx.setLineDash([6, 5]);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.strokeRect(bx, by, bw, bh);
          ctx.restore();
        }
        continue;
      }

      // Cover fills the box and crops; contain fits the whole picture inside.
      const sr = picture.naturalWidth / picture.naturalHeight;
      const br = bw / bh;
      let dw = bw;
      let dh = bh;
      if (f.fit === 'contain' ? sr > br : sr < br) dh = bw / sr; else dw = bh * sr;

      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      ctx.drawImage(picture, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
      ctx.restore();
      continue;
    }

    // ---- text areas ----
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

    // Final guarantee: clip to the field box. Auto-fit should already make the
    // text fit, but at the 7px floor it may not, and the editor's textarea
    // hides its overflow — so without this the export is the only place the
    // text spills over the artwork.
    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.clip();

    lines.forEach((line, i) => {
      ctx.fillText(line, anchorX, boxY + halfLeading + i * lineH);
    });
    ctx.restore();
  }
  return canvas;
}

/**
 * The API returns a root-relative background path (/api/designs/bg/...). The
 * app is served under a basePath (/sdp), so using that path as-is resolves
 * against the site root and misses the API entirely. Prefix it with the API
 * base, exactly as Certificate.js does for the same reason.
 */
export function resolveUrl(u) {
  if (!u) return '';
  return /^https?:/i.test(u) ? u : `${BASE}${u}`;
}

export function bgUrl(design) {
  return resolveUrl(design?.background_url || '');
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

/**
 * Load every picture a student has placed in an image area. Resolved before
 * drawing because the canvas API is synchronous — and a failed load resolves
 * to null rather than rejecting, so one broken picture can't block an export.
 */
export async function loadFieldImages(design, values) {
  const out = new Map();
  const wanted = (design.fields || []).filter((f) => f.type === 'image' && values?.[f.key]);
  await Promise.all(wanted.map(async (f) => {
    try {
      out.set(f.key, await loadBackground(resolveUrl(values[f.key])));
    } catch { /* leave the box empty rather than fail the whole render */ }
  }));
  return out;
}

export async function renderToDataUrl(design, values, type = 'image/png', quality = 0.95) {
  const [img, images] = await Promise.all([loadBackground(design), loadFieldImages(design, values)]);
  const canvas = document.createElement('canvas');
  drawDesign(canvas, img, design, values, { images });
  return canvas.toDataURL(type, quality);
}

/** Live preview. */
export default function DesignCanvas({ design, values, showPlaceholders = false, style }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!design?.background_url) return undefined;
    Promise.all([loadBackground(design), loadFieldImages(design, values)])
      .then(([img, images]) => {
        if (cancelled || !ref.current) return;
        drawDesign(ref.current, img, design, values, { showPlaceholders, images });
        setErr(null);
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [design, values, showPlaceholders]);

  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>;
  return <canvas ref={ref} style={{ width: '100%', height: 'auto', display: 'block', ...style }} />;
}
