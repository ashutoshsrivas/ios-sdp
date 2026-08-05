import { useEffect, useRef, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp, scoped } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Select, Segmented, Empty, Switch,
} from '../../components/UI';
import {
  bgUrl, SAMPLE, sampleValues, certValues, CertificatePreview, renderCertificatePng,
  renderCertificateDataUrl, templateDims, downloadDataUrl,
} from '../../components/Certificate';

const AUTO_KEYS = ['name', 'serial', 'issued_on', 'verify_url'];
const newField = () => ({ key: 'field', label: 'New field', x: 50, y: 50, size: 5, color: '#111111', align: 'center', bold: true, fontFamily: 'Helvetica, Arial, sans-serif' });
const newQr = () => ({ type: 'qr', key: 'verify_url', label: 'Verify QR', x: 86, y: 82, size: 15, color: '#000000' });
const seedFields = () => ([
  { key: 'name', label: 'Student Name', x: 50, y: 52, size: 6, color: '#111111', align: 'center', bold: true, fontFamily: 'Helvetica, Arial, sans-serif' },
  { key: 'date', label: 'Date', x: 50, y: 30, size: 2.6, color: '#111111', align: 'center', bold: false, fontFamily: 'Helvetica, Arial, sans-serif' },
]);

export default function AdminCertificates() {
  const { ok } = useRequireRole(['admin']);
  const { bootcampId } = useBootcamp() || {};
  const toast = useToast();
  const [tab, setTab] = useState('issue');
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);

  const loadTemplates = () => api.get('/api/certificates/templates').then(setTemplates);
  useEffect(() => { if (ok) loadTemplates().catch((e) => toast.err(e.message)); }, [ok]);

  if (!ok || !templates) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Certificates"
        subtitle="Issue certificates to students and customise the design"
        actions={tab === 'templates' ? <Button variant="primary" onClick={() => setEditing({ name: '', fields: [], _new: true })}>+ New Template</Button> : null}
      />

      <div style={{ marginBottom: 16 }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'issue', label: 'Issue' }, { value: 'templates', label: `Templates (${templates.length})` }]} />
      </div>

      {tab === 'issue'
        ? <IssuePanel templates={templates} bootcampId={bootcampId} toast={toast} onNeedTemplate={() => setTab('templates')} />
        : <TemplatesPanel templates={templates} toast={toast} onEdit={setEditing} onReload={loadTemplates} />}

      {editing && (
        <TemplateEditor
          initial={editing}
          toast={toast}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadTemplates(); }}
        />
      )}
    </Layout>
  );
}

