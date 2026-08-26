// ===========================================================================
// MOTEUR DE PAIE — Côte d'Ivoire
// ---------------------------------------------------------------------------
// Ce module implémente, de façon isolée et testable, l'ensemble des règles de
// calcul décrites dans le cahier « RÉSUMÉ PAIE » :
//
//   1. Salaire de base .............. saisi manuellement
//   2. Sursalaire ................... calculé automatiquement pour atteindre
//                                     un salaire NET cible (résolution inverse)
//   3. Prime d'ancienneté ........... barème 2 % à 25 % sur le salaire
//                                     catégoriel (minimum conventionnel)
//   4. Impôt brut avant RICF ........ barème progressif ITS par tranches
//   5. RICF ......................... réduction pour charges de famille (parts)
//   6. Cotisations CNPS / CMU ....... salariales et patronales
//
// Toutes les valeurs monétaires sont en FCFA entiers. Les taux et plafonds
// sont regroupés dans DEFAULT_PARAMS pour rester paramétrables (une convention
// collective ou un taux d'accident du travail notifié par la CNPS peut varier
// d'une entreprise à l'autre).
// ===========================================================================

import { roundFCFA } from './money';

// --------------------------- Paramètres légaux -----------------------------

export const DEFAULT_PARAMS = {
  // Plafond mensuel de l'assiette RETRAITE CNPS : 45 × SMIG (75 000) =
  // 3 375 000 FCFA. Au-delà, l'assiette de la retraite est écrêtée.
  plafondCnps: 3375000,
  // Plafond mensuel de l'assiette PRESTATIONS FAMILIALES & ACCIDENT DU TRAVAIL :
  // 70 000 à 75 000 FCFA/mois selon les textes (le bulletin de référence
  // applique 75 000). Distinct du plafond retraite.
  plafondPfAt: 75000,

  // Cotisations salariales.
  cnpsRetraiteSalarie: 0.063, // 6,3 % (assiette plafonnée à plafondCnps)
  // CMU (Couverture Maladie Universelle, loi n°2014-131) : cotisation
  // FORFAITAIRE de 1 000 FCFA/mois PAR PERSONNE couverte (500 salarié + 500
  // employeur), et non un pourcentage du salaire. Le salarié lui-même compte
  // toujours pour une personne ; ses enfants à charge (voir `enfants`,
  // déjà saisi pour le calcul de l'IGR/RICF) s'ajoutent comme bénéficiaires
  // supplémentaires — voir `cmuNombrePersonnes` ci-dessous.
  cmuSalarie: 500,

  // Cotisations patronales (coût employeur).
  // Prestations familiales 5 % + assurance maternité 0,75 % = 5,75 %,
  // sur l'assiette plafonnée à plafondPfAt.
  cnpsPrestationsFamiliales: 0.0575,
  // Accident du travail : 2 % à 5 % selon le risque notifié par la CNPS,
  // sur l'assiette plafonnée à plafondPfAt.
  cnpsAccidentTravail: 0.05,
  cnpsRetraitePatronale: 0.077, // 7,7 % (assiette plafonnée à plafondCnps)
  taxeApprentissage: 0.004, // 0,4 % (FDFP)
  fpc: 0.006, // 0,6 % — quote-part mensuelle de la Taxe FPC (FDFP)
  isLocal: 0.012, // 1,2 % — Impôt sur salaires, part patronale (locaux)
  isExpatrie: 0.115, // 11,5 % — Impôt sur salaires, part patronale (expatriés)
  cmuPatronale: 500, // part employeur CMU (500 FCFA / personne couverte)

  // Prime de transport : exonérée jusqu'à 30 000 FCFA ; l'excédent est
  // imposable ET soumis à cotisations.
  transportExonere: 30000,

  // Barème progressif mensuel de l'ITS (Impôt sur Traitements et Salaires),
  // appliqué au salaire brut imposable.
  tranchesITS: [
    { plafond: 75000, taux: 0 },
    { plafond: 240000, taux: 0.16 },
    { plafond: 800000, taux: 0.21 },
    { plafond: 2400000, taux: 0.24 },
    { plafond: 8000000, taux: 0.28 },
    { plafond: Infinity, taux: 0.32 }
  ]
};

