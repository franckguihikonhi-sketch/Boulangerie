import { describe, expect, it } from 'vitest';
import { parseCsv, employeesFromCsv, employeesCsvTemplate, CSV_COLUMNS } from './csvImport';

describe('parseCsv', () => {
  it('détecte le séparateur point-virgule et découpe l\'en-tête', () => {
    const rows = parseCsv('A;B\r\nun;deux');
    expect(rows).toEqual([{ A: 'un', B: 'deux' }]);
  });

  it('détecte le séparateur virgule si pas de point-virgule', () => {
    const rows = parseCsv('A,B\nun,deux');
    expect(rows).toEqual([{ A: 'un', B: 'deux' }]);
  });

  it('gère les champs entre guillemets avec un séparateur littéral', () => {
    const rows = parseCsv('Nom;Ville\n"DUPONT; Jean";Abidjan');
    expect(rows[0].Nom).toBe('DUPONT; Jean');
  });

  it('gère les guillemets doublés (guillemet littéral)', () => {
    const rows = parseCsv('Nom\n"Le ""Grand"" Jean"');
    expect(rows[0].Nom).toBe('Le "Grand" Jean');
  });

  it('retire un BOM UTF-8 en tête de fichier', () => {
    const rows = parseCsv('﻿A;B\nun;deux');
    expect(Object.keys(rows[0])).toEqual(['A', 'B']);
  });

  it('ignore les lignes vides', () => {
    const rows = parseCsv('A;B\nun;deux\n\n');
    expect(rows).toHaveLength(1);
  });
});

describe('employeesCsvTemplate', () => {
  it('contient toutes les colonnes attendues dans l\'en-tête', () => {
    const template = employeesCsvTemplate();
    const [header] = template.replace(/^﻿/, '').split('\r\n');
    expect(header.split(';')).toEqual(CSV_COLUMNS);
  });
});

describe('employeesFromCsv', () => {
  const header = CSV_COLUMNS.join(';');

  it('convertit une ligne valide en objet salarié prêt pour saveEmployee', () => {
    const csv = [
      header,
      'KOUAMÉ Adjoua;SAL-01;123A;Vendeuse;Cat 3;marie;2;2026-01-15;150000;;a@b.ci;cdi;2026-01;150000;190000;30000'
    ].join('\n');
    const { employees, errors } = employeesFromCsv(csv);
    expect(errors).toHaveLength(0);
    expect(employees).toHaveLength(1);
    const e = employees[0];
    expect(e.nom).toBe('KOUAMÉ Adjoua');
    expect(e.situation).toBe('marie');
    expect(e.enfants).toBe(2);
    expect(e.email).toBe('a@b.ci');
    expect(e.periodes[0]).toMatchObject({ kind: 'cdi', debut: '2026-01', salaireBase: 150000, netCible: 190000, transport: 30000 });
  });

  it('rapporte une erreur si le nom est manquant, sans bloquer les autres lignes', () => {
    const csv = [
      header,
      ';;;;;;;;;;;cdi;2026-01;150000;190000;30000',
      'Salarié Valide;;;;;;;;;;;cdd;2026-01;100000;120000;0'
    ].join('\n');
    const { employees, errors } = employeesFromCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/nom manquant/i);
    expect(employees).toHaveLength(1);
    expect(employees[0].nom).toBe('Salarié Valide');
  });

  it('rapporte une erreur si DebutPeriode n\'est pas au format aaaa-mm', () => {
    const csv = [header, 'Test;;;;;;;;;;;cdi;2026-13-05;100000;120000;0'].join('\n');
    const { employees, errors } = employeesFromCsv(csv);
    expect(employees).toHaveLength(0);
    expect(errors[0].message).toMatch(/début de période invalide/i);
  });

  it('rapporte une erreur si SalaireBase ou NetCible n\'est pas un nombre valide', () => {
    const csv = [header, 'Test;;;;;;;;;;;cdi;2026-01;abc;120000;0'].join('\n');
    const { employees, errors } = employeesFromCsv(csv);
    expect(employees).toHaveLength(0);
    expect(errors[0].message).toMatch(/salaire de base invalide/i);
  });

  it('applique le défaut TypeContrat=cdd si absent ou inconnu', () => {
    const csv = [header, 'Test;;;;;;;;;;;xyz;2026-01;100000;120000;0'].join('\n');
    const { employees } = employeesFromCsv(csv);
    expect(employees[0].periodes[0].kind).toBe('cdd');
  });

  it('déduit dateEmbauche du début de période si absente/invalide', () => {
    const csv = [header, 'Test;;;;;;;;;;;cdi;2026-03;100000;120000;0'].join('\n');
    const { employees } = employeesFromCsv(csv);
    expect(employees[0].dateEmbauche).toBe('2026-03-01');
  });
});
