const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { questionApplies } = require('./questions');

const router = express.Router();
router.use(authRequired);

// Default password every approved student gets; they change it from Settings.
const DEFAULT_STUDENT_PASSWORD = '12345678';

// Returns the name of another bootcamp where this email is already approved, else null.
async function approvedElsewhere(email, exceptBootcampId) {
  const rows = await q(
    `SELECT b.name FROM students s JOIN bootcamps b ON b.id = s.bootcamp_id
     WHERE s.email = ? AND s.status = 'approved' AND s.bootcamp_id <> ? LIMIT 1`,
    [String(email).toLowerCase().trim(), Number(exceptBootcampId)]
  );
  return rows[0]?.name || null;
}

// Approve one student row: provision (or reuse) a login, then mark approved.
async function approveStudent(student, adminId) {
  if (student.status === 'approved') return;
  if (!student.user_id) {
    const existingUser = await q(`SELECT id FROM users WHERE email = ?`, [student.email]);
    let userId;
    if (existingUser.length) {
      userId = existingUser[0].id; // reuse login if the person exists in another bootcamp
    } else {
      const hash = await bcrypt.hash(DEFAULT_STUDENT_PASSWORD, 10);
      const u = await q(
        `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?, 'student')`,
        [student.name, student.email, student.phone || null, hash]
      );
      userId = u.insertId;
    }
    await q(`UPDATE students SET status='approved', approved_by=?, user_id=? WHERE id=?`, [
      adminId, userId, student.id,
    ]);
  } else {
    await q(`UPDATE students SET status='approved', approved_by=? WHERE id=?`, [adminId, student.id]);
  }
}

// GET /api/students/me/overview  (student) — dashboard: team/SPOC/mentor/table + stats
router.get(
  '/me/overview',
  requireRole('student'),
  ah(async (req, res) => {
    const sRows = await q(`SELECT * FROM students WHERE user_id = ? LIMIT 1`, [req.user.id]);
    const student = sRows[0];
    if (!student) throw new HttpError(404, 'No student profile linked to this account');

    // Team + SPOC + mentors + table
    let team = null;
    if (student.team_id) {
      const tRows = await q(`SELECT id, name, table_id, spoc_student_id FROM teams WHERE id = ?`, [student.team_id]);
      if (tRows[0]) {
        const t = tRows[0];
        const mentors = await q(
          `SELECT u.id, u.name, u.email FROM team_mentors tm JOIN users u ON u.id = tm.mentor_id WHERE tm.team_id = ?`,
          [t.id]
        );
        const memberRows = await q(`SELECT id, name, email FROM students WHERE team_id = ? ORDER BY name`, [t.id]);
        const members = memberRows.map((m) => ({
          ...m,
          is_you: m.id === student.id,
          is_spoc: m.id === t.spoc_student_id,
        }));
        let spoc = null;
        if (t.spoc_student_id) {
          const sp = await q(`SELECT id, name FROM students WHERE id = ?`, [t.spoc_student_id]);
          spoc = sp[0] || null;
        }
        team = {
          id: t.id, name: t.name, table_id: t.table_id, size: members.length,
          mentors,
          members,
          spoc,
          isSpoc: t.spoc_student_id === student.id,
        };
      }
    }

    // Task stats (bootcamp-wide tasks; feedback is per team)
    const tasks = (await q(`SELECT COUNT(*) AS c FROM tasks WHERE bootcamp_id = ?`, [student.bootcamp_id]))[0].c;
    const feedbackReceived = student.team_id
      ? (await q(`SELECT COUNT(DISTINCT task_id) AS c FROM task_feedback WHERE team_id = ?`, [student.team_id]))[0].c
      : 0;

    // Submission stats — reuse the exact audience-targeting logic
    const questions = await q(`SELECT * FROM questions WHERE bootcamp_id = ?`, [student.bootcamp_id]);
    const targets = await q(`SELECT * FROM question_targets`);
    const spocTeamIds = (await q(`SELECT id FROM teams WHERE spoc_student_id = ?`, [student.id])).map((r) => r.id);
    const answers = await q(`SELECT question_id, value_text, value_number, file_url FROM answers WHERE student_id = ?`, [student.id]);
    const answeredIds = new Set(
      answers.filter((a) => a.value_text || a.value_number != null || a.file_url).map((a) => a.question_id)
    );
    const applicable = questions.filter((qq) => questionApplies(qq, targets, student, spocTeamIds));
    const submissionsTotal = applicable.length;
    const submissionsAnswered = applicable.filter((qq) => answeredIds.has(qq.id)).length;

    res.json({
      student: { name: student.name, email: student.email, team_id: student.team_id },
      team,
      stats: {
        tasks,
        feedbackReceived,
        submissionsTotal,
        submissionsAnswered,
        submissionsPending: submissionsTotal - submissionsAnswered,
      },
    });
  })
);

