import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore, useActivePeriod } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { listerMois, libelleMois, periodeEffective } from '../lib/payroll';
import { bulletinData, imprimerBulletins, telechargerBulletins, slipDocumentHtml } from '../lib/bulletin';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote, Badge, TableWrap, th, td, EmployeeNav } from '../components/ui';

// Aperçu fidèle : on affiche EXACTEMENT le bulletin imprimé (part salariale ET
// part patronale, cumuls, net) dans un iframe isolé. « Ce qui est affiché est
// ce qui est imprimé. » L'iframe s'ajuste à la hauteur de son contenu.
// Actions individuelles : téléchargement du seul PDF de ce salarié, et
// préparation d'un email pré-rempli (le navigateur ne peut pas joindre un
// fichier automatiquement à un mailto: — l'utilisateur doit attacher
// lui-même le PDF juste téléchargé, ce qui est clairement expliqué).
function SlipPreview({ data }) {
  const { t, locale } = useI18n();
  const html = slipDocumentHtml([data], { t, locale });
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const onLoad = (ev) => {
    try {
      const doc = ev.target.contentDocument;
      ev.target.style.height = `${doc.documentElement.scrollHeight + 8}px`;
    } catch {
      /* iframe inaccessible : on garde la hauteur par défaut */
    }
  };

  const downloadOne = async () => {
    setNotice('');
    setExporting(true);
    try {
      const ok = await telechargerBulletins([data], { t, locale });
      setNotice(ok ? t('bulletins.downloaded') : t('bulletins.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  const email = data.employee.email;
  const mois = libelleMois(data.ym, locale);
  const mailtoHref = email
    ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(t('bulletins.emailSubject', { mois }))}&body=${encodeURIComponent(t('bulletins.emailBody', { nom: data.employee.nom, mois }))}`
    : null;

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
        <p className="mr-auto text-sm font-medium text-stone-700">{data.employee.nom}</p>
        <Button variant="secondary" onClick={downloadOne} disabled={exporting}>
          {exporting ? t('bulletins.generating') : t('bulletins.downloadOne')}
        </Button>
        {mailtoHref ? (
          <a href={mailtoHref} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
            {t('bulletins.prepareEmail')}
          </a>
        ) : (
          <span className="text-xs text-stone-400" title={t('bulletins.noEmailHelp')}>{t('bulletins.noEmail')}</span>
        )}
        {notice && <span className="text-xs text-brand-700">{notice}</span>}
      </div>
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
  const { settings, employees, versements } = useStore();
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const preEmp = params.get('e');

  // Mois par défaut choisi via le bouton « Base » (en-tête) — l'utilisateur
  // reste ensuite libre d'ajuster la plage from/to depuis cette page.
  const ym = useActivePeriod();
  const [scope, setScope] = useState(preEmp ? 'one' : 'all');
  const [employeeId, setEmployeeId] = useState(preEmp || employees[0]?.id || '');
  const [from, setFrom] = useState(ym);
  const [to, setTo] = useState(ym);
  const [slips, setSlips] = useState(null);
  // Étape 2/2 (édition/impression), débloquée seulement après le contrôle du
  // calcul (étape 1/2, voir plus bas) — même principe qu'un vrai logiciel de
  // paie (Sage…) : on calcule et on vérifie AVANT d'éditer quoi que ce soit.
  const [edition, setEdition] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);

  const rangeOk = from <= to;

  // Salariés PRÉSENTS sur au moins un mois de la plage sélectionnée, d'après
  // leur date d'embauche enregistrée et leurs périodes contractuelles (voir
  // payroll.js#periodeEffective) — un salarié pas encore embauché sur toute
  // la plage n'apparaît pas dans le sélecteur « Salarié » ci-dessous.
  const employeesPourPlage = useMemo(() => {
    if (!rangeOk) return employees;
    const months = listerMois(from, to);
    return employees.filter((e) => months.some((m) => periodeEffective(e, m)));
  }, [employees, from, to, rangeOk]);

  // Si la plage change et que le salarié sélectionné n'y était pas présent,
  // on retombe sur le premier salarié valide plutôt que de garder une
  // sélection fantôme.
  useEffect(() => {
    if (scope === 'one' && employeesPourPlage.length && !employeesPourPlage.some((e) => e.id === employeeId)) {
      setEmployeeId(employeesPourPlage[0].id);
    }
  }, [scope, employeesPourPlage, employeeId]);

  // Précédent/Suivant : navigue dans la liste affichée par le sélecteur
  // ci-dessous (même filtrage par période), pour traiter les bulletins
  // salarié par salarié sans revenir au menu déroulant à chaque fois.
  const employeeIndex = employeesPourPlage.findIndex((e) => e.id === employeeId);
  const goEmployee = (idx) => {
    if (idx < 0 || idx >= employeesPourPlage.length) return;
    setEmployeeId(employeesPourPlage[idx].id);
  };

  const build = () => {
    setError('');
    setNotice('');
    setEdition(false);
    if (employees.length === 0) { setError(t('bulletins.noEmployees')); return; }
    if (!rangeOk) { setError(t('bulletins.badRange')); return; }
    const months = listerMois(from, to);

    let targets;
    if (scope === 'one') {
      const emp = employees.find((e) => e.id === employeeId);
      // Bloquant : un salarié sous contrôle ne peut pas voir ses bulletins
      // générés (même individuellement) tant que le contrôle n'est pas levé.
      if (emp?.sousControle) {
        setError(t('employees.blockedControleOne', { nom: emp.nom }));
        return;
      }
      targets = emp ? [emp] : [];
    } else {
      const blocked = employees.filter((e) => e.sousControle);
      targets = employees.filter((e) => !e.sousControle);
      if (blocked.length > 0) {
        setNotice(t('employees.blockedControle', { nom: blocked.map((e) => e.nom).join(', ') }));
      }
    }

    const out = [];
    for (const e of targets) {
      for (const m of months) {
        // Le n° de versement CNPS/CMU réel (voir Cotisations) est propre à
        // chaque mois — on l'injecte dans les settings au moment de générer
        // CE mois précis, sans toucher à la signature de bulletinData.
        const v = versements?.[m];
        const settingsMois = v ? { ...settings, versementCnps: v.numeroCnps, versementCnam: v.numeroCnam } : settings;
        const bd = bulletinData(e, m, settingsMois);
        if (bd) out.push(bd);
      }
    }
    setSlips(out);
  };

  const runExport = async (fn) => {
    if (!slips || !slips.length || exporting) return;
    setNotice('');
    setExporting(true);
    try {
      const ok = await fn(slips, { t, locale });
      setNotice(ok ? t('bulletins.downloaded') : t('bulletins.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  const print = () => runExport(imprimerBulletins);
  const download = () => runExport(telechargerBulletins);

  const total = useMemo(
    () => (slips || []).reduce((a, s) => a + s.calc.netAPayer, 0),
    [slips]
  );

  // Contrôle du calcul (étape 1/2) : un bulletin est en anomalie si le net à
  // payer calculé n'est pas strictement positif — presque toujours le signe
  // d'une saisie à corriger (net cible, prime/retenue ponctuelle…) plutôt
  // qu'un montant à éditer tel quel. Purement indicatif : rien n'est jamais
  // bloqué, l'utilisateur reste seul décideur (voir Employees.jsx et
  // l'ensemble de l'appli).
  const controle = useMemo(() => {
    if (!slips) return null;
    const lignes = slips.map((s) => ({ slip: s, anomalie: !(s.calc.netAPayer > 0) }));
    const anomalies = lignes.filter((l) => l.anomalie).length;
    const totaux = slips.reduce(
      (a, s) => ({
        brut: a.brut + s.calc.brutTotal,
        net: a.net + s.calc.netAPayer,
        cout: a.cout + s.calc.coutTotalEmployeur
      }),
      { brut: 0, net: 0, cout: 0 }
    );
    return { lignes, anomalies, totaux };
  }, [slips]);

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
              <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={employeesPourPlage.length === 0}>
                {employeesPourPlage.length === 0
                  ? <option value="">{t('bulletins.noEmployeesRange')}</option>
                  : employeesPourPlage.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
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
        {scope === 'one' && employeesPourPlage.length > 0 && (
          <div className="mt-3">
            <EmployeeNav
              index={employeeIndex}
              total={employeesPourPlage.length}
              onPrev={() => goEmployee(employeeIndex - 1)}
              onNext={() => goEmployee(employeeIndex + 1)}
            />
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={build}>{t('bulletins.calculer')}</Button>
        </div>
        {notice && (
          <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {/* Étape 1/2 — Calcul et contrôle : les montants calculés, AVANT toute
          édition, comme un vrai calcul de paie (Sage…) qu'on vérifie avant
          de sortir les bulletins. */}
      {slips && !edition && (
        <div className="mt-5">
          {slips.length === 0 ? (
            <InfoNote>{t('bulletins.none')}</InfoNote>
          ) : (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-stone-800">{t('bulletins.controleTitle')}</h2>
                {controle.anomalies > 0 ? (
                  <Badge tone="danger">{t('bulletins.anomalies', { n: controle.anomalies })}</Badge>
                ) : (
                  <Badge tone="success">{t('bulletins.aucuneAnomalie')}</Badge>
                )}
              </div>
              <InfoNote>{t('bulletins.controleHelp')}</InfoNote>
              <div className="mt-3">
                <TableWrap min={640}>
                  <thead>
                    <tr>
                      <th className={th}>{t('bulletins.employee')}</th>
                      <th className={th}>{t('livrePaie.month')}</th>
                      <th className={`${th} text-right`}>{t('slip.brutTotal')}</th>
                      <th className={`${th} text-right`}>{t('slip.netAPayer')}</th>
                      <th className={`${th} text-right`}>{t('slip.coutTotal')}</th>
                      <th className={th}>{t('bulletins.statut')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {controle.lignes.map(({ slip: s, anomalie }, i) => (
                      <tr key={i} className={anomalie ? 'bg-red-50/60' : undefined}>
                        <td className={td}>{s.employee.nom}</td>
                        <td className={`${td} capitalize`}>{libelleMois(s.ym, locale)}</td>
                        <td className={`${td} text-right`}>{formatFCFA(s.calc.brutTotal, locale)}</td>
                        <td className={`${td} text-right font-medium`}>{formatFCFA(s.calc.netAPayer, locale)}</td>
                        <td className={`${td} text-right`}>{formatFCFA(s.calc.coutTotalEmployeur, locale)}</td>
                        <td className={td}>
                          {anomalie ? <Badge tone="danger">{t('bulletins.anomalie')}</Badge> : <Badge tone="success">OK</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-stone-200 font-semibold">
                      <td className={td} colSpan={2}>{t('bulletins.totalLigne')}</td>
                      <td className={`${td} text-right`}>{formatFCFA(controle.totaux.brut, locale)}</td>
                      <td className={`${td} text-right`}>{formatFCFA(controle.totaux.net, locale)}</td>
                      <td className={`${td} text-right`}>{formatFCFA(controle.totaux.cout, locale)}</td>
                      <td className={td}></td>
                    </tr>
                  </tfoot>
                </TableWrap>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setEdition(true)}>{t('bulletins.editer')}</Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Étape 2/2 — Édition/impression des bulletins, débloquée après le
          contrôle ci-dessus. */}
      {slips && edition && slips.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setEdition(false)}>{t('bulletins.retourControle')}</Button>
            <p className="text-sm text-stone-600">
              {t('bulletins.count', { n: slips.length })} ·{' '}
              <span className="font-semibold text-stone-800">{t('slip.netAPayer')} : {formatFCFA(total, locale)}</span>
            </p>
            <div className="flex gap-2">
              <Button onClick={print} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('bulletins.print', { n: slips.length })}
              </Button>
              <Button variant="secondary" onClick={download} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('bulletins.download')}
              </Button>
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
        </div>
      )}
    </div>
  );
}