// --------------------------- Ancienneté ------------------------------------

// Nombre d'années entières de service entre deux dates ISO (aaaa-mm-jj).
export function anneesAnciennete(dateEmbauche, dateReference) {
  if (!dateEmbauche || !dateReference) return 0;
  const d0 = new Date(dateEmbauche);
  const d1 = new Date(dateReference);
  if (Number.isNaN(d0) || Number.isNaN(d1) || d1 < d0) return 0;
  let ans = d1.getFullYear() - d0.getFullYear();
  const m = d1.getMonth() - d0.getMonth();
  if (m < 0 || (m === 0 && d1.getDate() < d0.getDate())) ans -= 1;
  return Math.max(0, ans);
}

// Barème d'ancienneté : 0 % avant 2 ans, 2 % à la 2ᵉ année, puis +1 % par
// année, plafonné à 25 % à partir de la 25ᵉ année.
export function tauxAnciennete(annees) {
  if (annees < 2) return 0;
  return Math.min(annees, 25) / 100;
}

// --------------------------- Parts IGR & RICF ------------------------------

// Nombre de parts (quotient familial IGR) selon la situation matrimoniale et
// le nombre d'enfants à charge, conformément au barème du cahier :
//   - Marié(e) : 2 parts + 0,5 par enfant.
//   - Célibataire / divorcé(e) / veuf(ve) : 1 part sans enfant ; dès le 1ᵉʳ
//     enfant, 2 parts puis +0,5 par enfant supplémentaire.
// Plafonné à 5 parts (marié 6 enfants et plus).
export function nombreParts(situation, enfants) {
  const n = Math.max(0, Math.floor(Number(enfants) || 0));
  const marie = situation === 'marie';
  let parts;
  if (marie) {
    parts = 2 + 0.5 * n;
  } else {
    parts = n === 0 ? 1 : 1.5 + 0.5 * n;
  }
  return Math.min(parts, 5);
}

// Réduction d'Impôt pour Charges de Famille : 11 000 FCFA par demi-part
// au-delà de la première part (0 pour 1 part, 11 000 pour 2 parts, etc.).
export function ricf(situation, enfants) {
  const parts = nombreParts(situation, enfants);
  return roundFCFA(Math.max(0, parts - 1) * 11000);
}

// --------------------------- Impôt (ITS) -----------------------------------

// Impôt brut avant RICF : barème progressif appliqué par tranches au salaire
// brut imposable.
export function impotBrut(brutImposable, params = DEFAULT_PARAMS) {
  let base = Math.max(0, roundFCFA(brutImposable));
  let impot = 0;
  let bas = 0;
  for (const tr of params.tranchesITS) {
    if (base <= bas) break;
    const hauteur = Math.min(base, tr.plafond) - bas;
    if (hauteur > 0) impot += hauteur * tr.taux;
    bas = tr.plafond;
  }
  return roundFCFA(impot);
}

// ITS = Impôt brut − RICF, jamais négatif.
export function its(brutImposable, situation, enfants, params = DEFAULT_PARAMS) {
  return Math.max(0, roundFCFA(impotBrut(brutImposable, params) - ricf(situation, enfants)));
}

// --------------------------- Heures supplémentaires -------------------------

// Durée légale mensuelle de référence : 40 h/semaine × 52 semaines / 12 mois,
// utilisée pour convertir le salaire de base en taux horaire (Décret
// n° 96-203 du 7 mars 1996 relatif à la durée du travail).
export const HEURES_LEGALES_MOIS = 173.33;

