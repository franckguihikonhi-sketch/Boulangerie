// ---------------------------------------------------------------------------
// Génération des ÉCRITURES comptables (partie double) à partir des
// transactions Wave normalisées.
//
// Le compte Wave est un compte de trésorerie (monnaie électronique). Chaque
// transaction se traduit par une pièce équilibrée :
//
//   • Paiement (montant < 0) — total T = |montant|, frais F, net N = T − F :
//       Débit  <compte de charge / tiers>      N
//       Débit  631700 Frais monnaie électron.  F
//       Crédit 552000 Trésorerie Wave          T
//
//   • Encaissement (montant > 0) — net N = montant, frais F, brut B = N + F :
//       Débit  552000 Trésorerie Wave          N
//       Débit  631700 Frais monnaie électron.  F
//       Crédit <compte de produit / tiers>     B
//
//   • Contrepassation (type *_reversal, montant > 0, frais < 0) — annule un
//     paiement : la trésorerie est ré-alimentée, la charge et les frais sont
//     contre-passés (inscrits au crédit).
//
// Le solde Wave bouge toujours EXACTEMENT du « montant » : c'est l'invariant
// vérifié sur le relevé, donc la trésorerie porte |montant|.
// ---------------------------------------------------------------------------

import { roundFCFA } from './money';
import { imputerCompte, sensTransaction, PARAMETRES_DEFAUT } from './rules';
import { intituleCompte, normaliserCompte } from '../data/planComptable';

// Libellé d'écriture (repris sur chaque ligne de la pièce). On privilégie le
// motif Wave ; à défaut la contrepartie ; à défaut le type de transaction.
export function libelleEcriture(tx) {
  const base = (tx.motif && tx.motif.trim()) || tx.contrepartie || tx.type || 'Transaction Wave';
  const cp = tx.contrepartie && tx.motif && tx.motif.trim() ? ` — ${tx.contrepartie}` : '';
  return `${base}${cp}`.replace(/\s+/g, ' ').trim();
}

// Référence de pièce : identifiant Wave (unique) si présent, sinon date+rang.
function referencePiece(tx, rang) {
  return tx.txId || `${tx.dateIso || 'sansdate'}-${rang}`;
}

// Construit la pièce comptable (liste de lignes équilibrées) d'une transaction.
// options : { parametres, regles, mappingsContrepartie, overrides }
//   overrides[txId] = compte  -> force le compte de contrepartie d'une ligne.
export function ecrituresTransaction(tx, rang, options = {}) {
  const params = { ...PARAMETRES_DEFAUT, ...(options.parametres || {}) };
  const overrides = options.overrides || {};

  const sens = sensTransaction(tx);
  const montant = Number(tx.montant) || 0;
  const frais = Number(tx.frais) || 0;

  // Choix du compte de contrepartie (charge / produit) : override manuel > règle.
  let compte, source, regle, libelleRegle;
  if (tx.txId && overrides[tx.txId]) {
    compte = normaliserCompte(overrides[tx.txId]);
    source = 'manuel';
    regle = null;
    libelleRegle = '';
  } else {
    const r = imputerCompte(tx, options);
    compte = normaliserCompte(r.compte);
    source = r.source;
    regle = r.regle;
    libelleRegle = r.libelle;
  }

  const libelle = libelleEcriture(tx);
  const journal = params.journal;
  const date = tx.dateIso;
  const ref = referencePiece(tx, rang);
  const T = roundFCFA(Math.abs(montant));
  const F = roundFCFA(Math.abs(frais));

  const ligne = (cpt, debit, credit, role) => {
    const compteN = normaliserCompte(cpt);
    return {
      ref,
      journal,
      date,
      compte: compteN,
      intituleCompte: intituleCompte(compteN),
      libelle,
      debit: roundFCFA(debit),
      credit: roundFCFA(credit),
      role // 'contrepartie' | 'frais' | 'tresorerie'
    };
  };

  const lignes = [];

  if (sens === 'sortie') {
    const net = roundFCFA(T - F);
    lignes.push(ligne(compte, net, 0, 'contrepartie'));
    if (F > 0) lignes.push(ligne(params.compteFrais, F, 0, 'frais'));
    lignes.push(ligne(params.compteTresorerie, 0, T, 'tresorerie'));
  } else if (sens === 'contrepassation') {
    // Annulation : la trésorerie revient (débit), charge + frais contre-passés.
    const net = roundFCFA(T - F);
    lignes.push(ligne(params.compteTresorerie, T, 0, 'tresorerie'));
    if (F > 0) lignes.push(ligne(params.compteFrais, 0, F, 'frais'));
    lignes.push(ligne(compte, 0, net, 'contrepartie'));
  } else {
    // Encaissement : trésorerie créditée du net reçu, produit au brut.
    const net = T; // le solde Wave a augmenté du montant net reçu
    const brut = roundFCFA(net + F);
    lignes.push(ligne(params.compteTresorerie, net, 0, 'tresorerie'));
    if (F > 0) lignes.push(ligne(params.compteFrais, F, 0, 'frais'));
    lignes.push(ligne(compte, 0, brut, 'contrepartie'));
  }

  const totalDebit = lignes.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lignes.reduce((s, l) => s + l.credit, 0);

  return {
    ref,
    txId: tx.txId,
    date,
    journal,
    sens,
    type: tx.type,
    contrepartie: tx.contrepartie,
    motif: tx.motif,
    compteContrepartie: compte,
    source, // manuel | contrepartie | regle | defaut
    regle,
    libelleRegle,
    libelle,
    lignes,
    totalDebit,
    totalCredit,
    equilibre: totalDebit === totalCredit,
    aVerifier: source === 'defaut'
  };
}

// Construit toutes les pièces d'une liste de transactions.
export function construirePieces(transactions, options = {}) {
  return transactions.map((tx, i) => ecrituresTransaction(tx, i + 1, options));
}

// Aplati toutes les lignes de toutes les pièces (pour l'export / le contrôle).
export function toutesLesLignes(pieces) {
  return pieces.flatMap((p) => p.lignes);
}

// Contrôle global de partie double.
export function controlePieces(pieces) {
  let debit = 0;
  let credit = 0;
  let desequilibrees = 0;
  let aVerifier = 0;
  for (const p of pieces) {
    debit += p.totalDebit;
    credit += p.totalCredit;
    if (!p.equilibre) desequilibrees += 1;
    if (p.aVerifier) aVerifier += 1;
  }
  return {
    nbPieces: pieces.length,
    nbLignes: pieces.reduce((s, p) => s + p.lignes.length, 0),
    debit,
    credit,
    equilibre: debit === credit && desequilibrees === 0,
    desequilibrees,
    aVerifier
  };
}
