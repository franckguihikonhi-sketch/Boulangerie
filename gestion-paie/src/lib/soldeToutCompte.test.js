import { describe, expect, it } from 'vitest';
import { calculerSolde, MOTIFS_RUPTURE } from './soldeToutCompte';

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

describe('MOTIFS_RUPTURE', () => {
  it('couvre tous les motifs attendus, chacun avec une valeur unique', () => {
    const valeurs = MOTIFS_RUPTURE.map((m) => m.value);
    expect(new Set(valeurs).size).toBe(valeurs.length);
    expect(valeurs).toEqual(
      expect.arrayContaining(['licenciement', 'licenciement_economique', 'rupture_amiable', 'faute_lourde', 'demission', 'fin_cdd'])
    );
  });
});
