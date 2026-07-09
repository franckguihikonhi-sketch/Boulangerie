// ---------------------------------------------------------------------------
// Couche de données — Fish-Afric « Gestion des devis ».
//
// Backend Supabase (PostgreSQL) + cache mémoire hydraté, lu de façon synchrone
// par les pages. Chaque écriture ré-hydrate le cache. Un MODE DÉMONSTRATION
// (accès invité) rejoue toute la logique dans un bac à sable ENTIÈREMENT LOCAL,
// sans jamais toucher la base : idéal pour essayer l'application sans compte.
//
// Domaine : articles prédéfinis (catalogue), devis (avec lignes imbriquées) et
// paiements. Aucune notion de recette / production — c'est un outil de devis
// pour une activité de négoce (cartons de poisson, sachets de frites, cartons
// de viande en gros).
// ---------------------------------------------------------------------------

import { roundFCFA, roundQty } from './money';
import { supabase, supabaseConfigured } from './supabase';

// Listes fermées (jamais traduites en base ; libellés d'affichage dans l'i18n).
export const DEVIS_STATUSES = ['en_cours', 'valide', 'refuse'];
export const PAYMENT_TYPES = ['acompte', 'total'];
// Destinataire des e-mails automatiques (devis finalisé, paiement).
export const ADMIN_EMAIL = 'admin@fish-afric.com';

// --------------------------- Cache & abonnement ----------------------------

// Durée d'une session de démonstration (accès invité) : 30 minutes.
export const DEMO_MS = 30 * 60 * 1000;
const DEMO_STATE_KEY = 'gdevis-demo-state';
const SESSION_KEY = 'gdevis-session';
let demoMode = false;

let state = emptyState();
let status = 'idle'; // idle | loading | ready | error
let lastError = null;
let statusSnapshot = { status, error: null };
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
  return { articles: [], devis: [], payments: [] };
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
// MODE DÉMONSTRATION (accès invité) — bac à sable ENTIÈREMENT LOCAL.
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

export function startDemo() {
  demoMode = true;
  hydratePromise = Promise.resolve(); // neutralise toute hydratation Supabase
  state = seededState();
  persistDemo();
  setStatus('ready');
  notify();
}

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

function guestSessionActive() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && s.guest && s.demoStart && Date.now() < s.demoStart + DEMO_MS) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Au chargement du module : restaure un bac à sable invité valide (rafraîchis-
// sement de page pendant les 30 minutes) AVANT toute hydratation Supabase.
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
  state = restored && Array.isArray(restored.articles)
    ? { ...emptyState(), ...restored }
    : seededState();
  persistDemo();
  setStatus('ready');
})();

// --------------------------- Mappage lignes ↔ objets -----------------------

const toArticle = (r) => ({
  id: r.id, reference: r.reference, designation: r.designation,
  unitPrice: Number(r.unit_price), isActive: r.is_active, createdAt: r.created_at
});
const toDevisLine = (r) => ({
  id: r.id, articleRef: r.article_ref, designation: r.designation,
  unitPrice: Number(r.unit_price), quantity: Number(r.quantity), amount: Number(r.amount)
});
const toDevis = (r) => ({
  id: r.id, number: r.number, clientName: r.client_name, clientContact: r.client_contact,
  status: r.status, deliveryDate: r.delivery_date, deliveryAddress: r.delivery_address,
  clientSignature: r.client_signature, commercialSignature: r.commercial_signature,
  finalizedAt: r.finalized_at, note: r.note, createdAt: r.created_at, author: r.author,
  lines: (r.devis_lines || []).map(toDevisLine)
});
const toPayment = (r) => ({
  id: r.id, devisId: r.devis_id, type: r.type, amount: Number(r.amount),
  clientSignature: r.client_signature, note: r.note, createdAt: r.created_at, author: r.author
});

// ------------------------------ Hydratation --------------------------------

function describeError(err) {
  const msg = err?.message || String(err);
  if (!supabaseConfigured) return 'errors.dbNotConfigured';
  if (/schema cache|does not exist|relation .* does not exist|PGRST205/i.test(msg)) {
    return 'errors.dbNotReady';
  }
  return msg;
}

async function fetchAll() {
  const [art, dev, pay] = await Promise.all([
    supabase.from('articles').select('*').order('created_at'),
    supabase.from('devis').select('*, devis_lines(*)').order('created_at'),
    supabase.from('payments').select('*').order('created_at')
  ]);
  for (const r of [art, dev, pay]) if (r.error) throw r.error;
  return {
    articles: art.data.map(toArticle),
    devis: dev.data.map(toDevis),
    payments: pay.data.map(toPayment)
  };
}

