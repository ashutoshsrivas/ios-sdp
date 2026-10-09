import { useEffect, useState } from 'react';
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

  // Site-wide upload cap (admins only). A question can override it.
  const [maxUploadMb, setMaxUploadMb] = useState('');
  const [uploadCeiling, setUploadCeiling] = useState(200);
  const [savingUpload, setSavingUpload] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!ok || !isAdmin) return;
    api.get('/api/settings')
      .then((cfg) => {
        setMaxUploadMb(String(cfg?.max_upload_mb ?? 100));
        setUploadCeiling(Number(cfg?.max_upload_mb_ceiling) || 200);
      })
      .catch(() => {});
  }, [ok, isAdmin]);

  const saveUploadLimit = async (e) => {
    e.preventDefault();
    const n = Number(maxUploadMb);
    if (!Number.isFinite(n) || n <= 0) { toast.err('Enter a size in MB greater than zero'); return; }
    if (n > uploadCeiling) { toast.err(`The maximum allowed is ${uploadCeiling} MB`); return; }
    setSavingUpload(true);
    try {
      await api.put('/api/settings/uploads', { maxUploadMb: n });
      toast.ok(`Upload limit set to ${Math.floor(n)} MB`);
    } catch (err) { toast.err(err.message); }
    setSavingUpload(false);
  };

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

        {isAdmin && (
          <Card>
            <h3>File uploads</h3>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>
              The default size limit for every upload — student answers, task
              attachments, highlight photos and app images. An individual
              question can set its own limit instead.
            </p>
            <form onSubmit={saveUploadLimit} style={{ marginTop: 12 }}>
              <Field label="Maximum upload size (MB)">
                <Input
                  type="number"
                  min="1"
                  max={uploadCeiling}
                  value={maxUploadMb}
                  onChange={(e) => setMaxUploadMb(e.target.value)}
                />
              </Field>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Up to {uploadCeiling} MB. Larger files are refused with a clear message
                telling the uploader the limit.
              </div>
              <Button type="submit" variant="primary" disabled={savingUpload}>
                {savingUpload ? 'Saving…' : 'Save upload limit'}
              </Button>
            </form>
          </Card>
        )}

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
