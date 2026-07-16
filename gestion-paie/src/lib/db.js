// ---------------------------------------------------------------------------
// Couche de données — PaieCI.
//
// Backend Supabase (PostgreSQL) + cache mémoire hydraté, lu de façon synchrone
// par les pages. Chaque écriture ré-hydrate le cache. Un MODE DÉMONSTRATION
// (accès invité) rejoue toute la logique dans un bac à sable ENTIÈREMENT LOCAL,
// sans jamais toucher la base : idéal pour essayer l'application sans compte.
//
// Même architecture que les autres modules du dépôt (gestion-devis,
// ecritures-sage…) : l'API applicative (saveEmployee, deleteEmployee,
// saveSettings) reste identique quel que soit le mode.
//
// Domaine :
//   - settings  : profil employeur + paramètres de paie (taux AT, plafond
//                 transport exonéré, mode de paiement).
//   - employees : salariés, chacun avec une ou plusieurs PÉRIODES
//                 contractuelles (CDD initial, renouvellements, passage CDI),
//                 chaque période portant salaire de base, NET cible et primes.
// ---------------------------------------------------------------------------

import { roundFCFA } from './money';
import { DEFAULT_PARAMS } from './payroll';
import { supabase, supabaseConfigured } from './supabase';
import { safeGet, safeSet, safeRemove } from './storage';

export const SITUATIONS = ['celibataire', 'marie', 'divorce', 'veuf'];
export const TYPES_CONTRAT = ['cdd', 'cdi'];

// Durée d'une session de démonstration (accès invité) : 30 minutes.
export const DEMO_MS = 30 * 60 * 1000;
const DEMO_STATE_KEY = 'gpaie-demo-state';
// Espace de travail PERSISTANT (mode admin / gestionnaire sans Supabase) :
// contrairement au bac à sable démo, il ne s'efface pas et n'expire pas.
const LOCAL_STATE_KEY = 'gpaie-local-state';
const SESSION_KEY = 'gpaie-session';

// --------------------------- Cache & abonnement ----------------------------

let demoMode = false;
let state = emptyState();
let status = 'idle'; // idle | loading | ready | error
let statusSnapshot = { status, error: null };
let hydratePromise = null;
const listeners = new Set();

