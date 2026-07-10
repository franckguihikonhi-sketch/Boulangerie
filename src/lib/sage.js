// ---------------------------------------------------------------------------
// Export des écritures comptables au format d'import SAGE 100 Comptabilité i7.
//
// Reproduit fidèlement le « Format de fichier paramétrable » décrit sur la
// fiche Sage jointe (type de données : Écritures comptables) :
//
//   • Fichier à LARGEUR FIXE, origine Windows, sans entête, une écriture par
//     ligne, séparateur d'enregistrement = retour-chariot (CRLF sous Windows).
//   • Montants : 2 décimales, séparateur décimal « , », pas de séparateur de
//     milliers, cadrés à DROITE, caractère de remplissage = blanc.
//   • Champs (Champ / Longueur / Position, cf. « Description du format ») :
//
//       Code journal        6   position  1
//       Date de pièce       6   position  7   (jjmmaa)
//       N° compte général  13   position 13
//       Libellé écriture   35   position 26
//       Montant débit      14   position 61
//       Montant crédit     14   position 75
//
//     Longueur totale d'un enregistrement : 88 caractères + CRLF.
//
// Chaque opération de la boulangerie est traduite en écriture ÉQUILIBRÉE en
// partie double (un débit = un crédit), afin que le fichier soit directement
// importable et que la balance soit nulle.
// ---------------------------------------------------------------------------

import { inPeriod, isTestName, TIMEZONE } from './reports';

// --------------------------- Plan comptable ---------------------------------
// Plan SYSCOHADA révisé (OHADA / Côte d'Ivoire). Ces valeurs sont regroupées
// ici pour qu'un comptable puisse les adapter à son plan sans toucher au reste.
export const PLAN_COMPTABLE = {
  journalVentes: 'VT', // journal des ventes
  journalAchats: 'AC', // journal des achats
  compteCaisse: '571000', // 571 Caisse — contrepartie des ventes au comptant
  compteVentes: '702000', // 702 Ventes de produits fabriqués
  compteFournisseurs: '401000', // 401 Fournisseurs — contrepartie des achats
  compteMatieresPremieres: '602000', // 602 Achats de matières premières
  compteAutresAchats: '605000' // 605 Autres achats (eau, électricité…)
};

// Gabarit des champs, dans l'ordre et aux longueurs exigés par la fiche Sage.
const CHAMPS = [
  { key: 'journal', longueur: 6, cadrage: 'gauche' },
  { key: 'date', longueur: 6, cadrage: 'gauche' },
  { key: 'compte', longueur: 13, cadrage: 'gauche' },
  { key: 'libelle', longueur: 35, cadrage: 'gauche' },
  { key: 'debit', longueur: 14, cadrage: 'droite' },
  { key: 'credit', longueur: 14, cadrage: 'droite' }
];

export const LONGUEUR_ENREGISTREMENT = CHAMPS.reduce((n, c) => n + c.longueur, 0); // 88
const FIN_LIGNE = '\r\n'; // origine Windows → CRLF

// Date « jjmmaa » dans le fuseau unique de l'application (Africa/Abidjan),
// pour rester cohérent avec les regroupements des rapports.
const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIMEZONE,
  year: '2-digit',
  month: '2-digit',
  day: '2-digit'
});
function dateJjmmaa(iso) {
  // fr-FR rend « jj/mm/aa » → on retire les séparateurs.
  return dateFmt.format(new Date(iso)).replace(/\D/g, '');
}

// Montant FCFA (entier) → « 1234,00 » : 2 décimales, virgule, sans milliers.
function montantSage(valeur) {
  if (!valeur) return ''; // côté non mouvementé : champ laissé à blanc
  return Number(valeur).toFixed(2).replace('.', ',');
}

// Cadre une valeur sur la largeur fixe du champ (troncature si dépassement).
function caler(valeur, longueur, cadrage) {
  let v = String(valeur ?? '');
  if (v.length > longueur) v = v.slice(0, longueur);
  return cadrage === 'droite' ? v.padStart(longueur, ' ') : v.padEnd(longueur, ' ');
}

// Assemble une écriture en une ligne à largeur fixe (88 caractères).
export function formaterLigne(ecriture) {
  return CHAMPS.map((c) => {
    const brut =
      c.key === 'debit' || c.key === 'credit'
        ? montantSage(ecriture[c.key])
        : ecriture[c.key];
    return caler(brut, c.longueur, c.cadrage);
  }).join('');
}

