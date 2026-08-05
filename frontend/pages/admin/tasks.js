import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty,
} from '../../components/UI';

export default function AdminTasks() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [tasks, setTasks] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [feedback, setFeedback] = useState([]);

  const load = async () => setTasks(await api.get(scoped('/api/tasks', bootcampId)));
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const save = async () => {
    if (!form.title?.trim()) { toast.err('Title required'); return; }
    setBusy(true);
    try { await api.post('/api/tasks', { ...form, bootcamp_id: bootcampId }); setCreating(false); setForm({}); await load(); toast.ok('Task created'); }
    catch (e) { toast.err(e.message); }
    setBusy(false);
  };
  const onTaskFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try { const res = await api.upload(file); setForm((f) => ({ ...f, file_url: res.url, file_name: res.name })); toast.ok('File attached'); }
    catch (e) { toast.err(e.message); }
    setUploading(false);
  };
  const remove = async (t) => {
    if (!confirm(`Delete "${t.title}"?`)) return;
    try { await api.del(`/api/tasks/${t.id}`); await load(); toast.show('Deleted'); } catch (e) { toast.err(e.message); }
  };
  const openFeedback = async (t) => {
    setFeedbackFor(t);
    try { setFeedback(await api.get(`/api/tasks/${t.id}/feedback`)); } catch (e) { toast.err(e.message); }
  };

  // --- CSV export of mentor task feedback ---
  const downloadCsv = (filename, rows) => {
    const esc = (c) => { const s = c == null ? '' : String(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const slug = (s) => (s || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
  const HEADER = ['S.No', 'Task', 'Team', 'Mentor', 'Score', 'Feedback'];

  const exportTaskCsv = async (t) => {
    try {
      const rows = await api.get(`/api/tasks/${t.id}/feedback`);
      if (!rows.length) { toast.show('No feedback yet for this task'); return; }
      const body = rows.map((f, i) => [i + 1, t.title, f.team_name, f.mentor_name, f.score == null ? '' : f.score, f.feedback || '']);
      downloadCsv(`task-${slug(t.title)}.csv`, [HEADER, ...body]);
    } catch (e) { toast.err(e.message); }
  };

  const exportAllCsv = async () => {
    try {
      const all = [];
      let n = 0;
      for (const t of tasks) {
        const rows = await api.get(`/api/tasks/${t.id}/feedback`);
        rows.forEach((f) => { n += 1; all.push([n, t.title, f.team_name, f.mentor_name, f.score == null ? '' : f.score, f.feedback || '']); });
      }
      if (!all.length) { toast.show('No feedback recorded yet'); return; }
      downloadCsv('tasks-feedback.csv', [HEADER, ...all]);
    } catch (e) { toast.err(e.message); }
  };

  if (!ok || !bootcampId || !tasks) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Task & Feedback"
        subtitle="Assign tasks to teams; mentors record feedback per team"
        actions={
          <>
            {tasks.length > 0 && <Button onClick={exportAllCsv}>⤓ Export all CSV</Button>}
            <Button variant="primary" onClick={() => { setForm({}); setCreating(true); }}>+ New Task</Button>
          </>
        }
      />

      {tasks.length === 0 ? (
        <Card><Empty icon="✅" title="No tasks yet" /></Card>
      ) : (
        <div className="grid cols-2">
          {tasks.map((t) => (
            <Card key={t.id}>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <h3>{t.title}</h3>
                {t.due_date && <Badge color="orange">Due {String(t.due_date).slice(0, 10)}</Badge>}
              </div>
              {t.description && <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>{t.description}</p>}
              {t.file_url && (
                <div style={{ marginTop: 8 }}>
                  <a href={t.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>📎 {t.file_name || 'Attachment'}</a>
                </div>
              )}
              <div className="hstack" style={{ marginTop: 12 }}>
                <Button size="sm" onClick={() => openFeedback(t)}>View feedback</Button>
                <Button size="sm" onClick={() => exportTaskCsv(t)}>⤓ CSV</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          title="New Task"
          onClose={() => setCreating(false)}
          footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || uploading}>Create</Button></>}
        >
          <Field label="Title"><Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Attachment (optional) — students can download this">
            {form.file_url ? (
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <a href={form.file_url} target="_blank" rel="noreferrer">📎 {form.file_name || 'Attached file'}</a>
                <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, file_url: '', file_name: '' }))}>Remove</Button>
              </div>
            ) : (
              <input type="file" onChange={(e) => onTaskFile(e.target.files?.[0])} />
            )}
            {uploading && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Uploading…</p>}
          </Field>
        </Modal>
      )}

      {feedbackFor && (
        <Modal title={`Feedback · ${feedbackFor.title}`} wide onClose={() => setFeedbackFor(null)}>
          {feedback.length === 0 ? (
            <Empty icon="💬" title="No feedback yet" subtitle="Mentors haven't submitted feedback for this task." />
          ) : (
            <div className="vstack">
              {feedback.map((f) => (
                <div className="row" key={f.id} style={{ borderRadius: 10 }}>
                  <div className="grow">
                    <div className="title">{f.team_name} {f.score != null && <Badge color="green">{f.score}</Badge>}</div>
                    <div className="desc">{f.feedback || <em>No comment</em>}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>— {f.mentor_name}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  );
}
