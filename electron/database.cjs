// ---------------------------------------------------------------------------
// Base de données LOCALE (SQLite) pour la version bureau hors-ligne.
//
// Reproduit exactement les garanties de la version Supabase, mais sur un
// fichier local, sans internet :
//   - transactions atomiques (better-sqlite3 .transaction) ;
//   - montants FCFA en entiers, arrondis avant écriture ;
//   - clé d'idempotence UNIQUE (anti-doublon) ;
//   - coût de production figé à la validation ;
//   - stock = somme des mouvements (source de vérité unique).
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');

let db = null;

const roundFCFA = (n) => Math.round(Number(n) || 0);
const roundQty = (n) => Math.round((Number(n) || 0) * 100) / 100;
const factorOf = (baseUnit) => (baseUnit === 'unite' ? 1 : 1000);

function init(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // robustesse (écriture sûre)
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table if not exists ingredients (
      id text primary key, name text not null, type text not null,
      base_unit text not null, min_threshold real not null default 0,
      unit_cost integer not null default 0,
      created_at text not null, updated_at text not null
    );
    create table if not exists products (
      id text primary key, name text not null, category text not null,
      selling_price integer not null default 0, is_active integer not null default 1,
      created_at text not null
    );
    create table if not exists recipes (
      id text primary key,
      product_id text not null references products(id) on delete cascade,
      ingredient_id text not null references ingredients(id) on delete restrict,
      qty_base real not null, unique(product_id, ingredient_id)
    );
    create table if not exists purchases (
      id text primary key,
      ingredient_id text not null references ingredients(id) on delete restrict,
      qty_base real not null, unit_cost integer not null, total_cost integer not null,
      supplier text not null default '', note text not null default '',
      purchased_at text not null, idempotency_key text not null unique,
      author text not null default ''
    );
    create table if not exists productions (
      id text primary key,
      product_id text not null references products(id) on delete restrict,
      quantity_produced integer not null, note text not null default '',
      produced_at text not null, total_cost integer not null,
      idempotency_key text not null unique, author text not null default ''
    );
    create table if not exists production_lines (
      id text primary key,
      production_id text not null references productions(id) on delete cascade,
      ingredient_id text not null references ingredients(id) on delete restrict,
      qty_base real not null, cost integer not null
    );
    create table if not exists stock_movements (
      id text primary key,
      ingredient_id text not null references ingredients(id) on delete restrict,
      change_base real not null, reason text not null, reference_id text,
      note text not null default '', created_at text not null, author text not null default ''
    );
    create table if not exists sales (
      id text primary key,
      product_id text not null references products(id) on delete restrict,
      quantity integer not null, unit_price integer not null, total integer not null,
      client text not null default '', note text not null default '',
      sold_at text not null, idempotency_key text not null unique, author text not null default ''
    );
    create index if not exists idx_mov_ing on stock_movements(ingredient_id);
  `);
  return db;
}

const now = () => new Date().toISOString();

function currentQty(ingredientId) {
  const row = db.prepare('select coalesce(sum(change_base),0) q from stock_movements where ingredient_id = ?').get(ingredientId);
  return roundQty(row.q);
}

// ------------------------------- Lecture -----------------------------------

function getState() {
  const ingredients = db.prepare('select * from ingredients order by created_at').all().map((r) => ({
    id: r.id, name: r.name, type: r.type, baseUnit: r.base_unit,
    minThreshold: r.min_threshold, unitCost: r.unit_cost, createdAt: r.created_at, updatedAt: r.updated_at
  }));
  const products = db.prepare('select * from products order by created_at').all().map((r) => ({
    id: r.id, name: r.name, category: r.category, sellingPrice: r.selling_price,
    isActive: !!r.is_active, createdAt: r.created_at
  }));
  const recipes = db.prepare('select * from recipes').all().map((r) => ({
    id: r.id, productId: r.product_id, ingredientId: r.ingredient_id, qtyBase: r.qty_base
  }));
  const purchases = db.prepare('select * from purchases order by purchased_at').all().map((r) => ({
    id: r.id, ingredientId: r.ingredient_id, qtyBase: r.qty_base, unitCost: r.unit_cost,
    totalCost: r.total_cost, supplier: r.supplier, note: r.note, purchasedAt: r.purchased_at,
    idempotencyKey: r.idempotency_key, author: r.author
  }));
  const sales = db.prepare('select * from sales order by sold_at').all().map((r) => ({
    id: r.id, productId: r.product_id, quantity: r.quantity, unitPrice: r.unit_price,
    total: r.total, client: r.client, note: r.note, soldAt: r.sold_at,
    idempotencyKey: r.idempotency_key, author: r.author
  }));
  const stockMovements = db.prepare('select * from stock_movements order by created_at').all().map((r) => ({
    id: r.id, ingredientId: r.ingredient_id, changeBase: r.change_base, reason: r.reason,
    referenceId: r.reference_id, note: r.note, createdAt: r.created_at, author: r.author
  }));
  const lines = db.prepare('select * from production_lines').all();
  const linesByProd = {};
  for (const l of lines) (linesByProd[l.production_id] ||= []).push({ ingredientId: l.ingredient_id, qtyBase: l.qty_base, cost: l.cost });
  const productions = db.prepare('select * from productions order by produced_at').all().map((r) => ({
    id: r.id, productId: r.product_id, quantityProduced: r.quantity_produced, note: r.note,
    producedAt: r.produced_at, totalCost: r.total_cost, idempotencyKey: r.idempotency_key,
    author: r.author, lines: linesByProd[r.id] || []
  }));
  return { ingredients, products, recipes, purchases, productions, sales, stockMovements };
}

// ----------------------------- Ingrédients ---------------------------------

function addIngredient({ name, type, baseUnit, minThreshold, unitCost, initialQty = 0, author }) {
  if (!name || !name.trim()) throw new Error('errors.nameRequired');
  const id = randomUUID();
  const t = now();
  db.transaction(() => {
    db.prepare('insert into ingredients (id,name,type,base_unit,min_threshold,unit_cost,created_at,updated_at) values (?,?,?,?,?,?,?,?)')
      .run(id, name.trim(), type, baseUnit, roundQty(minThreshold) || 0, roundFCFA(unitCost), t, t);
    if (initialQty > 0) {
      db.prepare('insert into stock_movements (id,ingredient_id,change_base,reason,reference_id,note,created_at,author) values (?,?,?,?,?,?,?,?)')
        .run(randomUUID(), id, roundQty(initialQty), 'ajustement', null, 'Stock initial', t, author || '');
    }
  })();
  return id;
}

function updateIngredient({ id, name, minThreshold, unitCost }) {
  const ing = db.prepare('select * from ingredients where id = ?').get(id);
  if (!ing) throw new Error('errors.notFound');
  db.prepare('update ingredients set name=?, min_threshold=?, unit_cost=?, updated_at=? where id=?')
    .run(name && name.trim() ? name.trim() : ing.name,
      minThreshold !== undefined ? roundQty(minThreshold) : ing.min_threshold,
      unitCost !== undefined ? roundFCFA(unitCost) : ing.unit_cost, now(), id);
}

function deleteIngredient(id) {
  const used = db.prepare('select 1 from recipes where ingredient_id=? union select 1 from stock_movements where ingredient_id=? limit 1').get(id, id);
  if (used) throw new Error('errors.ingredientInUse');
  db.prepare('delete from ingredients where id=?').run(id);
}

function adjustStock({ ingredientId, changeBase, reason, note, author }) {
  if (!['achat', 'production', 'ajustement', 'perte'].includes(reason)) throw new Error('errors.badReason');
  if (currentQty(ingredientId) + changeBase < 0) throw new Error('errors.negativeStock');
  db.prepare('insert into stock_movements (id,ingredient_id,change_base,reason,reference_id,note,created_at,author) values (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), ingredientId, roundQty(changeBase), reason, null, note || '', now(), author || '');
}

// --------------------------- Produits & recettes ---------------------------

const CATEGORIES = ['pain', 'viennoiserie', 'patisserie', 'boisson', 'autre'];

function saveProduct({ id, name, category, sellingPrice, isActive = true }) {
  if (!name || !name.trim()) throw new Error('errors.nameRequired');
  if (!CATEGORIES.includes(category)) throw new Error('errors.badCategory');
  if (id) {
    db.prepare('update products set name=?, category=?, selling_price=?, is_active=? where id=?')
      .run(name.trim(), category, roundFCFA(sellingPrice), isActive ? 1 : 0, id);
    return id;
  }
  const newId = randomUUID();
  db.prepare('insert into products (id,name,category,selling_price,is_active,created_at) values (?,?,?,?,?,?)')
    .run(newId, name.trim(), category, roundFCFA(sellingPrice), isActive ? 1 : 0, now());
  return newId;
}

function deleteProduct(id) {
  const used = db.prepare('select 1 from productions where product_id=? union select 1 from sales where product_id=? limit 1').get(id, id);
  if (used) throw new Error('errors.productInUse');
  db.prepare('delete from products where id=?').run(id);
}

function saveRecipe({ productId, lines }) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.ingredientId)) throw new Error('errors.duplicateRecipeLine');
    seen.add(l.ingredientId);
    if (!(l.qtyBase > 0)) throw new Error('errors.badQuantity');
  }
  db.transaction(() => {
    db.prepare('delete from recipes where product_id=?').run(productId);
    const ins = db.prepare('insert into recipes (id,product_id,ingredient_id,qty_base) values (?,?,?,?)');
    for (const l of lines) ins.run(randomUUID(), productId, l.ingredientId, roundQty(l.qtyBase));
  })();
}

// ------------------------------- Achats ------------------------------------

function recordPurchase({ ingredientId, qtyBase, unitCost, supplier, note, idempotencyKey, author }) {
  if (!(qtyBase > 0)) throw new Error('errors.badQuantity');
  if (!(unitCost >= 0)) throw new Error('errors.badCost');
  return db.transaction(() => {
    const existing = db.prepare('select id from purchases where idempotency_key=?').get(idempotencyKey);
    if (existing) return existing.id;
    const ing = db.prepare('select * from ingredients where id=?').get(ingredientId);
    if (!ing) throw new Error('errors.notFound');
    const factor = factorOf(ing.base_unit);
    const qty = roundQty(qtyBase);
    const cost = roundFCFA(unitCost);
    const qtyBefore = currentQty(ingredientId) / factor;
    const valueBefore = qtyBefore * ing.unit_cost;
    const bought = qty / factor;
    const denom = qtyBefore + bought;
    const newCmp = denom > 0 ? roundFCFA((valueBefore + bought * cost) / denom) : cost;
    db.prepare('update ingredients set unit_cost=?, updated_at=? where id=?').run(newCmp, now(), ingredientId);
    const id = randomUUID();
    const t = now();
    db.prepare('insert into purchases (id,ingredient_id,qty_base,unit_cost,total_cost,supplier,note,purchased_at,idempotency_key,author) values (?,?,?,?,?,?,?,?,?,?)')
      .run(id, ingredientId, qty, cost, roundFCFA(bought * cost), supplier || '', note || '', t, idempotencyKey, author || '');
    db.prepare('insert into stock_movements (id,ingredient_id,change_base,reason,reference_id,note,created_at,author) values (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), ingredientId, qty, 'achat', id, '', t, author || '');
    return id;
  })();
}

function deletePurchase(purchaseId) {
  db.transaction(() => {
    const p = db.prepare('select * from purchases where id=?').get(purchaseId);
    if (!p) throw new Error('errors.notFound');
    if (currentQty(p.ingredient_id) - p.qty_base < 0) throw new Error('errors.stockAlreadyConsumed');
    db.prepare("delete from stock_movements where reason='achat' and reference_id=?").run(purchaseId);
    db.prepare('delete from purchases where id=?').run(purchaseId);
  })();
}

// ----------------------------- Production ----------------------------------

function recordProduction({ productId, quantity, note, idempotencyKey, author }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return db.transaction(() => {
    const existing = db.prepare('select id from productions where idempotency_key=?').get(idempotencyKey);
    if (existing) return existing.id;
    const recipe = db.prepare(`select r.qty_base, i.* from recipes r join ingredients i on i.id=r.ingredient_id where r.product_id=?`).all(productId);
    if (recipe.length === 0) throw new Error('errors.noRecipe');
    const shortages = [];
    for (const r of recipe) {
      const needed = roundQty(r.qty_base * quantity);
      const avail = currentQty(r.id);
      if (needed > avail) shortages.push({ name: r.name, baseUnit: r.base_unit, missing: roundQty(needed - avail) });
    }
    if (shortages.length) { const e = new Error('errors.insufficientStock'); e.shortages = shortages; throw e; }
    const id = randomUUID();
    const t = now();
    let total = 0;
    const insLine = db.prepare('insert into production_lines (id,production_id,ingredient_id,qty_base,cost) values (?,?,?,?,?)');
    const insMov = db.prepare('insert into stock_movements (id,ingredient_id,change_base,reason,reference_id,note,created_at,author) values (?,?,?,?,?,?,?,?)');
    db.prepare('insert into productions (id,product_id,quantity_produced,note,produced_at,total_cost,idempotency_key,author) values (?,?,?,?,?,?,?,?)')
      .run(id, productId, quantity, note || '', t, 0, idempotencyKey, author || '');
    for (const r of recipe) {
      const needed = roundQty(r.qty_base * quantity);
      const cost = roundFCFA((needed / factorOf(r.base_unit)) * r.unit_cost);
      total += cost;
      insLine.run(randomUUID(), id, r.id, needed, cost);
      insMov.run(randomUUID(), r.id, -needed, 'production', id, '', t, author || '');
    }
    db.prepare('update productions set total_cost=? where id=?').run(roundFCFA(total), id);
    return id;
  })();
}

// ------------------------------- Ventes ------------------------------------

function productStock(productId) {
  const p = db.prepare('select coalesce(sum(quantity_produced),0) q from productions where product_id=?').get(productId).q;
  const s = db.prepare('select coalesce(sum(quantity),0) q from sales where product_id=?').get(productId).q;
  return p - s;
}

function recordSale({ productId, quantity, unitPrice, client, note, idempotencyKey, author }) {
  if (!(quantity > 0)) throw new Error('errors.badQuantity');
  return db.transaction(() => {
    const existing = db.prepare('select id from sales where idempotency_key=?').get(idempotencyKey);
    if (existing) return existing.id;
    if (productStock(productId) < quantity) throw new Error('errors.insufficientProductStock');
    const price = roundFCFA(unitPrice);
    const id = randomUUID();
    db.prepare('insert into sales (id,product_id,quantity,unit_price,total,client,note,sold_at,idempotency_key,author) values (?,?,?,?,?,?,?,?,?,?)')
      .run(id, productId, quantity, price, roundFCFA(price * quantity), client || '', note || '', now(), idempotencyKey, author || '');
    return id;
  })();
}

module.exports = {
  init, getState, addIngredient, updateIngredient, deleteIngredient, adjustStock,
  saveProduct, deleteProduct, saveRecipe, recordPurchase, deletePurchase,
  recordProduction, recordSale
};
