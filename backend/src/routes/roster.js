const express = require('express');
const multer = require('multer');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { parseRosterBuffer, upsertRoster } = require('../rosterImport');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authRequired);

// GET /api/roster/search?q=  (admin + volunteer) — autocomplete suggestions
router.get(
  '/search',
  requireRole('admin', 'volunteer'),
  ah(async (req, res) => {
    const term = String(req.query.q || '').trim();
    if (term.length < 2) return res.json([]);
    const like = `%${term}%`;
    const rows = await q(
      `SELECT id, student_id, full_name, email, phone, campus, test_no, status
       FROM roster
       WHERE full_name LIKE ? OR email LIKE ? OR student_id LIKE ? OR phone LIKE ?
       ORDER BY full_name LIMIT 8`,
      [like, like, like, like]
    );
    res.json(rows);
  })
);

// GET /api/roster  (admin) — full directory, in the order it was uploaded
router.get(
  '/',
  requireRole('admin'),
  ah(async (_req, res) => {
    res.json(await q(`SELECT * FROM roster ORDER BY (sort_order IS NULL), sort_order, id`));
  })
);

// POST /api/roster  (admin) — add one entry
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { student_id, full_name, email, phone, campus, test_no, status } = req.body || {};
    if (!full_name?.trim()) throw new HttpError(400, 'Full name is required');
    if (student_id) {
      const dup = await q(`SELECT id FROM roster WHERE student_id = ?`, [student_id]);
      if (dup.length) throw new HttpError(409, 'A roster entry with that Student Id already exists');
    }
    const r = await q(
      `INSERT INTO roster (student_id, full_name, email, phone, campus, test_no, status) VALUES (?,?,?,?,?,?,?)`,
      [student_id || null, full_name.trim(), email ? email.toLowerCase().trim() : null, phone || null, campus || null, test_no || null, status || null]
    );
    res.status(201).json({ id: r.insertId });
  })
);

// PUT /api/roster/:id  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const editable = ['student_id', 'full_name', 'email', 'phone', 'campus', 'test_no', 'status'];
    const fields = [];
    const params = [];
    for (const f of editable) {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = ?`);
        params.push(f === 'email' && req.body[f] ? String(req.body[f]).toLowerCase().trim() : req.body[f] || null);
      }
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    params.push(id);
    await q(`UPDATE roster SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/roster/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`DELETE FROM roster WHERE id = ?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

// POST /api/roster/import  (admin) — upload .xlsx to append/update the directory
router.post(
  '/import',
  requireRole('admin'),
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file provided (field name must be "file")');
    let rows;
    try {
      rows = await parseRosterBuffer(req.file.buffer);
    } catch {
      throw new HttpError(400, 'Could not read that file — please upload a valid .xlsx');
    }
    if (!rows.length) throw new HttpError(400, 'No student rows found. Expected a header row with a Name column.');
    const result = await upsertRoster(rows);
    res.json(result);
  })
);

module.exports = router;
