// Devise unique : FCFA, toujours stockée et affichée en entiers. Tout montant
// est arrondi à l'entier AVANT écriture (jamais seulement à l'affichage).

export function roundFCFA(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function formatFCFA(amount, locale = 'fr') {
  const n = roundFCFA(amount);
  return `${n.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')} FCFA`;
}

// Quantités (nombre de cartons / sachets) : arrondies à 2 décimales pour
// éviter la dérive flottante, même si l'usage courant est en entiers.
export function roundQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
