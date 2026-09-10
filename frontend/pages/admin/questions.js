import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Select, Empty,
} from '../../components/UI';

const INPUT_TYPES = ['text', 'textarea', 'number', 'file', 'date', 'url'];
const blankItem = () => ({ title: '', description: '', input_type: 'text' });
const AUDIENCES = [
  { value: 'all_students', label: 'All students' },
  { value: 'selected_students', label: 'Selected students' },
  { value: 'teams', label: 'Specific teams' },
  { value: 'team_spoc', label: 'Team SPOCs' },
];
const AUD_LABEL = Object.fromEntries(AUDIENCES.map((a) => [a.value, a.label]));

export default function AdminQuestions() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [questions, setQuestions] = useState(null);
  const [students, setStudents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState([blankItem()]); // one or more questions in this submission
  const [shared, setShared] = useState({ audience: 'all_students', required: true }); // applies to all questions
  const [targets, setTargets] = useState([]); // ids
  const [busy, setBusy] = useState(false);
  const [answersFor, setAnswersFor] = useState(null);
  const [answers, setAnswers] = useState([]);

  const load = async () => {
    const [q, s, t] = await Promise.all([
      api.get(scoped('/api/questions', bootcampId)),
      api.get(scoped('/api/students?status=approved', bootcampId)),
      api.get(scoped('/api/teams', bootcampId)),
    ]);
    setQuestions(q); setStudents(s); setTeams(t);
  };
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const openNew = () => { setItems([blankItem()]); setShared({ audience: 'all_students', required: true }); setTargets([]); setCreating(true); };
  const needsStudents = shared.audience === 'selected_students';
  const needsTeams = shared.audience === 'teams' || shared.audience === 'team_spoc';
  const toggleTarget = (id) => setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const addItem = () => setItems((xs) => [...xs, blankItem()]);
  const removeItem = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, idx) => idx !== i) : xs));
  const setItem = (i, patch) => setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const save = async () => {
    const cleaned = items.map((it) => ({ ...it, title: (it.title || '').trim() }));
    if (cleaned.some((it) => !it.title)) { toast.err('Every question needs a title'); return; }
    const refType = needsStudents ? 'student' : 'team';
    const sharedTargets = (needsStudents || needsTeams) ? targets.map((id) => ({ ref_type: refType, ref_id: id })) : [];
    // Tag questions published together so they can be grouped + exported as one CSV.
    const batchId = cleaned.length > 1
      ? ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `b_${Date.now()}_${Math.random().toString(16).slice(2)}`)
      : null;
    setBusy(true);
    try {
      // Each question is published independently, all sharing this submission's audience + batch.
      for (const it of cleaned) {
        await api.post('/api/questions', {
          title: it.title, description: it.description, input_type: it.input_type,
          audience: shared.audience, required: shared.required, bootcamp_id: bootcampId,
          targets: sharedTargets, batch_id: batchId,
        });
      }
      setCreating(false);
      await load();
      toast.ok(cleaned.length === 1 ? 'Question published' : `${cleaned.length} questions published`);
    } catch (e) { toast.err(e.message); await load(); }
    setBusy(false);
  };

  const remove = async (q) => {
    if (!confirm(`Delete "${q.title}"? Answers will be lost.`)) return;
    try { await api.del(`/api/questions/${q.id}`); await load(); toast.show('Deleted'); } catch (e) { toast.err(e.message); }
  };
  const openAnswers = async (q) => {
    setAnswersFor(q);
    try { setAnswers(await api.get(`/api/questions/${q.id}/answers`)); } catch (e) { toast.err(e.message); }
  };

  const exportCsv = async (question) => {
    try {
      const rows = await api.get(`/api/questions/${question.id}/answers`);
      const esc = (c) => {
        const s = c == null ? '' : String(c);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['S.No', 'Student', 'Email', 'Team', 'Answer', 'File Name', 'File URL', 'Submitted At'];
      const body = rows.map((a, i) => {
        const answer = a.file_url ? (a.file_name || 'file')
          : a.value_number != null ? a.value_number
          : (a.value_text || '');
        return [i + 1, a.student_name, a.student_email, a.team_name || '', answer, a.file_name || '', a.file_url || '', a.updated_at || a.created_at || ''];
      });
      const csv = '﻿' + [header, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
      const slug = question.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'submission';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = `submission-${slug}.csv`;
      document.body.appendChild(el); el.click(); el.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.err(e.message); }
  };

  const downloadZip = async (question) => {
    const slug = question.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'submission';
    try {
      await api.downloadFile(`/api/questions/${question.id}/answers.zip`, `submission-${slug}-files.zip`);
    } catch (e) { toast.err(e.message); }
  };

  // One combined CSV for a group of questions created together: a column per question,
  // a row per student who answered at least one of them.
  const exportGroupCsv = async (group) => {
    try {
      const esc = (c) => { const s = c == null ? '' : String(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const display = (a) => (!a ? '' : a.file_url ? (a.file_name || 'file') : a.value_number != null ? a.value_number : (a.value_text || ''));
      const perQ = await Promise.all(group.map((g) => api.get(`/api/questions/${g.id}/answers`)));
      const students = new Map(); // student_id -> {name,email,team}
      const maps = perQ.map((rows) => {
        const m = new Map();
        rows.forEach((a) => {
          m.set(a.student_id, a);
          if (!students.has(a.student_id)) students.set(a.student_id, { name: a.student_name, email: a.student_email, team: a.team_name || '' });
        });
        return m;
      });
      const list = [...students.entries()].map(([id, info]) => ({ id, ...info }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const header = ['S.No', 'Student', 'Email', 'Team', ...group.map((g) => g.title)];
      const body = list.map((st, i) => [i + 1, st.name, st.email, st.team, ...group.map((g, qi) => display(maps[qi].get(st.id)))]);
      const csv = '﻿' + [header, ...body].map((r) => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = `submission-${group.length}-questions.csv`;
      document.body.appendChild(el); el.click(); el.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.err(e.message); }
  };

  if (!ok || !bootcampId || !questions) return <Layout><Loading /></Layout>;

  // Group questions published together (shared batch_id); ungrouped questions stand alone.
  const groups = [];
  const groupIndex = new Map();
  for (const qq of questions) {
    const key = qq.batch_id || `single-${qq.id}`;
    if (!groupIndex.has(key)) { groupIndex.set(key, groups.length); groups.push([]); }
    groups[groupIndex.get(key)].push(qq);
  }

  const questionRow = (q, showCsv) => (
    <div className="row" key={q.id}>
      <div className="grow">
        <div className="title">{q.title}</div>
        {q.description && (
          <div style={{ color: 'var(--muted)', fontSize: 13.5, margin: '3px 0 6px', whiteSpace: 'pre-wrap' }}>{q.description}</div>
        )}
        <div className="desc">
          <Badge color="blue">{q.input_type}</Badge>{' '}
          <Badge color="purple">{AUD_LABEL[q.audience]}</Badge>{' '}
          {q.required ? <Badge color="orange">required</Badge> : null}
        </div>
      </div>
      <Button size="sm" onClick={() => openAnswers(q)}>{q.answer_count} answer{q.answer_count === 1 ? '' : 's'}</Button>
      {showCsv && <Button size="sm" onClick={() => exportCsv(q)} disabled={!q.answer_count}>⤓ CSV</Button>}
      {q.input_type === 'file' && (
        <Button size="sm" onClick={() => downloadZip(q)} disabled={!q.answer_count}>⤓ Files</Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => remove(q)}>Delete</Button>
    </div>
  );

  return (
    <Layout>
      <PageHead
        title="Submissions"
        subtitle="Collect responses from students — choose the input type and who answers"
        actions={<Button variant="primary" onClick={openNew}>+ New Submission</Button>}
      />

      {questions.length === 0 ? (
        <Card><Empty icon="❓" title="No questions yet" /></Card>
      ) : (
        <div className="vstack">
          {groups.map((group) => group.length === 1 ? (
            <div className="list" key={group[0].id}>{questionRow(group[0], true)}</div>
          ) : (
            <Card key={group[0].batch_id} style={{ padding: 12 }}>
              <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Submission · {group.length} questions
                </span>
                <Button size="sm" onClick={() => exportGroupCsv(group)} disabled={!group.some((g) => g.answer_count)}>⤓ CSV (all)</Button>
              </div>
              <div className="list">{group.map((g) => questionRow(g, false))}</div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          title="New Submission"
          wide
          onClose={() => setCreating(false)}
          footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>Publish</Button></>}
        >
          {items.map((it, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Question {i + 1}</span>
                {items.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => removeItem(i)}>✕ Remove</Button>
                )}
              </div>
              <Field label="Question / title"><Input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} /></Field>
              <Field label="Description (optional)"><Textarea value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></Field>
              <Field label="Answer type">
                <Select value={it.input_type} onChange={(e) => setItem(i, { input_type: e.target.value })}>
                  {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            </div>
          ))}
          <Button onClick={addItem} style={{ marginBottom: 14 }}>+ Add question</Button>

          <div className="divider" />
          <div className="row-fields">
            <Field label="Audience (applies to all questions above)">
              <Select value={shared.audience} onChange={(e) => { setShared({ ...shared, audience: e.target.value }); setTargets([]); }}>
                {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label="Options">
              <label className="hstack" style={{ fontSize: 14, cursor: 'pointer', alignItems: 'center', height: 38 }}>
                <input type="checkbox" checked={!!shared.required} onChange={(e) => setShared({ ...shared, required: e.target.checked })} /> Required
              </label>
            </Field>
          </div>

          {needsStudents && (
            <Field label={`Select students (${targets.length})`}>
              <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {students.map((s) => (
                  <label key={s.id} className="row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={targets.includes(s.id)} onChange={() => toggleTarget(s.id)} />
                    <span className="grow">{s.name} <span style={{ color: 'var(--muted)' }}>· {s.email}</span></span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {needsTeams && (
            <Field label={`Select teams (${targets.length})${shared.audience === 'team_spoc' ? ' — leave empty for all SPOCs' : ''}`}>
              <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {teams.map((t) => (
                  <label key={t.id} className="row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={targets.includes(t.id)} onChange={() => toggleTarget(t.id)} />
                    <span className="grow">{t.name} <span style={{ color: 'var(--muted)' }}>· {t.members.length} members</span></span>
                  </label>
                ))}
              </div>
            </Field>
          )}
        </Modal>
      )}

      {answersFor && (
        <Modal title={`Answers · ${answersFor.title}`} wide onClose={() => setAnswersFor(null)}>
          {answers.length === 0 ? (
            <Empty icon="📭" title="No responses yet" />
          ) : (
            <div className="vstack">
              {answers.map((a) => (
                <div className="row" key={a.id} style={{ borderRadius: 10 }}>
                  <div className="grow">
                    <div className="title">{a.student_name} {a.team_name && <Badge color="purple">{a.team_name}</Badge>}</div>
                    <div className="desc" style={{ whiteSpace: 'pre-wrap' }}>
                      {a.file_url ? <a href={a.file_url} target="_blank" rel="noreferrer">📎 {a.file_name || 'Download file'}</a>
                        : a.value_number != null ? a.value_number
                        : (a.value_text || <em>—</em>)}
                    </div>
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
