import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import Layout, { PageHead } from '../../components/Layout';
import RosterSearch from '../../components/RosterSearch';
import {
  Card, Button, Loading, useToast, Badge, Avatar, Segmented, Modal, Field, Input, Empty,
} from '../../components/UI';

const STATUS_COLOR = { pending: 'orange', approved: 'green', rejected: 'red' };

// Map a roster directory row onto the registration form fields.
export function rosterToForm(r) {
  return {
    name: r.full_name || '',
    email: r.email || '',
    phone: r.phone || '',
    roll_no: r.student_id || '',
    college: r.campus || '',
    roster_id: r.id,
  };
}

export default function AdminStudents() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [students, setStudents] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => setStudents(await api.get(scoped('/api/students', bootcampId)));
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const approve = async (s) => {
    try {
      const res = await api.post(`/api/students/${s.id}/approve`);
      await load();
      if (res.defaultPassword) toast.ok(`Approved. Login → ${res.email} / ${res.defaultPassword}`);
      else toast.ok('Student approved');
    } catch (e) { toast.err(e.message); }
  };

  const approveAll = async () => {
    const pending = students.filter((s) => s.status === 'pending').length;
    if (!pending) { toast.show('No pending registrations'); return; }
    if (!confirm(`Approve all ${pending} pending student${pending === 1 ? '' : 's'}? Each gets the default password 12345678.`)) return;
    try {
      const res = await api.post('/api/students/approve-all', { bootcamp_id: bootcampId });
      await load();
      const skip = res.skipped ? ` · skipped ${res.skipped} approved elsewhere` : '';
      toast.ok(`Approved ${res.approved} student${res.approved === 1 ? '' : 's'} · default password ${res.defaultPassword}${skip}`);
    } catch (e) { toast.err(e.message); }
  };

  const reject = async (s) => {
    try { await api.post(`/api/students/${s.id}/reject`); await load(); toast.show('Rejected'); }
    catch (e) { toast.err(e.message); }
  };

  const remove = async (s) => {
    if (!confirm(`Delete ${s.name}? This cannot be undone.`)) return;
    try { await api.del(`/api/students/${s.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  const addStudent = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/students', { ...form, bootcamp_id: bootcampId });
      setAdding(false); setForm({}); await load();
      toast.ok('Student registered');
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  };

  if (!ok || !bootcampId || !students) return <Layout><Loading /></Layout>;

  const filtered = students.filter((s) => filter === 'all' || s.status === filter);

  // Exports whatever the current filter shows.
  const exportCsv = () => {
    if (!filtered.length) { toast.show('Nothing to export'); return; }
    const header = ['S.No', 'Name', 'Email', 'Phone', 'Roll No', 'College', 'Branch', 'Year',
      'Status', 'Team', 'Registered by', 'Approved by', 'Registered on'];
    const rows = filtered.map((s, i) => [
      i + 1, s.name, s.email, s.phone || '', s.roll_no || '', s.college || '', s.branch || '',
      s.year || '', s.status, s.team_name || '', s.registered_by_name || '', s.approved_by_name || '',
      s.created_at ? String(s.created_at).slice(0, 10) : '',
    ]);
    downloadCsv(`registrations-${filter}.csv`, [header, ...rows]);
  };

  return (
    <Layout>
      <PageHead
        title="Registrations"
        subtitle="Review and approve students registered by volunteers"
        actions={
          <>
            {students.length > 0 && <Button onClick={exportCsv}>⤓ Export CSV</Button>}
            {students.some((s) => s.status === 'pending') && (
              <Button variant="success" onClick={approveAll}>✓ Approve all</Button>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>+ Add Student</Button>
          </>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: `Pending (${students.filter((s) => s.status === 'pending').length})` },
            { value: 'approved', label: `Approved (${students.filter((s) => s.status === 'approved').length})` },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card><Empty icon="🎓" title="No students here" subtitle="Registrations will appear as volunteers add them." /></Card>
      ) : (
        <div className="list">
          {filtered.map((s) => (
            <div className="row" key={s.id}>
              <Avatar name={s.name} id={s.id} />
              <div className="grow">
                <div className="title">{s.name} <Badge color={STATUS_COLOR[s.status]}>{s.status}</Badge></div>
                <div className="desc truncate">
                  {s.email}{s.college ? ` · ${s.college}` : ''}{s.branch ? ` · ${s.branch}` : ''}
                  {s.registered_by_name ? ` · by ${s.registered_by_name}` : ''}
                </div>
              </div>
              <div className="hstack">
                {s.status === 'pending' && (
                  <>
                    <Button variant="success" size="sm" onClick={() => approve(s)}>Approve</Button>
                    <Button variant="danger" size="sm" onClick={() => reject(s)}>Reject</Button>
                  </>
                )}
                {s.status === 'rejected' && (
                  <Button variant="success" size="sm" onClick={() => approve(s)}>Approve</Button>
                )}
                {s.status === 'approved' && s.team_name && <Badge color="purple">{s.team_name}</Badge>}
                <Button variant="ghost" size="sm" onClick={() => remove(s)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <Modal
          title="Add Student"
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" onClick={addStudent} disabled={busy}>Register</Button>
            </>
          }
        >
          <form onSubmit={addStudent}>
            <Field label="Find in directory">
              <RosterSearch onPick={(r) => setForm({ ...form, ...rosterToForm(r) })} />
            </Field>
            <div className="divider" />
            <div className="row-fields">
              <Field label="Full name"><Input required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" required value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <div className="row-fields">
              <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Roll no."><Input value={form.roll_no || ''} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} /></Field>
            </div>
            <div className="row-fields">
              <Field label="College"><Input value={form.college || ''} onChange={(e) => setForm({ ...form, college: e.target.value })} /></Field>
              <Field label="Branch"><Input value={form.branch || ''} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
            </div>
            <Field label="Year"><Input value={form.year || ''} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </Layout>
  );
}