// Majorations légales minimales des heures supplémentaires (Art. 21.2 du Code
// du travail) : 15 % de la 41ᵉ à la 46ᵉ heure hebdomadaire, 50 % au-delà,
// 75 % de jour un dimanche/jour férié ou de nuit un jour ouvrable, 100 % de
// nuit un dimanche/jour férié.
export const MAJORATIONS_HEURES_SUP = [
  { valeur: 0.15, label: '+15 % (41ᵉ à 46ᵉ heure)' },
  { valeur: 0.5, label: '+50 % (au-delà de la 46ᵉ heure)' },
  { valeur: 0.75, label: '+75 % (nuit, ou jour un dimanche/férié)' },
  { valeur: 1, label: '+100 % (nuit un dimanche/férié)' }
];

// Détaille chaque ligne d'heures supplémentaires avec son montant, à partir
// du taux horaire du salaire de base (imposable et cotisable au même titre
// que le salaire normal — aucune exonération spécifique en droit ivoirien).
export function detailHeuresSup(salaireBase, heuresSup) {
  const tauxHoraire = roundFCFA(salaireBase) / HEURES_LEGALES_MOIS;
  return (Array.isArray(heuresSup) ? heuresSup : []).map((h) => {
    const heures = Math.max(0, Number(h.heures) || 0);
    const majoration = Math.max(0, Number(h.majoration) || 0);
    return { heures, majoration, tauxHoraire, montant: roundFCFA(tauxHoraire * heures * (1 + majoration)) };
  });
}

// --------------------------- CMU (Couverture Maladie Universelle) ----------

// Nombre de personnes couvertes par la CMU pour ce salarié : lui-même
// (toujours 1) + ses enfants à charge. La cotisation forfaitaire de 1 000
// FCFA (500 salarié + 500 employeur) s'applique PAR PERSONNE, pas par
// salarié — voir cmuSalarie/cmuPatronale dans DEFAULT_PARAMS.
export function cmuNombrePersonnes(enfants) {
  return 1 + Math.max(0, Math.floor(Number(enfants) || 0));
}

// --------------------------- Calcul complet d'un bulletin ------------------

