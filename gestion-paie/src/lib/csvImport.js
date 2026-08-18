// ===========================================================================
// IMPORT EN MASSE DES SALARIÉS (CSV)
// ---------------------------------------------------------------------------
// Parseur CSV minimal (pas de dépendance externe) + conversion vers les
// objets attendus par saveEmployee(). Un salarié = une ligne, avec sa
// PREMIÈRE période contractuelle (CDD initial ou CDI) — les renouvellements
// et éléments complémentaires (primes, retenues, heures sup) s'ajoutent
// ensuite au cas par cas depuis la fiche salarié, comme aujourd'hui.
// Séparateur : point-virgule (compatible Excel FR) OU virgule, détecté
// automatiquement sur la ligne d'en-tête.
// ===========================================================================

export const CSV_COLUMNS = [
  'Nom', 'Matricule', 'CNPS', 'Emploi', 'Categorie', 'Situation', 'Enfants',
  'DateEmbauche', 'SalaireCategoriel', 'CompteBancaire', 'Email',
  'TypeContrat', 'DebutPeriode', 'SalaireBase', 'NetCible', 'Transport'
];

const SITUATIONS_VALIDES = ['celibataire', 'marie', 'divorce', 'veuf'];

// Découpe une ligne CSV en respectant les champs entre guillemets (avec
// guillemets doublés "" pour un guillemet littéral), séparateur `sep`.
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Parse un texte CSV complet en tableau d'objets { Colonne: valeur }, à
// partir de la ligne d'en-tête. Ignore les lignes vides.
export function parseCsv(text) {
  // Retire un éventuel BOM UTF-8 en tête de fichier (Excel).
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = splitCsvLine(lines[0], sep).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, sep);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

// Modèle CSV téléchargeable (en-tête + une ligne d'exemple).
export function employeesCsvTemplate() {
  const example = [
    'KOUAMÉ Adjoua Sylvie', 'SAL-010', '9988776 C', 'Vendeuse', 'Catégorie 3B',
    'marie', '2', '2026-01-15', '150000', '', 'adjoua.kouame@exemple.ci',
    'cdi', '2026-01', '150000', '190000', '30000'
  ];
  const lines = [CSV_COLUMNS.join(';'), example.join(';')];
  return '﻿' + lines.join('\r\n');
}

// Convertit les lignes CSV en objets « salarié » prêts pour saveEmployee().
// Renvoie { employees, errors } : errors = [{ ligne, message }] pour les
// lignes invalides (nom manquant, chiffres non numériques…), qui ne
// bloquent pas l'import des lignes valides.
export function employeesFromCsv(text) {
  const rows = parseCsv(text);
  const employees = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const ligne = idx + 2; // +2 : ligne 1 = en-tête, index 0-based
    const nom = (row.Nom || '').trim();
    if (!nom) { errors.push({ ligne, message: 'Nom manquant.' }); return; }

    const debutPeriode = (row.DebutPeriode || '').trim();
    if (!/^\d{4}-\d{2}$/.test(debutPeriode)) {
      errors.push({ ligne, message: `Début de période invalide ("${debutPeriode}", attendu aaaa-mm).` });
      return;
    }
    const salaireBase = Number(row.SalaireBase);
    if (!Number.isFinite(salaireBase) || salaireBase < 0) {
      errors.push({ ligne, message: `Salaire de base invalide ("${row.SalaireBase}").` });
      return;
    }
    const netCible = Number(row.NetCible);
    if (!Number.isFinite(netCible) || netCible < 0) {
      errors.push({ ligne, message: `Salaire NET cible invalide ("${row.NetCible}").` });
      return;
    }
    const situation = SITUATIONS_VALIDES.includes((row.Situation || '').trim())
      ? row.Situation.trim() : 'celibataire';
    const typeContrat = (row.TypeContrat || '').trim().toLowerCase() === 'cdi' ? 'cdi' : 'cdd';
    const dateEmbauche = /^\d{4}-\d{2}-\d{2}$/.test(row.DateEmbauche || '')
      ? row.DateEmbauche.trim() : `${debutPeriode}-01`;

    employees.push({
      nom,
      matricule: (row.Matricule || '').trim(),
      cnps: (row.CNPS || '').trim(),
      emploi: (row.Emploi || '').trim(),
      categorie: (row.Categorie || '').trim(),
      situation,
      enfants: Math.max(0, Math.floor(Number(row.Enfants) || 0)),
      dateEmbauche,
      salaireCategoriel: Number(row.SalaireCategoriel) || salaireBase,
      compteBancaire: (row.CompteBancaire || '').trim(),
      email: (row.Email || '').trim(),
      expatrie: false,
      periodes: [{
        kind: typeContrat,
        label: '',
        debut: debutPeriode,
        fin: '',
        salaireBase,
        netCible,
        transport: Number(row.Transport) || 0,
        primes: [],
        retenues: [],
        heuresSupplementaires: []
      }]
    });
  });

  return { employees, errors };
}
