import { afterEach, describe, expect, it } from 'vitest';
import { startDemo, stopDemo, getState, cloturerMois, rouvrirMois, isMoisCloture } from './db';
import { saveEmployee } from './cloture';

// Le mode démo (startDemo/stopDemo) rejoue toute la logique de db.js en
// mémoire, sans réseau — c'est le seul moyen d'exercer les fonctions
// stateful de db.js (dont dépend cloture.js) en test, voir seedDemo.
describe('cloture — garde-fou mois clôturé', () => {
  afterEach(() => stopDemo());

  it('cloturerMois/rouvrirMois font passer isMoisCloture de faux à vrai puis à faux', async () => {
    startDemo();
    expect(isMoisCloture('2024-06')).toBe(false);
    await cloturerMois('2024-06', { utilisateur: 'Test' });
    expect(isMoisCloture('2024-06')).toBe(true);
    await rouvrirMois('2024-06');
    expect(isMoisCloture('2024-06')).toBe(false);
  });

  it("refuse une modification qui changerait le bulletin déjà calculé d'un mois clôturé", async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    await cloturerMois('2024-06', { utilisateur: 'Test' }); // couvert par le CDI en cours (depuis 2024-01)

    const payload = JSON.parse(JSON.stringify(emp));
    payload.periodes[payload.periodes.length - 1].salaireBase = 999999;

    await expect(saveEmployee(payload, { utilisateur: 'Test' })).rejects.toThrow(/clôtur/i);
  });

  it("autorise une modification qui ne touche pas la paie du mois clôturé (autre champ)", async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    await cloturerMois('2024-06', { utilisateur: 'Test' });

    const payload = JSON.parse(JSON.stringify(emp));
    payload.email = 'nouveau@email.test';

    await expect(saveEmployee(payload, { utilisateur: 'Test' })).resolves.toBeTruthy();
  });

  it('autorise à nouveau la modification après réouverture du mois', async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    await cloturerMois('2024-06', { utilisateur: 'Test' });
    await rouvrirMois('2024-06');

    const payload = JSON.parse(JSON.stringify(emp));
    payload.periodes[payload.periodes.length - 1].salaireBase = 999999;

    await expect(saveEmployee(payload, { utilisateur: 'Test' })).resolves.toBeTruthy();
  });

  it("n'affecte pas un mois clôturé différent de celui touché par la modification", async () => {
    startDemo();
    const emp = getState().employees.find((e) => e.matricule === 'SAL-001');
    // Clôture un mois AVANT la révision de salaire testée (2023, période CDD
    // distincte de celle modifiée) : ne doit pas bloquer la modification du
    // CDI 2024, qui ne le concerne pas.
    await cloturerMois('2023-02', { utilisateur: 'Test' });

    const payload = JSON.parse(JSON.stringify(emp));
    payload.periodes[payload.periodes.length - 1].salaireBase = 999999;

    await expect(saveEmployee(payload, { utilisateur: 'Test' })).resolves.toBeTruthy();
  });
});
