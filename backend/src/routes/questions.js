const express = require('express');
const archiver = require('archiver');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { MAX_ALLOWED_MB, globalMaxUploadMb } = require('../uploadLimit');
const { deleteObject, keyFromUrl } = require('../s3');

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

// Newest submission first, but the questions inside one submission stay in the order they
// were authored. They are inserted one by one, so ascending id is that order — created_at
// alone is not enough, since a whole batch usually lands within the same second and MySQL
// then returns tied rows in no particular order.
function orderQuestions(rows) {
  const keyOf = (r) => r.batch_id || `single-${r.id}`;
  const newest = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!newest.has(k) || r.id > newest.get(k)) newest.set(k, r.id);
  }
  return [...rows].sort(
    (a, b) => newest.get(keyOf(b)) - newest.get(keyOf(a)) || a.id - b.id
  );
}

// ---------- Admin management ----------

// GET /api/questions?bootcamp=  (admin)
router.get(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    if (!req.query.bootcamp) throw new HttpError(400, 'bootcamp is required');
    const questions = orderQuestions(
      await q(`SELECT * FROM questions WHERE bootcamp_id = ?`, [Number(req.query.bootcamp)])
    );
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
    const { title, description, input_type, audience, required, targets, bootcamp_id, batch_id,
      max_upload_mb, allow_resubmission } = req.body || {};
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    if (!title) throw new HttpError(400, 'Title is required');
    if (!INPUT_TYPES.includes(input_type)) throw new HttpError(400, 'Invalid input_type');
    if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Invalid audience');

    // Per-question upload cap, only meaningful for a file question. Null means
    // "use the global setting". Clamped so a typo can't allow a huge upload.
    let maxUploadMb = null;
    if (input_type === 'file' && max_upload_mb !== undefined && max_upload_mb !== null && max_upload_mb !== '') {
      const n = Number(max_upload_mb);
      if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Max upload size must be a number of MB greater than zero');
      if (n > MAX_ALLOWED_MB) throw new HttpError(400, `Max upload size cannot exceed ${MAX_ALLOWED_MB} MB`);
      maxUploadMb = Math.floor(n);
    }

    const r = await q(
      `INSERT INTO questions (title, description, input_type, audience, required, bootcamp_id, batch_id, max_upload_mb, allow_resubmission)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [title.trim(), description || null, input_type, audience, required ? 1 : 0, Number(bootcamp_id), batch_id ? String(batch_id).slice(0, 40) : null, maxUploadMb,
       allow_resubmission === undefined ? 1 : (allow_resubmission ? 1 : 0)]
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

// Replace a question's audience targets with the given list.
async function setTargets(questionId, targets) {
  await q(`DELETE FROM question_targets WHERE question_id = ?`, [questionId]);
  if (!Array.isArray(targets)) return;
  for (const t of targets) {
    if (!['student', 'team'].includes(t.ref_type)) continue;
    await q(
      `INSERT IGNORE INTO question_targets (question_id, ref_type, ref_id) VALUES (?,?,?)`,
      [questionId, t.ref_type, Number(t.ref_id)]
    );
  }
}

// Validate and normalise a per-question upload cap.
function parseMaxUploadMb(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Max upload size must be a number of MB greater than zero');
  if (n > MAX_ALLOWED_MB) throw new HttpError(400, `Max upload size cannot exceed ${MAX_ALLOWED_MB} MB`);
  return Math.floor(n);
}

// PUT /api/questions/batch/:batchId  (admin) — the settings a submission's
// questions share: audience, targets, required and resubmission.
// Declared before /:id so "batch" is never read as an id.
router.put(
  '/batch/:batchId',
  requireRole('admin'),
  ah(async (req, res) => {
    const batchId = String(req.params.batchId).slice(0, 40);
    const rows = await q(`SELECT id FROM questions WHERE batch_id = ?`, [batchId]);
    if (rows.length === 0) throw new HttpError(404, 'Submission not found');

    const { audience, required, allow_resubmission, targets } = req.body || {};
    const fields = [];
    const params = [];
    if (audience !== undefined) {
      if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Invalid audience');
      fields.push('audience = ?'); params.push(audience);
    }
    if (required !== undefined) { fields.push('required = ?'); params.push(required ? 1 : 0); }
    if (allow_resubmission !== undefined) { fields.push('allow_resubmission = ?'); params.push(allow_resubmission ? 1 : 0); }

    if (fields.length) {
      await q(`UPDATE questions SET ${fields.join(', ')} WHERE batch_id = ?`, [...params, batchId]);
    }
    // Targets are per question, but a submission shares them, so apply to each.
    if (targets !== undefined) {
      for (const row of rows) await setTargets(row.id, targets);
    }
    res.json({ ok: true, updated: rows.length });
  })
);

// PUT /api/questions/:id  (admin) — edit one question.
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT * FROM questions WHERE id = ?`, [id]);
    const question = rows[0];
    if (!question) throw new HttpError(404, 'Question not found');

    const { title, description, input_type, audience, required, allow_resubmission, max_upload_mb, targets } =
      req.body || {};

    const fields = [];
    const params = [];

    if (title !== undefined) {
      if (!String(title).trim()) throw new HttpError(400, 'Title is required');
      fields.push('title = ?'); params.push(String(title).trim());
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(description || null); }

    if (input_type !== undefined && input_type !== question.input_type) {
      if (!INPUT_TYPES.includes(input_type)) throw new HttpError(400, 'Invalid input_type');
      // Answers are stored in type-specific columns, so switching type would
      // strand what students already submitted. Refuse rather than orphan it.
      const [{ c }] = await q(`SELECT COUNT(*) AS c FROM answers WHERE question_id = ?`, [id]);
      if (c > 0) {
        throw new HttpError(
          400,
          `This question already has ${c} answer${c === 1 ? '' : 's'}, so its answer type can no longer be changed. Delete it and create a new one if the type must change.`
        );
      }
      fields.push('input_type = ?'); params.push(input_type);
    }

    if (audience !== undefined) {
      if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Invalid audience');
      fields.push('audience = ?'); params.push(audience);
    }
    if (required !== undefined) { fields.push('required = ?'); params.push(required ? 1 : 0); }
    if (allow_resubmission !== undefined) { fields.push('allow_resubmission = ?'); params.push(allow_resubmission ? 1 : 0); }

    if (max_upload_mb !== undefined) {
      const effectiveType = input_type ?? question.input_type;
      fields.push('max_upload_mb = ?');
      params.push(effectiveType === 'file' ? parseMaxUploadMb(max_upload_mb) : null);
    }

    if (fields.length) {
      await q(`UPDATE questions SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    }
    if (targets !== undefined) await setTargets(id, targets);

    res.json({ ok: true });
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
    const questions = orderQuestions(
      await q(`SELECT * FROM questions WHERE bootcamp_id = ?`, [student.bootcamp_id])
    );
    const targets = await q(`SELECT * FROM question_targets`);
    const spocRows = await q(`SELECT id FROM teams WHERE spoc_student_id = ?`, [student.id]);
    const spocTeamIds = spocRows.map((r) => r.id);
    const answers = await q(`SELECT * FROM answers WHERE student_id = ?`, [student.id]);

    // Resolve each file question's effective cap once here, so the student UI
    // can show the limit and reject an oversized file before uploading it.
    const globalMb = await globalMaxUploadMb();

    const applicable = questions
      .filter((qq) => questionApplies(qq, targets, student, spocTeamIds))
      .map((qq) => ({
        ...qq,
        answer: answers.find((a) => a.question_id === qq.id) || null,
        effective_max_upload_mb: qq.input_type === 'file' ? (qq.max_upload_mb ?? globalMb) : null,
      }));
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

    // An answer is a free upsert only while resubmission is allowed. Once the
    // admin turns it off, the first submission is final.
    const existingRows = await q(
      `SELECT id, file_url FROM answers WHERE question_id = ? AND student_id = ?`,
      [qid, student.id]
    );
    const existing = existingRows[0];
    if (existing && !question.allow_resubmission) {
      throw new HttpError(
        403,
        'You have already submitted an answer to this question and resubmission is not allowed.'
      );
    }

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

    // A replaced file would otherwise stay in the bucket forever. Delete the
    // superseded object only after the new answer is safely stored, and only
    // when it really changed.
    if (existing?.file_url && file_url && existing.file_url !== file_url) {
      await deleteObject(keyFromUrl(existing.file_url));
    }

    res.json({ ok: true, replaced: Boolean(existing) });
  })
);

module.exports = router;
module.exports.questionApplies = questionApplies;
