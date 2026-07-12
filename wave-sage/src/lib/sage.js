// ---------------------------------------------------------------------------
// Export des écritures au format d'import SAGE 100 Comptabilité i7
// (« Format de fichier paramétrable », type Écritures comptables).
//
//   • Fichier à LARGEUR FIXE, origine Windows, sans entête, une écriture par
//     ligne, séparateur d'enregistrement = CRLF.
//   • Montants : 2 décimales, séparateur décimal « , », sans séparateur de
//     milliers, cadrés à DROITE, remplissage = blanc.
//   • Champs (Champ / Longueur / Position) :
//       Code journal        6   position  1
//       Date de pièce       6   position  7   (jjmmaa)
//       N° compte général  13   position 13
//       Libellé écriture   35   position 26
//       Montant débit      14   position 61
//       Montant crédit     14   position 75
//     Longueur d'un enregistrement : 88 caractères + CRLF.
//
// Ce format est identique à celui de l'application « Écritures SAGE » du dépôt :
// SAGE importe le même gabarit quel que soit le journal de destination.
// ---------------------------------------------------------------------------

const CHAMPS = [
  { key: 'journal', longueur: 6, cadrage: 'gauche' },
  { key: 'date', longueur: 6, cadrage: 'gauche' },
  { key: 'compte', longueur: 13, cadrage: 'gauche' },
  { key: 'libelle', longueur: 35, cadrage: 'gauche' },
  { key: 'debit', longueur: 14, cadrage: 'droite' },
  { key: 'credit', longueur: 14, cadrage: 'droite' }
];

export const LONGUEUR_ENREGISTREMENT = CHAMPS.reduce((n, c) => n + c.longueur, 0); // 88
const FIN_LIGNE = '\r\n';

// Date de pièce « jjmmaa » à partir d'une date ISO « AAAA-MM-JJ ».
export function jjmmaaDepuisDate(dateIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso || '');
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

// Traduit une ligne d'écriture en champs bruts prêts à caler.
// ligne : { journal, date ('AAAA-MM-JJ'), compte, libelle, debit, credit }
function champsBruts(ligne) {
  return {
    journal: ligne.journal || '',
    date: jjmmaaDepuisDate(ligne.date),
    compte: ligne.compte || '',
    libelle: ligne.libelle || '',
    debit: montantSage(ligne.debit),
    credit: montantSage(ligne.credit)
  };
}

// Assemble une ligne en un enregistrement à largeur fixe (88 caractères).
export function formaterEnregistrement(ligne) {
  const bruts = champsBruts(ligne);
  return CHAMPS.map((c) => caler(bruts[c.key], c.longueur, c.cadrage)).join('');
}

// Concatène toutes les lignes en un fichier texte à largeur fixe.
export function texteFichierSage(lignes) {
  const corps = lignes.map(formaterEnregistrement).join(FIN_LIGNE);
  return { texte: lignes.length ? corps + FIN_LIGNE : '', nb: lignes.length };
}

// Contrôle de partie double : total débit, total crédit et équilibre.
export function controleEquilibre(lignes) {
  let debit = 0;
  let credit = 0;
  for (const e of lignes) {
    debit += Number(e.debit) || 0;
    credit += Number(e.credit) || 0;
  }
  return { nb: lignes.length, debit, credit, equilibre: Math.round(debit) === Math.round(credit) };
}

// -------------------- Encodage Windows-1252 (ANSI) --------------------------
// SAGE (origine Windows) attend de l'ANSI (Windows-1252), pas de l'UTF-8.
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
    if (code <= 0xff) octets[i] = code;
    else if (texte[i] in CP1252_HORS_LATIN1) octets[i] = CP1252_HORS_LATIN1[texte[i]];
    else octets[i] = 0x3f; // caractère hors ANSI → « ? »
  }
  return octets;
}

// Déclenche le téléchargement du fichier d'import SAGE dans le navigateur.
export function telechargerFichierSage(lignes, nomFichier) {
  const { texte, nb } = texteFichierSage(lignes);
  const octets = encoderWindows1252(texte);
  const blob = new Blob([octets], { type: 'text/plain;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = nomFichier || `SAGE_WAVE_${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return nb;
}
