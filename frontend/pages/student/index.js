import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge, Input, Textarea, Empty, ProgressBar } from '../../components/UI';

// One decimal place is enough to make "this file is too big" concrete.
function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function StudentHome() {
  const { ok } = useRequireRole(['student']);
  const toast = useToast();
  const [questions, setQuestions] = useState(null);
  const [values, setValues] = useState({}); // qid -> {value, file}
  const [busy, setBusy] = useState({});
  const [progress, setProgress] = useState({}); // qid -> {percent, name}

  const load = async () => {
    const qs = await api.get('/api/questions/mine');
    setQuestions(qs);
    const v = {};
    qs.forEach((q) => {
      const a = q.answer;
      v[q.id] = {
        value: q.input_type === 'number' ? (a?.value_number ?? '') : (a?.value_text ?? ''),
        fileUrl: a?.file_url || '', fileName: a?.file_name || '',
      };
    });
    setValues(v);
  };
  useEffect(() => { if (ok) load().catch((e) => toast.err(e.message)); }, [ok]);

  // Answered already, and the admin has turned resubmission off.
  const locked = (q) => !q.allow_resubmission && !!q.answer;

  const setVal = (qid, patch) => setValues((s) => ({ ...s, [qid]: { ...s[qid], ...patch } }));

  const onFile = async (qid, file) => {
    if (!file) return;

    // Check the size before sending: uploading a 60 MB file only to be told it
    // was rejected wastes the student's bandwidth, and on a phone that hurts.
    const question = (questions || []).find((x) => x.id === qid);
    const limitMb = question?.effective_max_upload_mb;
    if (limitMb && file.size > limitMb * 1024 * 1024) {
      toast.err(
        `"${file.name}" is ${formatMb(file.size)} MB. The limit for this question is ${limitMb} MB.`
      );
      return;
    }

    setBusy((b) => ({ ...b, [qid]: true }));
    setProgress((p) => ({ ...p, [qid]: { percent: 0, name: file.name } }));
    try {
      const res = await api.uploadWithProgress(file, qid, (percent) =>
        setProgress((p) => ({ ...p, [qid]: { percent, name: file.name } }))
      );
      setVal(qid, { fileUrl: res.url, fileName: res.name });
      toast.ok('File uploaded — remember to Save');
    } catch (e) { toast.err(e.message); }
    setProgress((p) => { const n = { ...p }; delete n[qid]; return n; });
    setBusy((b) => ({ ...b, [qid]: false }));
  };

  const save = async (q) => {
    const v = values[q.id] || {};
    const body = {};
    if (q.input_type === 'number') body.value_number = v.value;
    else if (q.input_type === 'file') { body.file_url = v.fileUrl; body.file_name = v.fileName; }
    else body.value_text = v.value;
    setBusy((b) => ({ ...b, [q.id]: true }));
    try { await api.post(`/api/questions/${q.id}/answer`, body); await load(); toast.ok('Answer saved'); }
    catch (e) { toast.err(e.message); }
    setBusy((b) => ({ ...b, [q.id]: false }));
  };

  if (!ok || !questions) return <Layout><Loading /></Layout>;

  const renderInput = (q) => {
    const v = values[q.id] || {};
    const isLocked = locked(q);
    switch (q.input_type) {
      case 'textarea':
        return <Textarea disabled={isLocked} value={v.value} onChange={(e) => setVal(q.id, { value: e.target.value })} />;
      case 'number':
        return <Input type="number" value={v.value} onChange={(e) => setVal(q.id, { value: e.target.value })} />;
      case 'date':
        return <Input type="date" value={v.value} onChange={(e) => setVal(q.id, { value: e.target.value })} />;
      case 'url':
        return <Input type="url" disabled={isLocked} placeholder="https://…" value={v.value} onChange={(e) => setVal(q.id, { value: e.target.value })} />;
      case 'file':
        return (
          <div className="vstack">
            {v.fileUrl && <a href={v.fileUrl} target="_blank" rel="noreferrer">📎 {v.fileName || 'Current file'}</a>}
            {!locked(q) && (
              <input type="file" disabled={!!busy[q.id]} onChange={(e) => onFile(q.id, e.target.files?.[0])} />
            )}
            {progress[q.id] && (
              <ProgressBar percent={progress[q.id].percent} label={progress[q.id].name} />
            )}
            {locked(q) ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Submitted — this answer can no longer be changed.
              </div>
            ) : (
              q.effective_max_upload_mb && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Maximum file size: {q.effective_max_upload_mb} MB
                  {v.fileUrl ? ' · uploading a new file replaces the current one' : ''}
                </div>
              )
            )}
          </div>
        );
      default:
        return <Input disabled={isLocked} value={v.value} onChange={(e) => setVal(q.id, { value: e.target.value })} />;
    }
  };

  const answered = (q) => {
    const a = q.answer;
    return a && (a.value_text || a.value_number != null || a.file_url);
  };

  return (
    <Layout>
      <PageHead title="My Submissions" subtitle="Respond to what the organizers have asked" />

      {questions.length === 0 ? (
        <Card><Empty icon="🎉" title="Nothing to answer" subtitle="You're all caught up." /></Card>
      ) : (
        questions.map((q) => (
          <Card key={q.id}>
            <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h3>{q.title}</h3>
              <span>
                {answered(q) ? <Badge color="green">Answered</Badge> : (q.required ? <Badge color="orange">Required</Badge> : null)}{' '}
                {locked(q) && <Badge color="gray">Final</Badge>}
              </span>
            </div>
            {q.description && <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>{q.description}</p>}
            <div className="field">{renderInput(q)}</div>
            <Button variant="primary" onClick={() => save(q)} disabled={busy[q.id] || locked(q)}>
              {busy[q.id] ? 'Saving…' : locked(q) ? 'Submitted' : 'Save'}
            </Button>
          </Card>
        ))
      )}
    </Layout>
  );
}
