import { describe, expect, it } from 'vitest';
import { calculerSolde, MOTIFS_RUPTURE } from './soldeToutCompte';
import { roundFCFA } from './money';

const settings = {
  raisonSociale: 'Test SARL', employeurCnps: '', rccm: '', compteContribuable: '', activite: '',
  logoDataUrl: '', adresse: '', modePaiement: 'Virement',
  tauxAccidentTravail: 0.05, transportExonere: 30000
};

// Salarié CDI stable, embauché il y a 3 ans, salaire constant — sert de base
// à tous les scénarios de rupture ci-dessous.
function employeeStable(dateEmbauche = '2023-08-01') {
  return {
    nom: 'Test Solde', matricule: 'S001', situation: 'celibataire', enfants: 0,
    cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche, salaireCategoriel: 150000,
    periodes: [{
      id: 'p1', kind: 'cdi', debut: '2023-08', fin: null,
      salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: []
    }]
  };
}

describe('calculerSolde — licenciement', () => {
  it('inclut l\'indemnité de licenciement et l\'indemnité de congés non pris', () => {
    const solde = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings);
    expect(solde.licenciement).toBeGreaterThan(0);
    expect(solde.conges).toBeGreaterThan(0);
    expect(solde.precarite).toBe(0);
    expect(solde.total).toBe(solde.licenciement + solde.conges + solde.preavis);
  });

  it('ajoute l\'indemnité de préavis si des jours sont saisis', () => {
    const sansPreavis = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings);
    const avecPreavis = calculerSolde(employeeStable(), '2026-11', 'licenciement', 30, settings);
    expect(avecPreavis.preavis).toBeGreaterThan(sansPreavis.preavis);
    expect(avecPreavis.total).toBeGreaterThan(sansPreavis.total);
  });
});

describe('calculerSolde — faute lourde', () => {
  it('aucune indemnité de licenciement ni préavis, seuls les congés restent dus', () => {
    const solde = calculerSolde(employeeStable(), '2026-11', 'faute_lourde', 15, settings);
    expect(solde.licenciement).toBe(0);
    expect(solde.preavis).toBe(0); // motif non éligible au préavis, même si des jours sont saisis
    expect(solde.conges).toBeGreaterThan(0);
  });
});

describe('calculerSolde — démission', () => {
  it('aucune indemnité de licenciement ni préavis', () => {
    const solde = calculerSolde(employeeStable(), '2026-11', 'demission', 0, settings);
    expect(solde.licenciement).toBe(0);
    expect(solde.preavis).toBe(0);
    expect(solde.conges).toBeGreaterThan(0);
  });
});

describe('calculerSolde — fin de CDD', () => {
  it('applique la prime de précarité (3 %) mais pas l\'indemnité de licenciement', () => {
    const employee = {
      nom: 'Test CDD', matricule: 'S002', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2025-01-01', salaireCategoriel: 100000,
      periodes: [{
        id: 'p1', kind: 'cdd', debut: '2025-01', fin: '2026-06',
        salaireBase: 100000, netCible: 120000, transport: 0, primes: [], retenues: [], heuresSupplementaires: []
      }]
    };
    const solde = calculerSolde(employee, '2026-06', 'fin_cdd', 0, settings);
    expect(solde.licenciement).toBe(0);
    expect(solde.precarite).toBeGreaterThan(0);
  });
});

