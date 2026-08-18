// ===========================================================================
// GÉNÉRATION DES BULLETINS DE PAIE (impression / PDF)
// ---------------------------------------------------------------------------
// Construit un document HTML autonome regroupant un ou plusieurs bulletins
// (un par page, saut de page automatique) et l'ouvre dans la boîte
// d'impression du navigateur, où l'utilisateur choisit « Enregistrer en PDF ».
// C'est le mécanisme retenu par les autres modules du dépôt (voir
// gestion-devis) : aucune dépendance PDF externe, rendu identique à l'écran.
// ===========================================================================

import { formatFCFA, formatNum } from './money';
import {
  calculerDepuisNet, libelleMois, anneesAnciennete,
  periodeEffective, estMoisAnniversaire, joursCongeAnnuels, congesEnCours
} from './payroll';
import { paramsFromSettings } from './db';
import { exportHtmlToPdf } from './pdfExport';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Éléments ponctuels (heures sup, retenues particulières) rattachés à un mois
// précis (`mois` = « aaaa-mm ») ne s'appliquent qu'à CE mois-là ; laissés sans
// mois, ils s'appliquent à tous les bulletins de la période (comme les
// primes) — utile pour une opposition judiciaire récurrente par exemple.
function pourCeMois(items, ym) {
  return (Array.isArray(items) ? items : []).filter((it) => !it.mois || it.mois === ym);
}

// Calcule le bulletin d'un mois donné pour une période et un congé donnés.
function buildCalc(employee, periode, ym, params, congePaye, congeJours) {
  const anciennete = anneesAnciennete(employee.dateEmbauche, `${ym}-01`);
  const calc = calculerDepuisNet(
    periode.netCible,
    {
      salaireBase: periode.salaireBase,
      salaireCategoriel: employee.salaireCategoriel || periode.salaireBase,
      transport: periode.transport,
      primes: periode.primes,
      heuresSupplementaires: pourCeMois(periode.heuresSupplementaires, ym),
      situation: employee.situation,
      enfants: employee.enfants,
      expatrie: employee.expatrie,
      anciennete,
      congePaye: congePaye || 0,
      congeJours: congeJours || 0
    },
    params
  );
  return { anciennete, calc };
}

// Bulletin d'un mois SANS indemnité de congé (sert d'assiette à la période de
// référence des congés). Applique déjà la requalification CDD → CDI.
function calcMoisBase(employee, ym, params) {
  const periode = periodeEffective(employee, ym);
  if (!periode) return null;
  return { periode, ...buildCalc(employee, periode, ym, params, 0, 0) };
}

// Indemnité de congé versée au mois anniversaire = 1/12 de la rémunération
// brute imposable des 12 mois de référence (règle du 1/12ᵉ), hors indemnité de
// congé elle-même. Renvoie le montant et le nombre de jours ouvrables acquis.
function congeMois(employee, ym, params) {
  if (!estMoisAnniversaire(employee.dateEmbauche, ym)) return { montant: 0, jours: 0 };
  let [y, m] = ym.split('-').map(Number);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 12; i++) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    const r = calcMoisBase(employee, `${y}-${String(m).padStart(2, '0')}`, params);
    if (r) { sum += r.calc.brutImposable; count += 1; }
  }
  if (count === 0) return { montant: 0, jours: 0 };
  const anciennete = anneesAnciennete(employee.dateEmbauche, `${ym}-01`);
  return { montant: Math.round(sum / 12), jours: joursCongeAnnuels(anciennete) };
}

// Bulletin complet d'un mois : période effective (avec requalification) +
// indemnité de congé si mois anniversaire.
function calcMois(employee, ym, params) {
  const periode = periodeEffective(employee, ym);
  if (!periode) return null;
  const conge = congeMois(employee, ym, params);
  return { periode, conge, ...buildCalc(employee, periode, ym, params, conge.montant, conge.jours) };
}

