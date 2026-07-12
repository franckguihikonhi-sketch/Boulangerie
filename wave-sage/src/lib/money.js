// ---------------------------------------------------------------------------
// Montants en francs CFA (XOF). Le franc CFA n'a PAS de sous-unité : tous les
// montants comptables sont des ENTIERS. On force donc l'arrondi à l'entier
// avant toute écriture pour éviter les résidus flottants.
// ---------------------------------------------------------------------------

// Arrondit à l'entier FCFA le plus proche (jamais de centimes en XOF).
export function roundFCFA(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

// Formate un entier FCFA avec séparateur de milliers (espace fine) : « 1 405 800 ».
export function formatFCFA(valeur) {
  const n = roundFCFA(valeur);
  return n.toLocaleString('fr-FR').replace(/ /g, ' ');
}