// ================= Issue tab =================
function IssuePanel({ templates, bootcampId, toast, onNeedTemplate }) {
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState({});
  const [students, setStudents] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [issued, setIssued] = useState([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [zipping, setZipping] = useState('');

  const tpl = templates.find((t) => t.id === Number(templateId));
  const promptFields = (tpl?.fields || []).filter((f) => !AUTO_KEYS.includes(f.key));

  // Default to the default (or first) template
  useEffect(() => {
    if (!templateId && templates.length) setTemplateId(String((templates.find((t) => t.is_default) || templates[0]).id));
  }, [templates]);

  useEffect(() => {
    if (!bootcampId) return;
    api.get(scoped('/api/students?status=approved', bootcampId)).then(setStudents).catch((e) => toast.err(e.message));
  }, [bootcampId]);

  const loadIssued = () => {
    if (!bootcampId || !templateId) { setIssued([]); return; }
    api.get(`/api/certificates?bootcamp=${bootcampId}&template=${templateId}`).then(setIssued).catch((e) => toast.err(e.message));
  };
  useEffect(() => { loadIssued(); }, [bootcampId, templateId]);

  const issuedIds = new Set(issued.map((c) => c.student_id));
  const filtered = students.filter((s) => {
    const q = search.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q);
  });
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownSelected = filtered.length > 0 && filtered.every((s) => sel.has(s.id));
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    if (allShownSelected) filtered.forEach((x) => n.delete(x.id));
    else filtered.forEach((x) => n.add(x.id));
    return n;
  });

  const allocate = async () => {
    if (!tpl) { toast.err('Pick a template'); return; }
    if (!sel.size) { toast.err('Select at least one student'); return; }
    const missing = promptFields.find((f) => !values[f.key]?.trim?.());
    if (missing && !confirm(`"${missing.label}" is empty — issue anyway?`)) return;
    setBusy(true);
    try {
      const res = await api.post('/api/certificates/issue', {
        template_id: tpl.id, bootcamp_id: bootcampId, student_ids: [...sel], values,
      });
      toast.ok(`Issued ${res.issued} certificate${res.issued === 1 ? '' : 's'}`);
      setSel(new Set());
      loadIssued();
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const download = async (cert) => {
    try {
      const url = await renderCertificatePng(tpl, certValues(cert), 2);
      downloadDataUrl(url, `${(cert.student_name || 'certificate').replace(/[^\w]+/g, '_')}-certificate.png`);
    } catch (e) { toast.err(e.message); }
  };

  // Render every issued certificate to a PDF (named by student) and bundle into one ZIP.
  const downloadAllZip = async () => {
    if (!tpl || !issued.length) { toast.show('Nothing to export'); return; }
    setZipping(`0/${issued.length}`);
    try {
      const [{ default: JSZip }, { jsPDF }] = await Promise.all([import('jszip'), import('jspdf')]);
      const { w, h } = await templateDims(tpl);
      const zip = new JSZip();
      const used = {};
      for (let i = 0; i < issued.length; i++) {
        const cert = issued[i];
        setZipping(`${i + 1}/${issued.length}`);
        const img = await renderCertificateDataUrl(tpl, certValues(cert), { scale: 1.6, type: 'image/jpeg', quality: 0.94 });
        const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], compress: true });
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        pdf.addImage(img, 'JPEG', 0, 0, pw, ph);
        // Filename = student name, de-duplicated.
        let base = (cert.student_name || 'certificate').replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'certificate';
        used[base] = (used[base] || 0) + 1;
        if (used[base] > 1) base = `${base} (${used[base]})`;
        zip.file(`${base}.pdf`, pdf.output('blob'));
      }
      const out = await zip.generateAsync({ type: 'blob' });
      downloadDataUrl(URL.createObjectURL(out), `certificates-${(tpl.name || 'template').replace(/[^\w.-]+/g, '-')}.zip`);
      toast.ok(`Downloaded ${issued.length} certificate PDF${issued.length === 1 ? '' : 's'}`);
    } catch (e) { toast.err(e.message); }
    setZipping('');
  };

  const toggleRevoke = async (cert) => {
    const revoking = !cert.revoked;
    if (revoking && !confirm(`Revoke ${cert.student_name}'s certificate? Its verification page will show it as revoked (the record is kept).`)) return;
    try {
      await api.post(`/api/certificates/${cert.id}/revoke`, { revoked: revoking });
      toast.ok(revoking ? 'Certificate revoked' : 'Certificate reinstated');
      loadIssued();
    } catch (e) { toast.err(e.message); }
  };

  const removeCert = async (cert) => {
    if (!confirm(`Delete ${cert.student_name}'s certificate permanently? This cannot be undone and its verify link will stop working.`)) return;
    try {
      await api.del(`/api/certificates/${cert.id}`);
      toast.show('Certificate deleted');
      loadIssued();
    } catch (e) { toast.err(e.message); }
  };

  if (!templates.length) {
    return <Card><Empty icon="📜" title="No template yet" subtitle="Create a certificate template first." /><div style={{ textAlign: 'center' }}><Button variant="primary" onClick={onNeedTemplate}>Go to Templates</Button></div></Card>;
  }

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <div className="row-fields">
          <Field label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
            </Select>
          </Field>
          {promptFields.map((f) => (
            <Field key={f.key} label={f.label || f.key}>
              <Input value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.key === 'date' ? 'e.g. 14 July – 17 July 2026' : ''} />
            </Field>
          ))}
        </div>
      </Card>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card>
          <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>Select students <Badge color="blue">{sel.size}</Badge></h3>
            <Button size="sm" onClick={toggleAll}>{allShownSelected ? 'Clear shown' : 'Select all shown'}</Button>
          </div>
          <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="vstack" style={{ maxHeight: 360, overflowY: 'auto', gap: 2 }}>
            {filtered.length === 0 && <p style={{ color: 'var(--muted)' }}>No approved students match.</p>}
            {filtered.map((s) => (
              <label key={s.id} className="row" style={{ cursor: 'pointer', borderRadius: 8 }}>
                <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
                <div className="grow">
                  <div className="title">{s.name} {issuedIds.has(s.id) && <Badge color="green">issued</Badge>}</div>
                  <div className="desc truncate">{s.email}</div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" block onClick={allocate} disabled={busy || !sel.size}>
              {busy ? 'Issuing…' : `Allocate certificate${sel.size ? ` to ${sel.size}` : ''}`}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <h3>Issued <Badge color="gray">{issued.length}</Badge></h3>
            {issued.length > 0 && (
              <Button size="sm" onClick={downloadAllZip} disabled={!!zipping}>
                {zipping ? `Preparing ${zipping}…` : '⤓ All PDFs (ZIP)'}
              </Button>
            )}
          </div>
          {issued.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>No certificates issued for this template yet.</p>
          ) : (
            <div className="vstack" style={{ maxHeight: 420, overflowY: 'auto', gap: 2 }}>
              {issued.map((c) => (
                <div key={c.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div className="title truncate">{c.student_name} {c.revoked ? <Badge color="red">revoked</Badge> : null}</div>
                  <div className="desc truncate">{c.serial || '—'} · {c.issued_at ? String(c.issued_at).slice(0, 10) : ''}</div>
                  <div className="hstack" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                    <Button size="sm" onClick={() => setViewing(c)}>View</Button>
                    <Button size="sm" variant="ghost" onClick={() => download(c)}>⤓ PNG</Button>
                    <Button size="sm" variant={c.revoked ? 'success' : 'ghost'} onClick={() => toggleRevoke(c)}>{c.revoked ? 'Reinstate' : 'Revoke'}</Button>
                    <Button size="sm" variant="danger" onClick={() => removeCert(c)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {viewing && tpl && (
        <Modal title={`Certificate · ${viewing.student_name}`} wide onClose={() => setViewing(null)}
          footer={<><Button onClick={() => setViewing(null)}>Close</Button><Button variant="primary" onClick={() => download(viewing)}>⤓ Download PNG</Button></>}>
          <CertificatePreview template={tpl} values={certValues(viewing)} />
        </Modal>
      )}
    </>
  );
}

// ================= Templates tab =================
function TemplatesPanel({ templates, toast, onEdit, onReload }) {
  const setDefault = async (t) => {
    try { await api.put(`/api/certificates/templates/${t.id}`, { is_default: true }); await onReload(); toast.ok('Default template set'); }
    catch (e) { toast.err(e.message); }
  };
  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"? Issued certificates using it are also removed.`)) return;
    try { await api.del(`/api/certificates/templates/${t.id}`); await onReload(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };
  if (!templates.length) return <Card><Empty icon="🎨" title="No templates" subtitle="Create one to upload your certificate design and place Name/Date fields." /></Card>;
  return (
    <div className="grid cols-2">
      {templates.map((t) => (
        <Card key={t.id}>
          <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>{t.name} {t.is_default && <Badge color="orange">default</Badge>}</h3>
          </div>
          <img src={bgUrl(t)} alt={t.name} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
          <div className="hstack" style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => onEdit(t)}>Edit</Button>
            {!t.is_default && <Button size="sm" onClick={() => setDefault(t)}>Set default</Button>}
            <Button size="sm" variant="ghost" onClick={() => remove(t)}>Delete</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ================= Template editor =================
function TemplateEditor({ initial, toast, onClose, onSaved }) {
  const [name, setName] = useState(initial.name || '');
  const [bg, setBg] = useState(initial.background_url ? { background_url: initial.background_url } : null);
  const [dims, setDims] = useState({ w: initial.width || 0, h: initial.height || 0 });
  const [fields, setFields] = useState(initial.fields?.length ? initial.fields : []);
  const [isDefault, setIsDefault] = useState(!!initial.is_default);
  const [sel, setSel] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });

  const wrapRef = useRef(null);
  const imgRef = useRef(null);

  const measure = () => { const el = imgRef.current; if (el) setDisp({ w: el.clientWidth, h: el.clientHeight }); };
  useEffect(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, []);

  useEffect(() => {
    if (drag == null) return undefined;
    const move = (e) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      setFields((fs) => fs.map((f, i) => (i === drag ? { ...f, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : f)));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]);

  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadTo('/api/certificates/templates/upload-bg', file);
      setBg(res);
      if (!fields.length) setFields(seedFields());
    } catch (e) { toast.err(e.message); }
    setUploading(false);
  };

  const patch = (i, p) => setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...p } : f)));
  const addField = () => { setFields((fs) => [...fs, newField()]); setSel(fields.length); };
  const addQr = () => {
    if (fields.some((x) => x.type === 'qr')) { toast.show('A QR field already exists'); return; }
    setFields((fs) => [...fs, newQr()]); setSel(fields.length);
  };
  const removeField = (i) => { setFields((fs) => fs.filter((_, idx) => idx !== i)); setSel(0); };

  const save = async () => {
    if (!name.trim()) { toast.err('Template name is required'); return; }
    if (!bg?.background_url) { toast.err('Upload a background image'); return; }
    setBusy(true);
    try {
      const path = bg.background_path || bg.background_url.split('/').pop();
      const body = { name: name.trim(), background_path: path, width: dims.w || null, height: dims.h || null, fields, is_default: isDefault };
      if (initial._new) await api.post('/api/certificates/templates', body);
      else await api.put(`/api/certificates/templates/${initial.id}`, body);
      toast.ok('Template saved');
      onSaved();
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const f = fields[sel];

  return (
    <Modal title={initial._new ? 'New Certificate Template' : `Edit · ${initial.name}`} wide onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || uploading}>{busy ? 'Saving…' : 'Save template'}</Button></>}>
      <div className="row-fields">
        <Field label="Template name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SDP Completion" /></Field>
        <Field label="Background image">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onUpload(e.target.files?.[0])} />
          {uploading && <span style={{ color: 'var(--muted)', fontSize: 12 }}> uploading…</span>}
        </Field>
      </div>

      {!bg ? (
        <Empty icon="🖼️" title="Upload your certificate design" subtitle="A blank PNG/JPG with space for the name and date. Then drag the fields onto it." />
      ) : (
        <>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>Drag a field to position it. Values shown are samples.</p>
          <div ref={wrapRef} style={{ position: 'relative', width: '100%', userSelect: 'none', lineHeight: 1 }}>
            <img
              ref={imgRef}
              src={bgUrl(bg)}
              alt="template"
              onLoad={(e) => { setDims({ w: e.target.naturalWidth, h: e.target.naturalHeight }); measure(); }}
              style={{ width: '100%', display: 'block', borderRadius: 8, border: '1px solid var(--border)' }}
            />
            {fields.map((fld, i) => {
              const common = {
                key: i,
                onPointerDown: (e) => { e.preventDefault(); setSel(i); setDrag(i); },
                title: fld.label,
              };
              if (fld.type === 'qr') {
                const side = ((Number(fld.size) || 15) / 100) * (disp.h || 700);
                return (
                  <div {...common} style={{
                    position: 'absolute', left: `${fld.x}%`, top: `${fld.y}%`,
                    transform: 'translate(-50%, -50%)', width: side, height: side,
                    display: 'grid', placeItems: 'center', cursor: 'move', touchAction: 'none',
                    background: '#fff', color: '#000', fontSize: Math.max(9, side * 0.18),
                    border: `1px solid ${fld.color || '#000'}`,
                    outline: i === sel ? '2px dashed var(--accent)' : '1px dashed rgba(0,0,0,0.25)',
                  }}>QR</div>
                );
              }
              const tx = fld.align === 'center' ? '-50%' : fld.align === 'right' ? '-100%' : '0';
              return (
                <div {...common} style={{
                  position: 'absolute', left: `${fld.x}%`, top: `${fld.y}%`,
                  transform: `translate(${tx}, -50%)`,
                  fontSize: `${((Number(fld.size) || 5) / 100) * (disp.h || 700)}px`,
                  fontWeight: fld.bold ? 700 : 400,
                  fontFamily: fld.fontFamily || 'Helvetica, Arial, sans-serif',
                  color: fld.color || '#111',
                  whiteSpace: 'nowrap', cursor: 'move', padding: '0 2px', touchAction: 'none',
                  outline: i === sel ? '2px dashed var(--accent)' : '1px dashed rgba(0,0,0,0.25)',
                }}>
                  {SAMPLE[fld.key] ?? fld.label}
                </div>
              );
            })}
          </div>

          <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
            <div>
              <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="kicker">Fields</span>
                <div className="hstack" style={{ gap: 6 }}>
                  <Button size="sm" onClick={addField}>+ Field</Button>
                  <Button size="sm" onClick={addQr}>+ QR code</Button>
                </div>
              </div>
              <div className="vstack" style={{ gap: 4 }}>
                {fields.map((fld, i) => (
                  <div key={i} className={`row ${i === sel ? 'active' : ''}`} style={{ borderRadius: 8, cursor: 'pointer', outline: i === sel ? '1px solid var(--accent-border)' : 'none' }} onClick={() => setSel(i)}>
                    <div className="grow"><div className="title">{fld.label} {fld.type === 'qr' && <Badge color="purple">QR</Badge>}</div><div className="desc">key: {fld.key}</div></div>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeField(i); }}>✕</Button>
                  </div>
                ))}
              </div>
            </div>

            {f && f.type === 'qr' && (
              <div>
                <span className="kicker">Verify QR</span>
                <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 8px' }}>
                  Encodes a unique public link. Scanning it opens the certificate's verification page (no login) showing who it was issued to and when.
                </p>
                <Field label="Label"><Input value={f.label || ''} onChange={(e) => patch(sel, { label: e.target.value })} /></Field>
                <div className="row-fields">
                  <Field label={`Size (${f.size}% of height)`}><input type="range" min="4" max="30" step="0.5" value={f.size} onChange={(e) => patch(sel, { size: Number(e.target.value) })} style={{ width: '100%' }} /></Field>
                  <Field label="Colour"><input type="color" value={f.color || '#000000'} onChange={(e) => patch(sel, { color: e.target.value })} style={{ width: 48, height: 32, background: 'none', border: 'none' }} /></Field>
                </div>
              </div>
            )}
            {f && f.type !== 'qr' && (
              <div>
                <span className="kicker">Selected field</span>
                <div className="row-fields" style={{ marginTop: 6 }}>
                  <Field label="Label"><Input value={f.label || ''} onChange={(e) => patch(sel, { label: e.target.value })} /></Field>
                  <Field label="Key (name / date / serial / issued_on / custom)"><Input value={f.key || ''} onChange={(e) => patch(sel, { key: e.target.value.trim() })} /></Field>
                </div>
                <div className="row-fields">
                  <Field label={`Size (${f.size}% of height)`}><input type="range" min="1" max="15" step="0.2" value={f.size} onChange={(e) => patch(sel, { size: Number(e.target.value) })} style={{ width: '100%' }} /></Field>
                  <Field label="Colour"><input type="color" value={f.color || '#111111'} onChange={(e) => patch(sel, { color: e.target.value })} style={{ width: 48, height: 32, background: 'none', border: 'none' }} /></Field>
                </div>
                <div className="row-fields">
                  <Field label="Align">
                    <Select value={f.align} onChange={(e) => patch(sel, { align: e.target.value })}>
                      <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                    </Select>
                  </Field>
                  <Field label="Bold"><div style={{ paddingTop: 6 }}><Switch checked={!!f.bold} onChange={(v) => patch(sel, { bold: v })} /></div></Field>
                </div>
              </div>
            )}
          </div>

          <div className="hstack" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <Switch checked={isDefault} onChange={setIsDefault} label="Set as default template" />
          </div>

          <div style={{ marginTop: 14 }}>
            <span className="kicker">Live preview</span>
            <div style={{ marginTop: 6 }}><CertificatePreview template={{ ...bg, width: dims.w, height: dims.h, fields }} values={sampleValues()} /></div>
          </div>
        </>
      )}
    </Modal>
  );
}
