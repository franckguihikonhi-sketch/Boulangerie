// ===========================================================================
// SOLDE DE TOUT COMPTE
// ---------------------------------------------------------------------------
// Calcule les indemnités dues à la rupture d'un contrat, EN SUS du dernier
// salaire (déjà couvert par le bulletin du mois de sortie — voir bulletin.js
// pour le prorata automatique d'un mois incomplet). Le motif de rupture
// détermine QUELS éléments s'appliquent légalement ; c'est à l'utilisateur de
// confirmer le motif réel, rien n'est jamais déduit automatiquement. Outil
// d'aide au calcul, comme le Simulateur : rien n'est enregistré nulle part.
// ===========================================================================

import { formatFCFA, formatNum, roundFCFA } from './money';
import {
  anneesAnciennete, indemniteLicenciement, indemniteRuptureAnticipeeCdd, indemniteCongesNonPris,
  primePrecarite, indemnitePreavis, congesEnCours, cycleConges, libelleMois, periodeEffective, moisEntre, moisSuivant
} from './payroll';
import { bulletinData } from './bulletin';
import { exportHtmlToPdf } from './pdfExport';

// Chaque motif détermine les éléments dus, conformément au Code du travail
// ivoirien / Convention Collective Interprofessionnelle : l'indemnité de
// licenciement et le préavis ne sont dus qu'en cas de rupture à l'initiative
// de l'employeur hors faute lourde ; l'indemnité de congés non pris est due
// dans TOUS les cas (elle rémunère un droit déjà acquis) ; la prime de
// précarité ne concerne que la fin normale d'un CDD non transformé en CDI.
export const MOTIFS_RUPTURE = [
  { value: 'licenciement', libelle: 'Licenciement (hors faute lourde)', indemniteLicenciement: true, indemniteConges: true, preavisEligible: true, precarite: false },
  { value: 'licenciement_economique', libelle: 'Licenciement économique', indemniteLicenciement: true, indemniteConges: true, preavisEligible: true, precarite: false },
  { value: 'rupture_amiable', libelle: "Rupture d'un commun accord", indemniteLicenciement: true, indemniteConges: true, preavisEligible: false, precarite: false },
  { value: 'faute_lourde', libelle: 'Licenciement pour faute lourde', indemniteLicenciement: false, indemniteConges: true, preavisEligible: false, precarite: false },
  { value: 'demission', libelle: 'Démission', indemniteLicenciement: false, indemniteConges: true, preavisEligible: false, precarite: false },
  { value: 'fin_cdd', libelle: 'Fin de CDD (terme normal, non renouvelé en CDI)', indemniteLicenciement: false, indemniteConges: true, preavisEligible: false, precarite: true }
];

// Salaire moyen mensuel BRUT des 12 derniers mois travaillés (au maximum) —
// base légale de l'indemnité de licenciement et de l'indemnité de congés
// non pris.
function salaireMoyen12Mois(employee, ymSortie, settings) {
  let [y, m] = ymSortie.split('-').map(Number);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 12; i++) {
    const bd = bulletinData(employee, `${y}-${String(m).padStart(2, '0')}`, settings);
    if (bd) { sum += bd.calc.brutImposable; count += 1; }
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return count ? Math.round(sum / count) : 0;
}

// Cumul du brut TOTAL versé sur l'ensemble des périodes CDD de l'employé
// (renouvellements inclus), du tout premier mois de CDD à `ymSortie` inclus
// — base de la prime de précarité (3 % de la rémunération brute totale du
// CDD, tous renouvellements confondus).
function cumulBrutCdd(employee, ymSortie, settings) {
  const debutsCdd = (employee.periodes || [])
    .filter((p) => p.kind === 'cdd' && p.debut)
    .map((p) => p.debut)
    .sort();
  if (debutsCdd.length === 0) return 0;
  let [y, m] = debutsCdd[0].split('-').map(Number);
  const [ySortie, mSortie] = ymSortie.split('-').map(Number);
  let sum = 0;
  let garde = 0;
  while ((y < ySortie || (y === ySortie && m <= mSortie)) && garde < 600) {
    const bd = bulletinData(employee, `${y}-${String(m).padStart(2, '0')}`, settings);
    if (bd && bd.periode.kind === 'cdd') sum += bd.calc.brutTotal;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    garde += 1;
  }
  return sum;
}

