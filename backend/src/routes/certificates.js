const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

// Template backgrounds live on local disk and are served SAME-ORIGIN so the client
// canvas can export a PNG without cross-origin tainting.
const CERT_DIR = process.env.CERT_UPLOAD_DIR || path.join(__dirname, '..', '..', 'cert-uploads');
fs.mkdirSync(CERT_DIR, { recursive: true });

const router = express.Router();

// Parse a JSON column whether the driver returns a string or an object.
const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
const templateOut = (t) => ({
  id: t.id, name: t.name, width: t.width, height: t.height,
  is_default: !!t.is_default, created_at: t.created_at,
  background_url: `/api/certificates/bg/${t.background_path}`,
  fields: parseJson(t.fields, []),
});

// ---- Public: serve a background image (no auth so <img> can load it) ----
router.get('/bg/:file', (req, res) => {
  const abs = path.join(CERT_DIR, path.basename(req.params.file));
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(abs);
});

// ---- Public: verify a certificate by its QR code (no auth) ----
router.get('/verify/:code', ah(async (req, res) => {
  const code = String(req.params.code || '').trim();
  const c = code && (await q(
    `SELECT c.serial, c.issued_at, c.revoked, c.values_json, s.name AS student_name,
            ct.name AS program, b.name AS bootcamp_name
     FROM certificates c
     JOIN students s ON s.id = c.student_id
     JOIN certificate_templates ct ON ct.id = c.template_id
     LEFT JOIN bootcamps b ON b.id = c.bootcamp_id
     WHERE c.verify_code = ? LIMIT 1`,
    [code]
  ))[0];
  if (!c) throw new HttpError(404, 'No certificate matches this code');
  const values = parseJson(c.values_json, {});
  res.json({
    valid: !c.revoked,
    revoked: !!c.revoked,
    name: c.student_name,
    program: c.program,
    bootcamp: c.bootcamp_name || null,
    serial: c.serial || null,
    date: values.date || null,
    issued_at: c.issued_at,
  });
}));

router.use(authRequired);

// ================= Templates (admin) =================

router.get('/templates', requireRole('admin'), ah(async (_req, res) => {
  const rows = await q('SELECT * FROM certificate_templates ORDER BY is_default DESC, id DESC');
  res.json(rows.map(templateOut));
}));

// Upload a background image; client sends width/height it read from the file.
const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, CERT_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '').match(/\.(png|jpe?g|webp)$/i) || ['.png'])[0].toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/templates/upload-bg', requireRole('admin'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No image provided (field name must be "file")');
  res.json({ background_path: path.basename(req.file.path), background_url: `/api/certificates/bg/${path.basename(req.file.path)}` });
}));

router.post('/templates', requireRole('admin'), ah(async (req, res) => {
  const { name, background_path, width, height, fields, is_default } = req.body || {};
  if (!name?.trim()) throw new HttpError(400, 'Template name is required');
  if (!background_path) throw new HttpError(400, 'Upload a background image first');
  if (is_default) await q('UPDATE certificate_templates SET is_default = 0');
  const r = await q(
    'INSERT INTO certificate_templates (name, background_path, width, height, fields, is_default) VALUES (?,?,?,?,?,?)',
    [name.trim(), path.basename(background_path), width || null, height || null, JSON.stringify(fields || []), is_default ? 1 : 0]
  );
  res.status(201).json({ id: r.insertId });
}));

