// ---------------------------------------------------------------------------
// Export des écritures comptables au format d'import SAGE 100 Comptabilité i7.
//
// Les écritures sont SAISIES par l'utilisateur (journal, date de pièce, compte,
// libellé, débit, crédit) puis exportées d'un clic en un fichier texte à
// largeur fixe, directement importable dans SAGE — la colonne « Code journal »
// aiguille chaque ligne vers le bon journal.
//
// Format reproduit fidèlement depuis la fiche Sage (« Format de fichier
// paramétrable », type de données : Écritures comptables) :
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
// ---------------------------------------------------------------------------

// Suggestions de codes journaux courants (SYSCOHADA / usage SAGE). L'utilisateur
// reste libre de saisir n'importe quel code : ce ne sont que des propositions.
export const JOURNAUX_SUGGESTIONS = [
  { code: 'VT', libelle: 'Ventes' },
  { code: 'AC', libelle: 'Achats' },
  { code: 'BQ', libelle: 'Banque' },
  { code: 'CA', libelle: 'Caisse' },
  { code: 'OD', libelle: 'Opérations diverses' }
];

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

// Date de pièce « jjmmaa » à partir d'une date de saisie « AAAA-MM-JJ ».
// On lit la date telle quelle (date calendaire), sans décalage de fuseau.
export function jjmmaaDepuisDate(dateSaisie) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateSaisie || '');
  if (!m) return '';
  return m[3] + m[2] + m[1].slice(2); // jj + mm + aa
}

// Montant FCFA (entier) → « 1234,00 » : 2 décimales, virgule, sans milliers.
// Le côté non mouvementé (montant nul) est laissé à blanc.
function montantSage(valeur) {
  const n = Number(valeur);
  if (!n) return '';
  return n.toFixed(2).replace('.', ',');
}

// Cadre une valeur sur la largeur fixe du champ (troncature si dépassement).
function caler(valeur, longueur, cadrage) {
  let v = String(valeur ?? '');
  if (v.length > longueur) v = v.slice(0, longueur);
  return cadrage === 'droite' ? v.padStart(longueur, ' ') : v.padEnd(longueur, ' ');
}

// Traduit une écriture saisie en champs bruts prêts à caler.
// entree : { journal, pieceDate ('AAAA-MM-JJ'), account, label, debit, credit }
function champsBruts(entree) {
  return {
    journal: entree.journal || '',
    date: jjmmaaDepuisDate(entree.pieceDate),
    compte: entree.account || '',
    libelle: entree.label || '',
    debit: montantSage(entree.debit),
    credit: montantSage(entree.credit)
  };
}

// Assemble une écriture en une ligne à largeur fixe (88 caractères).
export function formaterEnregistrement(entree) {
  const bruts = champsBruts(entree);
  return CHAMPS.map((c) => caler(bruts[c.key], c.longueur, c.cadrage)).join('');
}

// Concatène toutes les écritures en un fichier texte à largeur fixe.
export function texteFichierSage(ecritures) {
  const corps = ecritures.map(formaterEnregistrement).join(FIN_LIGNE);
  return { texte: ecritures.length ? corps + FIN_LIGNE : '', nb: ecritures.length };
}

// Contrôle de partie double : total débit, total crédit et équilibre.
export function controleEquilibre(ecritures) {
  let debit = 0;
  let credit = 0;
  for (const e of ecritures) {
    debit += Number(e.debit) || 0;
    credit += Number(e.credit) || 0;
  }
  return { nb: ecritures.length, debit, credit, equilibre: Math.round(debit) === Math.round(credit) };
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
export function telechargerFichierSage(ecritures, nomFichier) {
  const { texte, nb } = texteFichierSage(ecritures);
  const octets = encoderWindows1252(texte);
  const blob = new Blob([octets], { type: 'text/plain;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = nomFichier || `SAGE_ECRITURES_${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return nb;
}
