import { afterEach, describe, expect, it } from 'vitest';
import {
  startDemo, stopDemo, getState, congesDeEmployee, ajouterCongePris, supprimerCongePris,
  isCycleCongesCloture, getCycleCongesCloture, cloturerCycleConges, rouvrirCycleConges
} from './db';

// Le mode démo (startDemo/stopDemo) rejoue toute la logique de db.js en
// mémoire, sans réseau — voir cloture.test.js pour le même principe côté
// clôture mensuelle de la paie.
describe('clôture des cycles de congés (par salarié)', () => {
  afterEach(() => stopDemo());

  it('cloturerCycleConges/rouvrirCycleConges font passer isCycleCongesCloture de faux à vrai puis à faux', async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001'); // embauché 2023-01-01
    expect(isCycleCongesCloture(emp.id, '2024-01')).toBe(false);

    await cloturerCycleConges(emp.id, '2024-01', { utilisateur: 'Test' });
    expect(isCycleCongesCloture(emp.id, '2024-01')).toBe(true);
    expect(getCycleCongesCloture(emp.id, '2024-01')).toMatchObject({ cloturePar: 'Test' });

    await rouvrirCycleConges(emp.id, '2024-01');
    expect(isCycleCongesCloture(emp.id, '2024-01')).toBe(false);
  });

  it("n'affecte pas un autre cycle du même salarié, ni un cycle clôturé d'un autre salarié", async () => {
    startDemo();
    const [e1, e2] = getState().employees;
    await cloturerCycleConges(e1.id, '2024-01', { utilisateur: 'Test' });
    expect(isCycleCongesCloture(e1.id, '2023-01')).toBe(false);
    expect(isCycleCongesCloture(e2.id, '2024-01')).toBe(false);
  });

  it('refuse d’ajouter un congé pris daté dans un cycle clôturé', async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    await cloturerCycleConges(emp.id, '2024-01', { utilisateur: 'Test' });

    await expect(
      ajouterCongePris(emp.id, { debut: '2024-06-01', fin: '2024-06-10', jours: 8 }, { utilisateur: 'Test' })
    ).rejects.toThrow(/errors\.congeCycleCloture/);
  });

  it('autorise un congé pris sur un cycle différent de celui clôturé', async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    await cloturerCycleConges(emp.id, '2024-01', { utilisateur: 'Test' });

    const id = await ajouterCongePris(emp.id, { debut: '2025-06-01', fin: '2025-06-10', jours: 8 }, { utilisateur: 'Test' });
    expect(congesDeEmployee(emp.id).some((c) => c.id === id)).toBe(true);
  });

  it('refuse de supprimer un congé pris déjà enregistré une fois son cycle clôturé', async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    const id = await ajouterCongePris(emp.id, { debut: '2024-06-01', fin: '2024-06-10', jours: 8 }, { utilisateur: 'Test' });

    await cloturerCycleConges(emp.id, '2024-01', { utilisateur: 'Test' });
    await expect(supprimerCongePris(id)).rejects.toThrow(/errors\.congeCycleCloture/);

    await rouvrirCycleConges(emp.id, '2024-01');
    await expect(supprimerCongePris(id)).resolves.toBeUndefined();
  });
});
