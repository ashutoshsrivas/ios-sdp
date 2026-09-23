const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { cleanPlain } = require('../sanitize');

const router = express.Router();
router.use(authRequired);

// The cohort's public URL key, e.g. "cohort-1". Null clears it, in which case
// routes/public.js falls back to a slug derived from the name.
function slugify(value) {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s === '' ? null : s.slice(0, 80);
}

// GET /api/bootcamps — admins see all; others see active ones only.
router.get(
  '/',
  ah(async (req, res) => {
    const rows =
      req.user.role === 'admin'
        ? await q(`SELECT * FROM bootcamps ORDER BY created_at DESC`)
        : await q(`SELECT * FROM bootcamps WHERE status='active' ORDER BY created_at DESC`);
    res.json(rows);
  })
);

// GET /api/bootcamps/stats  (admin) — per-bootcamp counts for the dashboard
router.get(
  '/stats',
  requireRole('admin'),
  ah(async (_req, res) => {
    const rows = await q(
      `SELECT b.id, b.name, b.status, b.registration_open,
              COUNT(s.id) AS students,
              SUM(s.status = 'pending')  AS pending,
              SUM(s.status = 'approved') AS approved,
              (SELECT COUNT(*) FROM teams t WHERE t.bootcamp_id = b.id) AS teams
       FROM bootcamps b
       LEFT JOIN students s ON s.bootcamp_id = b.id
       GROUP BY b.id, b.name, b.status, b.registration_open
       ORDER BY b.created_at`
    );
    res.json(rows);
  })
);

// POST /api/bootcamps  (admin)
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { name, description } = req.body || {};
    if (!name?.trim()) throw new HttpError(400, 'Name is required');
    const r = await q(
      `INSERT INTO bootcamps (name, description, registration_open) VALUES (?,?,1)`,
      [name.trim(), description || null]
    );
    res.status(201).json({ id: r.insertId });
  })
);

// PUT /api/bootcamps/:id  (admin) — name/description/status/registration_open
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT * FROM bootcamps WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Bootcamp not found');
    const { name, description, status, registration_open, public_visible, public_slug, tagline, sort_order } =
      req.body || {};
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name.trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description || null); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status === 'archived' ? 'archived' : 'active'); }
    if (registration_open !== undefined) { fields.push('registration_open = ?'); params.push(registration_open ? 1 : 0); }
    // Public-website fields. public_visible is what puts a cohort in the site nav.
    if (public_visible !== undefined) { fields.push('public_visible = ?'); params.push(public_visible ? 1 : 0); }
    if (tagline !== undefined) { fields.push('tagline = ?'); params.push(cleanPlain(tagline)); }
    if (sort_order !== undefined) {
      fields.push('sort_order = ?');
      params.push(sort_order === null || sort_order === '' ? null : Number(sort_order));
    }
    if (public_slug !== undefined) {
      const slug = slugify(public_slug);
      if (slug) {
        const clash = await q(`SELECT id FROM bootcamps WHERE public_slug = ? AND id <> ?`, [slug, id]);
        if (clash[0]) throw new HttpError(400, 'That public URL is already used by another cohort');
      }
      fields.push('public_slug = ?'); params.push(slug);
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    params.push(id);
    await q(`UPDATE bootcamps SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/bootcamps/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const count = await q(`SELECT COUNT(*) AS c FROM bootcamps`);
    if (count[0].c <= 1) throw new HttpError(400, 'Cannot delete the only bootcamp');
    const students = await q(`SELECT COUNT(*) AS c FROM students WHERE bootcamp_id = ?`, [id]);
    if (students[0].c > 0)
      throw new HttpError(400, 'This bootcamp has students. Archive it instead of deleting.');
    await q(`DELETE FROM bootcamps WHERE id = ?`, [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
