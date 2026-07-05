// Normalisation des unités (anomalies n°8 et 9).
// Chaque ingrédient a UNE unité de base fixe en laquelle tout est stocké
// (stock, mouvements, quantités de recette). La conversion vers l'unité
// d'affichage (kg, L…) est purement visuelle et automatique.

export const BASE_UNITS = ['g', 'ml', 'unite'];

// Unités acceptées à la saisie, avec leur facteur vers l'unité de base.
export const UNIT_DEFS = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  L: { base: 'ml', factor: 1000 },
  unite: { base: 'unite', factor: 1 }
};

// Unités proposées pour une unité de base donnée.
export function unitsForBase(baseUnit) {
  return Object.keys(UNIT_DEFS).filter((u) => UNIT_DEFS[u].base === baseUnit);
}

// Convertit une quantité saisie (qty, unit) vers l'unité de base attendue.
// Lève une erreur si l'unité est incompatible avec l'ingrédient : une
// recette ne peut pas saisir des "L" pour de la farine stockée en grammes.
export function toBase(qty, unit, baseUnit) {
  const def = UNIT_DEFS[unit];
  if (!def || def.base !== baseUnit) {
    throw new Error(`Unité « ${unit} » incompatible avec l'unité de base « ${baseUnit} »`);
  }
  return Number(qty) * def.factor;
}

// Affichage lisible : bascule automatiquement vers kg / L quand pertinent.
export function formatQty(qtyBase, baseUnit, locale = 'fr') {
  const n = Number(qtyBase) || 0;
  const loc = locale === 'fr' ? 'fr-FR' : 'en-US';
  const fmt = (v, max = 2) =>
    v.toLocaleString(loc, { maximumFractionDigits: max });

  if (baseUnit === 'g') {
    if (Math.abs(n) >= 1000) return `${fmt(n / 1000, 3)} kg`;
    return `${fmt(n)} g`;
  }
  if (baseUnit === 'ml') {
    if (Math.abs(n) >= 1000) return `${fmt(n / 1000, 3)} L`;
    return `${fmt(n)} ml`;
  }
  return `${fmt(n)} u.`;
}

// Libellé de l'unité "stock" (celle du coût unitaire) : le CMP est exprimé
// en FCFA par kg / L / unité pour rester un entier lisible.
export function stockUnitLabel(baseUnit) {
  if (baseUnit === 'g') return 'kg';
  if (baseUnit === 'ml') return 'L';
  return 'unité';
}

// Facteur base → unité de stock (g → kg = 1000).
export function stockUnitFactor(baseUnit) {
  return baseUnit === 'unite' ? 1 : 1000;
}
