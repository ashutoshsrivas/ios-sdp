import { useEffect, useState } from 'react';
import { useRequirePermission } from '../../lib/auth';
import { useBootcamp } from '../../lib/bootcamp';
import { api } from '../../lib/api';
import Layout, { PageHead } from '../../components/Layout';
import {
  Card, Button, Loading, useToast, Badge, Modal, Field, Input, Textarea, Empty, Switch, ProgressBar } from '../../components/UI';

const BLANK = {
  title: '', description: '', hero_image_url: '', link_url: '',
  modal_html: '', published: true, sort_order: '', bootcamp_id: '',
};

export default function AdminApps() {
  const { ok } = useRequirePermission('website.apps');
  const { bootcampId, bootcamps } = useBootcamp() || {};
  const toast = useToast();

  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [useCustomModal, setUseCustomModal] = useState(false);
  // Full cohort list for the picker — an app can be published to any cohort,
  // not only whichever one the sidebar happens to have selected.
  const [cohorts, setCohorts] = useState([]);
  const [bannerBusy, setBannerBusy] = useState(false);

  const cohort = bootcamps?.find((b) => b.id === bootcampId);

  const load = async () => {
    if (!bootcampId) { setItems([]); return; }
    try { setItems(await api.get(`/api/cohort-apps?cohort=${bootcampId}`)); }
    catch (e) { toast.err(e.message); setItems([]); }
  };
  useEffect(() => { if (ok) load(); }, [ok, bootcampId]);

  const loadCohorts = async () => {
    try { setCohorts(await api.get('/api/cohort-apps/cohorts')); }
    catch { /* picker falls back to the sidebar cohort */ }
  };
  useEffect(() => { if (ok) loadCohorts(); }, [ok]);

  const cohortRow = cohorts.find((c) => c.id === bootcampId);

  // Banner for the cohort's public page. Narrow endpoint — website.apps does
  // not grant editing a cohort's name, status or registration.
  const uploadBanner = async (file) => {
    if (!file || !bootcampId) return;
    if (!file.type.startsWith('image/')) { toast.err('Please choose an image file'); return; }
    setBannerBusy(true);
    try {
      const up = await api.uploadWithProgress(file, null, () => {});
      await api.put(`/api/cohort-apps/cohorts/${bootcampId}/image`, { image_url: up.url });
      await loadCohorts();
      toast.ok('Cohort image updated');
    } catch (e) { toast.err(e.message); }
    setBannerBusy(false);
  };

  const removeBanner = async () => {
    setBannerBusy(true);
    try {
      await api.put(`/api/cohort-apps/cohorts/${bootcampId}/image`, { image_url: null });
      await loadCohorts();
      toast.show('Cohort image removed');
    } catch (e) { toast.err(e.message); }
    setBannerBusy(false);
  };

  const openNew = () => { setForm({ ...BLANK, bootcamp_id: bootcampId || '' }); setUseCustomModal(false); setEditing({}); };
  const openEdit = (a) => {
    setForm({
      title: a.title || '',
      description: a.description || '',
      hero_image_url: a.hero_image_url || '',
      link_url: a.link_url || '',
      modal_html: a.modal_html || '',
      published: !!a.published,
      sort_order: a.sort_order ?? '',
      bootcamp_id: a.bootcamp_id ?? bootcampId,
    });
    setUseCustomModal(!!a.modal_html);
    setEditing(a);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.err('Title is required'); return; }
    setBusy(true);
    try {
      // Clearing the toggle clears the stored HTML, so "Know more" falls back
      // to the description rather than silently keeping an old custom modal.
      const targetCohort = Number(form.bootcamp_id) || bootcampId;
      const payload = {
        ...form,
        bootcamp_id: targetCohort,
        modal_html: useCustomModal ? form.modal_html : '',
      };
      if (editing.id) { await api.put(`/api/cohort-apps/${editing.id}`, payload); toast.ok('App updated'); }
      else { await api.post('/api/cohort-apps', payload); toast.ok('App added'); }

      // Saving into another cohort would otherwise look like the app vanished,
      // because this list only shows the cohort selected in the sidebar.
      if (targetCohort !== bootcampId) {
        const name = cohorts.find((c) => c.id === targetCohort)?.name || 'that cohort';
        toast.show(`Saved to ${name} — switch cohort in the sidebar to see it`);
      }
      setEditing(null);
      await load();
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  };

  const uploadHero = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.err('Please choose an image file'); return; }
    setUploading(true);
    try {
      const up = await api.upload(file);
      setForm((f) => ({ ...f, hero_image_url: up.url }));
      toast.ok('Hero image uploaded');
    } catch (e) { toast.err(e.message); }
    setUploading(false);
  };

  const togglePublished = async (a) => {
    try { await api.put(`/api/cohort-apps/${a.id}`, { published: !a.published }); await load(); }
    catch (e) { toast.err(e.message); }
  };

  const remove = async (a) => {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    try { await api.del(`/api/cohort-apps/${a.id}`); await load(); toast.show('Deleted'); }
    catch (e) { toast.err(e.message); }
  };

  if (!ok || items === null) return <Layout><Loading /></Layout>;

  return (
    <Layout>
      <PageHead
        title="Apps"
        subtitle={
          cohort
            ? `Apps shown on the public page for ${cohort.name}`
            : 'Pick a cohort from the sidebar to manage its apps'
        }
        actions={bootcampId ? <Button variant="primary" onClick={openNew}>+ Add App</Button> : null}
      />

      {bootcampId && (
        <Card style={{ marginBottom: 14 }}>
          <div className="hstack" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {cohortRow?.image_url ? (
              <img
                src={cohortRow.image_url}
                alt=""
                style={{ width: 160, height: 90, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }}
              />
            ) : (
              <div style={{
                width: 160, height: 90, borderRadius: 10, flexShrink: 0,
                background: 'var(--fill-2, #f1f1f4)', display: 'grid', placeItems: 'center', fontSize: 26,
              }}>🖼</div>
            )}
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>Cohort image</strong>
              <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4 }}>
                The banner at the top of {cohortRow?.name || 'this cohort'}&apos;s page on the website.
              </div>
            </div>
            <div className="hstack" style={{ gap: 8 }}>
              <label className="btn" style={{ cursor: 'pointer' }}>
                {bannerBusy ? 'Uploading…' : cohortRow?.image_url ? 'Replace' : 'Upload image'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={bannerBusy}
                  style={{ display: 'none' }}
                  onChange={(e) => { uploadBanner(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
              {cohortRow?.image_url && (
                <Button size="sm" variant="ghost" disabled={bannerBusy} onClick={removeBanner}>Remove</Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!bootcampId ? (
        <Card><Empty icon="📱" title="No cohort selected" subtitle="Choose a cohort in the sidebar first." /></Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty
            icon="📱"
            title="No apps yet"
            subtitle="Add the apps this cohort built — they appear on the cohort's public page."
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((a) => (
            <Card key={a.id}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {a.hero_image_url ? (
                  <img
                    src={a.hero_image_url}
                    alt=""
                    style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 96, height: 72, borderRadius: 10, flexShrink: 0,
                    background: 'var(--fill-2, #f1f1f4)', display: 'grid', placeItems: 'center', fontSize: 24,
                  }}>📱</div>
                )}

                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{a.title}</strong>
                    <Badge color={a.published ? 'green' : 'gray'}>{a.published ? 'Live' : 'Draft'}</Badge>
                    {a.modal_html && <Badge color="purple">Custom modal</Badge>}
                  </div>
                  {a.link_url && (
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <a href={a.link_url} target="_blank" rel="noopener noreferrer">{a.link_url}</a>
                    </div>
                  )}
                  {a.description && (
                    <div
                      style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 6 }}
                      dangerouslySetInnerHTML={{ __html: a.description }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => openEdit(a)}>Edit</Button>
                  <Button size="sm" onClick={() => togglePublished(a)}>
                    {a.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit app' : 'Add app'}
          wide
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
          <Field label="Cohort — the public page this app appears on">
            <Select
              value={form.bootcamp_id || ''}
              onChange={(e) => setForm({ ...form, bootcamp_id: Number(e.target.value) })}
            >
              {cohorts.length === 0 && <option value={bootcampId}>Current cohort</option>}
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.public_visible ? '' : ' (not public yet)'}
                </option>
              ))}
            </Select>
            {!cohorts.find((c) => c.id === Number(form.bootcamp_id))?.public_visible && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                This cohort is not visible on the website yet, so the app stays hidden
                until an admin turns its visibility on.
              </div>
            )}
          </Field>

          <Field label="App title">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. CampusConnect"
            />
          </Field>

          <Field label="Hero image">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {form.hero_image_url && (
                <img
                  src={form.hero_image_url}
                  alt=""
                  style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8 }}
                />
              )}
              <label className="btn" style={{ cursor: 'pointer' }}>
                {uploading ? 'Uploading…' : form.hero_image_url ? 'Replace image' : 'Upload image'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  style={{ display: 'none' }}
                  onChange={(e) => { uploadHero(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
              {form.hero_image_url && (
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, hero_image_url: '' })}>
                  Remove
                </Button>
              )}
            </div>
          </Field>

          <Field label="Link (App Store, TestFlight, GitHub…)">
            <Input
              value={form.link_url}
              onChange={(e) => setForm({ ...form, link_url: e.target.value })}
              placeholder="https://apps.apple.com/..."
            />
          </Field>

          <Field label="Description">
            <Textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What the app does"
            />
          </Field>

          <Switch
            checked={useCustomModal}
            onChange={setUseCustomModal}
            label='Use custom HTML for the "Know more" popup instead of the description'
          />

          {useCustomModal && (
            <Field label="Custom modal HTML">
              <Textarea
                rows={10}
                value={form.modal_html}
                onChange={(e) => setForm({ ...form, modal_html: e.target.value })}
                placeholder={'<h2>CampusConnect</h2>\n<p>Built by …</p>\n<img src="https://…" alt="screenshot">'}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>
                Headings, text, lists, tables, images, inline styles and YouTube/Vimeo embeds are
                allowed. Scripts, event handlers and forms are stripped when saved, because this
                renders on the public website.
              </div>
            </Field>
          )}

          <Field label="Sort order (lower shows first)">
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
    </Layout>
  );
}