// Détaille l'intégralité d'un bulletin à partir des rubriques de gain.
// `input` :
//   salaireBase, sursalaire, salaireCategoriel (défaut = salaireBase),
//   transport, primes: [{ label, montant, imposable }],
//   heuresSupplementaires: [{ heures, majoration }],
//   situation, enfants, anciennete (années)
export function calculerBulletin(input, params = DEFAULT_PARAMS) {
  const salaireBase = roundFCFA(input.salaireBase);
  const sursalaire = roundFCFA(input.sursalaire);
  const salaireCategoriel = roundFCFA(input.salaireCategoriel ?? input.salaireBase);
  const transport = roundFCFA(input.transport ?? 0);
  const primes = Array.isArray(input.primes) ? input.primes : [];
  // Indemnité de congé payé (versée au mois anniversaire) : imposable et
  // cotisable, ajoutée au brut en sus du salaire.
  const congePaye = roundFCFA(input.congePaye ?? 0);
  const congeJours = Number(input.congeJours) || 0;

  // Heures supplémentaires : entièrement imposables et cotisables, comme le
  // salaire de base (aucun régime d'exonération spécifique en Côte d'Ivoire).
  const heuresSupDetail = detailHeuresSup(salaireBase, input.heuresSupplementaires);
  const heuresSupMontant = roundFCFA(heuresSupDetail.reduce((s, h) => s + h.montant, 0));

  // 3. Prime d'ancienneté sur le salaire catégoriel (minimum conventionnel).
  const taux = tauxAnciennete(Number(input.anciennete) || 0);
  const primeAnciennete = roundFCFA(salaireCategoriel * taux);

  // Prime de transport : part exonérée (≤ 30 000) et part imposable (excédent).
  const transportExonere = Math.min(transport, params.transportExonere);
  const transportImposable = Math.max(0, transport - params.transportExonere);

  // Autres primes : réparties selon leur caractère imposable.
  let autresPrimesImposables = 0;
  let autresPrimesExonerees = 0;
  for (const p of primes) {
    const montant = roundFCFA(p.montant);
    if (p.imposable === false) autresPrimesExonerees += montant;
    else autresPrimesImposables += montant;
  }

  // Salaire brut imposable (assiette de l'ITS).
  const brutImposable = roundFCFA(
    salaireBase + sursalaire + primeAnciennete + transportImposable + autresPrimesImposables
      + congePaye + heuresSupMontant
  );

  // Salaire brut total (avant retenues) — inclut les éléments exonérés.
  const brutTotal = roundFCFA(brutImposable + transportExonere + autresPrimesExonerees);

  // Assiette RETRAITE CNPS = brut imposable, écrêté au plafond retraite.
  const baseCotisable = Math.min(brutImposable, params.plafondCnps);
  // Assiette PRESTATIONS FAMILIALES / ACCIDENT DU TRAVAIL = brut imposable,
  // écrêté au plafond PF/AT (bien plus bas : 75 000).
  const basePfAt = Math.min(brutImposable, params.plafondPfAt);

  // 6. Retenues salariales.
  const cnpsRetraite = roundFCFA(baseCotisable * params.cnpsRetraiteSalarie);
  // CMU : forfait par personne couverte (salarié + enfants à charge), pas un
  // montant fixe par salarié — voir cmuNombrePersonnes ci-dessus.
  const cmuPersonnes = cmuNombrePersonnes(input.enfants);
  const cmu = roundFCFA(params.cmuSalarie * cmuPersonnes);

  // 4-5. Impôt sur salaire.
  const impotBrutAvantRicf = impotBrut(brutImposable, params);
  const reductionRicf = ricf(input.situation, input.enfants);
  const impotNet = Math.max(0, roundFCFA(impotBrutAvantRicf - reductionRicf));

  const totalRetenues = roundFCFA(cnpsRetraite + cmu + impotNet);
  const netAPayer = roundFCFA(brutTotal - totalRetenues);
  // « Net imposable » tel qu'il figure sur le bulletin de référence.
  const netImposable = roundFCFA(brutTotal - impotNet - cmu);

  // Charges patronales (coût employeur), chacune sur son assiette propre.
  const isExpatrie = input.expatrie === true;
  const patronal = {
    retraite: roundFCFA(baseCotisable * params.cnpsRetraitePatronale),
    prestationsFamiliales: roundFCFA(basePfAt * params.cnpsPrestationsFamiliales),
    accidentTravail: roundFCFA(basePfAt * params.cnpsAccidentTravail),
    isLocal: roundFCFA(brutImposable * params.isLocal),
    isExpatrie: isExpatrie ? roundFCFA(brutImposable * params.isExpatrie) : 0,
    taxeApprentissage: roundFCFA(brutImposable * params.taxeApprentissage),
    fpc: roundFCFA(brutImposable * params.fpc),
    cmu: roundFCFA(params.cmuPatronale * cmuPersonnes)
  };
  const totalPatronal = roundFCFA(Object.values(patronal).reduce((a, b) => a + b, 0));
  const coutTotalEmployeur = roundFCFA(brutTotal + totalPatronal);

  return {
    salaireBase,
    sursalaire,
    salaireCategoriel,
    tauxAnciennete: taux,
    primeAnciennete,
    transport,
    transportExonere,
    transportImposable,
    autresPrimesImposables,
    autresPrimesExonerees,
    primes,
    congePaye,
    congeJours,
    heuresSupDetail,
    heuresSupMontant,
    brutImposable,
    brutTotal,
    baseCotisable,
    basePfAt,
    cnpsRetraite,
    cmu,
    cmuPersonnes,
    parts: nombreParts(input.situation, input.enfants),
    impotBrutAvantRicf,
    reductionRicf,
    impotNet,
    totalRetenues,
    netImposable,
    netAPayer,
    expatrie: isExpatrie,
    patronal,
    totalPatronal,
    coutTotalEmployeur
  };
}

// --------------------------- Résolution inverse (net → sursalaire) ---------

