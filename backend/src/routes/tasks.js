const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();
router.use(authRequired);

// GET /api/tasks?bootcamp=  (admin + mentor + student)
router.get(
  '/',
  requireRole('admin', 'mentor', 'student'),
  ah(async (req, res) => {
    if (!req.query.bootcamp) throw new HttpError(400, 'bootcamp is required');
    res.json(
      await q(`SELECT * FROM tasks WHERE bootcamp_id = ? ORDER BY created_at DESC`, [
        Number(req.query.bootcamp),
      ])
    );
  })
);

// POST /api/tasks  (admin)  { title, description, due_date, bootcamp_id }
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { title, description, due_date, bootcamp_id, file_url, file_name } = req.body || {};
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    if (!title) throw new HttpError(400, 'Title is required');
    const r = await q(
      `INSERT INTO tasks (title, description, due_date, bootcamp_id, file_url, file_name) VALUES (?,?,?,?,?,?)`,
      [title.trim(), description || null, due_date || null, Number(bootcamp_id), file_url || null, file_name || null]
    );
    res.status(201).json({ id: r.insertId });
  })
);

// PUT /api/tasks/:id  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const { title, description, due_date, file_url, file_name } = req.body || {};
    await q(`UPDATE tasks SET title = ?, description = ?, due_date = ?, file_url = ?, file_name = ? WHERE id = ?`, [
      title, description || null, due_date || null, file_url || null, file_name || null, Number(req.params.id),
    ]);
    res.json({ ok: true });
  })
);

// DELETE /api/tasks/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`DELETE FROM tasks WHERE id = ?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

// GET /api/tasks/my-feedback  (student) — all tasks for their bootcamp + their team's feedback
router.get(
  '/my-feedback',
  requireRole('student'),
  ah(async (req, res) => {
    const sRows = await q(
      `SELECT bootcamp_id, team_id FROM students WHERE user_id = ? LIMIT 1`,
      [req.user.id]
    );
    if (!sRows[0]) throw new HttpError(404, 'Student record not found');
    const { bootcamp_id, team_id } = sRows[0];
    const tasks = await q(
      `SELECT * FROM tasks WHERE bootcamp_id = ? ORDER BY created_at DESC`,
      [bootcamp_id]
    );
    const feedbackMap = {};
    if (team_id && tasks.length) {
      const taskIds = tasks.map((t) => t.id);
      const feedbacks = await q(
        `SELECT tf.*, u.name AS mentor_name
         FROM task_feedback tf
         JOIN users u ON u.id = tf.mentor_id
         WHERE tf.team_id = ? AND tf.task_id IN (?)`,
        [team_id, taskIds]
      );
      feedbacks.forEach((f) => {
        if (!feedbackMap[f.task_id]) feedbackMap[f.task_id] = [];
        feedbackMap[f.task_id].push(f);
      });
    }
    res.json({ tasks, teamId: team_id, feedbackMap });
  })
);

// GET /api/tasks/:id/feedback  (admin + mentor) — all feedback across teams
router.get(
  '/:id/feedback',
  requireRole('admin', 'mentor'),
  ah(async (req, res) => {
    const rows = await q(
      `SELECT tf.*, t.name AS team_name, u.name AS mentor_name
       FROM task_feedback tf
       JOIN teams t ON t.id = tf.team_id
       JOIN users u ON u.id = tf.mentor_id
       WHERE tf.task_id = ?
       ORDER BY t.name`,
      [Number(req.params.id)]
    );
    res.json(rows);
  })
);

// POST /api/tasks/:id/feedback  (mentor) — upsert feedback for a team
router.post(
  '/:id/feedback',
  requireRole('mentor'),
  ah(async (req, res) => {
    const taskId = Number(req.params.id);
    const { team_id, feedback, score } = req.body || {};
    if (!team_id) throw new HttpError(400, 'team_id is required');
    const fb = (feedback ?? '').toString().trim();
    const hasScore = !(score === '' || score === null || score === undefined);
    if (!fb && !hasScore) {
      // Cleared both → remove this mentor's feedback row entirely.
      await q(`DELETE FROM task_feedback WHERE task_id = ? AND team_id = ? AND mentor_id = ?`,
        [taskId, Number(team_id), req.user.id]);
      return res.json({ ok: true, deleted: true });
    }
    await q(
      `INSERT INTO task_feedback (task_id, team_id, mentor_id, feedback, score)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE feedback = VALUES(feedback), score = VALUES(score)`,
      [taskId, Number(team_id), req.user.id, fb || null, hasScore ? Number(score) : null]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
