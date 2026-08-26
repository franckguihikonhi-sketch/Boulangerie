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
import { DEFAULT_PARAMS, cycleConges } from './payroll';
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
    // Mentions légales complémentaires d'identification employeur (RCCM,
    // compte contribuable, branche d'activité), obligatoires sur le bulletin.
    rccm: '',
    compteContribuable: '',
    activite: '',
    // Logo de l'entreprise, imprimé directement dans l'en-tête du bulletin
    // PDF (data URI base64 — ex. "data:image/png;base64,...").
    logoDataUrl: '',
    adresse: 'Abidjan, Côte d’Ivoire',
    modePaiement: 'Virement',
    tauxAccidentTravail: DEFAULT_PARAMS.cnpsAccidentTravail,
    transportExonere: DEFAULT_PARAMS.transportExonere
  };
}

function emptyState() {
  return {
    settings: defaultSettings(), employees: [], versements: {}, clotures: {},
    congesPris: [], cyclesCongesClotures: [], auditLog: []
  };
}

// Historique des modifications (qui a changé quoi, quand) : plafonné pour
// rester léger en mode démo/local (le mode Supabase, lui, conserve tout côté
// base — seule la fenêtre affichée est limitée par la requête de fetchAll).
const AUDIT_LOG_MAX = 500;

