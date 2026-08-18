import { describe, expect, it } from 'vitest';
import { resumeAudit } from './audit';

describe('resumeAudit', () => {
  it('création : message générique, sans diff détaillé', () => {
    expect(resumeAudit({ action: 'create', avant: null, apres: { nom: 'X' } })).toEqual(['Salarié créé.']);
  });

  it('suppression : message générique', () => {
    expect(resumeAudit({ action: 'delete', avant: { nom: 'X' }, apres: null })).toEqual(['Salarié supprimé.']);
  });

  it('modification : détecte les champs simples changés', () => {
    const lignes = resumeAudit({
      action: 'update',
      avant: { nom: 'Ancien Nom', matricule: 'A1', enfants: 1 },
      apres: { nom: 'Nouveau Nom', matricule: 'A1', enfants: 2 }
    });
    expect(lignes.some((l) => l.includes('Nom') && l.includes('Ancien Nom') && l.includes('Nouveau Nom'))).toBe(true);
    expect(lignes.some((l) => l.includes('Nombre d’enfants') && l.includes('1') && l.includes('2'))).toBe(true);
    expect(lignes.some((l) => l.includes('Matricule'))).toBe(false); // inchangé -> pas de ligne
  });

  it('détecte un changement de salaire de base sur une période donnée', () => {
    const lignes = resumeAudit({
      action: 'update',
      avant: { periodes: [{ salaireBase: 100000, netCible: 130000, transport: 0, fin: null }] },
      apres: { periodes: [{ salaireBase: 120000, netCible: 130000, transport: 0, fin: null }] }
    });
    expect(lignes.some((l) => l.includes('Salaire de base') && l.includes('100000') && l.includes('120000'))).toBe(true);
    expect(lignes.some((l) => l.includes('Salaire NET cible'))).toBe(false);
  });

  it('signale l\'ajout et la suppression de périodes', () => {
    const ajout = resumeAudit({
      action: 'update',
      avant: { periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }] },
      apres: { periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }, { salaireBase: 1, netCible: 1, transport: 0, fin: null, kind: 'cdi', debut: '2026-01' }] }
    });
    expect(ajout.some((l) => l.includes('ajoutée'))).toBe(true);

    const suppr = resumeAudit({
      action: 'update',
      avant: { periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }, { salaireBase: 1, netCible: 1, transport: 0, fin: null }] },
      apres: { periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }] }
    });
    expect(suppr.some((l) => l.includes('supprimée'))).toBe(true);
  });

  it('renvoie un message générique si rien de suivi n\'a changé', () => {
    const lignes = resumeAudit({
      action: 'update',
      avant: { nom: 'X', periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }] },
      apres: { nom: 'X', periodes: [{ salaireBase: 1, netCible: 1, transport: 0, fin: null }] }
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatch(/aucun champ principal/i);
  });
});
