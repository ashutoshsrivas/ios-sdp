import { useState } from 'react';
import { useRequireRole } from '../lib/auth';
import { usePrefs, FONTS } from '../lib/prefs';
import { api } from '../lib/api';
import Layout, { PageHead } from '../components/Layout';
import { Card, Button, Loading, useToast, Field, Input, Segmented } from '../components/UI';

export default function Settings() {
  const { ok, user } = useRequireRole();
  const { theme, setTheme, font, setFont } = usePrefs() || {};
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword.length < 6) { toast.err('New password must be at least 6 characters'); return; }
    if (pw.newPassword !== pw.confirm) { toast.err('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.ok('Password updated');
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  };

  if (!ok) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead title="Settings" subtitle="Personalize your workspace and manage your account" crumb="Settings" />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card>
          <h3 style={{ marginBottom: 6 }}>Appearance</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 18 }}>Saved on this device.</p>

          <Field label="Theme">
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[{ value: 'dark', label: '🌙 Dark' }, { value: 'light', label: '☀️ Light' }]}
            />
          </Field>

          <Field label="Interface font">
            <Segmented
              value={font}
              onChange={setFont}
              options={Object.entries(FONTS).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          </Field>
          <div style={{ marginTop: 14, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--panel-2)' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>The quick brown fox</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>Preview of the selected font · 0123456789</div>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginBottom: 6 }}>Password</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 18 }}>
            {user?.role === 'student' ? 'Your account was created with the default password 12345678 — change it here.' : 'Update your account password.'}
          </p>
          <form onSubmit={changePassword}>
            <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
            <Field label="New password"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></Field>
            <Field label="Confirm new password"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Button>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