function pushAuditEntry(s, entry) {
  s.auditLog = s.auditLog || [];
  s.auditLog.unshift({ id: uid(), createdAt: new Date().toISOString(), ...entry });
  if (s.auditLog.length > AUDIT_LOG_MAX) s.auditLog.length = AUDIT_LOG_MAX;
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

// Primes rattachées à une période (prime de logement, de rendement…). `mois`
// (aaaa-mm) optionnel, même logique que les retenues et heures sup : vide =
// s'applique à tous les mois de la période (prime mensuelle récurrente) ;
// renseigné = ce mois précis uniquement (prime exceptionnelle ponctuelle,
// ex. 13ᵉ mois) — sans quoi elle serait comptée à tort chaque mois ET 12 fois
// dans l'assiette de l'indemnité de congé payé (règle du 1/12ᵉ).
function normPrimes(primes) {
  if (!Array.isArray(primes)) return [];
  return primes
    .filter((p) => p && (p.label?.trim() || Number(p.montant) > 0))
    .map((p) => ({
      label: (p.label || '').trim() || 'Prime',
      montant: roundFCFA(p.montant),
      imposable: p.imposable !== false,
      mois: p.mois || null
    }));
}

// Retenues particulières (avances sur salaire, prêts, oppositions
// judiciaires…) : déduites du net à payer, mentionnées à part sur le
// bulletin — distinctes des cotisations/impôts légaux. `mois` (aaaa-mm)
// optionnel : laissé vide, la retenue s'applique à tous les mois de la
// période (ex. opposition judiciaire récurrente) ; renseigné, elle ne
// s'applique qu'à ce mois précis (ex. avance ponctuelle).
function normRetenues(retenues) {
  if (!Array.isArray(retenues)) return [];
  return retenues
    .filter((r) => r && (r.label?.trim() || Number(r.montant) > 0))
    .map((r) => ({
      label: (r.label || '').trim() || 'Retenue',
      montant: roundFCFA(r.montant),
      mois: r.mois || null
    }));
}

// Heures supplémentaires : majoration légale (décimal, ex. 0.15 = +15 %) et
// nombre d'heures, converties en montant via le taux horaire du salaire de
// base (voir payroll.js). `mois` optionnel, même logique que les retenues :
// vide = s'applique à tous les mois de la période, renseigné = ce mois précis.
function normHeuresSup(heures) {
  if (!Array.isArray(heures)) return [];
  return heures
    .filter((h) => h && Number(h.heures) > 0)
    .map((h) => ({
      heures: Math.max(0, Number(h.heures) || 0),
      majoration: Math.max(0, Number(h.majoration) || 0),
      mois: h.mois || null
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
    // Jour exact de sortie dans le mois de `fin` (1-31, méthode des 30èmes —
    // un 31 est ramené à 30), optionnel : vide = sortie en fin de mois plein
    // (comportement historique inchangé) ; renseigné = le salaire du mois de
    // sortie est proratisé sur les jours réellement travaillés.
    finJour: p.finJour ? Math.max(1, Math.min(31, Math.round(Number(p.finJour)))) : null,
    salaireBase: roundFCFA(p.salaireBase),
    netCible: roundFCFA(p.netCible),
    transport: roundFCFA(p.transport ?? 0),
    primes: normPrimes(p.primes),
    retenues: normRetenues(p.retenues),
    heuresSupplementaires: normHeuresSup(p.heuresSupplementaires)
  };
}

// Construit l'enregistrement salarié normalisé à partir des saisies. Exporté
// pour cloture.js, qui en a besoin pour comparer un salarié avant/après
// modification sur la même base normalisée que ce qui sera réellement
// persisté (arrondis, mois vides -> null, etc.).
export function buildEmployee(input) {
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
    // Catégorie / classification professionnelle (convention collective) —
    // distincte de l'intitulé de poste (« emploi »), mention légale requise.
    categorie: input.categorie?.trim() || '',
    expatrie: input.expatrie === true,
    dateEmbauche: input.dateEmbauche || `${periodes[0].debut}-01`,
    salaireCategoriel: roundFCFA(input.salaireCategoriel || periodes[0].salaireBase),
    // Préserve le marquage « sous contrôle » tel quel : un enregistrement
    // (édition, révision de salaire, fin de contrat…) ne doit jamais lever
    // ou poser ce marquage à l'insu de l'utilisateur.
    sousControle: input.sousControle === true,
    controleMotif: input.controleMotif?.trim() || '',
    controleDepuis: input.controleDepuis || null,
    // Compte bancaire / Mobile Money : facultatif, sert uniquement à générer
    // l'ordre de virement (jamais utilisé dans les calculs de paie).
    compteBancaire: input.compteBancaire?.trim() || '',
    // Email : facultatif, sert uniquement à préparer l'envoi du bulletin
    // (voir Bulletins → « Préparer l'email »).
    email: input.email?.trim() || '',
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
    ? {
        settings: { ...defaultSettings(), ...restored.settings }, employees: restored.employees,
        versements: restored.versements || {}, clotures: restored.clotures || {},
        congesPris: restored.congesPris || [], cyclesCongesClotures: restored.cyclesCongesClotures || [],
        auditLog: restored.auditLog || []
      }
    : seededState();
  persistLocal();
  setStatus('ready');
})();

// ===========================================================================
// MODE SUPABASE — cache hydraté depuis la base.
// ===========================================================================

const toPrime = (r) => ({
  label: r.label, montant: Number(r.montant), imposable: r.imposable,
  mois: r.mois ? r.mois.slice(0, 7) : null
});
const toRetenue = (r) => ({
  label: r.label, montant: Number(r.montant), mois: r.mois ? r.mois.slice(0, 7) : null
});
const toHeureSup = (r) => ({
  heures: Number(r.heures), majoration: Number(r.majoration), mois: r.mois ? r.mois.slice(0, 7) : null
});
const toPeriode = (r) => ({
  id: r.id, kind: r.kind, label: r.label,
  debut: (r.debut || '').slice(0, 7),
  fin: r.fin ? r.fin.slice(0, 7) : null,
  finJour: r.fin_jour || null,
  salaireBase: Number(r.salaire_base), netCible: Number(r.net_cible),
  transport: Number(r.transport),
  primes: (r.primes || []).sort((a, b) => a.position - b.position).map(toPrime),
  retenues: (r.retenues || []).sort((a, b) => a.position - b.position).map(toRetenue),
  heuresSupplementaires: (r.heures_supplementaires || []).sort((a, b) => a.position - b.position).map(toHeureSup)
});
const toEmployee = (r) => ({
  id: r.id, matricule: r.matricule, nom: r.nom, situation: r.situation,
  enfants: Number(r.enfants), cnps: r.cnps, emploi: r.emploi, categorie: r.categorie || '',
  expatrie: r.expatrie,
  dateEmbauche: r.date_embauche, salaireCategoriel: Number(r.salaire_categoriel),
  createdAt: r.created_at,
  sousControle: r.sous_controle === true,
  controleMotif: r.controle_motif || '',
  controleDepuis: r.controle_depuis || null,
  compteBancaire: r.compte_bancaire || '',
  email: r.email || '',
  periodes: (r.periodes || []).sort((a, b) => a.position - b.position).map(toPeriode)
});
const toVersement = (r) => ({
  numeroCnps: r.numero_cnps || '', numeroCnam: r.numero_cnam || '',
  dateVersement: r.date_versement || null
});
const toCloture = (r) => ({
  clotureLe: r.cloture_le || null, cloturePar: r.cloture_par || ''
});
const toCongePris = (r) => ({
  id: r.id, employeeId: r.employee_id,
  debut: (r.debut || '').slice(0, 10), fin: (r.fin || '').slice(0, 10),
  jours: Number(r.jours) || 0, commentaire: r.commentaire || '',
  creePar: r.cree_par || '', createdAt: r.created_at
});
const toCycleCongeCloture = (r) => ({
  employeeId: r.employee_id,
  cycleDebut: (r.cycle_debut || '').slice(0, 7),
  clotureLe: r.cloture_le || null,
  cloturePar: r.cloture_par || ''
});
const toAuditEntry = (r) => ({
  id: r.id, createdAt: r.created_at, employeeId: r.employee_id, employeeNom: r.employee_nom || '',
  utilisateur: r.utilisateur || '', action: r.action, avant: r.avant || null, apres: r.apres || null
});
const toSettings = (r) => ({
  raisonSociale: r.raison_sociale, employeurCnps: r.employeur_cnps,
  rccm: r.rccm || '', compteContribuable: r.compte_contribuable || '', activite: r.activite || '',
  logoDataUrl: r.logo_data_url || '',
  adresse: r.adresse,
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
  const [set, emp, ver, clot, conges, cyclesClot, audit] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('employees').select('*, periodes(*, primes(*), retenues(*), heures_supplementaires(*))').order('created_at'),
    // Tables apparues avec migration_conformite.sql / migration_cloture_paie.sql /
    // migration_conges_pris.sql / migration_cycles_conges.sql : absentes sur
    // une base pas encore migrée, on les ignore alors silencieusement (pas
    // d'erreur bloquante, juste la fonctionnalité annexe indisponible) plutôt
    // que de casser tout le chargement de l'appli.
    supabase.from('versements').select('*'),
    supabase.from('clotures_paie').select('*'),
    supabase.from('conges_pris').select('*').order('debut'),
    supabase.from('conges_cycles_clotures').select('*'),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)
  ]);
  for (const r of [set, emp]) if (r.error) throw r.error;
  const versements = {};
  if (!ver.error) {
    for (const r of ver.data || []) versements[(r.ym || '').slice(0, 7)] = toVersement(r);
  }
  const clotures = {};
  if (!clot.error) {
    for (const r of clot.data || []) clotures[(r.ym || '').slice(0, 7)] = toCloture(r);
  }
  const congesPris = conges.error ? [] : (conges.data || []).map(toCongePris);
  const cyclesCongesClotures = cyclesClot.error ? [] : (cyclesClot.data || []).map(toCycleCongeCloture);
  const auditLog = audit.error ? [] : (audit.data || []).map(toAuditEntry);
  return {
    settings: set.data ? toSettings(set.data) : defaultSettings(),
    employees: (emp.data || []).map(toEmployee),
    versements,
    clotures,
    congesPris,
    cyclesCongesClotures,
    auditLog
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
      ? {
          settings: { ...defaultSettings(), ...restored.settings }, employees: restored.employees,
          versements: restored.versements || {}, clotures: restored.clotures || {},
          congesPris: restored.congesPris || [], cyclesCongesClotures: restored.cyclesCongesClotures || [],
          auditLog: restored.auditLog || []
        }
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
    for (const table of ['settings', 'employees', 'periodes', 'primes', 'versements', 'clotures_paie', 'conges_pris', 'conges_cycles_clotures', 'audit_log']) {
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
  if (patch.rccm !== undefined) row.rccm = patch.rccm;
  if (patch.compteContribuable !== undefined) row.compte_contribuable = patch.compteContribuable;
  if (patch.activite !== undefined) row.activite = patch.activite;
  if (patch.logoDataUrl !== undefined) row.logo_data_url = patch.logoDataUrl;
  if (patch.adresse !== undefined) row.adresse = patch.adresse;
  if (patch.modePaiement !== undefined) row.mode_paiement = patch.modePaiement;
  if (patch.tauxAccidentTravail !== undefined) row.taux_accident_travail = patch.tauxAccidentTravail;
  if (patch.transportExonere !== undefined) row.transport_exonere = roundFCFA(patch.transportExonere);
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('settings').update(row).eq('id', 1);
  if (error) throw rpcError(error);
  await refresh();
}

// Numéro de versement CNPS/CMU réel d'un mois donné (voir table
// `versements`) : mention légale distincte du n° d'immatriculation employeur
// fixe (settings.employeurCnps), saisie une fois le paiement du mois
// effectué — depuis l'État des cotisations sociales, le mois consulté.
export async function saveVersement(ym, patch) {
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.versements = s.versements || {};
      s.versements[ym] = { ...(s.versements[ym] || { numeroCnps: '', numeroCnam: '', dateVersement: null }), ...patch };
    });
  }
  // La fonction save_versement écrase les 3 colonnes à chaque appel (upsert
  // simple, pas de mise à jour partielle côté SQL) : on fusionne donc avec
  // la valeur déjà connue AVANT d'appeler le RPC, pour ne jamais effacer un
  // champ que l'appelant n'a pas fourni dans `patch`.
  const current = state.versements?.[ym] || { numeroCnps: '', numeroCnam: '', dateVersement: null };
  const merged = { ...current, ...patch };
  const { error } = await supabase.rpc('save_versement', {
    p_ym: ym,
    p_numero_cnps: merged.numeroCnps ?? '',
    p_numero_cnam: merged.numeroCnam ?? '',
    p_date_versement: merged.dateVersement ?? ''
  });
  if (error) throw rpcError(error);
  await refresh();
}

