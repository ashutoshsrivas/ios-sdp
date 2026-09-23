import { useEffect, useState } from 'react';
import { useRequireRole } from '../../lib/auth';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty, Switch,
} from '../../components/UI';

const BLANK = { title: '', description: '', event_date: '', published: false, sort_order: '' };

export default function AdminHighlights() {
  const { ok } = useRequireRole(['admin']);
  const toast = useToast();

  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, or the row
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [photosFor, setPhotosFor] = useState(null); // row whose photos are open
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try { setItems(await api.get('/api/highlights')); }
    catch (e) { toast.err(e.message); setItems([]); }
  };
  useEffect(() => { if (ok) load(); }, [ok]);

  const openNew = () => { setForm(BLANK); setEditing({}); };
  const openEdit = (h) => {
    setForm({
      title: h.title || '',
      description: h.description || '',
      // <input type="date"> needs YYYY-MM-DD; the API returns an ISO timestamp.
      event_date: h.event_date ? String(h.event_date).slice(0, 10) : '',
      published: !!h.published,
      sort_order: h.sort_order ?? '',
    });
    setEditing(h);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.err('Title is required'); return; }
    setBusy(true);
    try {
      if (editing.id) { await api.put(`/api/highlights/${editing.id}`, form); toast.ok('Highlight updated'); }
      else { await api.post('/api/highlights', form); toast.ok('Highlight created'); }
      setEditing(null);
      await load();
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

  // Upload each chosen file, then attach its URL to the highlight.
  const addPhotos = async (files) => {
    if (!files?.length || !photosFor) return;
    setUploading(true);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) { toast.err(`${file.name} is not an image`); continue; }
        const up = await api.upload(file);
        await api.post(`/api/highlights/${photosFor.id}/photos`, { url: up.url, caption: '' });
        added++;
      }
      if (added) toast.ok(`${added} photo${added > 1 ? 's' : ''} added`);
      const fresh = await api.get('/api/highlights');
      setItems(fresh);
      setPhotosFor(fresh.find((x) => x.id === photosFor.id) || null);
    } catch (e) { toast.err(e.message); }
    setUploading(false);
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

          {(photosFor.photos?.length || 0) === 0 ? (
            <Empty icon="🖼" title="No photos yet" subtitle="Add one or more images for this highlight." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
              {photosFor.photos.map((p) => (
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
                  <Button size="sm" variant="ghost" style={{ marginTop: 6 }} onClick={() => removePhoto(p)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  );
}
