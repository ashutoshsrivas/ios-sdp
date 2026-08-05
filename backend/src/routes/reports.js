const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

// GET /api/reports?bootcamp=  — everything needed to render assessment analytics.
router.get(
  '/',
  ah(async (req, res) => {
    const bootcamp = Number(req.query.bootcamp);
    if (!bootcamp) throw new HttpError(400, 'bootcamp is required');

    const teams = await q(
      `SELECT t.*, s.name AS spoc_name
       FROM teams t LEFT JOIN students s ON s.id = t.spoc_student_id
       WHERE t.bootcamp_id = ? ORDER BY t.id`,
      [bootcamp]
    );
    const students = await q(
      `SELECT id, name, email, team_id FROM students
       WHERE bootcamp_id = ? AND status = 'approved' ORDER BY name`,
      [bootcamp]
    );
    const rubrics = await q(`SELECT * FROM rubrics WHERE bootcamp_id = ? ORDER BY created_at`, [
      bootcamp,
    ]);
    const rubricIds = rubrics.map((r) => r.id);

    let criteria = [];
    let scores = [];
    if (rubricIds.length) {
      criteria = await q(
        `SELECT * FROM rubric_criteria WHERE rubric_id IN (?) ORDER BY sort_order, id`,
        [rubricIds]
      );
      scores = await q(
        `SELECT rs.student_id, rs.mentor_id, rs.score, rs.comment, rs.criteria_id,
                rc.rubric_id, rc.name AS criteria_name, rc.max_score, rc.weight,
                u.name AS mentor_name
         FROM rubric_scores rs
         JOIN rubric_criteria rc ON rc.id = rs.criteria_id
         JOIN users u ON u.id = rs.mentor_id
         WHERE rc.rubric_id IN (?)`,
        [rubricIds]
      );
    }

    const teamMentors = teams.length
      ? await q(
          `SELECT tm.team_id, u.id, u.name FROM team_mentors tm
           JOIN users u ON u.id = tm.mentor_id WHERE tm.team_id IN (?)`,
          [teams.map((t) => t.id)]
        )
      : [];

    const tasks = await q(`SELECT id, title FROM tasks WHERE bootcamp_id = ? ORDER BY created_at`, [
      bootcamp,
    ]);
    const taskFeedback = await q(
      `SELECT tf.team_id, tf.mentor_id, tf.feedback, tf.score, t.id AS task_id, t.title AS task_title,
              u.name AS mentor_name
       FROM task_feedback tf
       JOIN tasks t ON t.id = tf.task_id
       JOIN users u ON u.id = tf.mentor_id
       WHERE t.bootcamp_id = ? ORDER BY t.created_at`,
      [bootcamp]
    );

    res.json({ teams, students, rubrics, criteria, scores, taskFeedback, tasks, teamMentors });
  })
);

module.exports = router;
