import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { calculerSolde, telechargerSolde, MOTIFS_RUPTURE } from '../lib/soldeToutCompte';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, StatCard } from '../components/ui';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Outil d'aide au calcul du solde de tout compte, sur le même principe
// interactif que le Simulateur : rien n'est enregistré, le motif de rupture
// choisi détermine quels éléments légaux s'appliquent (voir soldeToutCompte.js).
export default function SoldeToutCompte() {
  const { settings, employees, congesPris } = useStore();
  const { t, locale } = useI18n();

  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [dateSortie, setDateSortie] = useState(todayIso());
  const [motif, setMotif] = useState(MOTIFS_RUPTURE[0].value);
  const [joursPreavis, setJoursPreavis] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');

  const employee = employees.find((e) => e.id === employeeId) || null;
  const ymSortie = dateSortie.slice(0, 7);
  const motifDef = MOTIFS_RUPTURE.find((m) => m.value === motif) || MOTIFS_RUPTURE[0];

  const congesEmploye = useMemo(
    () => (congesPris || []).filter((c) => c.employeeId === employeeId),
    [congesPris, employeeId]
  );

  const solde = useMemo(() => {
    if (!employee || !ymSortie) return null;
    return calculerSolde(employee, ymSortie, motif, joursPreavis, settings, congesEmploye);
  }, [employee, ymSortie, motif, joursPreavis, settings, congesEmploye]);

  const print = async () => {
    if (!solde || !employee || exporting) return;
    setNotice('');
    setExporting(true);
    try {
      const ok = await telechargerSolde(employee, ymSortie, solde, settings, { locale });
      setNotice(ok ? t('solde.printed') : t('solde.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageTitle>{t('solde.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('solde.subtitle')}</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">{t('solde.profil')}</h2>
          {employees.length === 0 ? (
            <InfoNote>{t('bulletins.noEmployees')}</InfoNote>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              <Field label={t('bulletins.employee')}>
                <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
                </select>
              </Field>
              <Field label={t('solde.dateSortie')} help={t('solde.dateSortieHelp')}>
                <input className={inputClass} type="date" value={dateSortie} onChange={(e) => setDateSortie(e.target.value)} />
              </Field>
              <Field label={t('solde.motif')}>
                <select className={inputClass} value={motif} onChange={(e) => setMotif(e.target.value)}>
                  {MOTIFS_RUPTURE.map((m) => <option key={m.value} value={m.value}>{m.libelle}</option>)}
                </select>
              </Field>
              {motifDef.preavisEligible && (
                <Field label={t('solde.joursPreavis')} help={t('solde.joursPreavisHelp')}>
                  <input className={inputClass} type="number" min="0" max="30" value={joursPreavis} onChange={(e) => setJoursPreavis(e.target.value)} />
                </Field>
              )}
            </div>
          )}
        </Card>

        <div className="lg:col-span-3">
          {!solde ? (
            <InfoNote>{t('solde.empty')}</InfoNote>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button onClick={print} disabled={exporting}>
                  {exporting ? t('solde.printing') : t('solde.print')}
                </Button>
                {notice && (
                  <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-800">{notice}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard label={t('solde.salaireMoyen')} value={formatFCFA(solde.salaireMoyen, locale)} tip={t('solde.salaireMoyenTip')} />
                <StatCard label={t('solde.total')} value={formatFCFA(solde.total, locale)} tone="brand" tip={t('solde.totalTip')} />
              </div>

              <Card className="mt-4 p-4">
                <h2 className="mb-2 text-sm font-semibold text-stone-800">{t('solde.detail')}</h2>
                <ul className="divide-y divide-stone-50 text-sm">
                  <li className="flex items-center justify-between py-1.5">
                    <span className="text-stone-600">
                      {solde.ruptureAnticipeeCdd
                        ? `${t('solde.indemniteRuptureCdd')} (${solde.moisRestantsCdd} mois)`
                        : `${t('solde.indemniteLicenciement')} (${solde.anciennete} an(s))`}
                    </span>
                    <span className="font-medium text-stone-800">{formatFCFA(solde.licenciement, locale)}</span>
                  </li>
                  <li className="flex items-center justify-between py-1.5">
                    <span className="text-stone-600">
                      {t('solde.indemniteConges')} ({solde.joursConges} j)
                      {solde.joursPrisCycle > 0 && (
                        <span className="ml-1 text-xs text-stone-400">
                          ({solde.joursAcquis} j {t('solde.joursAcquisAbrege')} − {solde.joursPrisCycle} j {t('solde.joursDejaPrisAbrege')})
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-stone-800">{formatFCFA(solde.conges, locale)}</span>
                  </li>
                  <li className="flex items-center justify-between py-1.5">
                    <span className="text-stone-600">{t('solde.primePrecarite')}</span>
                    <span className="font-medium text-stone-800">{formatFCFA(solde.precarite, locale)}</span>
                  </li>
                  <li className="flex items-center justify-between py-1.5">
                    <span className="text-stone-600">{t('solde.indemnitePreavis')} ({solde.joursPreavis} j)</span>
                    <span className="font-medium text-stone-800">{formatFCFA(solde.preavis, locale)}</span>
                  </li>
                  <li className="flex items-center justify-between border-t border-stone-100 py-1.5 font-semibold">
                    <span>{t('solde.total')}</span>
                    <span>{formatFCFA(solde.total, locale)}</span>
                  </li>
                </ul>
                {solde.ruptureAnticipeeCdd && <InfoNote>{t('solde.ruptureCddNote')}</InfoNote>}
                <InfoNote>{t('solde.disclaimer')}</InfoNote>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
