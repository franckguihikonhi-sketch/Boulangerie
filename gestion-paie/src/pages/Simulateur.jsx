import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { SITUATIONS, paramsFromSettings } from '../lib/db';
import { calculerDepuisNet, MAJORATIONS_HEURES_SUP, BAREME_CATEGORIES, salaireMinimumCategoriel } from '../lib/payroll';
import { formatFCFA } from '../lib/money';
import { telechargerSimulation } from '../lib/simulateurDoc';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote, StatCard } from '../components/ui';

// Simulateur de coût d'embauche : à partir d'un profil (salaire de base,
// net visé, situation…), calcule EXACTEMENT le même détail qu'un bulletin
// réel (moteur payroll.js partagé), sans rien enregistrer nulle part — pur
// outil d'aide à la décision avant de recruter.

function emptyPrime() {
  return { label: '', montant: '', imposable: true };
}

function emptyHeureSup() {
  return { heures: '', majoration: MAJORATIONS_HEURES_SUP[0].valeur };
}

export default function Simulateur() {
  const { settings } = useStore();
  const { t, locale } = useI18n();
  const params = paramsFromSettings(settings);

  const [form, setForm] = useState({
    salaireBase: 100000,
    netCible: 130000,
    transport: 30000,
    situation: 'celibataire',
    enfants: 0,
    anciennete: 0,
    expatrie: false,
    categorie: ''
  });
  const [primes, setPrimes] = useState([]);
  const [heuresSup, setHeuresSup] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addPrime = () => setPrimes((p) => [...p, emptyPrime()]);
  const setPrime = (i, patch) => setPrimes((p) => p.map((pr, idx) => (idx === i ? { ...pr, ...patch } : pr)));
  const removePrime = (i) => setPrimes((p) => p.filter((_, idx) => idx !== i));

  const addHeureSup = () => setHeuresSup((h) => [...h, emptyHeureSup()]);
  const setHeureSup = (i, patch) => setHeuresSup((h) => h.map((hs, idx) => (idx === i ? { ...hs, ...patch } : hs)));
  const removeHeureSup = (i) => setHeuresSup((h) => h.filter((_, idx) => idx !== i));

  const calc = useMemo(() => {
    const salaireBase = Number(form.salaireBase) || 0;
    const netCible = Number(form.netCible) || 0;
    if (salaireBase <= 0 || netCible <= 0) return null;
    return calculerDepuisNet(
      netCible,
      {
        salaireBase,
        transport: Number(form.transport) || 0,
        situation: form.situation,
        enfants: Number(form.enfants) || 0,
        anciennete: Number(form.anciennete) || 0,
        expatrie: form.expatrie,
        primes: primes
          .filter((p) => Number(p.montant) > 0)
          .map((p) => ({ label: p.label || 'Prime', montant: Number(p.montant) || 0, imposable: p.imposable !== false })),
        heuresSupplementaires: heuresSup
          .filter((h) => Number(h.heures) > 0)
          .map((h) => ({ heures: Number(h.heures) || 0, majoration: Number(h.majoration) || 0 }))
      },
      params
    );
  }, [form, primes, heuresSup, params]);

  // Garde-fou STRICT, identique à la fiche salarié : sans catégorie reconnue
  // du barème (champ vide), aucune contrainte n'est signalée.
  const minCategoriel = salaireMinimumCategoriel(form.categorie);
  const salaireSousMinimum = minCategoriel != null && (Number(form.salaireBase) || 0) < minCategoriel;

  const print = async () => {
    if (!calc || exporting) return;
    setNotice('');
    setExporting(true);
    try {
      const ok = await telechargerSimulation({ form, calc, settings }, { t, locale });
      setNotice(ok ? t('simulateur.printed') : t('simulateur.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  const patronalRows = calc
    ? [
        [t('simulateur.retraitePat'), calc.patronal.retraite],
        [t('simulateur.prestationsFam'), calc.patronal.prestationsFamiliales],
        [t('simulateur.accidentTravail'), calc.patronal.accidentTravail],
        [t('simulateur.isLocal'), calc.patronal.isLocal],
        ...(calc.expatrie ? [[t('simulateur.isExpatrie'), calc.patronal.isExpatrie]] : []),
        [t('simulateur.taxeApprentissage'), calc.patronal.taxeApprentissage],
        [t('simulateur.fpc'), calc.patronal.fpc],
        [t('simulateur.cmuPat'), calc.patronal.cmu]
      ]
    : [];

  return (
    <div>
      <PageTitle>{t('simulateur.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('simulateur.subtitle')}</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">{t('simulateur.profil')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('period.salaireBase')}>
              <input className={inputClass} type="number" min="0" value={form.salaireBase} onChange={(e) => set('salaireBase', e.target.value)} />
            </Field>
            <Field label={t('period.netCible')} help={t('simulateur.netCibleHelp')}>
              <input className={inputClass} type="number" min="0" value={form.netCible} onChange={(e) => set('netCible', e.target.value)} />
            </Field>
            <Field label={t('period.transport')}>
              <input className={inputClass} type="number" min="0" value={form.transport} onChange={(e) => set('transport', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('employees.categorie')} help={t('employees.categorieHelp')}>
                <select className={inputClass} value={form.categorie} onChange={(e) => set('categorie', e.target.value)}>
                  <option value="">{t('employees.categorieNonClassee')}</option>
                  <optgroup label={t('employees.groupeAgentMaitrise')}>
                    {BAREME_CATEGORIES.filter((c) => c.groupe === 'EMPLOYE_AGENT_MAITRISE').map((c) => (
                      <option key={c.categorie} value={c.categorie}>
                        {c.categorie}{c.definition ? ` (${c.definition})` : ''} — min. {formatFCFA(c.salaireMin)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('employees.groupeCadre')}>
                    {BAREME_CATEGORIES.filter((c) => c.groupe === 'CADRE').map((c) => (
                      <option key={c.categorie} value={c.categorie}>
                        {c.categorie} — min. {formatFCFA(c.salaireMin)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              {salaireSousMinimum && (
                <div className="mt-2">
                  <ErrorNote>
                    {t('employees.salaireSousMinimum', {
                      categorie: form.categorie,
                      min: formatFCFA(minCategoriel),
                      salaire: formatFCFA(Number(form.salaireBase) || 0)
                    })}
                  </ErrorNote>
                </div>
              )}
            </div>
            <Field label={t('employees.situation')}>
              <select className={inputClass} value={form.situation} onChange={(e) => set('situation', e.target.value)}>
                {SITUATIONS.map((s) => <option key={s} value={s}>{t('situation.' + s)}</option>)}
              </select>
            </Field>
            <Field label={t('employees.children')}>
              <input className={inputClass} type="number" min="0" value={form.enfants} onChange={(e) => set('enfants', e.target.value)} />
            </Field>
            <Field label={t('simulateur.anciennete')} help={t('simulateur.ancienneteHelp')}>
              <input className={inputClass} type="number" min="0" value={form.anciennete} onChange={(e) => set('anciennete', e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700 sm:col-span-2">
              <input type="checkbox" checked={form.expatrie} onChange={(e) => set('expatrie', e.target.checked)} />
              {t('employees.expatrie')}
            </label>
          </div>

          <div className="mt-4 border-t border-stone-100 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">{t('period.primes')}</span>
              <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={addPrime}>
                + {t('period.addPrime')}
              </button>
            </div>
            {primes.map((pr, i) => (
              <div key={i} className="mb-1 flex items-center gap-2">
                <input className={inputClass + ' flex-1'} value={pr.label} onChange={(e) => setPrime(i, { label: e.target.value })} placeholder={t('period.primeLabel')} />
                <input className={inputClass + ' w-28'} type="number" min="0" value={pr.montant} onChange={(e) => setPrime(i, { montant: e.target.value })} placeholder={t('period.primeMontant')} />
                <label className="flex items-center gap-1 whitespace-nowrap text-xs text-stone-600">
                  <input type="checkbox" checked={pr.imposable !== false} onChange={(e) => setPrime(i, { imposable: e.target.checked })} />
                  {t('period.primeImposable')}
                </label>
                <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removePrime(i)} aria-label={t('period.remove')}>✕</button>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-stone-100 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">{t('period.heuresSup')}</span>
              <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={addHeureSup}>
                + {t('period.addHeureSup')}
              </button>
            </div>
            {heuresSup.map((h, i) => (
              <div key={i} className="mb-1 flex items-center gap-2">
                <input className={inputClass + ' w-24'} type="number" min="0" step="0.5" value={h.heures} onChange={(e) => setHeureSup(i, { heures: e.target.value })} placeholder={t('period.heuresSupNombre')} />
                <select className={inputClass + ' flex-1'} value={h.majoration} onChange={(e) => setHeureSup(i, { majoration: Number(e.target.value) })}>
                  {MAJORATIONS_HEURES_SUP.map((m) => <option key={m.valeur} value={m.valeur}>{m.label}</option>)}
                </select>
                <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removeHeureSup(i)} aria-label={t('period.remove')}>✕</button>
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-3">
          {!calc ? (
            <InfoNote>{t('simulateur.empty')}</InfoNote>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button onClick={print} disabled={exporting}>
                  {exporting ? t('simulateur.printing') : t('simulateur.print')}
                </Button>
                {notice && (
                  <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-800">{notice}</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard
                  label={t('period.sursalaire')}
                  value={formatFCFA(calc.sursalaire, locale)}
                  tip={t('simulateur.sursalaireTip')}
                />
                <StatCard label={t('simulateur.brutImposable')} value={formatFCFA(calc.brutImposable, locale)} tip={t('simulateur.brutImposableTip')} />
                <StatCard label={t('slip.netAPayer')} value={formatFCFA(calc.netAPayer, locale)} tone="good" tip={t('simulateur.netTip')} />
                <StatCard label={t('simulateur.totalPatronal')} value={formatFCFA(calc.totalPatronal, locale)} tone="bad" tip={t('simulateur.totalPatronalTip')} />
                <StatCard
                  label={t('simulateur.coutTotal')}
                  value={formatFCFA(calc.coutTotalEmployeur, locale)}
                  tone="brand"
                  tip={t('simulateur.coutTotalTip')}
                  sub={t('simulateur.coutTotalSub', { pct: ((calc.coutTotalEmployeur / calc.netAPayer - 1) * 100).toFixed(0) })}
                />
              </div>

              <Card className="mt-4 p-4">
                <h2 className="mb-2 text-sm font-semibold text-stone-800">{t('simulateur.detailPatronal')}</h2>
                <ul className="divide-y divide-stone-50 text-sm">
                  {patronalRows.map(([label, montant]) => (
                    <li key={label} className="flex items-center justify-between py-1.5">
                      <span className="text-stone-600">{label}</span>
                      <span className="font-medium text-stone-800">{formatFCFA(montant, locale)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between border-t border-stone-100 py-1.5 font-semibold">
                    <span>{t('simulateur.totalPatronal')}</span>
                    <span>{formatFCFA(calc.totalPatronal, locale)}</span>
                  </li>
                </ul>
                <InfoNote>{t('simulateur.disclaimer')}</InfoNote>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
