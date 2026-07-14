import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA, formatNum } from '../lib/money';
import { periodePourMois, listerMois, libelleMois } from '../lib/payroll';
import { bulletinData, imprimerBulletins } from '../lib/bulletin';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote, Badge } from '../components/ui';

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Ligne d'aperçu (gain / retenue) dans le bulletin affiché à l'écran.
function Line({ label, gain, retenue, base, taux, strong }) {
  return (
    <div className={`grid grid-cols-12 gap-2 px-2 py-1 text-sm ${strong ? 'bg-brand-50 font-semibold' : ''}`}>
      <span className="col-span-5 text-stone-700">{label}</span>
      <span className="col-span-2 text-right text-xs text-stone-400">{base != null ? formatNum(base) : ''}</span>
      <span className="col-span-1 text-right text-xs text-stone-400">{taux || ''}</span>
      <span className="col-span-2 text-right tabular-nums text-green-700">{gain != null ? formatNum(gain) : ''}</span>
      <span className="col-span-2 text-right tabular-nums text-red-700">{retenue != null ? formatNum(retenue) : ''}</span>
    </div>
  );
}

function SlipPreview({ data }) {
  const { t, locale } = useI18n();
  const { employee: e, periode: p, ym, calc, anciennete } = data;
  const pct = calc.tauxAnciennete ? (calc.tauxAnciennete * 100).toFixed(0) + ' %' : null;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-4 py-3">
        <div>
          <p className="font-semibold text-stone-800">{e.nom}</p>
          <p className="text-xs text-stone-500">{e.emploi || '—'} · {libelleMois(ym, locale)}</p>
        </div>
        <Badge tone={p.kind === 'cdi' ? 'success' : 'warning'}>{t('contract.' + p.kind)}{p.label ? ' — ' + p.label : ''}</Badge>
      </div>
      <div className="divide-y divide-stone-50">
        <Line label={t('slip.salaireBase')} gain={calc.salaireBase} />
        <Line label={t('slip.sursalaire')} gain={calc.sursalaire} />
        {calc.primeAnciennete > 0 && (
          <Line label={t('slip.primeAnciennete')} base={calc.salaireCategoriel} taux={pct} gain={calc.primeAnciennete} />
        )}
        {calc.primes.map((pr, i) => (
          <Line key={i} label={pr.label + (pr.imposable === false ? ' *' : '')} gain={pr.montant} />
        ))}
        {calc.transport > 0 && <Line label={t('slip.transport')} gain={calc.transport} />}
        <Line label={t('slip.brutImposable')} gain={calc.brutImposable} strong />
        <Line label={t('slip.cnpsRetraite')} base={calc.baseCotisable} taux="6,3 %" retenue={calc.cnpsRetraite} />
        <Line label={t('slip.cmu')} retenue={calc.cmu} />
        <Line label={t('slip.impotBrut')} base={calc.brutImposable} retenue={calc.impotBrutAvantRicf} />
        {calc.reductionRicf > 0 && <Line label={t('slip.ricf')} retenue={-calc.reductionRicf} />}
        <Line label={t('slip.its')} retenue={calc.impotNet} strong />
      </div>
      <div className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <span className="text-sm font-semibold uppercase tracking-wide">{t('slip.netAPayer')}</span>
        <span className="text-lg font-bold">{formatFCFA(calc.netAPayer, locale)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-2 text-xs text-stone-500">
        <span>{t('slip.parts')} : {calc.parts} · {t('slip.seniority')} : {t('slip.years', { n: anciennete })}</span>
        <span className="text-right">{t('slip.coutTotal')} : {formatFCFA(calc.coutTotalEmployeur, locale)}</span>
      </div>
      {calc.sursalaire === 0 && calc.netAPayer > calc.netCible + 1 && (
        <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {t('slip.netWarning', { net: formatFCFA(calc.netAPayer, locale) })}
        </p>
      )}
    </Card>
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
    if (slips && slips.length) imprimerBulletins(slips, { t, locale });
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
            <Button variant="secondary" onClick={print}>{t('bulletins.print', { n: slips.length })}</Button>
          )}
        </div>
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
              </div>
              <InfoNote>{t('bulletins.previewNote')}</InfoNote>
              <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {slips.slice(0, 6).map((s, i) => <SlipPreview key={i} data={s} />)}
              </div>
              {slips.length > 6 && (
                <p className="mt-3 text-center text-xs text-stone-500">+ {slips.length - 6} …</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
