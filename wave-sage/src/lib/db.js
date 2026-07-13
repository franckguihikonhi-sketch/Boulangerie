// ---------------------------------------------------------------------------
// Couche de données de l'application « Wave → SAGE ».
//
// Deux backends interchangeables, choisis automatiquement au chargement :
//   • Supabase (base DÉDIÉE) si VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY sont
//     renseignés — paramètres, règles, mappings et historique d'imports sont
//     partagés entre appareils ;
//   • sinon, stockage LOCAL du navigateur (localStorage) — l'application reste
//     pleinement utilisable, hors ligne, sans configuration.
//
// Le frontend lit un cache mémoire de façon synchrone (useStore) ; chaque
// mutation ré-hydrate le cache et prévient les abonnés.
// ---------------------------------------------------------------------------

import { supabase, supabaseConfigured } from './supabase';
import { PARAMETRES_DEFAUT, REGLES_DEFAUT } from './rules';
import { PLAN_COMPTABLE, normaliserCompte } from '../data/planComptable';

const PREFIXE = 'wave-sage:';
const K_PARAMS = PREFIXE + 'parametres';
const K_REGLES = PREFIXE + 'regles';
const K_MAPPINGS = PREFIXE + 'mappings';
const K_IMPORTS = PREFIXE + 'imports';
const K_EXPORTED = PREFIXE + 'exportedTx';
const K_PLAN = PREFIXE + 'plan';
const MAX_EXPORTED = 5000; // borne du garde-fou anti-doublon

let planMap = null; // cache compte -> intitulé (invalidé à chaque changement)

let state = {
  parametres: { ...PARAMETRES_DEFAUT },
  regles: clonerRegles(REGLES_DEFAUT),
  plan: PLAN_COMPTABLE.map((c) => ({ ...c })), // référentiel des comptes (éditable)
  mappings: {}, // { contrepartieNormalisee: compte }
  imports: [], // historique { id, dateImport, nomFichier, periode, controle }
  exportedTx: [] // identifiants Wave déjà exportés vers SAGE (anti-doublon)
};
let status = 'idle'; // idle | loading | ready | error
let statusSnapshot = { status, error: null, backend: supabaseConfigured ? 'supabase' : 'local' };
let hydratePromise = null;
const listeners = new Set();

function clonerRegles(regles) {
  return regles.map((r, i) => ({
    id: r.id || `def-${i + 1}`,
    priorite: r.priorite ?? (i + 1) * 10,
    sens: r.sens || 'sortie',
    motsCles: [...(r.motsCles || [])],
    compte: r.compte,
    libelle: r.libelle || '',
    actif: r.actif !== false
  }));
}

