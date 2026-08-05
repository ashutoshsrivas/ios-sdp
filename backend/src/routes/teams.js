const express = require('express');
const { getPool, q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();
router.use(authRequired);

// ---- Physical table IDs: A..Y, each with a MIN and MAX half (A-MIN, A-MAX, B-MIN, …) ----
const TABLE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXY'; // A..Y (no Z), per requirement
function letterAt(i) {
  if (i < 25) return TABLE_ALPHABET[i];
  const j = i - 25;
  return TABLE_ALPHABET[Math.floor(j / 25)] + TABLE_ALPHABET[j % 25];
}
function tableIdSequence(count) {
  const ids = [];
  for (let i = 0; ids.length < count; i++) {
    const letter = letterAt(i);
    ids.push(`${letter}-MIN`);
    if (ids.length < count) ids.push(`${letter}-MAX`);
  }
  return ids;
}

// Fill table IDs for teams that don't have one yet, in team order (leaves existing ones intact).
async function assignTablesFill(bootcampId) {
  const teams = await q(`SELECT id, table_id FROM teams WHERE bootcamp_id = ? ORDER BY id`, [bootcampId]);
  const used = new Set(teams.map((t) => t.table_id).filter(Boolean));
  const seq = tableIdSequence(teams.length + used.size + 4);
  let ptr = 0;
  for (const t of teams) {
    if (t.table_id) continue;
    while (ptr < seq.length && used.has(seq[ptr])) ptr++;
    const id = seq[ptr++];
    used.add(id);
    await q(`UPDATE teams SET table_id = ? WHERE id = ?`, [id, t.id]);
  }
}

// Re-number every team's table ID strictly in team order (overwrites existing).
async function assignTablesReset(bootcampId) {
  const teams = await q(`SELECT id FROM teams WHERE bootcamp_id = ? ORDER BY id`, [bootcampId]);
  const seq = tableIdSequence(teams.length);
  for (let i = 0; i < teams.length; i++) {
    await q(`UPDATE teams SET table_id = ? WHERE id = ?`, [seq[i], teams[i].id]);
  }
}

// Assemble full team objects (members, mentors, spoc) for one bootcamp.
async function loadTeams(bootcampId) {
  const teams = await q(`SELECT * FROM teams WHERE bootcamp_id = ? ORDER BY id`, [bootcampId]);
  if (!teams.length) return [];
  const ids = teams.map((t) => t.id);
  const members = await q(
    `SELECT id, name, email, team_id FROM students WHERE team_id IN (?) ORDER BY name`,
    [ids]
  );
  const mentors = await q(
    `SELECT tm.team_id, u.id, u.name, u.email
     FROM team_mentors tm JOIN users u ON u.id = tm.mentor_id
     WHERE tm.team_id IN (?)`,
    [ids]
  );
  return teams.map((t) => ({
    ...t,
    members: members.filter((m) => m.team_id === t.id),
    mentors: mentors.filter((m) => m.team_id === t.id),
  }));
}

// GET /api/teams?bootcamp=  (admin + mentor + student + volunteer)
router.get(
  '/',
  requireRole('admin', 'mentor', 'student', 'volunteer'),
  ah(async (req, res) => {
    if (!req.query.bootcamp) throw new HttpError(400, 'bootcamp is required');
    res.json(await loadTeams(Number(req.query.bootcamp)));
  })
);

// POST /api/teams  { name, bootcamp_id }  (admin)
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { name, bootcamp_id } = req.body || {};
    if (!name) throw new HttpError(400, 'Team name is required');
    if (!bootcamp_id) throw new HttpError(400, 'bootcamp_id is required');
    const r = await q(`INSERT INTO teams (name, bootcamp_id) VALUES (?, ?)`, [
      name.trim(), Number(bootcamp_id),
    ]);
    await assignTablesFill(Number(bootcamp_id));
    res.status(201).json({ id: r.insertId });
  })
);

