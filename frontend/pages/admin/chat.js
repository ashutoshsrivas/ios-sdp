import { useEffect, useRef, useState, useCallback } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api, wsUrl } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Badge, Button, Select, Empty } from '../../components/UI';

const fmtSize = (n) => {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtTime = (t) => { try { return new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

export default function AdminChatMonitor() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [teams, setTeams] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [messages, setMessages] = useState([]);
  const [live, setLive] = useState(false);

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const aliveRef = useRef(true);

  const append = useCallback((m) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  useEffect(() => {
    if (!ok || !bootcampId) return;
    api.get(scoped('/api/teams', bootcampId)).then((t) => { setTeams(t); setTeamId(''); setMessages([]); }).catch((e) => toast.err(e.message));
  }, [ok, bootcampId]);

  // History + live socket for the selected team
  useEffect(() => {
    if (!teamId) { setMessages([]); return; }
    let retry;
    aliveRef.current = true;
    setMessages([]);
    api.get(`/api/chat/${teamId}/messages?limit=80`).then(setMessages).catch((e) => toast.err(e.message));
    const connect = () => {
      const ws = new WebSocket(wsUrl('/api/ws', `&team=${teamId}`));
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => { setLive(false); if (aliveRef.current) retry = setTimeout(connect, 3000); };
      ws.onmessage = (ev) => {
        try { const d = JSON.parse(ev.data); if (d.type === 'message') append(d.message); } catch { /* ignore */ }
      };
    };
    connect();
    return () => { aliveRef.current = false; clearTimeout(retry); try { wsRef.current?.close(); } catch { /* noop */ } };
  }, [teamId, append]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  const download = (m) => api.downloadFile(`/api/chat/file/${m.id}`, m.file_name || 'file').catch((e) => toast.err(e.message));

  if (!ok || !bootcampId || !teams) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Chat Monitor"
        subtitle="View any team's chat in real time"
        actions={teamId ? <span className={`chat-status ${live ? 'live' : ''}`}>{live ? '● Live' : '○ Connecting…'}</span> : null}
      />

      <Card style={{ marginBottom: 12 }}>
        <div className="hstack" style={{ gap: 10, alignItems: 'center' }}>
          <span className="kicker">Team</span>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">— select a team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.table_id ? ` · ${t.table_id}` : ''} ({t.members.length})</option>)}
          </Select>
          <Badge color="orange">Silent — members are not notified</Badge>
        </div>
      </Card>

      {!teamId ? (
        <Card><Empty icon="🕵️" title="Pick a team" subtitle="Select a team above to monitor its chat. Your viewing is invisible to members." /></Card>
      ) : (
        <Card>
          <div className="chat-wrap">
            <div className="chat-scroll" ref={scrollRef}>
              {messages.length === 0 && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>No messages in this team yet.</p>}
              {messages.map((m) => (
                <div key={m.id} className="chat-row">
                  <div className="chat-bubble">
                    <div className="chat-sender">{m.sender_name}</div>
                    {m.body && <div className="chat-body">{m.body}</div>}
                    {m.file_name && (
                      m.file_expired ? (
                        <div className="chat-file" style={{ color: 'var(--muted)' }}>📎 {m.file_name} <em>(expired)</em></div>
                      ) : (
                        <button type="button" className="chat-file" onClick={() => download(m)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-text)' }}>
                          📎 {m.file_name} <span style={{ color: 'var(--muted)' }}>{fmtSize(m.file_size)}</span>
                        </button>
                      )
                    )}
                    <div className="chat-time">{fmtTime(m.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Read-only. Admins cannot post to team chats — you are observing only.
            </p>
          </div>
        </Card>
      )}
    </Layout>
  );
}
