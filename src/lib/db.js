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

// Durée d'une session de démonstration (accès invité). Le compte à rebours
// démarre à la connexion et l'application se verrouille au bout de 30 minutes.
export const DEMO_MS = 30 * 60 * 1000;
const DEMO_STATE_KEY = 'boulange-demo-state';
const SESSION_KEY = 'boulange-session';
let demoMode = false;

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

// ===========================================================================
// MODE DÉMONSTRATION (accès invité)
// ---------------------------------------------------------------------------
// Chaque visiteur invité travaille dans un bac à sable ENTIÈREMENT LOCAL :
// des données d'exemple sont générées en mémoire (jamais envoyées à Supabase)
// et conservées dans sessionStorage le temps de la session. Toute la logique
// métier (CMP, coût figé, stock dérivé, idempotence) est identique à celle du
// serveur. Ainsi un recruteur peut tout essayer sans jamais affecter la base
// partagée, et le bac à sable repart à zéro à chaque nouvelle visite.
// ===========================================================================

export function isDemoMode() {
  return demoMode;
}

function seededState() {
  const s = emptyState();
  seedDemo(s);
  return s;
}

function persistDemo() {
  try {
    sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
  } catch {
    /* quota / mode privé : on garde l'état en mémoire */
  }
}

// Transaction locale : fn reçoit une copie profonde ; en cas d'exception,
// l'état courant reste intact (aucune écriture partielle).
function demoMutate(fn) {
  const draft = JSON.parse(JSON.stringify(state));
  const result = fn(draft);
  state = draft;
  persistDemo();
  notify();
  return result;
}

// Démarre une session de démo fraîche (bouton « Accès invité »).
export function startDemo() {
  demoMode = true;
  hydratePromise = Promise.resolve(); // neutralise toute hydratation Supabase
  state = seededState();
  persistDemo();
  setStatus('ready');
  notify();
}

// Termine la session de démo et nettoie le bac à sable.
export function stopDemo() {
  demoMode = false;
  hydratePromise = null;
  try {
    sessionStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    /* ignore */
  }
  state = emptyState();
  setStatus('idle');
}

// Au chargement du module : si une session invité valide existe déjà (rafraî-
// chissement de page pendant les 30 minutes), on restaure le bac à sable AVANT
// toute tentative d'hydratation Supabase.
function guestSessionActive() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && s.guest && s.demoStart && Date.now() < s.demoStart + DEMO_MS) return true;
  } catch {
    /* ignore */
  }
  return false;
}

(function restoreDemoOnLoad() {
  if (typeof window === 'undefined' || !guestSessionActive()) return;
  demoMode = true;
  hydratePromise = Promise.resolve();
  let restored = null;
  try {
    restored = JSON.parse(sessionStorage.getItem(DEMO_STATE_KEY));
  } catch {
    /* ignore */
  }
  state = restored && Array.isArray(restored.ingredients) ? restored : seededState();
  persistDemo();
  setStatus('ready');
})();

// --------------------- Mutations locales (mode démo) -----------------------

function demoAddIngredient({ name, type, baseUnit, minThreshold, unitCost, initialQty = 0, author }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  return demoMutate((s) => {
    const id = uid();
    const iso = new Date().toISOString();
    s.ingredients.push({
      id, name: name.trim(), type, baseUnit,
      minThreshold: roundQty(minThreshold) || 0, unitCost: roundFCFA(unitCost),
      createdAt: iso, updatedAt: iso
    });
    if (initialQty > 0) {
      s.stockMovements.push({
        id: uid(), ingredientId: id, changeBase: roundQty(initialQty),
        reason: 'ajustement', referenceId: null, note: 'Stock initial', createdAt: iso, author
      });
    }
    return id;
  });
}

function demoUpdateIngredient(id, { name, minThreshold, unitCost }) {
  demoMutate((s) => {
    const ing = s.ingredients.find((i) => i.id === id);
    if (!ing) throw new Error('errors.notFound');
    if (name?.trim()) ing.name = name.trim();
    if (minThreshold !== undefined) ing.minThreshold = roundQty(minThreshold);
    if (unitCost !== undefined) ing.unitCost = roundFCFA(unitCost);
    ing.updatedAt = new Date().toISOString();
  });
}

function demoDeleteIngredient(id) {
  demoMutate((s) => {
    const used = s.recipes.some((r) => r.ingredientId === id) ||
      s.stockMovements.some((m) => m.ingredientId === id);
    if (used) throw new Error('errors.ingredientInUse');
    s.ingredients = s.ingredients.filter((i) => i.id !== id);
  });
}