// --------------------------- Clôture mensuelle de la paie -------------------
// Marqueur PARTAGÉ (visible par tous, voir bouton « Base » / Livre de paie) :
// un mois clôturé signale que la paie de ce mois a été traitée et payée.
// Sert aussi de garde-fou — voir cloture.js, qui enveloppe saveEmployee()
// pour refuser toute modification changeant le bulletin déjà calculé d'un
// mois clôturé, tant qu'il n'est pas rouvert.
export function isMoisCloture(ym) {
  return !!(state.clotures && state.clotures[ym]);
}

export function getCloture(ym) {
  return (state.clotures && state.clotures[ym]) || null;
}

export async function cloturerMois(ym, meta = {}) {
  const cloturePar = meta.utilisateur || '';
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.clotures = s.clotures || {};
      s.clotures[ym] = { clotureLe: new Date().toISOString(), cloturePar };
    });
  }
  const { error } = await supabase.rpc('save_cloture', { p_ym: ym, p_cloture_par: cloturePar });
  if (error) throw rpcError(error);
  await refresh();
}

export async function rouvrirMois(ym) {
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      if (s.clotures) delete s.clotures[ym];
    });
  }
  const { error } = await supabase.rpc('annuler_cloture', { p_ym: ym });
  if (error) throw rpcError(error);
  await refresh();
}

