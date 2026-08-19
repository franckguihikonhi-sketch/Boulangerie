import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  anneesAnciennete, tauxAnciennete, nombreParts, ricf, impotBrut, its,
  detailHeuresSup, calculerBulletin, resoudreSursalaire, calculerDepuisNet,
  periodePourMois, periodeEffective, CDD_MAX_MOIS,
  joursCongeAnnuels, estMoisAnniversaire, congesEnCours,
  joursTravaillesMois, coefficientProrata,
  indemniteLicenciement, indemniteCongesNonPris, primePrecarite, indemnitePreavis,
  moisEntre, listerMois, moisPrecedent, libelleMois
} from './payroll';

// --------------------------- Ancienneté -------------------------------------

describe('anneesAnciennete', () => {
  it('compte les années pleines révolues', () => {
    expect(anneesAnciennete('2023-03-15', '2024-06-01')).toBe(1);
    expect(anneesAnciennete('2023-03-15', '2023-06-01')).toBe(0);
    expect(anneesAnciennete('2020-03-01', '2026-06-01')).toBe(6);
  });

  it('ne compte pas l\'année en cours avant la date anniversaire', () => {
    expect(anneesAnciennete('2020-06-15', '2026-06-01')).toBe(5);
    expect(anneesAnciennete('2020-06-15', '2026-06-15')).toBe(6);
  });

  it('renvoie 0 si les entrées sont invalides ou inversées', () => {
    expect(anneesAnciennete(null, '2026-01-01')).toBe(0);
    expect(anneesAnciennete('2026-01-01', '2020-01-01')).toBe(0);
  });
});

describe('tauxAnciennete', () => {
  it('0 % avant 2 ans, 2 % à 2 ans, +1 %/an ensuite, plafonné à 25 %', () => {
    expect(tauxAnciennete(0)).toBe(0);
    expect(tauxAnciennete(1)).toBe(0);
    expect(tauxAnciennete(2)).toBe(0.02);
    expect(tauxAnciennete(10)).toBe(0.10);
    expect(tauxAnciennete(25)).toBe(0.25);
    expect(tauxAnciennete(40)).toBe(0.25);
  });
});

// --------------------------- Parts / RICF -----------------------------------

describe('nombreParts', () => {
  it('marié(e) : 2 parts + 0,5 par enfant', () => {
    expect(nombreParts('marie', 0)).toBe(2);
    expect(nombreParts('marie', 2)).toBe(3);
  });

  it('célibataire sans enfant : 1 part ; dès le 1er enfant, 2 parts', () => {
    expect(nombreParts('celibataire', 0)).toBe(1);
    expect(nombreParts('celibataire', 1)).toBe(2);
    expect(nombreParts('celibataire', 2)).toBe(2.5);
  });

  it('plafonné à 5 parts', () => {
    expect(nombreParts('marie', 20)).toBe(5);
  });
});

describe('ricf', () => {
  it('0 pour 1 part, 11 000 FCFA par demi-part au-delà', () => {
    expect(ricf('celibataire', 0)).toBe(0);
    expect(ricf('marie', 0)).toBe(11000); // 2 parts
    expect(ricf('marie', 2)).toBe(22000); // 3 parts
  });
});

// --------------------------- ITS --------------------------------------------

describe('impotBrut (barème progressif ITS)', () => {
  it('0 % jusqu\'à 75 000', () => {
    expect(impotBrut(50000)).toBe(0);
    expect(impotBrut(75000)).toBe(0);
  });

  it('applique chaque tranche progressivement', () => {
    // 75 000 à 0% + (240000-75000) à 16% = 26400
    expect(impotBrut(240000)).toBe(26400);
  });

  it('gère un brut au-delà de la dernière tranche (32 %)', () => {
    const attendu = 0 + (240000 - 75000) * 0.16 + (800000 - 240000) * 0.21
      + (2400000 - 800000) * 0.24 + (8000000 - 2400000) * 0.28 + (9000000 - 8000000) * 0.32;
    expect(impotBrut(9000000)).toBe(Math.round(attendu));
  });
});

