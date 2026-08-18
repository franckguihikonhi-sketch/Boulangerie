import { describe, expect, it } from 'vitest';
import { bulletinData } from './bulletin';

const settings = {
  raisonSociale: 'Test SARL', employeurCnps: '', rccm: '', compteContribuable: '', activite: '',
  logoDataUrl: '', adresse: '', modePaiement: 'Virement',
  tauxAccidentTravail: 0.05, transportExonere: 30000
};

describe('bulletinData — continuité ancienneté à travers CDD -> CDI', () => {
  const employee = {
    nom: 'Test Continuité', matricule: 'T001', situation: 'celibataire', enfants: 0,
    cnps: '123456A', emploi: 'Agent', categorie: 'Cat 3', expatrie: false,
    dateEmbauche: '2023-03-15', salaireCategoriel: 150000,
    periodes: [
      { id: 'p1', kind: 'cdd', debut: '2023-03', fin: '2023-08', salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] },
      { id: 'p2', kind: 'cdd', debut: '2023-09', fin: '2025-02', salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] },
      { id: 'p3', kind: 'cdd', debut: '2025-03', fin: null, salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: [] }
    ]
  };

  it('ancienneté continue depuis la date d\'embauche d\'origine, quelle que soit la période active', () => {
    expect(bulletinData(employee, '2024-06', settings).anciennete).toBe(1);
    expect(bulletinData(employee, '2026-06', settings).anciennete).toBe(3);
  });

  it('requalifie automatiquement en CDI après 24 mois de CDD cumulés', () => {
    const b = bulletinData(employee, '2026-06', settings);
    expect(b.periode.kind).toBe('cdi');
    expect(b.periode.requalifieCdi).toBe(true);
  });
});

describe('bulletinData — prime ponctuelle (mois) vs récurrente', () => {
  const employee = {
    nom: 'Test Prime', matricule: 'T002', situation: 'celibataire', enfants: 0,
    cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2023-03-15', salaireCategoriel: 150000,
    periodes: [
      {
        id: 'p1', kind: 'cdd', debut: '2023-09', fin: '2025-02',
        salaireBase: 150000, netCible: 180000, transport: 30000,
        primes: [
          { label: 'Logement', montant: 20000, imposable: true, mois: null },
          { label: '13e mois', montant: 300000, imposable: true, mois: '2024-12' }
        ],
        retenues: [], heuresSupplementaires: []
      },
      {
        id: 'p2', kind: 'cdi', debut: '2025-03', fin: null,
        salaireBase: 150000, netCible: 180000, transport: 30000,
        primes: [{ label: 'Logement', montant: 20000, imposable: true, mois: null }],
        retenues: [], heuresSupplementaires: []
      }
    ]
  };

  it('une prime ponctuelle n\'apparaît que sur son mois exact', () => {
    const decembre = bulletinData(employee, '2024-12', settings);
    const janvier = bulletinData(employee, '2025-01', settings);
    expect(decembre.calc.primes.map((p) => p.label)).toEqual(['Logement', '13e mois']);
    expect(janvier.calc.primes.map((p) => p.label)).toEqual(['Logement']);
  });

  it('ne fuit pas dans l\'assiette de l\'indemnité de congé payé (1/12e) au-delà de son mois réel', () => {
    // 2024-03 : 1er anniversaire, avant le 13e mois de déc. 2024.
    // 2025-03 : 2e anniversaire, la référence (2024-03 à 2025-02) INCLUT le 13e mois.
    const congeAvant = bulletinData(employee, '2024-03', settings).calc.congePaye;
    const congeApres = bulletinData(employee, '2025-03', settings).calc.congePaye;
    const ratio = congeApres / congeAvant;
    // Sans le correctif (fuite du 13e mois sur les 12 mois), le ratio serait >> 2.
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.5);
  });
});

describe('bulletinData — prorata des mois incomplets', () => {
  it('mois d\'embauche en cours de mois : salaire proratisé (méthode des 30èmes)', () => {
    const employee = {
      nom: 'Entrée Mi-Mois', matricule: 'T010', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false,
      dateEmbauche: '2026-08-20', salaireCategoriel: 150000,
      periodes: [{
        id: 'p1', kind: 'cdi', debut: '2026-08', fin: null,
        salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: []
      }]
    };
    const aout = bulletinData(employee, '2026-08', settings);
    const septembre = bulletinData(employee, '2026-09', settings);
    expect(aout.calc.joursTravailles).toBe(11); // 30 - 20 + 1
    expect(aout.calc.coefficientProrata).toBeCloseTo(11 / 30, 10);
    expect(aout.calc.salaireBase).toBe(Math.round(150000 * 11 / 30));
    expect(septembre.calc.joursTravailles).toBe(30); // mois plein, comportement inchangé
    expect(septembre.calc.salaireBase).toBe(150000);
  });

  it('mois de sortie en cours de mois (finJour) : salaire proratisé, rien après la sortie', () => {
    const employee = {
      nom: 'Sortie Mi-Mois', matricule: 'T011', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2023-01-01', salaireCategoriel: 150000,
      periodes: [{
        id: 'p1', kind: 'cdi', debut: '2023-01', fin: '2026-08', finJour: 15,
        salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: []
      }]
    };
    const aout = bulletinData(employee, '2026-08', settings);
    const juillet = bulletinData(employee, '2026-07', settings);
    const septembre = bulletinData(employee, '2026-09', settings);
    expect(aout.calc.joursTravailles).toBe(15);
    expect(juillet.calc.joursTravailles).toBe(30);
    expect(juillet.calc.salaireBase).toBe(150000);
    expect(septembre).toBeNull(); // plus aucune période après la rupture
  });

  it('sans finJour, le mois de fin reste un mois plein (comportement historique)', () => {
    const employee = {
      nom: 'Sortie Fin de Mois', matricule: 'T012', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2023-01-01', salaireCategoriel: 150000,
      periodes: [{
        id: 'p1', kind: 'cdi', debut: '2023-01', fin: '2026-08',
        salaireBase: 150000, netCible: 180000, transport: 30000, primes: [], retenues: [], heuresSupplementaires: []
      }]
    };
    const aout = bulletinData(employee, '2026-08', settings);
    expect(aout.calc.joursTravailles).toBe(30);
    expect(aout.calc.salaireBase).toBe(150000);
  });
});

describe('bulletinData — mois hors contrat', () => {
  it('renvoie null si aucune période ne couvre le mois demandé', () => {
    const employee = {
      nom: 'Hors Contrat', matricule: 'T020', situation: 'celibataire', enfants: 0,
      cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '2024-01-01', salaireCategoriel: 100000,
      periodes: [{ id: 'p1', kind: 'cdd', debut: '2024-01', fin: '2024-06', salaireBase: 100000, netCible: 120000, transport: 0, primes: [], retenues: [], heuresSupplementaires: [] }]
    };
    expect(bulletinData(employee, '2023-12', settings)).toBeNull();
    expect(bulletinData(employee, '2024-07', settings)).toBeNull();
  });
});
