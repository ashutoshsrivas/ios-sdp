import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Badge, Button } from '../../components/UI';

export default function StudentDashboard() {
  const { ok } = useRequireRole(['student']);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!ok) return;
    api.get('/api/students/me/overview').then(setData).catch((e) => toast.err(e.message));
  }, [ok]);

  if (!ok || !data) return <Layout><Loading /></Layout>;

  const { student, team, stats } = data;
  const firstName = (student.name || '').split(' ')[0] || 'there';

  const cards = [
    { n: stats.tasks, l: 'Tasks assigned', c: 'var(--blue)' },
    { n: stats.submissionsPending, l: 'Submissions pending', c: 'var(--orange)' },
    { n: stats.submissionsAnswered, l: 'Submissions done', c: 'var(--green)' },
    { n: stats.feedbackReceived, l: 'Feedback received', c: 'var(--purple)' },
  ];

  return (
    <Layout>
      <PageHead title="Dashboard" subtitle={`Welcome back, ${firstName}`} />

      <div className="grid cols-4">
        {cards.map((s) => (
          <Card key={s.l}>
            <div className="stat">
              <span className="n" style={{ color: s.c }}>{s.n}</span>
              <span className="l">{s.l}</span>
            </div>
          </Card>
        ))}
      </div>

      <h2 style={{ margin: '24px 0 12px' }}>My Team</h2>
      {!team ? (
        <Card>
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
            You haven't been assigned to a team yet. Your team, SPOC, mentor and table will show here once you're placed.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <h3>{team.name}</h3>
            <div className="hstack" style={{ gap: 6 }}>
              {team.table_id && <Badge color="orange">Table {team.table_id}</Badge>}
              <button
                type="button"
                onClick={() => setShowMembers((v) => !v)}
                title="Show team members"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Badge color="gray">{team.size} member{team.size === 1 ? '' : 's'} {showMembers ? '▲' : '▾'}</Badge>
              </button>
            </div>
          </div>

          {showMembers && (
            <div style={{ marginBottom: 14, borderBottom: '1px solid var(--separator)', paddingBottom: 14 }}>
              <div className="kicker" style={{ marginBottom: 8 }}>Team members</div>
              <div className="vstack" style={{ gap: 6 }}>
                {team.members.map((m) => (
                  <div key={m.id} className="hstack" style={{ gap: 8 }}>
                    <span style={{ fontSize: 15 }}>{m.name}</span>
                    {m.is_you && <Badge color="blue">You</Badge>}
                    {m.is_spoc && <Badge color="orange">SPOC</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid cols-3" style={{ gap: 12 }}>
            <div>
              <div className="kicker">Table</div>
              <div style={{ marginTop: 4, fontSize: 15 }}>{team.table_id || <span style={{ color: 'var(--muted)' }}>Not assigned</span>}</div>
            </div>
            <div>
              <div className="kicker">SPOC</div>
              <div style={{ marginTop: 4, fontSize: 15 }}>
                {team.spoc
                  ? <>{team.spoc.name}{team.isSpoc && <span style={{ marginLeft: 6 }}><Badge color="green">You</Badge></span>}</>
                  : <span style={{ color: 'var(--muted)' }}>Not set</span>}
              </div>
            </div>
            <div>
              <div className="kicker">Mentor{team.mentors.length === 1 ? '' : 's'}</div>
              <div style={{ marginTop: 4 }}>
                {team.mentors.length === 0
                  ? <span style={{ color: 'var(--muted)', fontSize: 15 }}>None assigned</span>
                  : (
                    <div className="vstack" style={{ gap: 4 }}>
                      {team.mentors.map((m) => (
                        <div key={m.id} style={{ fontSize: 15 }}>
                          {m.name}
                          {m.email && <span style={{ color: 'var(--muted)', fontSize: 13 }}> · {m.email}</span>}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="hstack" style={{ marginTop: 16, gap: 10 }}>
        <Button onClick={() => router.push('/student')}>
          Go to My Submissions{stats.submissionsPending > 0 ? ` (${stats.submissionsPending} pending)` : ''}
        </Button>
        <Button onClick={() => router.push('/student/tasks')}>View Tasks & Feedback</Button>
      </div>
    </Layout>
  );
}
