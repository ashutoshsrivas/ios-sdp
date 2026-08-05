const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah } = require('../util');

const router = express.Router();
router.use(authRequired);

// GET /api/settings — any authenticated user (to know if registration is open)
router.get(
  '/',
  ah(async (_req, res) => {
    const rows = await q(`SELECT skey, svalue FROM settings`);
    const out = {};
    rows.forEach((r) => (out[r.skey] = r.svalue));
    res.json(out);
  })
);

// PUT /api/settings/registration  { open: boolean }  (admin)
router.put(
  '/registration',
  requireRole('admin'),
  ah(async (req, res) => {
    const open = req.body?.open ? 'true' : 'false';
    await q(
      `INSERT INTO settings (skey, svalue) VALUES ('registration_open', ?)
       ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)`,
      [open]
    );
    res.json({ registration_open: open });
  })
);

module.exports = router;