// POST /api/teams/auto  (admin)
//   assign students:  { assignStudents: true, teamSize, reset, bootcamp_id }
//   empty teams only: { assignStudents: false, teamCount, reset, bootcamp_id }
router.post(
  '/auto',
  requireRole('admin'),
  ah(async (req, res) => {
    const reset = !!req.body?.reset;
    const bootcampId = Number(req.body?.bootcamp_id);
    const assignStudents = req.body?.assignStudents !== false; // default true
    if (!bootcampId) throw new HttpError(400, 'bootcamp_id is required');

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (reset) {
        await conn.query(`UPDATE students SET team_id = NULL WHERE bootcamp_id = ?`, [bootcampId]);
        await conn.query(`DELETE FROM teams WHERE bootcamp_id = ?`, [bootcampId]);
      }
      const [existing] = await conn.query(`SELECT COUNT(*) AS c FROM teams WHERE bootcamp_id = ?`, [
        bootcampId,
      ]);
      const offset = existing[0].c;

      // Mode B: create N empty teams to fill manually from the pool.
      if (!assignStudents) {
        const teamCount = Math.max(0, parseInt(req.body?.teamCount, 10) || 0);
        if (!teamCount) throw new HttpError(400, 'A valid number of teams is required');
        for (let i = 0; i < teamCount; i++) {
          await conn.query(`INSERT INTO teams (name, bootcamp_id) VALUES (?, ?)`, [
            `Team ${offset + i + 1}`, bootcampId,
          ]);
        }
        await conn.commit();
        await assignTablesFill(bootcampId);
        return res.json({ created: teamCount, placed: 0 });
      }

      // Mode A: balanced teams of teamSize, filled with approved unassigned students.
      const teamSize = Math.max(0, parseInt(req.body?.teamSize, 10) || 0);
      if (!teamSize) throw new HttpError(400, 'A valid team size is required');
      const [students] = await conn.query(
        `SELECT id FROM students WHERE status='approved' AND team_id IS NULL AND bootcamp_id = ? ORDER BY RAND()`,
        [bootcampId]
      );
      if (!students.length) {
        await conn.commit();
        return res.json({ created: 0, placed: 0, message: 'No unassigned approved students' });
      }
      const numTeams = Math.ceil(students.length / teamSize);
      const teamIds = [];
      for (let i = 0; i < numTeams; i++) {
        const [r] = await conn.query(`INSERT INTO teams (name, bootcamp_id) VALUES (?, ?)`, [
          `Team ${offset + i + 1}`, bootcampId,
        ]);
        teamIds.push(r.insertId);
      }
      for (let i = 0; i < students.length; i++) {
        await conn.query(`UPDATE students SET team_id = ? WHERE id = ?`, [
          teamIds[i % numTeams], students[i].id,
        ]);
      }
      await conn.commit();
      await assignTablesFill(bootcampId);
      res.json({ created: numTeams, placed: students.length });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

// PUT /api/teams/:id  { name?, remarks? }  (admin)
router.put(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const { name, remarks } = req.body || {};
    const fields = [];
    const params = [];
    if (name !== undefined) {
      if (!name.trim()) throw new HttpError(400, 'Team name cannot be empty');
      fields.push('name = ?'); params.push(name.trim());
    }
    if (remarks !== undefined) { fields.push('remarks = ?'); params.push(remarks || null); }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    params.push(Number(req.params.id));
    await q(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/teams/:id  (admin)
router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    await q(`UPDATE students SET team_id = NULL WHERE team_id = ?`, [id]);
    await q(`DELETE FROM teams WHERE id = ?`, [id]);
    res.json({ ok: true });
  })
);

// POST /api/teams/:id/members  { studentId }  (admin)
router.post(
  '/:id/members',
  requireRole('admin'),
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    const studentId = Number(req.body?.studentId);
    if (!studentId) throw new HttpError(400, 'studentId is required');
    const t = await q(`SELECT bootcamp_id FROM teams WHERE id = ?`, [teamId]);
    if (!t.length) throw new HttpError(404, 'Team not found');
    // Keep moves within the same bootcamp.
    await q(`UPDATE students SET team_id = ? WHERE id = ? AND bootcamp_id = ?`, [
      teamId, studentId, t[0].bootcamp_id,
    ]);
    res.json({ ok: true });
  })
);

// DELETE /api/teams/:id/members/:studentId  (admin)
router.delete(
  '/:id/members/:studentId',
  requireRole('admin'),
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    const studentId = Number(req.params.studentId);
    await q(`UPDATE students SET team_id = NULL WHERE id = ? AND team_id = ?`, [studentId, teamId]);
    await q(`UPDATE teams SET spoc_student_id = NULL WHERE id = ? AND spoc_student_id = ?`, [
      teamId, studentId,
    ]);
    res.json({ ok: true });
  })
);

// PUT /api/teams/:id/spoc  { studentId }  (admin)
router.put(
  '/:id/spoc',
  requireRole('admin'),
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    const studentId = req.body?.studentId ? Number(req.body.studentId) : null;
    if (studentId) {
      const m = await q(`SELECT id FROM students WHERE id = ? AND team_id = ?`, [studentId, teamId]);
      if (!m.length) throw new HttpError(400, 'SPOC must be a member of the team');
    }
    await q(`UPDATE teams SET spoc_student_id = ? WHERE id = ?`, [studentId, teamId]);
    res.json({ ok: true });
  })
);

// POST /api/teams/assign-tables  { bootcamp_id, reset }  (admin)
router.post(
  '/assign-tables',
  requireRole('admin'),
  ah(async (req, res) => {
    const bootcampId = Number(req.body?.bootcamp_id);
    if (!bootcampId) throw new HttpError(400, 'bootcamp_id is required');
    if (req.body?.reset) await assignTablesReset(bootcampId);
    else await assignTablesFill(bootcampId);
    res.json({ ok: true });
  })
);

// PUT /api/teams/:id/table  { tableId }  (admin) — set/swap a team's table ID
router.put(
  '/:id/table',
  requireRole('admin'),
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    const tableId = req.body?.tableId ? String(req.body.tableId).trim() : null;
    const rows = await q(`SELECT id, bootcamp_id, table_id FROM teams WHERE id = ?`, [teamId]);
    const team = rows[0];
    if (!team) throw new HttpError(404, 'Team not found');
    if (tableId) {
      // If another team in this bootcamp holds this table ID, swap it to our old one.
      const other = await q(
        `SELECT id FROM teams WHERE bootcamp_id = ? AND table_id = ? AND id <> ?`,
        [team.bootcamp_id, tableId, teamId]
      );
      if (other.length) {
        await q(`UPDATE teams SET table_id = ? WHERE id = ?`, [team.table_id, other[0].id]);
      }
    }
    await q(`UPDATE teams SET table_id = ? WHERE id = ?`, [tableId, teamId]);
    res.json({ ok: true });
  })
);

// PUT /api/teams/:id/mentors  { mentorIds: [] }  (admin)
router.put(
  '/:id/mentors',
  requireRole('admin'),
  ah(async (req, res) => {
    const teamId = Number(req.params.id);
    const mentorIds = Array.isArray(req.body?.mentorIds) ? req.body.mentorIds.map(Number) : [];
    await q(`DELETE FROM team_mentors WHERE team_id = ?`, [teamId]);
    for (const mid of mentorIds) {
      await q(`INSERT IGNORE INTO team_mentors (team_id, mentor_id) VALUES (?, ?)`, [teamId, mid]);
    }
    res.json({ ok: true });
  })
);

module.exports = router;
