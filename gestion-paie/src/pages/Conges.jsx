import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/I18nContext';
import { ajouterCongePris, supprimerCongePris, cloturerCycleConges, rouvrirCycleConges } from '../lib/db';
import { anneesAnciennete, congesEnCours, joursCongeAnnuels, cycleConges, listeCyclesConges, libelleMois } from '../lib/payroll';
import {
  Button, Card, PageTitle, Modal, Field, inputClass, ErrorNote, InfoNote,
  Badge, TableWrap, th, td
} from '../components/ui';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentYm() {
  return todayIso().slice(0, 7);
}

// Nombre décimal affiché à la française (« 13,20 j »), cohérent avec le
// bulletin de paie (voir bulletin.js) — jamais arrondi à l'entier, les jours
// de congé se comptent au dixième près.
const jr = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Calcule, pour un salarié et à la date du jour, tout ce qu'affiche l'onglet
// Congés : cycle d'acquisition en cours, jours déjà acquis à ce jour, droit
// annuel plein (avec majoration d'ancienneté), congés déjà pris SUR CE CYCLE
// et solde qui en découle. Un salarié sans date d'embauche n'a rien acquis.
function situationConges(employee, congesEmployee, ym) {
  const anciennete = anneesAnciennete(employee.dateEmbauche, `${ym}-01`);
  const cycle = cycleConges(employee.dateEmbauche, ym);
  const acquisCeJour = congesEnCours(employee.dateEmbauche, ym);
  const droitAnnuel = joursCongeAnnuels(anciennete);
  const congesCycle = cycle
    ? congesEmployee.filter((c) => c.debut.slice(0, 7) >= cycle.debut && c.debut.slice(0, 7) <= cycle.fin)
    : [];
  const joursPris = congesCycle.reduce((s, c) => s + (Number(c.jours) || 0), 0);
  // Solde disponible sur la base du droit ANNUEL PLEIN (pas seulement acquis
  // à ce jour) : une fois le cycle ouvert, l'employeur planifie généralement
  // la prise de congé sur l'ensemble du droit de l'année, pas seulement sur
  // le prorata déjà couru — voir la note affichée dans la page.
  const solde = Math.round((droitAnnuel - joursPris) * 10) / 10;
  return { anciennete, cycle, acquisCeJour, droitAnnuel, joursPris, solde };
}

// Même principe que ci-dessus, mais pour UN cycle donné (passé, en cours ou
// futur — voir listeCyclesConges) plutôt que le seul cycle en cours : sert à
// la clôture cycle par cycle. Un cycle entièrement écoulé est considéré
// intégralement acquis (droit annuel plein), un cycle futur n'a encore rien
// acquis, seul le cycle qui contient `ymRef` reste au prorata couru.
function situationCycle(employee, congesEmployee, cycle, ymRef) {
  const anciennete = anneesAnciennete(employee.dateEmbauche, `${cycle.debut}-01`);
  const droitAnnuel = joursCongeAnnuels(anciennete);
  const acquis = cycle.fin < ymRef ? droitAnnuel : cycle.debut > ymRef ? 0 : congesEnCours(employee.dateEmbauche, ymRef);
  const congesCycle = congesEmployee.filter((c) => c.debut.slice(0, 7) >= cycle.debut && c.debut.slice(0, 7) <= cycle.fin);
  const joursPris = congesCycle.reduce((s, c) => s + (Number(c.jours) || 0), 0);
  const solde = Math.round((droitAnnuel - joursPris) * 10) / 10;
  return { cycle, anciennete, droitAnnuel, acquis, joursPris, solde };
}

function emptyForm() {
  return { debut: '', fin: '', jours: '', commentaire: '' };
}

