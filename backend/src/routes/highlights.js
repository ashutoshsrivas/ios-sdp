const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { cleanRichText, cleanPlain, cleanUrl } = require('../sanitize');

const router = express.Router();
router.use(authRequired);

// Attach each highlight's photos in one extra query rather than N.
async function withPhotos(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const photos = await q(
    `SELECT id, highlight_id, url, caption, sort_order
     FROM highlight_photos
     WHERE highlight_id IN (${ids.map(() => '?').join(',')})
     ORDER BY COALESCE(sort_order, id), id`,
    ids
  );
  const byHighlight = new Map(ids.map((id) => [id, []]));
  for (const p of photos) byHighlight.get(p.highlight_id)?.push(p);
  return rows.map((r) => ({ ...r, photos: byHighlight.get(r.id) || [] }));
}

// GET /api/highlights  (admin) — every highlight, published or not.
router.get(
  '/',
  requireRole('admin'),
  ah(async (_req, res) => {
    const rows = await q(
      `SELECT * FROM highlights
       ORDER BY COALESCE(sort_order, 999999), event_date DESC, id DESC`
    );
    res.json(await withPhotos(rows));
  })
);

// POST /api/highlights  (admin)
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { title, description, event_date, published, sort_order } = req.body || {};
    const cleanTitle = cleanPlain(title);
    if (!cleanTitle) throw new HttpError(400, 'Title is required');

    const r = await q(
      `INSERT INTO highlights (title, description, event_date, published, sort_order)
       VALUES (?,?,?,?,?)`,
      [
        cleanTitle,
        cleanRichText(description),
        event_date || null,
        published ? 1 : 0,
        sort_order === undefined || sort_order === null || sort_order === '' ? null : Number(sort_order),
      ]
    );
    res.status(201).json({ id: r.insertId });
  })
);

// PUT /api/highlights/:id  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id FROM highlights WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Highlight not found');

    const { title, description, event_date, published, sort_order } = req.body || {};
    const fields = [];
    const params = [];

    if (title !== undefined) {
      const t = cleanPlain(title);
      if (!t) throw new HttpError(400, 'Title cannot be empty');
      fields.push('title = ?'); params.push(t);
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(cleanRichText(description)); }
    if (event_date !== undefined) { fields.push('event_date = ?'); params.push(event_date || null); }
    if (published !== undefined) { fields.push('published = ?'); params.push(published ? 1 : 0); }
    if (sort_order !== undefined) {
      fields.push('sort_order = ?');
      params.push(sort_order === null || sort_order === '' ? null : Number(sort_order));
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');

    params.push(id);
    await q(`UPDATE highlights SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/highlights/:id  (admin) — photos cascade.
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id FROM highlights WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Highlight not found');
    await q(`DELETE FROM highlights WHERE id = ?`, [id]);
    res.json({ ok: true });
  })
);

// POST /api/highlights/:id/photos  (admin) — attach an already-uploaded image.
// Upload the file via POST /api/uploads first, then send its url here.
router.post(
  '/:id/photos',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id FROM highlights WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Highlight not found');

    const url = cleanUrl(req.body?.url);
    if (!url) throw new HttpError(400, 'A valid http(s) image url is required');

    const r = await q(
      `INSERT INTO highlight_photos (highlight_id, url, caption, sort_order) VALUES (?,?,?,?)`,
      [
        id,
        url,
        cleanPlain(req.body?.caption),
        req.body?.sort_order === undefined || req.body?.sort_order === null || req.body?.sort_order === ''
          ? null
          : Number(req.body.sort_order),
      ]
    );
    res.status(201).json({ id: r.insertId, url });
  })
);

// PUT /api/highlights/photos/:photoId  (admin) — caption / ordering.
router.put(
  '/photos/:photoId',
  requireRole('admin'),
  ah(async (req, res) => {
    const photoId = Number(req.params.photoId);
    const rows = await q(`SELECT id FROM highlight_photos WHERE id = ?`, [photoId]);
    if (!rows[0]) throw new HttpError(404, 'Photo not found');

    const fields = [];
    const params = [];
    if (req.body?.caption !== undefined) { fields.push('caption = ?'); params.push(cleanPlain(req.body.caption)); }
    if (req.body?.sort_order !== undefined) {
      fields.push('sort_order = ?');
      params.push(req.body.sort_order === null || req.body.sort_order === '' ? null : Number(req.body.sort_order));
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');

    params.push(photoId);
    await q(`UPDATE highlight_photos SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/highlights/photos/:photoId  (admin)
router.delete(
  '/photos/:photoId',
  requireRole('admin'),
  ah(async (req, res) => {
    const photoId = Number(req.params.photoId);
    const rows = await q(`SELECT id FROM highlight_photos WHERE id = ?`, [photoId]);
    if (!rows[0]) throw new HttpError(404, 'Photo not found');
    await q(`DELETE FROM highlight_photos WHERE id = ?`, [photoId]);
    res.json({ ok: true });
  })
);

module.exports = router;
