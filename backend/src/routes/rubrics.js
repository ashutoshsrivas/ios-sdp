const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();
router.use(authRequired);

async function loadRubric(id) {
  const rows = await q(`SELECT * FROM rubrics WHERE id = ?`, [id]);
  if (!rows[0]) return null;
  const criteria = await q(
    `SELECT * FROM rubric_criteria WHERE rubric_id = ? ORDER BY sort_order, id`,
    [id]
  );
  return { ...rows[0], criteria };
}

// GET /api/rubrics?bootcamp=  (admin + mentor)
router.get(
  '/',
  requireRole('admin', 'mentor'),
  ah(async (req, res) => {
    if (!req.query.bootcamp) throw new HttpError(400, 'bootcamp is required');
    const rubrics = await q(`SELECT * FROM rubrics WHERE bootcamp_id = ? ORDER BY created_at DESC`, [
      Number(req.query.bootcamp),
    ]);
    if (!rubrics.length) return res.json([]);
    const criteria = await q(`SELECT * FROM rubric_criteria WHERE rubric_id IN (?) ORDER BY sort_order, id`, [
      rubrics.map((r) => r.id),
    ]);
    res.json(rubrics.map((r) => ({ ...r, criteria: criteria.filter((c) => c.rubric_id === r.id) })));
  })
);

// POST /api/rubrics  (admin)  { title, description, criteria, bootcamp_id }
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { title, description, criteria, bootcamp_id } = req.body || {};
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    if (!title) throw new HttpError(400, 'Title is required');
    if (!Array.isArray(criteria) || !criteria.length)
      throw new HttpError(400, 'At least one criterion is required');
    const r = await q(`INSERT INTO rubrics (title, description, bootcamp_id) VALUES (?,?,?)`, [
      title.trim(), description || null, Number(bootcamp_id),
    ]);
    let order = 0;
    for (const c of criteria) {
      await q(
        `INSERT INTO rubric_criteria (rubric_id, name, max_score, weight, sort_order) VALUES (?,?,?,?,?)`,
        [r.insertId, c.name, Number(c.max_score) || 10, Number(c.weight) || 1, order++]
      );
    }
    res.status(201).json(await loadRubric(r.insertId));
  })
);

// PUT /api/rubrics/:id  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { title, description, criteria } = req.body || {};
    const existing = await loadRubric(id);
    if (!existing) throw new HttpError(404, 'Rubric not found');
    await q(`UPDATE rubrics SET title = ?, description = ? WHERE id = ?`, [
      title || existing.title, description ?? existing.description, id,
    ]);
    if (Array.isArray(criteria)) {
      await q(`DELETE FROM rubric_criteria WHERE rubric_id = ?`, [id]);
      let order = 0;
      for (const c of criteria) {
        await q(
          `INSERT INTO rubric_criteria (rubric_id, name, max_score, weight, sort_order) VALUES (?,?,?,?,?)`,
          [id, c.name, Number(c.max_score) || 10, Number(c.weight) || 1, order++]
        );
      }
    }
    res.json(await loadRubric(id));
  })
);

// DELETE /api/rubrics/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`DELETE FROM rubrics WHERE id = ?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

// GET /api/rubrics/:id/scores?team=ID  (mentor + admin)
router.get(
  '/:id/scores',
  requireRole('admin', 'mentor'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const teamId = req.query.team ? Number(req.query.team) : null;
    const rubric = await loadRubric(id);
    if (!rubric) throw new HttpError(404, 'Rubric not found');
    const critIds = rubric.criteria.map((c) => c.id);

    const students = teamId
      ? await q(`SELECT id, name, email, team_id FROM students WHERE team_id = ? ORDER BY name`, [teamId])
      : await q(
          `SELECT id, name, email, team_id FROM students WHERE status='approved' AND bootcamp_id = ? ORDER BY name`,
          [rubric.bootcamp_id]
        );

    let scores = [];
    if (critIds.length) {
      const forMentor = req.user.role === 'mentor';
      scores = await q(
        `SELECT rs.*, u.name AS mentor_name FROM rubric_scores rs
         JOIN users u ON u.id = rs.mentor_id
         WHERE rs.criteria_id IN (?) ${forMentor ? 'AND rs.mentor_id = ?' : ''}`,
        forMentor ? [critIds, req.user.id] : [critIds]
      );
    }
    res.json({ rubric, students, scores });
  })
);

// POST /api/rubrics/:id/scores  (mentor)
router.post(
  '/:id/scores',
  requireRole('mentor'),
  ah(async (req, res) => {
    const { team_id, scores } = req.body || {};
    if (!Array.isArray(scores)) throw new HttpError(400, 'scores must be an array');

    // Reject any score above its criterion's max (or below 0).
    const crit = await q(`SELECT id, name, max_score FROM rubric_criteria WHERE rubric_id = ?`, [
      Number(req.params.id),
    ]);
    const critById = Object.fromEntries(crit.map((c) => [c.id, c]));
    for (const s of scores) {
      if (s.score === '' || s.score === null || s.score === undefined) continue;
      const c = critById[s.criteria_id];
      const n = Number(s.score);
      if (!c) throw new HttpError(400, 'Score refers to a criterion outside this rubric');
      if (Number.isNaN(n) || n < 0 || n > Number(c.max_score))
        throw new HttpError(400, `Score for "${c.name}" must be between 0 and ${c.max_score}`);
    }

    for (const s of scores) {
      const hasScore = !(s.score === '' || s.score === null || s.score === undefined);
      const comment = (s.comment ?? '').toString().trim();
      if (!hasScore && !comment) {
        // Cleared cell → remove this mentor's row so the new (empty) state wins.
        await q(
          `DELETE FROM rubric_scores WHERE criteria_id = ? AND student_id = ? AND mentor_id = ?`,
          [s.criteria_id, s.student_id, req.user.id]
        );
        continue;
      }
      await q(
        `INSERT INTO rubric_scores (criteria_id, student_id, team_id, mentor_id, score, comment)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment), team_id = VALUES(team_id)`,
        [s.criteria_id, s.student_id, team_id || null, req.user.id, hasScore ? Number(s.score) : null, comment || null]
      );
    }
    res.json({ ok: true });
  })
);

module.exports = router;
