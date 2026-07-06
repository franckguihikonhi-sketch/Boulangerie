// ---------------------------------------------------------------------------
// Couche de données Boulange ERP.
//
// Implémente localement (localStorage) les mêmes garanties que le schéma
// PostgreSQL/Supabase cible (voir supabase/schema.sql) :
//   - écritures atomiques : une opération métier = une transaction ; si une
//     validation échoue, RIEN n'est persisté (anomalie n°12) ;
//   - stock_movements = source de vérité unique, current_quantity est
//     toujours dérivé par somme des mouvements (anomalies n°2, 12) ;
//   - montants FCFA arrondis à l'entier AVANT écriture (anomalies n°1, 3) ;
//   - clé d'idempotence UNIQUE sur productions et achats (anomalies n°4, 5) ;
//   - total_cost d'une production figé à la validation, jamais recalculé
//     (anomalie n°7).
//
// Pour migrer vers Supabase : remplacer ce module par des appels RPC vers
// les fonctions SQL du schéma cible, l'API publique reste identique.
// ---------------------------------------------------------------------------

import { roundFCFA, roundQty } from './money';
import { stockUnitFactor } from './units';

const STORAGE_KEY = 'boulange-erp-v2';

export const CATEGORIES = ['pain', 'viennoiserie', 'patisserie', 'boisson', 'autre'];
export const INGREDIENT_TYPES = ['matiere_premiere', 'charge_utilite'];
export const MOVEMENT_REASONS = ['achat', 'production', 'ajustement', 'perte'];

let state = null;
const listeners = new Set();

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Repli UUID v4 pour les navigateurs mobiles plus anciens (iOS < 15.4,
  // vieux Android) qui n'ont pas crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function emptyState() {
  return {
    version: 2,
    ingredients: [],
    products: [],
    recipes: [],
    purchases: [],
    productions: [],
    sales: [],
    stockMovements: []
  };
}

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : null;
  } catch {
    state = null;
  }
  if (!state) {
    state = emptyState();
    seed(state);
    persist(state);
  }
  return state;
}

function persist(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return load();
}

// Transaction : fn reçoit une copie profonde de l'état ; si fn lève une
// exception, l'état courant et le stockage restent intacts.
function mutate(fn) {
  const draft = JSON.parse(JSON.stringify(load()));
  const result = fn(draft);
  persist(draft);
  state = draft;
  listeners.forEach((l) => l());
  return result;
}

export function resetDemoData() {
  const fresh = emptyState();
  seed(fresh);
  persist(fresh);
  state = fresh;
  listeners.forEach((l) => l());
}

// --------------------------- Sélecteurs -----------------------------------

// Stock actuel d'un ingrédient = somme de ses mouvements (source de vérité).
export function currentQty(s, ingredientId) {
  let total = 0;
  for (const m of s.stockMovements) {
    if (m.ingredientId === ingredientId) total += m.changeBase;
  }
  return roundQty(total);
}

// Valeur du stock d'un ingrédient = quantité (en unité de stock) × CMP.
export function stockValue(s, ingredient) {
  const qty = currentQty(s, ingredient.id);
  const factor = stockUnitFactor(ingredient.baseUnit);
  return roundFCFA((qty / factor) * ingredient.unitCost);
}

// Stock de produit fini = total produit − total vendu.
export function productStock(s, productId) {
  let produced = 0;
  let sold = 0;
  for (const p of s.productions) if (p.productId === productId) produced += p.quantityProduced;
  for (const v of s.sales) if (v.productId === productId) sold += v.quantity;
  return produced - sold;
}

export function recipeFor(s, productId) {
  return s.recipes.filter((r) => r.productId === productId);
}

export function lastPurchaseAt(s, ingredientId) {
  let last = null;
  for (const p of s.purchases) {
    if (p.ingredientId === ingredientId && (!last || p.purchasedAt > last)) last = p.purchasedAt;
  }
  return last;
}

// ------------------------- Ingrédients -------------------------------------