// Le salaire NET est saisi par l'utilisateur ; le sursalaire est l'inconnue.
// Le net est une fonction monotone croissante du sursalaire, ce qui permet une
// recherche dichotomique stable et rapide (précision à l'unité FCFA).
export function resoudreSursalaire(netCible, input, params = DEFAULT_PARAMS) {
  const cible = roundFCFA(netCible);

  const netPour = (ss) =>
    calculerBulletin({ ...input, sursalaire: ss }, params).netAPayer;

  // Si le net à sursalaire nul dépasse déjà la cible, on ne peut pas descendre
  // en dessous de 0 : sursalaire = 0 (le net réel sera signalé à l'affichage).
  if (netPour(0) >= cible) return 0;

  // Borne haute : on double jusqu'à dépasser la cible (garde-fou à 1 milliard).
  let haut = Math.max(cible, 100000);
  let garde = 0;
  while (netPour(haut) < cible && haut < 1e9 && garde < 64) {
    haut *= 2;
    garde += 1;
  }

  let bas = 0;
  // ~40 itérations suffisent largement à converger à l'unité près.
  for (let i = 0; i < 40 && haut - bas > 0.5; i++) {
    const mid = (bas + haut) / 2;
    if (netPour(mid) < cible) bas = mid;
    else haut = mid;
  }
  return roundFCFA(haut);
}

// Calcule un bulletin complet à partir d'un salaire NET cible : résout d'abord
// le sursalaire SUR LE SALAIRE NORMAL (hors congé ET hors heures sup, pour
// que l'indemnité de congé et les heures supplémentaires s'ajoutent bien EN
// SUS du net cible — rémunération réelle d'un événement ponctuel — au lieu
// d'être neutralisées par une baisse automatique du sursalaire), puis renvoie
// le détail complet avec ces éléments ponctuels en sus.
export function calculerDepuisNet(netCible, input, params = DEFAULT_PARAMS) {
  const sursalaire = resoudreSursalaire(netCible, { ...input, congePaye: 0, heuresSupplementaires: [] }, params);
  const bulletin = calculerBulletin({ ...input, sursalaire }, params);
  return { ...bulletin, netCible: roundFCFA(netCible) };
}

// --------------------------- Sélection de la période contractuelle ---------

