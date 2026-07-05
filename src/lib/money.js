// Devise unique : FCFA, toujours stockée et affichée en entiers.
// Tout montant est arrondi à l'entier AVANT écriture en base — jamais
// seulement à l'affichage (anomalies n°1 et 3 du cahier des charges).

export function roundFCFA(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function formatFCFA(amount, locale = 'fr') {
  const n = roundFCFA(amount);
  return `${n.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')} FCFA`;
}

// Quantités physiques : stockées dans l'unité de base de l'ingrédient
// (g / ml / unité), arrondies à 2 décimales pour éviter la dérive flottante.
export function roundQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
