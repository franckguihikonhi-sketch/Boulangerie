// Devise unique : FCFA, toujours stockée et affichée en entiers. Tout montant
// est arrondi à l'entier AVANT écriture (jamais seulement à l'affichage), afin
// d'éviter la dérive flottante sur les bulletins et les cumuls annuels.

export function roundFCFA(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function formatFCFA(amount, locale = 'fr') {
  const n = roundFCFA(amount);
  return `${n.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')} FCFA`;
}

// Montant nu (sans le suffixe « FCFA ») — utile dans les tableaux serrés.
export function formatNum(amount, locale = 'fr') {
  return roundFCFA(amount).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US');
}
