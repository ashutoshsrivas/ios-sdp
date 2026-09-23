const sanitizeHtml = require('sanitize-html');

/**
 * Admins may paste custom HTML for an app's "Know more" modal. That HTML is
 * rendered on the PUBLIC website, so it is sanitised here — on write, before it
 * ever reaches the database — rather than trusting the author or the renderer.
 *
 * The allowlist keeps everything needed to lay out and style a modal (headings,
 * lists, tables, images, inline styles, iframes for embedded video) and drops
 * anything that can execute: <script>, on* handlers, javascript:/data: URLs.
 */
const MODAL_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'span', 'section', 'article', 'header', 'footer',
    'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'small', 'mark',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'a', 'img', 'figure', 'figcaption', 'picture', 'source',
    'br', 'hr', 'video', 'audio', 'iframe',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'aria-label', 'aria-hidden', 'role'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'srcset', 'alt', 'width', 'height', 'loading'],
    source: ['src', 'srcset', 'type', 'media'],
    video: ['src', 'poster', 'controls', 'width', 'height', 'muted', 'loop', 'playsinline'],
    audio: ['src', 'controls'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
  },
  // Only these URL schemes survive — blocks javascript: and data: payloads.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
  // Embeds are restricted to known video hosts; anything else is dropped.
  allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com'],
  allowProtocolRelative: false,
  // Inline styles are permitted but constrained to layout/appearance values,
  // so an author can't smuggle url(javascript:...) or expression() through.
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s,.%]+\)$/, /^[a-zA-Z]+$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s,.%]+\)$/, /^[a-zA-Z]+$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
      'font-weight': [/^(normal|bold|lighter|bolder|[1-9]00)$/],
      'font-style': [/^(normal|italic|oblique)$/],
      'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/],
      'letter-spacing': [/^-?\d+(\.\d+)?(px|em|rem)$/],
      margin: [/^[\d\s.a-z%-]+$/],
      'margin-top': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
      'margin-bottom': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
      'margin-left': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
      'margin-right': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
      padding: [/^[\d\s.a-z%-]+$/],
      'border-radius': [/^[\d\s.a-z%]+$/],
      border: [/^[\d\s.a-z#()%,-]+$/],
      width: [/^\d+(\.\d+)?(px|em|rem|%|vw)$/, /^auto$/],
      'max-width': [/^\d+(\.\d+)?(px|em|rem|%|vw)$/, /^none$/],
      height: [/^\d+(\.\d+)?(px|em|rem|%|vh)$/, /^auto$/],
      display: [/^(block|inline|inline-block|flex|grid|none)$/],
      'flex-direction': [/^(row|column|row-reverse|column-reverse)$/],
      'justify-content': [/^[a-z-]+$/],
      'align-items': [/^[a-z-]+$/],
      gap: [/^\d+(\.\d+)?(px|em|rem|%)$/],
      'grid-template-columns': [/^[\d\s.a-z()%,-]+$/],
      'object-fit': [/^(cover|contain|fill|none|scale-down)$/],
    },
  },
  transformTags: {
    // Any link that survives opens safely.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

// Rich text for a description: formatting only, no embeds or layout containers.
const TEXT_OPTIONS = {
  allowedTags: ['p', 'br', 'em', 'strong', 'b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h3', 'h4', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

function cleanModalHtml(html) {
  if (html === null || html === undefined) return null;
  let out = sanitizeHtml(String(html), MODAL_OPTIONS).trim();
  // An iframe pointing at a disallowed host loses its src but survives as an
  // empty frame. Drop those outright so nothing renders. Safe to do with a
  // regex here because `out` is already sanitised markup, not author input.
  out = out.replace(/<iframe(?![^>]*\ssrc=)[^>]*>\s*<\/iframe>/gi, '').trim();
  return out === '' ? null : out;
}

function cleanRichText(html) {
  if (html === null || html === undefined) return null;
  const out = sanitizeHtml(String(html), TEXT_OPTIONS).trim();
  return out === '' ? null : out;
}

// Plain-text fields: strip every tag outright.
function cleanPlain(text) {
  if (text === null || text === undefined) return null;
  const out = sanitizeHtml(String(text), { allowedTags: [], allowedAttributes: {} }).trim();
  return out === '' ? null : out;
}

/**
 * Only allow http(s) URLs for links and images, so a stored "link" can never be
 * a javascript: URL that fires when a visitor clicks through.
 */
function cleanUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (s === '') return null;
  try {
    const u = new URL(s, 'https://iosdc.geu.ac.in');
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

module.exports = { cleanModalHtml, cleanRichText, cleanPlain, cleanUrl };
