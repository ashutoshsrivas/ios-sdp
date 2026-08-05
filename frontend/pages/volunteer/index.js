import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import RosterSearch from '../../components/RosterSearch';
import { rosterToForm } from '../admin/students';
import {
  Card, Button, Loading, useToast, Badge, Avatar, Field, Input, Empty,
} from '../../components/UI';

const STATUS_COLOR = { pending: 'orange', approved: 'green', rejected: 'red' };

export default function VolunteerHome() {
  const { ok } = useRequireRole(['volunteer']);
  const { bootcampId, currentBootcamp, bootcamps } = useBootcamp() || {};
  const toast = useToast();
  const [students, setStudents] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const regOpen = !!currentBootcamp?.registration_open;

  const load = async () => setStudents(await api.get(scoped('/api/students', bootcampId)));
  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/students', { ...form, bootcamp_id: bootcampId });
      setForm({}); await load();
      toast.ok('Student registered — pending admin approval');
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  };

  if (!ok) return <Layout><Loading /></Layout>;
  if (bootcamps && bootcamps.length === 0)
    return <Layout><Card><Empty icon="🚀" title="No cohorts yet" subtitle="Ask an admin to create a cohort." /></Card></Layout>;
  if (!bootcampId || !students) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead title="Register Students" subtitle={currentBootcamp?.name || ''} />

      {!regOpen && (
        <Card style={{ background: 'rgba(255,69,58,0.06)' }}>
          <div className="hstack"><Badge color="red">Closed</Badge> Registration is currently closed for this cohort.</div>
        </Card>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card>
          <h3 style={{ marginBottom: 12 }}>New Registration</h3>
          <Field label="Find student in directory">
            <RosterSearch onPick={(r) => setForm({ ...form, ...rosterToForm(r) })} />
          </Field>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            Start typing a name, email, student id or phone — pick a match to auto-fill.
          </p>
          <div className="divider" />
          <form onSubmit={submit}>
            <div className="row-fields">
              <Field label="Full name"><Input required disabled={!regOpen} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Student id"><Input disabled={!regOpen} value={form.roll_no || ''} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} /></Field>
            </div>
            <Field label="Email"><Input type="email" required disabled={!regOpen} value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <div className="row-fields">
              <Field label="Phone"><Input disabled={!regOpen} value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Branch"><Input disabled={!regOpen} value={form.branch || ''} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
            </div>
            <Field label="Campus / College"><Input disabled={!regOpen} value={form.college || ''} onChange={(e) => setForm({ ...form, college: e.target.value })} /></Field>
            <Button variant="primary" block type="submit" disabled={busy || !regOpen}>{busy ? 'Registering…' : 'Register Student'}</Button>
          </form>
        </Card>

        <div>
          <h3 style={{ margin: '4px 0 12px' }}>My Registrations ({students.length})</h3>
          {students.length === 0 ? (
            <Card><Empty icon="🎓" title="None yet" subtitle="Students you register appear here." /></Card>
          ) : (
            <div className="list">
              {students.map((s) => (
                <div className="row" key={s.id}>
                  <Avatar name={s.name} id={s.id} />
                  <div className="grow">
                    <div className="title">{s.name}</div>
                    <div className="desc truncate">{s.email}{s.roll_no ? ` · #${s.roll_no}` : ''}</div>
                  </div>
                  <Badge color={STATUS_COLOR[s.status]}>{s.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
