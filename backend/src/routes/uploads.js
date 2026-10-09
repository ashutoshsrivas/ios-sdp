const express = require('express');
const { authRequired } = require('../middleware/auth');
const { uploadBuffer } = require('../s3');
const { ah, HttpError } = require('../util');
const { singleFileWithLimit, globalMaxUploadMb, maxUploadMbFor } = require('../uploadLimit');

const router = express.Router();

// GET /api/uploads/limit[?question=<id>] — the cap that applies to this upload,
// so the client can reject an oversized file before sending it and can show
// the limit in the UI.
router.get(
  '/limit',
  authRequired,
  ah(async (req, res) => {
    const maxUploadMb = await maxUploadMbFor(req.query.question);
    res.json({ maxUploadMb, defaultMaxUploadMb: await globalMaxUploadMb() });
  })
);

// POST /api/uploads[?question=<id>]  (any authenticated user) — field "file".
// The size cap is the question's own override when given, else the global
// setting; it is resolved per request before the body is parsed.
router.post(
  '/',
  authRequired,
  singleFileWithLimit('file', { questionFrom: (req) => req.query.question }),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file provided (field name must be "file")');
    const subfolder = req.user.role === 'student' ? `answers` : 'misc';
    const { key, url } = await uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      subfolder
    );
    res.json({ url, key, name: req.file.originalname, maxUploadMb: req.maxUploadMb });
  })
);

module.exports = router;
