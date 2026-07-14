// ---------------------------------------------------------------------------
// Couche de données — PaieCI.
//
// Persistance LOCALE (localStorage) reproduisant les garanties du schéma
// PostgreSQL cible (voir supabase/schema.sql pour la migration). L'application
// est donc pleinement fonctionnelle hors-ligne, sans compte ni backend : idéal
// pour un cabinet comptable ou une PME qui gère la paie de ses salariés.
//
// Domaine :
//   - settings  : profil employeur + paramètres de paie modifiables
//                 (taux d'accident du travail, plafond transport exonéré…).
//   - employees : salariés, chacun avec une ou plusieurs PÉRIODES
//                 contractuelles (CDD initial, renouvellements, passage CDI),
//                 chaque période portant son salaire de base, son NET cible et
//                 d'éventuelles primes.
// ---------------------------------------------------------------------------

import { roundFCFA } from './money';
import { DEFAULT_PARAMS } from './payroll';

const STATE_KEY = 'gpaie-state';

export const SITUATIONS = ['celibataire', 'marie', 'divorce', 'veuf'];
export const TYPES_CONTRAT = ['cdd', 'cdi'];

// --------------------------- Cache & abonnement ----------------------------

let state = loadState();
const listeners = new Set();
const statusSnapshot = { status: 'ready', error: null };

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
    // Paramètres de paie modifiables (les autres taux légaux restent figés
    // dans payroll.js — DEFAULT_PARAMS).
    tauxAccidentTravail: DEFAULT_PARAMS.cnpsAccidentTravail,
    transportExonere: DEFAULT_PARAMS.transportExonere
  };
}

function emptyState() {
  return { settings: defaultSettings(), employees: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.employees)) {
        return { settings: { ...defaultSettings(), ...parsed.settings }, employees: parsed.employees };
      }
    }
  } catch {
    /* quota / mode privé : on repart d'un état neuf en mémoire */
  }
  const seeded = emptyState();
  seedDemo(seeded);
  return seeded;
}

function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
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

// Les pages appellent ensureHydrated() : ici tout est déjà en mémoire.
export function ensureHydrated() {
  return Promise.resolve();
}

// Transaction locale : fn reçoit une copie profonde ; en cas d'exception,
// l'état courant reste intact (aucune écriture partielle).
function mutate(fn) {
  const draft = JSON.parse(JSON.stringify(state));
  const result = fn(draft);
  state = draft;
  persist();
  notify();
  return result;
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

export function saveSettings(patch) {
  return mutate((s) => {
    s.settings = { ...s.settings, ...patch };
  });
}

// --------------------------- Normalisation période ------------------------

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
    fin: p.kind === 'cdi' ? null : p.fin || null,
    salaireBase: roundFCFA(p.salaireBase),
    netCible: roundFCFA(p.netCible),
    transport: roundFCFA(p.transport ?? 0),
    primes: normPrimes(p.primes)
  };
}

// --------------------------- Salariés (CRUD) -------------------------------

export function saveEmployee(input) {
  if (!input.nom?.trim()) throw new Error('errors.nameRequired');
  const periodes = (input.periodes || []).map(normPeriode).filter((p) => p.debut);
  if (periodes.length === 0) throw new Error('errors.noPeriod');

  return mutate((s) => {
    const record = {
      matricule: input.matricule?.trim() || '',
      nom: input.nom.trim(),
      situation: SITUATIONS.includes(input.situation) ? input.situation : 'celibataire',
      enfants: Math.max(0, Math.floor(Number(input.enfants) || 0)),
      cnps: input.cnps?.trim() || '',
      emploi: input.emploi?.trim() || '',
      dateEmbauche: input.dateEmbauche || periodes[0].debut + '-01',
      // Salaire catégoriel (minimum conventionnel) servant d'assiette à la prime
      // d'ancienneté ; par défaut le salaire de base de la première période.
      salaireCategoriel: roundFCFA(input.salaireCategoriel || periodes[0].salaireBase),
      periodes
    };
    if (input.id) {
      const e = s.employees.find((x) => x.id === input.id);
      if (!e) throw new Error('errors.notFound');
      Object.assign(e, record);
      return input.id;
    }
    const id = uid();
    s.employees.push({ id, ...record, createdAt: new Date().toISOString() });
    return id;
  });
}

export function deleteEmployee(id) {
  return mutate((s) => {
    s.employees = s.employees.filter((e) => e.id !== id);
  });
}

export function getEmployee(id) {
  return state.employees.find((e) => e.id === id) || null;
}

// --------------------------- Données d'exemple -----------------------------
// Deux profils représentatifs pour que l'application soit immédiatement
// parlante : un CDD renouvelé deux fois puis passé en CDI, et un cadre marié
// avec enfants directement en CDI.

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
    dateEmbauche: '2023-01-01',
    salaireCategoriel: 120000,
    periodes: [
      {
        id: uid(), kind: 'cdd', label: 'CDD initial', debut: '2023-01', fin: '2023-06',
        salaireBase: 120000, netCible: 150000, transport: 30000, primes: []
      },
      {
        id: uid(), kind: 'cdd', label: 'Renouvellement 1', debut: '2023-07', fin: '2023-12',
        salaireBase: 130000, netCible: 165000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 15000, imposable: true }]
      },
      {
        id: uid(), kind: 'cdi', label: 'CDI', debut: '2024-01', fin: null,
        salaireBase: 150000, netCible: 190000, transport: 30000,
        primes: [{ label: 'Prime de rendement', montant: 20000, imposable: true }]
      }
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
    dateEmbauche: '2020-03-01',
    salaireCategoriel: 250000,
    periodes: [
      {
        id: uid(), kind: 'cdi', label: 'CDI', debut: '2020-03', fin: null,
        salaireBase: 300000, netCible: 420000, transport: 40000,
        primes: [{ label: 'Prime de responsabilité', montant: 50000, imposable: true }]
      }
    ],
    createdAt: new Date().toISOString()
  });
}

// Réinitialise entièrement les données de démonstration (bouton Paramètres).
export function resetDemoData() {
  const fresh = emptyState();
  seedDemo(fresh);
  state = fresh;
  persist();
  notify();
}
