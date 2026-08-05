// WebSocket hub for per-team chat.
// - Students connect with ?token=<jwt>; their room is derived server-side from
//   students.team_id (a student can never request another team's room).
// - Admins connect with ?token=<jwt>&team=<id> to silently monitor: they receive
//   the live feed but are never announced and cannot post.
// There are intentionally NO presence/typing signals, so a watching admin is invisible.
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { q } = require('./db');

// team_id -> Set<ws>. Each ws carries ws.ctx = { role, userId, studentId, teamId }.
const rooms = new Map();

function addToRoom(teamId, ws) {
  if (!rooms.has(teamId)) rooms.set(teamId, new Set());
  rooms.get(teamId).add(ws);
}
function removeFromRoom(teamId, ws) {
  const set = rooms.get(teamId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(teamId);
}

// Send a payload to everyone in a team's room (students + silent admins).
function broadcastToTeam(teamId, payload) {
  const set = rooms.get(Number(teamId));
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function serialize(row) {
  return {
    id: row.id,
    team_id: row.team_id,
    sender_student_id: row.sender_student_id,
    sender_name: row.sender_name,
    body: row.body,
    file_name: row.file_name,
    file_size: row.file_size == null ? null : Number(row.file_size),
    file_expired: !!row.file_expired,
    has_file: !!row.file_name && !row.file_expired,
    created_at: row.created_at,
  };
}

// Persist a message (text and/or file) then broadcast the stored row to the room.
async function persistAndBroadcast(ctx, { body = null, fileName = null, filePath = null, fileSize = null }) {
  const r = await q(
    `INSERT INTO chat_messages (team_id, sender_student_id, body, file_name, file_path, file_size)
     VALUES (?,?,?,?,?,?)`,
    [ctx.teamId, ctx.studentId, body, fileName, filePath, fileSize]
  );
  const row = (await q(
    `SELECT cm.id, cm.team_id, cm.sender_student_id, cm.body, cm.file_name, cm.file_size,
            cm.file_expired, cm.created_at, s.name AS sender_name
     FROM chat_messages cm JOIN students s ON s.id = cm.sender_student_id
     WHERE cm.id = ?`,
    [r.insertId]
  ))[0];
  broadcastToTeam(ctx.teamId, { type: 'message', message: serialize(row) });
  return row;
}

async function resolveContext(token, requestedTeam) {
  let claims;
  try { claims = jwt.verify(token, config.jwtSecret); } catch { return null; }
  if (claims.role === 'admin') {
    const teamId = Number(requestedTeam);
    if (!teamId) return null;
    return { role: 'admin', userId: claims.id, studentId: null, teamId };
  }
  if (claims.role === 'student') {
    const s = (await q('SELECT id, team_id FROM students WHERE user_id = ? LIMIT 1', [claims.id]))[0];
    if (!s || !s.team_id) return null; // no team → no chat
    return { role: 'student', userId: claims.id, studentId: s.id, teamId: s.team_id };
  }
  return null;
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/api/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url));
  });

  wss.on('connection', async (ws, url) => {
    const ctx = await resolveContext(url.searchParams.get('token'), url.searchParams.get('team'));
    if (!ctx) { ws.close(4001, 'unauthorized'); return; }
    ws.ctx = ctx;
    addToRoom(ctx.teamId, ws);
    ws.send(JSON.stringify({ type: 'ready', teamId: ctx.teamId, role: ctx.role }));

    ws.on('message', async (raw) => {
      if (ws.ctx.role !== 'student') return; // admins are passive observers
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'message') {
        const body = (msg.body || '').toString().trim().slice(0, 4000);
        if (!body) return;
        try { await persistAndBroadcast(ws.ctx, { body }); }
        catch { /* drop a failed insert rather than kill the socket */ }
      }
    });
    ws.on('close', () => removeFromRoom(ws.ctx.teamId, ws));
    ws.on('error', () => removeFromRoom(ws.ctx.teamId, ws));
  });
}

module.exports = { attach, broadcastToTeam, persistAndBroadcast, serialize };
