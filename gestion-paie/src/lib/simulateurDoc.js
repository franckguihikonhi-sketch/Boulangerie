// ===========================================================================
// FICHE IMPRIMABLE DU SIMULATEUR D'EMBAUCHE
// ---------------------------------------------------------------------------
// Génère un document PDF autonome (une page) reprenant le profil simulé et le
// détail complet du coût salarial — même moteur de rendu que les bulletins
// (voir pdfExport.js), pour une fiche à joindre à un dossier de recrutement
// ou une décision budgétaire. Aucune donnée n'est enregistrée : la fiche ne
// fait que mettre en forme le résultat déjà calculé à l'écran.
// ===========================================================================

import { formatFCFA, formatNum } from './money';
import { exportHtmlToPdf } from './pdfExport';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function today(locale) {
  return new Date().toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
}

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
  h2.sec { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #3730a3; margin: 16px 0 6px; }
  table.tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  table.tbl th, table.tbl td { padding: 4px 8px; border: 1px solid #ececeb; }
  table.tbl thead th { background: #eef2ff; color: #3730a3; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; text-align: left; }
  table.tbl td.lib, table.tbl th.lib { text-align: left; }
  table.tbl .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.tbl tr.tot td { font-weight: 700; background: #f5f3ff; }
  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 10px 0 4px; }
  .stat { border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 12px; }
  .stat .l { font-size: 9.5px; text-transform: uppercase; letter-spacing: .03em; color: #78716c; }
  .stat .v { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .stat.good .v { color: #15803d; }
  .stat.bad .v { color: #b91c1c; }
  .stat.brand { background: #eef2ff; border-color: #c7d2fe; grid-column: 1 / -1; }
  .stat.brand .v { color: #3730a3; font-size: 20px; }
  .stat .s { font-size: 10px; color: #78716c; margin-top: 2px; }
  .foot { margin-top: 14px; font-size: 8.5px; color: #a8a29e; text-align: center; line-height: 1.5; }
  body.pdf-export { background: #fff; }
  body.pdf-export .fiche { border: none; margin: 0; padding: 15mm; max-width: none; }
`;

// `data` = { form: {categorie, situation, enfants, anciennete, expatrie},
//            calc: résultat de calculerDepuisNet, settings }
export function simulateurDocumentHtml(data, { t, locale } = {}) {
  const { form, calc, settings } = data;
  const money = (n) => (n ? formatNum(n, locale) : '0');

  const remunRows = [
    ['SALAIRE DE BASE', calc.salaireBase],
    ...(calc.sursalaire > 0 ? [['SURSALAIRE', calc.sursalaire]] : []),
    ...(calc.primeAnciennete > 0 ? [[t('slip.primeAnciennete'), calc.primeAnciennete]] : []),
    ...(calc.heuresSupDetail || []).filter((h) => h.montant > 0).map((h) => [`Heures sup. (+${(h.majoration * 100).toFixed(0)} %)`, h.montant]),
    ...(calc.primes || []).map((p) => [p.label + (p.imposable === false ? ' (exonérée)' : ''), p.montant]),
    ...(calc.transport > 0 ? [[t('period.transport'), calc.transport]] : [])
  ];

  const patronalRows = [
    [t('simulateur.retraitePat'), calc.patronal.retraite],
    [t('simulateur.prestationsFam'), calc.patronal.prestationsFamiliales],
    [t('simulateur.accidentTravail'), calc.patronal.accidentTravail],
    [t('simulateur.isLocal'), calc.patronal.isLocal],
    ...(calc.expatrie ? [[t('simulateur.isExpatrie'), calc.patronal.isExpatrie]] : []),
    [t('simulateur.taxeApprentissage'), calc.patronal.taxeApprentissage],
    [t('simulateur.fpc'), calc.patronal.fpc],
    [t('simulateur.cmuPat'), calc.patronal.cmu]
  ];

  const pct = ((calc.coutTotalEmployeur / calc.netAPayer - 1) * 100).toFixed(0);

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(t('simulateur.docTitle'))}</title>
    <style>${PRINT_CSS}</style></head><body class="pdf-export">
    <section class="fiche">
      <header class="head">
        <p class="badge">${esc(t('simulateur.docTitle'))}</p>
        <p class="sub">${esc(settings?.raisonSociale || '')}${settings?.raisonSociale ? ' · ' : ''}${esc(today(locale))}</p>
      </header>

      <div class="ident">
        <p><span class="lbl">${esc(t('employees.categorie'))} : </span><strong>${esc(form.categorie || '—')}</strong></p>
        <p><span class="lbl">${esc(t('employees.situation'))} : </span><strong>${esc(t('situation.' + form.situation))}${form.expatrie ? ' · ' + esc(t('employees.expatrie')) : ''}</strong></p>
        <p><span class="lbl">${esc(t('employees.children'))} : </span><strong>${esc(form.enfants)}</strong></p>
        <p><span class="lbl">${esc(t('simulateur.anciennete'))} : </span><strong>${esc(form.anciennete)}</strong></p>
      </div>

      <h2 class="sec">${esc(t('simulateur.remuneration'))}</h2>
      <table class="tbl">
        <thead><tr><th class="lib">${esc(t('cotisations.rubrique'))}</th><th class="num">${esc(t('cotisations.montant'))}</th></tr></thead>
        <tbody>
          ${remunRows.map(([lib, m]) => `<tr><td class="lib">${esc(lib)}</td><td class="num">${money(m)}</td></tr>`).join('')}
          <tr class="tot"><td class="lib">${esc(t('simulateur.brutImposable'))}</td><td class="num">${money(calc.brutImposable)}</td></tr>
        </tbody>
      </table>

      <h2 class="sec">${esc(t('simulateur.detailPatronal'))}</h2>
      <table class="tbl">
        <thead><tr><th class="lib">${esc(t('cotisations.rubrique'))}</th><th class="num">${esc(t('cotisations.montant'))}</th></tr></thead>
        <tbody>
          ${patronalRows.map(([lib, m]) => `<tr><td class="lib">${esc(lib)}</td><td class="num">${money(m)}</td></tr>`).join('')}
          <tr class="tot"><td class="lib">${esc(t('simulateur.totalPatronal'))}</td><td class="num">${money(calc.totalPatronal)}</td></tr>
        </tbody>
      </table>

      <div class="stats">
        <div class="stat good"><div class="l">${esc(t('slip.netAPayer'))}</div><div class="v">${esc(formatFCFA(calc.netAPayer, locale))}</div></div>
        <div class="stat bad"><div class="l">${esc(t('simulateur.totalPatronal'))}</div><div class="v">${esc(formatFCFA(calc.totalPatronal, locale))}</div></div>
        <div class="stat brand">
          <div class="l">${esc(t('simulateur.coutTotal'))}</div>
          <div class="v">${esc(formatFCFA(calc.coutTotalEmployeur, locale))}</div>
          <div class="s">${esc(t('simulateur.coutTotalSub', { pct }))}</div>
        </div>
      </div>

      <p class="foot">${esc(t('simulateur.disclaimer'))}</p>
    </section>
    </body></html>`;
}

export async function telechargerSimulation(data, { t, locale }) {
  try {
    const html = simulateurDocumentHtml(data, { t, locale });
    await exportHtmlToPdf(html, {
      filename: 'simulation-embauche.pdf',
      selector: '.fiche',
      orientation: 'portrait',
      pxWidth: 794
    });
    return true;
  } catch {
    return false;
  }
}
