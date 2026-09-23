const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { cleanModalHtml, cleanRichText, cleanPlain, cleanUrl } = require('../sanitize');

const router = express.Router();
router.use(authRequired);

// GET /api/cohort-apps?cohort=<id>  (admin) — published or not.
// Scoped like every other per-cohort list: a missing scope is a 400.
router.get(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const cohortId = Number(req.query.cohort);
    if (!cohortId) throw new HttpError(400, 'A ?cohort=<id> query parameter is required');
    const rows = await q(
      `SELECT * FROM cohort_apps
       WHERE bootcamp_id = ?
       ORDER BY COALESCE(sort_order, 999999), id`,
      [cohortId]
    );
    res.json(rows);
  })
);

// POST /api/cohort-apps  (admin)
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { bootcamp_id, title, description, hero_image_url, link_url, modal_html, published, sort_order } =
      req.body || {};

    const cohortId = Number(bootcamp_id);
    if (!cohortId) throw new HttpError(400, 'bootcamp_id is required');
    const cohort = await q(`SELECT id FROM bootcamps WHERE id = ?`, [cohortId]);
    if (!cohort[0]) throw new HttpError(404, 'Cohort not found');

    const cleanTitle = cleanPlain(title);
    if (!cleanTitle) throw new HttpError(400, 'Title is required');

    const r = await q(
      `INSERT INTO cohort_apps
         (bootcamp_id, title, description, hero_image_url, link_url, modal_html, published, sort_order)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        cohortId,
        cleanTitle,
        cleanRichText(description),
        cleanUrl(hero_image_url),
        cleanUrl(link_url),
        cleanModalHtml(modal_html),
        published === undefined ? 1 : published ? 1 : 0,
        sort_order === undefined || sort_order === null || sort_order === '' ? null : Number(sort_order),
      ]
    );
    res.status(201).json({ id: r.insertId });
  })
);

// PUT /api/cohort-apps/:id  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id FROM cohort_apps WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'App not found');

    const { title, description, hero_image_url, link_url, modal_html, published, sort_order } = req.body || {};
    const fields = [];
    const params = [];

    if (title !== undefined) {
      const t = cleanPlain(title);
      if (!t) throw new HttpError(400, 'Title cannot be empty');
      fields.push('title = ?'); params.push(t);
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(cleanRichText(description)); }
    if (hero_image_url !== undefined) { fields.push('hero_image_url = ?'); params.push(cleanUrl(hero_image_url)); }
    if (link_url !== undefined) { fields.push('link_url = ?'); params.push(cleanUrl(link_url)); }
    if (modal_html !== undefined) { fields.push('modal_html = ?'); params.push(cleanModalHtml(modal_html)); }
    if (published !== undefined) { fields.push('published = ?'); params.push(published ? 1 : 0); }
    if (sort_order !== undefined) {
      fields.push('sort_order = ?');
      params.push(sort_order === null || sort_order === '' ? null : Number(sort_order));
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');

    params.push(id);
    await q(`UPDATE cohort_apps SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/cohort-apps/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id FROM cohort_apps WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'App not found');
    await q(`DELETE FROM cohort_apps WHERE id = ?`, [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
