// ---------------------------------------------------------------------------
// Moteur de RÈGLES D'IMPUTATION.
//
// Chaque transaction Wave doit être rattachée à un compte général SYSCOHADA.
// Le rattachement suit une cascade de priorités :
//   1. Mapping mémorisé par contrepartie (le comptable a déjà tranché) ;
//   2. Règles par mots-clés (motif + contrepartie), de la plus spécifique à la
//      plus générale ;
//   3. Compte par défaut (charge ou produit) — ligne signalée « à vérifier ».
//
// Les règles sont ÉDITABLES et stockées en base ; celles ci-dessous ne sont que
// le jeu de départ, calé sur le plan SYSCOHADA révisé fourni.
// ---------------------------------------------------------------------------

import { normaliserCompte } from '../data/planComptable';

// Paramètres comptables par défaut (surchargés depuis la base / l'écran
// « Paramètres »). Le compte Wave est un instrument de monnaie électronique.
// Numéros de compte sur 8 CHIFFRES : format de la base comptable réelle (SAGE),
// où le compte SYSCOHADA à 6 chiffres est complété par « 00 ».
export const PARAMETRES_DEFAUT = {
  journal: 'CAI', // code du journal SAGE de destination : JOURNAL CAISSE
  intituleJournal: 'JOURNAL CAISSE',
  compteTresorerie: '57100000', // Caisse — compte de trésorerie du journal CAI
  compteFrais: '63170000', // Frais sur instruments de monnaie électronique
  compteChargeDefaut: '60580000', // Achats de travaux, matériels et équipements
  compteProduitDefaut: '70610000', // Services vendus dans la région
  compteContrepartieDefaut: '47110000' // Débiteurs divers (encaissements à ventiler)
};