// Calcule le détail complet du solde de tout compte pour un salarié, un mois
// de sortie (« aaaa-mm ») et un motif donnés. `joursPreavis` : nombre de
// jours de préavis NON exécutés à indemniser (0 si le préavis a été
// travaillé ou n'est pas dû) — la durée légale/conventionnelle du préavis
// varie selon la catégorie professionnelle et n'est pas devinée ici.
// `congesPris` (facultatif) : historique des congés effectivement posés par
// le salarié (voir db.js#congesDeEmployee, onglet Congés) — les jours déjà
// pris sur le cycle d'acquisition en cours à la date de sortie (voir
// payroll.js#cycleConges) sont déduits des jours acquis avant de calculer
// l'indemnité compensatrice, pour ne jamais payer deux fois un congé déjà
// consommé par le salarié.
export function calculerSolde(employee, ymSortie, motifValue, joursPreavis, settings, congesPris = []) {
  const motif = MOTIFS_RUPTURE.find((m) => m.value === motifValue) || MOTIFS_RUPTURE[0];
  const anciennete = anneesAnciennete(employee.dateEmbauche, `${ymSortie}-01`);
  const salaireMoyen = salaireMoyen12Mois(employee, ymSortie, settings);
  const joursAcquis = congesEnCours(employee.dateEmbauche, ymSortie);
  const cycleSortie = cycleConges(employee.dateEmbauche, ymSortie);
  const joursPrisCycle = cycleSortie
    ? (congesPris || [])
        .filter((c) => {
          const ymDebut = (c.debut || '').slice(0, 7);
          return ymDebut >= cycleSortie.debut && ymDebut <= cycleSortie.fin;
        })
        .reduce((sum, c) => sum + (Number(c.jours) || 0), 0)
    : 0;
  const joursConges = Math.max(0, Math.round((joursAcquis - joursPrisCycle) * 10) / 10);

  // Un CDD encore en cours (non requalifié en CDI, voir CDD_MAX_MOIS) rompu
  // avant son terme par l'employeur (ou d'un commun accord) ne suit PAS le
  // barème d'indemnité de licenciement du CDI : la règle est une réparation
  // égale aux salaires restant à courir jusqu'au terme prévu du contrat. La
  // fin normale d'un CDD (motif « fin_cdd ») n'est jamais concernée — elle
  // n'ouvre déjà aucun droit à l'indemnité de licenciement, seulement à la
  // prime de précarité.
  const periode = periodeEffective(employee, ymSortie);
  const cddEnCours = periode?.kind === 'cdd' && !periode.requalifieCdi;
  const ruptureAnticipeeCdd = motif.indemniteLicenciement && cddEnCours && !!periode.fin;
  const moisRestantsCdd = ruptureAnticipeeCdd ? Math.max(0, moisEntre(moisSuivant(ymSortie), periode.fin)) : 0;

  const licenciement = !motif.indemniteLicenciement
    ? 0
    : ruptureAnticipeeCdd
      ? indemniteRuptureAnticipeeCdd(salaireMoyen, moisRestantsCdd)
      : indemniteLicenciement(salaireMoyen, anciennete);
  const conges = motif.indemniteConges ? indemniteCongesNonPris(salaireMoyen, joursConges) : 0;
  const precarite = motif.precarite ? primePrecarite(cumulBrutCdd(employee, ymSortie, settings)) : 0;
  const joursPreavisEff = motif.preavisEligible ? Math.max(0, Number(joursPreavis) || 0) : 0;
  const preavis = joursPreavisEff > 0 ? indemnitePreavis(salaireMoyen, joursPreavisEff) : 0;

  const total = roundFCFA(licenciement + conges + precarite + preavis);

  return {
    motif, anciennete, salaireMoyen, joursAcquis, joursPrisCycle, joursConges, joursPreavis: joursPreavisEff,
    ruptureAnticipeeCdd, moisRestantsCdd, licenciement, conges, precarite, preavis, total
  };
}