// --------------------------- Congés pris (onglet Congés) --------------------
// Module de SUIVI RH, distinct du moteur de paie : enregistre les périodes de
// congé effectivement posées par un salarié, pour afficher un solde (jours
// acquis dans le cycle en cours, voir payroll.js#cycleConges, moins les jours
// déjà pris sur ce même cycle). N'affecte jamais le calcul de paie
// (l'indemnité de congé versée au mois anniversaire reste automatique, voir
// bulletin.js) — ce n'est qu'un historique consultable, pas un droit imposé.
export function congesDeEmployee(employeeId) {
  return (state.congesPris || []).filter((c) => c.employeeId === employeeId);
}

export async function ajouterCongePris(employeeId, patch, meta = {}) {
  const record = {
    debut: patch.debut,
    fin: patch.fin,
    jours: Math.max(0, Math.round((Number(patch.jours) || 0) * 10) / 10),
    commentaire: (patch.commentaire || '').trim()
  };
  if (!record.debut || !record.fin) throw new Error('errors.congeDatesRequired');
  const employee = state.employees.find((e) => e.id === employeeId);
  const cycle = employee ? cycleConges(employee.dateEmbauche, record.debut.slice(0, 7)) : null;
  if (cycle && isCycleCongesCloture(employeeId, cycle.debut)) {
    throw new Error('errors.congeCycleCloture');
  }
  const creePar = meta.utilisateur || '';
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.congesPris = s.congesPris || [];
      const id = uid();
      s.congesPris.push({ id, employeeId, ...record, creePar, createdAt: new Date().toISOString() });
      return id;
    });
  }
  const { data, error } = await supabase
    .from('conges_pris')
    .insert({
      employee_id: employeeId, debut: record.debut, fin: record.fin,
      jours: record.jours, commentaire: record.commentaire, cree_par: creePar
    })
    .select('id')
    .single();
  if (error) throw rpcError(error);
  await refresh();
  return data.id;
}

