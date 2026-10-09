import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Select, Empty, Switch,
} from '../../components/UI';

const INPUT_TYPES = ['text', 'textarea', 'number', 'file', 'date', 'url'];
const blankItem = () => ({ title: '', description: '', input_type: 'text' });

// A CSV cell that opens the uploaded file when clicked (Excel, Sheets, Numbers all
// understand HYPERLINK). Quotes are swapped out so the formula can't be broken by a
// filename; esc() wraps and escapes the finished cell. Plain file-URL columns are kept
// alongside so the raw link survives tools that ignore formulas.
const fileLink = (url, label) =>
  !url
    ? label || ''
    : `=HYPERLINK("${String(url).replace(/"/g, '%22')}","${String(label || 'file').replace(/"/g, "'")}")`;
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
  const [shared, setShared] = useState({ audience: 'all_students', required: true, allow_resubmission: true }); // applies to all questions
  const [targets, setTargets] = useState([]); // ids
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);      // one question being edited
  const [editForm, setEditForm] = useState({});
  const [groupEditing, setGroupEditing] = useState(null); // a submission's shared settings
  const [groupForm, setGroupForm] = useState({});
  const [answersFor, setAnswersFor] = useState(null);
  const [answers, setAnswers] = useState([]);
  // Site-wide upload defaults, shown as the placeholder on the per-question cap.
  const [settings, setSettings] = useState({});
  const defaultMaxMb = Number(settings.max_upload_mb) || 100;
  const uploadCeiling = Number(settings.max_upload_mb_ceiling) || 200;

  const load = async () => {
    const [q, s, t, cfg] = await Promise.all([
      api.get(scoped('/api/questions', bootcampId)),
      api.get(scoped('/api/students?status=approved', bootcampId)),
      api.get(scoped('/api/teams', bootcampId)),
      api.get('/api/settings').catch(() => ({})),
    ]);
    setQuestions(q); setStudents(s); setTeams(t); setSettings(cfg || {});
  };
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const openNew = () => { setItems([blankItem()]); setShared({ audience: 'all_students', required: true, allow_resubmission: true }); setTargets([]); setCreating(true); };
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
          allow_resubmission: shared.allow_resubmission,
          targets: sharedTargets, batch_id: batchId,
          // Only meaningful for a file question; blank means the global default.
          max_upload_mb: it.input_type === 'file' ? (it.max_upload_mb || null) : null,
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
        const answer = a.file_url ? fileLink(a.file_url, a.file_name)
          : a.value_number != null ? a.value_number
          : (a.value_text || '');
        return [i + 1, a.student_name, a.student_email, a.team_name || '', answer,
          fileLink(a.file_url, a.file_name), a.file_url || '', a.updated_at || a.created_at || ''];
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
      const display = (a) => (!a ? '' : a.file_url ? fileLink(a.file_url, a.file_name) : a.value_number != null ? a.value_number : (a.value_text || ''));
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
      // A file question also gets a plain-text URL column next to its clickable cell.
      const header = ['S.No', 'Student', 'Email', 'Team',
        ...group.flatMap((g) => (g.input_type === 'file' ? [g.title, `${g.title} (file URL)`] : [g.title]))];
      const body = list.map((st, i) => [i + 1, st.name, st.email, st.team,
        ...group.flatMap((g, qi) => {
          const a = maps[qi].get(st.id);
          return g.input_type === 'file' ? [display(a), a?.file_url || ''] : [display(a)];
        })]);
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

  const openEdit = (qq) => {
    setEditForm({
      title: qq.title || '',
      description: qq.description || '',
      input_type: qq.input_type,
      audience: qq.audience,
      required: !!qq.required,
      allow_resubmission: !!qq.allow_resubmission,
      max_upload_mb: qq.max_upload_mb ?? '',
    });
    setEditing(qq);
  };

  const saveEdit = async () => {
    if (!editForm.title.trim()) { toast.err('Title is required'); return; }
    setBusy(true);
    try {
      await api.put(`/api/questions/${editing.id}`, editForm);
      setEditing(null);
      await load();
      toast.ok('Question updated');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const openGroupEdit = (group) => {
    const first = group[0];
    setGroupForm({
      audience: first.audience,
      required: !!first.required,
      allow_resubmission: !!first.allow_resubmission,
    });
    setGroupEditing(group);
  };

  const saveGroupEdit = async () => {
    setBusy(true);
    try {
      // Shared settings live on every question in the batch.
      await api.put(`/api/questions/batch/${groupEditing[0].batch_id}`, groupForm);
      setGroupEditing(null);
      await load();
      toast.ok('Submission settings updated');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

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
          {q.required ? <Badge color="orange">required</Badge> : null}{' '}
          {q.input_type === 'file' && (
            <Badge color="gray">
              max {q.max_upload_mb || defaultMaxMb} MB{q.max_upload_mb ? '' : ' (default)'}
            </Badge>
          )}{' '}
          {q.allow_resubmission
            ? <Badge color="green">resubmission allowed</Badge>
            : <Badge color="red">answers final</Badge>}
        </div>
      </div>
      <Button size="sm" onClick={() => openAnswers(q)}>{q.answer_count} answer{q.answer_count === 1 ? '' : 's'}</Button>
      {showCsv && <Button size="sm" onClick={() => exportCsv(q)} disabled={!q.answer_count}>⤓ CSV</Button>}
      {q.input_type === 'file' && (
        <Button size="sm" onClick={() => downloadZip(q)} disabled={!q.answer_count}>⤓ Files</Button>
      )}
      <Button size="sm" onClick={() => openEdit(q)}>Edit</Button>
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
                <span className="hstack">
                  <Button size="sm" onClick={() => openGroupEdit(group)}>Settings</Button>
                  <Button size="sm" onClick={() => exportGroupCsv(group)} disabled={!group.some((g) => g.answer_count)}>⤓ CSV (all)</Button>
                </span>
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
              {it.input_type === 'file' && (
                <Field label="Max upload size (MB)">
                  <Input
                    type="number"
                    min="1"
                    max={uploadCeiling}
                    placeholder={`Default: ${defaultMaxMb} MB`}
                    value={it.max_upload_mb || ''}
                    onChange={(e) => setItem(i, { max_upload_mb: e.target.value })}
                  />
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Leave blank to use the site default ({defaultMaxMb} MB). Maximum {uploadCeiling} MB.
                    Students see this limit and are stopped before uploading a larger file.
                  </div>
                </Field>
              )}
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
              <label className="check" style={{ display: 'block', marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={!!shared.allow_resubmission}
                  onChange={(e) => setShared({ ...shared, allow_resubmission: e.target.checked })}
                /> Allow resubmission
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginLeft: 22 }}>
                  Students can change their answer; a new file replaces the old one.
                  Turn off to make the first submission final.
                </span>
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

      {editing && (
        <Modal
          title="Edit question"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <Field label="Question / title">
            <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </Field>
          <Field label="Description (optional)">
            <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </Field>
          <Field label="Answer type">
            <Select
              value={editForm.input_type}
              disabled={!!editing.answer_count}
              onChange={(e) => setEditForm({ ...editForm, input_type: e.target.value })}
            >
              {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            {!!editing.answer_count && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                {editing.answer_count} answer{editing.answer_count === 1 ? ' has' : 's have'} been submitted,
                so the answer type is locked — changing it would strand what students already sent.
              </div>
            )}
          </Field>
          <Field label="Audience">
            <Select value={editForm.audience} onChange={(e) => setEditForm({ ...editForm, audience: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </Field>
          {editForm.input_type === 'file' && (
            <Field label="Max upload size (MB)">
              <Input
                type="number"
                min="1"
                max={uploadCeiling}
                placeholder={`Default: ${defaultMaxMb} MB`}
                value={editForm.max_upload_mb}
                onChange={(e) => setEditForm({ ...editForm, max_upload_mb: e.target.value })}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Blank uses the site default ({defaultMaxMb} MB). Maximum {uploadCeiling} MB.
              </div>
            </Field>
          )}
          <Switch
            checked={!!editForm.required}
            onChange={(v) => setEditForm({ ...editForm, required: v })}
            label="Required"
          />
          <Switch
            checked={!!editForm.allow_resubmission}
            onChange={(v) => setEditForm({ ...editForm, allow_resubmission: v })}
            label="Allow resubmission — students can change their answer, and a new file replaces the old one"
          />
          {!editForm.allow_resubmission && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              With this off, a student&apos;s first submission is final and they cannot edit it.
            </div>
          )}
        </Modal>
      )}

      {groupEditing && (
        <Modal
          title={`Submission settings · ${groupEditing.length} questions`}
          onClose={() => setGroupEditing(null)}
          footer={
            <>
              <Button onClick={() => setGroupEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveGroupEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Apply to all'}
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
            These apply to every question in this submission. Edit a single question
            to change just its title, type or upload limit.
          </p>
          <Field label="Audience">
            <Select value={groupForm.audience} onChange={(e) => setGroupForm({ ...groupForm, audience: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </Field>
          <Switch
            checked={!!groupForm.required}
            onChange={(v) => setGroupForm({ ...groupForm, required: v })}
            label="Required"
          />
          <Switch
            checked={!!groupForm.allow_resubmission}
            onChange={(v) => setGroupForm({ ...groupForm, allow_resubmission: v })}
            label="Allow resubmission for every question here"
          />
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
