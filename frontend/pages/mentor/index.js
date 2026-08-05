import { useEffect, useState } from 'react';
import { useRequireRole, useAuth } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Badge, Avatar, Empty } from '../../components/UI';

export default function MentorTeams() {
  const { ok } = useRequireRole(['mentor']);
  const { user } = useAuth();
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [teams, setTeams] = useState(null);

  useEffect(() => {
    if (ok && bootcampId) api.get(scoped('/api/teams', bootcampId)).then(setTeams).catch((e) => toast.err(e.message));
  }, [ok, bootcampId]);

  if (!ok || !bootcampId || !teams) return <Layout><Loading /></Layout>;

  const mine = teams.filter((t) => t.mentors.some((m) => m.id === user?.id));
  const others = teams.filter((t) => !t.mentors.some((m) => m.id === user?.id));

  const TeamCard = (t) => (
    <Card key={t.id}>
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <h3>{t.name}</h3>
        <Badge color="gray">{t.members.length} members</Badge>
      </div>
      <div className="divider" />
      <div className="vstack">
        {t.members.map((m) => (
          <div className="hstack" key={m.id}>
            <Avatar name={m.name} id={m.id} />
            <span className="grow">{m.name}</span>
            {t.spoc_student_id === m.id && <Badge color="orange">SPOC</Badge>}
          </div>
        ))}
        {t.members.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 14 }}>No members yet</span>}
      </div>
      {t.mentors.length > 0 && (
        <>
          <div className="divider" />
          <div className="hstack">
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Mentors:</span>
            {t.mentors.map((m) => <Badge key={m.id} color="blue">{m.name}</Badge>)}
          </div>
        </>
      )}
    </Card>
  );

  return (
    <Layout>
      <PageHead title="Teams" subtitle="You can assess any team; your assigned teams are shown first" />

      {teams.length === 0 ? (
        <Card><Empty icon="👥" title="No teams yet" subtitle="The admin hasn't built teams." /></Card>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <h2 style={{ margin: '4px 0 12px' }}>My Teams</h2>
              <div className="grid cols-2">{mine.map(TeamCard)}</div>
            </>
          )}
          <h2 style={{ margin: '20px 0 12px' }}>{mine.length > 0 ? 'All Other Teams' : 'All Teams'}</h2>
          <div className="grid cols-2">{others.map(TeamCard)}</div>
        </>
      )}
    </Layout>
  );
}