describe('calculerSolde — rupture anticipée d\'un CDD (avant terme)', () => {
  function employeeCdd(fin = '2027-06') {
    return {
      nom: 'Test CDD anticipé', matricule: 'S003', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2025-01-01', salaireCategoriel: 100000,
      periodes: [{
        id: 'p1', kind: 'cdd', debut: '2025-01', fin,
        salaireBase: 100000, netCible: 120000, transport: 0, primes: [], retenues: [], heuresSupplementaires: []
      }]
    };
  }

  it('remplace l\'indemnité de licenciement par des dommages-intérêts égaux aux salaires restant au contrat', () => {
    // Sortie en 2026-06, terme prévu 2027-06 -> 12 mois restants (2026-07 à 2027-06).
    const solde = calculerSolde(employeeCdd('2027-06'), '2026-06', 'licenciement', 0, settings);
    expect(solde.ruptureAnticipeeCdd).toBe(true);
    expect(solde.moisRestantsCdd).toBe(12);
    expect(solde.licenciement).toBe(roundFCFA(solde.salaireMoyen * 12));
  });

  it('donne un résultat différent du barème CDI, à ancienneté équivalente', () => {
    const cdd = calculerSolde(employeeCdd('2027-06'), '2026-06', 'licenciement', 0, settings);
    const cdi = calculerSolde(employeeStable('2025-01-01'), '2026-06', 'licenciement', 0, settings);
    expect(cdd.licenciement).not.toBe(cdi.licenciement);
  });

  it('ne s\'applique pas à la fin normale du CDD (fin_cdd) : pas de dommages-intérêts, seulement la précarité', () => {
    const solde = calculerSolde(employeeCdd('2026-06'), '2026-06', 'fin_cdd', 0, settings);
    expect(solde.ruptureAnticipeeCdd).toBe(false);
    expect(solde.licenciement).toBe(0);
    expect(solde.precarite).toBeGreaterThan(0);
  });

  it('sans date de terme connue, retombe sur le barème CDI plutôt que de rendre 0', () => {
    const solde = calculerSolde(employeeCdd(null), '2026-06', 'licenciement', 0, settings);
    expect(solde.ruptureAnticipeeCdd).toBe(false);
    expect(solde.licenciement).toBeGreaterThan(0);
  });
});

describe('calculerSolde — congés déjà pris nettés du cycle en cours à la sortie', () => {
  it('déduit les jours déjà pris sur le cycle de sortie de l\'indemnité de congés', () => {
    // Sortie 2026-11, embauche 2023-08-01 -> cycle de sortie 2026-08 → 2027-07.
    const sansConge = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings);
    const congesPris = [{ employeeId: 'x', debut: '2026-09-01', fin: '2026-09-10', jours: 5 }];
    const avecConge = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings, congesPris);

    expect(avecConge.joursAcquis).toBe(sansConge.joursConges);
    expect(avecConge.joursPrisCycle).toBe(5);
    expect(avecConge.joursConges).toBe(Math.round((sansConge.joursConges - 5) * 10) / 10);
    expect(avecConge.conges).toBeLessThan(sansConge.conges);
    expect(avecConge.total).toBe(avecConge.licenciement + avecConge.conges + avecConge.preavis);
  });

  it('ignore les congés pris sur un cycle antérieur à celui de la sortie', () => {
    const sansConge = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings);
    const congesPris = [{ employeeId: 'x', debut: '2024-01-01', fin: '2024-01-10', jours: 10 }];
    const avecConge = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings, congesPris);
    expect(avecConge.joursPrisCycle).toBe(0);
    expect(avecConge.joursConges).toBe(sansConge.joursConges);
    expect(avecConge.conges).toBe(sansConge.conges);
  });

  it('ne rend jamais un nombre de jours de congé négatif même si les jours pris dépassent les jours acquis', () => {
    const congesPris = [{ employeeId: 'x', debut: '2026-09-01', fin: '2026-09-30', jours: 9999 }];
    const solde = calculerSolde(employeeStable(), '2026-11', 'licenciement', 0, settings, congesPris);
    expect(solde.joursConges).toBe(0);
    expect(solde.conges).toBe(0);
  });
});

describe('MOTIFS_RUPTURE', () => {
  it('couvre tous les motifs attendus, chacun avec une valeur unique', () => {
    const valeurs = MOTIFS_RUPTURE.map((m) => m.value);
    expect(new Set(valeurs).size).toBe(valeurs.length);
    expect(valeurs).toEqual(
      expect.arrayContaining(['licenciement', 'licenciement_economique', 'rupture_amiable', 'faute_lourde', 'demission', 'fin_cdd'])
    );
  });
});
