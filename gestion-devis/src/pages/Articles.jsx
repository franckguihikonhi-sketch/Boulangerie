import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { deleteArticle, saveArticle } from '../lib/db';
import { formatFCFA } from '../lib/money';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, Modal, PageTitle,
  TableWrap, inputClass, td, th
} from '../components/ui';

const emptyForm = { id: null, reference: '', designation: '', unitPrice: '', isActive: true };

// Catalogue des articles prédéfinis (référence, désignation, prix unitaire)
// à partir duquel les commerciaux composent leurs devis (section 4 « Devis »).
export default function Articles() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const articles = useMemo(
    () => [...s.articles].sort((a, b) => (a.reference || '').localeCompare(b.reference || '')),
    [s.articles]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveArticle({
        id: form.id, reference: form.reference, designation: form.designation,
        unitPrice: Number(form.unitPrice), isActive: form.isActive
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

      <Card>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('articles.reference')}</th>
              <th className={th}>{t('devis.designation')}</th>
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
                <td className={td}>{formatFCFA(a.unitPrice, locale)}</td>
                <td className={td}>
                  {a.isActive ? <Badge tone="success">{t('products.active')}</Badge> : <Badge>{t('common.na')}</Badge>}
                </td>
                <td className={`${td} text-right`}>
                  <div className="inline-flex gap-1">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => { setError(''); setForm({ ...a, unitPrice: String(a.unitPrice) }); }}>
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
              <tr><td className={`${td} text-stone-500`} colSpan="5">{t('common.empty')}</td></tr>
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
            <Field label={t('articles.reference')} help={t('articles.referenceHelp')}>
              <input
                className={inputClass} value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="ART-001"
              />
            </Field>
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
