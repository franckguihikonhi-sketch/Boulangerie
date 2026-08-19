// ===========================================================================
// GARDE-FOU DE LA CLÔTURE MENSUELLE.
// ---------------------------------------------------------------------------
// Un mois « clôturé » (voir db.js : cloturerMois/rouvrirMois/isMoisCloture)
// signale que sa paie a été traitée et payée. Ce module enveloppe
// db.js#saveEmployee pour empêcher qu'une modification ultérieure d'un
// salarié (salaire, prime/retenue/heure sup ponctuelle, date de sortie…) ne
// change SILENCIEUSEMENT le bulletin déjà calculé d'un mois clôturé — les
// bulletins ne sont jamais figés en base (recalculés à la volée depuis les
// périodes/primes/retenues courantes, voir bulletin.js), donc sans ce
// garde-fou, éditer une période en cours modifierait rétroactivement TOUS
// les mois déjà payés qu'elle couvre.
//
// Toutes les pages doivent importer `saveEmployee` D'ICI (et non de db.js)
// pour bénéficier du garde-fou — signature strictement identique.
// ===========================================================================

import { getState, getEmployee, buildEmployee, saveEmployee as dbSaveEmployee } from './db';
import { bulletinData } from './bulletin';
import { libelleMois } from './payroll';

// Signature comparable du bulletin d'un salarié sur un mois donné (null si
// aucune période ne couvre ce mois) — deux appels avec le même résultat
// signifient que ce mois précis n'est pas affecté par la modification.
function signatureBulletin(employee, ym, settings) {
  if (!employee) return null;
  const bd = bulletinData(employee, ym, settings);
  return bd ? JSON.stringify(bd.calc) : null;
}

export async function saveEmployee(input, meta = {}) {
  const { clotures, settings } = getState();
  const moisClotures = Object.keys(clotures || {});
  if (input.id && moisClotures.length > 0) {
    const avant = getEmployee(input.id);
    if (avant) {
      // Compare les DEUX côtés normalisés de la même façon (arrondis FCFA,
      // mois vides -> null…) : évite les faux positifs dus à de simples
      // différences de formatage de saisie, ou à un état enregistré avant
      // l'ajout d'un champ normalisé (ex. données de démonstration).
      const avantNormalise = buildEmployee(avant);
      const apres = buildEmployee(input);
      const affectes = moisClotures
        .filter((ym) => signatureBulletin(avantNormalise, ym, settings) !== signatureBulletin(apres, ym, settings))
        .sort();
      if (affectes.length > 0) {
        const liste = affectes.map((ym) => libelleMois(ym)).join(', ');
        throw new Error(
          `Modification refusée : elle changerait la paie déjà clôturée de ${liste}. ` +
          `Rouvrez d'abord ce(s) mois depuis le Livre de paie pour pouvoir la faire, puis reclôturez-le(s).`
        );
      }
    }
  }
  return dbSaveEmployee(input, meta);
}