// sens : 'sortie' (paiement, montant < 0), 'entree' (encaissement, montant > 0)
// ou 'tous'. motsCles : liste de termes ; la règle s'applique si l'un d'eux
// apparaît dans le texte normalisé (motif + contrepartie). priorite : plus
// petit = évalué en premier. Les comptes sont écrits ici à 6 chiffres (lisible)
// puis normalisés en 8 chiffres au chargement (voir REGLES_DEFAUT plus bas).
const REGLES_BRUTES = [
  // --- Carburant & énergie ---
  { priorite: 10, sens: 'sortie', motsCles: ['carburant', 'essence', 'gasoil', 'gazole', 'fuel'], compte: '605300', libelle: 'Carburant (autres énergies)' },
  { priorite: 12, sens: 'sortie', motsCles: ['electricite', 'cie', 'courant'], compte: '605200', libelle: 'Électricité' },
  { priorite: 12, sens: 'sortie', motsCles: ['eau', 'sodeci'], compte: '605100', libelle: 'Eau' },

  // --- Entretien / réparation véhicules & moto ---
  { priorite: 15, sens: 'sortie', motsCles: ['vidange', 'pneu', 'reparation moteur', 'moteur', 'reparation moto', 'reparation'], compte: '624200', libelle: 'Entretien et réparation biens mobiliers' },
  { priorite: 16, sens: 'sortie', motsCles: ['maintenance'], compte: '624300', libelle: 'Maintenance' },

  // --- Hygiène / dératisation / nettoyage ---
  { priorite: 18, sens: 'sortie', motsCles: ['dera', 'desinsect', 'desinfect', 'deratisation', 'serpent', 'nuisible', 'fumigation'], compte: '624330', libelle: 'Hygiène et services assimilés' },
  { priorite: 19, sens: 'sortie', motsCles: ['nettoyage', 'menage', 'entretien general', 'entretien generale', 'entretien locaux'], compte: '624330', libelle: 'Nettoyage / hygiène' },
  { priorite: 20, sens: 'sortie', motsCles: ['produit entretien', 'produits entretien', 'produits d entretien'], compte: '604300', libelle: "Produits d'entretien" },

  // --- Espaces verts ---
  { priorite: 22, sens: 'sortie', motsCles: ['jardinier', 'jardin', 'espace vert', 'espaces verts', 'gazon'], compte: '624800', libelle: 'Entretien espaces verts' },

  // --- Bâtiment / plomberie / échafaudage ---
  { priorite: 24, sens: 'sortie', motsCles: ['plombier', 'plomberie', 'macon', 'peinture', 'batiment'], compte: '624100', libelle: 'Entretien et réparation biens immobiliers' },
  { priorite: 25, sens: 'sortie', motsCles: ['echafaudage', 'location materiel', 'location outillage'], compte: '622300', libelle: 'Location de matériel et outillages' },
  { priorite: 26, sens: 'sortie', motsCles: ['loyer', 'location batiment', 'bail'], compte: '622200', libelle: 'Location de bâtiment' },

  // --- Transport / déplacements ---
  { priorite: 28, sens: 'sortie', motsCles: ['transport'], compte: '614000', libelle: 'Transports du personnel' },
  { priorite: 29, sens: 'sortie', motsCles: ['deplacement', 'voyage', 'mission', 'peage'], compte: '618100', libelle: 'Voyages et déplacements' },

  // --- Télécommunications ---
  { priorite: 30, sens: 'sortie', motsCles: ['telephone', 'recharge', 'forfait', 'credit tel', 'unites', 'connexion', 'internet'], compte: '628100', libelle: 'Frais de téléphone / télécom' },

  // --- Personnel : primes, salaires, avances ---
  { priorite: 32, sens: 'sortie', motsCles: ['prime', 'gratification', 'bonus'], compte: '661200', libelle: 'Primes et gratifications' },
  { priorite: 33, sens: 'sortie', motsCles: ['salaire', 'appointement', 'paie', 'paye'], compte: '661100', libelle: 'Appointements et salaires' },
  { priorite: 34, sens: 'sortie', motsCles: ['avance', 'acompte', 'remboursement avance'], compte: '421000', libelle: 'Personnel — avances et acomptes' },

  // --- Main d'œuvre de chantier (travailleurs journaliers / intérim) ---
  { priorite: 36, sens: 'sortie', motsCles: ['fin de chantier', 'chantier', 'main d oeuvre', 'main d’oeuvre', 'manoeuvre', 'ouvrier', 'journalier'], compte: '637100', libelle: 'Personnel intérimaire (chantier)' },

  // --- Commissions ---
  { priorite: 38, sens: 'sortie', motsCles: ['commission', 'courtage', 'com'], compte: '632200', libelle: 'Commissions et courtages sur ventes' },

  // --- Tenues / vêtements de travail ---
  { priorite: 40, sens: 'sortie', motsCles: ['tenue', 'tenues', 'uniforme', 'vetement'], compte: '605600', libelle: 'Petit matériel / tenues' },

  // --- Achats de matériel & fournitures ---
  { priorite: 42, sens: 'sortie', motsCles: ['petit materiel', 'outillage'], compte: '605600', libelle: 'Petit matériel et outillage' },
  { priorite: 44, sens: 'sortie', motsCles: ['fourniture bureau', 'fournitures bureau'], compte: '605500', libelle: 'Fournitures de bureau' },
  { priorite: 46, sens: 'sortie', motsCles: ['achat produit', 'achat de produits', 'produits', 'materiel', 'materiaux', 'achat'], compte: '605800', libelle: 'Achats travaux / matériels / équipements' },

  // --- Encaissements (merchant_payment) ---
  { priorite: 60, sens: 'entree', motsCles: ['vente', 'marchandise'], compte: '701100', libelle: 'Ventes de marchandises' },
  { priorite: 62, sens: 'entree', motsCles: ['travaux', 'facture'], compte: '705100', libelle: 'Travaux facturés' }
];

// Jeu de règles par défaut, comptes normalisés au format 8 chiffres réel.
export const REGLES_DEFAUT = REGLES_BRUTES.map((r) => ({
  ...r,
  compte: normaliserCompte(r.compte)
}));

// Normalise un texte pour l'appariement : minuscules, sans accents.
export function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Échappe les caractères spéciaux d'expression régulière.
function echapper(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Vrai si le mot-clé apparaît comme MOT ENTIER dans le texte (déjà normalisés).
// On borne par des frontières de mot pour éviter les faux positifs :
// « eau » ne doit PAS matcher « plateau », « com » ne doit pas matcher
// « complementaire », etc.
export function contientMot(texte, mot) {
  if (!mot) return false;
  return new RegExp(`(?:^|[^a-z0-9])${echapper(mot)}(?:[^a-z0-9]|$)`).test(texte);
}

// Mots vides ignorés lors du rapprochement par libellé du plan comptable.
const MOTS_VIDES = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'un', 'une', 'et', 'ou', 'au', 'aux', 'en',
  'pour', 'par', 'sur', 'sous', 'avec', 'dans', 'ce', 'cette', 'son', 'sa', 'ses',
  'leur', 'nos', 'vos', 'plus', 'the', 'a', 'l', 'd', 'to', 'si', 'ne', 'pr'
]);

// Découpe un texte normalisé en mots significatifs (>= 3 lettres, hors mots
// vides et nombres).
export function motsSignificatifs(texte) {
  return normaliser(texte)
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m) && !/^\d+$/.test(m));
}

