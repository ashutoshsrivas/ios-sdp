const express = require('express');
const { q } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { MAX_ALLOWED_MB, DEFAULT_MAX_UPLOAD_MB } = require('../uploadLimit');

const router = express.Router();
router.use(authRequired);

// GET /api/settings — any authenticated user (to know if registration is open)
router.get(
  '/',
  ah(async (_req, res) => {
    const rows = await q(`SELECT skey, svalue FROM settings`);
    const out = {};
    rows.forEach((r) => (out[r.skey] = r.svalue));
    // Always report an upload cap, even before an admin has set one, so the
    // UI can show and enforce a number without special-casing "unset".
    if (out.max_upload_mb === undefined) out.max_upload_mb = String(DEFAULT_MAX_UPLOAD_MB);
    out.max_upload_mb_ceiling = String(MAX_ALLOWED_MB);
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

// PUT /api/settings/uploads  { maxUploadMb: number }  (admin)
// The site-wide default cap for file uploads. A question may override it.
router.put(
  '/uploads',
  requireRole('admin'),
  ah(async (req, res) => {
    const raw = Number(req.body?.maxUploadMb);
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new HttpError(400, 'Enter a size in MB greater than zero');
    }
    if (raw > MAX_ALLOWED_MB) {
      throw new HttpError(400, `The maximum allowed is ${MAX_ALLOWED_MB} MB`);
    }
    const value = String(Math.floor(raw));
    await q(
      `INSERT INTO settings (skey, svalue) VALUES ('max_upload_mb', ?)
       ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)`,
      [value]
    );
    res.json({ max_upload_mb: value });
  })
);

module.exports = router;
