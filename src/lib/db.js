// ---------------------------------------------------------------------------
// Couche de données Boulange ERP — backend Supabase (PostgreSQL).
//
// Les garanties métier (atomicité, idempotence, coût figé, CMP arrondi,
// suppression sûre) sont assurées CÔTÉ BASE par les fonctions SQL du projet
// (voir supabase/setup.sql). Le frontend appelle ces fonctions via RPC et
// conserve un cache mémoire hydraté depuis Supabase, que les pages lisent de
// façon synchrone (sélecteurs inchangés). Chaque écriture ré-hydrate le cache.
// ---------------------------------------------------------------------------

import { roundFCFA, roundQty } from './money';
import { stockUnitFactor } from './units';
import { supabase } from './supabase';

export const CATEGORIES = ['pain', 'viennoiserie', 'patisserie', 'boisson', 'autre'];
export const INGREDIENT_TYPES = ['matiere_premiere', 'charge_utilite'];
export const MOVEMENT_REASONS = ['achat', 'production', 'ajustement', 'perte'];

// --------------------------- Cache & abonnement ----------------------------

let state = emptyState();
let status = 'idle'; // idle | loading | ready | error
let lastError = null;
let statusSnapshot = { status, error: null }; // référence stable
let hydratePromise = null;
const listeners = new Set();

function setStatus(next, error = null) {
  status = next;
  lastError = error;
  statusSnapshot = { status, error };
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function emptyState() {
  return {
    ingredients: [], products: [], recipes: [],
    purchases: [], productions: [], sales: [], stockMovements: []
  };
}

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function getStatus() {
  return statusSnapshot;
}

// --------------------------- Mappage lignes ↔ objets -----------------------

const toIngredient = (r) => ({
  id: r.id, name: r.name, type: r.type, baseUnit: r.base_unit,
  minThreshold: Number(r.min_threshold), unitCost: Number(r.unit_cost),
  createdAt: r.created_at, updatedAt: r.updated_at
});
const toProduct = (r) => ({
  id: r.id, name: r.name, category: r.category,
  sellingPrice: Number(r.selling_price), isActive: r.is_active, createdAt: r.created_at
});
const toRecipe = (r) => ({
  id: r.id, productId: r.product_id, ingredientId: r.ingredient_id, qtyBase: Number(r.qty_base)
});
const toPurchase = (r) => ({
  id: r.id, ingredientId: r.ingredient_id, qtyBase: Number(r.qty_base),
  unitCost: Number(r.unit_cost), totalCost: Number(r.total_cost),
  supplier: r.supplier, note: r.note, purchasedAt: r.purchased_at,
  idempotencyKey: r.idempotency_key, author: r.author
});
const toProduction = (r) => ({
  id: r.id, productId: r.product_id, quantityProduced: r.quantity_produced,
  note: r.note, producedAt: r.produced_at, totalCost: Number(r.total_cost),
  idempotencyKey: r.idempotency_key, author: r.author,
  lines: (r.production_lines || []).map((l) => ({
    ingredientId: l.ingredient_id, qtyBase: Number(l.qty_base), cost: Number(l.cost)
  }))
});
const toMovement = (r) => ({
  id: r.id, ingredientId: r.ingredient_id, changeBase: Number(r.change_base),
  reason: r.reason, referenceId: r.reference_id, note: r.note,
  createdAt: r.created_at, author: r.author
});
const toSale = (r) => ({
  id: r.id, productId: r.product_id, quantity: r.quantity,
  unitPrice: Number(r.unit_price), total: Number(r.total),
  client: r.client, note: r.note, soldAt: r.sold_at,
  idempotencyKey: r.idempotency_key, author: r.author
});

// ------------------------------ Hydratation --------------------------------

// Traduit une erreur Supabase en message utilisateur ; détecte le cas « base
// pas encore créée » pour guider l'utilisateur vers l'exécution du script SQL.
function describeError(err) {
  const msg = err?.message || String(err);
  if (/schema cache|does not exist|relation .* does not exist|PGRST205/i.test(msg)) {
    return 'errors.dbNotReady';
  }
  return msg;
}

async function fetchAll() {
  const tables = {
    ingredients: 'ingredients', products: 'products', recipes: 'recipes',
    purchases: 'purchases', sales: 'sales', stockMovements: 'stock_movements'
  };
  const [ing, prod, rec, pur, sal, mov, productions] = await Promise.all([
    supabase.from('ingredients').select('*').order('created_at'),
    supabase.from('products').select('*').order('created_at'),
    supabase.from('recipes').select('*'),
    supabase.from('purchases').select('*').order('purchased_at'),
    supabase.from('sales').select('*').order('sold_at'),
    supabase.from('stock_movements').select('*').order('created_at'),
    supabase.from('productions').select('*, production_lines(*)').order('produced_at')
  ]);
  for (const r of [ing, prod, rec, pur, sal, mov, productions]) {
    if (r.error) throw r.error;
  }
  return {
    ingredients: ing.data.map(toIngredient),
    products: prod.data.map(toProduct),
    recipes: rec.data.map(toRecipe),
    purchases: pur.data.map(toPurchase),
    sales: sal.data.map(toSale),
    stockMovements: mov.data.map(toMovement),
    productions: productions.data.map(toProduction)
  };
}

export async function hydrate() {
  setStatus('loading');
  notify();
  try {
    state = await fetchAll();
    setStatus('ready');
    setupSync(); // synchronisation multi-appareils (temps réel + retour d'onglet)
  } catch (err) {
    setStatus('error', describeError(err));
  }
  notify();
}

// Lance l'hydratation une seule fois (au premier montage).
export function ensureHydrated() {
  if (!hydratePromise) hydratePromise = hydrate();
  return hydratePromise;
}

async function refresh() {
  state = await fetchAll();
  notify();
}

// -------------------------- Synchronisation multi-appareils ----------------
// Fait en sorte qu'une vente/production/achat enregistré sur un appareil
// apparaisse sur les autres sans recharger la page.
let syncSetup = false;
let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => {});
  }, 250); // petit regroupement pour éviter les rafraîchissements multiples
}

