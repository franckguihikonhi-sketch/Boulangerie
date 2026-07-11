// Montants en FCFA, stockés et affichés en entiers.

export function roundFCFA(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function formatFCFA(amount) {
  return `${roundFCFA(amount).toLocaleString('fr-FR')} FCFA`;
}
