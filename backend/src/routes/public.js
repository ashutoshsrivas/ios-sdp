const express = require('express');
const { q } = require('../db');
const { ah, HttpError } = require('../util');

/**
 * Unauthenticated, read-only content for the public website
 * (https://iosdc.geu.ac.in). Mounted at /api/public.
 *
 * This is the ONLY router in the app with no authRequired. Two rules hold
 * throughout, and any new endpoint here must keep them:
 *   1. Every query filters on published / public_visible.
 *   2. Only columns that are meant to be public are selected — never a
 *      SELECT *, so a future column can't silently become public. Nothing
 *      here touches students, users, teams, scores or registrations.
 */
const router = express.Router();

// Public responses are cacheable for a minute; admin edits appear shortly after.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60');
  next();
});

// A cohort with no slug set still needs a stable URL key.
function slugFor(row) {
  if (row.public_slug) return row.public_slug;
  return String(row.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `cohort-${row.id}`;
}

async function visibleCohorts() {
  const rows = await q(
    `SELECT id, name, tagline, public_slug, sort_order
     FROM bootcamps
     WHERE public_visible = 1
     ORDER BY COALESCE(sort_order, 999999), id`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    slug: slugFor(r),
  }));
}

// GET /api/public/nav — drives the website's navigation.
// Home is static; Highlights only appears when something is published.
router.get(
  '/nav',
  ah(async (_req, res) => {
    const [counts] = await q(`SELECT COUNT(*) AS c FROM highlights WHERE published = 1`);
    const cohorts = await visibleCohorts();
    res.json({
      highlights: counts.c > 0,
      cohorts,
    });
  })
);

// GET /api/public/highlights — published highlights, newest event first.
router.get(
  '/highlights',
  ah(async (_req, res) => {
    const rows = await q(
      `SELECT id, title, description, event_date
       FROM highlights
       WHERE published = 1
       ORDER BY COALESCE(sort_order, 999999), event_date DESC, id DESC`
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map((r) => r.id);
    const photos = await q(
      `SELECT id, highlight_id, url, caption
       FROM highlight_photos
       WHERE highlight_id IN (${ids.map(() => '?').join(',')})
       ORDER BY COALESCE(sort_order, id), id`,
      ids
    );
    const byHighlight = new Map(ids.map((id) => [id, []]));
    for (const p of photos) {
      byHighlight.get(p.highlight_id)?.push({ id: p.id, url: p.url, caption: p.caption });
    }
    res.json(rows.map((r) => ({ ...r, photos: byHighlight.get(r.id) || [] })));
  })
);

// GET /api/public/cohorts — the visible cohorts, with their app counts.
router.get(
  '/cohorts',
  ah(async (_req, res) => {
    const cohorts = await visibleCohorts();
    if (cohorts.length === 0) return res.json([]);

    const ids = cohorts.map((c) => c.id);
    const counts = await q(
      `SELECT bootcamp_id, COUNT(*) AS apps
       FROM cohort_apps
       WHERE published = 1 AND bootcamp_id IN (${ids.map(() => '?').join(',')})
       GROUP BY bootcamp_id`,
      ids
    );
    const byCohort = new Map(counts.map((c) => [c.bootcamp_id, Number(c.apps)]));
    res.json(cohorts.map((c) => ({ ...c, apps: byCohort.get(c.id) || 0 })));
  })
);

// GET /api/public/cohorts/:slug — one cohort and its published apps.
router.get(
  '/cohorts/:slug',
  ah(async (req, res) => {
    const cohorts = await visibleCohorts();
    const cohort = cohorts.find((c) => c.slug === req.params.slug);
    if (!cohort) throw new HttpError(404, 'Cohort not found');

    const apps = await q(
      `SELECT id, title, description, hero_image_url, link_url, modal_html
       FROM cohort_apps
       WHERE bootcamp_id = ? AND published = 1
       ORDER BY COALESCE(sort_order, 999999), id`,
      [cohort.id]
    );
    res.json({ ...cohort, apps });
  })
);

module.exports = router;