// Étiquette du mois « aaaa-mm » -> libellé lisible (« janvier 2026 »).
export function libelleMois(ym, locale = 'fr') {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

// Compare deux étiquettes « aaaa-mm ».
export function moisAvant(a, b) {
  return a <= b;
}

// Retourne la liste ordonnée des mois « aaaa-mm » entre deux bornes incluses.
export function listerMois(debut, fin) {
  const out = [];
  let [y, m] = debut.split('-').map(Number);
  const [fy, fm] = fin.split('-').map(Number);
  let garde = 0;
  while ((y < fy || (y === fy && m <= fm)) && garde < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    garde += 1;
  }
  return out;
}

// Sélectionne, pour un mois donné, la période contractuelle applicable parmi
// les renouvellements CDD et l'éventuel passage en CDI. `debut`/`fin` de chaque
// période sont des étiquettes « aaaa-mm » (fin absente = période ouverte / CDI).
export function periodePourMois(periodes, ym) {
  const eligibles = (periodes || []).filter(
    (p) => p.debut <= ym && (!p.fin || p.fin >= ym)
  );
  if (eligibles.length === 0) return null;
  // En cas de chevauchement, on privilégie la période commençant le plus tard
  // (un renouvellement récent prime sur une période antérieure).
  return eligibles.sort((a, b) => (a.debut < b.debut ? 1 : -1))[0];
}

// Nombre de mois (inclus) entre deux étiquettes « aaaa-mm ».
export function moisEntre(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}

// Mois précédant une étiquette « aaaa-mm » (ex. « 2022-01 » -> « 2021-12 »).
export function moisPrecedent(ym) {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Mois suivant une étiquette « aaaa-mm » (ex. « 2021-12 » -> « 2022-01 »).
export function moisSuivant(ym) {
  let [y, m] = ym.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Durée maximale d'un CDD (renouvellements inclus) avant requalification légale
// en CDI, en Côte d'Ivoire : au-delà de 2 ans (24 mois).
export const CDD_MAX_MOIS = 24;

// Période applicable à un mois, AVEC requalification automatique : si le salarié
// cumule plus de 24 mois de CDD, la période est traitée comme un CDI à partir
// du 25ᵉ mois (mêmes salaire / net / primes). Renvoie la période enrichie d'un
// indicateur `requalifieCdi`.
//
// Garde-fou sur la date d'embauche ENREGISTRÉE (champ `dateEmbauche`, saisi
// indépendamment des périodes contractuelles) : un salarié n'est jamais
// considéré présent avant elle, même si une période contractuelle mal saisie
// (import, correction ultérieure de la date d'embauche...) le laisserait
// croire. Sert de source de vérité unique pour tous les écrans pilotés par le
// sélecteur « Base » (Tableau de bord, Bulletins, Livre de paie, Cotisations,
// Impôts) : changer de période ne doit jamais faire apparaître un salarié à
// une date antérieure à son embauche.
export function periodeEffective(employee, ym) {
  if (employee?.dateEmbauche && employee.dateEmbauche.slice(0, 7) > ym) return null;
  const p = periodePourMois(employee?.periodes, ym);
  if (!p) return null;
  if (p.kind === 'cdd') {
    const debutsCdd = (employee.periodes || [])
      .filter((x) => x.kind === 'cdd' && x.debut)
      .map((x) => x.debut)
      .sort();
    const premier = debutsCdd[0];
    if (premier && moisEntre(premier, ym) > CDD_MAX_MOIS) {
      return { ...p, kind: 'cdi', requalifieCdi: true };
    }
  }
  return { ...p, requalifieCdi: false };
}

// --------------------------- Congés payés ----------------------------------

// Barème légal ivoirien : 2,2 jours ouvrables acquis par mois de service
// effectif, majoré selon l'ancienneté (jours supplémentaires par tranches au-
// delà de 5 ans de présence, jusqu'à +8 jours à partir de 30 ans).
export const CONGE_JOURS_PAR_MOIS = 2.2;

export function joursCongeAnnuels(anciennete) {
  const base = Math.round(CONGE_JOURS_PAR_MOIS * 12); // ≈ 26 jours ouvrables
  let sup = 0;
  const a = Number(anciennete) || 0;
  if (a >= 5) sup = 1;
  if (a >= 10) sup = 2;
  if (a >= 15) sup = 3;
  if (a >= 20) sup = 5;
  if (a >= 25) sup = 7;
  if (a >= 30) sup = 8;
  return base + sup;
}

// Vrai si `ym` est le mois anniversaire de la date d'embauche (même mois de
// calendrier) et que le salarié a au moins un an de service — c'est à ce moment
// que le droit à congé annuel est ouvert et versé.
export function estMoisAnniversaire(dateEmbauche, ym) {
  if (!dateEmbauche) return false;
  const [ey, em] = dateEmbauche.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  return m === em && y > ey;
}

// Compteur de congés (mention légale du bulletin) : nombre de jours acquis
// dans le cycle annuel EN COURS, c'est-à-dire depuis le dernier versement de
// l'indemnité de congé (mois anniversaire) ou depuis l'embauche si aucun
// versement n'a encore eu lieu. Repart à 0 le mois même du versement (les
// jours de ce cycle viennent d'être soldés — voir `calc.congeJours` pour le
// nombre de jours effectivement soldés ce mois-là). Pur calcul d'affichage,
// sans incidence sur la paie.
export function congesEnCours(dateEmbauche, ym) {
  if (!dateEmbauche) return 0;
  const [ey, em] = dateEmbauche.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  const moisTotal = (y - ey) * 12 + (m - em);
  if (moisTotal < 0) return 0;
  const moisCycle = moisTotal % 12;
  return Math.round(moisCycle * CONGE_JOURS_PAR_MOIS * 10) / 10;
}

// Bornes (aaaa-mm) du cycle d'acquisition de congé EN COURS à `ym` : un cycle
// dure toujours 12 mois, démarre au mois d'embauche ou à l'un de ses
// anniversaires, et se clôture (versement de l'indemnité, voir
// estMoisAnniversaire) au mois anniversaire suivant. Sert à savoir quels
// congés déjà pris (voir onglet Congés) se rattachent à CE cycle plutôt qu'à
// un cycle antérieur — utilisé pour l'onglet Congés ET pour déduire les
// congés déjà pris de l'indemnité compensatrice au solde de tout compte
// (voir soldeToutCompte.js), mais jamais dans le calcul du bulletin mensuel
// courant (l'indemnité de congé versée au mois anniversaire reste
// automatique, indépendante de ce qui a été physiquement pris).
export function cycleConges(dateEmbauche, ym) {
  if (!dateEmbauche) return null;
  const [ey, em] = dateEmbauche.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  const moisTotal = (y - ey) * 12 + (m - em);
  if (moisTotal < 0) return null;
  const moisCycle = moisTotal % 12;
  let sy = y;
  let sm = m - moisCycle;
  while (sm < 1) { sm += 12; sy -= 1; }
  let fy = sy;
  let fm = sm + 11;
  while (fm > 12) { fm -= 12; fy += 1; }
  return { debut: `${sy}-${String(sm).padStart(2, '0')}`, fin: `${fy}-${String(fm).padStart(2, '0')}` };
}

// Liste TOUS les cycles d'acquisition d'un salarié, du tout premier (mois
// d'embauche) jusqu'à celui contenant `ymRef` inclus (généralement
// aujourd'hui) — permet de clôturer un cycle ancien aussi bien que l'actuel
// (voir onglet Congés), pas seulement le cycle en cours.
export function listeCyclesConges(dateEmbauche, ymRef) {
  const cycles = [];
  if (!dateEmbauche) return cycles;
  let debut = dateEmbauche.slice(0, 7);
  let garde = 0;
  while (debut <= ymRef && garde < 200) {
    const c = cycleConges(dateEmbauche, debut);
    if (!c) break;
    cycles.push(c);
    const [fy, fm] = c.fin.split('-').map(Number);
    let ny = fy;
    let nm = fm + 1;
    if (nm > 12) { nm = 1; ny += 1; }
    debut = `${ny}-${String(nm).padStart(2, '0')}`;
    garde += 1;
  }
  return cycles;
}

// --------------------------- Prorata des mois incomplets -------------------
// Convention des « 30èmes », standard en paie ivoirienne/OHADA (Sage Paie
// Afrique et assimilés) : chaque mois compte pour 30 jours quelle que soit sa
// durée calendaire réelle, et le jour du calendrier (1 à 31) se reporte
// directement sur cette échelle (le 31 est ramené à 30). Le salaire
// journalier est donc TOUJOURS salaire mensuel / 30, ce qui évite les écarts
// entre un mois de 28 et un mois de 31 jours pour une même situation.

// Nombre de jours (méthode des 30èmes) réellement couverts par une présence
// du `debutJour` au `finJour` inclus (1-30, un 31 étant ramené à 30).
export function joursTravaillesMois(debutJour, finJour) {
  const debut = Math.max(1, Math.min(30, Number(debutJour) || 1));
  const fin = Math.max(1, Math.min(30, Number(finJour) || 30));
  if (fin < debut) return 0;
  return fin - debut + 1;
}

// Coefficient à appliquer aux éléments de rémunération mensuels (salaire de
// base, sursalaire visé, primes récurrentes...) pour un mois incomplet :
// 1 = mois plein (comportement inchangé), < 1 = entrée/sortie en cours de
// mois. `joursTravailles` est déjà exprimé en 30èmes (voir ci-dessus).
export function coefficientProrata(joursTravailles) {
  return Math.max(0, Math.min(1, (Number(joursTravailles) || 0) / 30));
}

// --------------------------- Solde de tout compte ---------------------------
// Calcul des indemnités dues à la rupture d'un contrat, en sus du dernier
// salaire (déjà couvert par le bulletin du mois de sortie, avec son prorata
// éventuel). Purement un outil d'aide au calcul : rien n'est jamais imposé
// automatiquement, le motif de rupture détermine simplement QUELS éléments
// s'appliquent légalement — c'est à l'utilisateur de confirmer le motif réel.

// Indemnité de licenciement (Code du travail ivoirien / Convention
// Collective Interprofessionnelle, art. 17) : uniquement en cas de
// licenciement non consécutif à une faute lourde, à partir d'un an
// d'ancienneté. Barème PROGRESSIF par tranche d'ancienneté (pas un taux
// unique appliqué à toutes les années) : 30 % du salaire moyen mensuel par
// année pour les 5 premières années, 35 % de la 6ᵉ à la 10ᵉ, 40 % au-delà.
// Ce barème est celui du CDI (ou d'un CDD requalifié en CDI après 24 mois,
// voir CDD_MAX_MOIS) : pour un CDD encore en cours rompu avant son terme,
// voir `indemniteRuptureAnticipeeCdd` ci-dessous, qui obéit à une autre règle.
export function indemniteLicenciement(salaireMoyenMensuel, anneesAnciennete) {
  const a = Math.max(0, Number(anneesAnciennete) || 0);
  const s = Math.max(0, Number(salaireMoyenMensuel) || 0);
  if (a < 1 || s <= 0) return 0;
  const tranche1 = Math.min(a, 5) * 0.30;
  const tranche2 = Math.max(0, Math.min(a, 10) - 5) * 0.35;
  const tranche3 = Math.max(0, a - 10) * 0.40;
  return roundFCFA(s * (tranche1 + tranche2 + tranche3));
}

// Dommages-intérêts pour rupture anticipée d'un CDD encore en cours (avant
// son terme), à l'initiative de l'employeur ou d'un commun accord, hors
// faute lourde : le Code du travail ivoirien ne prévoit PAS le barème
// d'indemnité de licenciement du CDI pour un CDD non arrivé à échéance — la
// règle générale est une réparation égale aux rémunérations que le salarié
// aurait perçues jusqu'au terme prévu du contrat. `moisRestants` : nombre de
// mois entre le mois SUIVANT la sortie (le mois de sortie est déjà couvert
// par le dernier bulletin) et le mois de fin de contrat prévu, inclus.
export function indemniteRuptureAnticipeeCdd(salaireMoyenMensuel, moisRestants) {
  const s = Math.max(0, Number(salaireMoyenMensuel) || 0);
  const m = Math.max(0, Number(moisRestants) || 0);
  return roundFCFA(s * m);
}

// Indemnité compensatrice de congés payés non pris à la date de rupture :
// jours acquis dans le cycle en cours (voir congesEnCours) × salaire
// journalier (méthode des 30èmes) sur la base du salaire moyen mensuel.
export function indemniteCongesNonPris(salaireMoyenMensuel, joursRestants) {
  const s = Math.max(0, Number(salaireMoyenMensuel) || 0);
  const j = Math.max(0, Number(joursRestants) || 0);
  return roundFCFA((s / 30) * j);
}

// Prime de précarité (CDD uniquement) : 3 % de la rémunération BRUTE totale
// versée pendant toute la durée du CDD (renouvellements inclus), due sauf
// si le contrat se poursuit en CDI ou si le salarié refuse une offre de CDI
// sur le même poste.
export const TAUX_PRIME_PRECARITE = 0.03;

export function primePrecarite(cumulBrutCdd) {
  return roundFCFA(Math.max(0, Number(cumulBrutCdd) || 0) * TAUX_PRIME_PRECARITE);
}

// Indemnité compensatrice de préavis (si le préavis légal/conventionnel n'est
// pas exécuté) : la durée exacte dépend de la catégorie professionnelle et de
// l'ancienneté selon la convention collective applicable — volontairement
// LAISSÉE À LA SAISIE plutôt que devinée, pour éviter un montant faussement
// précis mais légalement inexact. Ce calcul se contente de convertir un
// nombre de jours de préavis (méthode des 30èmes) en indemnité.
export function indemnitePreavis(salaireMoyenMensuel, joursPreavis) {
  const s = Math.max(0, Number(salaireMoyenMensuel) || 0);
  const j = Math.max(0, Number(joursPreavis) || 0);
  return roundFCFA((s / 30) * j);
}
