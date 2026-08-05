import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Loading, useToast, Button, Empty, Badge } from '../../components/UI';
import { CertificatePreview, certValues, renderCertificatePng, downloadDataUrl } from '../../components/Certificate';

export default function StudentCertificate() {
  const { ok } = useRequireRole(['student']);
  const toast = useToast();
  const [certs, setCerts] = useState(null);

  useEffect(() => {
    if (!ok) return;
    api.get('/api/certificates/mine').then(setCerts).catch((e) => toast.err(e.message));
  }, [ok]);

  const download = async (c) => {
    try {
      const url = await renderCertificatePng(c.template, certValues(c), 2);
      downloadDataUrl(url, `${(c.values?.name || 'certificate').replace(/[^\w]+/g, '_')}-certificate.png`);
    } catch (e) { toast.err(e.message); }
  };

  if (!ok || !certs) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead title="My Certificate" subtitle="Download your SDP certificate" />
      {certs.length === 0 ? (
        <Card><Empty icon="📜" title="No certificate yet" subtitle="Your certificate will appear here once the organizers issue it." /></Card>
      ) : (
        certs.map((c) => (
          <Card key={c.id}>
            <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h3>{c.template?.name || 'Certificate'} {c.serial && <Badge color="gray">{c.serial}</Badge>} {c.revoked && <Badge color="red">revoked</Badge>}</h3>
              {!c.revoked && <Button variant="primary" onClick={() => download(c)}>⤓ Download PNG</Button>}
            </div>
            {c.revoked
              ? <p style={{ color: 'var(--muted)' }}>This certificate has been revoked and is no longer available for download.</p>
              : <CertificatePreview template={c.template} values={certValues(c)} />}
          </Card>
        ))
      )}
    </Layout>
  );
}
