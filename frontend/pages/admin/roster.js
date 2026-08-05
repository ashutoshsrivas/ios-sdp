import { useEffect, useState, useRef } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Modal, Field, Input, Empty, Badge } from '../../components/UI';

const BLANK = { student_id: '', full_name: '', email: '', phone: '', campus: '', test_no: '', status: '' };

export default function AdminRoster() {
  const { ok } = useRequireRole(['admin']);
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const load = async () => setRows(await api.get('/api/roster'));
  useEffect(() => { if (ok) load().catch((e) => toast.err(e.message)); }, [ok]);

  const openNew = () => { setForm(BLANK); setEditing({}); };
  const openEdit = (r) => { setForm({ ...BLANK, ...r }); setEditing(r); };

  const save = async () => {
    if (!form.full_name?.trim()) { toast.err('Full name is required'); return; }
    setBusy(true);
    try {
      if (editing.id) { await api.put(`/api/roster/${editing.id}`, form); toast.ok('Entry updated'); }
      else { await api.post('/api/roster', form); toast.ok('Entry added'); }
      setEditing(null); await load();
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const remove = async (r) => {
    if (!confirm(`Remove ${r.full_name} from the directory?`)) return;
    try { await api.del(`/api/roster/${r.id}`); await load(); toast.show('Removed'); }
    catch (e) { toast.err(e.message); }
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.uploadTo('/api/roster/import', file);
      await load();
      toast.ok(`Imported: ${res.inserted} added, ${res.updated} updated`);
    } catch (err) { toast.err(err.message); }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!ok || !rows) return <Layout><Loading /></Layout>;

  const q = search.trim().toLowerCase();
  // Stable serial number = position in the uploaded list (backend returns it in sequence).
  const snoById = new Map(rows.map((r, i) => [r.id, i + 1]));
  const statusColor = (s) => {
    const v = String(s || '').toUpperCase();
    if (v === 'CNF') return 'green';
    if (v === 'WL') return 'orange';
    return 'gray';
  };
  const filtered = q
    ? rows.filter((r) => [r.full_name, r.email, r.student_id, r.phone, r.campus].some((v) => String(v || '').toLowerCase().includes(q)))
    : rows;

  return (
    <Layout>
      <PageHead
        title="Student Directory"
        subtitle="Master list volunteers pick from when registering. Shared across all cohorts."
        actions={
          <>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={onImport} />
            <Button onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? 'Importing…' : '⬆ Import Excel'}</Button>
            <Button variant="primary" onClick={openNew}>+ Add Entry</Button>
          </>
        }
      />

      <Card>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <Input placeholder="Filter directory…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
          <Badge color="blue">{filtered.length} of {rows.length}</Badge>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><Empty icon="📇" title="Directory is empty" subtitle="Import an Excel file or add entries manually." /></Card>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>S.No.</th><th>Student Id</th><th>Name</th><th>Email</th><th>Phone</th><th>Campus</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{snoById.get(r.id)}</td>
                  <td className="mono">{r.student_id || '—'}</td>
                  <td style={{ fontWeight: 550 }}>{r.full_name}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.email || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.phone || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.campus || '—'}</td>
                  <td>{r.status ? <Badge color={statusColor(r.status)}>{r.status}</Badge> : '—'}</td>
                  <td>
                    <div className="hstack" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => openEdit(r)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r)}>✕</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit Directory Entry' : 'Add Directory Entry'}
          onClose={() => setEditing(null)}
          footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{editing.id ? 'Save' : 'Add'}</Button></>}
        >
          <div className="row-fields">
            <Field label="Student Id"><Input value={form.student_id || ''} onChange={(e) => setForm({ ...form, student_id: e.target.value })} /></Field>
            <Field label="Full name"><Input value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          </div>
          <Field label="Email"><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="row-fields">
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Test no."><Input value={form.test_no || ''} onChange={(e) => setForm({ ...form, test_no: e.target.value })} /></Field>
          </div>
          <Field label="Campus"><Input value={form.campus || ''} onChange={(e) => setForm({ ...form, campus: e.target.value })} /></Field>
          <Field label="Status"><Input value={form.status || ''} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
        </Modal>
      )}
    </Layout>
  );
}
