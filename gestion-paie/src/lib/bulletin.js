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
import { calculerDepuisNet, libelleMois, anneesAnciennete } from './payroll';
import { paramsFromSettings } from './db';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Construit les données de calcul d'un bulletin pour un salarié et un mois
// donnés, à partir de la période contractuelle applicable.
export function bulletinData(employee, periode, ym, settings) {
  const params = paramsFromSettings(settings);
  // Ancienneté au 1er du mois considéré.
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
      anciennete
    },
    params
  );
  return { employee, periode, ym, settings, params, anciennete, calc };
}

// --------------------------- Rendu HTML d'un bulletin ----------------------

function slipHtml(data, t, locale) {
  const { employee: e, periode: p, ym, settings, calc, anciennete } = data;
  const money = (n) => esc(formatNum(n, locale));

  const gainRow = (label, base, taux, gain) => `
    <tr>
      <td>${esc(label)}</td>
      <td class="num">${base != null ? money(base) : ''}</td>
      <td class="num">${taux != null ? taux : ''}</td>
      <td class="num">${gain != null ? money(gain) : ''}</td>
      <td class="num"></td>
    </tr>`;
  const retRow = (label, base, taux, ret) => `
    <tr>
      <td>${esc(label)}</td>
      <td class="num">${base != null ? money(base) : ''}</td>
      <td class="num">${taux != null ? taux : ''}</td>
      <td class="num"></td>
      <td class="num">${ret != null ? money(ret) : ''}</td>
    </tr>`;

  const primesRows = (calc.primes || [])
    .map((pr) => gainRow(pr.label + (pr.imposable === false ? ' *' : ''), null, null, pr.montant))
    .join('');

  const transportLabel =
    calc.transportExonere > 0
      ? `${t('slip.transport')} (${t('slip.transportExonere')} ${money(calc.transportExonere)})`
      : t('slip.transport');

  const netWarn =
    calc.sursalaire === 0 && calc.netAPayer > calc.netCible + 1
      ? `<p class="warn">${esc(t('slip.netWarning', { net: formatFCFA(calc.netAPayer, locale) }))}</p>`
      : '';

  const pctAnc = calc.tauxAnciennete ? (calc.tauxAnciennete * 100).toFixed(0) + ' %' : null;

  return `
  <section class="slip">
    <header class="slip-head">
      <div>
        <h1>${esc(settings.raisonSociale || '')}</h1>
        <p class="muted">${esc(settings.adresse || '')}</p>
        ${settings.employeurCnps ? `<p class="muted">${esc(t('slip.cnps'))} employeur : ${esc(settings.employeurCnps)}</p>` : ''}
      </div>
      <div class="slip-title">
        <p class="badge">${esc(t('slip.title'))}</p>
        <p class="muted">${esc(t('slip.period'))} : <strong>${esc(libelleMois(ym, locale))}</strong></p>
      </div>
    </header>

    <div class="ident">
      <div>
        <p><strong>${esc(e.nom)}</strong></p>
        <p class="muted">${esc(t('slip.emploi'))} : ${esc(e.emploi || '—')}</p>
        ${e.matricule ? `<p class="muted">${esc(t('slip.matricule'))} : ${esc(e.matricule)}</p>` : ''}
        <p class="muted">${esc(t('slip.cnps'))} : ${esc(e.cnps || '—')}</p>
      </div>
      <div>
        <p class="muted">${esc(t('slip.situation'))} : ${esc(t('situation.' + e.situation))}</p>
        <p class="muted">${esc(t('slip.children'))} : ${esc(e.enfants)} &nbsp;·&nbsp; ${esc(t('slip.parts'))} : ${esc(calc.parts)}</p>
        <p class="muted">${esc(t('slip.contract'))} : ${esc(t('contract.' + p.kind))}${p.label ? ' — ' + esc(p.label) : ''}</p>
        <p class="muted">${esc(t('slip.seniority'))} : ${esc(t('slip.years', { n: anciennete }))}</p>
      </div>
    </div>

    <table class="lines">
      <thead>
        <tr>
          <th>${esc(t('slip.rubrique'))}</th>
          <th class="num">${esc(t('slip.base'))}</th>
          <th class="num">${esc(t('slip.taux'))}</th>
          <th class="num">${esc(t('slip.gain'))}</th>
          <th class="num">${esc(t('slip.retenue'))}</th>
        </tr>
      </thead>
      <tbody>
        ${gainRow(t('slip.salaireBase'), null, null, calc.salaireBase)}
        ${gainRow(t('slip.sursalaire'), null, null, calc.sursalaire)}
        ${calc.primeAnciennete > 0 ? gainRow(t('slip.primeAnciennete'), calc.salaireCategoriel, pctAnc, calc.primeAnciennete) : ''}
        ${primesRows}
        ${calc.transport > 0 ? gainRow(transportLabel, null, null, calc.transport) : ''}
        <tr class="subtotal">
          <td>${esc(t('slip.brutImposable'))}</td>
          <td class="num"></td><td class="num"></td>
          <td class="num">${money(calc.brutImposable)}</td><td class="num"></td>
        </tr>
        ${retRow(t('slip.cnpsRetraite'), calc.baseCotisable, '6,3 %', calc.cnpsRetraite)}
        ${retRow(t('slip.cmu'), null, null, calc.cmu)}
        ${retRow(t('slip.impotBrut'), calc.brutImposable, null, calc.impotBrutAvantRicf)}
        ${calc.reductionRicf > 0 ? retRow(t('slip.ricf'), null, null, -calc.reductionRicf) : ''}
        <tr class="subtotal">
          <td>${esc(t('slip.its'))}</td>
          <td class="num"></td><td class="num"></td><td class="num"></td>
          <td class="num">${money(calc.impotNet)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="totals-row">
          <td colspan="2">${esc(t('slip.brutTotal'))} : <strong>${money(calc.brutTotal)}</strong></td>
          <td class="num"><strong>${money(calc.brutTotal)}</strong></td>
          <td class="num" colspan="2"><strong>${esc(t('slip.totalRetenues'))} : ${money(calc.totalRetenues)}</strong></td>
        </tr>
      </tfoot>
    </table>

    <div class="net">
      <span>${esc(t('slip.netAPayer'))}</span>
      <span>${esc(formatFCFA(calc.netAPayer, locale))}</span>
    </div>
    ${netWarn}

    <details class="patronal" open>
      <summary>${esc(t('slip.employerCharges'))}</summary>
      <table class="lines small">
        <tbody>
          <tr><td>${esc(t('slip.prestationsFam'))}</td><td class="num">${money(calc.patronal.prestationsFamiliales)}</td></tr>
          <tr><td>${esc(t('slip.accidentTravail'))}</td><td class="num">${money(calc.patronal.accidentTravail)}</td></tr>
          <tr><td>${esc(t('slip.retraitePat'))}</td><td class="num">${money(calc.patronal.retraite)}</td></tr>
          <tr><td>${esc(t('slip.taxeApprentissage'))}</td><td class="num">${money(calc.patronal.taxeApprentissage)}</td></tr>
          <tr><td>${esc(t('slip.fpc'))}</td><td class="num">${money(calc.patronal.fpc)}</td></tr>
          <tr><td>${esc(t('slip.isLocal'))}</td><td class="num">${money(calc.patronal.isLocal)}</td></tr>
          <tr><td>${esc(t('slip.cmu'))} (employeur)</td><td class="num">${money(calc.patronal.cmu)}</td></tr>
          <tr class="subtotal"><td>${esc(t('slip.totalPatronal'))}</td><td class="num">${money(calc.totalPatronal)}</td></tr>
          <tr class="subtotal"><td>${esc(t('slip.coutTotal'))}</td><td class="num">${money(calc.coutTotalEmployeur)}</td></tr>
        </tbody>
      </table>
    </details>

    <p class="foot">${esc(t('slip.footer'))}</p>
  </section>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .slip { background: #fff; max-width: 780px; margin: 16px auto; padding: 26px 30px; border: 1px solid #e7e5e4; border-radius: 10px; page-break-after: always; }
  .slip:last-child { page-break-after: auto; }
  .slip-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 14px; }
  .slip-head h1 { font-size: 18px; margin: 0 0 2px; }
  .slip-title { text-align: right; }
  .muted { color: #78716c; font-size: 11.5px; margin: 2px 0; }
  .badge { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 3px 12px; font-size: 12px; font-weight: 700; letter-spacing: .03em; margin: 0 0 4px; }
  .ident { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #fafaf9; border: 1px solid #ececeb; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
  .ident p { margin: 2px 0; font-size: 12.5px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.lines th, table.lines td { padding: 5px 8px; border-bottom: 1px solid #efeeed; text-align: left; }
  table.lines th { text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: #78716c; background: #fafaf9; }
  table.lines .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.lines tr.subtotal td { font-weight: 700; background: #f5f3ff; border-top: 1px solid #ddd6fe; }
  table.lines tfoot td { border-top: 2px solid #d6d3d1; padding-top: 8px; font-size: 12.5px; }
  .net { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 6px; padding: 12px 16px; background: #4f46e5; color: #fff; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: .02em; }
  .warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px; font-size: 11px; margin: 6px 0; }
  details.patronal { margin-top: 12px; border: 1px solid #ececeb; border-radius: 8px; padding: 4px 12px 8px; }
  details.patronal summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #4338ca; padding: 6px 0; }
  table.lines.small td { font-size: 12px; padding: 3px 6px; }
  .foot { margin-top: 16px; font-size: 10px; color: #a8a29e; text-align: center; line-height: 1.5; }
  @media print {
    body { background: #fff; }
    .slip { border: none; border-radius: 0; margin: 0; max-width: none; padding: 14mm 12mm; }
    details.patronal { border-color: #ddd; }
  }
`;

// Ouvre la fenêtre d'impression avec l'ensemble des bulletins fournis.
// `slips` : liste d'objets renvoyés par bulletinData().
export function imprimerBulletins(slips, { t, locale }) {
  if (!slips || slips.length === 0) return false;
  const win = window.open('', '_blank', 'width=880,height=920');
  if (!win) return false;
  const body = slips.map((s) => slipHtml(s, t, locale)).join('\n');
  win.document.write(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(t('slip.title'))}</title>
    <style>${PRINT_CSS}</style></head><body>
    ${body}
    <script>window.onload = function () { setTimeout(function(){ window.print(); }, 150); };</script>
    </body></html>`);
  win.document.close();
  return true;
}