function setStatus(next, error = null) {
  status = next;
  statusSnapshot = { status, error };
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function defaultSettings() {
  return {
    raisonSociale: 'Mon Entreprise',
    employeurCnps: '',
    adresse: 'Abidjan, Côte d’Ivoire',
    modePaiement: 'Virement',
    tauxAccidentTravail: DEFAULT_PARAMS.cnpsAccidentTravail,
    transportExonere: DEFAULT_PARAMS.transportExonere
  };
}

function emptyState() {
  return { settings: defaultSettings(), employees: [] };
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

// --------------------------- Paramètres de paie effectifs ------------------

// Fusionne les paramètres légaux par défaut avec les réglages employeur.
export function paramsFromSettings(settings) {
  const s = settings || state.settings;
  return {
    ...DEFAULT_PARAMS,
    cnpsAccidentTravail: Number(s.tauxAccidentTravail ?? DEFAULT_PARAMS.cnpsAccidentTravail),
    transportExonere: roundFCFA(s.transportExonere ?? DEFAULT_PARAMS.transportExonere)
  };
}

// --------------------------- Normalisation ---------------------------------

function normPrimes(primes) {
  if (!Array.isArray(primes)) return [];
  return primes
    .filter((p) => p && (p.label?.trim() || Number(p.montant) > 0))
    .map((p) => ({
      label: (p.label || '').trim() || 'Prime',
      montant: roundFCFA(p.montant),
      imposable: p.imposable !== false
    }));
}

function normPeriode(p) {
  return {
    id: p.id || uid(),
    kind: p.kind === 'cdi' ? 'cdi' : 'cdd',
    label: (p.label || '').trim(),
    debut: p.debut || '',
    // Une date de fin est possible pour un CDD (terme normal) COMME pour un
    // CDI (licenciement / rupture) : dans les deux cas, vide = contrat
    // toujours en cours.
    fin: p.fin || null,
    salaireBase: roundFCFA(p.salaireBase),
    netCible: roundFCFA(p.netCible),
    transport: roundFCFA(p.transport ?? 0),
    primes: normPrimes(p.primes)
  };
}

// Construit l'enregistrement salarié normalisé à partir des saisies.
function buildEmployee(input) {
  if (!input.nom?.trim()) throw new Error('errors.nameRequired');
  const periodes = (input.periodes || []).map(normPeriode).filter((p) => p.debut);
  if (periodes.length === 0) throw new Error('errors.noPeriod');
  return {
    id: input.id || undefined,
    matricule: input.matricule?.trim() || '',
    nom: input.nom.trim(),
    situation: SITUATIONS.includes(input.situation) ? input.situation : 'celibataire',
    enfants: Math.max(0, Math.floor(Number(input.enfants) || 0)),
    cnps: input.cnps?.trim() || '',
    emploi: input.emploi?.trim() || '',
    expatrie: input.expatrie === true,
    dateEmbauche: input.dateEmbauche || `${periodes[0].debut}-01`,
    salaireCategoriel: roundFCFA(input.salaireCategoriel || periodes[0].salaireBase),
    // Préserve le marquage « sous contrôle » tel quel : un enregistrement
    // (édition, révision de salaire, fin de contrat…) ne doit jamais lever
    // ou poser ce marquage à l'insu de l'utilisateur.
    sousControle: input.sousControle === true,
    controleMotif: input.controleMotif?.trim() || '',
    controleDepuis: input.controleDepuis || null,
    periodes
  };
}

// ===========================================================================
// MODE DÉMONSTRATION (accès invité) — bac à sable ENTIÈREMENT LOCAL.
// ===========================================================================

export function isDemoMode() {
  return demoMode;
}

// Vrai en mode « admin local » : connecté (hors invité) mais sans base Supabase
// configurée. Les données sont alors persistées dans le navigateur.
export function isLocalMode() {
  return !demoMode && !supabaseConfigured;
}

function seededState() {
  const s = emptyState();
  seedDemo(s);
  return s;
}

// Clé de persistance locale selon le mode : bac à sable invité (démo, éphémère)
// ou espace de travail persistant (admin/gestionnaire hors Supabase).
function localKey() {
  return demoMode ? DEMO_STATE_KEY : LOCAL_STATE_KEY;
}

function persistLocal() {
  safeSet(localKey(), JSON.stringify(state));
}

// Transaction locale : fn reçoit une copie profonde ; en cas d'exception,
// l'état courant reste intact (aucune écriture partielle).
function memMutate(fn) {
  const draft = JSON.parse(JSON.stringify(state));
  const result = fn(draft);
  state = draft;
  persistLocal();
  notify();
  return result;
}

export function startDemo() {
  demoMode = true;
  hydratePromise = Promise.resolve(); // neutralise toute hydratation Supabase
  state = seededState();
  persistLocal();
  setStatus('ready');
  notify();
}

export function stopDemo() {
  demoMode = false;
  hydratePromise = null;
  safeRemove(DEMO_STATE_KEY);
  state = emptyState();
  setStatus('idle');
}

function guestSessionActive() {
  try {
    const s = JSON.parse(safeGet(SESSION_KEY));
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
    restored = JSON.parse(safeGet(DEMO_STATE_KEY));
  } catch {
    /* ignore */
  }
  state = restored && Array.isArray(restored.employees)
    ? { settings: { ...defaultSettings(), ...restored.settings }, employees: restored.employees }
    : seededState();
  persistLocal();
  setStatus('ready');
})();

// ===========================================================================
// MODE SUPABASE — cache hydraté depuis la base.
// ===========================================================================

const toPrime = (r) => ({
  label: r.label, montant: Number(r.montant), imposable: r.imposable
});
const toPeriode = (r) => ({
  id: r.id, kind: r.kind, label: r.label,
  debut: (r.debut || '').slice(0, 7),
  fin: r.fin ? r.fin.slice(0, 7) : null,
  salaireBase: Number(r.salaire_base), netCible: Number(r.net_cible),
  transport: Number(r.transport),
  primes: (r.primes || []).sort((a, b) => a.position - b.position).map(toPrime)
});
const toEmployee = (r) => ({
  id: r.id, matricule: r.matricule, nom: r.nom, situation: r.situation,
  enfants: Number(r.enfants), cnps: r.cnps, emploi: r.emploi, expatrie: r.expatrie,
  dateEmbauche: r.date_embauche, salaireCategoriel: Number(r.salaire_categoriel),
  createdAt: r.created_at,
  sousControle: r.sous_controle === true,
  controleMotif: r.controle_motif || '',
  controleDepuis: r.controle_depuis || null,
  periodes: (r.periodes || []).sort((a, b) => a.position - b.position).map(toPeriode)
});
const toSettings = (r) => ({
  raisonSociale: r.raison_sociale, employeurCnps: r.employeur_cnps, adresse: r.adresse,
  modePaiement: r.mode_paiement,
  tauxAccidentTravail: Number(r.taux_accident_travail),
  transportExonere: Number(r.transport_exonere)
});

function describeError(err) {
  const msg = err?.message || String(err);
  if (!supabaseConfigured) return 'errors.dbNotConfigured';
  if (/schema cache|does not exist|relation .* does not exist|PGRST205|function .* does not exist/i.test(msg)) {
    return 'errors.dbNotReady';
  }
  return msg;
}

async function fetchAll() {
  const [set, emp] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('employees').select('*, periodes(*, primes(*))').order('created_at')
  ]);
  for (const r of [set, emp]) if (r.error) throw r.error;
  return {
    settings: set.data ? toSettings(set.data) : defaultSettings(),
    employees: (emp.data || []).map(toEmployee)
  };
}