describe('its', () => {
  it('impôt brut moins RICF, jamais négatif', () => {
    expect(its(240000, 'marie', 2)).toBe(Math.max(0, 26400 - 22000));
    expect(its(50000, 'marie', 6)).toBe(0); // impôt brut nul, RICF élevé -> reste 0
  });
});

// --------------------------- Heures supplémentaires -------------------------

describe('detailHeuresSup', () => {
  it('calcule le montant de chaque ligne au taux horaire majoré', () => {
    const detail = detailHeuresSup(173330, [{ heures: 10, majoration: 0.15 }]);
    expect(detail[0].tauxHoraire).toBeCloseTo(1000, 0);
    expect(detail[0].montant).toBe(Math.round(1000 * 10 * 1.15));
  });

  it('ignore les heures négatives ou nulles', () => {
    expect(detailHeuresSup(150000, [{ heures: -5, majoration: 0.5 }])[0].heures).toBe(0);
  });
});

// --------------------------- calculerBulletin -------------------------------

describe('calculerBulletin', () => {
  const base = {
    salaireBase: 150000, sursalaire: 0, transport: 30000,
    situation: 'celibataire', enfants: 0, anciennete: 0
  };

  it('brut imposable = salaire de base + sursalaire + transport imposable (au-delà de l\'exonération)', () => {
    const calc = calculerBulletin({ ...base, transport: 50000 });
    expect(calc.transportExonere).toBe(30000);
    expect(calc.transportImposable).toBe(20000);
    expect(calc.brutImposable).toBe(150000 + 20000);
  });

  it('assiette retraite CNPS plafonnée à 3 375 000', () => {
    const calc = calculerBulletin({ ...base, salaireBase: 4000000, transport: 0 });
    expect(calc.baseCotisable).toBe(DEFAULT_PARAMS.plafondCnps);
  });

  it('assiette prestations familiales/AT plafonnée à 75 000', () => {
    const calc = calculerBulletin({ ...base, salaireBase: 500000, transport: 0 });
    expect(calc.basePfAt).toBe(DEFAULT_PARAMS.plafondPfAt);
  });

  it('coût employeur = brut total + total des charges patronales', () => {
    const calc = calculerBulletin(base);
    expect(calc.coutTotalEmployeur).toBe(calc.brutTotal + calc.totalPatronal);
  });

  it('impôt sur salaires expatriés uniquement si expatrie=true', () => {
    const local = calculerBulletin({ ...base, salaireBase: 500000 });
    const expat = calculerBulletin({ ...base, salaireBase: 500000, expatrie: true });
    expect(local.patronal.isExpatrie).toBe(0);
    expect(expat.patronal.isExpatrie).toBeGreaterThan(0);
  });

  it('prime d\'ancienneté = salaireCategoriel × taux, hors assiette si < 2 ans', () => {
    const calc = calculerBulletin({ ...base, salaireCategoriel: 200000, anciennete: 10 });
    expect(calc.primeAnciennete).toBe(20000); // 200000 * 10%
  });
});

// --------------------------- Résolution inverse (net -> sursalaire) --------

