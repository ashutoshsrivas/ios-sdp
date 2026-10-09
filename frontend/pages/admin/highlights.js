import { useEffect, useState } from 'react';
import { useRequirePermission } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty, Switch, ProgressBar } from '../../components/UI';

const BLANK = { title: '', description: '', event_date: '', published: false, sort_order: '' };

export default function AdminHighlights() {
  const { ok } = useRequirePermission('website.highlights');
  const toast = useToast();

  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, or the row
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [photosFor, setPhotosFor] = useState(null); // row whose photos are open
  const [uploading, setUploading] = useState(false);
  // Images chosen while creating, before the highlight exists to attach them to.
  const [staged, setStaged] = useState([]);
  const [prog, setProg] = useState(null); // {done, total, percent, name}


  const load = async () => {
    try { setItems(await api.get('/api/highlights')); }
    catch (e) { toast.err(e.message); setItems([]); }
  };
  useEffect(() => { if (ok) load(); }, [ok]);

  const openNew = () => { setForm(BLANK); setStaged([]); setEditing({}); };
  const openEdit = (h) => {
    setForm({
      title: h.title || '',
      description: h.description || '',
      // <input type="date"> needs YYYY-MM-DD; the API returns an ISO timestamp.
      event_date: h.event_date ? String(h.event_date).slice(0, 10) : '',
      published: !!h.published,
      sort_order: h.sort_order ?? '',
    });
    setStaged([]);
    setEditing(h);
  };

  /**
   * Upload files one at a time and attach each to a highlight. Sequential on
   * purpose: a dozen parallel multi-MB puts would fight for the same uplink and
   * make every bar crawl, and the server streams each to S3 anyway.
   * Returns how many succeeded; one bad file does not abandon the rest.
   */
  const uploadAndAttach = async (highlightId, files) => {
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProg({ done: i, total: files.length, percent: 0, name: file.name });
      try {
        const up = await api.uploadWithProgress(file, null, (percent) =>
          setProg({ done: i, total: files.length, percent, name: file.name })
        );
        await api.post(`/api/highlights/${highlightId}/photos`, { url: up.url, caption: '' });
        done++;
      } catch (e) {
        toast.err(`${file.name}: ${e.message}`);
      }
    }
    setProg(null);
    return done;
  };

  const save = async () => {
    if (!form.title.trim()) { toast.err('Title is required'); return; }
    setBusy(true);
    try {
      let id = editing.id;
      if (id) {
        await api.put(`/api/highlights/${id}`, form);
      } else {
        // The photo endpoint needs an id, so the highlight is created first and
        // the images staged in this form are attached straight afterwards.
        const r = await api.post('/api/highlights', form);
        id = r.id;
      }

      let added = 0;
      if (staged.length) added = await uploadAndAttach(id, staged);

      setStaged([]);
      setEditing(null);
      await load();
      toast.ok(
        added
          ? `${editing.id ? 'Highlight updated' : 'Highlight created'} with ${added} image${added === 1 ? '' : 's'}`
          : (editing.id ? 'Highlight updated' : 'Highlight created')
      );
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const togglePublished = async (h) => {
    try {
      await api.put(`/api/highlights/${h.id}`, { published: !h.published });
      await load();
      toast.show(h.published ? 'Hidden from the website' : 'Now live on the website');
    } catch (e) { toast.err(e.message); }
  };

  const remove = async (h) => {
    if (!confirm(`Delete "${h.title}" and its photos? This cannot be undone.`)) return;
    try { await api.del(`/api/highlights/${h.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  // Keep only images, warning about anything else that was selected.
  const imagesOnly = (files) => {
    const list = Array.from(files || []);
    const images = list.filter((f) => f.type.startsWith('image/'));
    const rejected = list.filter((f) => !f.type.startsWith('image/'));
    rejected.forEach((f) => toast.err(`${f.name} is not an image`));
    return images;
  };

  // Add more images to a highlight that already exists.
  const addPhotos = async (files) => {
    const images = imagesOnly(files);
    if (!images.length || !photosFor) return;
    setUploading(true);
    const added = await uploadAndAttach(photosFor.id, images);
    if (added) toast.ok(`${added} image${added === 1 ? '' : 's'} added`);
    const fresh = await api.get('/api/highlights').catch(() => null);
    if (fresh) {
      setItems(fresh);
      setPhotosFor(fresh.find((x) => x.id === photosFor.id) || null);
    }
    setUploading(false);
  };

  /**
   * Move a photo one place left or right. The public page orders by
   * COALESCE(sort_order, id), so every photo is renumbered from 0 — otherwise
   * rows that never had a sort_order would keep sorting by id and jump around.
   */
  const movePhoto = async (photo, delta) => {
    const list = [...(photosFor.photos || [])];
    const from = list.findIndex((p) => p.id === photo.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(from, 1)[0]);

    // Optimistic: reorder locally first so the grid doesn't lag the click.
    setPhotosFor({ ...photosFor, photos: list });
    try {
      await Promise.all(list.map((p, i) => api.put(`/api/highlights/photos/${p.id}`, { sort_order: i })));
      const fresh = await api.get('/api/highlights');
      setItems(fresh);
      setPhotosFor(fresh.find((x) => x.id === photosFor.id) || null);
    } catch (e) { toast.err(e.message); }
  };

  const removePhoto = async (photo) => {
    try {
      await api.del(`/api/highlights/photos/${photo.id}`);
      const fresh = await api.get('/api/highlights');
      setItems(fresh);
      setPhotosFor(fresh.find((x) => x.id === photosFor.id) || null);
    } catch (e) { toast.err(e.message); }
  };

  const saveCaption = async (photo, caption) => {
    if ((photo.caption || '') === caption) return;
    try { await api.put(`/api/highlights/photos/${photo.id}`, { caption }); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || items === null) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Highlights"
        subtitle="Events and highlights shown on iosdc.geu.ac.in — only published ones are public"
        actions={<Button variant="primary" onClick={openNew}>+ New Highlight</Button>}
      />

      {items.length === 0 ? (
        <Card>
          <Empty
            icon="📸"
            title="No highlights yet"
            subtitle="Add an event with photos and publish it to the website."
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((h) => (
            <Card key={h.id}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {h.photos?.[0] ? (
                  <img
                    src={h.photos[0].url}
                    alt=""
                    style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 96, height: 72, borderRadius: 10, flexShrink: 0,
                    background: 'var(--fill-2, #f1f1f4)', display: 'grid', placeItems: 'center', fontSize: 24,
                  }}>📸</div>
                )}

                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{h.title}</strong>
                    <Badge color={h.published ? 'green' : 'gray'}>
                      {h.published ? 'Live' : 'Draft'}
                    </Badge>
                    <Badge color="blue">{h.photos?.length || 0} photo{(h.photos?.length || 0) === 1 ? '' : 's'}</Badge>
                  </div>
                  {h.event_date && (
                    <div style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 2 }}>
                      {new Date(h.event_date).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </div>
                  )}
                  {h.description && (
                    <div
                      style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 6 }}
                      dangerouslySetInnerHTML={{ __html: h.description }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => setPhotosFor(h)}>Photos</Button>
                  <Button size="sm" onClick={() => openEdit(h)}>Edit</Button>
                  <Button size="sm" onClick={() => togglePublished(h)}>
                    {h.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(h)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit highlight' : 'New highlight'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Ideation Bootcamp 2026"
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={5}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What happened, who took part…"
            />
          </Field>
          <Field label="Sort order (lower shows first — leave blank for date order)">
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </Field>
          <Switch
            checked={form.published}
            onChange={(v) => setForm({ ...form, published: v })}
            label="Published — visible on the public website"
          />

          <div className="divider" />
          <Field label="Images">
            <label className="btn" style={{ display: 'inline-block', cursor: 'pointer' }}>
              + Choose images
              <input
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  setStaged((xs) => [...xs, ...imagesOnly(e.target.files)]);
                  e.target.value = '';
                }}
              />
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              Select as many as you like — they all appear in this highlight&apos;s gallery
              on the website. {editing.id ? 'These are added to the existing images.' : 'They upload when you save.'}
            </div>

            {staged.length > 0 && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))',
                gap: 10, marginTop: 12,
              }}>
                {staged.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{ position: 'relative' }}>
                    <img
                      src={URL.createObjectURL(f)}
                      alt=""
                      style={{ width: '100%', height: 78, objectFit: 'cover', borderRadius: 8 }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setStaged((xs) => xs.filter((_, idx) => idx !== i))}
                      style={{
                        position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                        borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: 'rgba(0,0,0,0.6)', color: '#fff', lineHeight: '22px', padding: 0,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {prog && (
              <ProgressBar
                percent={prog.percent}
                label={`Uploading ${prog.done + 1} of ${prog.total} · ${prog.name}`}
              />
            )}
          </Field>
        </Modal>
      )}

      {photosFor && (
        <Modal
          title={`Photos — ${photosFor.title}`}
          wide
          onClose={() => setPhotosFor(null)}
          footer={<Button onClick={() => setPhotosFor(null)}>Done</Button>}
        >
          <label className="btn" style={{ display: 'inline-block', cursor: 'pointer', marginBottom: 14 }}>
            {uploading ? 'Uploading…' : '+ Add photos'}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              style={{ display: 'none' }}
              onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
            />
          </label>
          {prog && (
            <ProgressBar
              percent={prog.percent}
              label={`Uploading ${prog.done + 1} of ${prog.total} · ${prog.name}`}
            />
          )}

          {(photosFor.photos?.length || 0) === 0 ? (
            <Empty icon="🖼" title="No photos yet" subtitle="Add one or more images for this highlight." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
              {photosFor.photos.map((p, pi) => (
                <div key={p.id} style={{ border: '1px solid var(--sep,#e5e5ea)', borderRadius: 10, padding: 8 }}>
                  <img
                    src={p.url}
                    alt={p.caption || ''}
                    style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6 }}
                  />
                  <Input
                    defaultValue={p.caption || ''}
                    placeholder="Caption"
                    style={{ marginTop: 6, fontSize: 13 }}
                    onBlur={(e) => saveCaption(p, e.target.value)}
                  />
                  <div className="hstack" style={{ marginTop: 6, gap: 4 }}>
                    <Button size="sm" onClick={() => movePhoto(p, -1)} disabled={pi === 0}>←</Button>
                    <Button size="sm" onClick={() => movePhoto(p, 1)} disabled={pi === photosFor.photos.length - 1}>→</Button>
                    <Button size="sm" variant="ghost" onClick={() => removePhoto(p)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  );
}
