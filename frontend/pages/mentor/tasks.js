import { useEffect, useRef, useState } from 'react';
import { useRequireRole, useAuth } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import { readDraft, writeDraft, clearDraft } from '../../lib/draft';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge, Select, Input, Textarea, Empty } from '../../components/UI';

export default function MentorTasks() {
  const { ok } = useRequireRole(['mentor']);
  const { user } = useAuth();
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [tasks, setTasks] = useState(null);
  const [teams, setTeams] = useState([]);
  const [taskId, setTaskId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [allFeedback, setAllFeedback] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [score, setScore] = useState('');
  const [busy, setBusy] = useState(false);
  const restored = useRef(false);

  // Device-only draft keys (never sent to the server → invisible to admin, uncounted until Save).
  const selKey = user ? `taskFbSel:${user.id}:${bootcampId}` : null;
  const draftKey = (tid, teamid) => (user && tid && teamid ? `taskFbDraft:${user.id}:${bootcampId}:${tid}:${teamid}` : null);

  // Feedback/score for a team = its local draft if present, else this mentor's saved value.
  const applyForTeam = (tid, teamid, fbList) => {
    const mine = fbList.find((f) => String(f.team_id) === String(teamid) && f.mentor_id === user?.id);
    const draft = readDraft(draftKey(tid, teamid));
    setFeedback(draft?.feedback ?? mine?.feedback ?? '');
    setScore(draft?.score ?? mine?.score ?? '');
  };

  useEffect(() => {
    if (!ok || !bootcampId) return;
    Promise.all([api.get(scoped('/api/tasks', bootcampId)), api.get(scoped('/api/teams', bootcampId))])
      .then(([t, tm]) => { setTasks(t); setTeams(tm); })
      .catch((e) => toast.err(e.message));
  }, [ok, bootcampId]);

  const loadFeedback = async (tid) => {
    if (!tid) { setAllFeedback([]); return []; }
    try { const fb = await api.get(`/api/tasks/${tid}/feedback`); setAllFeedback(fb); return fb; }
    catch (e) { toast.err(e.message); return []; }
  };

  // Restore the last task/team (and its draft) after an accidental back/navigation.
  useEffect(() => {
    if (!tasks || restored.current) return;
    restored.current = true;
    const sel = readDraft(selKey);
    if (!sel?.taskId) return;
    setTaskId(sel.taskId);
    loadFeedback(sel.taskId).then((fb) => {
      if (sel.teamId) { setTeamId(sel.teamId); applyForTeam(sel.taskId, sel.teamId, fb); }
    });
  }, [tasks]);

  // Remember selection + auto-save the working feedback/score locally.
  useEffect(() => {
    if (!restored.current || !taskId || !teamId) return;
    writeDraft(selKey, { taskId, teamId });
  }, [taskId, teamId]);
  useEffect(() => {
    if (!taskId || !teamId) return;
    writeDraft(draftKey(taskId, teamId), { feedback, score });
  }, [feedback, score]);

  const onTask = (v) => { setTaskId(v); setTeamId(''); setFeedback(''); setScore(''); loadFeedback(v); };
  const onTeam = (v) => { setTeamId(v); applyForTeam(taskId, v, allFeedback); };

  const save = async () => {
    if (!teamId) { toast.err('Pick a team'); return; }
    setBusy(true);
    try {
      await api.post(`/api/tasks/${taskId}/feedback`, { team_id: Number(teamId), feedback, score });
      clearDraft(draftKey(taskId, teamId)); // saved to server — drop the local draft
      await loadFeedback(taskId);
      toast.ok('Feedback saved');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  if (!ok || !tasks) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead title="Task Feedback" subtitle="Record feedback for a team on a task" />

      {tasks.length === 0 ? (
        <Card><Empty icon="✅" title="No tasks" subtitle="Ask an admin to assign tasks." /></Card>
      ) : (
        <>
          <Card>
            <div className="row-fields">
              <div className="field">
                <label>Task</label>
                <Select value={taskId} onChange={(e) => onTask(e.target.value)}>
                  <option value="">Choose a task…</option>
                  {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </Select>
              </div>
              <div className="field">
                <label>Team</label>
                <Select value={teamId} onChange={(e) => onTeam(e.target.value)} disabled={!taskId}>
                  <option value="">Choose a team…</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
            </div>

            {teamId && (
              <>
                <div className="field">
                  <label>Feedback</label>
                  <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What went well, what to improve…" />
                </div>
                <div className="field">
                  <label>Score (optional)</label>
                  <Input type="number" value={score} onChange={(e) => setScore(e.target.value)} style={{ maxWidth: 160 }} />
                </div>
                <div className="hstack" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save feedback'}</Button>
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    Auto-saved on this device — nothing is submitted until you press Save.
                  </span>
                </div>
              </>
            )}
          </Card>

          {taskId && allFeedback.length > 0 && (
            <Card>
              <h3 style={{ marginBottom: 10 }}>All feedback for this task</h3>
              <div className="vstack">
                {allFeedback.map((f) => (
                  <div className="row" key={f.id} style={{ borderRadius: 10 }}>
                    <div className="grow">
                      <div className="title">{f.team_name} {f.score != null && <Badge color="green">{f.score}</Badge>}</div>
                      <div className="desc">{f.feedback || <em>No comment</em>} <span style={{ color: 'var(--muted)' }}>— {f.mentor_name}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}
