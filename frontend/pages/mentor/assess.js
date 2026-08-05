import { useEffect, useRef, useState } from 'react';
import { useRequireRole, useAuth } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import { readDraft, writeDraft, clearDraft } from '../../lib/draft';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge, Avatar, Select, Input, Empty, Segmented } from '../../components/UI';

export default function MentorAssess() {
  const { ok } = useRequireRole(['mentor']);
  const { user } = useAuth();
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [rubrics, setRubrics] = useState(null);
  const [teams, setTeams] = useState([]);
  const [rubricId, setRubricId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [mode, setMode] = useState('individual'); // 'individual' | 'team'
  const [detail, setDetail] = useState(null); // { rubric, students }
  const [scores, setScores] = useState({}); // `${studentId}:${critId}` -> {score, comment}
  const [teamScores, setTeamScores] = useState({}); // `${critId}` -> {score, comment}  (team mode)
  const [busy, setBusy] = useState(false);
  const restored = useRef(false);

  // Local, device-only draft keys (never sent to the server → invisible to admin, uncounted until Save).
  const selKey = user ? `assessSel:${user.id}:${bootcampId}` : null;
  const draftKey = (rid, tid) => (user && rid && tid ? `assessDraft:${user.id}:${bootcampId}:${rid}:${tid}` : null);

  useEffect(() => {
    if (!ok || !bootcampId) return;
    Promise.all([api.get(scoped('/api/rubrics', bootcampId)), api.get(scoped('/api/teams', bootcampId))])
      .then(([r, t]) => { setRubrics(r); setTeams(t); })
      .catch((e) => toast.err(e.message));
  }, [ok, bootcampId]);

  const loadScores = async (rid, tid) => {
    if (!rid || !tid) { setDetail(null); return; }
    try {
      const data = await api.get(`/api/rubrics/${rid}/scores?team=${tid}`);
      setDetail(data);
      const map = {};
      data.scores.forEach((s) => { map[`${s.student_id}:${s.criteria_id}`] = { score: s.score, comment: s.comment || '' }; });
      // Team-level prefill: take any existing member score per criterion (they're identical if saved as a team).
      const tmap = {};
      data.rubric.criteria.forEach((c) => {
        const found = data.scores.find((s) => s.criteria_id === c.id);
        if (found) tmap[c.id] = { score: found.score, comment: found.comment || '' };
      });
      // Overlay any unsaved local draft on top of the saved baseline.
      const draft = readDraft(draftKey(rid, tid));
      setScores(draft?.scores ? { ...map, ...draft.scores } : map);
      setTeamScores(draft?.teamScores ? { ...tmap, ...draft.teamScores } : tmap);
    } catch (e) { toast.err(e.message); }
  };

  // Restore the last rubric/team/mode (and its draft) after an accidental back/navigation.
  useEffect(() => {
    if (!rubrics || restored.current) return;
    restored.current = true;
    const sel = readDraft(selKey);
    if (sel?.rubricId && sel?.teamId) {
      setRubricId(sel.rubricId);
      setTeamId(sel.teamId);
      if (sel.mode) setMode(sel.mode);
      loadScores(sel.rubricId, sel.teamId);
    }
  }, [rubrics]);

  // Remember the current selection.
  useEffect(() => {
    if (!restored.current || !rubricId || !teamId) return;
    writeDraft(selKey, { rubricId, teamId, mode });
  }, [rubricId, teamId, mode]);

  // Auto-save the working scores/comments locally on every change.
  useEffect(() => {
    if (!detail || !rubricId || !teamId) return;
    writeDraft(draftKey(rubricId, teamId), { scores, teamScores });
  }, [scores, teamScores]);

  const onRubric = (v) => { setRubricId(v); loadScores(v, teamId); };
  const onTeam = (v) => { setTeamId(v); loadScores(rubricId, v); };
  const setCell = (sid, cid, key, val) => setScores((m) => ({ ...m, [`${sid}:${cid}`]: { ...m[`${sid}:${cid}`], [key]: val } }));
  const setTeamCell = (cid, key, val) => setTeamScores((m) => ({ ...m, [cid]: { ...m[cid], [key]: val } }));

  const save = async () => {
    // Validate: no score above the criterion max (or below 0).
    const maxOf = {};
    detail.rubric.criteria.forEach((c) => { maxOf[c.id] = Number(c.max_score); });
    const nameOf = {};
    detail.rubric.criteria.forEach((c) => { nameOf[c.id] = c.name; });
    let bad = null;
    const collect = (cid, val) => {
      if (val === '' || val == null) return null;
      const n = Number(val);
      if (Number.isNaN(n) || n < 0 || n > maxOf[cid]) {
        bad = bad || `“${nameOf[cid]}” must be between 0 and ${maxOf[cid]}`;
        return null;
      }
      return n;
    };

    const payload = [];
    // Cells this mentor already has saved — send them even when now empty so a
    // cleared score+comment deletes the old row instead of leaving it behind.
    const existing = new Set((detail.scores || []).map((s) => `${s.student_id}:${s.criteria_id}`));
    // Save a row when there's a score OR a comment (comment-only is allowed);
    // send an empty row when the cell previously existed (→ delete on the server).
    const pushCell = (cid, sid, cell) => {
      const n = collect(cid, cell?.score);
      const comment = (cell?.comment || '').trim();
      if (n != null || comment || existing.has(`${sid}:${cid}`)) {
        payload.push({ criteria_id: cid, student_id: sid, score: n, comment });
      }
    };
    if (mode === 'team') {
      detail.students.forEach((s) => {
        detail.rubric.criteria.forEach((c) => pushCell(c.id, s.id, teamScores[c.id]));
      });
    } else {
      detail.students.forEach((s) => {
        detail.rubric.criteria.forEach((c) => pushCell(c.id, s.id, scores[`${s.id}:${c.id}`]));
      });
    }
    if (bad) { toast.err(bad); return; }

    setBusy(true);
    try {
      await api.post(`/api/rubrics/${rubricId}/scores`, { team_id: Number(teamId), scores: payload });
      clearDraft(draftKey(rubricId, teamId)); // saved to server — drop the local draft
      // Refresh so the other mode reflects the new values.
      await loadScores(rubricId, teamId);
      toast.ok(mode === 'team' ? `Team score saved to all ${detail.students.length} members` : 'Scores saved');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  if (!ok || !rubrics) return <Layout><Loading /></Layout>;

  const overMax = (val, max) => val !== '' && val != null && (Number(val) > Number(max) || Number(val) < 0);
  const scoreStyle = (val, max) =>
    (overMax(val, max) ? { flex: 1, borderColor: 'var(--red)', boxShadow: '0 0 0 3px var(--red-tint)' } : { flex: 1 });

  return (
    <Layout>
      <PageHead title="Assessment" subtitle="Score students against a rubric — you can assess any team" />

      <Card>
        <div className="row-fields">
          <div className="field">
            <label>Rubric</label>
            <Select value={rubricId} onChange={(e) => onRubric(e.target.value)}>
              <option value="">Choose a rubric…</option>
              {rubrics.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </div>
          <div className="field">
            <label>Team</label>
            <Select value={teamId} onChange={(e) => onTeam(e.target.value)}>
              <option value="">Choose a team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>)}
            </Select>
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Assess by</label>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'individual', label: 'Individual members' },
              { value: 'team', label: 'Whole team' },
            ]}
          />
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
            {mode === 'team'
              ? 'Enter one score per criterion — the same score & comment are applied to every team member.'
              : 'Score each team member separately.'}
          </p>
        </div>
      </Card>

      {rubrics.length === 0 && <Card><Empty icon="📋" title="No rubrics" subtitle="Ask an admin to create a rubric." /></Card>}

      {detail && (
        detail.students.length === 0 ? (
          <Card><Empty icon="🧑‍🎓" title="No students on this team" /></Card>
        ) : (
          <>
            {mode === 'team' ? (
              <Card>
                <div className="hstack" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
                  <h3>Team score</h3>
                  <Badge color="blue">{detail.students.length} members</Badge>
                </div>
                <div className="vstack">
                  {detail.rubric.criteria.map((c) => {
                    const cell = teamScores[c.id] || {};
                    return (
                      <div className="hstack" key={c.id} style={{ gap: 10 }}>
                        <div style={{ flex: 2 }}>{c.name} <Badge color="gray">/{c.max_score}</Badge></div>
                        <Input style={scoreStyle(cell.score, c.max_score)} type="number" min={0} max={c.max_score} placeholder="Score"
                          value={cell.score ?? ''} onChange={(e) => setTeamCell(c.id, 'score', e.target.value)} />
                        <Input style={{ flex: 2 }} placeholder="Comment (optional)"
                          value={cell.comment ?? ''} onChange={(e) => setTeamCell(c.id, 'comment', e.target.value)} />
                      </div>
                    );
                  })}
                </div>
                <div className="hstack" style={{ marginTop: 12, gap: 6, flexWrap: 'wrap' }}>
                  {detail.students.map((s) => <Badge key={s.id} color="gray">{s.name}</Badge>)}
                </div>
              </Card>
            ) : (
              detail.students.map((s) => (
                <Card key={s.id}>
                  <div className="hstack" style={{ marginBottom: 12 }}>
                    <Avatar name={s.name} id={s.id} />
                    <div className="grow"><div className="title">{s.name}</div><div className="desc">{s.email}</div></div>
                  </div>
                  <div className="vstack">
                    {detail.rubric.criteria.map((c) => {
                      const cell = scores[`${s.id}:${c.id}`] || {};
                      return (
                        <div className="hstack" key={c.id} style={{ gap: 10 }}>
                          <div style={{ flex: 2 }}>{c.name} <Badge color="gray">/{c.max_score}</Badge></div>
                          <Input style={scoreStyle(cell.score, c.max_score)} type="number" min={0} max={c.max_score} placeholder="Score"
                            value={cell.score ?? ''} onChange={(e) => setCell(s.id, c.id, 'score', e.target.value)} />
                          <Input style={{ flex: 2 }} placeholder="Comment (optional)"
                            value={cell.comment ?? ''} onChange={(e) => setCell(s.id, c.id, 'comment', e.target.value)} />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))
            )}
            <div className="hstack" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : mode === 'team' ? 'Save team score' : 'Save scores'}
              </Button>
              <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                Entries are auto-saved on this device — nothing is submitted or counted until you press Save.
              </span>
            </div>
          </>
        )
      )}
    </Layout>
  );
}