// Imputation par LIBELLÉ du plan comptable : cherche le compte dont l'intitulé
// partage le plus de mots significatifs avec la Raison du paiement. Les
// candidats sont restreints à la bonne classe (6 = charges, 7 = produits).
// Renvoie un numéro de compte ou null. C'est une PROPOSITION (à vérifier).
export function imputerParLibelle(motif, plan, sens) {
  const mots = motsSignificatifs(motif);
  if (!mots.length || !Array.isArray(plan) || !plan.length) return null;
  const classe = sens === 'entree' ? '7' : '6';
  let best = null;
  for (const cpt of plan) {
    if (!cpt.compte || cpt.compte[0] !== classe) continue;
    const motsLib = new Set(motsSignificatifs(cpt.intitule));
    if (!motsLib.size) continue;
    let score = 0;
    for (const m of mots) if (motsLib.has(m)) score += 1;
    if (score === 0) continue;
    const cand = { compte: cpt.compte, score, taille: motsLib.size };
    if (
      !best ||
      cand.score > best.score ||
      (cand.score === best.score && cand.taille < best.taille) ||
      (cand.score === best.score && cand.taille === best.taille && cand.compte < best.compte)
    ) {
      best = cand;
    }
  }
  return best ? best.compte : null;
}

// Sens comptable d'une transaction d'après son montant / son type.
//   'sortie'  : paiement (montant < 0)
//   'entree'  : encaissement (montant > 0)
//   'contrepassation' : annulation (type *_reversal)
export function sensTransaction(tx) {
  if (/reversal|annulation|refund|remboursement wave/i.test(tx.type || '')) {
    return 'contrepassation';
  }
  return Number(tx.montant) < 0 ? 'sortie' : 'entree';
}

// Choisit le compte de contrepartie (charge ou produit) pour une transaction.
// Renvoie { compte, libelle, source, regle }.
//   source : 'contrepartie' | 'regle' | 'defaut'
export function imputerCompte(tx, options = {}) {
  const params = { ...PARAMETRES_DEFAUT, ...(options.parametres || {}) };
  const regles = options.regles && options.regles.length ? options.regles : REGLES_DEFAUT;
  const mappings = options.mappingsContrepartie || {}; // { contrepartieNormalisee: compte }

  const sensBrut = sensTransaction(tx);
  // La contrepassation impute comme la charge d'origine (sens « sortie »).
  const sens = sensBrut === 'contrepassation' ? 'sortie' : sensBrut;

  // L'imputation est pilotée par la RAISON DU PAIEMENT (motif Wave) uniquement.
  // Le nom de la contrepartie n'entre PAS dans le rapprochement par mots-clés
  // (il déclencherait de faux positifs) ; il ne sert que via le mapping
  // mémorisé, en repli, quand le motif ne permet pas de classer.
  const texteMotif = normaliser(tx.motif);
  const cleContrepartie = normaliser(tx.contrepartie);

  // 1) Règles par mots-clés appliquées à la Raison du paiement.
  if (texteMotif) {
    const applicables = [...regles]
      .filter((r) => r.actif !== false && (r.sens === 'tous' || r.sens === sens))
      .sort((a, b) => (a.priorite ?? 999) - (b.priorite ?? 999));

    for (const r of applicables) {
      const mots = (r.motsCles || []).map(normaliser).filter(Boolean);
      if (mots.some((m) => contientMot(texteMotif, m))) {
        return { compte: r.compte, libelle: r.libelle || '', source: 'regle', regle: r };
      }
    }
  }

  // 2) Rapprochement par LIBELLÉ du plan comptable (proposition à vérifier) :
  //    on cherche le compte dont l'intitulé colle le mieux à la Raison du
  //    paiement. Ne s'applique que si un plan est fourni.
  if (texteMotif && options.plan && options.plan.length) {
    const compteLib = imputerParLibelle(tx.motif, options.plan, sens);
    if (compteLib) {
      return { compte: compteLib, libelle: '', source: 'plan', regle: null };
    }
  }

  // 3) Repli : compte mémorisé pour cette contrepartie (décision déjà prise),
  //    utilisé seulement quand la Raison du paiement ne classe pas la ligne.
  if (cleContrepartie && mappings[cleContrepartie]) {
    return {
      compte: mappings[cleContrepartie],
      libelle: tx.contrepartie,
      source: 'contrepartie',
      regle: null
    };
  }

  // 4) Compte par défaut selon le sens — à vérifier par le comptable.
  const compte = sens === 'entree' ? params.compteProduitDefaut : params.compteChargeDefaut;
  return { compte, libelle: '', source: 'defaut', regle: null };
}