router.put('/templates/:id', requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const { name, background_path, width, height, fields, is_default } = req.body || {};
  if (is_default) await q('UPDATE certificate_templates SET is_default = 0');
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
  if (background_path !== undefined) { sets.push('background_path = ?'); params.push(path.basename(background_path)); }
  if (width !== undefined) { sets.push('width = ?'); params.push(width || null); }
  if (height !== undefined) { sets.push('height = ?'); params.push(height || null); }
  if (fields !== undefined) { sets.push('fields = ?'); params.push(JSON.stringify(fields || [])); }
  if (is_default !== undefined) { sets.push('is_default = ?'); params.push(is_default ? 1 : 0); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  params.push(id);
  await q(`UPDATE certificate_templates SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
}));

router.delete('/templates/:id', requireRole('admin'), ah(async (req, res) => {
  await q('DELETE FROM certificate_templates WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ================= Issue / list (admin) =================

// POST /api/certificates/issue { template_id, bootcamp_id, student_ids:[], values:{} }
router.post('/issue', requireRole('admin'), ah(async (req, res) => {
  const { template_id, bootcamp_id, student_ids, values } = req.body || {};
  if (!template_id) throw new HttpError(400, 'template_id is required');
  if (!Array.isArray(student_ids) || !student_ids.length) throw new HttpError(400, 'Select at least one student');
  const tpl = (await q('SELECT * FROM certificate_templates WHERE id = ?', [Number(template_id)]))[0];
  if (!tpl) throw new HttpError(404, 'Template not found');

  const year = new Date().getFullYear();
  const issued = [];
  for (const sid of student_ids) {
    const s = (await q('SELECT id, name, bootcamp_id FROM students WHERE id = ?', [Number(sid)]))[0];
    if (!s) continue;
    const snapshot = { ...(values || {}), name: s.name };
    const r = await q(
      `INSERT INTO certificates (student_id, template_id, bootcamp_id, values_json)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE values_json = VALUES(values_json), bootcamp_id = VALUES(bootcamp_id), issued_at = CURRENT_TIMESTAMP`,
      [s.id, tpl.id, bootcamp_id || s.bootcamp_id || null, JSON.stringify(snapshot)]
    );
    const certId = r.insertId || (await q('SELECT id FROM certificates WHERE student_id = ? AND template_id = ?', [s.id, tpl.id]))[0].id;
    await q('UPDATE certificates SET serial = ? WHERE id = ? AND (serial IS NULL OR serial = "")',
      [`IOSDC-${year}-${String(certId).padStart(4, '0')}`, certId]);
    // Stable, unguessable code for the public verification QR (kept across re-issues).
    await q('UPDATE certificates SET verify_code = ? WHERE id = ? AND (verify_code IS NULL OR verify_code = "")',
      [crypto.randomBytes(12).toString('hex'), certId]);
    issued.push(certId);
  }
  res.json({ issued: issued.length });
}));

// GET /api/certificates?bootcamp=&template=  (admin)
router.get('/', requireRole('admin'), ah(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.bootcamp) { where.push('c.bootcamp_id = ?'); params.push(Number(req.query.bootcamp)); }
  if (req.query.template) { where.push('c.template_id = ?'); params.push(Number(req.query.template)); }
  const rows = await q(
    `SELECT c.id, c.student_id, c.template_id, c.serial, c.verify_code, c.revoked, c.values_json, c.issued_at,
            s.name AS student_name, s.email AS student_email, ct.name AS template_name
     FROM certificates c
     JOIN students s ON s.id = c.student_id
     JOIN certificate_templates ct ON ct.id = c.template_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.issued_at DESC`,
    params
  );
  res.json(rows.map((c) => ({ ...c, values: parseJson(c.values_json, {}), values_json: undefined })));
}));

// GET /api/certificates/mine  (student) — their certificates + templates for rendering
router.get('/mine', requireRole('student'), ah(async (req, res) => {
  const rows = await q(
    `SELECT c.id, c.serial, c.verify_code, c.revoked, c.values_json, c.issued_at, ct.*
     FROM certificates c
     JOIN students s ON s.id = c.student_id
     JOIN certificate_templates ct ON ct.id = c.template_id
     WHERE s.user_id = ?
     ORDER BY c.issued_at DESC`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    id: r.id, serial: r.serial, verify_code: r.verify_code, revoked: !!r.revoked, issued_at: r.issued_at,
    values: parseJson(r.values_json, {}),
    template: templateOut(r),
  })));
}));

// GET /api/certificates/:id  (admin, or the owning student) — full cert for rendering
router.get('/:id', ah(async (req, res) => {
  const c = (await q(
    `SELECT c.*, s.user_id AS owner_user_id, ct.name AS ct_name, ct.background_path, ct.width, ct.height, ct.fields, ct.is_default, ct.created_at AS ct_created
     FROM certificates c
     JOIN students s ON s.id = c.student_id
     JOIN certificate_templates ct ON ct.id = c.template_id
     WHERE c.id = ?`,
    [Number(req.params.id)]
  ))[0];
  if (!c) throw new HttpError(404, 'Certificate not found');
  if (req.user.role !== 'admin' && c.owner_user_id !== req.user.id) throw new HttpError(403, 'Not your certificate');
  res.json({
    id: c.id, serial: c.serial, verify_code: c.verify_code, issued_at: c.issued_at,
    values: parseJson(c.values_json, {}),
    template: templateOut({ id: c.template_id, name: c.ct_name, background_path: c.background_path, width: c.width, height: c.height, fields: c.fields, is_default: c.is_default, created_at: c.ct_created }),
  });
}));

// POST /api/certificates/:id/revoke  { revoked }  (admin) — toggle validity, keep the record
router.post('/:id/revoke', requireRole('admin'), ah(async (req, res) => {
  const revoked = req.body?.revoked === false ? 0 : 1;
  await q('UPDATE certificates SET revoked = ? WHERE id = ?', [revoked, Number(req.params.id)]);
  res.json({ ok: true, revoked: !!revoked });
}));

router.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  await q('DELETE FROM certificates WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.CERT_DIR = CERT_DIR;
