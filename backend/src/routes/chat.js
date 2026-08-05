const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { q } = require('../db');
const { authRequired } = require('../middleware/auth');
const { ah, HttpError } = require('../util');
const { persistAndBroadcast, serialize } = require('../chatHub');

// Chat files live on local disk (NOT S3): keeps them team-private (served through an
// auth check) and lets us actually delete them after 30 days. Overridable via env.
const CHAT_DIR = process.env.CHAT_UPLOAD_DIR || path.join(__dirname, '..', '..', 'chat-uploads');
fs.mkdirSync(CHAT_DIR, { recursive: true });

const router = express.Router();
router.use(authRequired);

async function myStudent(userId) {
  return (await q('SELECT id, team_id FROM students WHERE user_id = ? LIMIT 1', [userId]))[0] || null;
}

// Students may only touch their own team's chat; admins may read any.
async function accessTo(user, teamId) {
  if (user.role === 'admin') return { role: 'admin', teamId };
  if (user.role === 'student') {
    const s = await myStudent(user.id);
    if (s && s.team_id === Number(teamId)) return { role: 'student', studentId: s.id, teamId: s.team_id };
  }
  return null;
}

// GET /api/chat/my-team — the calling student's team (for the chat page header)
router.get('/my-team', ah(async (req, res) => {
  if (req.user.role !== 'student') throw new HttpError(403, 'Students only');
  const s = await myStudent(req.user.id);
  if (!s || !s.team_id) return res.json({ team: null });
  const team = (await q('SELECT id, name, table_id FROM teams WHERE id = ?', [s.team_id]))[0] || null;
  res.json({ team, studentId: s.id });
}));

// GET /api/chat/file/:messageId — authenticated download (team members + admin only)
router.get('/file/:messageId', ah(async (req, res) => {
  const m = (await q('SELECT * FROM chat_messages WHERE id = ?', [Number(req.params.messageId)]))[0];
  if (!m || !m.file_path) throw new HttpError(404, 'File not found');
  if (m.file_expired) throw new HttpError(410, 'This file has expired — chat files are removed after 30 days');
  if (!(await accessTo(req.user, m.team_id))) throw new HttpError(403, 'You do not have access to this file');
  const abs = path.join(CHAT_DIR, path.basename(m.file_path));
  if (!fs.existsSync(abs)) throw new HttpError(404, 'File no longer available');
  res.setHeader('Content-Disposition', `attachment; filename="${(m.file_name || 'file').replace(/[^\w.\- ]/g, '_')}"`);
  fs.createReadStream(abs).pipe(res);
}));

// GET /api/chat/:teamId/messages?before=<id>&limit= — chat history (ascending)
router.get('/:teamId/messages', ah(async (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!(await accessTo(req.user, teamId))) throw new HttpError(403, 'You do not have access to this chat');
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = Number(req.query.before) || 0;
  const params = [teamId];
  let where = 'cm.team_id = ?';
  if (before) { where += ' AND cm.id < ?'; params.push(before); }
  params.push(limit);
  const rows = await q(
    `SELECT cm.id, cm.team_id, cm.sender_student_id, cm.body, cm.file_name, cm.file_size,
            cm.file_expired, cm.created_at, s.name AS sender_name
     FROM chat_messages cm JOIN students s ON s.id = cm.sender_student_id
     WHERE ${where} ORDER BY cm.id DESC LIMIT ?`,
    params
  );
  res.json(rows.reverse().map(serialize));
}));

// POST /api/chat/:teamId/upload — a student posts a file (<=100MB) + optional caption
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CHAT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12).replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/:teamId/upload', upload.single('file'), ah(async (req, res) => {
  const teamId = Number(req.params.teamId);
  const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  if (req.user.role !== 'student') { cleanup(); throw new HttpError(403, 'Only students can post to chat'); }
  const s = await myStudent(req.user.id);
  if (!s || s.team_id !== teamId) { cleanup(); throw new HttpError(403, 'This is not your team'); }
  if (!req.file) throw new HttpError(400, 'No file provided (field name must be "file")');
  const caption = (req.body?.caption || '').toString().trim().slice(0, 4000) || null;
  const row = await persistAndBroadcast(
    { teamId, studentId: s.id },
    { body: caption, fileName: req.file.originalname, filePath: path.basename(req.file.path), fileSize: req.file.size }
  );
  res.json(serialize(row));
}));

module.exports = router;
module.exports.CHAT_DIR = CHAT_DIR;
