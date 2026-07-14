import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { periodePourMois, listerMois } from '../lib/payroll';
import { bulletinData, imprimerBulletins, telechargerBulletins, slipDocumentHtml } from '../lib/bulletin';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote } from '../components/ui';

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Aperçu fidèle : on affiche EXACTEMENT le bulletin imprimé (part salariale ET
// part patronale, cumuls, net) dans un iframe isolé. « Ce qui est affiché est
// ce qui est imprimé. » L'iframe s'ajuste à la hauteur de son contenu.
function SlipPreview({ data }) {
  const { t, locale } = useI18n();
  const html = slipDocumentHtml([data], { t, locale });
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
        title={`Bulletin ${data.employee.nom} ${data.ym}`}
        srcDoc={html}
        onLoad={onLoad}
        className="block w-full"
        style={{ border: 0, minHeight: 420 }}
      />
    </div>
  );
}

export default function Bulletins() {
  const { settings, employees } = useStore();
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const preEmp = params.get('e');

  const ym = currentYm();
  const [scope, setScope] = useState(preEmp ? 'one' : 'all');
  const [employeeId, setEmployeeId] = useState(preEmp || employees[0]?.id || '');
  const [from, setFrom] = useState(ym);
  const [to, setTo] = useState(ym);
  const [slips, setSlips] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const rangeOk = from <= to;

  const build = () => {
    setError('');
    if (employees.length === 0) { setError(t('bulletins.noEmployees')); return; }
    if (!rangeOk) { setError(t('bulletins.badRange')); return; }
    const months = listerMois(from, to);
    const targets = scope === 'one' ? employees.filter((e) => e.id === employeeId) : employees;
    const out = [];
    for (const e of targets) {
      for (const m of months) {
        const p = periodePourMois(e.periodes, m);
        if (!p) continue;
        out.push(bulletinData(e, p, m, settings));
      }
    }
    setSlips(out);
  };

  const print = () => {
    if (!slips || !slips.length) return;
    const mode = imprimerBulletins(slips, { t, locale });
    setNotice(mode === 'download' ? t('bulletins.downloaded') : mode ? '' : t('bulletins.printFailed'));
  };

  const download = () => {
    if (!slips || !slips.length) return;
    setNotice(telechargerBulletins(slips, { t, locale }) ? t('bulletins.downloaded') : t('bulletins.printFailed'));
  };

  const total = useMemo(
    () => (slips || []).reduce((a, s) => a + s.calc.netAPayer, 0),
    [slips]
  );

  return (
    <div>
      <PageTitle>{t('bulletins.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('bulletins.subtitle')}</p>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('bulletins.scope')}>
            <select className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">{t('bulletins.scopeAll')}</option>
              <option value="one">{t('bulletins.scopeOne')}</option>
            </select>
          </Field>
          {scope === 'one' && (
            <Field label={t('bulletins.employee')}>
              <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('bulletins.from')}>
            <input className={inputClass} type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('bulletins.to')}>
            <input className={inputClass} type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={build}>{t('bulletins.generate')}</Button>
          {slips && slips.length > 0 && (
            <>
              <Button onClick={print}>{t('bulletins.print', { n: slips.length })}</Button>
              <Button variant="secondary" onClick={download}>{t('bulletins.download')}</Button>
            </>
          )}
        </div>
        {notice && (
          <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {slips && (
        <div className="mt-5">
          {slips.length === 0 ? (
            <InfoNote>{t('bulletins.none')}</InfoNote>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-stone-600">
                  {t('bulletins.count', { n: slips.length })} ·{' '}
                  <span className="font-semibold text-stone-800">{t('slip.netAPayer')} : {formatFCFA(total, locale)}</span>
                </p>
                <div className="flex gap-2">
                  <Button onClick={print}>{t('bulletins.print', { n: slips.length })}</Button>
                  <Button variant="secondary" onClick={download}>{t('bulletins.download')}</Button>
                </div>
              </div>
              <InfoNote>{t('bulletins.previewNote')}</InfoNote>
              <div className="mt-3 flex flex-col gap-5">
                {slips.slice(0, 12).map((s, i) => <SlipPreview key={i} data={s} />)}
              </div>
              {slips.length > 12 && (
                <p className="mt-4 text-center text-sm text-stone-500">
                  + {slips.length - 12} bulletin(s) supplémentaire(s) inclus à l'impression.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