function demoAdjustStock({ ingredientId, changeBase, reason, note, author }) {
  if (!MOVEMENT_REASONS.includes(reason)) throw new Error('errors.badReason');
  demoMutate((s) => {
    const ing = s.ingredients.find((i) => i.id === ingredientId);
    if (!ing) throw new Error('errors.notFound');
    if (currentQty(s, ingredientId) + changeBase < 0) throw new Error('errors.negativeStock');
    s.stockMovements.push({
      id: uid(), ingredientId, changeBase: roundQty(changeBase),
      reason, referenceId: null, note: note || '', createdAt: new Date().toISOString(), author
    });
  });
}

function demoSaveProduct({ id, name, category, sellingPrice, isActive = true }) {
  if (!name?.trim()) throw new Error('errors.nameRequired');
  if (!CATEGORIES.includes(category)) throw new Error('errors.badCategory');
  return demoMutate((s) => {
    if (id) {
      const p = s.products.find((x) => x.id === id);
      if (!p) throw new Error('errors.notFound');
      Object.assign(p, { name: name.trim(), category, sellingPrice: roundFCFA(sellingPrice), isActive });
      return id;
    }
    const newId = uid();
    s.products.push({
      id: newId, name: name.trim(), category, sellingPrice: roundFCFA(sellingPrice),
      isActive, createdAt: new Date().toISOString()
    });
    return newId;
  });
}

function demoDeleteProduct(id) {
  demoMutate((s) => {
    const used = s.productions.some((p) => p.productId === id) || s.sales.some((v) => v.productId === id);
    if (used) throw new Error('errors.productInUse');
    s.products = s.products.filter((p) => p.id !== id);
    s.recipes = s.recipes.filter((r) => r.productId !== id);
  });
}

function demoSaveRecipe(productId, lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.ingredientId)) throw new Error('errors.duplicateRecipeLine');
    seen.add(l.ingredientId);
    if (!(l.qtyBase > 0)) throw new Error('errors.badQuantity');
  }
  demoMutate((s) => {
    s.recipes = s.recipes.filter((r) => r.productId !== productId);
    for (const l of lines) {
      s.recipes.push({ id: uid(), productId, ingredientId: l.ingredientId, qtyBase: roundQty(l.qtyBase) });
    }
  });
}