// -------------------- Construction des écritures ----------------------------

// Traduit les ventes et achats de la période en écritures équilibrées.
// from / to : « YYYY-MM-DD » ou null (toute la période).
export function ecrituresComptables(state, from, to) {
  const produitParId = Object.fromEntries(state.products.map((p) => [p.id, p]));
  const ingredientParId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]));
  const ecritures = [];

  // Ventes → Débit Caisse / Crédit Ventes de produits fabriqués.
  for (const v of state.sales) {
    const produit = produitParId[v.productId];
    if (!produit || isTestName(produit.name)) continue;
    if (!inPeriod(v.soldAt, from, to)) continue;
    const date = dateJjmmaa(v.soldAt);
    const libelle = `Vente ${produit.name}`;
    ecritures.push({
      at: v.soldAt,
      journal: PLAN_COMPTABLE.journalVentes,
      date,
      compte: PLAN_COMPTABLE.compteCaisse,
      libelle,
      debit: v.total,
      credit: 0
    });
    ecritures.push({
      at: v.soldAt,
      journal: PLAN_COMPTABLE.journalVentes,
      date,
      compte: PLAN_COMPTABLE.compteVentes,
      libelle,
      debit: 0,
      credit: v.total
    });
  }

  // Achats → Débit Achats (matières premières ou autres achats) / Crédit Fournisseurs.
  for (const p of state.purchases) {
    const ingredient = ingredientParId[p.ingredientId];
    if (ingredient && isTestName(ingredient.name)) continue;
    if (!inPeriod(p.purchasedAt, from, to)) continue;
    const date = dateJjmmaa(p.purchasedAt);
    const nom = ingredient ? ingredient.name : 'ingrédient';
    const libelle = `Achat ${nom}`;
    const compteCharge =
      ingredient && ingredient.type === 'charge_utilite'
        ? PLAN_COMPTABLE.compteAutresAchats
        : PLAN_COMPTABLE.compteMatieresPremieres;
    ecritures.push({
      at: p.purchasedAt,
      journal: PLAN_COMPTABLE.journalAchats,
      date,
      compte: compteCharge,
      libelle,
      debit: p.totalCost,
      credit: 0
    });
    ecritures.push({
      at: p.purchasedAt,
      journal: PLAN_COMPTABLE.journalAchats,
      date,
      compte: PLAN_COMPTABLE.compteFournisseurs,
      libelle,
      debit: 0,
      credit: p.totalCost
    });
  }

  // Tri chronologique : les deux lignes d'une même pièce restent adjacentes.
  ecritures.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return ecritures;
}

// Concatène toutes les écritures en un fichier texte à largeur fixe.
export function construireFichierSage(state, from, to) {
  const ecritures = ecrituresComptables(state, from, to);
  const corps = ecritures.map(formaterLigne).join(FIN_LIGNE);
  return { texte: ecritures.length ? corps + FIN_LIGNE : '', nb: ecritures.length };
}

// -------------------- Encodage Windows-1252 (ANSI) --------------------------
// Origine du fichier = Windows : Sage attend de l'ANSI (Windows-1252), pas de
// l'UTF-8. On encode donc explicitement chaque caractère sur un octet.
const CP1252_HORS_LATIN1 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
};
export function encoderWindows1252(texte) {
  const octets = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i++) {
    const code = texte.charCodeAt(i);
    if (code <= 0xff) octets[i] = code; // ASCII + Latin-1 (é, è, à, ç, ù…)
    else if (texte[i] in CP1252_HORS_LATIN1) octets[i] = CP1252_HORS_LATIN1[texte[i]];
    else octets[i] = 0x3f; // caractère hors ANSI → « ? »
  }
  return octets;
}

// Déclenche le téléchargement du fichier d'import Sage dans le navigateur.
export function telechargerFichierSage(state, from, to) {
  const { texte, nb } = construireFichierSage(state, from, to);
  const octets = encoderWindows1252(texte);
  const blob = new Blob([octets], { type: 'text/plain;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffixe = [from, to].filter(Boolean).map((d) => d.replace(/-/g, '')).join('_');
  a.href = url;
  a.download = `SAGE_ECRITURES${suffixe ? '_' + suffixe : ''}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return nb;
}