export async function hydrate() {
  if (demoMode) { setStatus('ready'); notify(); return; }
  if (!supabaseConfigured) {
    // Mode LOCAL (admin / gestionnaire sans Supabase) : espace de travail
    // PERSISTANT dans le navigateur. On restaure l'état sauvegardé ; sinon on
    // démarre sur un espace vierge, à peupler par l'utilisateur (aucune donnée
    // de démonstration ici, contrairement au mode invité).
    let restored = null;
    try {
      restored = JSON.parse(safeGet(LOCAL_STATE_KEY));
    } catch {
      /* ignore */
    }
    state = restored && Array.isArray(restored.employees)
      ? { settings: { ...defaultSettings(), ...restored.settings }, employees: restored.employees }
      : emptyState();
    setStatus('ready');
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
    const channel = supabase.channel('gpaie-sync');
    for (const table of ['settings', 'employees', 'periodes', 'primes']) {
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

// ===========================================================================
// API applicative (identique en démo et en base).
// ===========================================================================

export async function saveSettings(patch) {
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.settings = { ...s.settings, ...patch };
    });
  }
  const row = {};
  if (patch.raisonSociale !== undefined) row.raison_sociale = patch.raisonSociale;
  if (patch.employeurCnps !== undefined) row.employeur_cnps = patch.employeurCnps;
  if (patch.adresse !== undefined) row.adresse = patch.adresse;
  if (patch.modePaiement !== undefined) row.mode_paiement = patch.modePaiement;
  if (patch.tauxAccidentTravail !== undefined) row.taux_accident_travail = patch.tauxAccidentTravail;
  if (patch.transportExonere !== undefined) row.transport_exonere = roundFCFA(patch.transportExonere);
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('settings').update(row).eq('id', 1);
  if (error) throw rpcError(error);
  await refresh();
}