// GET /api/students?bootcamp=&status=&team=&unassigned=1  (admin + mentor + volunteer)
router.get(
  '/',
  requireRole('admin', 'mentor', 'volunteer'),
  ah(async (req, res) => {
    const { status, team, unassigned, bootcamp } = req.query;
    const where = [];
    const params = [];
    if (bootcamp) { where.push('s.bootcamp_id = ?'); params.push(Number(bootcamp)); }
    if (status) { where.push('s.status = ?'); params.push(status); }
    if (team) { where.push('s.team_id = ?'); params.push(Number(team)); }
    if (unassigned === '1') where.push('s.team_id IS NULL AND s.status = "approved"');
    if (req.user.role === 'volunteer') { where.push('s.registered_by = ?'); params.push(req.user.id); }

    const sql = `
      SELECT s.*, t.name AS team_name,
             reg.name AS registered_by_name, app.name AS approved_by_name
      FROM students s
      LEFT JOIN teams t ON t.id = s.team_id
      LEFT JOIN users reg ON reg.id = s.registered_by
      LEFT JOIN users app ON app.id = s.approved_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY s.created_at DESC`;
    res.json(await q(sql, params));
  })
);

// POST /api/students  — register a student into a bootcamp (volunteer or admin)
router.post(
  '/',
  requireRole('admin', 'volunteer'),
  ah(async (req, res) => {
    const { name, email, phone, college, branch, year, roll_no, notes, bootcamp_id, roster_id } =
      req.body || {};
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    if (!name || !email) throw new HttpError(400, 'Name and email are required');

    const camp = await q(`SELECT * FROM bootcamps WHERE id = ?`, [Number(bootcamp_id)]);
    if (!camp[0]) throw new HttpError(404, 'Bootcamp not found');
    if (!camp[0].registration_open && req.user.role !== 'admin')
      throw new HttpError(403, 'Registration is closed for this bootcamp');

    const dup = await q(`SELECT id FROM students WHERE email = ? AND bootcamp_id = ?`, [
      email.toLowerCase().trim(), Number(bootcamp_id),
    ]);
    if (dup.length) throw new HttpError(409, 'This student is already registered for this bootcamp');

    const other = await approvedElsewhere(email, bootcamp_id);
    if (other)
      throw new HttpError(409, `This student is already approved in "${other}". Remove them there before registering here.`);

    const result = await q(
      `INSERT INTO students (bootcamp_id, roster_id, name, email, phone, college, branch, year, roll_no, notes, status, registered_by)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      [
        Number(bootcamp_id), roster_id ? Number(roster_id) : null,
        name.trim(), email.toLowerCase().trim(), phone || null, college || null,
        branch || null, year || null, roll_no || null, notes || null, req.user.id,
      ]
    );
    res.status(201).json({ id: result.insertId });
  })
);

// PUT /api/students/:id — edit details (admin, or volunteer who registered)
router.put(
  '/:id',
  requireRole('admin', 'volunteer'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT * FROM students WHERE id = ?`, [id]);
    const student = rows[0];
    if (!student) throw new HttpError(404, 'Student not found');
    if (req.user.role === 'volunteer' && student.registered_by !== req.user.id)
      throw new HttpError(403, 'You can only edit students you registered');

    const editable = ['name', 'email', 'phone', 'college', 'branch', 'year', 'roll_no', 'notes'];
    const fields = [];
    const params = [];
    for (const f of editable) {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = ?`);
        params.push(f === 'email' ? String(req.body[f]).toLowerCase().trim() : req.body[f]);
      }
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    params.push(id);
    await q(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// POST /api/students/:id/approve — admin approves & provisions a login account
router.post(
  '/:id/approve',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT * FROM students WHERE id = ?`, [id]);
    const student = rows[0];
    if (!student) throw new HttpError(404, 'Student not found');
    const other = await approvedElsewhere(student.email, student.bootcamp_id);
    if (other)
      throw new HttpError(409, `This student is already approved in "${other}". Remove them there first.`);
    const isNew = !student.user_id;
    await approveStudent(student, req.user.id);
    res.json({
      ok: true,
      email: student.email,
      defaultPassword: isNew ? DEFAULT_STUDENT_PASSWORD : null,
    });
  })
);

// POST /api/students/approve-all  { bootcamp_id }  — approve every pending student
router.post(
  '/approve-all',
  requireRole('admin'),
  ah(async (req, res) => {
    const bootcampId = Number(req.body?.bootcamp_id);
    if (!bootcampId) throw new HttpError(400, 'bootcamp_id is required');
    const pending = await q(
      `SELECT * FROM students WHERE bootcamp_id = ? AND status = 'pending'`,
      [bootcampId]
    );
    let approved = 0;
    let skipped = 0;
    for (const student of pending) {
      if (await approvedElsewhere(student.email, student.bootcamp_id)) { skipped++; continue; }
      await approveStudent(student, req.user.id);
      approved++;
    }
    res.json({ approved, skipped, defaultPassword: DEFAULT_STUDENT_PASSWORD });
  })
);

// POST /api/students/:id/reject
router.post(
  '/:id/reject',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`UPDATE students SET status='rejected' WHERE id=?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

// DELETE /api/students/:id
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    await q(`DELETE FROM students WHERE id=?`, [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

module.exports = router;
