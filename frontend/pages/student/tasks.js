import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Badge, Empty } from '../../components/UI';

export default function StudentTasks() {
  const { ok } = useRequireRole(['student']);
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!ok) return;
    api.get('/api/tasks/my-feedback')
      .then(setData)
      .catch((e) => toast.err(e.message));
  }, [ok]);

  if (!ok || !data) return <Layout><Loading /></Layout>;

  const { tasks, teamId, feedbackMap } = data;

  return (
    <Layout>
      <PageHead title="Tasks & Feedbacks" subtitle="Your assigned tasks and mentor feedback" />

      {!teamId && (
        <Card>
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
            You haven't been assigned to a team yet. Tasks and feedback will appear here once you're assigned.
          </p>
        </Card>
      )}

      {tasks.length === 0 ? (
        <Card><Empty icon="✅" title="No tasks yet" subtitle="Tasks will appear here once the organizers add them." /></Card>
      ) : (
        tasks.map((task) => {
          const feedbacks = feedbackMap[task.id] || [];
          return (
            <Card key={task.id}>
              <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <h3>{task.title}</h3>
                {feedbacks.length > 0
                  ? <Badge color="green">Feedback received</Badge>
                  : <Badge color="orange">Pending feedback</Badge>}
              </div>
              {task.description && (
                <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 10 }}>{task.description}</p>
              )}
              {task.due_date && (
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                  Due: {new Date(task.due_date).toLocaleDateString()}
                </p>
              )}
              {task.file_url && (
                <p style={{ marginBottom: 6 }}>
                  <a href={task.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
                    📎 Download attachment{task.file_name ? `: ${task.file_name}` : ''}
                  </a>
                </p>
              )}
              {feedbacks.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--separator)', paddingTop: 12 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Mentor Feedback</p>
                  <div className="vstack">
                    {feedbacks.map((f) => (
                      <div key={f.id} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 14px' }}>
                        <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{f.mentor_name}</span>
                          {f.score != null && <Badge color="blue">Score: {f.score}</Badge>}
                        </div>
                        {f.feedback && (
                          <p style={{ fontSize: 14, color: 'var(--text)', marginTop: 4 }}>{f.feedback}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })
      )}
    </Layout>
  );
}
