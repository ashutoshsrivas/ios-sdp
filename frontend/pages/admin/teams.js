import { useEffect, useState, useCallback } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Select, Empty, Textarea, Switch,
} from '../../components/UI';

// Table IDs: A..Y, each with MIN and MAX (A-MIN, A-MAX, B-MIN, …). Mirrors the backend.
const TABLE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
const letterAt = (i) => (i < 25 ? TABLE_ALPHABET[i] : TABLE_ALPHABET[Math.floor((i - 25) / 25)] + TABLE_ALPHABET[(i - 25) % 25]);
function tableIdSequence(count) {
  const ids = [];
  for (let i = 0; ids.length < count; i++) {
    ids.push(`${letterAt(i)}-MIN`);
    if (ids.length < count) ids.push(`${letterAt(i)}-MAX`);
  }
  return ids;
}

export default function AdminTeams() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [teams, setTeams] = useState(null);
  const [pool, setPool] = useState([]);
  const [approved, setApproved] = useState([]);
  const [mentors, setMentors] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [hover, setHover] = useState(null); // 'pool' | team id
  const [autoOpen, setAutoOpen] = useState(false);
  const [assignStudents, setAssignStudents] = useState(true);
  const [teamSize, setTeamSize] = useState(4);
  const [teamCount, setTeamCount] = useState(4);
  const [reset, setReset] = useState(false);
  const [mentorModal, setMentorModal] = useState(null); // team object
  const [addModal, setAddModal] = useState(null); // team object — search & add students
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bootcampId) return;
    const [t, p, m, ap] = await Promise.all([
      api.get(scoped('/api/teams', bootcampId)),
      api.get(scoped('/api/students?unassigned=1', bootcampId)),
      api.get('/api/users?role=mentor'),
      api.get(scoped('/api/students?status=approved', bootcampId)),
    ]);
    setTeams(t); setPool(p); setMentors(m); setApproved(ap);
  }, [bootcampId]);

  useEffect(() => { if (ok && bootcampId) load().catch((e) => toast.err(e.message)); }, [ok, load, bootcampId]);

  const moveToTeam = async (studentId, teamId) => {
    try { await api.post(`/api/teams/${teamId}/members`, { studentId }); await load(); }
    catch (e) { toast.err(e.message); }
  };
  const moveToPool = async (studentId, fromTeamId) => {
    try { await api.del(`/api/teams/${fromTeamId}/members/${studentId}`); await load(); }
    catch (e) { toast.err(e.message); }
  };

  const onDrop = (target) => {
    setHover(null);
    if (dragId == null) return;
    const { id, teamId } = dragId;
    if (target === 'pool') { if (teamId) moveToPool(id, teamId); }
    else if (target !== teamId) moveToTeam(id, target);
    setDragId(null);
  };

  const autoCreate = async () => {
    setBusy(true);
    try {
      const body = { reset, bootcamp_id: bootcampId, assignStudents };
      if (assignStudents) body.teamSize = Number(teamSize);
      else body.teamCount = Number(teamCount);
      const res = await api.post('/api/teams/auto', body);
      setAutoOpen(false);
      await load();
      toast.ok(
        res.created
          ? `Created ${res.created} team${res.created === 1 ? '' : 's'}${res.placed ? ` · placed ${res.placed} students` : ' (empty)'}`
          : (res.message || 'Done')
      );
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const addTeam = async () => {
    const name = prompt('Team name');
    if (!name) return;
    try { await api.post('/api/teams', { name, bootcamp_id: bootcampId }); await load(); } catch (e) { toast.err(e.message); }
  };
  const delTeam = async (t) => {
    if (!confirm(`Delete ${t.name}? Members return to the pool.`)) return;
    try { await api.del(`/api/teams/${t.id}`); await load(); } catch (e) { toast.err(e.message); }
  };
  const setSpoc = async (teamId, studentId) => {
    try { await api.put(`/api/teams/${teamId}/spoc`, { studentId: studentId || null }); await load(); toast.ok('SPOC updated'); }
    catch (e) { toast.err(e.message); }
  };
  const saveMentors = async (teamId, mentorIds) => {
    try { await api.put(`/api/teams/${teamId}/mentors`, { mentorIds }); setMentorModal(null); await load(); toast.ok('Mentors updated'); }
    catch (e) { toast.err(e.message); }
  };
  const saveRemark = async (teamId, remarks) => {
    try { await api.put(`/api/teams/${teamId}`, { remarks }); await load(); toast.ok('Remark saved'); }
    catch (e) { toast.err(e.message); }
  };
  const setTable = async (teamId, tableId) => {
    try { await api.put(`/api/teams/${teamId}/table`, { tableId: tableId || null }); await load(); }
    catch (e) { toast.err(e.message); }
  };
  const assignTables = async () => {
    if (!confirm('Re-number all table IDs in team order? This overwrites current table IDs.')) return;
    try { await api.post('/api/teams/assign-tables', { bootcamp_id: bootcampId, reset: true }); await load(); toast.ok('Table IDs assigned'); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || !teams) return <Layout><Loading /></Layout>;

  // Table-ID options: the full set A-MIN … Y-MAX (50), plus any custom ones already in use.
  const baseSeq = tableIdSequence(50);
  const tableOptions = [...baseSeq, ...teams.map((t) => t.table_id).filter((id) => id && !baseSeq.includes(id))];

  // One row per member; empty teams still get a row so the sheet shows every team.
  const exportCsv = () => {
    if (!teams.length) { toast.show('No teams to export'); return; }
    const header = ['S.No', 'Team', 'Table', 'Member', 'Email', 'Role', 'Mentors', 'Remark'];
    const rows = [];
    let n = 0;
    teams.forEach((t) => {
      const mentorNames = t.mentors.map((m) => m.name).join('; ');
      if (t.members.length === 0) {
        rows.push([++n, t.name, t.table_id || '', '', '', '', mentorNames, t.remarks || '']);
      } else {
        t.members.forEach((m) => {
          rows.push([
            ++n, t.name, t.table_id || '', m.name, m.email || '',
            t.spoc_student_id === m.id ? 'SPOC' : 'Member', mentorNames, t.remarks || '',
          ]);
        });
      }
    });
    downloadCsv('teams.csv', [header, ...rows]);
  };

  const chip = (s, teamId) => (
    <div
      key={s.id}
      className={`chip ${dragId?.id === s.id ? 'dragging' : ''} ${teamId && teams.find((t) => t.id === teamId)?.spoc_student_id === s.id ? 'spoc' : ''}`}
      draggable
      onDragStart={() => setDragId({ id: s.id, teamId })}
      onDragEnd={() => setDragId(null)}
    >
      <span className="grow truncate">{s.name}</span>
      {teamId && teams.find((t) => t.id === teamId)?.spoc_student_id === s.id && <Badge color="orange">SPOC</Badge>}
    </div>
  );

  return (
    <Layout>
      <PageHead
        title="Teams"
        subtitle="Auto-build teams, then drag students between them"
        actions={
          <>
            {teams.length > 0 && <Button onClick={exportCsv}>⤓ Export CSV</Button>}
            {teams.length > 0 && <Button onClick={assignTables}>⤵ Assign tables</Button>}
            <Button onClick={addTeam}>+ New Team</Button>
            <Button variant="primary" onClick={() => setAutoOpen(true)}>Auto-create Teams</Button>
          </>
        }
      />

      {/* Unassigned pool */}
      <Card
        className={hover === 'pool' ? 'team-col drop-hover' : ''}
        onDragOver={(e) => { e.preventDefault(); setHover('pool'); }}
        onDragLeave={() => setHover(null)}
        onDrop={() => onDrop('pool')}
      >
        <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3>Unassigned Pool</h3>
          <Badge color="blue">{pool.length}</Badge>
        </div>
        {pool.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>All approved students are on a team. Drag a chip here to remove.</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {pool.map((s) => chip(s, null))}
          </div>
        )}
      </Card>

      {teams.length === 0 ? (
        <Card><Empty icon="👥" title="No teams yet" subtitle="Use Auto-create Teams to generate them from approved students." /></Card>
      ) : (
        <div className="team-board">
          {teams.map((t) => (
            <div
              key={t.id}
              className={`team-col ${hover === t.id ? 'drop-hover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setHover(t.id); }}
              onDragLeave={() => setHover(null)}
              onDrop={() => onDrop(t.id)}
            >
              <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <h3>{t.name}</h3>
                <div className="hstack" style={{ gap: 6 }}>
                  {t.table_id && <Badge color="orange">{t.table_id}</Badge>}
                  <Badge color="gray">{t.members.length}</Badge>
                </div>
              </div>

              <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="kicker">Table</span>
                <Select
                  value={t.table_id || ''}
                  onChange={(e) => setTable(t.id, e.target.value)}
                  style={{ maxWidth: 150, padding: '6px 10px', fontSize: 13 }}
                >
                  <option value="">— none —</option>
                  {tableOptions.map((id) => <option key={id} value={id}>{id}</option>)}
                </Select>
              </div>

              <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="kicker">Members</span>
                <Button size="sm" onClick={() => setAddModal(t)}>+ Add</Button>
              </div>
              <div style={{ minHeight: 30 }}>
                {t.members.length === 0
                  ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Drop students here, or use + Add</p>
                  : t.members.map((m) => chip(m, t.id))}
              </div>

              <div className="divider" />

              <Field label="SPOC">
                <Select value={t.spoc_student_id || ''} onChange={(e) => setSpoc(t.id, e.target.value)}>
                  <option value="">— none —</option>
                  {t.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>

              <div className="field">
                <label>Mentors</label>
                <div className="hstack">
                  {t.mentors.length === 0
                    ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>None assigned</span>
                    : t.mentors.map((m) => <Badge key={m.id} color="blue">{m.name}</Badge>)}
                </div>
              </div>

              <TeamRemark team={t} onSave={saveRemark} />

              <div className="hstack" style={{ marginTop: 10 }}>
                <Button size="sm" onClick={() => setMentorModal(t)}>Assign mentors</Button>
                <Button size="sm" variant="ghost" onClick={() => delTeam(t)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {autoOpen && (
        <Modal
          title="Auto-create Teams"
          onClose={() => setAutoOpen(false)}
          footer={<>
            <Button onClick={() => setAutoOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={autoCreate} disabled={busy}>{busy ? 'Building…' : 'Create'}</Button>
          </>}
        >
          <div style={{ marginBottom: 16 }}>
            <Switch checked={assignStudents} onChange={setAssignStudents} label="Assign students to teams" />
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
              {assignStudents
                ? 'Approved students are distributed into balanced teams automatically.'
                : 'Create empty teams only — you’ll drag students in from the Unassigned Pool yourself.'}
            </p>
          </div>

          {assignStudents ? (
            <Field label="Team size (students per team)">
              <Input type="number" min={1} value={teamSize} onChange={(e) => setTeamSize(e.target.value)} />
            </Field>
          ) : (
            <Field label="Number of teams to create">
              <Input type="number" min={1} value={teamCount} onChange={(e) => setTeamCount(e.target.value)} />
            </Field>
          )}

          <label className="hstack" style={{ cursor: 'pointer', fontSize: 14 }}>
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
            Reset — clear existing teams first
          </label>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
            {reset
              ? 'All current teams in this cohort are deleted first (students return to the pool).'
              : assignStudents
                ? 'Only students not already on a team are placed into new balanced teams.'
                : 'New empty teams are added alongside any existing teams.'}
          </p>
        </Modal>
      )}

      {mentorModal && (
        <MentorPicker
          team={mentorModal}
          mentors={mentors}
          onSave={saveMentors}
          onClose={() => setMentorModal(null)}
        />
      )}

      {addModal && (
        <AddMemberModal
          team={teams.find((t) => t.id === addModal.id) || addModal}
          students={approved}
          onAdd={(studentId) => moveToTeam(studentId, addModal.id)}
          onClose={() => setAddModal(null)}
        />
      )}
    </Layout>
  );
}

function TeamRemark({ team, onSave }) {
  const [value, setValue] = useState(team.remarks || '');
  const dirty = (value || '') !== (team.remarks || '');
  return (
    <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
      <label>Remark</label>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notes about this team…"
        style={{ minHeight: 60, fontSize: 13 }}
      />
      {dirty && (
        <div className="hstack" style={{ marginTop: 6 }}>
          <Button size="sm" variant="primary" onClick={() => onSave(team.id, value)}>Save remark</Button>
          <Button size="sm" variant="ghost" onClick={() => setValue(team.remarks || '')}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function AddMemberModal({ team, students, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const list = students
    .filter((s) => !term || s.name.toLowerCase().includes(term) || (s.email || '').toLowerCase().includes(term))
    .slice(0, 60);
  return (
    <Modal
      title={`Add students · ${team.name}`}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <Field label="Search approved students">
        <Input autoFocus placeholder="Name or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      {list.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          {students.length === 0 ? 'No approved students in this cohort yet.' : 'No approved students match your search.'}
        </p>
      ) : (
        <div className="vstack" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {list.map((s) => {
            const onThis = s.team_id === team.id;
            const onOther = s.team_id && s.team_id !== team.id;
            return (
              <div key={s.id} className="row" style={{ borderRadius: 10 }}>
                <div className="grow">
                  <div className="title">{s.name}</div>
                  <div className="desc">{s.email}{onOther ? ` · on ${s.team_name}` : ''}</div>
                </div>
                {onThis
                  ? <Badge color="green">On this team</Badge>
                  : <Button size="sm" variant={onOther ? 'ghost' : 'primary'} onClick={() => onAdd(s.id)}>{onOther ? 'Move here' : 'Add'}</Button>}
              </div>
            );
          })}
        </div>
      )}
      {students.length > 60 && !term && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Showing first 60 — type to search the rest.</p>
      )}
    </Modal>
  );
}

function MentorPicker({ team, mentors, onSave, onClose }) {
  const [selected, setSelected] = useState(team.mentors.map((m) => m.id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal
      title={`Mentors · ${team.name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(team.id, selected)}>Save</Button>
      </>}
    >
      {mentors.length === 0 && <p style={{ color: 'var(--muted)' }}>No mentors yet. Create some under Users.</p>}
      <div className="vstack">
        {mentors.map((m) => (
          <label key={m.id} className="row" style={{ cursor: 'pointer', borderRadius: 10 }}>
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
            <div className="grow">
              <div className="title">{m.name}</div>
              <div className="desc">{m.email}</div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
