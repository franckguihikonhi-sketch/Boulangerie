// ===========================================================================
// ÉTAT DES COTISATIONS SOCIALES MENSUEL (CNPS + CMU)
// ---------------------------------------------------------------------------
// Registre destiné à la déclaration/versement des cotisations sociales : une
// ligne par salarié avec l'assiette et le montant de chaque cotisation
// (retraite salariale et patronale, prestations familiales, accident du
// travail, CMU salariale et patronale), plus une ligne de totaux — ce sont
// les montants à reverser à la CNPS et à la CMU pour le mois. Contrairement
// au livre de paie (qui couvre tous les éléments de paie), ce document se
// limite aux cotisations sociales stricto sensu.
// Réutilise bulletinData() pour garantir une stricte cohérence avec les
// bulletins individuels et le livre de paie.
// ===========================================================================

import { formatNum, formatFCFA } from './money';
import { bulletinData } from './bulletin';
import { libelleMois } from './payroll';

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

// --------------------------- Rendu HTML du registre -------------------------

function rowHtml(r, locale) {
  const c = r.calc;
  const e = r.employee;
  const money = (n) => (n ? esc(formatNum(n, locale)) : '—');
  return `<tr>
    <td class="lib mono">${esc(e.matricule || '—')}</td>
    <td class="lib">${esc(e.nom)}</td>
    <td class="lib mono">${esc(e.cnps || '—')}</td>
    <td class="num">${money(c.baseCotisable)}</td>
    <td class="num">${money(c.cnpsRetraite)}</td>
    <td class="num">${money(c.patronal.retraite)}</td>
    <td class="num">${money(c.basePfAt)}</td>
    <td class="num">${money(c.patronal.prestationsFamiliales)}</td>
    <td class="num">${money(c.patronal.accidentTravail)}</td>
    <td class="num strong">${money(totalCnps(c))}</td>
    <td class="num">${money(c.cmu)}</td>
    <td class="num">${money(c.patronal.cmu)}</td>
    <td class="num strong">${money(totalCmu(c))}</td>
    <td class="num net">${money(totalCnps(c) + totalCmu(c))}</td>
  </tr>`;
}

