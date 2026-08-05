import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth, HOME_FOR_ROLE } from '../lib/auth';
import { Card, Field, Input, Button, useToast } from '../components/UI';

export default function Login() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(HOME_FOR_ROLE[user.role] || '/');
  }, [user, loading, router]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      toast.err(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="brand-badge" style={{ width: 52, height: 52, margin: '0 auto 16px' }}>
            <span className="brand-dot a" /><span className="brand-dot b" /><span className="brand-dot c" />
          </div>
          <h1 style={{ fontSize: 27 }}>iOSDC<span style={{ color: 'var(--accent-text)' }}> SDP</span></h1>
          <p style={{ color: 'var(--muted)', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Sign in to continue</p>
        </div>
        <Card>
          <form onSubmit={submit}>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </Field>
            <Button variant="primary" block type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </Card>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Accounts are created by an administrator.
        </p>
      </div>
    </div>
  );
}
