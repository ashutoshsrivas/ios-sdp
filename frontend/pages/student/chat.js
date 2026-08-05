import { useEffect, useRef, useState, useCallback } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api, wsUrl } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Badge, Button, Input, Empty } from '../../components/UI';

const fmtSize = (n) => {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtTime = (t) => { try { return new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
const MAX_BYTES = 100 * 1024 * 1024;

export default function StudentChat() {
  const { ok } = useRequireRole(['student']);
  const toast = useToast();
  const [team, setTeam] = useState(undefined); // undefined=loading, null=no team
  const [myId, setMyId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [live, setLive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const aliveRef = useRef(true);
  const fileRef = useRef(null);

  const append = useCallback((m) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  // Load team + history
  useEffect(() => {
    if (!ok) return;
    api.get('/api/chat/my-team').then(async (r) => {
      setTeam(r.team);
      setMyId(r.studentId || null);
      if (r.team) {
        const hist = await api.get(`/api/chat/${r.team.id}/messages?limit=50`);
        setMessages(hist);
        setHasMore(hist.length === 50);
      }
    }).catch((e) => { setTeam(null); toast.err(e.message); });
  }, [ok]);

  // Open the WebSocket once we know there's a team
  useEffect(() => {
    if (!team) return;
    aliveRef.current = true;
    let retry;
    const connect = () => {
      const ws = new WebSocket(wsUrl('/api/ws'));
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (aliveRef.current) retry = setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'message') append(data.message);
        } catch { /* ignore malformed frame */ }
      };
    };
    connect();
    return () => {
      aliveRef.current = false;
      clearTimeout(retry);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, [team, append]);

  // Auto-scroll to the newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { toast.err('Reconnecting… try again in a moment'); return; }
    ws.send(JSON.stringify({ type: 'message', body }));
    setText('');
  };

  const onFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.err('File exceeds the 100 MB limit'); return; }
    setUploading(true);
    try {
      await api.chatUpload(team.id, file, text.trim()); // message arrives back over the socket
      setText('');
    } catch (e) { toast.err(e.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const loadEarlier = async () => {
    if (!messages.length) return;
    const oldest = messages[0].id;
    const older = await api.get(`/api/chat/${team.id}/messages?before=${oldest}&limit=50`);
    if (older.length) setMessages((prev) => [...older, ...prev]);
    if (older.length < 50) setHasMore(false);
  };

  const download = (m) => api.downloadFile(`/api/chat/file/${m.id}`, m.file_name || 'file').catch((e) => toast.err(e.message));

  if (!ok || team === undefined) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Team Chat"
        subtitle={team ? `${team.name}${team.table_id ? ` · Table ${team.table_id}` : ''}` : 'Private to your team'}
        actions={<span className={`chat-status ${live ? 'live' : ''}`}>{live ? '● Live' : '○ Connecting…'}</span>}
      />

      {!team ? (
        <Card><Empty icon="💬" title="No team chat yet" subtitle="You'll get a team chat once you're placed on a team." /></Card>
      ) : (
        <Card>
          <div className="chat-wrap">
            <div className="chat-scroll" ref={scrollRef}>
              {hasMore && (
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => loadEarlier().catch((e) => toast.err(e.message))}>Load earlier</Button>
                </div>
              )}
              {messages.length === 0 && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>No messages yet — say hi to your team 👋</p>}
              {messages.map((m) => {
                const mine = m.sender_student_id === myId;
                return (
                  <div key={m.id} className={`chat-row ${mine ? 'mine' : ''}`}>
                    <div className="chat-bubble">
                      {!mine && <div className="chat-sender">{m.sender_name}</div>}
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
                );
              })}
            </div>

            <div className="chat-input">
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach a file (up to 100 MB)">
                {uploading ? '⏳' : '📎'}
              </Button>
              <Input
                style={{ flex: 1 }}
                placeholder="Type a message…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <Button variant="primary" onClick={send}>Send</Button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              Visible only to your team. Files up to 100 MB; attachments are removed after 30 days.
            </p>
          </div>
        </Card>
      )}
    </Layout>
  );
}