export function addIngredient({ name, type, baseUnit, minThreshold, unitCost, initialQty = 0, author }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  return mutate((s) => {
    const id = uid();
    s.ingredients.push({
      id,
      name: name.trim(),
      type,
      baseUnit,
      minThreshold: roundQty(minThreshold) || 0,
      unitCost: roundFCFA(unitCost),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (initialQty > 0) {
      s.stockMovements.push({
        id: uid(),
        ingredientId: id,
        changeBase: roundQty(initialQty),
        reason: 'ajustement',
        referenceId: null,
        note: 'Stock initial',
        createdAt: new Date().toISOString(),
        author
      });
    }
    return id;
  });
}

export function updateIngredient(id, { name, minThreshold, unitCost }) {
  mutate((s) => {
    const ing = s.ingredients.find((i) => i.id === id);
    if (!ing) throw new Error('errors.notFound');
    if (name?.trim()) ing.name = name.trim();
    if (minThreshold !== undefined) ing.minThreshold = roundQty(minThreshold);
    if (unitCost !== undefined) ing.unitCost = roundFCFA(unitCost);
    ing.updatedAt = new Date().toISOString();
  });
}

export function deleteIngredient(id) {
  mutate((s) => {
    const used =
      s.recipes.some((r) => r.ingredientId === id) ||
      s.stockMovements.some((m) => m.ingredientId === id);
    if (used) throw new Error('errors.ingredientInUse');
    s.ingredients = s.ingredients.filter((i) => i.id !== id);
  });
}

export function adjustStock({ ingredientId, changeBase, reason, note, author }) {
  if (!MOVEMENT_REASONS.includes(reason)) throw new Error('errors.badReason');
  mutate((s) => {
    const ing = s.ingredients.find((i) => i.id === ingredientId);
    if (!ing) throw new Error('errors.notFound');
    const after = currentQty(s, ingredientId) + changeBase;
    if (after < 0) throw new Error('errors.negativeStock');
    s.stockMovements.push({
      id: uid(),
      ingredientId,
      changeBase: roundQty(changeBase),
      reason,
      referenceId: null,
      note: note || '',
      createdAt: new Date().toISOString(),
      author
    });
  });
}

// --------------------------- Produits & recettes ---------------------------

export function saveProduct({ id, name, category, sellingPrice, isActive = true }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  // Catégorie : liste fermée, jamais traduite automatiquement (anomalie n°10).
  if (!CATEGORIES.includes(category)) throw new Error('errors.badCategory');
  return mutate((s) => {
    if (id) {
      const p = s.products.find((x) => x.id === id);
      if (!p) throw new Error('errors.notFound');
      Object.assign(p, { name: name.trim(), category, sellingPrice: roundFCFA(sellingPrice), isActive });
      return id;
    }
    const newId = uid();
    s.products.push({
      id: newId,
      name: name.trim(),
      category,
      sellingPrice: roundFCFA(sellingPrice),
      isActive,
      createdAt: new Date().toISOString()
    });
    return newId;
  });
}

export function deleteProduct(id) {
  mutate((s) => {
    const used = s.productions.some((p) => p.productId === id) || s.sales.some((v) => v.productId === id);
    if (used) throw new Error('errors.productInUse');
    s.products = s.products.filter((p) => p.id !== id);
    s.recipes = s.recipes.filter((r) => r.productId !== id);
  });
}

// Remplace la recette complète d'un produit. lines: [{ingredientId, qtyBase}]
// Un ingrédient ne peut apparaître qu'une fois (contrainte UNIQUE du schéma).
export function saveRecipe(productId, lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.ingredientId)) throw new Error('errors.duplicateRecipeLine');
    seen.add(l.ingredientId);
    if (!(l.qtyBase > 0)) throw new Error('errors.badQuantity');
  }
  mutate((s) => {
    s.recipes = s.recipes.filter((r) => r.productId !== productId);
    for (const l of lines) {
      s.recipes.push({
        id: uid(),
        productId,
        ingredientId: l.ingredientId,
        qtyBase: roundQty(l.qtyBase)
      });
    }
  });
}

// ------------------------------ Achats --------------------------------------