describe('resoudreSursalaire / calculerDepuisNet', () => {
  it('le net obtenu atteint la cible (à l\'unité près) quand un sursalaire positif est nécessaire', () => {
    const input = { salaireBase: 100000, transport: 30000, situation: 'celibataire', enfants: 0, anciennete: 0 };
    const calc = calculerDepuisNet(180000, input, DEFAULT_PARAMS);
    expect(calc.sursalaire).toBeGreaterThan(0);
    expect(Math.abs(calc.netAPayer - 180000)).toBeLessThanOrEqual(1);
  });

  it('sursalaire = 0 si le salaire de base seul dépasse déjà la cible', () => {
    const input = { salaireBase: 500000, transport: 0, situation: 'celibataire', enfants: 0, anciennete: 0 };
    const calc = calculerDepuisNet(100000, input, DEFAULT_PARAMS);
    expect(calc.sursalaire).toBe(0);
    expect(calc.netAPayer).toBeGreaterThan(100000);
  });

  it('congé payé et heures sup s\'ajoutent EN SUS du net cible (jamais absorbés par le sursalaire)', () => {
    const input = { salaireBase: 150000, transport: 30000, situation: 'celibataire', enfants: 0, anciennete: 0 };
    const sansExtra = calculerDepuisNet(200000, input, DEFAULT_PARAMS);
    const avecHeuresSup = calculerDepuisNet(200000, { ...input, heuresSupplementaires: [{ heures: 20, majoration: 0.5 }] }, DEFAULT_PARAMS);
    // Le sursalaire résolu doit être identique (résolu hors heures sup) : seul le
    // brut/net final change, le montant des heures sup s'ajoutant par-dessus.
    expect(avecHeuresSup.sursalaire).toBe(sansExtra.sursalaire);
    expect(avecHeuresSup.netAPayer).toBeGreaterThan(sansExtra.netAPayer);
  });
});

// --------------------------- Sélection de période / CDD -> CDI -------------

describe('periodePourMois', () => {
  const periodes = [
    { debut: '2023-01', fin: '2023-06' },
    { debut: '2023-07', fin: '2023-12' },
    { debut: '2024-01', fin: null }
  ];

  it('sélectionne la période couvrant le mois donné', () => {
    expect(periodePourMois(periodes, '2023-03').debut).toBe('2023-01');
    expect(periodePourMois(periodes, '2023-09').debut).toBe('2023-07');
    expect(periodePourMois(periodes, '2025-01').debut).toBe('2024-01');
  });

  it('renvoie null hors de toute période', () => {
    expect(periodePourMois(periodes, '2022-12')).toBeNull();
  });

  it('en cas de chevauchement, privilégie la période la plus récente', () => {
    const chevauchement = [{ debut: '2023-01', fin: null }, { debut: '2023-06', fin: null }];
    expect(periodePourMois(chevauchement, '2023-08').debut).toBe('2023-06');
  });
});

describe('periodeEffective (requalification CDD -> CDI après 24 mois)', () => {
  it('reste CDD tant que le cumul est sous 24 mois', () => {
    const employee = { periodes: [{ kind: 'cdd', debut: '2024-01', fin: null }] };
    const p = periodeEffective(employee, '2024-06');
    expect(p.kind).toBe('cdd');
    expect(p.requalifieCdi).toBe(false);
  });

  it(`requalifie automatiquement en CDI au-delà de ${CDD_MAX_MOIS} mois de CDD cumulés`, () => {
    const employee = { periodes: [{ kind: 'cdd', debut: '2023-01', fin: null }] };
    const p = periodeEffective(employee, '2025-06'); // > 24 mois depuis 2023-01
    expect(p.kind).toBe('cdi');
    expect(p.requalifieCdi).toBe(true);
  });

  it('ne requalifie jamais un CDI existant', () => {
    const employee = { periodes: [{ kind: 'cdi', debut: '2020-01', fin: null }] };
    expect(periodeEffective(employee, '2026-01').requalifieCdi).toBe(false);
  });
});

// --------------------------- Congés payés -----------------------------------

describe('joursCongeAnnuels', () => {
  it('base ≈ 26 jours, majorée par tranche d\'ancienneté', () => {
    expect(joursCongeAnnuels(0)).toBe(26);
    expect(joursCongeAnnuels(5)).toBe(27);
    expect(joursCongeAnnuels(10)).toBe(28);
    expect(joursCongeAnnuels(25)).toBe(33);
    expect(joursCongeAnnuels(30)).toBe(34);
    expect(joursCongeAnnuels(40)).toBe(34); // pas de palier au-delà de 30 ans
  });
});

