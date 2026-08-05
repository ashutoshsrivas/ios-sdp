import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../../lib/api';

export default function VerifyCertificate() {
  const router = useRouter();
  const { code } = router.query;
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!code) return;
    api.get(`/api/certificates/verify/${code}`)
      .then((data) => setState({ loading: false, data }))
      .catch((e) => setState({ loading: false, error: e.message }));
  }, [code]);

  const row = (label, value) => value ? (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="kicker" style={{ alignSelf: 'center' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  ) : null;

  const { loading, data, error } = state;
  const issuedOn = data?.issued_at ? new Date(data.issued_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          iOSDC SDP · Certificate Verification
        </div>

        {loading && <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Verifying…</p>}

        {!loading && error && (
          <div style={{ padding: '20px 0' }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>✗</div>
            <h2 style={{ color: 'var(--red)' }}>Not verified</h2>
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>{error === 'No certificate matches this code' ? 'This certificate could not be found. The code may be invalid.' : error}</p>
          </div>
        )}

        {!loading && data && data.revoked && (
          <div style={{ padding: '20px 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--red-tint)', color: 'var(--red)', display: 'grid', placeItems: 'center', fontSize: 34, margin: '8px auto 12px' }}>⦸</div>
            <h2 style={{ color: 'var(--red)' }}>Certificate revoked</h2>
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>
              This certificate{data.name ? ` (issued to ${data.name})` : ''} has been revoked by the iOS Development Centre and is no longer valid.
            </p>
          </div>
        )}

        {!loading && data?.valid && (
          <div>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-tint)', color: 'var(--green)', display: 'grid', placeItems: 'center', fontSize: 34, margin: '8px auto 12px' }}>✓</div>
            <h2 style={{ marginBottom: 2 }}>Certificate verified</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>This is a genuine certificate issued by the iOS Development Centre, GEU.</p>
            <div style={{ textAlign: 'left' }}>
              {row('Issued to', data.name)}
              {row('Program', data.program)}
              {row('Dates', data.date)}
              {row('Issued on', issuedOn)}
              {row('Cohort', data.bootcamp)}
              {row('Serial', data.serial)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
