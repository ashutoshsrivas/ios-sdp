const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

// Backgrounds live on local disk and are served SAME-ORIGIN, without auth, so
// the client canvas can export a PNG without cross-origin tainting. An S3 URL
// would taint the canvas and break every download.
const DESIGN_DIR = process.env.DESIGN_UPLOAD_DIR || path.join(__dirname, '..', '..', 'design-uploads');
fs.mkdirSync(DESIGN_DIR, { recursive: true });

const router = express.Router();

// A JSON column comes back as a string or an object depending on the driver.
const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const designOut = (d) => ({
  id: d.id,
  bootcamp_id: d.bootcamp_id,
  title: d.title,
  description: d.description,
  width: d.width,
  height: d.height,
  submit_as: d.submit_as,
  assigned: !!d.assigned,
  created_at: d.created_at,
  background_url: `/api/designs/bg/${d.background_path}`,
  fields: parseJson(d.fields, []),
});

/**
 * Normalise the field layout. Positions are percentages of the background so a
 * design renders identically at any canvas size.
 */
function cleanFields(input) {
  if (!Array.isArray(input)) return [];
  const num = (v, d, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, n));
  };
  return input.slice(0, 40).map((f, i) => ({
    // An image area is a box the student uploads a picture into; the creator
    // fixes its size and how the picture fills it.
    type: f.type === 'image' ? 'image' : 'text',
    fit: f.fit === 'contain' ? 'contain' : 'cover',
    key: String(f.key || `field_${i + 1}`).slice(0, 40),
    label: String(f.label || `Text area ${i + 1}`).slice(0, 120),
    placeholder: String(f.placeholder || '').slice(0, 200),
    x: num(f.x, 10, 0, 100),
    y: num(f.y, 10, 0, 100),
    w: num(f.w, 40, 2, 100),
    h: num(f.h, 15, 2, 100),
    fontSize: num(f.fontSize, 18, 6, 200),
    lineHeight: num(f.lineHeight, 1.35, 0.8, 3),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(f.color || '')) ? f.color : '#111111',
    align: ['left', 'center', 'right'].includes(f.align) ? f.align : 'left',
    bold: !!f.bold,
    fontFamily: String(f.fontFamily || 'Helvetica, Arial, sans-serif').slice(0, 80),
    maxLength: num(f.maxLength, 500, 1, 5000),
    required: !!f.required,
  }));
}

// ---- Public: serve a background so <img> can load it untainted (no auth) ----
router.get('/bg/:file', (req, res) => {
  const abs = path.join(DESIGN_DIR, path.basename(req.params.file));
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(abs);
});

router.use(authRequired);

// Mentors and admins author designs.
const canAuthor = requireRole('admin', 'mentor');

async function currentStudent(userId) {
  const rows = await q(`SELECT * FROM students WHERE user_id = ? LIMIT 1`, [userId]);
  return rows[0] || null;
}

// ---------------- Authoring ----------------

const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, DESIGN_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '').match(/\.(png|jpe?g|webp)$/i) || ['.png'])[0].toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// POST /api/designs/upload-bg — multipart "file"
router.post('/upload-bg', canAuthor, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No image provided (field name must be "file")');
  const file = path.basename(req.file.path);
  res.json({ background_path: file, background_url: `/api/designs/bg/${file}` });
}));

// GET /api/designs?bootcamp=  — every design in a cohort, with submission counts
router.get('/', canAuthor, ah(async (req, res) => {
  const cohort = Number(req.query.bootcamp);
  if (!cohort) throw new HttpError(400, 'A ?bootcamp=<id> query parameter is required');

  const rows = await q(`SELECT * FROM designs WHERE bootcamp_id = ? ORDER BY created_at DESC`, [cohort]);
  if (rows.length === 0) return res.json([]);

  const counts = await q(
    `SELECT design_id, COUNT(*) AS n FROM design_submissions
     WHERE design_id IN (${rows.map(() => '?').join(',')}) GROUP BY design_id`,
    rows.map((r) => r.id)
  );
  const byDesign = new Map(counts.map((c) => [c.design_id, Number(c.n)]));
  res.json(rows.map((d) => ({ ...designOut(d), submission_count: byDesign.get(d.id) || 0 })));
}));

