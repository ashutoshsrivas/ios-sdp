import { useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty, Switch } from '../../components/UI';

// Mirrors slugify() on the server so the admin sees the URL they'll actually get.
function slugPreview(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'cohort';
}

export default function AdminBootcamps() {
  const { ok } = useRequireRole(['admin']);
  const { bootcamps, reload, loading, setBootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [editing, setEditing] = useState(null); // {} for new, or object
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const openNew = () => { setForm({}); setEditing({}); };
  const openEdit = (b) => {
    setForm({
      name: b.name,
      description: b.description || '',
      public_visible: !!b.public_visible,
      public_slug: b.public_slug || '',
      tagline: b.tagline || '',
      sort_order: b.sort_order ?? '',
    });
    setEditing(b);
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.err('Name is required'); return; }
    setBusy(true);
    try {
      if (editing.id) { await api.put(`/api/bootcamps/${editing.id}`, form); toast.ok('Bootcamp updated'); }
      else {
        const r = await api.post('/api/bootcamps', form);
        toast.ok('Cohort created');
        setBootcampId?.(r.id);
      }
      setEditing(null); await reload?.();
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const toggleReg = async (b) => {
    try { await api.put(`/api/bootcamps/${b.id}`, { registration_open: !b.registration_open }); await reload?.(); }
    catch (e) { toast.err(e.message); }
  };
  const toggleArchive = async (b) => {
    try { await api.put(`/api/bootcamps/${b.id}`, { status: b.status === 'active' ? 'archived' : 'active' }); await reload?.(); }
    catch (e) { toast.err(e.message); }
  };
  const remove = async (b) => {
    if (!confirm(`Delete "${b.name}"?`)) return;
    try { await api.del(`/api/bootcamps/${b.id}`); await reload?.(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || loading) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Cohorts"
        subtitle="Each cohort has its own students, teams, tasks and questions"
        actions={<Button variant="primary" onClick={openNew}>+ New Cohort</Button>}
      />

      {(!bootcamps || bootcamps.length === 0) ? (
        <Card><Empty icon="🚀" title="No cohorts yet" subtitle="Create your first cohort to get started." /></Card>
      ) : (
        <div className="grid cols-2">
          {bootcamps.map((b) => (
            <Card key={b.id}>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <h3>{b.name}</h3>
                <Badge color={b.status === 'active' ? 'green' : 'gray'}>{b.status}</Badge>
              </div>
              {b.description && <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>{b.description}</p>}
              <div className="divider" />
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <Badge color={b.registration_open ? 'blue' : 'orange'}>
                  Registration {b.registration_open ? 'open' : 'closed'}
                </Badge>
                <div className="hstack">
                  <Button size="sm" onClick={() => toggleReg(b)}>{b.registration_open ? 'Close reg.' : 'Open reg.'}</Button>
                  <Button size="sm" onClick={() => openEdit(b)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleArchive(b)}>{b.status === 'active' ? 'Archive' : 'Activate'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(b)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit Cohort' : 'New Cohort'}
          onClose={() => setEditing(null)}
          footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{editing.id ? 'Save' : 'Create'}</Button></>}
        >
          <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Winter 2026 Cohort" /></Field>
          <Field label="Description"><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

          {editing.id && (
            <>
              <div className="divider" />
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Public website</div>
              <Switch
                checked={!!form.public_visible}
                onChange={(v) => setForm({ ...form, public_visible: v })}
                label="Show this cohort on iosdc.geu.ac.in"
              />
              <Field label="Tagline (shown under the cohort name on the website)">
                <Input
                  value={form.tagline || ''}
                  onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  placeholder="e.g. 32 students, 8 apps shipped"
                />
              </Field>
              <Field label="Public URL">
                <Input
                  value={form.public_slug || ''}
                  onChange={(e) => setForm({ ...form, public_slug: e.target.value })}
                  placeholder="cohort-1"
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  iosdc.geu.ac.in/cohort.html?c={form.public_slug || slugPreview(form.name)} — leave blank to
                  derive it from the name.
                </div>
              </Field>
              <Field label="Nav order (lower shows first)">
                <Input
                  type="number"
                  value={form.sort_order ?? ''}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </Field>
            </>
          )}
        </Modal>
      )}
    </Layout>
  );
}