function setupSync() {
  if (syncSetup) return;
  syncSetup = true;

  // 1) Temps réel : si la réplication Realtime est activée côté Supabase,
  //    tout changement en base déclenche un rafraîchissement immédiat.
  try {
    const channel = supabase.channel('boulange-sync');
    const tables = ['ingredients', 'products', 'recipes', 'purchases',
      'productions', 'production_lines', 'stock_movements', 'sales'];
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    }
    channel.subscribe();
  } catch {
    /* Realtime indisponible : le repli ci-dessous prend le relais. */
  }

  // 2) Repli sans configuration : rafraîchit au retour sur l'onglet/fenêtre
  //    et périodiquement, pour rester à jour même si le temps réel est off.
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', scheduleRefresh);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleRefresh();
    });
    setInterval(() => {
      if (!document.hidden) scheduleRefresh();
    }, 20000);
  }
}

function rpcError(err) {
  // Les messages des fonctions SQL sont déjà en français et explicites.
  return new Error(err.message || 'Erreur serveur');
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

// ------------------------------ Ingrédients --------------------------------

export async function addIngredient({ name, type, baseUnit, minThreshold, unitCost, initialQty = 0, author }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  const { data, error } = await supabase.from('ingredients').insert({
    name: name.trim(), type, base_unit: baseUnit,
    min_threshold: roundQty(minThreshold) || 0, unit_cost: roundFCFA(unitCost)
  }).select('id').single();
  if (error) throw rpcError(error);
  if (initialQty > 0) {
    const { error: e2 } = await supabase.from('stock_movements').insert({
      ingredient_id: data.id, change_base: roundQty(initialQty),
      reason: 'ajustement', note: 'Stock initial', author: author || ''
    });
    if (e2) throw rpcError(e2);
  }
  await refresh();
  return data.id;
}

export async function updateIngredient(id, { name, minThreshold, unitCost }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name?.trim()) patch.name = name.trim();
  if (minThreshold !== undefined) patch.min_threshold = roundQty(minThreshold);
  if (unitCost !== undefined) patch.unit_cost = roundFCFA(unitCost);
  const { error } = await supabase.from('ingredients').update(patch).eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function deleteIngredient(id) {
  const used =
    state.recipes.some((r) => r.ingredientId === id) ||
    state.stockMovements.some((m) => m.ingredientId === id);
  if (used) throw new Error('errors.ingredientInUse');
  const { error } = await supabase.from('ingredients').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function adjustStock({ ingredientId, changeBase, reason, note, author }) {
  if (!MOVEMENT_REASONS.includes(reason)) throw new Error('errors.badReason');
  if (currentQty(state, ingredientId) + changeBase < 0) throw new Error('errors.negativeStock');
  const { error } = await supabase.from('stock_movements').insert({
    ingredient_id: ingredientId, change_base: roundQty(changeBase),
    reason, note: note || '', author: author || ''
  });
  if (error) throw rpcError(error);
  await refresh();
}

// --------------------------- Produits & recettes ---------------------------

export async function saveProduct({ id, name, category, sellingPrice, isActive = true }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  if (!CATEGORIES.includes(category)) throw new Error('errors.badCategory');
  const row = { name: name.trim(), category, selling_price: roundFCFA(sellingPrice), is_active: isActive };
  let resultId = id;
  if (id) {
    const { error } = await supabase.from('products').update(row).eq('id', id);
    if (error) throw rpcError(error);
  } else {
    const { data, error } = await supabase.from('products').insert(row).select('id').single();
    if (error) throw rpcError(error);
    resultId = data.id;
  }
  await refresh();
  return resultId;
}

export async function deleteProduct(id) {
  const used = state.productions.some((p) => p.productId === id) || state.sales.some((v) => v.productId === id);
  if (used) throw new Error('errors.productInUse');
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function saveRecipe(productId, lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.ingredientId)) throw new Error('errors.duplicateRecipeLine');
    seen.add(l.ingredientId);
    if (!(l.qtyBase > 0)) throw new Error('errors.badQuantity');
  }
  const { error: delErr } = await supabase.from('recipes').delete().eq('product_id', productId);
  if (delErr) throw rpcError(delErr);
  if (lines.length) {
    const { error } = await supabase.from('recipes').insert(
      lines.map((l) => ({ product_id: productId, ingredient_id: l.ingredientId, qty_base: roundQty(l.qtyBase) }))
    );
    if (error) throw rpcError(error);
  }
  await refresh();
}

