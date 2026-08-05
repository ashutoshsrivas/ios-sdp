import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Avatar, Segmented, Modal, Field, Input, Select, Empty,
} from '../../components/UI';

const ROLE_COLOR = { admin: 'purple', mentor: 'blue', volunteer: 'green', student: 'orange' };
const ROLES = ['admin', 'mentor', 'volunteer', 'student'];

export default function AdminUsers() {
  const { ok } = useRequireRole(['admin']);
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | {} (new) | user
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => setUsers(await api.get('/api/users'));
  useEffect(() => { if (ok) load().catch((e) => toast.err(e.message)); }, [ok]);

  const openNew = () => { setForm({ role: 'mentor' }); setEditing({}); };
  const openEdit = (u) => { setForm({ ...u, password: '' }); setEditing(u); };

  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      if (editing.id) {
        const body = { name: form.name, email: form.email, phone: form.phone, role: form.role };
        if (form.password) body.password = form.password;
        await api.put(`/api/users/${editing.id}`, body);
        toast.ok('User updated');
      } else {
        await api.post('/api/users', form);
        toast.ok('User created');
      }
      setEditing(null); await load();
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  };

  const remove = async (u) => {
    if (!confirm(`Delete ${u.name}?`)) return;
    try { await api.del(`/api/users/${u.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || !users) return <Layout><Loading /></Layout>;
  const filtered = users.filter((u) => filter === 'all' || u.role === filter);

  return (
    <Layout>
      <PageHead
        title="Users"
        subtitle="Create admins, mentors, volunteers and students"
        actions={<Button variant="primary" onClick={openNew}>+ New User</Button>}
      />

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, ...ROLES.map((r) => ({ value: r, label: `${r[0].toUpperCase()}${r.slice(1)}s` }))]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card><Empty icon="👤" title="No users" /></Card>
      ) : (
        <div className="list">
          {filtered.map((u) => (
            <div className="row" key={u.id}>
              <Avatar name={u.name} id={u.id} />
              <div className="grow">
                <div className="title">{u.name} <Badge color={ROLE_COLOR[u.role]}>{u.role}</Badge></div>
                <div className="desc truncate">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
              </div>
              <Button size="sm" onClick={() => openEdit(u)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(u)}>Delete</Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit User' : 'New User'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{editing.id ? 'Save' : 'Create'}</Button>
          </>}
        >
          <form onSubmit={save}>
            <Field label="Role">
              <Select value={form.role || 'mentor'} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <div className="row-fields">
              <Field label="Full name"><Input required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </div>
            <Field label="Email"><Input type="email" required value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={editing.id ? 'New password (leave blank to keep)' : 'Password'}>
              <Input type="text" required={!editing.id} value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <button type="submit" style={{ display: 'none' }} />
          </form>
        </Modal>
      )}
    </Layout>
  );
}
