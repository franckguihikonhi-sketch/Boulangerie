import { useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { libelleMois } from '../lib/payroll';
import {
  cotisationsData, cotisationsTotaux, cotisationsDocumentHtml,
  imprimerCotisations, telechargerCotisations
} from '../lib/cotisations';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote } from '../components/ui';

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Aperçu fidèle : on affiche EXACTEMENT l'état imprimé dans un iframe isolé
// (défilement horizontal, colonnes nombreuses).
function RegisterPreview({ rows, ym, t, locale }) {
  const html = cotisationsDocumentHtml(rows, ym, { t, locale });
  const onLoad = (ev) => {
    try {
      const doc = ev.target.contentDocument;
      ev.target.style.height = `${doc.documentElement.scrollHeight + 8}px`;
    } catch {
      /* iframe inaccessible : on garde la hauteur par défaut */
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 shadow-sm">
      <iframe
        title={`État des cotisations ${ym}`}
        srcDoc={html}
        onLoad={onLoad}
        className="block w-full"
        style={{ border: 0, minHeight: 300 }}
      />
    </div>
  );
}

export default function Cotisations() {
  const { settings, employees } = useStore();
  const { t, locale } = useI18n();

  const [ym, setYm] = useState(currentYm());
  const [rows, setRows] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const build = () => {
    setError('');
    setNotice('');
    if (employees.length === 0) { setError(t('bulletins.noEmployees')); return; }
    const blocked = employees.filter((e) => e.sousControle);
    const targets = employees.filter((e) => !e.sousControle);
    if (blocked.length > 0) {
      setNotice(t('employees.blockedControle', { nom: blocked.map((e) => e.nom).join(', ') }));
    }
    setRows(cotisationsData(targets, ym, settings));
  };

  const runExport = async (fn) => {
    if (!rows || !rows.length || exporting) return;
    setNotice('');
    setExporting(true);
    try {
      const ok = await fn(rows, ym, { t, locale });
      setNotice(ok ? t('bulletins.downloaded') : t('bulletins.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  const print = () => runExport(imprimerCotisations);
  const download = () => runExport(telechargerCotisations);

  const totaux = rows && rows.length ? cotisationsTotaux(rows) : null;

  return (
    <div>
      <PageTitle>{t('cotisations.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('cotisations.subtitle')}</p>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
          <Field label={t('livrePaie.month')}>
            <input className={inputClass} type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={build}>{t('bulletins.generate')}</Button>
          {rows && rows.length > 0 && (
            <>
              <Button onClick={print} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('livrePaie.print')}
              </Button>
              <Button variant="secondary" onClick={download} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('bulletins.download')}
              </Button>
            </>
          )}
        </div>
        {notice && (
          <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {rows && (
        <div className="mt-5">
          {rows.length === 0 ? (
            <InfoNote>{t('livrePaie.none')}</InfoNote>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm capitalize text-stone-600">{libelleMois(ym, locale)}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>{t('livrePaie.employeeCount')} : <strong>{rows.length}</strong></span>
                  <span>{t('cotisations.totalCnps')} : <strong className="text-brand-700">{formatFCFA(totaux.totalCnps, locale)}</strong></span>
                  <span>{t('cotisations.totalCmu')} : <strong className="text-brand-700">{formatFCFA(totaux.totalCmu, locale)}</strong></span>
                  <span>{t('cotisations.totalGeneral')} : <strong>{formatFCFA(totaux.totalGeneral, locale)}</strong></span>
                </div>
              </div>
              <InfoNote>{t('cotisations.previewNote')}</InfoNote>
              <div className="mt-3">
                <RegisterPreview rows={rows} ym={ym} t={t} locale={locale} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