function demoRecordPurchase({ ingredientId, qtyBase, unitCost, supplier, note, idempotencyKey, author, at }) {
  if (!(qtyBase > 0)) throw new Error('errors.badQuantity');
  if (!(unitCost >= 0)) throw new Error('errors.badCost');
  return demoMutate((s) => {
    const existing = s.purchases.find((p) => p.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;
    const ing = s.ingredients.find((i) => i.id === ingredientId);
    if (!ing) throw new Error('errors.notFound');
    const factor = stockUnitFactor(ing.baseUnit);
    const qty = roundQty(qtyBase);
    const cost = roundFCFA(unitCost);
    const qtyBefore = currentQty(s, ingredientId) / factor;
    const valueBefore = qtyBefore * ing.unitCost;
    const qtyPurchased = qty / factor;
    const denominator = qtyBefore + qtyPurchased;
    ing.unitCost = denominator > 0
      ? roundFCFA((valueBefore + qtyPurchased * cost) / denominator)
      : cost;
    ing.updatedAt = new Date().toISOString();
    const id = uid();
    const when = at || new Date().toISOString();
    s.purchases.push({
      id, ingredientId, qtyBase: qty, unitCost: cost, totalCost: roundFCFA(qtyPurchased * cost),
      supplier: supplier || '', note: note || '', purchasedAt: when, idempotencyKey, author
    });
    s.stockMovements.push({
      id: uid(), ingredientId, changeBase: qty, reason: 'achat',
      referenceId: id, note: '', createdAt: when, author
    });
    return id;
  });
}

function demoDeletePurchase(purchaseId) {
  demoMutate((s) => {
    const purchase = s.purchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new Error('errors.notFound');
    if (currentQty(s, purchase.ingredientId) - purchase.qtyBase < 0) {
      throw new Error('errors.stockAlreadyConsumed');
    }
    s.purchases = s.purchases.filter((p) => p.id !== purchaseId);
    s.stockMovements = s.stockMovements.filter(
      (m) => !(m.reason === 'achat' && m.referenceId === purchaseId)
    );
  });
}

function demoRecordProduction({ productId, quantity, note, idempotencyKey, author, at }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return demoMutate((s) => {
    const existing = s.productions.find((p) => p.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;
    const preview = productionPreview(s, productId, quantity);
    if (!preview) throw new Error('errors.notFound');
    if (preview.lines.length === 0) throw new Error('errors.noRecipe');
    if (preview.shortages.length > 0) {
      const err = new Error('errors.insufficientStock');
      err.shortages = preview.shortages.map((x) => ({
        name: x.ingredient.name, baseUnit: x.ingredient.baseUnit, missing: x.missing
      }));
      throw err;
    }
    const id = uid();
    const when = at || new Date().toISOString();
    s.productions.push({
      id, productId, quantityProduced: quantity, note: note || '', producedAt: when,
      totalCost: preview.totalCost, idempotencyKey, author,
      lines: preview.lines.map((l) => ({ ingredientId: l.ingredient.id, qtyBase: l.needed, cost: l.cost }))
    });
    for (const l of preview.lines) {
      s.stockMovements.push({
        id: uid(), ingredientId: l.ingredient.id, changeBase: -l.needed,
        reason: 'production', referenceId: id, note: '', createdAt: when, author
      });
    }
    return id;
  });
}

function demoRecordSale({ productId, quantity, unitPrice, client, note, idempotencyKey, author, at }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return demoMutate((s) => {
    const existing = s.sales.find((v) => v.idempotencyKey === idempotencyKey);
    if (existing) return existing.id;
    const product = s.products.find((p) => p.id === productId);
    if (!product) throw new Error('errors.notFound');
    if (productStock(s, productId) < quantity) throw new Error('errors.insufficientProductStock');
    const price = roundFCFA(unitPrice);
    const id = uid();
    s.sales.push({
      id, productId, quantity, unitPrice: price, total: roundFCFA(price * quantity),
      client: client || '', note: note || '', soldAt: at || new Date().toISOString(), idempotencyKey, author
    });
    return id;
  });
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
  if (demoMode) { setStatus('ready'); notify(); return; }
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
  if (demoMode) return Promise.resolve();
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
  if (demoMode) return demoAddIngredient({ name, type, baseUnit, minThreshold, unitCost, initialQty, author });
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
  if (demoMode) return demoUpdateIngredient(id, { name, minThreshold, unitCost });
  const patch = { updated_at: new Date().toISOString() };
  if (name?.trim()) patch.name = name.trim();
  if (minThreshold !== undefined) patch.min_threshold = roundQty(minThreshold);
  if (unitCost !== undefined) patch.unit_cost = roundFCFA(unitCost);
  const { error } = await supabase.from('ingredients').update(patch).eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function deleteIngredient(id) {
  if (demoMode) return demoDeleteIngredient(id);
  const used =
    state.recipes.some((r) => r.ingredientId === id) ||
    state.stockMovements.some((m) => m.ingredientId === id);
  if (used) throw new Error('errors.ingredientInUse');
  const { error } = await supabase.from('ingredients').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function adjustStock({ ingredientId, changeBase, reason, note, author }) {
  if (demoMode) return demoAdjustStock({ ingredientId, changeBase, reason, note, author });
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
  if (demoMode) return demoSaveProduct({ id, name, category, sellingPrice, isActive });
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
  if (demoMode) return demoDeleteProduct(id);
  const used = state.productions.some((p) => p.productId === id) || state.sales.some((v) => v.productId === id);
  if (used) throw new Error('errors.productInUse');
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function saveRecipe(productId, lines) {
  if (demoMode) return demoSaveRecipe(productId, lines);
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
  if (demoMode) return demoRecordPurchase({ ingredientId, qtyBase, unitCost, supplier, note, idempotencyKey, author });
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
  if (demoMode) return demoDeletePurchase(purchaseId);
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
  if (demoMode) return demoRecordProduction({ productId, quantity, note, idempotencyKey, author });
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
  if (demoMode) return demoRecordSale({ productId, quantity, unitPrice, client, note, idempotencyKey, author });
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

// ----------------------- Données d'exemple (mode démo) ---------------------
// Génère une semaine d'activité réaliste (ingrédients, recettes, achats,
// productions, ventes) pour que le bac à sable invité soit immédiatement
// parlant : tableau de bord rempli, marges, stock, rapports.

function seedDemo(s) {
  const author = 'invite@boulangerie-demo.app';
  const now = Date.now();

  const mk = (name, type, baseUnit, minThreshold, unitCost) => {
    const id = uid();
    s.ingredients.push({
      id, name, type, baseUnit, minThreshold, unitCost: roundFCFA(unitCost),
      createdAt: new Date(now - 12 * 86400000).toISOString(),
      updatedAt: new Date(now - 12 * 86400000).toISOString()
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
    s.products.push({ id, name, category, sellingPrice, isActive: true, createdAt: new Date(now - 12 * 86400000).toISOString() });
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
      const cost = roundFCFA((needed / stockUnitFactor(ing.baseUnit)) * ing.unitCost);
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