export async function saveEmployee(input) {
  const record = buildEmployee(input);
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      if (record.id) {
        const e = s.employees.find((x) => x.id === record.id);
        if (!e) throw new Error('errors.notFound');
        Object.assign(e, record);
        return record.id;
      }
      const id = uid();
      s.employees.push({ ...record, id, createdAt: new Date().toISOString() });
      return id;
    });
  }
  const { data, error } = await supabase.rpc('save_employee', { p: record });
  if (error) throw rpcError(error);
  await refresh();
  return data;
}

export async function deleteEmployee(id) {
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.employees = s.employees.filter((e) => e.id !== id);
    });
  }
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

export function getEmployee(id) {
  return state.employees.find((e) => e.id === id) || null;
}

// Réinitialise les données de démonstration (bouton Paramètres, mode démo).
export function resetDemoData() {
  if (!demoMode) return;
  state = seededState();
  persistLocal();
  notify();
}

// --------------------------- Données d'exemple -----------------------------
// Deux profils : un CDD renouvelé deux fois puis passé en CDI, et un cadre
// marié avec enfants directement en CDI.

function seedDemo(s) {
  s.settings.raisonSociale = 'Boulangerie La Croustille';
  s.settings.employeurCnps = '1234567 A';
  s.settings.adresse = 'Cocody, Abidjan';

  s.employees.push({
    id: uid(),
    matricule: 'SAL-001',
    nom: 'KOUAMÉ Adjoua Sylvie',
    situation: 'marie',
    enfants: 2,
    cnps: '9988776 C',
    emploi: 'Vendeuse',
    expatrie: false,
    dateEmbauche: '2023-01-01',
    salaireCategoriel: 120000,
    periodes: [
      { id: uid(), kind: 'cdd', label: 'CDD initial', debut: '2023-01', fin: '2023-06',
        salaireBase: 120000, netCible: 150000, transport: 30000, primes: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 1', debut: '2023-07', fin: '2023-12',
        salaireBase: 130000, netCible: 165000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 15000, imposable: true }] },
      { id: uid(), kind: 'cdi', label: 'CDI', debut: '2024-01', fin: null,
        salaireBase: 150000, netCible: 190000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 20000, imposable: true }] }
    ],
    createdAt: new Date().toISOString()
  });

  // CDD renouvelé au-delà de 2 ans : requalification automatique en CDI.
  s.employees.push({
    id: uid(),
    matricule: 'SAL-003',
    nom: 'DIALLO Mariam',
    situation: 'celibataire',
    enfants: 1,
    cnps: '4455667 B',
    emploi: 'Caissière',
    expatrie: false,
    dateEmbauche: '2022-02-01',
    salaireCategoriel: 100000,
    periodes: [
      { id: uid(), kind: 'cdd', label: 'CDD initial', debut: '2022-02', fin: '2022-07',
        salaireBase: 100000, netCible: 130000, transport: 30000, primes: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 1', debut: '2022-08', fin: '2023-07',
        salaireBase: 105000, netCible: 140000, transport: 30000, primes: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 2', debut: '2023-08', fin: null,
        salaireBase: 110000, netCible: 150000, transport: 30000, primes: [] }
    ],
    createdAt: new Date().toISOString()
  });

  s.employees.push({
    id: uid(),
    matricule: 'SAL-002',
    nom: 'TRAORÉ Ibrahim',
    situation: 'marie',
    enfants: 3,
    cnps: '5566778 D',
    emploi: 'Chef de production',
    expatrie: false,
    dateEmbauche: '2020-03-01',
    salaireCategoriel: 250000,
    periodes: [
      { id: uid(), kind: 'cdi', label: 'CDI', debut: '2020-03', fin: null,
        salaireBase: 300000, netCible: 420000, transport: 40000,
        primes: [{ label: 'Prime de responsabilité', montant: 50000, imposable: true }] }
    ],
    createdAt: new Date().toISOString()
  });
}