// POST /api/designs
router.post('/', canAuthor, ah(async (req, res) => {
  const { bootcamp_id, title, description, background_path, width, height, fields, submit_as, assigned } =
    req.body || {};
  if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
  if (!String(title || '').trim()) throw new HttpError(400, 'Title is required');
  if (!background_path) throw new HttpError(400, 'Upload a background image first');

  const r = await q(
    `INSERT INTO designs (bootcamp_id, title, description, background_path, width, height, fields, submit_as, assigned, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(bootcamp_id), String(title).trim(), description || null,
      path.basename(String(background_path)),
      width ? Number(width) : null, height ? Number(height) : null,
      JSON.stringify(cleanFields(fields)),
      submit_as === 'team' ? 'team' : 'student',
      assigned ? 1 : 0,
      req.user.id,
    ]
  );
  res.status(201).json({ id: r.insertId });
}));

// PUT /api/designs/:id
router.put('/:id', canAuthor, ah(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await q(`SELECT * FROM designs WHERE id = ?`, [id]);
  const design = rows[0];
  if (!design) throw new HttpError(404, 'Design not found');

  const { title, description, background_path, width, height, fields, submit_as, assigned, bootcamp_id } =
    req.body || {};
  const sets = [];
  const params = [];

  if (title !== undefined) {
    if (!String(title).trim()) throw new HttpError(400, 'Title cannot be empty');
    sets.push('title = ?'); params.push(String(title).trim());
  }
  if (description !== undefined) { sets.push('description = ?'); params.push(description || null); }
  if (background_path !== undefined && background_path) {
    sets.push('background_path = ?'); params.push(path.basename(String(background_path)));
  }
  if (width !== undefined) { sets.push('width = ?'); params.push(width ? Number(width) : null); }
  if (height !== undefined) { sets.push('height = ?'); params.push(height ? Number(height) : null); }
  if (fields !== undefined) { sets.push('fields = ?'); params.push(JSON.stringify(cleanFields(fields))); }
  if (assigned !== undefined) { sets.push('assigned = ?'); params.push(assigned ? 1 : 0); }
  if (bootcamp_id !== undefined && Number(bootcamp_id)) {
    sets.push('bootcamp_id = ?'); params.push(Number(bootcamp_id));
  }
  if (submit_as !== undefined && submit_as !== design.submit_as) {
    // Student and team submissions key on different columns, so switching
    // would leave existing work unreachable. Refuse rather than orphan it.
    const [{ c }] = await q(`SELECT COUNT(*) AS c FROM design_submissions WHERE design_id = ?`, [id]);
    if (c > 0) {
      throw new HttpError(400, `This design already has ${c} submission${c === 1 ? '' : 's'}, so who submits it can no longer be changed.`);
    }
    sets.push('submit_as = ?'); params.push(submit_as === 'team' ? 'team' : 'student');
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');

  await q(`UPDATE designs SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  res.json({ ok: true });
}));

// DELETE /api/designs/:id — submissions cascade.
router.delete('/:id', canAuthor, ah(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await q(`SELECT id FROM designs WHERE id = ?`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Design not found');
  await q(`DELETE FROM designs WHERE id = ?`, [id]);
  res.json({ ok: true });
}));

// GET /api/designs/:id/submissions — every filled-in copy, for review/download.
router.get('/:id/submissions', canAuthor, ah(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await q(`SELECT * FROM designs WHERE id = ?`, [id]);
  const design = rows[0];
  if (!design) throw new HttpError(404, 'Design not found');

  const subs = await q(
    `SELECT ds.id, ds.student_id, ds.team_id, ds.values_json, ds.updated_at,
            s.name AS student_name, s.email AS student_email, t.name AS team_name
     FROM design_submissions ds
     LEFT JOIN students s ON s.id = ds.student_id
     LEFT JOIN teams t ON t.id = ds.team_id
     WHERE ds.design_id = ?
     ORDER BY COALESCE(t.name, s.name)`,
    [id]
  );
  res.json({
    design: designOut(design),
    submissions: subs.map((s) => ({ ...s, values: parseJson(s.values_json, {}), values_json: undefined })),
  });
}));

// ---------------- Students ----------------

