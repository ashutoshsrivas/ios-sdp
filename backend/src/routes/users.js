const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { PERMISSIONS, GRANTABLE_ROLES, isValidPermission } = require('../permissions');

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
    const users = await q(sql, params);

    const grants = await q(`SELECT user_id, permission FROM user_permissions`);
    const byUser = new Map();
    for (const g of grants) {
      if (!isValidPermission(g.permission)) continue;
      if (!byUser.has(g.user_id)) byUser.set(g.user_id, []);
      byUser.get(g.user_id).push(g.permission);
    }
    res.json(users.map((u) => ({ ...u, permissions: byUser.get(u.id) || [] })));
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

// GET /api/users/permissions/catalogue  (admin) — what can be granted.
// Declared before /:id routes so "permissions" is never read as an id.
router.get(
  '/permissions/catalogue',
  requireRole('admin'),
  ah(async (_req, res) => {
    res.json({ permissions: PERMISSIONS, grantableRoles: GRANTABLE_ROLES });
  })
);

// PUT /api/users/:id/permissions  { permissions: string[] }  (admin)
// Replaces the user's grants with exactly this list.
router.put(
  '/:id/permissions',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q(`SELECT id, role FROM users WHERE id = ?`, [id]);
    const target = rows[0];
    if (!target) throw new HttpError(404, 'User not found');

    if (target.role === 'admin') {
      throw new HttpError(400, 'Admins already have every access right.');
    }
    if (!GRANTABLE_ROLES.includes(target.role)) {
      throw new HttpError(400, `Access rights cannot be granted to a ${target.role}.`);
    }

    const list = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const unknown = list.filter((k) => !isValidPermission(k));
    if (unknown.length) throw new HttpError(400, `Unknown access right: ${unknown.join(', ')}`);

    // Replace wholesale so unticking a box actually revokes it.
    const wanted = [...new Set(list)];
    await q(`DELETE FROM user_permissions WHERE user_id = ?`, [id]);
    for (const key of wanted) {
      await q(
        `INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?,?,?)`,
        [id, key, req.user.id]
      );
    }
    res.json({ ok: true, permissions: wanted });
  })
);

module.exports = router;
