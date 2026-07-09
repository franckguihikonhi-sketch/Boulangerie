import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { deleteArticle, saveArticle, ARTICLE_FAMILIES } from '../lib/db';
import { formatFCFA } from '../lib/money';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, Modal, PageTitle,
  TableWrap, inputClass, td, th
} from '../components/ui';

const emptyForm = { id: null, reference: '', designation: '', family: ARTICLE_FAMILIES[0], unitPrice: '', isActive: true };

// Catalogue des articles prédéfinis, organisé par famille (Poissons, Viandes,
// Frites surgelées, Produit laitier), à partir duquel les commerciaux composent
// leurs devis.
export default function Articles() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [form, setForm] = useState(null);
  const [familyFilter, setFamilyFilter] = useState('all');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const articles = useMemo(
    () =>
      [...s.articles]
        .filter((a) => familyFilter === 'all' || a.family === familyFilter)
        .sort((a, b) => (a.reference || '').localeCompare(b.reference || '')),
    [s.articles, familyFilter]
  );

  const familyLabel = (f) => (f ? t('family.' + f) : '—');

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveArticle({
        id: form.id, reference: form.reference, designation: form.designation,
        family: form.family, unitPrice: Number(form.unitPrice), isActive: form.isActive
      });
      setForm(null);
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try {
      await deleteArticle(id);
    } catch (err) {
      setError(t(err.message));
    }
  };

  return (
    <div>
      <PageTitle
        actions={<Button onClick={() => { setError(''); setForm({ ...emptyForm }); }}>{t('articles.add')}</Button>}
      >
        {t('articles.title')}
      </PageTitle>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFamilyFilter('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              familyFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {t('common.all')} ({s.articles.length})
          </button>
          {ARTICLE_FAMILIES.map((f) => {
            const count = s.articles.filter((a) => a.family === f).length;
            return (
              <button
                key={f}
                onClick={() => setFamilyFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  familyFilter === f ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {familyLabel(f)} ({count})
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('articles.reference')}</th>
              <th className={th}>{t('devis.designation')}</th>
              <th className={th}>{t('articles.family')}</th>
              <th className={th}>{t('devis.unitPrice')}</th>
              <th className={th}>{t('products.active')}</th>
              <th className={`${th} text-right`}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {articles.map((a) => (
              <tr key={a.id} className="hover:bg-stone-50">
                <td className={`${td} font-mono text-xs`}>{a.reference || '—'}</td>
                <td className={`${td} font-medium`}>{a.designation}</td>
                <td className={td}><Badge tone="brand">{familyLabel(a.family)}</Badge></td>
                <td className={td}>{formatFCFA(a.unitPrice, locale)}</td>
                <td className={td}>
                  {a.isActive ? <Badge tone="success">{t('products.active')}</Badge> : <Badge>{t('common.na')}</Badge>}
                </td>
                <td className={`${td} text-right`}>
                  <div className="inline-flex gap-1">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => { setError(''); setForm({ ...a, family: a.family || ARTICLE_FAMILIES[0], unitPrice: String(a.unitPrice) }); }}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => remove(a.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {articles.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td></tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <div className="mt-4">
        <InfoNote>{t('articles.note')}</InfoNote>
      </div>

      {form && (
        <Modal title={form.id ? t('articles.edit') : t('articles.add')} onClose={() => setForm(null)}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('articles.reference')} help={t('articles.referenceHelp')}>
                <input
                  className={inputClass} value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="POI-001"
                />
              </Field>
              <Field label={t('articles.family')}>
                <select className={inputClass} value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })}>
                  {ARTICLE_FAMILIES.map((f) => (
                    <option key={f} value={f}>{familyLabel(f)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('devis.designation')}>
              <input
                className={inputClass} value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                required
              />
            </Field>
            <Field label={`${t('devis.unitPrice')} (FCFA)`}>
              <input
                type="number" step="1" min="0" className={inputClass} value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              {t('articles.activeHelp')}
            </label>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
