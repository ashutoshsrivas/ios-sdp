import { useEffect, useState, useMemo, Fragment } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Loading, useToast, Badge, Avatar, Segmented, Select, Modal, Empty, Button,
} from '../../components/UI';

// ---- helpers ----
const num = (v) => (v == null ? 0 : Number(v));
// A row counts numerically only if it actually has a score (comment-only rows don't).
const hasScore = (r) => r && r.score != null && r.score !== '';
function pctOf(rows) {
  if (!rows || !rows.length) return null;
  let obtained = 0, possible = 0;
  rows.forEach((r) => {
    if (!hasScore(r)) return; // a comment without a score is not a zero
    const w = num(r.weight) || 1; obtained += num(r.score) * w; possible += num(r.max_score) * w;
  });
  return possible ? (obtained / possible) * 100 : null;
}
const pctColor = (p) => (p == null ? 'gray' : p >= 75 ? 'green' : p >= 50 ? 'orange' : 'red');
const fmtPct = (p) => (p == null ? '—' : `${Math.round(p * 10) / 10}%`);
const csvPct = (p) => (p == null ? '' : `${Math.round(p * 10) / 10}`);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// ---- CSV export ----
function toCsv(rows) {
  return rows
    .map((r) => r.map((c) => {
      const s = c == null ? '' : String(c);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
}
function slug(s) {
  return (s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}
function downloadCsv(filename, rows) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' }); // BOM → Excel-friendly
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminReports() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('rubrics');
  const [rubricId, setRubricId] = useState('');
  const [detail, setDetail] = useState(null); // { type:'student'|'team', ref }

  useEffect(() => {
    if (!ok || !bootcampId) return;
    setData(null);
    api.get(scoped('/api/reports', bootcampId))
      .then((d) => { setData(d); setRubricId(d.rubrics[0]?.id || ''); })
      .catch((e) => toast.err(e.message));
  }, [ok, bootcampId]);

  const byStudent = useMemo(() => {
    const m = {};
    (data?.scores || []).forEach((s) => { (m[s.student_id] = m[s.student_id] || []).push(s); });
    return m;
  }, [data]);

  if (!ok || !bootcampId || !data) return <Layout><Loading /></Layout>;

  const { teams, students, rubrics, criteria, scores, taskFeedback, teamMentors } = data;
  const studentPct = (id) => pctOf(byStudent[id] || []);
  const teamMembers = (tid) => students.filter((s) => s.team_id === tid);
  const teamOf = (id) => teams.find((t) => t.id === id);
  const sortRows = (rows) => rows.slice().sort((a, b) => a.rubric_id - b.rubric_id || a.criteria_id - b.criteria_id || String(a.mentor_name).localeCompare(String(b.mentor_name)));

  // ---- CSV builders (one row per mentor mark / feedback) ----
  const exportRubricCsv = () => {
    const rubric = rubrics.find((r) => r.id === Number(rubricId));
    const cols = criteria.filter((c) => c.rubric_id === Number(rubricId));
    const header = ['Rubric', 'Student', 'Team', 'Criterion', 'Max Score', 'Weight', 'Mentor', 'Score', 'Remark', 'Student Overall %'];
    const rows = [header];
    students.forEach((s) => {
      const sRows = scores.filter((x) => x.student_id === s.id && x.rubric_id === Number(rubricId));
      if (!sRows.length) return;
      const overall = csvPct(pctOf(sRows));
      cols.forEach((c) => {
        sRows.filter((x) => x.criteria_id === c.id).forEach((r) => {
          rows.push([rubric?.title, s.name, teamOf(s.team_id)?.name || '', c.name, c.max_score, c.weight, r.mentor_name, hasScore(r) ? num(r.score) : "", r.comment || '', overall]);
        });
      });
    });
    downloadCsv(`results-rubric-${slug(rubric?.title)}.csv`, rows);
  };

  const exportStudentsCsv = () => {
    const header = ['Student', 'Team', 'Overall %', 'Rubric', 'Criterion', 'Max Score', 'Weight', 'Mentor', 'Score', 'Remark'];
    const rows = [header];
    students.forEach((s) => {
      const sRows = byStudent[s.id] || [];
      const team = teamOf(s.team_id)?.name || '';
      const overall = csvPct(pctOf(sRows));
      if (!sRows.length) { rows.push([s.name, team, overall, '', '', '', '', '', '', '']); return; }
      sortRows(sRows).forEach((r) => {
        rows.push([s.name, team, overall, rubrics.find((x) => x.id === r.rubric_id)?.title || '', r.criteria_name, r.max_score, r.weight, r.mentor_name, hasScore(r) ? num(r.score) : "", r.comment || '']);
      });
    });
    downloadCsv('results-students.csv', rows);
  };

  const exportTeamsCsv = () => {
    const header = ['Team', 'Team Avg %', 'Type', 'Item', 'Student', 'Criterion', 'Max', 'Mentor', 'Score', 'Comment'];
    const rows = [header];
    teams.forEach((t) => {
      const members = teamMembers(t.id);
      const teamAvg = csvPct(avg(members.map((m) => studentPct(m.id)).filter((x) => x != null)));
      let any = false;
      members.forEach((m) => {
        sortRows(byStudent[m.id] || []).forEach((r) => {
          rows.push([t.name, teamAvg, 'Rubric', rubrics.find((x) => x.id === r.rubric_id)?.title || '', m.name, r.criteria_name, r.max_score, r.mentor_name, hasScore(r) ? num(r.score) : "", r.comment || '']);
          any = true;
        });
      });
      taskFeedback.filter((f) => f.team_id === t.id).forEach((f) => {
        rows.push([t.name, teamAvg, 'Task Feedback', f.task_title, '', '', '', f.mentor_name, f.score == null ? '' : num(f.score), f.feedback || '']);
        any = true;
      });
      if (!any) rows.push([t.name, teamAvg, '', '', '', '', '', '', '', '']);
    });
    downloadCsv('results-teams.csv', rows);
  };

  const exportMatrixCsv = () => {
    const rid = Number(rubricId);
    const rubric = rubrics.find((r) => r.id === rid);
    const cols = criteria.filter((c) => c.rubric_id === rid);
    const mm = {};
    scores.filter((s) => s.rubric_id === rid).forEach((s) => { mm[s.mentor_id] = s.mentor_name; });
    const mentors = Object.entries(mm).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name));
    const maxTotal = cols.reduce((a, c) => a + num(c.max_score), 0);

    const header = ['Student', 'Team'];
    mentors.forEach((m) => {
      cols.forEach((c) => header.push(`${m.name} · ${c.name} (/${c.max_score})`));
      header.push(`${m.name} · Total (/${maxTotal})`);
      header.push(`${m.name} · Remark`);
    });
    header.push(`Total`, 'Average', 'Max Total', 'Percentage %');

    const rows = [header];
    students.forEach((s) => {
      const sRows = scores.filter((x) => x.student_id === s.id && x.rubric_id === rid);
      if (!sRows.length) return;
      const row = [s.name, teamOf(s.team_id)?.name || ''];
      const mentorTotals = [];
      mentors.forEach((m) => {
        cols.forEach((c) => {
          const r = sRows.find((x) => x.mentor_id === m.id && x.criteria_id === c.id);
          row.push(hasScore(r) ? num(r.score) : '');
        });
        const mrs = sRows.filter((x) => x.mentor_id === m.id && hasScore(x));
        const mt = mrs.length ? mrs.reduce((a, x) => a + num(x.score), 0) : null;
        if (mt != null) mentorTotals.push(mt);
        row.push(mt == null ? '' : mt);
        const rem = sRows.filter((x) => x.mentor_id === m.id && x.comment)
          .map((x) => (cols.length > 1 ? `${x.criteria_name}: ${x.comment}` : x.comment)).join(' · ');
        row.push(rem);
      });
      const at = avg(mentorTotals);
      const grand = sRows.reduce((a, x) => a + (hasScore(x) ? num(x.score) : 0), 0);
      row.push(grand, at == null ? '' : Math.round(at * 10) / 10, maxTotal, csvPct(pctOf(sRows)));
      rows.push(row);
    });
    downloadCsv(`results-matrix-${slug(rubric?.title)}.csv`, rows);
  };

  const exportCurrent = () => {
    if (tab === 'rubrics') exportRubricCsv();
    else if (tab === 'matrix') exportMatrixCsv();
    else if (tab === 'teams') exportTeamsCsv();
    else exportStudentsCsv();
  };

  return (
    <Layout>
      <PageHead
        title="Result & remarks"
        subtitle="Assessment analytics — rubric marks, mentor remarks, and team & student stats"
        crumb="Result & remarks"
        actions={<Button onClick={exportCurrent}>⤓ Export {tab === 'rubrics' ? 'rubric' : tab === 'matrix' ? 'matrix' : tab === 'teams' ? 'teams' : 'students'} CSV</Button>}
      />

      <div style={{ marginBottom: 18 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'rubrics', label: 'By Rubric' },
            { value: 'matrix', label: 'Score Matrix' },
            { value: 'teams', label: `Teams (${teams.length})` },
            { value: 'students', label: `Students (${students.length})` },
          ]}
        />
      </div>

      {/* ---------------- BY RUBRIC ---------------- */}
      {tab === 'rubrics' && (
        rubrics.length === 0 ? (
          <Card><Empty icon="📋" title="No rubrics" subtitle="Create a rubric and have mentors score students." /></Card>
        ) : (
          <RubricView
            rubrics={rubrics} rubricId={rubricId} setRubricId={setRubricId}
            criteria={criteria} students={students} scores={data.scores}
            onStudent={(s) => setDetail({ type: 'student', ref: s })}
          />
        )
      )}

      {/* ---------------- SCORE MATRIX ---------------- */}
      {tab === 'matrix' && (
        rubrics.length === 0 ? (
          <Card><Empty icon="📋" title="No rubrics" subtitle="Create a rubric and have mentors score students." /></Card>
        ) : (
          <MatrixView
            rubrics={rubrics} rubricId={rubricId} setRubricId={setRubricId}
            criteria={criteria} students={students} teams={teams} scores={scores}
          />
        )
      )}

      {/* ---------------- TEAMS ---------------- */}
      {tab === 'teams' && (
        teams.length === 0 ? (
          <Card><Empty icon="👥" title="No teams" /></Card>
        ) : (
          <div className="grid cols-2">
            {teams.map((t) => {
              const members = teamMembers(t.id);
              const pcts = members.map((m) => studentPct(m.id)).filter((x) => x != null);
              const teamAvg = avg(pcts);
              const mentors = teamMentors.filter((m) => m.team_id === t.id);
              const fbCount = taskFeedback.filter((f) => f.team_id === t.id).length;
              return (
                <Card key={t.id}>
                  <div className="hstack" style={{ justifyContent: 'space-between' }}>
                    <h3>{t.name}</h3>
                    <Badge color={pctColor(teamAvg)}>{fmtPct(teamAvg)}</Badge>
                  </div>
                  <div className="hstack" style={{ gap: 14, marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>
                    <span>{members.length} members</span>
                    <span>· {pcts.length} scored</span>
                    <span>· {fbCount} task notes</span>
                  </div>
                  {t.spoc_name && <div style={{ marginTop: 8 }}><Badge color="orange">SPOC · {t.spoc_name}</Badge></div>}
                  <div className="hstack" style={{ marginTop: 8 }}>
                    {mentors.length ? mentors.map((m) => <Badge key={m.id} color="blue">{m.name}</Badge>)
                      : <span style={{ color: 'var(--muted)', fontSize: 13 }}>No mentors</span>}
                  </div>
                  {t.remarks && <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic' }}>“{t.remarks}”</p>}
                  <div style={{ marginTop: 12 }}>
                    <Button size="sm" onClick={() => setDetail({ type: 'team', ref: t })}>View details</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ---------------- STUDENTS ---------------- */}
      {tab === 'students' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Student</th><th>Team</th><th>Overall</th><th>Criteria scored</th><th>Mentors</th><th></th></tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const rows = byStudent[s.id] || [];
                const p = pctOf(rows);
                const team = teams.find((t) => t.id === s.team_id);
                const mentorCount = new Set(rows.map((r) => r.mentor_id)).size;
                const critCount = new Set(rows.map((r) => r.criteria_id)).size;
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 550, color: 'var(--text)' }}>{s.name}</td>
                    <td>{team ? <Badge color="purple">{team.name}</Badge> : '—'}</td>
                    <td><Badge color={pctColor(p)}>{fmtPct(p)}</Badge></td>
                    <td>{critCount || '—'}</td>
                    <td>{mentorCount || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" onClick={() => setDetail({ type: 'student', ref: s })} disabled={!rows.length}>Breakdown</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail?.type === 'student' && (
        <Modal title={detail.ref.name} wide onClose={() => setDetail(null)}>
          <StudentBreakdown student={detail.ref} scores={byStudent[detail.ref.id] || []} rubrics={rubrics} criteria={criteria} />
        </Modal>
      )}
      {detail?.type === 'team' && (
        <Modal title={detail.ref.name} wide onClose={() => setDetail(null)}>
          <TeamBreakdown
            team={detail.ref} members={teamMembers(detail.ref.id)}
            studentPct={studentPct} taskFeedback={taskFeedback.filter((f) => f.team_id === detail.ref.id)}
          />
        </Modal>
      )}
    </Layout>
  );
}

// ---- By-rubric matrix ----
function RubricView({ rubrics, rubricId, setRubricId, criteria, students, scores, onStudent }) {
  const rid = Number(rubricId);
  const cols = criteria.filter((c) => c.rubric_id === rid);
  const rowsFor = (sid) => scores.filter((s) => s.student_id === sid && s.rubric_id === rid);
  const cell = (sid, cid) => {
    const ms = scores.filter((s) => s.student_id === sid && s.criteria_id === cid && hasScore(s));
    if (!ms.length) return { avg: null, n: 0 };
    return { avg: avg(ms.map((m) => num(m.score))), n: ms.length };
  };
  const scored = students.filter((s) => rowsFor(s.id).length);

  return (
    <>
      <Card>
        <div className="field" style={{ margin: 0, maxWidth: 420 }}>
          <label>Rubric</label>
          <Select value={rubricId} onChange={(e) => setRubricId(e.target.value)}>
            {rubrics.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select>
        </div>
      </Card>

      {scored.length === 0 ? (
        <Card><Empty icon="📝" title="No scores yet" subtitle="Mentors haven't scored anyone on this rubric." /></Card>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                {cols.map((c) => <th key={c.id}>{c.name} <span style={{ opacity: 0.6 }}>/{c.max_score}</span></th>)}
                <th>Overall</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scored.map((s) => {
                const p = pctOf(rowsFor(s.id));
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 550, color: 'var(--text)' }}>{s.name}</td>
                    {cols.map((c) => {
                      const { avg: a, n } = cell(s.id, c.id);
                      return (
                        <td key={c.id}>
                          {a == null ? <span style={{ color: 'var(--faint)' }}>—</span>
                            : <span>{Math.round(a * 10) / 10}{n > 1 && <span style={{ color: 'var(--muted)', fontSize: 11 }}> ·{n}</span>}</span>}
                        </td>
                      );
                    })}
                    <td><Badge color={pctColor(p)}>{fmtPct(p)}</Badge></td>
                    <td style={{ textAlign: 'right' }}><Button size="sm" onClick={() => onStudent(s)}>Marks & remarks</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- Mentor-wise score matrix ----
function MatrixView({ rubrics, rubricId, setRubricId, criteria, students, teams, scores }) {
  const rid = Number(rubricId);
  const cols = criteria.filter((c) => c.rubric_id === rid);
  const rowsFor = (sid) => scores.filter((s) => s.student_id === sid && s.rubric_id === rid);

  const mm = {};
  scores.filter((s) => s.rubric_id === rid).forEach((s) => { mm[s.mentor_id] = s.mentor_name; });
  const mentors = Object.entries(mm).map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.name.localeCompare(b.name));
  const scored = students.filter((s) => rowsFor(s.id).length);
  const maxTotal = cols.reduce((a, c) => a + num(c.max_score), 0);

  const cell = (sRows, mid, cid) => {
    const r = sRows.find((x) => x.mentor_id === mid && x.criteria_id === cid);
    return hasScore(r) ? num(r.score) : null;
  };
  const remark = (sRows, mid) => sRows.filter((x) => x.mentor_id === mid && x.comment)
    .map((x) => (cols.length > 1 ? `${x.criteria_name}: ${x.comment}` : x.comment)).join(' · ');
  const mentorTotal = (sRows, mid) => {
    const rs = sRows.filter((x) => x.mentor_id === mid && hasScore(x));
    return rs.length ? rs.reduce((a, x) => a + num(x.score), 0) : null;
  };

  return (
    <>
      <Card>
        <div className="field" style={{ margin: 0, maxWidth: 420 }}>
          <label>Rubric</label>
          <Select value={rubricId} onChange={(e) => setRubricId(e.target.value)}>
            {rubrics.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select>
        </div>
      </Card>

      {scored.length === 0 ? (
        <Card><Empty icon="📝" title="No scores yet" subtitle="Mentors haven't scored anyone on this rubric." /></Card>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl matrix">
            <thead>
              <tr>
                <th rowSpan={2}>Student</th>
                <th rowSpan={2}>Team</th>
                {mentors.map((m) => (
                  <th key={m.id} colSpan={cols.length + 2} className="mentor-start" style={{ textAlign: 'center' }}>{m.name}</th>
                ))}
                <th rowSpan={2} className="total-col mentor-start">Total</th>
                <th rowSpan={2}>Average</th>
                <th rowSpan={2}>%</th>
              </tr>
              <tr>
                {mentors.map((m) => (
                  <Fragment key={m.id}>
                    {cols.map((c, ci) => (
                      <th key={c.id} className={ci === 0 ? 'mentor-start' : ''}>{c.name}<span style={{ opacity: 0.5 }}> /{c.max_score}</span></th>
                    ))}
                    <th className="total-col">Total<span style={{ opacity: 0.5 }}> /{maxTotal}</span></th>
                    <th className="remark-col">Remark</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {scored.map((s) => {
                const sRows = rowsFor(s.id);
                const p = pctOf(sRows);
                const totals = mentors.map((m) => mentorTotal(sRows, m.id)).filter((x) => x != null);
                const at = avg(totals);
                const grand = sRows.reduce((a, x) => a + (hasScore(x) ? num(x.score) : 0), 0);
                const team = teams.find((t) => t.id === s.team_id);
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 550, color: 'var(--text)', whiteSpace: 'nowrap' }}>{s.name}</td>
                    <td>{team ? <Badge color="purple">{team.name}</Badge> : '—'}</td>
                    {mentors.map((m) => {
                      const mt = mentorTotal(sRows, m.id);
                      return (
                        <Fragment key={m.id}>
                          {cols.map((c, ci) => {
                            const v = cell(sRows, m.id, c.id);
                            return <td key={c.id} className={ci === 0 ? 'mentor-start' : ''}>{v == null ? <span style={{ color: 'var(--faint)' }}>—</span> : v}</td>;
                          })}
                          <td className="total-cell">{mt == null ? <span style={{ color: 'var(--faint)' }}>—</span> : mt}</td>
                          <td className="remark-cell">{remark(sRows, m.id) || <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                        </Fragment>
                      );
                    })}
                    <td className="total-cell mentor-start" style={{ whiteSpace: 'nowrap' }}>{grand}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{at == null ? '—' : `${Math.round(at * 10) / 10}${maxTotal ? ` / ${maxTotal}` : ''}`}</td>
                    <td><Badge color={pctColor(p)}>{fmtPct(p)}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- Full per-student breakdown: rubric → criterion → each mentor's mark + remark ----
function StudentBreakdown({ student, scores, rubrics, criteria }) {
  if (!scores.length) return <Empty icon="📭" title="No scores recorded for this student" />;
  const rubricIds = [...new Set(scores.map((s) => s.rubric_id))];
  return (
    <div className="vstack" style={{ gap: 18 }}>
      {rubricIds.map((rid) => {
        const rubric = rubrics.find((r) => r.id === rid);
        const rRows = scores.filter((s) => s.rubric_id === rid);
        const cols = criteria.filter((c) => c.rubric_id === rid);
        const p = pctOf(rRows);
        return (
          <div key={rid}>
            <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h3>{rubric?.title || 'Rubric'}</h3>
              <Badge color={pctColor(p)}>{fmtPct(p)}</Badge>
            </div>
            <div className="vstack" style={{ gap: 10 }}>
              {cols.map((c) => {
                const cRows = rRows.filter((s) => s.criteria_id === c.id);
                if (!cRows.length) return null;
                return (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--panel-2)' }}>
                    <div className="hstack" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>{c.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/ {c.max_score}</span></span>
                    </div>
                    <div className="vstack" style={{ gap: 6, marginTop: 8 }}>
                      {cRows.map((r, i) => (
                        <div key={i} className="hstack" style={{ alignItems: 'flex-start', gap: 10 }}>
                          <Badge color="blue">{r.mentor_name}</Badge>
                          <Badge color="gray">{hasScore(r) ? num(r.score) : '—'}/{r.max_score}</Badge>
                          {r.comment && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>“{r.comment}”</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Team detail: members + task feedback ----
function TeamBreakdown({ team, members, studentPct, taskFeedback }) {
  const byTask = {};
  taskFeedback.forEach((f) => { (byTask[f.task_id] = byTask[f.task_id] || { title: f.task_title, items: [] }).items.push(f); });
  return (
    <div className="vstack" style={{ gap: 20 }}>
      {team.remarks && (
        <div>
          <div className="kicker" style={{ marginBottom: 6 }}>Admin remark</div>
          <p style={{ fontStyle: 'italic', color: 'var(--text-2)' }}>“{team.remarks}”</p>
        </div>
      )}
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>Members</div>
        <div className="list">
          {members.length === 0 && <div className="row"><span style={{ color: 'var(--muted)' }}>No members</span></div>}
          {members.map((m) => {
            const p = studentPct(m.id);
            return (
              <div className="row" key={m.id}>
                <Avatar name={m.name} id={m.id} />
                <div className="grow"><div className="title">{m.name} {team.spoc_name === m.name && <Badge color="orange">SPOC</Badge>}</div></div>
                <Badge color={pctColor(p)}>{fmtPct(p)}</Badge>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>Task feedback</div>
        {Object.keys(byTask).length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>No task feedback yet.</p>
        ) : (
          <div className="vstack" style={{ gap: 12 }}>
            {Object.entries(byTask).map(([tid, t]) => (
              <div key={tid} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--panel-2)' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
                <div className="vstack" style={{ gap: 6 }}>
                  {t.items.map((f, i) => (
                    <div key={i} className="hstack" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <Badge color="blue">{f.mentor_name}</Badge>
                      {f.score != null && <Badge color="green">{num(f.score)}</Badge>}
                      {f.feedback && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>“{f.feedback}”</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
