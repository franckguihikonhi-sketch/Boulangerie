// ===========================================================================
// ÉTAT DES IMPÔTS ET TAXES SUR SALAIRES MENSUEL
// ---------------------------------------------------------------------------
// Récapitulatif des impôts et taxes dus sur un mois, TOUS SALARIÉS CONFONDUS
// (une ligne par rubrique, pas de détail par salarié — voir le livre de paie
// pour ça) : I.T.S (retenue salariale reversée par l'employeur), impôt sur
// salaires locaux et expatriés (patronal), taxe d'apprentissage et taxe FPC
// (patronales, FDFP). Distinct de l'état des cotisations sociales (CNPS/CMU) :
// ce sont des impôts/taxes fiscales et parafiscales, pas des cotisations
// sociales.
// Réutilise bulletinData() pour garantir une stricte cohérence avec les
// bulletins individuels, le livre de paie et l'état des cotisations.
// ===========================================================================

import { formatNum } from './money';
import { bulletinData } from './bulletin';
import { libelleMois } from './payroll';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function impotsData(employees, ym, settings) {
  const rows = [];
  for (const e of employees || []) {
    const bd = bulletinData(e, ym, settings);
    if (bd) rows.push(bd);
  }
  return rows;
}

export function impotsTotaux(rows) {
  const t = {
    its: 0, isLocal: 0, isExpatrie: 0,
    totalImpotSalaires: 0,
    taxeApprentissage: 0, fpc: 0, totalFdfp: 0,
    totalGeneral: 0
  };
  for (const r of rows) {
    const c = r.calc;
    t.its += c.impotNet;
    t.isLocal += c.patronal.isLocal;
    t.isExpatrie += c.patronal.isExpatrie;
    t.taxeApprentissage += c.patronal.taxeApprentissage;
    t.fpc += c.patronal.fpc;
  }
  t.totalImpotSalaires = t.its + t.isLocal + t.isExpatrie;
  t.totalFdfp = t.taxeApprentissage + t.fpc;
  t.totalGeneral = t.totalImpotSalaires + t.totalFdfp;
  return t;
}

// --------------------------- Rendu HTML du récapitulatif -------------------

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
  @media print {
    @page { margin: 15mm; }
    body { background: #fff; }
    .register { border: none; margin: 0; padding: 0; max-width: none; }
  }
`;

const AUTO_PRINT = `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.onafterprint=function(){window.close();};window.print();}catch(e){}},250);});<\/script>`;

export function impotsDocumentHtml(rows, ym, { t, locale, autoPrint = false } = {}) {
  const tt = impotsTotaux(rows);
  const title = t('impots.docTitle');
  const hasExpatries = rows.some((r) => r.calc.expatrie);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(title)} — ${esc(libelleMois(ym, locale))}</title>
    <style>${PRINT_CSS}</style></head><body>
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
          <tr class="group"><td colspan="2">${esc(t('impots.groupImpotSalaires'))}</td></tr>
          ${rubriqueRow(t('slip.its'), tt.its, locale)}
          ${rubriqueRow(t('slip.isLocal'), tt.isLocal, locale)}
          ${hasExpatries || tt.isExpatrie > 0 ? rubriqueRow(t('impots.isExpatrie'), tt.isExpatrie, locale) : ''}
          ${rubriqueRow(t('impots.totalImpotSalaires'), tt.totalImpotSalaires, locale, 'tot')}
          <tr class="group"><td colspan="2">${esc(t('impots.groupFdfp'))}</td></tr>
          ${rubriqueRow(t('slip.taxeApprentissage'), tt.taxeApprentissage, locale)}
          ${rubriqueRow(t('slip.fpc'), tt.fpc, locale)}
          ${rubriqueRow(t('impots.totalFdfp'), tt.totalFdfp, locale, 'tot')}
          ${rubriqueRow(t('impots.totalGeneral'), tt.totalGeneral, locale, 'tot')}
        </tbody>
      </table>
      <p class="summary">${esc(t('livrePaie.employeeCount'))} : <strong>${rows.length}</strong></p>
      <p class="foot">${esc(t('impots.footer'))}</p>
    </section>
    ${autoPrint ? AUTO_PRINT : ''}
    </body></html>`;
}

export function telechargerImpots(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  try {
    const html = impotsDocumentHtml(rows, ym, { t, locale, autoPrint: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etat-impots-${ym}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
}

export function imprimerImpots(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  const html = impotsDocumentHtml(rows, ym, { t, locale, autoPrint: true });

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

  if (telechargerImpots(rows, ym, { t, locale })) return 'download';

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
    iframe.srcdoc = impotsDocumentHtml(rows, ym, { t, locale });
    return 'iframe';
  } catch {
    return false;
  }
}
