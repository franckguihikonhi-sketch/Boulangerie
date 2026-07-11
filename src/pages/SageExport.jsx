import { useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { addSageEntry, clearSageEntries, deleteSageEntry } from '../lib/db';
import { formatFCFA } from '../lib/money';
import {
  JOURNAUX_SUGGESTIONS, controleEquilibre, jjmmaaDepuisDate, telechargerFichierSage
} from '../lib/sage';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, PageTitle, TableWrap, inputClass, td, th
} from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ journal: 'VT', pieceDate: today(), account: '', label: '', debit: '', credit: '' });

// Saisie manuelle des écritures comptables, puis export d'un clic vers un
// fichier texte conforme au format d'import SAGE 100 Comptabilité.
export default function SageExport() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Écritures triées par saisie (ordre du fichier exporté).
  const entries = [...s.sageEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const balance = controleEquilibre(entries);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await addSageEntry({
        journal: form.journal,
        pieceDate: form.pieceDate,
        account: form.account,
        label: form.label,
        debit: Number(form.debit) || 0,
        credit: Number(form.credit) || 0,
        author: user.email
      });
      // On garde journal + date pour enchaîner la contrepartie plus vite.
      setForm((f) => ({ ...f, account: '', label: '', debit: '', credit: '' }));
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteSageEntry(id);
    } catch (err) {
      window.alert(t(err.message));
    }
  };

  const clearAll = async () => {
    if (!window.confirm(t('sage.confirmClear'))) return;
    try {
      await clearSageEntries();
    } catch (err) {
      window.alert(t(err.message));
    }
  };

  const exportFile = () => telechargerFichierSage(entries);

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {entries.length > 0 && (
              <Button variant="danger" onClick={clearAll}>{t('sage.clearAll')}</Button>
            )}
            <Button variant="primary" onClick={exportFile} disabled={entries.length === 0} title={t('sage.exportTip')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              {t('sage.export')}
            </Button>
          </div>
        }
      >
        {t('sage.title')}
      </PageTitle>

      <div className="mb-5">
        <InfoNote>{t('sage.intro')}</InfoNote>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">{t('sage.newEntry')}</h2>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('sage.journal')} help={t('sage.journalHelp')}>
                <input
                  className={inputClass}
                  list="sage-journaux"
                  value={form.journal}
                  onChange={(e) => set({ journal: e.target.value.toUpperCase() })}
                  maxLength={6}
                  required
                />
                <datalist id="sage-journaux">
                  {JOURNAUX_SUGGESTIONS.map((j) => (
                    <option key={j.code} value={j.code}>{j.libelle}</option>
                  ))}
                </datalist>
              </Field>
              <Field label={t('sage.pieceDate')}>
                <input type="date" className={inputClass} value={form.pieceDate} onChange={(e) => set({ pieceDate: e.target.value })} required />
              </Field>
            </div>
            <Field label={t('sage.account')} help={t('sage.accountHelp')}>
              <input className={inputClass} value={form.account} onChange={(e) => set({ account: e.target.value })} maxLength={13} required />
            </Field>
            <Field label={t('sage.label')}>
              <input className={inputClass} value={form.label} onChange={(e) => set({ label: e.target.value })} maxLength={35} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('sage.debit')}>
                <input type="number" step="1" min="0" className={inputClass} value={form.debit} onChange={(e) => set({ debit: e.target.value })} />
              </Field>
              <Field label={t('sage.credit')}>
                <input type="number" step="1" min="0" className={inputClass} value={form.credit} onChange={(e) => set({ credit: e.target.value })} />
              </Field>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? t('common.saving') : t('sage.add')}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-stone-900">{t('sage.entries')}</h2>
              {entries.length > 0 && (
                <Badge tone={balance.equilibre ? 'success' : 'warning'}>
                  {balance.equilibre ? t('sage.balanced') : t('sage.unbalanced')}
                </Badge>
              )}
            </div>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>{t('sage.journal')}</th>
                  <th className={th}>{t('sage.pieceDate')}</th>
                  <th className={th}>{t('sage.account')}</th>
                  <th className={th}>{t('sage.label')}</th>
                  <th className={`${th} text-right`}>{t('sage.debit')}</th>
                  <th className={`${th} text-right`}>{t('sage.credit')}</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className={`${td} font-medium`}>{e.journal}</td>
                    <td className={`${td} tabular-nums`}>{jjmmaaDepuisDate(e.pieceDate)}</td>
                    <td className={`${td} tabular-nums`}>{e.account}</td>
                    <td className={td}>{e.label || '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{e.debit ? formatFCFA(e.debit, locale) : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{e.credit ? formatFCFA(e.credit, locale) : '—'}</td>
                    <td className={td}>
                      <button onClick={() => remove(e.id)} className="text-sm font-medium text-red-600 hover:underline">
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td className={`${td} text-stone-500`} colSpan="7">{t('sage.empty')}</td></tr>
                )}
              </tbody>
              {entries.length > 0 && (
                <tfoot className="border-t border-stone-200 font-semibold">
                  <tr>
                    <td className={td} colSpan="4">{t('common.total')} · {t('sage.count', { n: entries.length })}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatFCFA(balance.debit, locale)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatFCFA(balance.credit, locale)}</td>
                    <td className={td}></td>
                  </tr>
                </tfoot>
              )}
            </TableWrap>
          </Card>
          <div className="mt-3">
            <InfoNote>{t('sage.formatNote')}</InfoNote>
          </div>
        </div>
      </div>
    </div>
  );
}