export async function supprimerCongePris(id) {
  const conge = (state.congesPris || []).find((c) => c.id === id);
  if (conge) {
    const employee = state.employees.find((e) => e.id === conge.employeeId);
    const cycle = employee ? cycleConges(employee.dateEmbauche, conge.debut.slice(0, 7)) : null;
    if (cycle && isCycleCongesCloture(conge.employeeId, cycle.debut)) {
      throw new Error('errors.congeCycleCloture');
    }
  }
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.congesPris = (s.congesPris || []).filter((c) => c.id !== id);
    });
  }
  const { error } = await supabase.from('conges_pris').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
}

// --------------------- Clôture des cycles de congés (par salarié) ----------
// Un salarié + un cycle d'acquisition donné (année antérieure, en cours ou
// future — voir payroll.js#listeCyclesConges) peut être clôturé une fois ses
// congés soldés sur cette période : l'application refuse alors tout ajout ou
// toute suppression de congé pris daté dans ce cycle, tant qu'il n'est pas
// rouvert. Même principe que la clôture mensuelle de la paie ci-dessus, mais
// à la maille salarié + cycle plutôt que mois calendaire global.
export function getCycleCongesCloture(employeeId, cycleDebut) {
  return (state.cyclesCongesClotures || []).find(
    (c) => c.employeeId === employeeId && c.cycleDebut === cycleDebut
  ) || null;
}

export function isCycleCongesCloture(employeeId, cycleDebut) {
  return !!getCycleCongesCloture(employeeId, cycleDebut);
}

export async function cloturerCycleConges(employeeId, cycleDebut, meta = {}) {
  const cloturePar = meta.utilisateur || '';
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.cyclesCongesClotures = s.cyclesCongesClotures || [];
      const existant = s.cyclesCongesClotures.find(
        (c) => c.employeeId === employeeId && c.cycleDebut === cycleDebut
      );
      const entry = { employeeId, cycleDebut, clotureLe: new Date().toISOString(), cloturePar };
      if (existant) Object.assign(existant, entry);
      else s.cyclesCongesClotures.push(entry);
    });
  }
  const { error } = await supabase
    .from('conges_cycles_clotures')
    .upsert(
      {
        employee_id: employeeId, cycle_debut: `${cycleDebut}-01`,
        cloture_par: cloturePar, cloture_le: new Date().toISOString()
      },
      { onConflict: 'employee_id,cycle_debut' }
    );
  if (error) throw rpcError(error);
  await refresh();
}

export async function rouvrirCycleConges(employeeId, cycleDebut) {
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      s.cyclesCongesClotures = (s.cyclesCongesClotures || []).filter(
        (c) => !(c.employeeId === employeeId && c.cycleDebut === cycleDebut)
      );
    });
  }
  const { error } = await supabase
    .from('conges_cycles_clotures')
    .delete()
    .eq('employee_id', employeeId)
    .eq('cycle_debut', `${cycleDebut}-01`);
  if (error) throw rpcError(error);
  await refresh();
}

// `meta.utilisateur` (facultatif) : nom/email de la personne connectée, pour
// l'historique des modifications (voir Historique). Purement déclaratif —
// aucune vérification d'identité, cohérent avec le modèle d'authentification
// actuel de l'application (voir auth.jsx).
export async function saveEmployee(input, meta = {}) {
  const record = buildEmployee(input);
  const utilisateur = meta.utilisateur || '';
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      if (record.id) {
        const e = s.employees.find((x) => x.id === record.id);
        if (!e) throw new Error('errors.notFound');
        const avant = JSON.parse(JSON.stringify(e));
        Object.assign(e, record);
        pushAuditEntry(s, {
          employeeId: record.id, employeeNom: record.nom, utilisateur,
          action: 'update', avant, apres: JSON.parse(JSON.stringify(e))
        });
        return record.id;
      }
      const id = uid();
      const created = { ...record, id, createdAt: new Date().toISOString() };
      s.employees.push(created);
      pushAuditEntry(s, {
        employeeId: id, employeeNom: record.nom, utilisateur,
        action: 'create', avant: null, apres: JSON.parse(JSON.stringify(created))
      });
      return id;
    });
  }
  const avant = record.id ? state.employees.find((e) => e.id === record.id) || null : null;
  const { data, error } = await supabase.rpc('save_employee', { p: record });
  if (error) throw rpcError(error);
  await refresh();
  const apres = state.employees.find((e) => e.id === data) || null;
  // L'historique est un « bonus » de traçabilité : une erreur ici (ex. table
  // pas encore migrée) ne doit jamais faire échouer l'enregistrement réel,
  // déjà effectué avec succès à ce stade.
  try {
    await supabase.from('audit_log').insert({
      employee_id: data, employee_nom: record.nom, utilisateur,
      action: avant ? 'update' : 'create', avant, apres
    });
    await refresh();
  } catch {
    /* best-effort */
  }
  return data;
}

