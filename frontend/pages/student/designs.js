import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import { Card, Button, Loading, useToast, Badge, Empty } from '../../components/UI';
import { renderToDataUrl } from '../../components/DesignCanvas';
import DesignFill from '../../components/DesignFill';

const safeName = (s) => String(s || 'design').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export default function StudentDesigns() {
  const { ok } = useRequireRole(['student']);
  const toast = useToast();

  const [designs, setDesigns] = useState(null);
  const [values, setValues] = useState({});   // designId -> { fieldKey: text }
  const [busy, setBusy] = useState({});
  const [imgBusy, setImgBusy] = useState(null); // field key being uploaded

  const load = async () => {
    const list = await api.get('/api/designs/mine');
    setDesigns(list);
    const v = {};
    list.forEach((d) => { v[d.id] = { ...(d.submission?.values || {}) }; });
    setValues(v);
  };
  useEffect(() => { if (ok) load().catch((e) => toast.err(e.message)); }, [ok]);

  const setVal = (did, key, text) =>
    setValues((s) => ({ ...s, [did]: { ...s[did], [key]: text } }));

  // Image areas upload to the design's own store, not S3, so the exported
  // canvas stays same-origin and untainted.
  const uploadImage = async (d, f, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.err('Please choose an image file'); return; }
    setImgBusy(f.key);
    try {
      const res = await api.uploadTo(`/api/designs/${d.id}/upload-image`, file);
      setVal(d.id, f.key, res.url);
      toast.ok(`${f.label} added — remember to Save`);
    } catch (e) { toast.err(e.message); }
    setImgBusy(null);
  };

  const save = async (d) => {
    const missing = (d.fields || []).filter((f) => f.required && !String(values[d.id]?.[f.key] || '').trim());
    if (missing.length) {
      toast.err(`Please fill in: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setBusy((b) => ({ ...b, [d.id]: true }));
    try {
      await api.post(`/api/designs/${d.id}/submit`, { values: values[d.id] || {} });
      await load();
      toast.ok('Saved');
    } catch (e) { toast.err(e.message); }
    setBusy((b) => ({ ...b, [d.id]: false }));
  };

  const download = async (d) => {
    try {
      const url = await renderToDataUrl(d, values[d.id] || {});
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(d.title)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { toast.err(e.message); }
  };

  if (!ok || designs === null) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead title="Designs" subtitle="Fill in the templates your mentors have assigned" />

      {designs.length === 0 ? (
        <Card><Empty icon="🎨" title="Nothing assigned" subtitle="Designs your mentors assign will appear here." /></Card>
      ) : (
        designs.map((d) => (
          <Card key={d.id} style={{ marginBottom: 14 }}>
            <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap' }}>
              <h3>{d.title}</h3>
              <span>
                {d.submission ? <Badge color="green">Saved</Badge> : <Badge color="orange">Not saved</Badge>}{' '}
                {d.submit_as === 'team' && <Badge color="purple">one per team</Badge>}
              </span>
            </div>
            {d.description && (
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>{d.description}</p>
            )}

            {d.blocked ? (
              <Empty icon="👥" title={d.blocked} />
            ) : (
              <>
                {(d.fields || []).length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
                    This design has no text areas to fill in yet.
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                    Type straight onto the design, and tap an image box to upload a picture. Text shrinks automatically so it always fits.
                  </div>
                )}

                {/* Type directly on the artwork, in place. */}
                <DesignFill
                  design={d}
                  values={values[d.id] || {}}
                  onChange={(key, text) => setVal(d.id, key, text)}
                  onUploadImage={(f, file) => uploadImage(d, f, file)}
                  busyKey={imgBusy}
                />

                <div className="hstack" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Button variant="primary" onClick={() => save(d)} disabled={busy[d.id]}>
                    {busy[d.id] ? 'Saving…' : 'Save'}
                  </Button>
                  <Button onClick={() => download(d)}>⤓ Download PNG</Button>
                  {(d.fields || []).some((f) => f.required) && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Required: {d.fields.filter((f) => f.required).map((f) => f.label).join(', ')}
                    </span>
                  )}
                </div>
                {d.submission && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Last saved {new Date(d.submission.updated_at).toLocaleString('en-IN')}
                  </div>
                )}
              </>
            )}
          </Card>
        ))
      )}
    </Layout>
  );
}
