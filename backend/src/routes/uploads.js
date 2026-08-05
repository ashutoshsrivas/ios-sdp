const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { uploadBuffer } = require('../s3');
const { ah, HttpError } = require('../util');

const router = express.Router();

// Keep files in memory (max 25MB) then stream to S3.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/uploads  (any authenticated user) — multipart field "file"
router.post(
  '/',
  authRequired,
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file provided (field name must be "file")');
    const subfolder = req.user.role === 'student' ? `answers` : 'misc';
    const { key, url } = await uploadBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      subfolder
    );
    res.json({ url, key, name: req.file.originalname });
  })
);

module.exports = router;
