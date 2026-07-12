// ---------------------------------------------------------------------------
// Lecture d'un relevé Wave Business (export « historique des transactions »).
//
// Wave fournit un fichier Excel (.xls / .xlsx) ou CSV avec une ligne d'entête
// puis une ligne par transaction. On lit le fichier avec SheetJS, on repère les
// colonnes par leur intitulé (robuste à un changement d'ordre) et on renvoie
// des transactions NORMALISÉES, indépendantes du format d'origine.
//
// Colonnes attendues (intitulés Wave, français) :
//   Horodatage · Identifiant de transaction · Type de transaction · Montant ·
//   Frais · Solde · Devise · Nom de contrepartie · Numéro de téléphone de
//   contrepartie · Référence client · Raison du paiement · Identifiant de
//   groupe · Initié par · Approuvé et envoyé par
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

// Normalise un intitulé de colonne : minuscules, sans accents ni espaces
// superflus, pour un appariement tolérant.
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Table de correspondance : champ normalisé -> liste d'intitulés possibles.
const COLONNES = {
  horodatage: ['horodatage', 'date', 'timestamp', 'date et heure'],
  txId: ['identifiant de transaction', 'transaction id', 'id transaction'],
  type: ['type de transaction', 'type', 'transaction type'],
  montant: ['montant', 'amount'],
  frais: ['frais', 'fee', 'fees'],
  solde: ['solde', 'balance'],
  devise: ['devise', 'currency'],
  contrepartie: ['nom de contrepartie', 'contrepartie', 'counterparty', 'counterparty name'],
  telephone: ['numero de telephone de contrepartie', 'telephone', 'phone', 'counterparty phone number'],
  reference: ['reference client', 'reference', 'client reference'],
  motif: ['raison du paiement', 'motif', 'reason', 'payment reason'],
  groupe: ['identifiant de groupe', 'groupe', 'group id'],
  initiePar: ['initie par', 'initiated by'],
  approuvePar: ['approuve et envoye par', 'approuve par', 'approved and sent by', 'approved by']
};

// À partir de la ligne d'entête, construit un index champ -> numéro de colonne.
function indexerColonnes(entete) {
  const normes = entete.map(norm);
  const index = {};
  for (const [champ, alias] of Object.entries(COLONNES)) {
    let col = -1;
    for (const a of alias) {
      col = normes.indexOf(a);
      if (col !== -1) break;
    }
    // Repli : appariement par inclusion (« montant (xof) », etc.).
    if (col === -1) {
      col = normes.findIndex((h) => alias.some((a) => h.includes(a)));
    }
    index[champ] = col;
  }
  return index;
}

// Convertit un horodatage Wave « JJ/MM/AA HH:MM:SS » en date ISO « AAAA-MM-JJ »
// (+ conserve l'heure). Année sur 2 chiffres -> 20AA. Aucun décalage de fuseau.
export function parseHorodatage(brut) {
  const s = String(brut || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return { iso: '', heure: '', brut: s };
  const jj = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  let aaaa = m[3];
  if (aaaa.length === 2) aaaa = '20' + aaaa;
  const heure = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}${m[6] ? ':' + m[6] : ''}` : '';
  return { iso: `${aaaa}-${mm}-${jj}`, heure, brut: s };
}

// Nettoie un montant : supprime espaces, symboles monétaires, remplace la
// virgule décimale par un point. Renvoie un Number (les XOF sont entiers).
function nombre(brut) {
  if (typeof brut === 'number') return brut;
  const s = String(brut ?? '')
    .replace(/\s/g, '')
    .replace(/[^\d,.\-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '') // point = séparateur de milliers éventuel
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Lit un fichier (File / Blob / ArrayBuffer) et renvoie les transactions
// normalisées + des métadonnées (nom de feuille, période).
export async function lireFichierWave(fichier) {
  let buffer;
  if (fichier instanceof ArrayBuffer) buffer = fichier;
  else if (typeof fichier.arrayBuffer === 'function') buffer = await fichier.arrayBuffer();
  else throw new Error('Format de fichier non pris en charge.');

  const wb = XLSX.read(buffer, { type: 'array' });
  const nomFeuille = wb.SheetNames[0];
  const ws = wb.Sheets[nomFeuille];
  if (!ws) throw new Error('Le fichier ne contient aucune feuille exploitable.');

  const lignes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if (!lignes.length) throw new Error('Le fichier est vide.');

  // Trouve la ligne d'entête (celle qui contient « Type de transaction »).
  let enteteIdx = lignes.findIndex((l) =>
    l.some((c) => norm(c).includes('type de transaction'))
  );
  if (enteteIdx === -1) enteteIdx = 0;
  const index = indexerColonnes(lignes[enteteIdx]);

  if (index.montant === -1 || index.type === -1) {
    throw new Error(
      "Colonnes Wave introuvables (« Type de transaction » / « Montant »). " +
        'Vérifiez que le fichier provient bien de l\'export Wave Business.'
    );
  }

  const val = (ligne, champ) => (index[champ] === -1 ? '' : ligne[index[champ]]);

  const transactions = [];
  for (let i = enteteIdx + 1; i < lignes.length; i++) {
    const l = lignes[i];
    if (!l || l.every((c) => String(c).trim() === '')) continue;
    const type = String(val(l, 'type')).trim();
    const horod = parseHorodatage(val(l, 'horodatage'));
    if (!type && !horod.iso) continue; // ligne parasite

    transactions.push({
      txId: String(val(l, 'txId')).trim(),
      horodatage: horod.brut,
      dateIso: horod.iso,
      heure: horod.heure,
      type,
      montant: nombre(val(l, 'montant')),
      frais: nombre(val(l, 'frais')),
      solde: nombre(val(l, 'solde')),
      devise: String(val(l, 'devise')).trim() || 'XOF',
      contrepartie: String(val(l, 'contrepartie')).trim(),
      telephone: String(val(l, 'telephone')).trim(),
      reference: String(val(l, 'reference')).trim(),
      motif: String(val(l, 'motif')).trim(),
      groupe: String(val(l, 'groupe')).trim(),
      initiePar: String(val(l, 'initiePar')).trim(),
      approuvePar: String(val(l, 'approuvePar')).trim()
    });
  }

  const dates = transactions.map((t) => t.dateIso).filter(Boolean).sort();
  return {
    nomFeuille,
    periodeDebut: dates[0] || '',
    periodeFin: dates[dates.length - 1] || '',
    transactions
  };
}