// GET /api/designs/mine — assigned designs for this student, with their work.
router.get('/mine', requireRole('student'), ah(async (req, res) => {
  const student = await currentStudent(req.user.id);
  if (!student) throw new HttpError(404, 'No student profile linked to this account');

  const designs = await q(
    `SELECT * FROM designs WHERE bootcamp_id = ? AND assigned = 1 ORDER BY created_at DESC`,
    [student.bootcamp_id]
  );
  if (designs.length === 0) return res.json([]);

  const ids = designs.map((d) => d.id);
  const subs = await q(
    `SELECT * FROM design_submissions
     WHERE design_id IN (${ids.map(() => '?').join(',')})
       AND (student_id = ? OR (team_id IS NOT NULL AND team_id = ?))`,
    [...ids, student.id, student.team_id || 0]
  );

  res.json(designs.map((d) => {
    const mine = subs.find((s) => s.design_id === d.id);
    return {
      ...designOut(d),
      // A team design with no team yet cannot be filled in by anyone.
      blocked: d.submit_as === 'team' && !student.team_id
        ? 'You are not in a team yet, so this cannot be filled in.'
        : null,
      submission: mine ? { id: mine.id, values: parseJson(mine.values_json, {}), updated_at: mine.updated_at } : null,
    };
  }));
}));

// POST /api/designs/:id/upload-image — multipart "file".
// Deliberately NOT the shared S3 uploader: the export draws this into a canvas
// and an S3 URL is cross-origin, which taints it and breaks every download.
// These land beside the backgrounds and are served by the same /bg/ route.
router.post('/:id/upload-image', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No image provided (field name must be "file")');
  const id = Number(req.params.id);
  const rows = await q(`SELECT * FROM designs WHERE id = ?`, [id]);
  const design = rows[0];
  if (!design) throw new HttpError(404, 'Design not found');

  // Students may only upload into a design actually assigned to their cohort.
  if (req.user.role === 'student') {
    const student = await currentStudent(req.user.id);
    if (!student) throw new HttpError(404, 'No student profile linked to this account');
    if (!design.assigned || design.bootcamp_id !== student.bootcamp_id) {
      throw new HttpError(403, 'This design is not assigned to you');
    }
  } else if (!['admin', 'mentor'].includes(req.user.role)) {
    throw new HttpError(403, 'Not allowed');
  }

  const file = path.basename(req.file.path);
  res.json({ path: file, url: `/api/designs/bg/${file}` });
}));

// POST /api/designs/:id/submit  { values } — upsert this student's/team's copy.
router.post('/:id/submit', requireRole('student'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const student = await currentStudent(req.user.id);
  if (!student) throw new HttpError(404, 'No student profile linked to this account');

  const rows = await q(`SELECT * FROM designs WHERE id = ?`, [id]);
  const design = rows[0];
  if (!design) throw new HttpError(404, 'Design not found');
  if (!design.assigned) throw new HttpError(403, 'This design is not open for submissions');
  if (design.bootcamp_id !== student.bootcamp_id) throw new HttpError(403, 'This design is not assigned to you');

  const isTeam = design.submit_as === 'team';
  if (isTeam && !student.team_id) throw new HttpError(400, 'You are not in a team yet');

  // Keep only the keys this design actually defines, capped at each field's
  // own maxLength, so a crafted payload can't store arbitrary data.
  const fields = parseJson(design.fields, []);
  const incoming = req.body?.values || {};
  const values = {};
  for (const f of fields) {
    const raw = incoming[f.key];
    if (raw == null) continue;
    if (f.type === 'image') {
      // Only a path this API served. Anything else would be an arbitrary URL
      // rendered into other people's exports.
      const v = String(raw);
      if (v === '' || /^\/api\/designs\/bg\/[A-Za-z0-9._-]+$/.test(v)) values[f.key] = v;
      continue;
    }
    values[f.key] = String(raw).slice(0, f.maxLength || 500);
  }

  await q(
    `INSERT INTO design_submissions (design_id, student_id, team_id, values_json, updated_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE values_json = VALUES(values_json), updated_by = VALUES(updated_by)`,
    [id, isTeam ? null : student.id, isTeam ? student.team_id : null, JSON.stringify(values), req.user.id]
  );
  res.json({ ok: true, values });
}));

module.exports = router;
