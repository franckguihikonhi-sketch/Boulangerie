// ===========================================================================
// ÉTAT DES COTISATIONS SOCIALES MENSUEL (CNPS + CMU)
// ---------------------------------------------------------------------------
// Récapitulatif des cotisations sociales dues sur un mois, TOUS SALARIÉS
// CONFONDUS : une ligne par rubrique (assiette, retraite salariale et
// patronale, prestations familiales, accident du travail, CMU salariale et
// patronale), avec le total à verser à la CNPS et à la CMU — pas de détail
// salarié par salarié (voir le livre de paie pour ça).
// Réutilise bulletinData() pour garantir une stricte cohérence avec les
// bulletins individuels et le livre de paie.
// ===========================================================================

import { formatNum } from './money';
import { bulletinData } from './bulletin';
import { libelleMois } from './payroll';
import { exportHtmlToPdf } from './pdfExport';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Construit une ligne par salarié sous contrat sur le mois donné. Trie par
// matricule puis nom.
export function cotisationsData(employees, ym, settings) {
  const rows = [];
  for (const e of employees || []) {
    const bd = bulletinData(e, ym, settings);
    if (bd) rows.push(bd);
  }
  rows.sort((a, b) => {
    const ma = a.employee.matricule || '';
    const mb = b.employee.matricule || '';
    if (ma !== mb) return ma.localeCompare(mb, 'fr', { numeric: true });
    return a.employee.nom.localeCompare(b.employee.nom, 'fr');
  });
  return rows;
}

function totalCnps(c) {
  return c.cnpsRetraite + c.patronal.retraite + c.patronal.prestationsFamiliales + c.patronal.accidentTravail;
}
function totalCmu(c) {
  return c.cmu + c.patronal.cmu;
}

export function cotisationsTotaux(rows) {
  const t = {
    baseCotisable: 0, retraiteSal: 0, retraitePat: 0,
    basePfAt: 0, prestationsFam: 0, accidentTravail: 0,
    totalCnps: 0, cmuSal: 0, cmuPat: 0, totalCmu: 0, totalGeneral: 0
  };
  for (const r of rows) {
    const c = r.calc;
    t.baseCotisable += c.baseCotisable;
    t.retraiteSal += c.cnpsRetraite;
    t.retraitePat += c.patronal.retraite;
    t.basePfAt += c.basePfAt;
    t.prestationsFam += c.patronal.prestationsFamiliales;
    t.accidentTravail += c.patronal.accidentTravail;
    t.totalCnps += totalCnps(c);
    t.cmuSal += c.cmu;
    t.cmuPat += c.patronal.cmu;
    t.totalCmu += totalCmu(c);
    t.totalGeneral += totalCnps(c) + totalCmu(c);
  }
  return t;
}

// --------------------------- Rendu HTML du récapitulatif -------------------

// Une ligne par rubrique (pas par salarié) : c'est le total de chacune sur
// l'ensemble des salariés du mois.
function rubriqueRow(label, montant, locale, cls) {
  const money = (n) => (n ? formatNum(n, locale) : '—');
  return `<tr${cls ? ` class="${cls}"` : ''}>
    <td class="lib">${esc(label)}</td>
    <td class="num">${esc(money(montant))}</td>
  </tr>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .register { background: #fff; max-width: 560px; margin: 16px auto; padding: 20px 24px; border: 1px solid #e7e5e4; border-radius: 8px; }
  .head { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 14px; }
  .badge { display: inline-block; background: #4f46e5; color: #fff; border-radius: 4px; padding: 4px 20px; font-size: 13px; font-weight: 700; letter-spacing: .08em; margin: 0; }
  .period { font-size: 11px; margin: 6px 0 0; color: #44403c; text-transform: capitalize; }
  table.reg { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.reg th, table.reg td { padding: 6px 8px; border: 1px solid #ececeb; }
  table.reg thead th { background: #eef2ff; color: #3730a3; font-size: 10.5px; text-transform: uppercase; letter-spacing: .02em; text-align: left; }
  table.reg td.lib, table.reg th.lib { text-align: left; }
  table.reg td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.reg tr.group td { font-weight: 700; background: #f5f3ff; color: #3730a3; }
  table.reg tr.tot td { font-weight: 800; background: #eef2ff; border-top: 2px solid #c7d2fe; font-size: 13.5px; color: #3730a3; }
  .summary { margin-top: 14px; font-size: 11px; color: #57534e; }
  .foot { margin-top: 14px; font-size: 8.5px; color: #a8a29e; text-align: center; line-height: 1.5; }
  /* Variante « export PDF » (voir pdfExport.js), active inconditionnellement. */
  body.pdf-export { background: #fff; }
  body.pdf-export .register { border: none; margin: 0; padding: 15mm; max-width: none; }
`;

export function cotisationsDocumentHtml(rows, ym, { t, locale, pdfExport = false } = {}) {
  const tt = cotisationsTotaux(rows);
  const title = t('cotisations.docTitle');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(title)} — ${esc(libelleMois(ym, locale))}</title>
    <style>${PRINT_CSS}</style></head><body class="${pdfExport ? 'pdf-export' : ''}">
    <section class="register">
      <header class="head">
        <p class="badge">${esc(title)}</p>
        <p class="period">${esc(libelleMois(ym, locale))} — ${rows.length} ${esc(t('livrePaie.employeeCount'))}</p>
      </header>
      <table class="reg">
        <thead>
          <tr><th class="lib">${esc(t('cotisations.rubrique'))}</th><th>${esc(t('cotisations.montant'))}</th></tr>
        </thead>
        <tbody>
          <tr class="group"><td colspan="2">${esc(t('cotisations.groupCnps'))}</td></tr>
          ${rubriqueRow(t('cotisations.assietteRetraite'), tt.baseCotisable, locale)}
          ${rubriqueRow(t('cotisations.retraiteSal'), tt.retraiteSal, locale)}
          ${rubriqueRow(t('cotisations.retraitePat'), tt.retraitePat, locale)}
          ${rubriqueRow(t('cotisations.assiettePfAt'), tt.basePfAt, locale)}
          ${rubriqueRow(t('slip.prestationsFam'), tt.prestationsFam, locale)}
          ${rubriqueRow(t('slip.accidentTravail'), tt.accidentTravail, locale)}
          ${rubriqueRow(t('cotisations.totalCnps'), tt.totalCnps, locale, 'tot')}
          <tr class="group"><td colspan="2">${esc(t('cotisations.groupCmu'))}</td></tr>
          ${rubriqueRow(t('cotisations.cmuSal'), tt.cmuSal, locale)}
          ${rubriqueRow(t('cotisations.cmuPat'), tt.cmuPat, locale)}
          ${rubriqueRow(t('cotisations.totalCmu'), tt.totalCmu, locale, 'tot')}
          ${rubriqueRow(t('cotisations.totalGeneral'), tt.totalGeneral, locale, 'tot')}
        </tbody>
      </table>
      <p class="summary">${esc(t('livrePaie.employeeCount'))} : <strong>${rows.length}</strong></p>
      <p class="foot">${esc(t('cotisations.footer'))}</p>
    </section>
    </body></html>`;
}

// Génère un véritable fichier PDF (A4 portrait) et déclenche son
// téléchargement. Renvoie true en cas de succès.
export async function telechargerCotisations(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  try {
    const html = cotisationsDocumentHtml(rows, ym, { t, locale, pdfExport: true });
    await exportHtmlToPdf(html, {
      filename: `etat-cotisations-${ym}.pdf`,
      selector: '.register',
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
export const imprimerCotisations = telechargerCotisations;
