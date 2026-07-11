// ---------------------------------------------------------------------------
// Couche de données de l'application « Écritures SAGE ».
//
// Deux backends interchangeables, choisis automatiquement au chargement :
//   • Supabase (base dédiée) si VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//     sont renseignés — les écritures sont partagées entre appareils ;
//   • sinon, stockage LOCAL du navigateur (localStorage) — l'application reste
//     pleinement utilisable, hors ligne, sans configuration.
//
// Le frontend lit un cache mémoire de façon synchrone (useStore) ; chaque
// mutation ré-hydrate le cache et prévient les abonnés.
// ---------------------------------------------------------------------------

import { roundFCFA } from './money';
import { JOURNAUX_DEFAUT } from './sage';
import { supabase, supabaseConfigured } from './supabase';

const LOCAL_KEY = 'ecritures-sage-entries';

let entries = [];
let journaux = JOURNAUX_DEFAUT;
let status = 'idle'; // idle | loading | ready | error
let statusSnapshot = { status, error: null };
let hydratePromise = null;
const listeners = new Set();

function setStatus(next, error = null) {
  status = next;
  statusSnapshot = { status, error };
}

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEntries() {
  return entries;
}

export function getJournaux() {
  return journaux;
}

export function getStatus() {
  return statusSnapshot;
}

export function usingSupabase() {
  return supabaseConfigured;
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const toEntry = (r) => ({
  id: r.id, journal: r.journal, pieceDate: r.piece_date, account: r.account,
  label: r.label, debit: Number(r.debit), credit: Number(r.credit),
  createdAt: r.created_at
});

// ------------------------------ Stockage local -----------------------------

function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
  } catch {
    /* quota / mode privé : on garde l'état en mémoire */
  }
}

// ------------------------------ Hydratation --------------------------------

function describeError(err) {
  const msg = err?.message || String(err);
  if (/schema cache|does not exist|relation .* does not exist|PGRST205/i.test(msg)) {
    return 'La table « sage_entries » est introuvable. Exécutez supabase/setup.sql dans votre projet Supabase.';
  }
  return msg;
}

export async function hydrate() {
  setStatus('loading');
  notify();
  try {
    if (supabaseConfigured) {
      const [ecr, jx] = await Promise.all([
        supabase.from('sage_entries').select('*').order('created_at'),
        supabase.from('journaux').select('*').order('ordre')
      ]);
      if (ecr.error) throw ecr.error;
      if (jx.error) throw jx.error;
      entries = ecr.data.map(toEntry);
      // Repli sur la liste par défaut si la table journaux est vide.
      journaux = jx.data.length ? jx.data.map((r) => ({ code: r.code, intitule: r.intitule })) : JOURNAUX_DEFAUT;
    } else {
      entries = loadLocal();
      journaux = JOURNAUX_DEFAUT;
    }
    setStatus('ready');
  } catch (err) {
    setStatus('error', describeError(err));
  }
  notify();
}

export function ensureHydrated() {
  if (!hydratePromise) hydratePromise = hydrate();
  return hydratePromise;
}

async function refresh() {
  if (supabaseConfigured) {
    const { data, error } = await supabase.from('sage_entries').select('*').order('created_at');
    if (error) throw error;
    entries = data.map(toEntry);
  }
  notify();
}

// -------------------------------- Mutations --------------------------------

export async function addEntry({ journal, pieceDate, account, label, debit, credit }) {
  if (!journal?.trim()) throw new Error('Le code journal est obligatoire.');
  if (!pieceDate) throw new Error('La date de pièce est obligatoire.');
  if (!account?.trim()) throw new Error('Le n° de compte est obligatoire.');
  const d = roundFCFA(debit) || 0;
  const c = roundFCFA(credit) || 0;
  if (d < 0 || c < 0) throw new Error('Les montants doivent être positifs.');
  if (d === 0 && c === 0) throw new Error('Renseignez un montant au débit ou au crédit.');

  const row = {
    journal: journal.trim(), piece_date: pieceDate, account: account.trim(),
    label: (label || '').trim(), debit: d, credit: c
  };

  if (supabaseConfigured) {
    const { error } = await supabase.from('sage_entries').insert(row);
    if (error) throw new Error(describeError(error));
    await refresh();
  } else {
    entries = [...entries, {
      id: uid(),
      journal: row.journal, pieceDate: row.piece_date, account: row.account,
      label: row.label, debit: row.debit, credit: row.credit,
      createdAt: new Date().toISOString()
    }];
    saveLocal();
    notify();
  }
}

export async function deleteEntry(id) {
  if (supabaseConfigured) {
    const { error } = await supabase.from('sage_entries').delete().eq('id', id);
    if (error) throw new Error(describeError(error));
    await refresh();
  } else {
    entries = entries.filter((e) => e.id !== id);
    saveLocal();
    notify();
  }
}

export async function clearEntries() {
  if (entries.length === 0) return;
  if (supabaseConfigured) {
    const ids = entries.map((e) => e.id);
    const { error } = await supabase.from('sage_entries').delete().in('id', ids);
    if (error) throw new Error(describeError(error));
    await refresh();
  } else {
    entries = [];
    saveLocal();
    notify();
  }
}