function totalRowHtml(tt, locale) {
  const money = (n) => esc(formatNum(n, locale));
  return `<tr class="tot">
    <td class="lib" colspan="3">TOTAL</td>
    <td class="num">${money(tt.baseCotisable)}</td>
    <td class="num">${money(tt.retraiteSal)}</td>
    <td class="num">${money(tt.retraitePat)}</td>
    <td class="num">${money(tt.basePfAt)}</td>
    <td class="num">${money(tt.prestationsFam)}</td>
    <td class="num">${money(tt.accidentTravail)}</td>
    <td class="num">${money(tt.totalCnps)}</td>
    <td class="num">${money(tt.cmuSal)}</td>
    <td class="num">${money(tt.cmuPat)}</td>
    <td class="num">${money(tt.totalCmu)}</td>
    <td class="num net">${money(tt.totalGeneral)}</td>
  </tr>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .register { background: #fff; margin: 12px; padding: 14px 16px; border: 1px solid #e7e5e4; border-radius: 8px; }
  .head { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-bottom: 10px; }
  .badge { display: inline-block; background: #4f46e5; color: #fff; border-radius: 4px; padding: 4px 20px; font-size: 13px; font-weight: 700; letter-spacing: .08em; margin: 0; }
  .period { font-size: 11px; margin: 5px 0 0; color: #44403c; text-transform: capitalize; }
  table.reg { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.reg th, table.reg td { padding: 3px 5px; border: 1px solid #ececeb; text-align: right; white-space: nowrap; }
  table.reg thead th { background: #eef2ff; color: #3730a3; font-size: 8px; text-transform: uppercase; letter-spacing: .01em; text-align: center; }
  table.reg th.grphead { background: #e0e7ff; }
  table.reg td.lib, table.reg th.lib { text-align: left; }
  table.reg td.mono { font-variant-numeric: tabular-nums; }
  table.reg td.strong { font-weight: 700; background: #faf9ff; }
  table.reg td.net { font-weight: 700; color: #4338ca; }
  table.reg tr.tot td { font-weight: 700; background: #f5f3ff; border-top: 2px solid #c7d2fe; }
  .summary { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 12px; font-size: 11px; }
  .summary .card { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 14px; }
  .summary .card b { display: block; font-size: 14px; color: #4f46e5; }
  .foot { margin-top: 12px; font-size: 8.5px; color: #a8a29e; text-align: center; line-height: 1.5; }
  @media print {
    @page { margin: 10mm; size: A4 landscape; }
    body { background: #fff; }
    .register { border: none; margin: 0; padding: 0; }
  }
`;

const AUTO_PRINT = `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.onafterprint=function(){window.close();};window.print();}catch(e){}},250);});<\/script>`;

export function cotisationsDocumentHtml(rows, ym, { t, locale, autoPrint = false } = {}) {
  const tt = cotisationsTotaux(rows);
  const body = rows.map((r) => rowHtml(r, locale)).join('\n');
  const title = t('cotisations.docTitle');
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
          <tr class="grp">
            <th rowspan="2" class="lib">${esc(t('employees.matricule'))}</th>
            <th rowspan="2" class="lib">${esc(t('employees.name'))}</th>
            <th rowspan="2" class="lib">${esc(t('employees.cnps'))}</th>
            <th colspan="6" class="grphead">${esc(t('cotisations.groupCnps'))}</th>
            <th colspan="3" class="grphead">${esc(t('cotisations.groupCmu'))}</th>
            <th rowspan="2">${esc(t('cotisations.totalGeneral'))}</th>
          </tr>
          <tr>
            <th>${esc(t('cotisations.assietteRetraite'))}</th>
            <th>${esc(t('cotisations.retraiteSal'))}</th>
            <th>${esc(t('cotisations.retraitePat'))}</th>
            <th>${esc(t('cotisations.assiettePfAt'))}</th>
            <th>${esc(t('slip.prestationsFam'))}</th>
            <th>${esc(t('slip.accidentTravail'))}</th>
            <th>${esc(t('cotisations.totalCnps'))}</th>
            <th>${esc(t('cotisations.cmuSal'))}</th>
            <th>${esc(t('cotisations.cmuPat'))}</th>
            <th>${esc(t('cotisations.totalCmu'))}</th>
          </tr>
        </thead>
        <tbody>
          ${body}
          ${totalRowHtml(tt, locale)}
        </tbody>
      </table>
      <div class="summary">
        <div class="card">${esc(t('livrePaie.employeeCount'))}<b>${rows.length}</b></div>
        <div class="card">${esc(t('cotisations.totalCnps'))}<b>${esc(formatFCFA(tt.totalCnps, locale))}</b></div>
        <div class="card">${esc(t('cotisations.totalCmu'))}<b>${esc(formatFCFA(tt.totalCmu, locale))}</b></div>
        <div class="card">${esc(t('cotisations.totalGeneral'))}<b>${esc(formatFCFA(tt.totalGeneral, locale))}</b></div>
      </div>
      <p class="foot">${esc(t('cotisations.footer'))}</p>
    </section>
    ${autoPrint ? AUTO_PRINT : ''}
    </body></html>`;
}

export function telechargerCotisations(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  try {
    const html = cotisationsDocumentHtml(rows, ym, { t, locale, autoPrint: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etat-cotisations-${ym}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
}

export function imprimerCotisations(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  const html = cotisationsDocumentHtml(rows, ym, { t, locale, autoPrint: true });

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

  if (telechargerCotisations(rows, ym, { t, locale })) return 'download';

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
    iframe.srcdoc = cotisationsDocumentHtml(rows, ym, { t, locale });
    return 'iframe';
  } catch {
    return false;
  }
}