export async function hydrate() {
  if (demoMode) { setStatus('ready'); notify(); return; }
  if (!supabaseConfigured) {
    setStatus('error', 'errors.dbNotConfigured');
    notify();
    return;
  }
  setStatus('loading');
  notify();
  try {
    state = await fetchAll();
    setStatus('ready');
    setupSync();
  } catch (err) {
    setStatus('error', describeError(err));
  }
  notify();
}

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
let syncSetup = false;
let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => {});
  }, 250);
}

function setupSync() {
  if (syncSetup) return;
  syncSetup = true;
  try {
    const channel = supabase.channel('gdevis-sync');
    for (const table of ['articles', 'devis', 'devis_lines', 'payments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    }
    channel.subscribe();
  } catch {
    /* Realtime indisponible : le repli ci-dessous prend le relais. */
  }
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
  return new Error(err.message || 'Erreur serveur');
}

// --------------------------- Sélecteurs (synchrones) -----------------------

// Montant d'un devis = somme des montants de ses lignes (déjà arrondis).
export function devisTotal(devis) {
  return roundFCFA((devis?.lines || []).reduce((sum, l) => sum + l.amount, 0));
}

// Total déjà réglé pour un devis.
export function devisPaid(s, devisId) {
  let paid = 0;
  for (const p of s.payments) if (p.devisId === devisId) paid += p.amount;
  return roundFCFA(paid);
}

// Solde restant à payer.
export function devisBalance(s, devis) {
  return roundFCFA(devisTotal(devis) - devisPaid(s, devis.id));
}

// Statut de règlement : non réglé / acompte (partiel) / réglé (soldé).
export function paymentStatus(s, devis) {
  const total = devisTotal(devis);
  const paid = devisPaid(s, devis.id);
  if (paid <= 0) return 'non_regle';
  if (total > 0 && paid >= total) return 'regle';
  return 'acompte';
}

// Numéro de devis suivant DV-0001 (calcul local en démo ; en base c'est une
// séquence Postgres qui garantit l'unicité).
function nextDevisNumber(list) {
  let max = 0;
  for (const d of list) {
    const m = /^DV-(\d+)$/.exec(d.number || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `DV-${String(max + 1).padStart(4, '0')}`;
}

// Prépare et valide les lignes saisies -> lignes stockées (montant figé).
function buildDevisLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('errors.emptyDevis');
  return lines.map((l) => {
    if (!l.designation?.trim()) throw new Error('errors.nameRequired');
    if (!(Number(l.quantity) > 0)) throw new Error('errors.badQuantity');
    if (!(Number(l.unitPrice) >= 0)) throw new Error('errors.badPrice');
    const unitPrice = roundFCFA(l.unitPrice);
    const quantity = roundQty(l.quantity);
    return {
      id: uid(), articleRef: l.articleRef || '', designation: l.designation.trim(),
      unitPrice, quantity, amount: roundFCFA(unitPrice * quantity)
    };
  });
}

// --------------------------- Articles (catalogue) --------------------------

export async function saveArticle({ id, reference, designation, unitPrice, isActive = true }) {
  if (!designation?.trim()) throw new Error('errors.nameRequired');
  if (demoMode) {
    return demoMutate((s) => {
      if (id) {
        const a = s.articles.find((x) => x.id === id);
        if (!a) throw new Error('errors.notFound');
        Object.assign(a, {
          reference: reference?.trim() || '', designation: designation.trim(),
          unitPrice: roundFCFA(unitPrice), isActive
        });
        return id;
      }
      const newId = uid();
      s.articles.push({
        id: newId, reference: reference?.trim() || '', designation: designation.trim(),
        unitPrice: roundFCFA(unitPrice), isActive, createdAt: new Date().toISOString()
      });
      return newId;
    });
  }
  const row = {
    reference: reference?.trim() || '', designation: designation.trim(),
    unit_price: roundFCFA(unitPrice), is_active: isActive
  };
  let resultId = id;
  if (id) {
    const { error } = await supabase.from('articles').update(row).eq('id', id);
    if (error) throw rpcError(error);
  } else {
    const { data, error } = await supabase.from('articles').insert(row).select('id').single();
    if (error) throw rpcError(error);
    resultId = data.id;
  }
  await refresh();
  return resultId;
}

export async function deleteArticle(id) {
  // Les devis conservent une copie des lignes : suppression toujours sûre.
  if (demoMode) return demoMutate((s) => { s.articles = s.articles.filter((a) => a.id !== id); });
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

// ------------------------------- Devis -------------------------------------

export async function createDevis({ clientName, clientContact, note, lines, author }) {
  const mapped = buildDevisLines(lines);
  if (demoMode) {
    return demoMutate((s) => {
      const number = nextDevisNumber(s.devis);
      const id = uid();
      s.devis.push({
        id, number, clientName: clientName?.trim() || '', clientContact: clientContact?.trim() || '',
        status: 'en_cours', deliveryDate: null, deliveryAddress: '',
        clientSignature: '', commercialSignature: '', finalizedAt: null,
        note: note?.trim() || '', createdAt: new Date().toISOString(), author, lines: mapped
      });
      return { id, number };
    });
  }
  const { data, error } = await supabase.rpc('create_devis', {
    p_client_name: clientName?.trim() || '', p_client_contact: clientContact?.trim() || '',
    p_note: note?.trim() || '', p_author: author || '',
    p_lines: mapped.map((l) => ({
      articleRef: l.articleRef, designation: l.designation, unitPrice: l.unitPrice, quantity: l.quantity
    }))
  });
  if (error) throw rpcError(error);
  await refresh();
  return data; // { id, number }
}

export async function updateDevis(id, { clientName, clientContact, note, lines }) {
  const mapped = buildDevisLines(lines);
  if (demoMode) {
    return demoMutate((s) => {
      const d = s.devis.find((x) => x.id === id);
      if (!d) throw new Error('errors.notFound');
      if (d.status !== 'en_cours') throw new Error('errors.devisLocked');
      d.clientName = clientName?.trim() || '';
      d.clientContact = clientContact?.trim() || '';
      d.note = note?.trim() || '';
      d.lines = mapped;
    });
  }
  const current = state.devis.find((d) => d.id === id);
  if (!current) throw new Error('errors.notFound');
  if (current.status !== 'en_cours') throw new Error('errors.devisLocked');
  const { error } = await supabase.rpc('update_devis', {
    p_devis: id, p_client_name: clientName?.trim() || '', p_client_contact: clientContact?.trim() || '',
    p_note: note?.trim() || '',
    p_lines: mapped.map((l) => ({
      articleRef: l.articleRef, designation: l.designation, unitPrice: l.unitPrice, quantity: l.quantity
    }))
  });
  if (error) throw rpcError(error);
  await refresh();
}

export async function setDevisStatus(id, status) {
  if (!DEVIS_STATUSES.includes(status)) throw new Error('errors.badStatus');
  if (demoMode) {
    return demoMutate((s) => {
      const d = s.devis.find((x) => x.id === id);
      if (!d) throw new Error('errors.notFound');
      d.status = status;
    });
  }
  const { error } = await supabase.from('devis').update({ status }).eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function finalizeDevis(id, { deliveryDate, deliveryAddress, clientSignature, commercialSignature }) {
  if (!clientSignature) throw new Error('errors.clientSignatureRequired');
  if (!commercialSignature) throw new Error('errors.commercialSignatureRequired');
  if (demoMode) {
    return demoMutate((s) => {
      const d = s.devis.find((x) => x.id === id);
      if (!d) throw new Error('errors.notFound');
      if (d.status !== 'valide') throw new Error('errors.devisNotValidated');
      d.deliveryDate = deliveryDate || null;
      d.deliveryAddress = deliveryAddress?.trim() || '';
      d.clientSignature = clientSignature;
      d.commercialSignature = commercialSignature;
      d.finalizedAt = new Date().toISOString();
    });
  }
  const current = state.devis.find((d) => d.id === id);
  if (!current) throw new Error('errors.notFound');
  if (current.status !== 'valide') throw new Error('errors.devisNotValidated');
  const { error } = await supabase.from('devis').update({
    delivery_date: deliveryDate || null, delivery_address: deliveryAddress?.trim() || '',
    client_signature: clientSignature, commercial_signature: commercialSignature,
    finalized_at: new Date().toISOString()
  }).eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export async function deleteDevis(id) {
  if (demoMode) {
    return demoMutate((s) => {
      s.devis = s.devis.filter((d) => d.id !== id);
      s.payments = s.payments.filter((p) => p.devisId !== id);
    });
  }
  const { error } = await supabase.from('devis').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

// ------------------------------ Paiements ----------------------------------

export async function recordPayment({ devisId, type, amount, clientSignature, note, author }) {
  if (!PAYMENT_TYPES.includes(type)) throw new Error('errors.badPaymentType');
  const amt = roundFCFA(amount);
  if (!(amt > 0)) throw new Error('errors.badAmount');
  if (demoMode) {
    return demoMutate((s) => {
      const d = s.devis.find((x) => x.id === devisId);
      if (!d) throw new Error('errors.notFound');
      if (d.status !== 'valide') throw new Error('errors.devisNotValidated');
      if (amt > devisBalance(s, d)) throw new Error('errors.paymentExceedsBalance');
      const id = uid();
      s.payments.push({
        id, devisId, type, amount: amt, clientSignature: clientSignature || '',
        note: note?.trim() || '', createdAt: new Date().toISOString(), author
      });
      return id;
    });
  }
  const d = state.devis.find((x) => x.id === devisId);
  if (!d) throw new Error('errors.notFound');
  if (d.status !== 'valide') throw new Error('errors.devisNotValidated');
  if (amt > devisBalance(state, d)) throw new Error('errors.paymentExceedsBalance');
  const { data, error } = await supabase.from('payments').insert({
    devis_id: devisId, type, amount: amt, client_signature: clientSignature || '',
    note: note?.trim() || '', author: author || ''
  }).select('id').single();
  if (error) throw rpcError(error);
  await refresh();
  return data.id;
}

// ----------------------- Données d'exemple (mode démo) ---------------------
// Catalogue Fish-Afric (cartons de poisson, sachets de frites, cartons de
// viande en gros) + trois devis représentatifs des statuts, pour que le bac à
// sable invité soit immédiatement parlant.

function seedDemo(s) {
  const author = 'invite@fish-afric-demo.app';
  const now = Date.now();

  const mkArticle = (reference, designation, unitPrice) => {
    const id = uid();
    s.articles.push({
      id, reference, designation, unitPrice: roundFCFA(unitPrice), isActive: true,
      createdAt: new Date(now - 20 * 86400000).toISOString()
    });
    return { id, reference, designation, unitPrice: roundFCFA(unitPrice) };
  };

  const bar = mkArticle('POIS-BAR', 'Carton de Bar (20 kg)', 42000);
  const maquereau = mkArticle('POIS-MAQ', 'Carton de Maquereau (20 kg)', 28000);
  const chinchard = mkArticle('POIS-CHI', 'Carton de Chinchard (20 kg)', 24000);
  const sole = mkArticle('POIS-SOL', 'Carton de Sole (10 kg)', 35000);
  const friteFine = mkArticle('FRIT-FIN', 'Sachet de frites fines (2,5 kg)', 4500);
  const friteSteak = mkArticle('FRIT-STK', 'Sachet de frites steak (2,5 kg)', 4200);
  const boeuf = mkArticle('VIAN-BOE', 'Carton de viande de bœuf (20 kg)', 65000);
  const poulet = mkArticle('VIAN-POU', 'Carton de cuisses de poulet (15 kg)', 32000);

  const line = (art, quantity) => ({
    id: uid(), articleRef: art.reference, designation: art.designation,
    unitPrice: art.unitPrice, quantity, amount: roundFCFA(art.unitPrice * quantity)
  });

  const mkDevis = (number, clientName, clientContact, statusValue, lines, daysAgo, extra = {}) => {
    const id = uid();
    s.devis.push({
      id, number, clientName, clientContact, status: statusValue,
      deliveryDate: null, deliveryAddress: '', clientSignature: '', commercialSignature: '',
      finalizedAt: null, note: '', createdAt: new Date(now - daysAgo * 86400000).toISOString(),
      author, lines, ...extra
    });
    return id;
  };

  mkDevis('DV-0001', 'Restaurant Le Wharf', '+225 07 01 02 03 04', 'en_cours',
    [line(bar, 10), line(friteFine, 40)], 3);

  const finalized = mkDevis('DV-0002', 'Supermarché Prosuma', 'achats@prosuma.ci', 'valide',
    [line(maquereau, 30), line(poulet, 20), line(friteSteak, 60)], 7, {
      deliveryDate: new Date(now + 2 * 86400000).toISOString().slice(0, 10),
      deliveryAddress: 'Zone industrielle de Vridi, Abidjan',
      finalizedAt: new Date(now - 6 * 86400000).toISOString()
    });
  // Acompte déjà réglé sur ce devis validé et finalisé.
  s.payments.push({
    id: uid(), devisId: finalized, type: 'acompte', amount: 500000,
    clientSignature: '', note: 'Acompte à la commande',
    createdAt: new Date(now - 6 * 86400000).toISOString(), author
  });

  mkDevis('DV-0003', 'Grill du Port', '+225 05 06 07 08 09', 'refuse',
    [line(sole, 5), line(boeuf, 4), line(chinchard, 10)], 11);
}