export default function Conges() {
  const { employees, congesPris, cyclesCongesClotures } = useStore();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const auditMeta = { utilisateur: user?.name || user?.email || '' };

  const ym = currentYm();
  const [gestion, setGestion] = useState(null); // employee en cours de gestion
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cycleError, setCycleError] = useState('');
  const [cycleActionId, setCycleActionId] = useState('');

  const lignes = useMemo(
    () =>
      employees.map((e) => {
        const congesEmployee = (congesPris || []).filter((c) => c.employeeId === e.id);
        return { employee: e, congesEmployee, situation: situationConges(e, congesEmployee, ym) };
      }),
    [employees, congesPris, ym]
  );

  const ouvrirGestion = (employee) => {
    setError('');
    setCycleError('');
    setForm(emptyForm());
    setGestion(employee);
  };

  const congesGestion = gestion ? (congesPris || []).filter((c) => c.employeeId === gestion.id) : [];
  const situationGestion = gestion ? situationConges(gestion, congesGestion, ym) : null;

  const clotureDe = (employeeId, cycleDebut) =>
    (cyclesCongesClotures || []).find((c) => c.employeeId === employeeId && c.cycleDebut === cycleDebut) || null;

  const cyclesGestion = useMemo(() => {
    if (!gestion) return [];
    return listeCyclesConges(gestion.dateEmbauche, ym)
      .map((cycle) => ({
        ...situationCycle(gestion, congesGestion, cycle, ym),
        cloture: clotureDe(gestion.id, cycle.debut)
      }))
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestion, congesGestion, ym, cyclesCongesClotures]);

  const basculerCloture = async (cycle) => {
    if (!gestion) return;
    const confirmMsg = cycle.cloture ? t('conges.rouvrirCycleConfirm') : t('conges.cloturerCycleConfirm');
    if (!window.confirm(confirmMsg)) return;
    setCycleError('');
    setCycleActionId(cycle.cycle.debut);
    try {
      if (cycle.cloture) await rouvrirCycleConges(gestion.id, cycle.cycle.debut);
      else await cloturerCycleConges(gestion.id, cycle.cycle.debut, auditMeta);
    } catch (err) {
      setCycleError(t(err.message) || err.message);
    } finally {
      setCycleActionId('');
    }
  };

  const ajouter = async (evt) => {
    evt.preventDefault();
    setError('');
    if (!form.debut || !form.fin) { setError(t('conges.datesRequired')); return; }
    if (form.fin < form.debut) { setError(t('conges.datesInvalides')); return; }
    const jours = Number(form.jours);
    if (!(jours > 0)) { setError(t('conges.joursInvalides')); return; }
    setSaving(true);
    try {
      await ajouterCongePris(gestion.id, { debut: form.debut, fin: form.fin, jours, commentaire: form.commentaire }, auditMeta);
      setForm(emptyForm());
    } catch (err) {
      setError(t(err.message) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const supprimer = async (id) => {
    if (!window.confirm(t('conges.supprimerConfirm'))) return;
    try {
      await supprimerCongePris(id);
    } catch (err) {
      window.alert(t(err.message) || err.message);
    }
  };

  return (
    <div>
      <PageTitle>{t('conges.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('conges.subtitle')}</p>
      <InfoNote>{t('conges.help')}</InfoNote>

      <Card className="mt-4">
        {employees.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-500">{t('employees.empty')}</p>
        ) : (
          <TableWrap min={860}>
            <thead>
              <tr className="border-b border-stone-200">
                <th className={th}>{t('employees.name')}</th>
                <th className={`${th} text-right`}>{t('conges.anciennete')}</th>
                <th className={th}>{t('conges.cycle')}</th>
                <th className={`${th} text-right`}>{t('conges.acquisCeJour')}</th>
                <th className={`${th} text-right`}>{t('conges.droitAnnuel')}</th>
                <th className={`${th} text-right`}>{t('conges.joursPris')}</th>
                <th className={`${th} text-right`}>{t('conges.solde')}</th>
                <th className={`${th} text-right`}>{t('employees.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lignes.map(({ employee: e, situation: s }) => (
                <tr key={e.id} className={e.sousControle ? 'bg-red-50/70' : undefined}>
                  <td className={td}>
                    <p className="font-medium text-stone-800">{e.nom}</p>
                    <p className="text-xs text-stone-500">{e.matricule || '—'}</p>
                  </td>
                  <td className={`${td} text-right`}>{s.anciennete} an(s)</td>
                  <td className={td}>
                    {s.cycle ? (
                      <span className="text-xs text-stone-500 capitalize">
                        {libelleMois(s.cycle.debut, locale)} → {libelleMois(s.cycle.fin, locale)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={`${td} text-right`}>{jr(s.acquisCeJour)} j</td>
                  <td className={`${td} text-right`}>{jr(s.droitAnnuel)} j</td>
                  <td className={`${td} text-right`}>{jr(s.joursPris)} j</td>
                  <td className={`${td} text-right font-semibold ${s.solde < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                    {jr(s.solde)} j
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => ouvrirGestion(e)}>
                      {t('conges.gerer')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {gestion && (
        <Modal title={t('conges.modalTitle', { nom: gestion.nom })} onClose={() => setGestion(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-stone-500">{t('conges.acquisCeJour')}</p>
                <p className="text-sm font-semibold text-stone-800">{jr(situationGestion.acquisCeJour)} j</p>
              </div>
              <div>
                <p className="text-xs text-stone-500">{t('conges.droitAnnuel')}</p>
                <p className="text-sm font-semibold text-stone-800">{jr(situationGestion.droitAnnuel)} j</p>
              </div>
              <div>
                <p className="text-xs text-stone-500">{t('conges.joursPris')}</p>
                <p className="text-sm font-semibold text-stone-800">{jr(situationGestion.joursPris)} j</p>
              </div>
              <div>
                <p className="text-xs text-stone-500">{t('conges.solde')}</p>
                <p className={`text-sm font-semibold ${situationGestion.solde < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                  {jr(situationGestion.solde)} j
                </p>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <h3 className="mb-1 text-sm font-semibold text-stone-800">{t('conges.cyclesTitle')}</h3>
              <p className="mb-2 text-xs text-stone-500">{t('conges.cyclesHelp')}</p>
              <ErrorNote>{cycleError}</ErrorNote>
              <TableWrap min={640}>
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className={th}>{t('conges.cycleColonne')}</th>
                    <th className={`${th} text-right`}>{t('conges.droitAnnuel')}</th>
                    <th className={`${th} text-right`}>{t('conges.joursPris')}</th>
                    <th className={`${th} text-right`}>{t('conges.solde')}</th>
                    <th className={th}>{t('conges.statutColonne')}</th>
                    <th className={`${th} text-right`}>{t('employees.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {cyclesGestion.map((c) => {
                    const estCourant = c.cycle.debut <= ym && ym <= c.cycle.fin;
                    return (
                      <tr key={c.cycle.debut}>
                        <td className={td}>
                          <span className="text-xs text-stone-600 capitalize">
                            {libelleMois(c.cycle.debut, locale)} → {libelleMois(c.cycle.fin, locale)}
                          </span>
                          {estCourant && <>{' '}<Badge tone="brand">{t('conges.cycleEnCours')}</Badge></>}
                        </td>
                        <td className={`${td} text-right`}>{jr(c.droitAnnuel)} j</td>
                        <td className={`${td} text-right`}>{jr(c.joursPris)} j</td>
                        <td className={`${td} text-right font-semibold ${c.solde < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                          {jr(c.solde)} j
                        </td>
                        <td className={td}>
                          {c.cloture ? (
                            <Badge tone="neutral">
                              {t('conges.cycleClotureInfo', {
                                date: new Date(c.cloture.clotureLe).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US'),
                                par: c.cloture.cloturePar ? ` (${c.cloture.cloturePar})` : ''
                              })}
                            </Badge>
                          ) : (
                            <Badge tone="brand">{t('conges.cycleStatutOuvert')}</Badge>
                          )}
                        </td>
                        <td className={`${td} text-right whitespace-nowrap`}>
                          <button
                            className={`text-xs font-medium hover:underline ${c.cloture ? 'text-brand-700' : 'text-stone-600'}`}
                            disabled={cycleActionId === c.cycle.debut}
                            onClick={() => basculerCloture(c)}
                          >
                            {cycleActionId === c.cycle.debut ? t('conges.enregistrement') : c.cloture ? t('conges.rouvrirCycle') : t('conges.cloturerCycle')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </div>

            <form onSubmit={ajouter} className="space-y-3 border-t border-stone-100 pt-4">
              <h3 className="text-sm font-semibold text-stone-800">{t('conges.ajouterTitle')}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Field label={t('conges.debut')}>
                  <input className={inputClass} type="date" value={form.debut} onChange={(e) => setForm((f) => ({ ...f, debut: e.target.value }))} required />
                </Field>
                <Field label={t('conges.fin')}>
                  <input className={inputClass} type="date" value={form.fin} onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))} required />
                </Field>
                <Field label={t('conges.jours')}>
                  <input className={inputClass} type="number" min="0.5" step="0.5" value={form.jours} onChange={(e) => setForm((f) => ({ ...f, jours: e.target.value }))} required />
                </Field>
                <Field label={t('conges.commentaire')}>
                  <input className={inputClass} value={form.commentaire} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} placeholder={t('conges.commentairePlaceholder')} />
                </Field>
              </div>
              <ErrorNote>{error}</ErrorNote>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>{saving ? t('conges.enregistrement') : t('conges.ajouterConfirm')}</Button>
              </div>
            </form>

            <div className="border-t border-stone-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-stone-800">{t('conges.historiqueTitle')}</h3>
              {congesGestion.length === 0 ? (
                <InfoNote>{t('conges.historiqueEmpty')}</InfoNote>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {[...congesGestion].sort((a, b) => (a.debut < b.debut ? 1 : -1)).map((c) => {
                    const cycleDuConge = cycleConges(gestion.dateEmbauche, c.debut.slice(0, 7));
                    const verrouille = !!(cycleDuConge && clotureDe(gestion.id, cycleDuConge.debut));
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <div>
                          <p className="text-stone-800">
                            {c.debut} → {c.fin} · <strong>{jr(c.jours)} j</strong>
                            {!!(c.debut.slice(0, 7) < (situationGestion.cycle?.debut || '')) && (
                              <>{' '}<Badge tone="neutral">{t('conges.cycleAnterieur')}</Badge></>
                            )}
                            {verrouille && <>{' '}<Badge tone="neutral">{t('conges.cycleStatutCloture')}</Badge></>}
                          </p>
                          {c.commentaire && <p className="text-xs text-stone-500">{c.commentaire}</p>}
                        </div>
                        <button
                          className={`text-xs font-medium hover:underline ${verrouille ? 'cursor-not-allowed text-stone-300' : 'text-red-600'}`}
                          disabled={verrouille}
                          title={verrouille ? t('errors.congeCycleCloture') : undefined}
                          onClick={() => supprimer(c.id)}
                        >
                          {t('conges.supprimer')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end border-t border-stone-100 pt-3">
              <Button variant="secondary" onClick={() => setGestion(null)}>{t('common.close')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