// Cumule les montants clés de janvier au mois courant de la même année : ce
// sont les vrais cumuls annuels (« Année »), reconstitués mois par mois
// (congés et requalification inclus).
function cumulsAnnuels(employee, ym, params, courant) {
  const [y, m] = ym.split('-').map(Number);
  const acc = {
    salaireBrut: 0, chargesSal: 0, chargesPat: 0, netImposable: 0, netAPayer: 0,
    // Cumuls distincts « imposable » (assiette ITS, non plafonnée) et
    // « cotisable » (assiette CNPS retraite, plafonnée) — mention légale.
    baseCotisable: 0,
    // Cumul des jours de congé soldés (indemnité versée) depuis janvier.
    congesJours: 0
  };
  for (let mo = 1; mo <= m; mo++) {
    const r = calcMois(employee, `${y}-${String(mo).padStart(2, '0')}`, params);
    if (!r) continue;
    acc.salaireBrut += r.calc.brutImposable;
    acc.chargesSal += r.calc.totalRetenues;
    acc.chargesPat += r.calc.totalPatronal;
    acc.netImposable += r.calc.netImposable;
    acc.netAPayer += r.calc.netAPayer;
    acc.baseCotisable += r.calc.baseCotisable;
    acc.congesJours += r.calc.congeJours || 0;
  }
  const periode = {
    salaireBrut: courant.brutImposable,
    chargesSal: courant.totalRetenues,
    chargesPat: courant.totalPatronal,
    netImposable: courant.netImposable,
    netAPayer: courant.netAPayer,
    baseCotisable: courant.baseCotisable,
    congesJours: courant.congeJours || 0
  };
  return { periode, annee: acc };
}

// Construit les données d'un bulletin pour un salarié et un mois « aaaa-mm ».
// La période contractuelle applicable (avec requalification CDD → CDI) et les
// congés sont déterminés automatiquement. Renvoie null si aucune période ne
// couvre ce mois (salarié pas encore embauché / déjà sorti).
export function bulletinData(employee, ym, settings) {
  const params = paramsFromSettings(settings);
  const r = calcMois(employee, ym, params);
  if (!r) return null;
  const { periode, conge, anciennete, calc } = r;
  const cumuls = cumulsAnnuels(employee, ym, params, calc);
  // Bornes du mois (jj/mm/aa) pour l'en-tête « Période du … au … ».
  const [y, m] = ym.split('-').map(Number);
  const debutMois = new Date(Date.UTC(y, m - 1, 1));
  const finMois = new Date(Date.UTC(y, m, 0));
  const fdate = (d) =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
  const periodeDates = { du: fdate(debutMois), au: fdate(finMois) };
  // Compteur légal de congés : jours acquis dans le cycle annuel en cours
  // (voir congesEnCours — pur affichage, sans incidence sur la paie).
  const congesCycle = congesEnCours(employee.dateEmbauche, ym);
  // Retenues particulières applicables CE mois précisément (voir pourCeMois).
  const retenuesDuMois = pourCeMois(periode.retenues, ym);
  return {
    employee, periode, ym, settings, params, anciennete, calc, conge, periodeDates, cumuls,
    congesCycle, retenuesDuMois
  };
}

// --------------------------- Rendu HTML d'un bulletin ----------------------