function setStatus(next, error = null) {
  status = next;
  statusSnapshot = { status, error, backend: supabaseConfigured ? 'supabase' : 'local' };
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
export function getParametres() {
  return state.parametres;
}
export function getRegles() {
  return state.regles;
}
export function getMappings() {
  return state.mappings;
}
export function getImports() {
  return state.imports;
}
export function getExportedTxIds() {
  return new Set(state.exportedTx);
}
export function getPlan() {
  return state.plan;
}
function rebuildPlanMap() {
  planMap = Object.fromEntries(state.plan.map((c) => [c.compte, c.intitule]));
}
export function intituleDe(compte) {
  if (!planMap) rebuildPlanMap();
  return planMap[normaliserCompte(compte)] || '';
}

// -------------------------- Hydratation -----------------------------------

function lireLocal() {
  try {
    const p = JSON.parse(localStorage.getItem(K_PARAMS) || 'null');
    const r = JSON.parse(localStorage.getItem(K_REGLES) || 'null');
    const m = JSON.parse(localStorage.getItem(K_MAPPINGS) || 'null');
    const im = JSON.parse(localStorage.getItem(K_IMPORTS) || 'null');
    const ex = JSON.parse(localStorage.getItem(K_EXPORTED) || 'null');
    const pl = JSON.parse(localStorage.getItem(K_PLAN) || 'null');
    if (p) state.parametres = { ...PARAMETRES_DEFAUT, ...p };
    if (Array.isArray(r) && r.length) state.regles = clonerRegles(r);
    if (m && typeof m === 'object') state.mappings = m;
    if (Array.isArray(im)) state.imports = im;
    if (Array.isArray(ex)) state.exportedTx = ex;
    if (Array.isArray(pl) && pl.length) {
      state.plan = pl.filter((c) => c && c.compte);
      planMap = null;
    }
  } catch {
    /* stockage indisponible : on garde les valeurs par défaut */
  }
}

function ecrireLocal() {
  try {
    localStorage.setItem(K_PARAMS, JSON.stringify(state.parametres));
    localStorage.setItem(K_REGLES, JSON.stringify(state.regles));
    localStorage.setItem(K_MAPPINGS, JSON.stringify(state.mappings));
    localStorage.setItem(K_IMPORTS, JSON.stringify(state.imports.slice(0, 50)));
    localStorage.setItem(K_EXPORTED, JSON.stringify(state.exportedTx.slice(-MAX_EXPORTED)));
  } catch {
    /* quota/indispo : sans effet */
  }
}

// Le plan comptable est volumineux : on ne l'écrit que lorsqu'il change.
function ecrirePlanLocal() {
  try {
    localStorage.setItem(K_PLAN, JSON.stringify(state.plan));
  } catch {
    /* quota/indispo : sans effet */
  }
}

async function hydraterSupabase() {
  // Plan comptable (référentiel éditable, partagé).
  const { data: plan } = await supabase
    .from('plan_comptable')
    .select('compte, intitule')
    .order('compte', { ascending: true });
  if (plan && plan.length) {
    state.plan = plan.map((r) => ({ compte: r.compte, intitule: r.intitule }));
    planMap = null;
  }
  // Paramètres (table clé/valeur).
  const { data: params } = await supabase.from('parametres').select('cle, valeur');
  if (params && params.length) {
    const obj = {};
    for (const row of params) obj[row.cle] = row.valeur;
    state.parametres = { ...PARAMETRES_DEFAUT, ...obj };
  }
  // Règles.
  const { data: regles } = await supabase
    .from('regles_imputation')
    .select('*')
    .order('priorite', { ascending: true });
  if (regles && regles.length) {
    state.regles = regles.map((r) => ({
      id: String(r.id),
      priorite: r.priorite,
      sens: r.sens,
      motsCles: Array.isArray(r.mots_cles) ? r.mots_cles : String(r.mots_cles || '').split('|').filter(Boolean),
      compte: r.compte,
      libelle: r.libelle || '',
      actif: r.actif !== false
    }));
  }
  // Mappings par contrepartie.
  const { data: maps } = await supabase.from('mappings_contrepartie').select('contrepartie, compte');
  if (maps) {
    const obj = {};
    for (const row of maps) obj[row.contrepartie] = row.compte;
    state.mappings = obj;
  }
  // Références déjà exportées (garde-fou anti-doublon), depuis les écritures.
  const { data: refs } = await supabase
    .from('ecritures')
    .select('reference')
    .limit(20000);
  if (refs && refs.length) {
    const set = new Set([...state.exportedTx, ...refs.map((r) => r.reference).filter(Boolean)]);
    state.exportedTx = [...set];
  }
  // Historique d'imports.
  const { data: imports } = await supabase
    .from('imports')
    .select('*')
    .order('date_import', { ascending: false })
    .limit(50);
  if (imports) {
    state.imports = imports.map((r) => ({
      id: String(r.id),
      dateImport: r.date_import,
      nomFichier: r.nom_fichier,
      periode: { debut: r.periode_debut, fin: r.periode_fin },
      controle: {
        nbPieces: r.nb_pieces,
        nbLignes: r.nb_lignes,
        debit: r.total_debit,
        credit: r.total_credit
      }
    }));
  }
}

export function hydrater() {
  if (hydratePromise) return hydratePromise;
  setStatus('loading');
  notify();
  hydratePromise = (async () => {
    lireLocal(); // base commune + repli hors ligne
    if (supabaseConfigured) {
      try {
        await hydraterSupabase();
      } catch (e) {
        // La base dédiée n'est pas prête : on reste en local sans bloquer l'UI.
        setStatus('ready', e?.message || 'Supabase indisponible (mode local).');
        state = { ...state }; // nouvelle référence -> re-render des abonnés
        notify();
        return;
      }
    }
    setStatus('ready');
    state = { ...state }; // nouvelle référence -> re-render des abonnés
    notify();
  })();
  return hydratePromise;
}

// --------------------------- Mutations ------------------------------------

export async function setParametres(patch) {
  state = { ...state, parametres: { ...state.parametres, ...patch } };
  ecrireLocal();
  notify();
  if (supabaseConfigured) {
    try {
      const rows = Object.entries(patch).map(([cle, valeur]) => ({ cle, valeur: String(valeur) }));
      await supabase.from('parametres').upsert(rows, { onConflict: 'cle' });
    } catch {
      /* on garde la valeur locale */
    }
  }
}

export async function upsertRegle(regle) {
  const idx = state.regles.findIndex((r) => r.id === regle.id);
  const propre = {
    id: regle.id || `r-${Date.now()}`,
    priorite: Number(regle.priorite) || 100,
    sens: regle.sens || 'sortie',
    motsCles: (regle.motsCles || []).map((m) => m.trim()).filter(Boolean),
    compte: regle.compte,
    libelle: regle.libelle || '',
    actif: regle.actif !== false
  };
  const regles = (idx === -1
    ? [...state.regles, propre]
    : state.regles.map((r) => (r.id === propre.id ? propre : r))
  ).sort((a, b) => a.priorite - b.priorite);
  state = { ...state, regles };
  ecrireLocal();
  notify();
  if (supabaseConfigured) {
    try {
      await supabase.from('regles_imputation').upsert({
        id: /^\d+$/.test(propre.id) ? Number(propre.id) : undefined,
        priorite: propre.priorite,
        sens: propre.sens,
        mots_cles: propre.motsCles,
        compte: propre.compte,
        libelle: propre.libelle,
        actif: propre.actif
      });
    } catch {
      /* local conservé */
    }
  }
  return propre;
}

export async function removeRegle(id) {
  state = { ...state, regles: state.regles.filter((r) => r.id !== id) };
  ecrireLocal();
  notify();
  if (supabaseConfigured && /^\d+$/.test(id)) {
    try {
      await supabase.from('regles_imputation').delete().eq('id', Number(id));
    } catch {
      /* local conservé */
    }
  }
}

export async function reinitialiserRegles() {
  state = { ...state, regles: clonerRegles(REGLES_DEFAUT) };
  ecrireLocal();
  notify();
}

// --------------------- Plan comptable (CRUD) ------------------------------

// Ajoute ou modifie un compte du plan (numéro normalisé à 8 chiffres).
export async function upsertCompte({ compte, intitule }) {
  const c = normaliserCompte(compte);
  if (!c) return null;
  const lib = String(intitule || '').trim();
  const idx = state.plan.findIndex((x) => x.compte === c);
  const plan = (idx === -1
    ? [...state.plan, { compte: c, intitule: lib }]
    : state.plan.map((x) => (x.compte === c ? { compte: c, intitule: lib } : x))
  ).sort((a, b) => a.compte.localeCompare(b.compte));
  state = { ...state, plan };
  planMap = null;
  ecrirePlanLocal();
  notify();
  if (supabaseConfigured) {
    try {
      await supabase.from('plan_comptable').upsert({ compte: c, intitule: lib }, { onConflict: 'compte' });
    } catch {
      /* local conservé */
    }
  }
  return c;
}

// Supprime un compte du plan.
export async function removeCompte(compte) {
  const c = normaliserCompte(compte);
  state = { ...state, plan: state.plan.filter((x) => x.compte !== c) };
  planMap = null;
  ecrirePlanLocal();
  notify();
  if (supabaseConfigured) {
    try {
      await supabase.from('plan_comptable').delete().eq('compte', c);
    } catch {
      /* compte référencé (règle/écriture) : suppression distante ignorée */
    }
  }
}

// Restaure le plan comptable SYSCOHADA d'origine.
export async function reinitialiserPlan() {
  state = { ...state, plan: PLAN_COMPTABLE.map((c) => ({ ...c })) };
  planMap = null;
  ecrirePlanLocal();
  notify();
}

export async function setMapping(contrepartieNormalisee, compte) {
  if (!contrepartieNormalisee) return;
  let mappings;
  if (compte) mappings = { ...state.mappings, [contrepartieNormalisee]: compte };
  else {
    mappings = { ...state.mappings };
    delete mappings[contrepartieNormalisee];
  }
  state = { ...state, mappings };
  ecrireLocal();
  notify();
  if (supabaseConfigured) {
    try {
      if (compte) {
        await supabase
          .from('mappings_contrepartie')
          .upsert({ contrepartie: contrepartieNormalisee, compte }, { onConflict: 'contrepartie' });
      } else {
        await supabase.from('mappings_contrepartie').delete().eq('contrepartie', contrepartieNormalisee);
      }
    } catch {
      /* local conservé */
    }
  }
}

// Vide l'historique des imports et le garde-fou anti-doublon (démarrage propre).
// Ne touche pas au plan comptable, aux règles ni aux paramètres.
export async function viderHistorique() {
  state = { ...state, imports: [], exportedTx: [] };
  try {
    localStorage.removeItem(K_IMPORTS);
    localStorage.removeItem(K_EXPORTED);
  } catch {
    /* stockage indisponible */
  }
  notify();
  if (supabaseConfigured) {
    try {
      await supabase.from('ecritures').delete().neq('id', 0);
      await supabase.from('imports').delete().neq('id', 0);
    } catch {
      /* best-effort */
    }
  }
}

// Enregistre un import (métadonnées + écritures) pour l'historique / l'audit.
export async function enregistrerImport({ nomFichier, periode, pieces, controle }) {
  const entree = {
    id: `imp-${Date.now()}`,
    dateImport: new Date().toISOString(),
    nomFichier: nomFichier || '',
    periode: periode || { debut: '', fin: '' },
    controle
  };
  const imports = [entree, ...state.imports].slice(0, 50);
  // Mémorise les identifiants Wave exportés (anti-doublon sur les imports futurs).
  let exportedTx = state.exportedTx;
  if (Array.isArray(pieces)) {
    const nouveaux = pieces.map((p) => p.txId).filter(Boolean);
    if (nouveaux.length) {
      exportedTx = [...new Set([...state.exportedTx, ...nouveaux])].slice(-MAX_EXPORTED);
    }
  }
  state = { ...state, imports, exportedTx };
  ecrireLocal();
  notify();
  if (supabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('imports')
        .insert({
          nom_fichier: entree.nomFichier,
          periode_debut: periode?.debut || null,
          periode_fin: periode?.fin || null,
          nb_pieces: controle?.nbPieces || 0,
          nb_lignes: controle?.nbLignes || 0,
          total_debit: controle?.debit || 0,
          total_credit: controle?.credit || 0
        })
        .select('id')
        .single();
      if (!error && data && pieces) {
        const lignes = pieces.flatMap((p) =>
          p.lignes.map((l) => ({
            import_id: data.id,
            reference: l.ref,
            journal: l.journal,
            piece_date: l.date || null,
            compte: l.compte,
            libelle: l.libelle,
            debit: l.debit,
            credit: l.credit
          }))
        );
        if (lignes.length) await supabase.from('ecritures').insert(lignes);
      }
    } catch {
      /* audit distant best-effort ; l'export local reste disponible */
    }
  }
  return entree;
}