describe('estMoisAnniversaire', () => {
  it('vrai seulement au mois d\'embauche, à partir d\'un an de service', () => {
    expect(estMoisAnniversaire('2023-03-10', '2024-03-01')).toBe(true);
    expect(estMoisAnniversaire('2023-03-10', '2023-03-01')).toBe(false); // même année, pas encore 1 an
    expect(estMoisAnniversaire('2023-03-10', '2024-04-01')).toBe(false); // mauvais mois
  });
});

describe('congesEnCours', () => {
  it('accumule 2,2 j/mois depuis le dernier anniversaire (ou l\'embauche)', () => {
    expect(congesEnCours('2024-01-15', '2024-01-01')).toBe(0);
    expect(congesEnCours('2024-01-15', '2024-07-01')).toBeCloseTo(13.2, 5); // 6 mois * 2.2
  });
});

// --------------------------- Prorata (méthode des 30èmes) ------------------

describe('joursTravaillesMois / coefficientProrata', () => {
  it('mois plein = 30 jours, coefficient 1', () => {
    expect(joursTravaillesMois(1, 30)).toBe(30);
    expect(coefficientProrata(30)).toBe(1);
  });

  it('entrée en cours de mois (ex. le 20) : jours restants', () => {
    expect(joursTravaillesMois(20, 30)).toBe(11);
    expect(coefficientProrata(11)).toBeCloseTo(11 / 30, 10);
  });

  it('sortie en cours de mois (ex. le 15)', () => {
    expect(joursTravaillesMois(1, 15)).toBe(15);
  });

  it('un jour 31 est ramené à 30 (convention)', () => {
    expect(joursTravaillesMois(1, 31)).toBe(30);
  });

  it('renvoie 0 si la sortie précède l\'entrée', () => {
    expect(joursTravaillesMois(20, 10)).toBe(0);
  });
});

// --------------------------- Solde de tout compte ---------------------------

describe('indemniteLicenciement (barème progressif par tranche)', () => {
  it('0 avant 1 an d\'ancienneté', () => {
    expect(indemniteLicenciement(200000, 0)).toBe(0);
  });

  it('30 % par an sur les 5 premières années', () => {
    expect(indemniteLicenciement(200000, 3)).toBe(Math.round(200000 * 0.30 * 3));
  });

  it('cumule les tranches 30/35/40 % au-delà de 5 et 10 ans', () => {
    // 5 ans à 30% + 3 ans à 35% = 1.5 + 1.05 = 2.55
    const attendu = Math.round(200000 * (5 * 0.30 + 3 * 0.35));
    expect(indemniteLicenciement(200000, 8)).toBe(attendu);
  });
});

describe('indemniteCongesNonPris', () => {
  it('salaire journalier (méthode des 30èmes) × jours restants', () => {
    expect(indemniteCongesNonPris(300000, 15)).toBe(Math.round((300000 / 30) * 15));
  });
});

describe('primePrecarite', () => {
  it('3 % du cumul brut CDD', () => {
    expect(primePrecarite(1000000)).toBe(30000);
  });
});

describe('indemnitePreavis', () => {
  it('salaire journalier × jours de préavis saisis', () => {
    expect(indemnitePreavis(300000, 30)).toBe(300000);
    expect(indemnitePreavis(300000, 0)).toBe(0);
  });
});

// --------------------------- Utilitaires mois -------------------------------

describe('moisEntre / listerMois / moisPrecedent', () => {
  it('moisEntre compte les mois inclusifs', () => {
    expect(moisEntre('2024-01', '2024-01')).toBe(1);
    expect(moisEntre('2024-01', '2024-12')).toBe(12);
  });

  it('listerMois énumère chaque mois entre deux bornes', () => {
    expect(listerMois('2024-11', '2025-02')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('moisPrecedent gère le passage d\'année', () => {
    expect(moisPrecedent('2024-01')).toBe('2023-12');
    expect(moisPrecedent('2024-07')).toBe('2024-06');
  });
});

describe('libelleMois', () => {
  it('produit un libellé lisible en français', () => {
    expect(libelleMois('2024-03', 'fr')).toMatch(/mars 2024/i);
  });
});