function slipHtml(data, t, locale) {
  const { employee: e, periode: p, settings, calc, anciennete, periodeDates, params } = data;
  const money = (n) => (n === 0 ? '0' : esc(formatNum(n, locale)));
  const rt = (x) => (x * 100).toFixed(2).replace('.', ','); // taux « 6,30 »
  const nb = (n) => n.toFixed(2).replace('.', ','); // nombre « 30,00 »

  // Ligne du corps : 9 colonnes.
  //   code | désignation | nombre | base | txSal | gain | retSal | txPat | retPat
  const row = (o) => {
    const cls = o.cls ? ` class="${o.cls}"` : '';
    return `<tr${cls}>
      <td class="code">${o.code != null ? o.code : ''}</td>
      <td class="lib">${esc(o.lib)}</td>
      <td class="num sm">${o.nombre != null ? nb(o.nombre) : ''}</td>
      <td class="num">${o.base != null ? money(o.base) : ''}</td>
      <td class="num sm">${o.txSal != null ? rt(o.txSal) : ''}</td>
      <td class="num">${o.gain != null ? money(o.gain) : ''}</td>
      <td class="num">${o.retSal != null ? money(o.retSal) : ''}</td>
      <td class="num sm">${o.txPat != null ? rt(o.txPat) : ''}</td>
      <td class="num">${o.retPat != null ? money(o.retPat) : ''}</td>
    </tr>`;
  };

  const primesRows = (calc.primes || [])
    .map((pr) => row({ lib: pr.label + (pr.imposable === false ? ' (exonérée)' : ''), nombre: 1, base: pr.montant, gain: pr.montant }))
    .join('');

  // Heures supplémentaires : une ligne par majoration légale utilisée ce mois
  // (nombre d'heures, taux horaire de base, taux de majoration, montant).
  const heuresSupRows = (calc.heuresSupDetail || [])
    .map((h) => row({
      code: 30, lib: `HEURES SUPPLÉMENTAIRES (+${rt(h.majoration)} %)`,
      nombre: h.heures, base: h.tauxHoraire, txSal: h.majoration, gain: h.montant
    }))
    .join('');

  const modePaiement = settings.modePaiement || 'Virement';

  // Total des cotisations / retenues salariales (inclut l'ITS) et patronales.
  const totalRetSal = calc.totalRetenues;
  const totalRetPat = calc.totalPatronal;

  const netWarn =
    calc.sursalaire === 0 && calc.netAPayer > calc.netCible + 1
      ? `<p class="warn">${esc(t('slip.netWarning', { net: formatFCFA(calc.netAPayer, locale) }))}</p>`
      : '';

  // Bloc « Cumuls » : colonne Période (le mois du bulletin) et colonne Année
  // (cumul réel de janvier au mois courant, reconstitué mois par mois).
  const cu = data.cumuls;
  const cumul = (lib, per, ann) =>
    `<tr><td class="lib">${esc(lib)}</td><td class="num">${money(per)}</td><td class="num">${money(ann)}</td></tr>`;
  const cumulJours = (lib, per, ann) =>
    `<tr><td class="lib">${esc(lib)}</td><td class="num">${nb(per)} j</td><td class="num">${nb(ann)} j</td></tr>`;

  // Retenues particulières (avances, prêts, oppositions…) applicables à CE
  // mois précisément (voir pourCeMois), le cas échéant : déduites du net
  // légal, mentionnées à part du bloc des cotisations.
  const retenuesDiverses = data.retenuesDuMois || [];
  const totalRetenuesDiverses = retenuesDiverses.reduce((s, r) => s + (Number(r.montant) || 0), 0);
  const netFinal = calc.netAPayer - totalRetenuesDiverses;
  const retenuesHtml = retenuesDiverses.length
    ? `<table class="retenues">
        <thead><tr><th class="lib">Retenues diverses (avances, prêts, oppositions…)</th><th class="num">Montant</th></tr></thead>
        <tbody>
          ${retenuesDiverses.map((r) => `<tr><td class="lib">${esc(r.label)}</td><td class="num">-${money(r.montant)}</td></tr>`).join('')}
          <tr class="tot"><td class="lib">Total retenues diverses</td><td class="num">-${money(totalRetenuesDiverses)}</td></tr>
        </tbody>
      </table>`
    : '';

  const logo = settings.logoDataUrl
    ? `<img class="logo" src="${esc(settings.logoDataUrl)}" alt="Logo" />`
    : '<span class="logo-empty"></span>';

  const employerLines = [
    settings.adresse,
    settings.employeurCnps ? `CNPS employeur : ${settings.employeurCnps}` : '',
    settings.rccm ? `RCCM ${settings.rccm}` : '',
    settings.compteContribuable ? `Cpte contribuable ${settings.compteContribuable}` : '',
    settings.activite
  ].filter(Boolean);

  return `
  <section class="slip">
    <header class="slip-head">
      <div class="head-top">
        ${logo}
        <p class="badge">BULLETIN DE PAIE</p>
        <div class="employer-block">
          <p class="employer-nom">${esc(settings.raisonSociale || '—')}</p>
          ${employerLines.map((l) => `<p>${esc(l)}</p>`).join('')}
        </div>
      </div>
      <p class="period">Période du <strong>${esc(periodeDates.du)}</strong> au <strong>${esc(periodeDates.au)}</strong> · Paiement le <strong>${esc(periodeDates.au)}</strong> par <strong>${esc(modePaiement)}</strong></p>
    </header>

    <table class="ident-row">
      <thead>
        <tr>
          <th>Matricule</th><th>Nom et prénoms</th><th>N° CNPS salarié</th>
          <th class="num sm">Parts</th><th>Catégorie</th><th>Emploi</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(e.matricule || '—')}</td>
          <td class="nom">${esc(e.nom)}</td>
          <td>${esc(e.cnps || '—')}</td>
          <td class="num sm">${nb(calc.parts)}</td>
          <td>${esc(e.categorie || '—')}</td>
          <td>${esc(e.emploi || '—')}${e.expatrie ? ' (expatrié)' : ''}</td>
        </tr>
      </tbody>
    </table>

    <div class="ident">
      <div class="stat">
        <p class="muted">Situation matrimoniale : <strong>${esc(t('situation.' + e.situation))}</strong></p>
        <p class="muted">Ancienneté : <strong>${anciennete}</strong> an(s)</p>
        <p class="muted">Contrat : <strong>${esc(t('contract.' + p.kind))}${p.label ? ' — ' + esc(p.label) : ''}</strong>${p.requalifieCdi ? ' <em>(requalifié CDI — CDD &gt; 2 ans)</em>' : ''} · Rémunération : Mensuelle</p>
        <p class="muted">Congés — acquis (cycle en cours) : <strong>${nb(data.congesCycle)} j</strong>${calc.congeJours ? ` · soldés ce mois : <strong>${nb(calc.congeJours)} j</strong>` : ''}</p>
      </div>
    </div>

    <table class="lines">
      <thead>
        <tr class="grp">
          <th rowspan="2" class="code">N°</th>
          <th rowspan="2" class="lib">Désignation</th>
          <th rowspan="2" class="num sm">Nombre</th>
          <th rowspan="2" class="num">Base</th>
          <th colspan="3" class="grphead">Part salariale</th>
          <th colspan="2" class="grphead">Part patronale</th>
        </tr>
        <tr class="grp2">
          <th class="num sm">Taux</th><th class="num">Gain</th><th class="num">Retenue</th>
          <th class="num sm">Taux</th><th class="num">Retenue</th>
        </tr>
      </thead>
      <tbody>
        ${row({ code: 10, lib: 'SALAIRE DE BASE', nombre: 30, base: calc.salaireBase, gain: calc.salaireBase })}
        ${row({ code: 12, lib: 'PART I.G.R', nombre: calc.parts, cls: 'info' })}
        ${calc.sursalaire > 0 ? row({ code: 20, lib: 'SURSALAIRE', nombre: 30, base: calc.sursalaire, gain: calc.sursalaire }) : ''}
        ${heuresSupRows}
        ${calc.primeAnciennete > 0 ? row({ code: 40, lib: 'PRIME D’ANCIENNETÉ', base: calc.salaireCategoriel, txSal: calc.tauxAnciennete, gain: calc.primeAnciennete }) : ''}
        ${primesRows}
        ${calc.congePaye > 0 ? row({ code: 25, lib: `INDEMNITÉ DE CONGÉ PAYÉ${calc.congeJours ? ` (${calc.congeJours} j)` : ''}`, nombre: calc.congeJours || undefined, gain: calc.congePaye }) : ''}
        ${row({ lib: 'TOTAL BRUT', base: calc.brutImposable, gain: calc.brutImposable, cls: 'tot' })}
        ${row({ code: 412, lib: 'IMPÔT BRUT AVANT RICF', base: calc.brutImposable, retSal: calc.impotBrutAvantRicf })}
        ${calc.reductionRicf > 0 ? row({ code: 413, lib: 'RÉDUCTION D’IMPÔT CHGE FAMILLE', retSal: -calc.reductionRicf }) : ''}
        ${row({ code: 416, lib: 'I.T.S (IMPÔT SUR SALAIRE)', base: calc.brutImposable, retSal: calc.impotNet, cls: 'sub' })}
        ${row({ code: 452, lib: 'C.R.T.C.I (C.N.P.S) RETRAITE', base: calc.baseCotisable, txSal: params.cnpsRetraiteSalarie, retSal: calc.cnpsRetraite, txPat: params.cnpsRetraitePatronale, retPat: calc.patronal.retraite })}
        ${row({ code: 480, lib: 'PRESTATION FAMILIALE', base: calc.basePfAt, txPat: params.cnpsPrestationsFamiliales, retPat: calc.patronal.prestationsFamiliales })}
        ${row({ code: 490, lib: 'ACCIDENT DE TRAVAIL', base: calc.basePfAt, txPat: params.cnpsAccidentTravail, retPat: calc.patronal.accidentTravail })}
        ${row({ code: 500, lib: 'IMPÔT SUR SALAIRES (LOCAUX)', base: calc.brutImposable, txPat: params.isLocal, retPat: calc.patronal.isLocal })}
        ${calc.expatrie ? row({ code: 511, lib: 'IMPÔT SUR SALAIRES (EXPATRIÉS)', base: calc.brutImposable, txPat: params.isExpatrie, retPat: calc.patronal.isExpatrie }) : ''}
        ${row({ code: 520, lib: 'TAXE D’APPRENTISSAGE', base: calc.brutImposable, txPat: params.taxeApprentissage, retPat: calc.patronal.taxeApprentissage })}
        ${row({ code: 530, lib: 'TAXE F.P.C', base: calc.brutImposable, txPat: params.fpc, retPat: calc.patronal.fpc })}
        ${row({ code: 551, lib: 'C.M.U', nombre: 1, base: params.cmuSalarie + params.cmuPatronale, txSal: 0.5, retSal: calc.cmu, txPat: 0.5, retPat: calc.patronal.cmu })}
        ${row({ lib: 'TOTAL COTISATIONS', retSal: totalRetSal, retPat: totalRetPat, cls: 'tot' })}
        ${calc.transport > 0 ? row({ code: 708, lib: 'PRIME DE TRANSPORT', nombre: 30, base: calc.transport, gain: calc.transport }) : ''}
      </tbody>
    </table>

    ${retenuesHtml}

    <div class="bottom">
      <table class="cumuls">
        <thead><tr><th class="lib">Cumuls</th><th class="num">Période</th><th class="num">Année</th></tr></thead>
        <tbody>
          ${cumul('Salaire brut (cumul imposable)', cu.periode.salaireBrut, cu.annee.salaireBrut)}
          ${cumul('Assiette cotisable (CNPS)', cu.periode.baseCotisable, cu.annee.baseCotisable)}
          ${cumul('Charges salariales', cu.periode.chargesSal, cu.annee.chargesSal)}
          ${cumul('Charges patronales', cu.periode.chargesPat, cu.annee.chargesPat)}
          ${cumul('Net imposable', cu.periode.netImposable, cu.annee.netImposable)}
          ${cumul('Net à payer', cu.periode.netAPayer, cu.annee.netAPayer)}
          ${cumulJours('Congés soldés', cu.periode.congesJours, cu.annee.congesJours)}
        </tbody>
      </table>
      <div class="net">
        ${totalRetenuesDiverses > 0 ? `<span class="net-sub">Net légal : ${esc(formatFCFA(calc.netAPayer, locale))} · Retenues : -${esc(formatFCFA(totalRetenuesDiverses, locale))}</span>` : ''}
        <span>NET À PAYER</span>
        <span>${esc(formatFCFA(netFinal, locale))}</span>
      </div>
    </div>
    ${netWarn}
    <p class="foot">${esc(t('slip.footer'))}</p>
  </section>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .slip { background: #fff; max-width: 820px; margin: 16px auto; padding: 22px 26px; border: 1px solid #e7e5e4; border-radius: 8px; page-break-after: always; }
  .slip:last-child { page-break-after: auto; }
  /* En-tête complet (logo + identité employeur) : le bulletin est désormais
     un document autonome, imprimable sur papier blanc standard. */
  .slip-head { border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 12px; }
  .head-top { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; }
  .logo { max-height: 52px; max-width: 150px; object-fit: contain; }
  .logo-empty { width: 1px; }
  .head-top .badge { justify-self: center; }
  .employer-block { text-align: right; font-size: 9.5px; color: #57534e; line-height: 1.5; }
  .employer-block p { margin: 0; }
  .employer-nom { font-size: 12px; font-weight: 700; color: #1c1917; margin-bottom: 1px; }
  .muted { color: #57534e; font-size: 11px; margin: 1.5px 0; }
  .period { font-size: 11px; margin: 8px 0 0; color: #44403c; text-align: center; }
  .badge { display: inline-block; background: none; color: #000; padding: 0; font-size: 22px; font-weight: 700; letter-spacing: .08em; margin: 0; }
  table.ident-row { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 8px; }
  table.ident-row th, table.ident-row td { padding: 4px 7px; border: 1px solid #e7e5e4; text-align: left; }
  table.ident-row thead th { background: #eef2ff; color: #3730a3; font-size: 9.5px; text-transform: uppercase; letter-spacing: .02em; }
  table.ident-row td.nom, table.ident-row .nom { font-weight: 700; }
  table.ident-row .num { text-align: right; font-variant-numeric: tabular-nums; }
  .ident { display: grid; grid-template-columns: 1fr; gap: 10px; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
  .ident p { margin: 1.5px 0; }
  .nom { font-size: 13px; font-weight: 700; margin: 0 0 3px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.lines th, table.lines td { padding: 3.5px 6px; border: 1px solid #ececeb; text-align: left; }
  table.lines thead th { background: #eef2ff; color: #3730a3; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; text-align: center; }
  table.lines th.grphead { text-align: center; background: #e0e7ff; }
  table.lines td.code { color: #a8a29e; text-align: center; width: 34px; font-size: 10px; }
  table.lines td.lib, table.lines th.lib { text-align: left; }
  table.lines .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.lines .sm { font-size: 10px; color: #57534e; }
  table.lines tr.info td { color: #78716c; font-style: italic; }
  table.lines tr.tot td { font-weight: 700; background: #f5f3ff; }
  table.lines tr.sub td { font-weight: 600; background: #faf9ff; }
  table.retenues { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 8px; }
  table.retenues th, table.retenues td { padding: 3px 8px; border: 1px solid #fecaca; }
  table.retenues thead th { background: #fef2f2; color: #991b1b; text-transform: uppercase; font-size: 9.5px; text-align: left; }
  table.retenues .num { text-align: right; font-variant-numeric: tabular-nums; color: #b91c1c; }
  table.retenues .lib { text-align: left; }
  table.retenues tr.tot td { font-weight: 700; background: #fef2f2; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
  table.cumuls { border-collapse: collapse; font-size: 10.5px; min-width: 320px; }
  table.cumuls th, table.cumuls td { border: 1px solid #ececeb; padding: 3px 8px; }
  table.cumuls thead th { background: #fafaf9; color: #57534e; text-transform: uppercase; font-size: 9.5px; }
  table.cumuls .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.cumuls .lib { text-align: left; }
  .net { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 10px 18px; background: none; color: #000; border: 2px solid #000; border-radius: 6px; min-width: 240px; margin-left: auto; }
  .net span:first-child { font-size: 14px; font-weight: 600; letter-spacing: .06em; opacity: .9; }
  .net span:last-child { font-size: 26px; font-weight: 800; }
  .net span.net-sub { font-size: 10.5px; font-weight: 500; opacity: .85; letter-spacing: 0; margin-bottom: 2px; }
  .warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px; font-size: 10.5px; margin: 8px 0 0; }
  .foot { margin-top: 6px; font-size: 9px; color: #a8a29e; text-align: center; line-height: 1.5; }
  .foot:first-of-type { margin-top: 12px; }
  /* Variante « export PDF » : mêmes règles que l'ancien @media print, mais
     actives inconditionnellement puisque le PDF est désormais généré par
     capture (voir pdfExport.js), sans passer par la boîte d'impression du
     navigateur. Le bulletin porte désormais son propre en-tête (logo +
     identité employeur) : plus besoin de marge réservée à un papier à
     en-tête pré-imprimé, une marge standard suffit. */
  body.pdf-export { background: #fff; }
  body.pdf-export .slip { border: none; border-radius: 0; margin: 0; max-width: none; padding: 10mm 9mm; }
`;

// Construit le document HTML complet (autonome) regroupant les bulletins.
// Sert à l'aperçu (iframe) comme à l'export PDF (pdfExport: true, mise en
// page pleine page prête pour le papier à en-tête).
export function slipDocumentHtml(slips, { t, locale, pdfExport = false } = {}) {
  const body = (slips || []).map((s) => slipHtml(s, t, locale)).join('\n');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(t('slip.title'))}</title>
    <style>${PRINT_CSS}</style></head><body class="${pdfExport ? 'pdf-export' : ''}">${body}</body></html>`;
}

// Génère un véritable fichier PDF (un bulletin par page) et déclenche son
// téléchargement. Renvoie true en cas de succès.
export async function telechargerBulletins(slips, { t, locale }) {
  if (!slips || slips.length === 0) return false;
  try {
    const html = slipDocumentHtml(slips, { t, locale, pdfExport: true });
    await exportHtmlToPdf(html, {
      filename: 'bulletins-paie.pdf',
      selector: '.slip',
      orientation: 'portrait',
      pxWidth: 794
    });
    return true;
  } catch {
    return false;
  }
}

// Alias : le bouton « Imprimer / PDF » produit désormais le même fichier PDF
// réel que « Télécharger » (aucune dépendance à window.print/window.open).
export const imprimerBulletins = telechargerBulletins;