// --------------------------- Fiche imprimable -------------------------------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .fiche { background: #fff; max-width: 720px; margin: 16px auto; padding: 22px 26px; border: 1px solid #e7e5e4; border-radius: 8px; }
  .head { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 14px; }
  .badge { display: inline-block; color: #1c1917; font-size: 18px; font-weight: 700; letter-spacing: .06em; margin: 0; }
  .head .sub { font-size: 11px; color: #57534e; margin: 4px 0 0; }
  .ident { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; font-size: 11.5px; }
  .ident p { margin: 1.5px 0; }
  .ident .lbl { color: #78716c; }
  table.tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
  table.tbl th, table.tbl td { padding: 5px 8px; border: 1px solid #ececeb; }
  table.tbl thead th { background: #eef2ff; color: #3730a3; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; text-align: left; }
  table.tbl td.lib, table.tbl th.lib { text-align: left; }
  table.tbl .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.tbl tr.tot td { font-weight: 800; background: #eef2ff; border-top: 2px solid #c7d2fe; font-size: 13px; color: #3730a3; }
  .note { margin-top: 10px; font-size: 10px; color: #78716c; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 10px; line-height: 1.5; }
  .foot { margin-top: 14px; font-size: 8.5px; color: #a8a29e; text-align: center; line-height: 1.5; }
  body.pdf-export { background: #fff; }
  body.pdf-export .fiche { border: none; margin: 0; padding: 15mm; max-width: none; }
`;

export function soldeDocumentHtml(employee, ymSortie, solde, settings, { locale } = {}) {
  const money = (n) => (n ? formatNum(n, locale) : '0');
  const rows = [
    ...(solde.licenciement > 0
      ? [[solde.ruptureAnticipeeCdd
          ? `Dommages-intérêts pour rupture anticipée du CDD (${solde.moisRestantsCdd} mois restant au contrat)`
          : 'Indemnité de licenciement', solde.licenciement]]
      : []),
    ...(solde.conges > 0
      ? [[`Indemnité compensatrice de congés payés (${solde.joursConges} j${solde.joursPrisCycle > 0 ? ` — ${solde.joursAcquis} j acquis moins ${solde.joursPrisCycle} j déjà pris` : ''})`, solde.conges]]
      : []),
    ...(solde.precarite > 0 ? [['Prime de précarité (fin de CDD, 3 %)', solde.precarite]] : []),
    ...(solde.preavis > 0 ? [[`Indemnité compensatrice de préavis (${solde.joursPreavis} j)`, solde.preavis]] : [])
  ];

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>Solde de tout compte</title>
    <style>${PRINT_CSS}</style></head><body class="pdf-export">
    <section class="fiche">
      <header class="head">
        <p class="badge">SOLDE DE TOUT COMPTE</p>
        <p class="sub">${esc(settings?.raisonSociale || '')}${settings?.raisonSociale ? ' · ' : ''}Sortie le ${esc(libelleMois(ymSortie, locale))}</p>
      </header>

      <div class="ident">
        <p><span class="lbl">Salarié : </span><strong>${esc(employee.nom)}</strong></p>
        <p><span class="lbl">Matricule : </span><strong>${esc(employee.matricule || '—')}</strong></p>
        <p><span class="lbl">Ancienneté : </span><strong>${solde.anciennete} an(s)</strong></p>
        <p><span class="lbl">Motif : </span><strong>${esc(solde.motif.libelle)}</strong></p>
        <p><span class="lbl">Salaire brut moyen (12 derniers mois) : </span><strong>${esc(formatFCFA(solde.salaireMoyen, locale))}</strong></p>
      </div>

      <table class="tbl">
        <thead><tr><th class="lib">Élément</th><th class="num">Montant</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(([lib, m]) => `<tr><td class="lib">${esc(lib)}</td><td class="num">${money(m)}</td></tr>`).join('')
            : '<tr><td class="lib" colspan="2">Aucune indemnité due au-delà du dernier salaire, pour ce motif.</td></tr>'}
          <tr class="tot"><td class="lib">TOTAL SOLDE DE TOUT COMPTE</td><td class="num">${esc(formatFCFA(solde.total, locale))}</td></tr>
        </tbody>
      </table>

      <p class="note">
        Ce montant s'ajoute au dernier bulletin de salaire (mois de sortie, proratisé si incomplet — voir Bulletins). La durée du préavis dû dépend de la catégorie professionnelle et de la convention collective applicable : elle doit être vérifiée et saisie manuellement, elle n'est jamais devinée automatiquement.${solde.ruptureAnticipeeCdd ? ' Contrat en CDD non arrivé à échéance : le barème d’indemnité de licenciement du CDI ne s’applique pas — le montant ci-dessus correspond aux salaires restant à courir jusqu’au terme prévu du contrat.' : ''} Simulation indicative basée sur les règles générales du Code du travail ivoirien — à faire valider avant tout paiement définitif.
      </p>
      <p class="foot">Document généré le ${esc(new Date().toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US'))}.</p>
    </section>
    </body></html>`;
}

export async function telechargerSolde(employee, ymSortie, solde, settings, { locale }) {
  try {
    const html = soldeDocumentHtml(employee, ymSortie, solde, settings, { locale });
    await exportHtmlToPdf(html, {
      filename: `solde-tout-compte-${(employee.matricule || employee.nom).replace(/\s+/g, '-')}.pdf`,
      selector: '.fiche',
      orientation: 'portrait',
      pxWidth: 794
    });
    return true;
  } catch {
    return false;
  }
}
