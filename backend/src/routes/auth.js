const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const { ah, HttpError } = require('../util');

const router = express.Router();

// POST /api/auth/login
router.post(
  '/login',
  ah(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, 'Email and password are required');
    const rows = await q(`SELECT * FROM users WHERE email = ? LIMIT 1`, [
      String(email).toLowerCase().trim(),
    ]);
    const user = rows[0];
    if (!user) throw new HttpError(401, 'Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new HttpError(401, 'Invalid credentials');
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authRequired,
  ah(async (req, res) => {
    const rows = await q(`SELECT id, name, email, role, phone FROM users WHERE id = ?`, [
      req.user.id,
    ]);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    // If this user is a student, include their student record id.
    let student = null;
    if (rows[0].role === 'student') {
      const s = await q(`SELECT * FROM students WHERE user_id = ? LIMIT 1`, [req.user.id]);
      student = s[0] || null;
    }
    res.json({ user: rows[0], student });
  })
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authRequired,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6)
      throw new HttpError(400, 'New password must be at least 6 characters');
    const rows = await q(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    const user = rows[0];
    const ok = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!ok) throw new HttpError(400, 'Current password is incorrect');
    const hash = await bcrypt.hash(newPassword, 10);
    await q(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
