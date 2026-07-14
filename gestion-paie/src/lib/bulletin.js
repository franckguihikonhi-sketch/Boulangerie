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
  periodeEffective, estMoisAnniversaire, joursCongeAnnuels
} from './payroll';
import { paramsFromSettings } from './db';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  const acc = { salaireBrut: 0, chargesSal: 0, chargesPat: 0, netImposable: 0, netAPayer: 0 };
  for (let mo = 1; mo <= m; mo++) {
    const r = calcMois(employee, `${y}-${String(mo).padStart(2, '0')}`, params);
    if (!r) continue;
    acc.salaireBrut += r.calc.brutImposable;
    acc.chargesSal += r.calc.totalRetenues;
    acc.chargesPat += r.calc.totalPatronal;
    acc.netImposable += r.calc.netImposable;
    acc.netAPayer += r.calc.netAPayer;
  }
  const periode = {
    salaireBrut: courant.brutImposable,
    chargesSal: courant.totalRetenues,
    chargesPat: courant.totalPatronal,
    netImposable: courant.netImposable,
    netAPayer: courant.netAPayer
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
  return { employee, periode, ym, settings, params, anciennete, calc, conge, periodeDates, cumuls };
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

  return `
  <section class="slip">
    <header class="slip-head">
      <p class="badge">BULLETIN DE PAIE</p>
      <p class="period">Période du <strong>${esc(periodeDates.du)}</strong> au <strong>${esc(periodeDates.au)}</strong> · Paiement le <strong>${esc(periodeDates.au)}</strong> par <strong>${esc(modePaiement)}</strong></p>
    </header>

    <div class="ident">
      <div class="who">
        <p class="nom">${esc(e.nom)}</p>
        <p class="muted">Emploi : ${esc(e.emploi || '—')}${e.expatrie ? ' — Expatrié' : ''}</p>
        <p class="muted">Matricule : ${esc(e.matricule || '—')}</p>
        <p class="muted">N° Séc. Soc. (CNPS) : ${esc(e.cnps || '—')}</p>
      </div>
      <div class="stat">
        <p class="muted">Situation matrimoniale : <strong>${esc(t('situation.' + e.situation))}</strong></p>
        <p class="muted">Nombre de parts : <strong>${nb(calc.parts)}</strong></p>
        <p class="muted">Ancienneté : <strong>${anciennete}</strong> an(s)</p>
        <p class="muted">Contrat : <strong>${esc(t('contract.' + p.kind))}${p.label ? ' — ' + esc(p.label) : ''}</strong>${p.requalifieCdi ? ' <em>(requalifié CDI — CDD &gt; 2 ans)</em>' : ''} · Rémunération : Mensuelle</p>
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

    <div class="bottom">
      <table class="cumuls">
        <thead><tr><th class="lib">Cumuls</th><th class="num">Période</th><th class="num">Année</th></tr></thead>
        <tbody>
          ${cumul('Salaire brut', cu.periode.salaireBrut, cu.annee.salaireBrut)}
          ${cumul('Charges salariales', cu.periode.chargesSal, cu.annee.chargesSal)}
          ${cumul('Charges patronales', cu.periode.chargesPat, cu.annee.chargesPat)}
          ${cumul('Net imposable', cu.periode.netImposable, cu.annee.netImposable)}
          ${cumul('Net à payer', cu.periode.netAPayer, cu.annee.netAPayer)}
        </tbody>
      </table>
      <div class="net">
        <span>NET À PAYER</span>
        <span>${esc(formatFCFA(calc.netAPayer, locale))}</span>
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
  /* En-tête volontairement sans informations employeur : le bulletin est
     imprimé sur papier à en-tête de l'entreprise. Titre centré. */
  .slip-head { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 12px; }
  .muted { color: #57534e; font-size: 11px; margin: 1.5px 0; }
  .period { font-size: 11px; margin: 4px 0 0; color: #44403c; }
  .badge { display: inline-block; background: #4f46e5; color: #fff; border-radius: 4px; padding: 4px 20px; font-size: 14px; font-weight: 700; letter-spacing: .08em; margin: 0; }
  .ident { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
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
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
  table.cumuls { border-collapse: collapse; font-size: 10.5px; min-width: 320px; }
  table.cumuls th, table.cumuls td { border: 1px solid #ececeb; padding: 3px 8px; }
  table.cumuls thead th { background: #fafaf9; color: #57534e; text-transform: uppercase; font-size: 9.5px; }
  table.cumuls .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.cumuls .lib { text-align: left; }
  .net { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 10px 18px; background: #4f46e5; color: #fff; border-radius: 6px; min-width: 240px; margin-left: auto; }
  .net span:first-child { font-size: 11px; font-weight: 600; letter-spacing: .06em; opacity: .9; }
  .net span:last-child { font-size: 19px; font-weight: 800; }
  .warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px; font-size: 10.5px; margin: 8px 0 0; }
  .foot { margin-top: 12px; font-size: 9px; color: #a8a29e; text-align: center; line-height: 1.5; }
  @media print {
    /* Marge de page nulle : supprime l'en-tête/pied automatique du navigateur
       (date, URL, titre, n° de page). Les marges réelles sont portées par le
       padding de .slip. */
    @page { margin: 0; }
    body { background: #fff; }
    /* Marge haute réservée au papier à en-tête pré-imprimé (≈ 3,5 cm). */
    .slip { border: none; border-radius: 0; margin: 0; max-width: none; padding: 35mm 9mm 10mm; }
  }
`;

// Petit script d'auto-impression injecté dans le document : lorsqu'il est
// ouvert comme page de premier niveau (nouvel onglet, ou fichier téléchargé
// puis ouvert), il déclenche la fenêtre d'impression, puis referme l'onglet.
// (Séquence </script> échappée pour rester inline-safe.)
const AUTO_PRINT = `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.onafterprint=function(){window.close();};window.print();}catch(e){}},250);});<\/script>`;

// Construit le document HTML complet (autonome) regroupant les bulletins.
// Sert à la fois à l'aperçu (iframe, sans auto-impression) et à l'export
// (nouvel onglet / téléchargement, avec auto-impression).
export function slipDocumentHtml(slips, { t, locale, autoPrint = false } = {}) {
  const body = (slips || []).map((s) => slipHtml(s, t, locale)).join('\n');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(t('slip.title'))}</title>
    <style>${PRINT_CSS}</style></head><body>${body}${autoPrint ? AUTO_PRINT : ''}</body></html>`;
}

// Télécharge les bulletins sous forme de fichier HTML autonome (imprimable /
// « Enregistrer en PDF » une fois ouvert). Fonctionne même dans un cadre
// restreint qui bloque l'impression directe, tant que le téléchargement est
// autorisé. Renvoie true si le clic de téléchargement a pu être émis.
export function telechargerBulletins(slips, { t, locale }) {
  if (!slips || slips.length === 0) return false;
  try {
    const html = slipDocumentHtml(slips, { t, locale, autoPrint: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulletins-paie.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
}

// Imprime (ou exporte en PDF) l'ensemble des bulletins, avec repli automatique
// selon les capacités de l'environnement :
//   1. Nouvel onglet auto-imprimable (application déployée, pop-ups autorisés) ;
//   2. Sinon, téléchargement du fichier HTML imprimable (cadre restreint qui
//      bloque les pop-ups et l'impression directe, ex. aperçu en bac à sable) ;
//   3. En dernier recours, impression via iframe caché (cadres autorisant les
//      « modals » mais pas les pop-ups).
// Renvoie le mode réellement utilisé : 'tab' | 'download' | 'iframe' | false.
export function imprimerBulletins(slips, { t, locale }) {
  if (!slips || slips.length === 0) return false;
  const html = slipDocumentHtml(slips, { t, locale, autoPrint: true });

  // 1) Nouvel onglet (impression native, meilleure expérience en production).
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return 'tab';
    }
    URL.revokeObjectURL(url);
  } catch {
    /* on tente les replis ci-dessous */
  }

  // 2) Onglet bloqué : téléchargement du fichier imprimable.
  if (telechargerBulletins(slips, { t, locale })) return 'download';

  // 3) Dernier recours : impression via iframe caché same-origin.
  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch { /* ignoré (bac à sable sans allow-modals) */ }
      setTimeout(() => { try { iframe.remove(); } catch { /* ignore */ } }, 60000);
    };
    document.body.appendChild(iframe);
    iframe.srcdoc = slipDocumentHtml(slips, { t, locale });
    return 'iframe';
  } catch {
    return false;
  }
}
