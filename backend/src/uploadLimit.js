const multer = require('multer');
const { q } = require('./db');
const { HttpError } = require('./util');

// Used when no admin setting exists yet. Matches the previous hardcoded cap,
// so behaviour is unchanged until someone edits the setting.
const DEFAULT_MAX_UPLOAD_MB = 25;

// Hard ceiling an admin can set, to stop a typo ("2000") from letting a
// multi-GB file into memory and OOM-killing the box (1.8 GB RAM, no swap).
const MAX_ALLOWED_MB = 200;

function clampMb(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_ALLOWED_MB);
}

/** The site-wide default, from the settings table. */
async function globalMaxUploadMb() {
  const rows = await q(`SELECT svalue FROM settings WHERE skey = 'max_upload_mb'`);
  return clampMb(rows[0]?.svalue, DEFAULT_MAX_UPLOAD_MB);
}

/**
 * The cap that applies to a given upload: a question's own override when it
 * has one, otherwise the global default.
 */
async function maxUploadMbFor(questionId) {
  const fallback = await globalMaxUploadMb();
  if (!questionId) return fallback;

  const rows = await q(`SELECT max_upload_mb FROM questions WHERE id = ?`, [Number(questionId)]);
  if (!rows[0] || rows[0].max_upload_mb == null) return fallback;
  return clampMb(rows[0].max_upload_mb, fallback);
}

/**
 * Express middleware that resolves the applicable cap *before* parsing the
 * body, then runs multer with that limit.
 *
 * multer fixes `limits.fileSize` when the instance is built, so a single
 * shared instance can't honour a per-question cap — the instance is created
 * per request instead. `req.maxUploadMb` is left behind for handlers.
 *
 * Rejects on Content-Length first where possible, so an oversized upload is
 * refused before its bytes are streamed into memory.
 */
function singleFileWithLimit(field = 'file', { questionFrom } = {}) {
  return async function (req, res, next) {
    try {
      const questionId = typeof questionFrom === 'function' ? questionFrom(req) : null;
      const mb = await maxUploadMbFor(questionId);
      const bytes = mb * 1024 * 1024;
      req.maxUploadMb = mb;

      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > bytes + 1024 * 1024) {
        // +1MB slack for multipart boundaries and the other form fields.
        return next(new HttpError(413, `That file is too large. The limit is ${mb} MB.`));
      }

      const handler = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: bytes, files: 1 },
      }).single(field);

      handler(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          // Without this the error reaches the handler with no .status and is
          // reported to the user as a generic 500 "Server error".
          return next(new HttpError(413, `That file is too large. The limit is ${mb} MB.`));
        }
        if (err instanceof multer.MulterError) {
          return next(new HttpError(400, `Upload failed: ${err.message}`));
        }
        return next(err);
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  DEFAULT_MAX_UPLOAD_MB,
  MAX_ALLOWED_MB,
  clampMb,
  globalMaxUploadMb,
  maxUploadMbFor,
  singleFileWithLimit,
};