export async function deleteEmployee(id, meta = {}) {
  const utilisateur = meta.utilisateur || '';
  if (demoMode || !supabaseConfigured) {
    return memMutate((s) => {
      const e = s.employees.find((x) => x.id === id);
      s.employees = s.employees.filter((x) => x.id !== id);
      // Mode Supabase : ON DELETE CASCADE côté base (voir migration_conges_pris.sql).
      // En local/démo, il faut nettoyer nous-mêmes l'état en mémoire.
      s.congesPris = (s.congesPris || []).filter((c) => c.employeeId !== id);
      s.cyclesCongesClotures = (s.cyclesCongesClotures || []).filter((c) => c.employeeId !== id);
      if (e) {
        pushAuditEntry(s, {
          employeeId: id, employeeNom: e.nom, utilisateur,
          action: 'delete', avant: JSON.parse(JSON.stringify(e)), apres: null
        });
      }
    });
  }
  const avant = state.employees.find((e) => e.id === id) || null;
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw rpcError(error);
  await refresh();
  try {
    await supabase.from('audit_log').insert({
      employee_id: id, employee_nom: avant?.nom || '', utilisateur, action: 'delete', avant, apres: null
    });
    await refresh();
  } catch {
    /* best-effort */
  }
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
  s.settings.rccm = 'CI-ABJ-2019-B-12345';
  s.settings.compteContribuable = '1234567 X';
  s.settings.activite = 'Boulangerie-pâtisserie';
  s.settings.adresse = 'Cocody, Abidjan';

  s.employees.push({
    id: uid(),
    matricule: 'SAL-001',
    nom: 'KOUAMÉ Adjoua Sylvie',
    situation: 'marie',
    enfants: 2,
    cnps: '9988776 C',
    emploi: 'Vendeuse',
    categorie: 'Catégorie 3B',
    expatrie: false,
    dateEmbauche: '2023-01-01',
    salaireCategoriel: 120000,
    periodes: [
      { id: uid(), kind: 'cdd', label: 'CDD initial', debut: '2023-01', fin: '2023-06',
        salaireBase: 120000, netCible: 150000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 1', debut: '2023-07', fin: '2023-12',
        salaireBase: 130000, netCible: 165000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 15000, imposable: true }], retenues: [], heuresSupplementaires: [] },
      { id: uid(), kind: 'cdi', label: 'CDI', debut: '2024-01', fin: null,
        salaireBase: 150000, netCible: 190000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 20000, imposable: true }],
        // Avance ponctuelle : le mois précisé évite qu'elle ne se répète sur
        // tous les mois (à durée indéterminée) de ce CDI toujours en cours.
        retenues: [{ label: 'Avance sur salaire', montant: 10000, mois: '2024-01' }],
        heuresSupplementaires: [] }
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
    categorie: 'Catégorie 2A',
    expatrie: false,
    dateEmbauche: '2022-02-01',
    salaireCategoriel: 100000,
    periodes: [
      { id: uid(), kind: 'cdd', label: 'CDD initial', debut: '2022-02', fin: '2022-07',
        salaireBase: 100000, netCible: 130000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 1', debut: '2022-08', fin: '2023-07',
        salaireBase: 105000, netCible: 140000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] },
      { id: uid(), kind: 'cdd', label: 'Renouvellement 2', debut: '2023-08', fin: null,
        salaireBase: 110000, netCible: 150000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] }
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
    categorie: 'Agent de maîtrise',
    expatrie: false,
    dateEmbauche: '2020-03-01',
    salaireCategoriel: 250000,
    periodes: [
      { id: uid(), kind: 'cdi', label: 'CDI', debut: '2020-03', fin: null,
        salaireBase: 300000, netCible: 420000, transport: 40000,
        primes: [{ label: 'Prime de responsabilité', montant: 50000, imposable: true }], retenues: [],
        // Heures sup ponctuelles (mois précisé, ne se répètent pas).
        heuresSupplementaires: [{ heures: 6, majoration: 0.15, mois: '2025-01' }] }
    ],
    createdAt: new Date().toISOString()
  });
}
