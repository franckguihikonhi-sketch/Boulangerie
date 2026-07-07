// ---------------------------------------------------------------------------
// Couche de données — VERSION BUREAU (hors-ligne).
//
// Parle à la base SQLite locale via le pont Electron (window.boulangeAPI).
// Même interface publique que la version en ligne : les pages ne changent pas.
// Garanties métier (atomicité, idempotence, coût figé, CMP) assurées côté
// base locale (voir electron/database.cjs).
// ---------------------------------------------------------------------------

import { roundFCFA, roundQty } from './money';
import { stockUnitFactor } from './units';

export const CATEGORIES = ['pain', 'viennoiserie', 'patisserie', 'boisson', 'autre'];
export const INGREDIENT_TYPES = ['matiere_premiere', 'charge_utilite'];
export const MOVEMENT_REASONS = ['achat', 'production', 'ajustement', 'perte'];

let state = emptyState();
let status = 'idle';
let statusSnapshot = { status, error: null };
let hydratePromise = null;
const listeners = new Set();

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function emptyState() {
  return { ingredients: [], products: [], recipes: [], purchases: [], productions: [], sales: [], stockMovements: [] };
}
function setStatus(next, error = null) { status = next; statusSnapshot = { status, error }; }
function notify() { listeners.forEach((l) => l()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }
export function getStatus() { return statusSnapshot; }

// Accès au pont local ; erreur claire si l'app tourne hors de l'environnement
// bureau (ne devrait pas arriver dans le logiciel installé).
function api() {
  if (typeof window === 'undefined' || !window.boulangeAPI) {
    throw new Error('errors.desktopOnly');
  }
  return window.boulangeAPI;
}

// Appelle une opération de la base locale et convertit la réponse.
async function call(channel, payload) {
  const res = await api().invoke(channel, payload);
  if (!res.ok) {
    const err = new Error(res.error || 'errors.generic');
    if (res.shortages) err.shortages = res.shortages;
    throw err;
  }
  return res.data;
}

// ------------------------------ Hydratation --------------------------------

export async function hydrate() {
  setStatus('loading');
  notify();
  try {
    state = await call('db:getState');
    setStatus('ready');
  } catch (err) {
    setStatus('error', err.message === 'errors.desktopOnly' ? 'errors.desktopOnly' : err.message);
  }
  notify();
}

export function ensureHydrated() {
  if (!hydratePromise) hydratePromise = hydrate();
  return hydratePromise;
}

async function refresh() {
  state = await call('db:getState');
  notify();
}

// --------------------------- Sélecteurs (synchrones) -----------------------

export function currentQty(s, ingredientId) {
  let total = 0;
  for (const m of s.stockMovements) if (m.ingredientId === ingredientId) total += m.changeBase;
  return roundQty(total);
}
export function stockValue(s, ingredient) {
  const qty = currentQty(s, ingredient.id);
  return roundFCFA((qty / stockUnitFactor(ingredient.baseUnit)) * ingredient.unitCost);
}
export function productStock(s, productId) {
  let produced = 0, sold = 0;
  for (const p of s.productions) if (p.productId === productId) produced += p.quantityProduced;
  for (const v of s.sales) if (v.productId === productId) sold += v.quantity;
  return produced - sold;
}
export function recipeFor(s, productId) { return s.recipes.filter((r) => r.productId === productId); }
export function lastPurchaseAt(s, ingredientId) {
  let last = null;
  for (const p of s.purchases) if (p.ingredientId === ingredientId && (!last || p.purchasedAt > last)) last = p.purchasedAt;
  return last;
}

// ------------------------------ Mutations ----------------------------------

export async function addIngredient(payload) {
  if (!payload.name?.trim()) throw new Error('errors.nameRequired');
  const id = await call('db:addIngredient', payload);
  await refresh();
  return id;
}
export async function updateIngredient(id, patch) {
  await call('db:updateIngredient', { id, ...patch });
  await refresh();
}
export async function deleteIngredient(id) {
  await call('db:deleteIngredient', id);
  await refresh();
}
export async function adjustStock(payload) {
  await call('db:adjustStock', payload);
  await refresh();
}
export async function saveProduct(payload) {
  if (!payload.name?.trim()) throw new Error('errors.nameRequired');
  if (!CATEGORIES.includes(payload.category)) throw new Error('errors.badCategory');
  const id = await call('db:saveProduct', payload);
  await refresh();
  return id;
}
export async function deleteProduct(id) {
  await call('db:deleteProduct', id);
  await refresh();
}
export async function saveRecipe(productId, lines) {
  await call('db:saveRecipe', { productId, lines });
  await refresh();
}
export async function recordPurchase(payload) {
  const id = await call('db:recordPurchase', payload);
  await refresh();
  return id;
}
export async function deletePurchase(purchaseId) {
  await call('db:deletePurchase', purchaseId);
  await refresh();
}

// Aperçu de production : calcul local sur le cache (identique au calcul figé
// côté base — même formule).
export function productionPreview(s, productId, quantity) {
  const product = s.products.find((p) => p.id === productId);
  if (!product || !(quantity > 0)) return null;
  const lines = [], shortages = [];
  let totalCost = 0;
  for (const r of recipeFor(s, productId)) {
    const ing = s.ingredients.find((i) => i.id === r.ingredientId);
    if (!ing) continue;
    const needed = roundQty(r.qtyBase * quantity);
    const available = currentQty(s, ing.id);
    const cost = roundFCFA((needed / stockUnitFactor(ing.baseUnit)) * ing.unitCost);
    totalCost += cost;
    lines.push({ ingredient: ing, needed, available, cost });
    if (needed > available) shortages.push({ ingredient: ing, missing: roundQty(needed - available) });
  }
  totalCost = roundFCFA(totalCost);
  const revenue = roundFCFA(product.sellingPrice * quantity);
  return { product, quantity, lines, shortages, totalCost, revenue, profit: revenue - totalCost };
}

export async function recordProduction(payload) {
  const id = await call('db:recordProduction', payload);
  await refresh();
  return id;
}
export async function recordSale(payload) {
  const id = await call('db:recordSale', payload);
  await refresh();
  return id;
}
