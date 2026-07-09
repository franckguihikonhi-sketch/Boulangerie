// Génération de reçu (impression / PDF via la boîte d'impression du
// navigateur) et construction des e-mails automatiques envoyés à
// l'administrateur (section « Finalisation » et « Paiement » du cahier des
// charges).
//
// Note sur l'envoi d'e-mail : sans backend d'envoi (fonction Edge Supabase ou
// service SMTP), un navigateur ne peut pas expédier un courriel silencieux.
// On ouvre donc le client de messagerie de l'utilisateur pré-rempli
// (lien mailto:) — les pièces jointes signatures ne sont pas transportables
// par mailto, elles restent consultables dans l'application et sur le reçu.

import { formatFCFA } from './money';
import { ADMIN_EMAIL } from './db';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function dateStr(iso, locale) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
}

// Reçu de paiement imprimable (l'utilisateur peut « Enregistrer en PDF »).
export function printReceipt({ devis, payment, total, paid, balance, appName, t, locale }) {
  const win = window.open('', '_blank', 'width=680,height=800');
  if (!win) return false;
  const rows = devis.lines
    .map(
      (l) => `<tr>
        <td>${esc(l.designation)}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">${esc(formatFCFA(l.unitPrice, locale))}</td>
        <td class="num">${esc(formatFCFA(l.amount, locale))}</td>
      </tr>`
    )
    .join('');
  const sign = payment.clientSignature
    ? `<div class="sign"><p>${esc(t('devis.clientSignature'))}</p><img src="${payment.clientSignature}" alt="signature" /></div>`
    : '';
  win.document.write(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
    <title>${esc(t('receipt.title'))} ${esc(devis.number)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1c1917; margin: 0; padding: 28px; }
      h1 { font-size: 20px; margin: 0; }
      .muted { color: #78716c; font-size: 12px; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #d18628; padding-bottom: 12px; margin-bottom: 16px; }
      .badge { display: inline-block; background: #f9edd8; color: #94531b; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
      th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e7e5e4; }
      th { text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: #78716c; }
      .num { text-align: right; }
      .totals { margin-left: auto; width: 260px; font-size: 14px; }
      .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
      .totals .grand { font-weight: 700; border-top: 1px solid #d6d3d1; margin-top: 4px; padding-top: 8px; }
      .paid { color: #15803d; font-weight: 600; }
      .due { color: #b91c1c; font-weight: 600; }
      .sign { margin-top: 24px; }
      .sign img { max-width: 240px; height: auto; border: 1px solid #e7e5e4; border-radius: 8px; margin-top: 4px; }
      .foot { margin-top: 28px; font-size: 11px; color: #a8a29e; text-align: center; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="head">
      <div>
        <h1>${esc(appName)}</h1>
        <p class="muted">${esc(t('receipt.title'))}</p>
      </div>
      <div style="text-align:right">
        <p class="badge">${esc(devis.number)}</p>
        <p class="muted">${esc(dateStr(payment.createdAt, locale))}</p>
      </div>
    </div>
    <p><strong>${esc(t('devis.client'))} :</strong> ${esc(devis.clientName || '—')}
       ${devis.clientContact ? `<span class="muted">(${esc(devis.clientContact)})</span>` : ''}</p>
    <p><strong>${esc(t('devis.paymentType'))} :</strong> ${esc(t('paymentType.' + payment.type))}</p>
    <table>
      <thead><tr>
        <th>${esc(t('devis.designation'))}</th>
        <th class="num">${esc(t('common.quantity'))}</th>
        <th class="num">${esc(t('devis.unitPrice'))}</th>
        <th class="num">${esc(t('common.total'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>${esc(t('devis.total'))}</span><span>${esc(formatFCFA(total, locale))}</span></div>
      <div class="paid"><span>${esc(t('receipt.thisPayment'))}</span><span>${esc(formatFCFA(payment.amount, locale))}</span></div>
      <div><span>${esc(t('devis.paid'))}</span><span>${esc(formatFCFA(paid, locale))}</span></div>
      <div class="grand ${balance > 0 ? 'due' : 'paid'}"><span>${esc(t('devis.balance'))}</span><span>${esc(formatFCFA(balance, locale))}</span></div>
    </div>
    ${sign}
    <p class="foot">${esc(t('receipt.footer'))}</p>
    <script>window.onload = function () { window.print(); };</script>
    </body></html>`);
  win.document.close();
  return true;
}

// Lien mailto: (devis finalisé) — l'administrateur reçoit les infos clés.
export function mailtoDevisFinalized({ devis, total, t, locale }) {
  const subject = `[${t('app.name')}] ${t('email.devisFinalizedSubject')} ${devis.number}`;
  const body = [
    t('email.devisFinalizedIntro'),
    '',
    `${t('devis.number')}: ${devis.number}`,
    `${t('devis.client')}: ${devis.clientName || '—'} ${devis.clientContact ? `(${devis.clientContact})` : ''}`,
    `${t('devis.total')}: ${formatFCFA(total, locale)}`,
    `${t('devis.deliveryDate')}: ${dateStr(devis.deliveryDate, locale)}`,
    `${t('devis.deliveryAddress')}: ${devis.deliveryAddress || '—'}`,
    '',
    t('email.signaturesNote')
  ].join('\n');
  return `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Lien mailto: (paiement enregistré).
export function mailtoPayment({ devis, payment, total, paid, balance, t, locale }) {
  const subject = `[${t('app.name')}] ${t('email.paymentSubject')} ${devis.number}`;
  const body = [
    t('email.paymentIntro'),
    '',
    `${t('devis.number')}: ${devis.number}`,
    `${t('devis.client')}: ${devis.clientName || '—'}`,
    `${t('devis.paymentType')}: ${t('paymentType.' + payment.type)}`,
    `${t('receipt.thisPayment')}: ${formatFCFA(payment.amount, locale)}`,
    `${t('devis.total')}: ${formatFCFA(total, locale)}`,
    `${t('devis.paid')}: ${formatFCFA(paid, locale)}`,
    `${t('devis.balance')}: ${formatFCFA(balance, locale)}`
  ].join('\n');
  return `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
