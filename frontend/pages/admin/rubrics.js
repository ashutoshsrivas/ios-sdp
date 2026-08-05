import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty,
} from '../../components/UI';

export default function AdminRubrics() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [rubrics, setRubrics] = useState(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState([{ name: '', max_score: 10, weight: 1 }]);
  const [busy, setBusy] = useState(false);

  const load = async () => setRubrics(await api.get(scoped('/api/rubrics', bootcampId)));
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const reset = () => { setTitle(''); setDescription(''); setCriteria([{ name: '', max_score: 10, weight: 1 }]); };
  const updateCrit = (i, key, val) => setCriteria((c) => c.map((x, idx) => (idx === i ? { ...x, [key]: val } : x)));
  const addCrit = () => setCriteria((c) => [...c, { name: '', max_score: 10, weight: 1 }]);
  const rmCrit = (i) => setCriteria((c) => c.filter((_, idx) => idx !== i));

  const save = async () => {
    const clean = criteria.filter((c) => c.name.trim());
    if (!title.trim() || clean.length === 0) { toast.err('Add a title and at least one criterion'); return; }
    setBusy(true);
    try {
      await api.post('/api/rubrics', { title, description, criteria: clean, bootcamp_id: bootcampId });
      setCreating(false); reset(); await load();
      toast.ok('Rubric created');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const remove = async (r) => {
    if (!confirm(`Delete rubric "${r.title}"? Scores will be lost.`)) return;
    try { await api.del(`/api/rubrics/${r.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || !bootcampId || !rubrics) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Rubrics"
        subtitle="Assessment criteria — visible to every mentor"
        actions={<Button variant="primary" onClick={() => { reset(); setCreating(true); }}>+ New Rubric</Button>}
      />

      {rubrics.length === 0 ? (
        <Card><Empty icon="📋" title="No rubrics yet" subtitle="Create a rubric so mentors can score students." /></Card>
      ) : (
        <div className="grid cols-2">
          {rubrics.map((r) => (
            <Card key={r.id}>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <h3>{r.title}</h3>
                <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button>
              </div>
              {r.description && <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{r.description}</p>}
              <div className="divider" />
              <div className="vstack">
                {r.criteria.map((c) => (
                  <div className="hstack" key={c.id} style={{ justifyContent: 'space-between' }}>
                    <span>{c.name}</span>
                    <div className="hstack">
                      <Badge color="blue">/{c.max_score}</Badge>
                      <Badge color="gray">×{c.weight}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          title="New Rubric"
          wide
          onClose={() => setCreating(false)}
          footer={<>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>Create</Button>
          </>}
        >
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mid-cohort Evaluation" /></Field>
          <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional context for mentors" /></Field>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Criteria</label>
          <div className="hstack" style={{ gap: 8, padding: '10px 2px 0' }}>
            <span className="kicker" style={{ flex: 3 }}>Criterion</span>
            <span className="kicker" style={{ flex: 1 }}>Max score</span>
            <span className="kicker" style={{ flex: 1 }}>Weight</span>
            <span style={{ width: 34, flexShrink: 0 }} />
          </div>
          <div className="vstack" style={{ marginTop: 6 }}>
            {criteria.map((c, i) => (
              <div className="hstack" key={i} style={{ gap: 8 }}>
                <Input style={{ flex: 3 }} placeholder="Criterion name" value={c.name} onChange={(e) => updateCrit(i, 'name', e.target.value)} />
                <Input style={{ flex: 1 }} type="number" placeholder="Max" value={c.max_score} onChange={(e) => updateCrit(i, 'max_score', e.target.value)} />
                <Input style={{ flex: 1 }} type="number" placeholder="Weight" value={c.weight} onChange={(e) => updateCrit(i, 'weight', e.target.value)} />
                <Button size="sm" variant="ghost" onClick={() => rmCrit(i)} disabled={criteria.length === 1} style={{ width: 34, flexShrink: 0, padding: 0 }}>✕</Button>
              </div>
            ))}
          </div>
          <Button size="sm" onClick={addCrit} style={{ marginTop: 10 }}>+ Add criterion</Button>
        </Modal>
      )}
    </Layout>
  );
}