// ------------------------------ Achats -------------------------------------

export async function recordPurchase({ ingredientId, qtyBase, unitCost, supplier, note, idempotencyKey, author }) {
  if (!(qtyBase > 0)) throw new Error('errors.badQuantity');
  if (!(unitCost >= 0)) throw new Error('errors.badCost');
  const { data, error } = await supabase.rpc('record_purchase', {
    p_ingredient: ingredientId, p_qty_base: roundQty(qtyBase), p_unit_cost: roundFCFA(unitCost),
    p_supplier: supplier || '', p_note: note || '', p_idempotency_key: idempotencyKey, p_author: author || ''
  });
  if (error) throw rpcError(error);
  await refresh();
  return data;
}

export async function deletePurchase(purchaseId) {
  const { error } = await supabase.rpc('delete_purchase', { p_purchase: purchaseId });
  if (error) throw rpcError(error);
  await refresh();
}

// ----------------------------- Production ----------------------------------

// Aperçu client-side (CMP courant du cache) — identique au calcul serveur.
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

export async function recordProduction({ productId, quantity, note, idempotencyKey, author }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  const preview = productionPreview(state, productId, quantity);
  if (!preview) throw new Error('errors.notFound');
  if (preview.lines.length === 0) throw new Error('errors.noRecipe');
  if (preview.shortages.length > 0) {
    const err = new Error('errors.insufficientStock');
    err.shortages = preview.shortages.map((x) => ({
      name: x.ingredient.name, baseUnit: x.ingredient.baseUnit, missing: x.missing
    }));
    throw err;
  }
  const { data, error } = await supabase.rpc('record_production', {
    p_product: productId, p_quantity: quantity, p_note: note || '',
    p_idempotency_key: idempotencyKey, p_author: author || ''
  });
  if (error) throw rpcError(error);
  await refresh();
  return data;
}

// ------------------------------- Ventes ------------------------------------

export async function recordSale({ productId, quantity, unitPrice, client, note, idempotencyKey, author }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  if (productStock(state, productId) < quantity) throw new Error('errors.insufficientProductStock');
  const { data, error } = await supabase.rpc('record_sale', {
    p_product: productId, p_quantity: quantity, p_unit_price: roundFCFA(unitPrice),
    p_client: client || '', p_note: note || '', p_idempotency_key: idempotencyKey, p_author: author || ''
  });
  if (error) throw rpcError(error);
  await refresh();
  return data;
}