// Enregistre un achat en UNE opération atomique : ligne d'achat + mouvement
// de stock + recalcul du CMP (section 5.3 du cahier des charges).
export function recordPurchase({ ingredientId, qtyBase, unitCost, supplier, note, idempotencyKey, author, at }) {
  if (!(qtyBase > 0)) throw new Error('errors.badQuantity');
  if (!(unitCost >= 0)) throw new Error('errors.badCost');
  return mutate((s) => {
    // Idempotence : re-soumission réseau ou double clic → renvoyer l'existant.
    const existing = s.purchases.find((p) => p.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;

    const ing = s.ingredients.find((i) => i.id === ingredientId);
    if (!ing) throw new Error('errors.notFound');

    const factor = stockUnitFactor(ing.baseUnit);
    const qty = roundQty(qtyBase);
    const cost = roundFCFA(unitCost); // FCFA par unité de stock (kg / L / unité), entier

    const qtyBefore = currentQty(s, ingredientId) / factor; // en unités de stock
    const valueBefore = qtyBefore * ing.unitCost;
    const qtyPurchased = qty / factor;

    // CMP = (valeur avant + quantité achetée × coût) ÷ (qté avant + qté achetée)
    const denominator = qtyBefore + qtyPurchased;
    ing.unitCost = denominator > 0
      ? roundFCFA((valueBefore + qtyPurchased * cost) / denominator)
      : cost;
    ing.updatedAt = new Date().toISOString();

    const id = uid();
    const when = at || new Date().toISOString();
    s.purchases.push({
      id,
      ingredientId,
      qtyBase: qty,
      unitCost: cost,
      totalCost: roundFCFA(qtyPurchased * cost),
      supplier: supplier || '',
      note: note || '',
      purchasedAt: when,
      idempotencyKey,
      author
    });
    s.stockMovements.push({
      id: uid(),
      ingredientId,
      changeBase: qty,
      reason: 'achat',
      referenceId: id,
      note: '',
      createdAt: when,
      author
    });
    return id;
  });
}

// Suppression d'un achat (anomalie n°12) : dans la MÊME transaction, retire
// la ligne d'achat ET son mouvement de stock. Bloquée avec un message
// explicite si le stock a déjà été consommé en production.
export function deletePurchase(purchaseId) {
  mutate((s) => {
    const purchase = s.purchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new Error('errors.notFound');
    const remaining = currentQty(s, purchase.ingredientId) - purchase.qtyBase;
    if (remaining < 0) throw new Error('errors.stockAlreadyConsumed');
    s.purchases = s.purchases.filter((p) => p.id !== purchaseId);
    s.stockMovements = s.stockMovements.filter(
      (m) => !(m.reason === 'achat' && m.referenceId === purchaseId)
    );
  });
}

// ----------------------------- Production -----------------------------------

// Aperçu avant validation : consommation par ingrédient, coût prévisionnel
// (CMP courant), revenu et bénéfice prévus. Le MÊME calcul sert ensuite à
// figer total_cost, ce qui garantit aperçu == historique (anomalie n°7).
export function productionPreview(s, productId, quantity) {
  const product = s.products.find((p) => p.id === productId);
  if (!product || !(quantity > 0)) return null;
  const lines = [];
  const shortages = [];
  let totalCost = 0;
  for (const r of recipeFor(s, productId)) {
    const ing = s.ingredients.find((i) => i.id === r.ingredientId);
    if (!ing) continue;
    const needed = roundQty(r.qtyBase * quantity);
    const available = currentQty(s, ing.id);
    const factor = stockUnitFactor(ing.baseUnit);
    const cost = roundFCFA((needed / factor) * ing.unitCost);
    totalCost += cost;
    lines.push({ ingredient: ing, needed, available, cost });
    if (needed > available) {
      shortages.push({ ingredient: ing, missing: roundQty(needed - available) });
    }
  }
  totalCost = roundFCFA(totalCost);
  const revenue = roundFCFA(product.sellingPrice * quantity);
  return { product, quantity, lines, shortages, totalCost, revenue, profit: revenue - totalCost };
}

export function recordProduction({ productId, quantity, note, idempotencyKey, author, at }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return mutate((s) => {
    // Clé d'idempotence UNIQUE : si le serveur reçoit deux fois la même clé,
    // il renvoie le résultat existant sans dupliquer (anomalies n°4 et 5).
    const existing = s.productions.find((p) => p.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;

    const preview = productionPreview(s, productId, quantity);
    if (!preview) throw new Error('errors.notFound');
    if (preview.lines.length === 0) throw new Error('errors.noRecipe');
    if (preview.shortages.length > 0) {
      // Message précis : quel ingrédient manque, et de combien.
      const err = new Error('errors.insufficientStock');
      err.shortages = preview.shortages.map((x) => ({
        name: x.ingredient.name,
        baseUnit: x.ingredient.baseUnit,
        missing: x.missing
      }));
      throw err;
    }

    const id = uid();
    const when = at || new Date().toISOString();
    s.productions.push({
      id,
      productId,
      quantityProduced: quantity,
      note: note || '',
      producedAt: when,
      // total_cost figé à la validation, JAMAIS recalculé rétroactivement.
      totalCost: preview.totalCost,
      idempotencyKey,
      author,
      lines: preview.lines.map((l) => ({
        ingredientId: l.ingredient.id,
        qtyBase: l.needed,
        cost: l.cost
      }))
    });
    for (const l of preview.lines) {
      s.stockMovements.push({
        id: uid(),
        ingredientId: l.ingredient.id,
        changeBase: -l.needed,
        reason: 'production',
        referenceId: id,
        note: '',
        createdAt: when,
        author
      });
    }
    return id;
  });
}

// ------------------------------- Ventes --------------------------------------

// Seul le stock de produits FINIS est décrémenté : le stock d'ingrédients a
// déjà été décrémenté au moment de la production (section 5.5).
export function recordSale({ productId, quantity, unitPrice, client, note, idempotencyKey, author, at }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return mutate((s) => {
    const existing = s.sales.find((v) => v.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;
    const product = s.products.find((p) => p.id === productId);
    if (!product) throw new Error('errors.notFound');
    if (productStock(s, productId) < quantity) throw new Error('errors.insufficientProductStock');
    const price = roundFCFA(unitPrice);
    const id = uid();
    s.sales.push({
      id,
      productId,
      quantity,
      unitPrice: price,
      total: roundFCFA(price * quantity),
      client: client || '',
      note: note || '',
      soldAt: at || new Date().toISOString(),
      idempotencyKey,
      author
    });
    return id;
  });
}

// ----------------------------- Données de démo -------------------------------

function seed(s) {
  const author = 'admin@boulangerie.com';
  const now = Date.now();
  const day = (n) => new Date(now - n * 86400000).toISOString();

  const mk = (name, type, baseUnit, minThreshold, unitCost) => {
    const id = uid();
    s.ingredients.push({
      id, name, type, baseUnit, minThreshold, unitCost: roundFCFA(unitCost),
      createdAt: day(12), updatedAt: day(12)
    });
    return id;
  };

  const farine = mk('Farine de blé', 'matiere_premiere', 'g', 20000, 400);
  const sel = mk('Sel', 'matiere_premiere', 'g', 2000, 650);
  const sucre = mk('Sucre', 'matiere_premiere', 'g', 5000, 800);
  const beurre = mk('Beurre', 'matiere_premiere', 'g', 3000, 3500);
  const levure = mk('Levure boulangère', 'matiere_premiere', 'g', 1000, 2500);
  const glacage = mk('Glaçage', 'matiere_premiere', 'g', 500, 2000);
  const lait = mk('Lait', 'matiere_premiere', 'ml', 5000, 500);
  const chocolat = mk('Chocolat pâtissier', 'matiere_premiere', 'g', 1000, 4000);
  const eau = mk('Eau', 'charge_utilite', 'ml', 10000, 1);
  const electricite = mk('Électricité (kWh)', 'charge_utilite', 'unite', 20, 150);

  const mkProduct = (name, category, sellingPrice) => {
    const id = uid();
    s.products.push({ id, name, category, sellingPrice, isActive: true, createdAt: day(12) });
    return id;
  };
  const baguette = mkProduct('Baguette', 'pain', 150);
  const painComplet = mkProduct('Pain complet', 'pain', 250);
  const croissant = mkProduct('Croissant', 'viennoiserie', 300);
  const painChoco = mkProduct('Pain au chocolat', 'viennoiserie', 350);
  const gateau = mkProduct('Gâteau vanille', 'patisserie', 2500);

  const addRecipe = (productId, lines) => {
    for (const [ingredientId, qtyBase] of lines) {
      s.recipes.push({ id: uid(), productId, ingredientId, qtyBase });
    }
  };
  addRecipe(baguette, [[farine, 250], [sel, 5], [levure, 3], [eau, 150], [electricite, 0.1]]);
  addRecipe(painComplet, [[farine, 400], [sel, 8], [levure, 5], [eau, 220], [electricite, 0.15]]);
  addRecipe(croissant, [[farine, 80], [beurre, 30], [sucre, 10], [levure, 2], [lait, 30], [electricite, 0.1]]);
  addRecipe(painChoco, [[farine, 80], [beurre, 30], [chocolat, 25], [sucre, 10], [levure, 2], [electricite, 0.1]]);
  addRecipe(gateau, [[farine, 300], [sucre, 250], [beurre, 200], [lait, 150], [glacage, 100], [electricite, 0.5]]);

  const purchase = (ingredientId, qtyBase, unitCost, supplier, daysAgo) => {
    const ing = s.ingredients.find((i) => i.id === ingredientId);
    const factor = stockUnitFactor(ing.baseUnit);
    const qtyBefore = currentQty(s, ingredientId) / factor;
    const valueBefore = qtyBefore * ing.unitCost;
    const qtyPurchased = qtyBase / factor;
    const denominator = qtyBefore + qtyPurchased;
    ing.unitCost = denominator > 0
      ? roundFCFA((valueBefore + qtyPurchased * unitCost) / denominator)
      : roundFCFA(unitCost);
    const id = uid();
    const when = new Date(now - daysAgo * 86400000).toISOString();
    s.purchases.push({
      id, ingredientId, qtyBase: roundQty(qtyBase), unitCost: roundFCFA(unitCost),
      totalCost: roundFCFA(qtyPurchased * unitCost),
      supplier, note: '', purchasedAt: when, idempotencyKey: uid(), author
    });
    s.stockMovements.push({
      id: uid(), ingredientId, changeBase: roundQty(qtyBase), reason: 'achat',
      referenceId: id, note: '', createdAt: when, author
    });
  };

  purchase(farine, 100000, 400, 'Moulins d’Abidjan', 9);
  purchase(sel, 19000, 650, 'Marché central', 9);
  purchase(sucre, 25000, 800, 'Marché central', 8);
  purchase(beurre, 10000, 3500, 'Laiterie Ivoire', 8);
  purchase(levure, 5000, 2500, 'Moulins d’Abidjan', 8);
  purchase(glacage, 2000, 2000, 'Pâtis-Fournitures', 7);
  purchase(lait, 20000, 500, 'Laiterie Ivoire', 7);
  purchase(chocolat, 5000, 4000, 'Pâtis-Fournitures', 7);
  purchase(eau, 150000, 1, 'SODECI', 9);
  purchase(electricite, 150, 150, 'CIE', 9);
  purchase(farine, 50000, 420, 'Moulins d’Abidjan', 3);
  purchase(beurre, 5000, 3600, 'Laiterie Ivoire', 2);

  const produce = (productId, quantity, daysAgo, hour) => {
    const when = new Date(now - daysAgo * 86400000);
    when.setHours(hour, 15, 0, 0);
    const iso = when.toISOString();
    let totalCost = 0;
    const lines = [];
    for (const r of s.recipes.filter((x) => x.productId === productId)) {
      const ing = s.ingredients.find((i) => i.id === r.ingredientId);
      const needed = roundQty(r.qtyBase * quantity);
      const factor = stockUnitFactor(ing.baseUnit);
      const cost = roundFCFA((needed / factor) * ing.unitCost);
      totalCost += cost;
      lines.push({ ingredientId: ing.id, qtyBase: needed, cost });
    }
    const id = uid();
    s.productions.push({
      id, productId, quantityProduced: quantity, note: '', producedAt: iso,
      totalCost: roundFCFA(totalCost), idempotencyKey: uid(), author, lines
    });
    for (const l of lines) {
      s.stockMovements.push({
        id: uid(), ingredientId: l.ingredientId, changeBase: -l.qtyBase,
        reason: 'production', referenceId: id, note: '', createdAt: iso, author
      });
    }
  };

  const sell = (productId, quantity, unitPrice, daysAgo, hour, client = '') => {
    const when = new Date(now - daysAgo * 86400000);
    when.setHours(hour, 30, 0, 0);
    s.sales.push({
      id: uid(), productId, quantity, unitPrice: roundFCFA(unitPrice),
      total: roundFCFA(unitPrice * quantity), client, note: '',
      soldAt: when.toISOString(), idempotencyKey: uid(), author
    });
  };

  for (let d = 6; d >= 0; d--) {
    produce(baguette, 40 + (6 - d) * 5, d, 5);
    produce(croissant, 24, d, 6);
    if (d % 2 === 0) produce(painComplet, 15, d, 6);
    if (d % 2 === 1) produce(painChoco, 18, d, 7);
    if (d === 2) produce(gateau, 3, d, 9);

    sell(baguette, 37 + (6 - d) * 5, 150, d, 12);
    sell(croissant, 22, 300, d, 10);
    if (d % 2 === 0) sell(painComplet, 13, 250, d, 13);
    if (d % 2 === 1) sell(painChoco, 16, 350, d, 11);
    if (d === 2) sell(gateau, 2, 2500, d, 16, 'Hôtel Riviera');
  }
}
