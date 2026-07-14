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
  // CMU : 1 000 FCFA/mois/assuré au total, répartis 500 salarié + 500 employeur.
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
  cmuPatronale: 500, // part employeur CMU (500 FCFA / assuré)

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

// --------------------------- Calcul complet d'un bulletin ------------------

// Détaille l'intégralité d'un bulletin à partir des rubriques de gain.
// `input` :
//   salaireBase, sursalaire, salaireCategoriel (défaut = salaireBase),
//   transport, primes: [{ label, montant, imposable }],
//   situation, enfants, anciennete (années)
export function calculerBulletin(input, params = DEFAULT_PARAMS) {
  const salaireBase = roundFCFA(input.salaireBase);
  const sursalaire = roundFCFA(input.sursalaire);
  const salaireCategoriel = roundFCFA(input.salaireCategoriel ?? input.salaireBase);
  const transport = roundFCFA(input.transport ?? 0);
  const primes = Array.isArray(input.primes) ? input.primes : [];

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
  const cmu = roundFCFA(params.cmuSalarie);

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
    cmu: roundFCFA(params.cmuPatronale)
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
    brutImposable,
    brutTotal,
    baseCotisable,
    basePfAt,
    cnpsRetraite,
    cmu,
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
// le sursalaire, puis renvoie le détail (avec le sursalaire retenu).
export function calculerDepuisNet(netCible, input, params = DEFAULT_PARAMS) {
  const sursalaire = resoudreSursalaire(netCible, input, params);
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
