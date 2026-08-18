// ===========================================================================
// HISTORIQUE DES MODIFICATIONS — résumé lisible d'une entrée d'audit.
// ---------------------------------------------------------------------------
// Chaque entrée (voir db.js : saveEmployee/deleteEmployee) porte un
// instantané complet avant/après (jsonb). Le diff n'est calculé qu'à
// l'affichage, jamais à l'écriture : plus simple et facilement extensible
// (ajouter un champ au diff n'exige aucune migration de données passées).
// ===========================================================================

const CHAMPS_SIMPLES = [
  ['nom', 'Nom'], ['matricule', 'Matricule'], ['cnps', 'N° CNPS'], ['emploi', 'Emploi'],
  ['categorie', 'Catégorie'], ['situation', 'Situation matrimoniale'], ['enfants', 'Nombre d’enfants'],
  ['dateEmbauche', "Date d'embauche"], ['salaireCategoriel', 'Salaire catégoriel'],
  ['compteBancaire', 'Compte bancaire'], ['email', 'Email'], ['sousControle', 'Sous contrôle']
];

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
}

// Renvoie un tableau de lignes de texte décrivant ce qui a changé entre
// `entry.avant` et `entry.apres`. Jamais vide (retombe sur un message
// générique si aucun champ suivi n'a changé — ex. juste les primes/retenues,
// non détaillées ici pour rester lisible).
export function resumeAudit(entry) {
  const { avant, apres, action } = entry;
  if (action === 'create' || !avant) return ['Salarié créé.'];
  if (action === 'delete' || !apres) return ['Salarié supprimé.'];

  const lignes = [];
  for (const [key, label] of CHAMPS_SIMPLES) {
    const a = avant[key];
    const b = apres[key];
    if (String(a ?? '') !== String(b ?? '')) {
      lignes.push(`${label} : ${fmtVal(a)} → ${fmtVal(b)}`);
    }
  }

  const pa = avant.periodes || [];
  const pb = apres.periodes || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const a = pa[i];
    const b = pb[i];
    if (!a && b) { lignes.push(`Période #${i + 1} ajoutée (${(b.kind || '').toUpperCase()}, à partir de ${fmtVal(b.debut)}).`); continue; }
    if (a && !b) { lignes.push(`Période #${i + 1} supprimée.`); continue; }
    if (!a || !b) continue;
    if (a.salaireBase !== b.salaireBase) lignes.push(`Salaire de base (période #${i + 1}) : ${fmtVal(a.salaireBase)} → ${fmtVal(b.salaireBase)} FCFA`);
    if (a.netCible !== b.netCible) lignes.push(`Salaire NET cible (période #${i + 1}) : ${fmtVal(a.netCible)} → ${fmtVal(b.netCible)} FCFA`);
    if (a.transport !== b.transport) lignes.push(`Prime de transport (période #${i + 1}) : ${fmtVal(a.transport)} → ${fmtVal(b.transport)} FCFA`);
    if ((a.fin || '') !== (b.fin || '')) lignes.push(`Fin de contrat (période #${i + 1}) : ${fmtVal(a.fin)} → ${fmtVal(b.fin)}`);
  }

  return lignes.length ? lignes : ['Modification enregistrée (aucun champ principal suivi n’a changé — primes, retenues ou heures sup. probablement).'];
}
