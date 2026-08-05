const express = require('express');
const archiver = require('archiver');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();
router.use(authRequired);

const INPUT_TYPES = ['text', 'textarea', 'number', 'file', 'date', 'url'];
const AUDIENCES = ['all_students', 'selected_students', 'teams', 'team_spoc'];

// Does a question apply to this student? `spocTeamIds` = teams where student is spoc.
function questionApplies(question, targets, student, spocTeamIds) {
  const t = targets.filter((x) => x.question_id === question.id);
  switch (question.audience) {
    case 'all_students':
      return true;
    case 'selected_students':
      return t.some((x) => x.ref_type === 'student' && x.ref_id === student.id);
    case 'teams':
      return student.team_id && t.some((x) => x.ref_type === 'team' && x.ref_id === student.team_id);
    case 'team_spoc': {
      const teamTargets = t.filter((x) => x.ref_type === 'team');
      if (teamTargets.length === 0) return spocTeamIds.length > 0; // any spoc
      return teamTargets.some((x) => spocTeamIds.includes(x.ref_id));
    }
    default:
      return false;
  }
}

// ---------- Admin management ----------

// GET /api/questions?bootcamp=  (admin)
router.get(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    if (!req.query.bootcamp) throw new HttpError(400, 'bootcamp is required');
    const questions = await q(`SELECT * FROM questions WHERE bootcamp_id = ? ORDER BY created_at DESC`, [
      Number(req.query.bootcamp),
    ]);
    const targets = await q(`SELECT * FROM question_targets`);
    const counts = await q(
      `SELECT question_id, COUNT(*) AS answers FROM answers GROUP BY question_id`
    );
    res.json(
      questions.map((qq) => ({
        ...qq,
        targets: targets.filter((t) => t.question_id === qq.id),
        answer_count: counts.find((c) => c.question_id === qq.id)?.answers || 0,
      }))
    );
  })
);

// POST /api/questions  (admin)
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { title, description, input_type, audience, required, targets, bootcamp_id } = req.body || {};
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    if (!title) throw new HttpError(400, 'Title is required');
    if (!INPUT_TYPES.includes(input_type)) throw new HttpError(400, 'Invalid input_type');
    if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Invalid audience');

    const r = await q(
      `INSERT INTO questions (title, description, input_type, audience, required, bootcamp_id) VALUES (?,?,?,?,?,?)`,
      [title.trim(), description || null, input_type, audience, required ? 1 : 0, Number(bootcamp_id)]
    );
    if (Array.isArray(targets)) {
      for (const t of targets) {
        if (!['student', 'team'].includes(t.ref_type)) continue;
        await q(
          `INSERT IGNORE INTO question_targets (question_id, ref_type, ref_id) VALUES (?,?,?)`,
          [r.insertId, t.ref_type, Number(t.ref_id)]
        );
      }
    }
    res.status(201).json({ id: r.insertId });
  })
);

// DELETE /api/questions/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`DELETE FROM questions WHERE id = ?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

// GET /api/questions/:id/answers  (admin) — responses with student info
router.get(
  '/:id/answers',
  requireRole('admin'),
  ah(async (req, res) => {
    const rows = await q(
      `SELECT a.*, s.name AS student_name, s.email AS student_email, t.name AS team_name
       FROM answers a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN teams t ON t.id = s.team_id
       WHERE a.question_id = ?
       ORDER BY s.name`,
      [Number(req.params.id)]
    );
    res.json(rows);
  })
);

// GET /api/questions/:id/answers.zip  (admin) — a zip of all uploaded files for this submission
router.get(
  '/:id/answers.zip',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const question = (await q(`SELECT * FROM questions WHERE id = ?`, [id]))[0];
    if (!question) throw new HttpError(404, 'Submission not found');
    const answers = await q(
      `SELECT a.file_url, a.file_name, s.name AS student_name
       FROM answers a JOIN students s ON s.id = a.student_id
       WHERE a.question_id = ? AND a.file_url IS NOT NULL AND a.file_url <> ''
       ORDER BY s.name`,
      [id]
    );
    if (!answers.length) throw new HttpError(404, 'No files have been submitted for this submission');

    // Headers set only once we know we have files (so earlier errors stay JSON).
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="submission-${id}-files.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => res.destroy());
    archive.pipe(res);

    let i = 0;
    for (const a of answers) {
      i++;
      const fallback = a.file_url.split('/').pop() || 'file';
      const base = (a.file_name || fallback).replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const student = String(a.student_name || 'student').replace(/[^a-zA-Z0-9]/g, '_');
      const name = `${String(i).padStart(2, '0')}-${student}-${base}`;
      try {
        // Objects are public-read, so fetch over the public URL (avoids IAM entirely).
        const resp = await fetch(a.file_url);
        if (!resp.ok) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        archive.append(buf, { name });
      } catch {
        /* skip a missing/unreachable file */
      }
    }
    await archive.finalize();
  })
);

// ---------- Student side ----------

async function currentStudent(userId) {
  const rows = await q(`SELECT * FROM students WHERE user_id = ? LIMIT 1`, [userId]);
  return rows[0] || null;
}

// GET /api/questions/mine  (student) — applicable questions + own answers
router.get(
  '/mine',
  requireRole('student'),
  ah(async (req, res) => {
    const student = await currentStudent(req.user.id);
    if (!student) throw new HttpError(404, 'No student profile linked to this account');
    const questions = await q(`SELECT * FROM questions WHERE bootcamp_id = ? ORDER BY created_at DESC`, [
      student.bootcamp_id,
    ]);
    const targets = await q(`SELECT * FROM question_targets`);
    const spocRows = await q(`SELECT id FROM teams WHERE spoc_student_id = ?`, [student.id]);
    const spocTeamIds = spocRows.map((r) => r.id);
    const answers = await q(`SELECT * FROM answers WHERE student_id = ?`, [student.id]);

    const applicable = questions
      .filter((qq) => questionApplies(qq, targets, student, spocTeamIds))
      .map((qq) => ({ ...qq, answer: answers.find((a) => a.question_id === qq.id) || null }));
    res.json(applicable);
  })
);

// POST /api/questions/:id/answer  (student) — upsert answer
router.post(
  '/:id/answer',
  requireRole('student'),
  ah(async (req, res) => {
    const qid = Number(req.params.id);
    const student = await currentStudent(req.user.id);
    if (!student) throw new HttpError(404, 'No student profile linked to this account');

    const qrows = await q(`SELECT * FROM questions WHERE id = ?`, [qid]);
    const question = qrows[0];
    if (!question) throw new HttpError(404, 'Question not found');

    const targets = await q(`SELECT * FROM question_targets WHERE question_id = ?`, [qid]);
    const spocRows = await q(`SELECT id FROM teams WHERE spoc_student_id = ?`, [student.id]);
    if (!questionApplies(question, targets, student, spocRows.map((r) => r.id)))
      throw new HttpError(403, 'This question is not assigned to you');

    const { value_text, value_number, file_url, file_name } = req.body || {};
    await q(
      `INSERT INTO answers (question_id, student_id, value_text, value_number, file_url, file_name)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), value_number = VALUES(value_number),
         file_url = VALUES(file_url), file_name = VALUES(file_name)`,
      [
        qid, student.id,
        value_text ?? null,
        value_number === '' || value_number == null ? null : Number(value_number),
        file_url || null, file_name || null,
      ]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
module.exports.questionApplies = questionApplies;
