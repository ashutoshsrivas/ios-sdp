import { useEffect, useRef, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { useBootcamp } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Select, Empty, Switch,
} from '../../components/UI';
import DesignCanvas, { renderToDataUrl, bgUrl } from '../../components/DesignCanvas';

// Resize handles: eight compass points, positioned on the box's edges.
const HANDLES = [
  { mode: 'nw', cursor: 'nwse-resize', pos: { left: -6, top: -6 } },
  { mode: 'n',  cursor: 'ns-resize',   pos: { left: 'calc(50% - 5px)', top: -6 } },
  { mode: 'ne', cursor: 'nesw-resize', pos: { right: -6, top: -6 } },
  { mode: 'e',  cursor: 'ew-resize',   pos: { right: -6, top: 'calc(50% - 5px)' } },
  { mode: 'se', cursor: 'nwse-resize', pos: { right: -6, bottom: -6 } },
  { mode: 's',  cursor: 'ns-resize',   pos: { left: 'calc(50% - 5px)', bottom: -6 } },
  { mode: 'sw', cursor: 'nesw-resize', pos: { left: -6, bottom: -6 } },
  { mode: 'w',  cursor: 'ew-resize',   pos: { left: -6, top: 'calc(50% - 5px)' } },
];

const newField = (n, type = 'text') => ({
  type,
  fit: 'cover',
  key: `field_${n}`,
  label: type === 'image' ? `Image ${n}` : `Text area ${n}`,
  placeholder: '',
  x: 10, y: 10, w: 40, h: 15,
  fontSize: 20, lineHeight: 1.35,
  color: '#111111', align: 'left', bold: false,
  fontFamily: 'Helvetica, Arial, sans-serif',
  maxLength: 500, required: false,
});

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const safeName = (s) => String(s || 'design').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export default function AdminDesigns() {
  const { ok, user } = useRequireRole(['admin', 'mentor']);
  const { bootcampId, bootcamps } = useBootcamp() || {};
  const toast = useToast();

  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);   // design being authored
  const [form, setForm] = useState(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(null); // {design, submissions}
  const [drag, setDrag] = useState(null);
  const stageRef = useRef(null);

  const load = async () => {
    if (!bootcampId) { setItems([]); return; }
    try { setItems(await api.get(`/api/designs?bootcamp=${bootcampId}`)); }
    catch (e) { toast.err(e.message); setItems([]); }
  };
  useEffect(() => { if (ok) load(); }, [ok, bootcampId]);

  // ---- authoring ----
  const openNew = () => {
    setForm({
      title: '', description: '', background_path: '', background_url: '',
      width: null, height: null, fields: [], submit_as: 'student', assigned: false,
    });
    setSel(0);
    setEditing({});
  };

  const openEdit = (d) => {
    setForm({
      title: d.title, description: d.description || '',
      background_path: '', background_url: d.background_url,
      width: d.width, height: d.height,
      fields: d.fields || [], submit_as: d.submit_as, assigned: d.assigned,
    });
    setSel(0);
    setEditing(d);
  };

  const uploadBg = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.err('Please choose an image file'); return; }
    setUploading(true);
    try {
      // Read the natural size so the saved layout renders at the image's own
      // resolution rather than a guess.
      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: null, height: null });
        img.src = URL.createObjectURL(file);
      });
      const res = await api.uploadTo('/api/designs/upload-bg', file);
      setForm((f) => ({ ...f, ...dims, background_path: res.background_path, background_url: res.background_url }));
      toast.ok('Background uploaded');
    } catch (e) { toast.err(e.message); }
    setUploading(false);
  };

  const patchField = (i, p) =>
    setForm((f) => ({ ...f, fields: f.fields.map((x, idx) => (idx === i ? { ...x, ...p } : x)) }));
  const addField = (type = 'text') =>
    setForm((f) => { const n = f.fields.length + 1; setSel(f.fields.length); return { ...f, fields: [...f.fields, newField(n, type)] }; });
  const removeField = (i) =>
    setForm((f) => ({ ...f, fields: f.fields.filter((_, idx) => idx !== i) }));

  /**
   * Move or resize a box by pointer. `drag` is {i, mode, startX, startY, orig}
   * where mode is 'move' or a compass edge ('n','se',…).
   *
   * Everything is computed from the ORIGINAL geometry plus the total pointer
   * delta, not incrementally from the current value — incremental updates
   * accumulate rounding error and the box creeps as you drag.
   */
  const beginDrag = (e, i, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    setSel(i);
    setDrag({
      i,
      mode,
      startX: ((e.clientX - r.left) / r.width) * 100,
      startY: ((e.clientY - r.top) / r.height) * 100,
      orig: { ...form.fields[i] },
    });
  };

  useEffect(() => {
    if (!drag) return undefined;
    const MIN = 3; // percent — small enough to be useful, big enough to grab
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const round = (v) => Math.round(v * 10) / 10;

    const move = (e) => {
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      const dx = ((e.clientX - r.left) / r.width) * 100 - drag.startX;
      const dy = ((e.clientY - r.top) / r.height) * 100 - drag.startY;
      const o = drag.orig;
      const m = drag.mode;
      let { x, y, w, h } = o;

      if (m === 'move') {
        x = o.x + dx;
        y = o.y + dy;
      } else {
        // Dragging a north/west edge moves the origin as well as the size.
        if (m.includes('e')) w = o.w + dx;
        if (m.includes('s')) h = o.h + dy;
        if (m.includes('w')) { w = o.w - dx; x = o.x + dx; }
        if (m.includes('n')) { h = o.h - dy; y = o.y + dy; }

        // Hitting the minimum must pin the edge being dragged, not flip the box.
        if (w < MIN) { if (m.includes('w')) x = o.x + o.w - MIN; w = MIN; }
        if (h < MIN) { if (m.includes('n')) y = o.y + o.h - MIN; h = MIN; }
      }

      // Keep the whole box on the background. Which value gives way depends on
      // the gesture: moving preserves the size and pins the position, resizing
      // pins the origin and truncates the size. Clamping size first on a resize
      // would drag the opposite edge along — pulling the east edge right would
      // shunt the west edge left once it maxed out.
      if (m === 'move') {
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);
      } else {
        x = clamp(x, 0, 100 - MIN);
        y = clamp(y, 0, 100 - MIN);
        w = clamp(w, MIN, 100 - x);
        h = clamp(h, MIN, 100 - y);
      }

      patchField(drag.i, { x: round(x), y: round(y), w: round(w), h: round(h) });
    };

    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag]);

  const save = async () => {
    if (!form.title.trim()) { toast.err('Title is required'); return; }
    if (!editing.id && !form.background_path) { toast.err('Upload a background image first'); return; }
    setBusy(true);
    try {
      const body = { ...form, bootcamp_id: bootcampId };
      if (!form.background_path) delete body.background_path;
      if (editing.id) await api.put(`/api/designs/${editing.id}`, body);
      else await api.post('/api/designs', body);
      setEditing(null);
      await load();
      toast.ok(editing.id ? 'Design updated' : 'Design created');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const toggleAssigned = async (d) => {
    try {
      await api.put(`/api/designs/${d.id}`, { assigned: !d.assigned });
      await load();
      toast.show(d.assigned ? 'Withdrawn from students' : 'Assigned to the cohort');
    } catch (e) { toast.err(e.message); }
  };

  const remove = async (d) => {
    if (!confirm(`Delete "${d.title}" and every submission? This cannot be undone.`)) return;
    try { await api.del(`/api/designs/${d.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  // ---- review + download ----
  const openReview = async (d) => {
    try { setReviewing(await api.get(`/api/designs/${d.id}/submissions`)); }
    catch (e) { toast.err(e.message); }
  };

  const who = (s) => s.team_name || s.student_name || 'Unknown';

  const downloadOne = async (sub) => {
    try {
      const url = await renderToDataUrl(reviewing.design, sub.values);
      downloadDataUrl(url, `${safeName(reviewing.design.title)}-${safeName(who(sub))}.png`);
    } catch (e) { toast.err(e.message); }
  };

  const downloadAll = async () => {
    if (!reviewing.submissions.length) return;
    setBusy(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const sub of reviewing.submissions) {
        const url = await renderToDataUrl(reviewing.design, sub.values);
        zip.file(`${safeName(who(sub))}.png`, url.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const href = URL.createObjectURL(blob);
      downloadDataUrl(href, `${safeName(reviewing.design.title)}-submissions.zip`);
      URL.revokeObjectURL(href);
      toast.ok(`${reviewing.submissions.length} downloaded`);
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  if (!ok || items === null) return <Layout><Loading /></Layout>;

  const cohortName = bootcamps?.find((b) => b.id === bootcampId)?.name;
  const field = form?.fields?.[sel];

  return (
    <Layout>
      <PageHead
        title="Designs"
        subtitle={cohortName ? `Templates students fill in for ${cohortName}` : 'Pick a cohort in the sidebar'}
        actions={bootcampId ? <Button variant="primary" onClick={openNew}>+ New Design</Button> : null}
      />

      {!bootcampId ? (
        <Card><Empty icon="🎨" title="No cohort selected" subtitle="Choose a cohort in the sidebar first." /></Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty
            icon="🎨"
            title="No designs yet"
            subtitle="Upload a background, place text areas on it, and assign it to this cohort."
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((d) => (
            <Card key={d.id}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <img
                  src={bgUrl(d)}
                  alt=""
                  style={{ width: 120, height: 84, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{d.title}</strong>
                    <Badge color={d.assigned ? 'green' : 'gray'}>{d.assigned ? 'Assigned' : 'Draft'}</Badge>
                    <Badge color="blue">
                      {d.fields.filter((f) => f.type !== 'image').length} text
                      {' · '}
                      {d.fields.filter((f) => f.type === 'image').length} image
                    </Badge>
                    <Badge color="purple">per {d.submit_as}</Badge>
                  </div>
                  {d.description && (
                    <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>{d.description}</div>
                  )}
                </div>
                <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => openReview(d)}>
                    {d.submission_count} submission{d.submission_count === 1 ? '' : 's'}
                  </Button>
                  <Button size="sm" onClick={() => openEdit(d)}>Edit</Button>
                  <Button size="sm" onClick={() => toggleAssigned(d)}>{d.assigned ? 'Withdraw' : 'Assign'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(d)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- designer ---------- */}
      {editing && form && (
        <Modal
          title={editing.id ? 'Edit design' : 'New design'}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </>
          }
        >
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. App pitch one-pager" />
          </Field>
          <Field label="Instructions for students (optional)">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <Field label="Background image">
            <label className="btn" style={{ cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : form.background_url ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/*" disabled={uploading} style={{ display: 'none' }}
                onChange={(e) => { uploadBg(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </Field>

          {!form.background_url ? (
            <Empty icon="🖼" title="Upload a background first" subtitle="Then drag text areas onto it." />
          ) : (
            <>
              <div className="hstack" style={{ justifyContent: 'space-between', margin: '10px 0 6px' }}>
                <strong style={{ fontSize: 14 }}>Areas</strong>
                <span className="hstack" style={{ gap: 8 }}>
                  <Button size="sm" onClick={() => addField('text')}>+ Text area</Button>
                  <Button size="sm" onClick={() => addField('image')}>+ Image area</Button>
                </span>
              </div>

              {/* Drag the boxes onto the background. */}
              <div
                ref={stageRef}
                style={{ position: 'relative', userSelect: 'none', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sep,#e5e5ea)' }}
              >
                {/* The canvas draws the real wrapped text, so resizing a box
                    visibly re-wraps it. The overlay is just the hit area. */}
                <DesignCanvas design={form} values={{}} showPlaceholders />
                {form.fields.map((f, i) => (
                  <div
                    key={i}
                    onPointerDown={(e) => beginDrag(e, i, 'move')}
                    title={`${f.label} (${f.type === 'image' ? 'image' : 'text'}) — drag to move, grab an edge to resize`}
                    style={{
                      position: 'absolute',
                      left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%`,
                      border: `1.5px ${i === sel ? 'solid' : 'dashed'} ${i === sel ? 'var(--accent,#007aff)' : 'rgba(0,0,0,0.4)'}`,
                      background: i === sel ? 'rgba(0,122,255,0.08)' : 'transparent',
                      cursor: 'move', borderRadius: 3, touchAction: 'none',
                    }}
                  >
                    {/* Resize handles, on the selected box only, to avoid clutter. */}
                    {i === sel && HANDLES.map((hd) => (
                      <span
                        key={hd.mode}
                        onPointerDown={(e) => beginDrag(e, i, hd.mode)}
                        style={{
                          position: 'absolute', width: 10, height: 10,
                          background: '#fff', border: '1.5px solid var(--accent,#007aff)',
                          borderRadius: 2, touchAction: 'none', cursor: hd.cursor,
                          ...hd.pos,
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>

              {field ? (
                <Card style={{ marginTop: 12 }}>
                  <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <Select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                      {form.fields.map((f, i) => <option key={i} value={i}>{f.label}</option>)}
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => { removeField(sel); setSel(0); }}>Remove</Button>
                  </div>

                  <div className="grid cols-2">
                    <Field label="Label (what the student sees)">
                      <Input value={field.label} onChange={(e) => patchField(sel, { label: e.target.value })} />
                    </Field>
                    <Field label="Width (%)">
                      <Input type="number" value={field.w} onChange={(e) => patchField(sel, { w: Number(e.target.value) })} />
                    </Field>
                    <Field label="Height (%)">
                      <Input type="number" value={field.h} onChange={(e) => patchField(sel, { h: Number(e.target.value) })} />
                    </Field>

                    {field.type === 'image' ? (
                      <Field label="How the picture fills the box">
                        <Select value={field.fit || 'cover'} onChange={(e) => patchField(sel, { fit: e.target.value })}>
                          <option value="cover">Cover — fill the box, crop the overflow</option>
                          <option value="contain">Contain — fit the whole picture inside</option>
                        </Select>
                      </Field>
                    ) : (
                      <>
                        <Field label="Placeholder">
                          <Input value={field.placeholder} onChange={(e) => patchField(sel, { placeholder: e.target.value })} />
                        </Field>
                        <Field label="Font size (px) — shrinks automatically to fit">
                          <Input type="number" value={field.fontSize} onChange={(e) => patchField(sel, { fontSize: Number(e.target.value) })} />
                        </Field>
                        <Field label="Colour">
                          <Input type="color" value={field.color} onChange={(e) => patchField(sel, { color: e.target.value })} />
                        </Field>
                        <Field label="Align">
                          <Select value={field.align} onChange={(e) => patchField(sel, { align: e.target.value })}>
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                          </Select>
                        </Field>
                        <Field label="Max characters">
                          <Input type="number" value={field.maxLength} onChange={(e) => patchField(sel, { maxLength: Number(e.target.value) })} />
                        </Field>
                      </>
                    )}
                  </div>
                  <div className="hstack" style={{ gap: 18, flexWrap: 'wrap' }}>
                    {field.type !== 'image' && (
                      <Switch checked={!!field.bold} onChange={(v) => patchField(sel, { bold: v })} label="Bold" />
                    )}
                    <Switch checked={!!field.required} onChange={(v) => patchField(sel, { required: v })} label="Required" />
                  </div>
                </Card>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
                  Add a text area, then drag it onto the image.
                </div>
              )}
            </>
          )}

          <div className="divider" />
          <Field label="Who fills this in">
            <Select
              value={form.submit_as}
              disabled={!!editing.submission_count}
              onChange={(e) => setForm({ ...form, submit_as: e.target.value })}
            >
              <option value="student">Each student individually</option>
              <option value="team">One per team</option>
            </Select>
            {!!editing.submission_count && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Locked — {editing.submission_count} submission{editing.submission_count === 1 ? ' has' : 's have'} been
                saved, and student and team copies are stored differently.
              </div>
            )}
          </Field>
          <Switch
            checked={!!form.assigned}
            onChange={(v) => setForm({ ...form, assigned: v })}
            label="Assign to this cohort — students can fill it in"
          />
        </Modal>
      )}

      {/* ---------- submissions ---------- */}
      {reviewing && (
        <Modal
          title={`Submissions · ${reviewing.design.title}`}
          wide
          onClose={() => setReviewing(null)}
          footer={
            <>
              <Button onClick={() => setReviewing(null)}>Close</Button>
              <Button variant="primary" onClick={downloadAll} disabled={busy || !reviewing.submissions.length}>
                {busy ? 'Preparing…' : '⤓ Download all (ZIP)'}
              </Button>
            </>
          }
        >
          {reviewing.submissions.length === 0 ? (
            <Empty icon="📭" title="Nothing submitted yet" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
              {reviewing.submissions.map((sub) => (
                <div key={sub.id} style={{ border: '1px solid var(--sep,#e5e5ea)', borderRadius: 10, padding: 10 }}>
                  <DesignCanvas design={reviewing.design} values={sub.values} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>{who(sub)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(sub.updated_at).toLocaleString('en-IN')}
                  </div>
                  <Button size="sm" style={{ marginTop: 8 }} onClick={() => downloadOne(sub)}>⤓ PNG</Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  );
}
