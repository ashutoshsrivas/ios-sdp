const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();

const ROLES = ['admin', 'mentor', 'volunteer', 'student'];

// All routes here are admin-only.
router.use(authRequired, requireRole('admin'));

// GET /api/users?role=mentor
router.get(
  '/',
  ah(async (req, res) => {
    const { role } = req.query;
    let sql = `SELECT id, name, email, phone, role, created_at FROM users`;
    const params = [];
    if (role) {
      sql += ` WHERE role = ?`;
      params.push(role);
    }
    sql += ` ORDER BY role, name`;
    res.json(await q(sql, params));
  })
);

// POST /api/users  { name, email, phone, password, role }
router.post(
  '/',
  ah(async (req, res) => {
    const { name, email, phone, password, role } = req.body || {};
    if (!name || !email || !password || !role)
      throw new HttpError(400, 'name, email, password and role are required');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');

    const existing = await q(`SELECT id FROM users WHERE email = ?`, [
      email.toLowerCase().trim(),
    ]);
    if (existing.length) throw new HttpError(409, 'A user with that email already exists');

    const hash = await bcrypt.hash(password, 10);
    const result = await q(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?,?)`,
      [name.trim(), email.toLowerCase().trim(), phone || null, hash, role]
    );

    // Creating a student user also creates an (approved) student profile in a bootcamp.
    if (role === 'student') {
      let campId = req.body.bootcamp_id ? Number(req.body.bootcamp_id) : null;
      if (!campId) {
        const c = await q(`SELECT id FROM bootcamps ORDER BY id LIMIT 1`);
        campId = c[0]?.id || null;
      }
      await q(
        `INSERT INTO students (bootcamp_id, user_id, name, email, phone, status, approved_by)
         VALUES (?,?,?,?,?, 'approved', ?)`,
        [campId, result.insertId, name.trim(), email.toLowerCase().trim(), phone || null, req.user.id]
      );
    }

    res.status(201).json({ id: result.insertId });
  })
);

// PUT /api/users/:id  { name, email, phone, role, password? }
router.put(
  '/:id',
  ah(async (req, res) => {
    const { name, email, phone, role, password } = req.body || {};
    const id = Number(req.params.id);
    const rows = await q(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    if (role && !ROLES.includes(role)) throw new HttpError(400, 'Invalid role');

    const fields = [];
    const params = [];
    if (name) { fields.push('name = ?'); params.push(name.trim()); }
    if (email) { fields.push('email = ?'); params.push(email.toLowerCase().trim()); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone || null); }
    if (role) { fields.push('role = ?'); params.push(role); }
    if (password) {
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 10));
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    params.push(id);
    await q(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  })
);

// DELETE /api/users/:id
router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
    await q(`DELETE FROM users WHERE id = ?`, [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
