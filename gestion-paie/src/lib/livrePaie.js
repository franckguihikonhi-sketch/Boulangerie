// ===========================================================================
// ÉTAT DU LIVRE DE PAIE MENSUEL
// ---------------------------------------------------------------------------
// Registre récapitulatif de tous les salariés payés sur un mois donné : une
// ligne par salarié (parts salariale ET patronale), plus une ligne de totaux.
// Réutilise les calculs déjà produits pour les bulletins individuels
// (bulletinData) : mêmes montants, mêmes règles (congés, requalification
// CDD → CDI), pour garantir une stricte cohérence entre bulletins et livre
// de paie. Même mécanisme d'impression / export PDF sans dépendance externe.
// ===========================================================================

import { formatNum, formatFCFA } from './money';
import { bulletinData } from './bulletin';
import { libelleMois } from './payroll';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Construit une ligne de registre pour chaque salarié dont le contrat couvre
// le mois donné (mêmes règles que bulletinData : requalification CDD → CDI,
// congé au mois anniversaire). Trie par matricule puis nom.
export function livrePaieData(employees, ym, settings) {
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

// Cumule les montants clés de toutes les lignes (ligne « TOTAL » du registre).
export function livrePaieTotaux(rows) {
  const t = {
    salaireBase: 0, sursalaire: 0, primeAnciennete: 0, congePaye: 0, transport: 0,
    brutImposable: 0, brutTotal: 0, cnpsRetraite: 0, cmu: 0, impotNet: 0,
    totalRetenues: 0, netAPayer: 0,
    patRetraite: 0, patPf: 0, patAt: 0, patIsLocal: 0, patTaxeApp: 0, patFpc: 0, patCmu: 0,
    totalPatronal: 0, coutTotalEmployeur: 0
  };
  for (const r of rows) {
    const c = r.calc;
    t.salaireBase += c.salaireBase;
    t.sursalaire += c.sursalaire;
    t.primeAnciennete += c.primeAnciennete;
    t.congePaye += c.congePaye;
    t.transport += c.transport;
    t.brutImposable += c.brutImposable;
    t.brutTotal += c.brutTotal;
    t.cnpsRetraite += c.cnpsRetraite;
    t.cmu += c.cmu;
    t.impotNet += c.impotNet;
    t.totalRetenues += c.totalRetenues;
    t.netAPayer += c.netAPayer;
    t.patRetraite += c.patronal.retraite;
    t.patPf += c.patronal.prestationsFamiliales;
    t.patAt += c.patronal.accidentTravail;
    t.patIsLocal += c.patronal.isLocal;
    t.patTaxeApp += c.patronal.taxeApprentissage;
    t.patFpc += c.patronal.fpc;
    t.patCmu += c.patronal.cmu;
    t.totalPatronal += c.totalPatronal;
    t.coutTotalEmployeur += c.coutTotalEmployeur;
  }
  return t;
}

// --------------------------- Rendu HTML du registre -------------------------

function rowHtml(r, t, locale) {
  const c = r.calc;
  const e = r.employee;
  const money = (n) => (n ? esc(formatNum(n, locale)) : '—');
  return `<tr>
    <td class="lib mono">${esc(e.matricule || '—')}</td>
    <td class="lib">${esc(e.nom)}</td>
    <td class="lib">${esc(e.emploi || '—')}</td>
    <td class="ctr">${esc(t('contract.' + r.periode.kind))}</td>
    <td class="num">${money(c.salaireBase)}</td>
    <td class="num">${money(c.sursalaire)}</td>
    <td class="num">${money(c.primeAnciennete)}</td>
    <td class="num">${money(c.congePaye)}</td>
    <td class="num">${money(c.transport)}</td>
    <td class="num strong">${money(c.brutImposable)}</td>
    <td class="num strong">${money(c.brutTotal)}</td>
    <td class="num">${money(c.cnpsRetraite)}</td>
    <td class="num">${money(c.cmu)}</td>
    <td class="num">${money(c.impotNet)}</td>
    <td class="num strong">${money(c.totalRetenues)}</td>
    <td class="num net">${money(c.netAPayer)}</td>
    <td class="num">${money(c.patronal.retraite)}</td>
    <td class="num">${money(c.patronal.prestationsFamiliales)}</td>
    <td class="num">${money(c.patronal.accidentTravail)}</td>
    <td class="num">${money(c.patronal.isLocal)}</td>
    <td class="num">${money(c.patronal.taxeApprentissage)}</td>
    <td class="num">${money(c.patronal.fpc)}</td>
    <td class="num">${money(c.patronal.cmu)}</td>
    <td class="num strong">${money(c.totalPatronal)}</td>
    <td class="num strong">${money(c.coutTotalEmployeur)}</td>
  </tr>`;
}

function totalRowHtml(tt, locale) {
  const money = (n) => esc(formatNum(n, locale));
  return `<tr class="tot">
    <td class="lib" colspan="4">TOTAL</td>
    <td class="num">${money(tt.salaireBase)}</td>
    <td class="num">${money(tt.sursalaire)}</td>
    <td class="num">${money(tt.primeAnciennete)}</td>
    <td class="num">${money(tt.congePaye)}</td>
    <td class="num">${money(tt.transport)}</td>
    <td class="num">${money(tt.brutImposable)}</td>
    <td class="num">${money(tt.brutTotal)}</td>
    <td class="num">${money(tt.cnpsRetraite)}</td>
    <td class="num">${money(tt.cmu)}</td>
    <td class="num">${money(tt.impotNet)}</td>
    <td class="num">${money(tt.totalRetenues)}</td>
    <td class="num net">${money(tt.netAPayer)}</td>
    <td class="num">${money(tt.patRetraite)}</td>
    <td class="num">${money(tt.patPf)}</td>
    <td class="num">${money(tt.patAt)}</td>
    <td class="num">${money(tt.patIsLocal)}</td>
    <td class="num">${money(tt.patTaxeApp)}</td>
    <td class="num">${money(tt.patFpc)}</td>
    <td class="num">${money(tt.patCmu)}</td>
    <td class="num">${money(tt.totalPatronal)}</td>
    <td class="num">${money(tt.coutTotalEmployeur)}</td>
  </tr>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #1c1917; margin: 0; padding: 0; background: #f5f5f4; }
  .register { background: #fff; margin: 12px; padding: 14px 16px; border: 1px solid #e7e5e4; border-radius: 8px; }
  .head { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-bottom: 10px; }
  .badge { display: inline-block; background: #4f46e5; color: #fff; border-radius: 4px; padding: 4px 20px; font-size: 13px; font-weight: 700; letter-spacing: .08em; margin: 0; }
  .period { font-size: 11px; margin: 5px 0 0; color: #44403c; text-transform: capitalize; }
  table.reg { width: 100%; border-collapse: collapse; font-size: 8.5px; }
  table.reg th, table.reg td { padding: 2.5px 4px; border: 1px solid #ececeb; text-align: right; white-space: nowrap; }
  table.reg thead th { background: #eef2ff; color: #3730a3; font-size: 7.5px; text-transform: uppercase; letter-spacing: .01em; text-align: center; }
  table.reg th.grphead { background: #e0e7ff; }
  table.reg td.lib, table.reg th.lib { text-align: left; }
  table.reg td.mono { font-variant-numeric: tabular-nums; }
  table.reg td.ctr, table.reg th.ctr { text-align: center; }
  table.reg td.strong { font-weight: 700; background: #faf9ff; }
  table.reg td.net { font-weight: 700; color: #4338ca; }
  table.reg tr.tot td { font-weight: 700; background: #f5f3ff; border-top: 2px solid #c7d2fe; }
  .summary { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 12px; font-size: 11px; }
  .summary .card { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 14px; }
  .summary .card b { display: block; font-size: 14px; color: #4f46e5; }
  .foot { margin-top: 12px; font-size: 8.5px; color: #a8a29e; text-align: center; line-height: 1.5; }
  @media print {
    @page { margin: 8mm; size: A4 landscape; }
    body { background: #fff; }
    .register { border: none; margin: 0; padding: 0; }
  }
`;

const AUTO_PRINT = `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.onafterprint=function(){window.close();};window.print();}catch(e){}},250);});<\/script>`;

// Construit le document HTML complet (autonome) du registre pour un mois.
export function livreDocumentHtml(rows, ym, { t, locale, autoPrint = false } = {}) {
  const tt = livrePaieTotaux(rows);
  const body = rows.map((r) => rowHtml(r, t, locale)).join('\n');
  const title = t('livrePaie.docTitle');
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
            <th rowspan="2" class="lib">${esc(t('employees.emploi'))}</th>
            <th rowspan="2" class="ctr">${esc(t('employees.contract'))}</th>
            <th colspan="12" class="grphead">${esc(t('livrePaie.groupSalarial'))}</th>
            <th colspan="9" class="grphead">${esc(t('livrePaie.groupPatronal'))}</th>
          </tr>
          <tr>
            <th>${esc(t('slip.salaireBase'))}</th>
            <th>${esc(t('slip.sursalaire'))}</th>
            <th>${esc(t('slip.primeAnciennete'))}</th>
            <th>${esc(t('livrePaie.conge'))}</th>
            <th>${esc(t('slip.transport'))}</th>
            <th>${esc(t('slip.brutImposable'))}</th>
            <th>${esc(t('slip.brutTotal'))}</th>
            <th>${esc(t('livrePaie.cnpsSal'))}</th>
            <th>${esc(t('slip.cmu'))}</th>
            <th>${esc(t('slip.its'))}</th>
            <th>${esc(t('slip.totalRetenues'))}</th>
            <th>${esc(t('slip.netAPayer'))}</th>
            <th>${esc(t('livrePaie.cnpsPat'))}</th>
            <th>${esc(t('slip.prestationsFam'))}</th>
            <th>${esc(t('slip.accidentTravail'))}</th>
            <th>${esc(t('slip.isLocal'))}</th>
            <th>${esc(t('slip.taxeApprentissage'))}</th>
            <th>${esc(t('slip.fpc'))}</th>
            <th>${esc(t('livrePaie.cmuPat'))}</th>
            <th>${esc(t('slip.totalPatronal'))}</th>
            <th>${esc(t('slip.coutTotal'))}</th>
          </tr>
        </thead>
        <tbody>
          ${body}
          ${totalRowHtml(tt, locale)}
        </tbody>
      </table>
      <div class="summary">
        <div class="card">${esc(t('livrePaie.employeeCount'))}<b>${rows.length}</b></div>
        <div class="card">${esc(t('slip.netAPayer'))}<b>${esc(formatFCFA(tt.netAPayer, locale))}</b></div>
        <div class="card">${esc(t('slip.totalPatronal'))}<b>${esc(formatFCFA(tt.totalPatronal, locale))}</b></div>
        <div class="card">${esc(t('slip.coutTotal'))}<b>${esc(formatFCFA(tt.coutTotalEmployeur, locale))}</b></div>
      </div>
      <p class="foot">${esc(t('livrePaie.footer'))}</p>
    </section>
    ${autoPrint ? AUTO_PRINT : ''}
    </body></html>`;
}

// Télécharge le registre sous forme de fichier HTML autonome (imprimable /
// « Enregistrer en PDF » une fois ouvert). Fonctionne même dans un cadre
// restreint qui bloque l'impression directe.
export function telechargerLivrePaie(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  try {
    const html = livreDocumentHtml(rows, ym, { t, locale, autoPrint: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `livre-de-paie-${ym}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch {
    return false;
  }
}

// Imprime (ou exporte en PDF) le registre, avec le même repli en trois temps
// que pour les bulletins individuels (voir bulletin.js) : nouvel onglet, puis
// téléchargement, puis impression via iframe caché. Renvoie le mode utilisé :
// 'tab' | 'download' | 'iframe' | false.
export function imprimerLivrePaie(rows, ym, { t, locale }) {
  if (!rows || rows.length === 0) return false;
  const html = livreDocumentHtml(rows, ym, { t, locale, autoPrint: true });

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

  if (telechargerLivrePaie(rows, ym, { t, locale })) return 'download';

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
    iframe.srcdoc = livreDocumentHtml(rows, ym, { t, locale });
    return 'iframe';
  } catch {
    return false;
  }
}
