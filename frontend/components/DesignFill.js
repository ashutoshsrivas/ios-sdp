import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bgUrl, fitFontSize, getMeasureContext } from './DesignCanvas';

/**
 * Fill in a design by typing directly on it.
 *
 * The background is an <img> and each text area is a transparent <textarea>
 * positioned over it. Nothing is drawn to a canvas here — the canvas renderer
 * takes over for the preview others see and for the download.
 *
 * Two things keep the editor honest against that renderer:
 *  - font size comes from the same fitFontSize() the canvas uses, so text
 *    shrinks to fit identically;
 *  - everything is expressed in the design's own pixel space and then scaled
 *    by (displayed width / natural width), so the layout is identical at any
 *    screen size.
 */
export default function DesignFill({ design, values, onChange, disabled }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [err, setErr] = useState(null);

  const natW = design.width || 1200;
  const natH = design.height || 850;
  const url = bgUrl(design);

  // Track the rendered width so the overlay tracks the image at any size.
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => setScale(node.clientWidth / natW);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [natW]);

  useEffect(() => { setErr(null); }, [url]);

  const ctx = getMeasureContext();

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${natW} / ${natH}`,
        background: '#f4f4f6',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <img
        src={url}
        alt={design.title}
        onError={() => setErr('Could not load the design background')}
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
      />

      {err && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--red,#c62828)', fontSize: 13 }}>
          {err}
        </div>
      )}

      {scale > 0 && (design.fields || []).map((f) => {
        const text = values?.[f.key] || '';
        const boxW = (f.w / 100) * natW;
        const boxH = (f.h / 100) * natH;
        // Same sizing the canvas will use, then scaled to the rendered size.
        const fitted = ctx ? fitFontSize(ctx, text, f, boxW, boxH) : f.fontSize;

        return (
          <textarea
            key={f.key}
            value={text}
            disabled={disabled}
            maxLength={f.maxLength}
            aria-label={f.label}
            placeholder={f.placeholder || f.label}
            onChange={(e) => onChange(f.key, e.target.value)}
            style={{
              position: 'absolute',
              left: `${f.x}%`,
              top: `${f.y}%`,
              width: `${f.w}%`,
              height: `${f.h}%`,
              margin: 0,
              padding: 0,
              border: 'none',
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
              background: 'transparent',
              // A faint tint only while empty, so students can see where to
              // type without it showing through once they have.
              boxShadow: text ? 'none' : 'inset 0 0 0 1px rgba(0,122,255,0.45)',
              borderRadius: 2,
              color: f.color,
              fontFamily: f.fontFamily,
              fontWeight: f.bold ? 700 : 400,
              fontSize: `${fitted * scale}px`,
              lineHeight: f.lineHeight,
              textAlign: f.align,
              cursor: disabled ? 'not-allowed' : 'text',
            }}
          />
        );
      })}
    </div>
  );
}
