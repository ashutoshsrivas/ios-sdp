import { useEffect, useState, useCallback } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge } from '../../components/UI';

export default function AdminDashboard() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId, currentBootcamp, reload } = useBootcamp() || {};
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bootcampId) return;
    const [students, teams, users, bcStats] = await Promise.all([
      api.get(scoped('/api/students', bootcampId)),
      api.get(scoped('/api/teams', bootcampId)),
      api.get('/api/users'),
      api.get('/api/bootcamps/stats'),
    ]);
    setData({ students, teams, users, bcStats });
  }, [bootcampId]);

  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, bootcampId, load]);

  // Keep stats in sync: refetch whenever the tab regains focus.
  useEffect(() => {
    if (!ok) return;
    const onFocus = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [ok, load]);

  const regOpen = !!currentBootcamp?.registration_open;
  const toggleReg = async () => {
    if (!currentBootcamp) return;
    setBusy(true);
    try {
      await api.put(`/api/bootcamps/${currentBootcamp.id}`, { registration_open: !regOpen });
      await reload?.();
      toast.ok(!regOpen ? 'Registration opened' : 'Registration closed');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  if (!ok || !bootcampId || !data) return <Layout><Loading /></Layout>;

  const pending = data.students.filter((s) => s.status === 'pending').length;
  const approved = data.students.filter((s) => s.status === 'approved').length;
  const byRole = (r) => data.users.filter((u) => u.role === r).length;

  const stats = [
    { n: data.students.length, l: 'Registrations', c: 'var(--blue)' },
    { n: pending, l: 'Pending approval', c: 'var(--orange)' },
    { n: approved, l: 'Approved', c: 'var(--green)' },
    { n: data.teams.length, l: 'Teams', c: 'var(--purple)' },
    { n: byRole('mentor'), l: 'Mentors', c: 'var(--blue)' },
    { n: byRole('volunteer'), l: 'Volunteers', c: 'var(--blue)' },
  ];

  return (
    <Layout>
      <PageHead title="Dashboard" subtitle={currentBootcamp?.name || 'Overview'} />

      <Card>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>Student Registration</h3>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>
              {regOpen ? 'Volunteers can register new students for this cohort.' : 'Registration is closed. Time to build teams.'}
            </p>
          </div>
          <div className="hstack">
            <Badge color={regOpen ? 'green' : 'red'}>{regOpen ? 'Open' : 'Closed'}</Badge>
            <Button variant={regOpen ? 'danger' : 'success'} onClick={toggleReg} disabled={busy}>
              {regOpen ? 'Close registration' : 'Open registration'}
            </Button>
          </div>
        </div>
      </Card>

      <h2 style={{ margin: '4px 0 12px' }}>{currentBootcamp?.name} · overview</h2>
      <div className="grid cols-3">
        {stats.map((s) => (
          <Card key={s.l}>
            <div className="stat">
              <span className="n" style={{ color: s.c }}>{s.n}</span>
              <span className="l">{s.l}</span>
            </div>
          </Card>
        ))}
      </div>

      <h2 style={{ margin: '24px 0 12px' }}>Cohort-wise data</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Cohort</th><th>Registrations</th><th>Pending</th><th>Approved</th><th>Teams</th><th>Registration</th></tr>
          </thead>
          <tbody>
            {(data.bcStats || []).map((b) => (
              <tr key={b.id} style={b.id === bootcampId ? { background: 'var(--accent-tint)' } : undefined}>
                <td style={{ fontWeight: 550, color: 'var(--text)' }}>
                  {b.name}{' '}
                  {b.id === bootcampId && <Badge color="orange">selected</Badge>}{' '}
                  {b.status === 'archived' && <Badge color="gray">archived</Badge>}
                </td>
                <td>{Number(b.students)}</td>
                <td>{Number(b.pending)}</td>
                <td>{Number(b.approved)}</td>
                <td>{Number(b.teams)}</td>
                <td>{b.registration_open ? <Badge color="green">Open</Badge> : <Badge color="red">Closed</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
