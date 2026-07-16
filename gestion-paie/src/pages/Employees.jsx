import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { SITUATIONS, TYPES_CONTRAT, saveEmployee, deleteEmployee, uid } from '../lib/db';
import { periodeEffective, moisPrecedent } from '../lib/payroll';
import { formatFCFA } from '../lib/money';
import {
  Button, Card, PageTitle, Modal, Field, inputClass, ErrorNote, InfoNote,
  Badge, TableWrap, th, td
} from '../components/ui';

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const emptyPeriode = (kind = 'cdd') => ({
  id: uid(), kind, label: '', debut: '', fin: '', salaireBase: '', netCible: '', transport: 30000, primes: []
});

function emptyForm() {
  return {
    id: null, matricule: '', nom: '', situation: 'celibataire', enfants: 0,
    cnps: '', emploi: '', expatrie: false, dateEmbauche: '', salaireCategoriel: '',
    sousControle: false, controleMotif: '', controleDepuis: null,
    periodes: [emptyPeriode('cdd')]
  };
}

function fromEmployee(e) {
  return {
    id: e.id, matricule: e.matricule, nom: e.nom, situation: e.situation,
    enfants: e.enfants, cnps: e.cnps, emploi: e.emploi, expatrie: e.expatrie === true,
    dateEmbauche: e.dateEmbauche, salaireCategoriel: e.salaireCategoriel,
    sousControle: e.sousControle === true, controleMotif: e.controleMotif || '', controleDepuis: e.controleDepuis || null,
    periodes: e.periodes.map((p) => ({ ...p, fin: p.fin || '', primes: p.primes.map((pr) => ({ ...pr })) }))
  };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Employees() {
  const { employees } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  // Action rapide « Mettre fin au contrat » (CDD arrivé à terme OU
  // licenciement CDI) : même mécanisme (fixer la date de fin de la dernière
  // période), déclenché salarié par salarié depuis la liste.
  const [terminate, setTerminate] = useState(null); // { employee, mode: 'cdd' | 'cdi' }
  const [terminateDate, setTerminateDate] = useState('');
  const [terminateError, setTerminateError] = useState('');
  const [terminateSaving, setTerminateSaving] = useState(false);
  // Action rapide « Réviser le salaire » : clôture la période en cours à la
  // veille du mois choisi et ouvre une nouvelle période (même type de
  // contrat) à partir de ce mois avec le nouveau salaire NET. Permet de
  // pointer, année après année, le salaire NET réellement versé — utile pour
  // tirer les bulletins en lot d'un salarié présent depuis plusieurs années
  // dont le net a varié d'une année à l'autre. Plusieurs révisions peuvent
  // être saisies d'un coup (une ligne par année) et sont appliquées
  // ensemble, dans l'ordre chronologique, en une seule sauvegarde.
  const emptyRevision = () => ({ id: uid(), date: '', net: '' });
  const [revise, setRevise] = useState(null); // employee
  const [revisions, setRevisions] = useState([emptyRevision()]);
  const [reviseError, setReviseError] = useState('');
  const [reviseSaving, setReviseSaving] = useState(false);
  const ym = currentYm();

  const openNew = () => { setError(''); setForm(emptyForm()); };
  const openEdit = (e) => { setError(''); setForm(fromEmployee(e)); };

  const openTerminate = (e, mode) => { setTerminateError(''); setTerminateDate(ym); setTerminate({ employee: e, mode }); };

  const confirmTerminate = async (evt) => {
    evt.preventDefault();
    if (!terminateDate) return;
    setTerminateError('');
    setTerminateSaving(true);
    try {
      const payload = fromEmployee(terminate.employee);
      const last = payload.periodes.length - 1;
      payload.periodes = payload.periodes.map((p, idx) => (idx === last ? { ...p, fin: terminateDate } : p));
      await saveEmployee(payload);
      setTerminate(null);
    } catch (err) {
      setTerminateError(t(err.message) || err.message);
    } finally {
      setTerminateSaving(false);
    }
  };

  const openRevise = (e) => {
    setReviseError('');
    setRevisions([emptyRevision()]);
    setRevise(e);
  };

  const addRevisionRow = () => setRevisions((rs) => [...rs, emptyRevision()]);
  const removeRevisionRow = (i) => setRevisions((rs) => rs.filter((_, idx) => idx !== i));
  const setRevisionField = (i, patch) =>
    setRevisions((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const confirmRevise = async (evt) => {
    evt.preventDefault();
    setReviseError('');
    const entries = revisions.filter((r) => r.date && r.net);
    if (entries.length === 0) return;
    // Applique les révisions dans l'ordre chronologique, quel que soit
    // l'ordre de saisie des lignes : chacune clôture la période « en cours »
    // à ce stade et en ouvre une nouvelle avec le nouveau net.
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const payload = fromEmployee(revise);
    let lastIdx = payload.periodes.length - 1;
    for (const entry of sorted) {
      const last = payload.periodes[lastIdx];
      if (entry.date <= last.debut) {
        setReviseError(t('employees.reviseDateError'));
        return;
      }
      const closed = { ...last, fin: moisPrecedent(entry.date) };
      const next = {
        ...last,
        id: uid(),
        label: '',
        debut: entry.date,
        fin: '',
        netCible: entry.net,
        primes: last.primes.map((pr) => ({ ...pr }))
      };
      payload.periodes = [...payload.periodes.slice(0, lastIdx), closed, next];
      lastIdx = payload.periodes.length - 1;
    }
    setReviseSaving(true);
    try {
      await saveEmployee(payload);
      setRevise(null);
    } catch (err) {
      setReviseError(t(err.message) || err.message);
    } finally {
      setReviseSaving(false);
    }
  };

  // Action rapide « Marquer / lever le contrôle » : signale un salarié dont
  // le dossier doit faire l'objet d'une vérification approfondie avant tout
  // traitement de paie. Purement déclaratif côté saisie (motif, date), mais
  // BLOQUANT à l'usage : tant qu'un salarié est marqué, ses bulletins (et les
  // états agrégés qui en dépendent) ne peuvent pas être générés — voir
  // Bulletins.jsx / LivrePaie.jsx / Cotisations.jsx / Impots.jsx.
  const [controle, setControle] = useState(null); // employee
  const [controleMotifInput, setControleMotifInput] = useState('');
  const [controleError, setControleError] = useState('');
  const [controleSaving, setControleSaving] = useState(false);

  const openControle = (e) => { setControleError(''); setControleMotifInput(''); setControle(e); };

  const confirmControle = async (evt) => {
    evt.preventDefault();
    setControleError('');
    setControleSaving(true);
    try {
      const payload = fromEmployee(controle);
      payload.sousControle = true;
      payload.controleMotif = controleMotifInput.trim();
      payload.controleDepuis = todayIso();
      await saveEmployee(payload);
      setControle(null);
    } catch (err) {
      setControleError(t(err.message) || err.message);
    } finally {
      setControleSaving(false);
    }
  };

  const leverControle = async (e) => {
    if (!window.confirm(t('employees.leverControleConfirm', { nom: e.nom }))) return;
    try {
      const payload = fromEmployee(e);
      payload.sousControle = false;
      payload.controleMotif = '';
      payload.controleDepuis = null;
      await saveEmployee(payload);
    } catch (err) {
      window.alert(t(err.message) || err.message);
    }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setPeriode = (i, patch) =>
    setForm((f) => ({ ...f, periodes: f.periodes.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));

  const addPeriode = () =>
    setForm((f) => ({ ...f, periodes: [...f.periodes, emptyPeriode(f.periodes.length ? 'cdd' : 'cdd')] }));

  const removePeriode = (i) =>
    setForm((f) => ({ ...f, periodes: f.periodes.filter((_, idx) => idx !== i) }));

  const addPrime = (i) =>
    setPeriode(i, { primes: [...form.periodes[i].primes, { label: '', montant: '', imposable: true }] });

  const setPrime = (i, j, patch) =>
    setPeriode(i, {
      primes: form.periodes[i].primes.map((pr, idx) => (idx === j ? { ...pr, ...patch } : pr))
    });

  const removePrime = (i, j) =>
    setPeriode(i, { primes: form.periodes[i].primes.filter((_, idx) => idx !== j) });

  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await saveEmployee(form);
      setForm(null);
    } catch (err) {
      setError(t(err.message) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('employees.deleteConfirm'))) return;
    try {
      await deleteEmployee(id);
    } catch (err) {
      window.alert(t(err.message) || err.message);
    }
  };

  return (
    <div>
      <PageTitle actions={<Button onClick={openNew}>{t('employees.add')}</Button>}>
        {t('employees.title')}
      </PageTitle>

      <Card>
        {employees.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-500">{t('employees.empty')}</p>
        ) : (
          <TableWrap min={720}>
            <thead>
              <tr className="border-b border-stone-200">
                <th className={th}>{t('employees.name')}</th>
                <th className={th}>{t('employees.emploi')}</th>
                <th className={th}>{t('employees.situation')}</th>
                <th className={th}>{t('employees.contract')}</th>
                <th className={`${th} text-right`}>{t('employees.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {employees.map((e) => {
                const p = periodeEffective(e, ym) || e.periodes[e.periodes.length - 1];
                return (
                  <tr key={e.id} className={e.sousControle ? 'bg-red-50/70' : undefined}>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-stone-800">{e.nom}</p>
                        {e.sousControle && (
                          <Badge tone="danger">{t('employees.sousControle')}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-stone-500">{e.matricule || '—'} · {e.cnps || '—'}</p>
                      {e.sousControle && (e.controleMotif || e.controleDepuis) && (
                        <p className="mt-0.5 text-xs text-red-700">
                          {e.controleMotif && <span>{e.controleMotif}</span>}
                          {e.controleDepuis && <span className="text-red-500"> · {t('employees.controleDepuis')} {e.controleDepuis}</span>}
                        </p>
                      )}
                    </td>
                    <td className={td}>{e.emploi || '—'}</td>
                    <td className={td}>
                      {t('situation.' + e.situation)}
                      <span className="text-stone-400"> · {e.enfants} enf.</span>
                    </td>
                    <td className={td}>
                      <Badge tone={p?.kind === 'cdi' ? 'success' : 'warning'}>
                        {p ? t('contract.' + p.kind) : '—'}
                      </Badge>
                      {p && <span className="ml-2 text-xs text-stone-500">{formatFCFA(p.netCible)}</span>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => navigate('/bulletins?e=' + e.id)}>
                        {t('employees.view')}
                      </button>
                      <button className="ml-3 text-sm font-medium text-stone-600 hover:underline" onClick={() => openEdit(e)}>
                        {t('employees.edit')}
                      </button>
                      <button className="ml-3 text-sm font-medium text-brand-700 hover:underline" onClick={() => openRevise(e)}>
                        {t('employees.revise')}
                      </button>
                      {p?.kind === 'cdd' && !p.fin && (
                        <button className="ml-3 text-sm font-medium text-amber-700 hover:underline" onClick={() => openTerminate(e, 'cdd')}>
                          {t('employees.endCdd')}
                        </button>
                      )}
                      {p?.kind === 'cdi' && !p.fin && (
                        <button className="ml-3 text-sm font-medium text-red-700 hover:underline" onClick={() => openTerminate(e, 'cdi')}>
                          {t('employees.licenciement')}
                        </button>
                      )}
                      {e.sousControle ? (
                        <button className="ml-3 text-sm font-medium text-emerald-700 hover:underline" onClick={() => leverControle(e)}>
                          {t('employees.leverControle')}
                        </button>
                      ) : (
                        <button className="ml-3 text-sm font-medium text-orange-700 hover:underline" onClick={() => openControle(e)}>
                          {t('employees.marquerControle')}
                        </button>
                      )}
                      <button className="ml-3 text-sm font-medium text-red-600 hover:underline" onClick={() => remove(e.id)}>
                        {t('employees.delete')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {controle && (
        <Modal title={t('employees.marquerControleTitle')} onClose={() => setControle(null)}>
          <form onSubmit={confirmControle} className="space-y-4">
            <p className="text-sm text-stone-600">{t('employees.marquerControleHelp', { nom: controle.nom })}</p>
            <Field label={t('employees.controleMotif')} help={t('employees.controleMotifHelp')}>
              <textarea
                className={inputClass}
                rows={3}
                value={controleMotifInput}
                onChange={(e) => setControleMotifInput(e.target.value)}
                placeholder={t('employees.controleMotifPlaceholder')}
              />
            </Field>
            <ErrorNote>{controleError}</ErrorNote>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setControle(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={controleSaving}>{t('employees.marquerControleConfirm')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {revise && (
        <Modal title={t('employees.reviseTitle')} onClose={() => setRevise(null)} wide>
          <form onSubmit={confirmRevise} className="space-y-4">
            <p className="text-sm text-stone-600">{t('employees.reviseHelp', { nom: revise.nom })}</p>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-stone-600">
                <span>{t('employees.reviseFrom')}</span>
                <span>{t('employees.reviseNet')}</span>
                <span />
              </div>
              {revisions.map((r, i) => (
                <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <input
                    className={inputClass}
                    type="month"
                    value={r.date}
                    onChange={(e) => setRevisionField(i, { date: e.target.value })}
                    required
                  />
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    value={r.net}
                    onChange={(e) => setRevisionField(i, { net: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                    onClick={() => removeRevisionRow(i)}
                    disabled={revisions.length === 1}
                    aria-label={t('period.remove')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={addRevisionRow}>
              + {t('employees.reviseAddRow')}
            </button>

            <ErrorNote>{reviseError}</ErrorNote>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setRevise(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={reviseSaving}>{t('employees.reviseConfirm')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {terminate && (
        <Modal
          title={t(terminate.mode === 'cdi' ? 'employees.licenciementTitle' : 'employees.endCddTitle')}
          onClose={() => setTerminate(null)}
        >
          <form onSubmit={confirmTerminate} className="space-y-4">
            <p className="text-sm text-stone-600">
              {t(terminate.mode === 'cdi' ? 'employees.licenciementHelp' : 'employees.endCddHelp', { nom: terminate.employee.nom })}
            </p>
            <Field label={t('period.fin')}>
              <input className={inputClass} type="month" value={terminateDate} onChange={(e) => setTerminateDate(e.target.value)} required />
            </Field>
            <ErrorNote>{terminateError}</ErrorNote>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setTerminate(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={terminateSaving}>
                {t(terminate.mode === 'cdi' ? 'employees.licenciementConfirm' : 'employees.endCddConfirm')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {form && (
        <Modal title={form.id ? t('employees.edit') : t('employees.add')} onClose={() => setForm(null)} wide>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('employees.name')}>
                <input className={inputClass} value={form.nom} onChange={(e) => setField('nom', e.target.value)} required />
              </Field>
              <Field label={t('employees.matricule')}>
                <input className={inputClass} value={form.matricule} onChange={(e) => setField('matricule', e.target.value)} />
              </Field>
              <Field label={t('employees.situation')}>
                <select className={inputClass} value={form.situation} onChange={(e) => setField('situation', e.target.value)}>
                  {SITUATIONS.map((s) => <option key={s} value={s}>{t('situation.' + s)}</option>)}
                </select>
              </Field>
              <Field label={t('employees.children')}>
                <input className={inputClass} type="number" min="0" value={form.enfants} onChange={(e) => setField('enfants', e.target.value)} />
              </Field>
              <Field label={t('employees.cnps')}>
                <input className={inputClass} value={form.cnps} onChange={(e) => setField('cnps', e.target.value)} />
              </Field>
              <Field label={t('employees.emploi')}>
                <input className={inputClass} value={form.emploi} onChange={(e) => setField('emploi', e.target.value)} />
              </Field>
              <Field label={t('employees.dateEmbauche')} help={t('employees.dateEmbaucheHelp')}>
                <input className={inputClass} type="date" value={form.dateEmbauche} onChange={(e) => setField('dateEmbauche', e.target.value)} />
              </Field>
              <Field label={t('employees.salaireCategoriel')} help={t('employees.salaireCategorielHelp')}>
                <input className={inputClass} type="number" min="0" value={form.salaireCategoriel} onChange={(e) => setField('salaireCategoriel', e.target.value)} placeholder="auto" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700">
                <input type="checkbox" checked={form.expatrie} onChange={(e) => setField('expatrie', e.target.checked)} />
                {t('employees.expatrie')}
              </label>
            </div>

            <div className="border-t border-stone-100 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-800">{t('employees.periods')}</h3>
                <Button type="button" variant="secondary" onClick={addPeriode}>+ {t('employees.addPeriod')}</Button>
              </div>
              <InfoNote>{t('employees.periodsHelp')}</InfoNote>

              <div className="mt-3 space-y-3">
                {form.periodes.map((p, i) => (
                  <div key={p.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">#{i + 1}</span>
                      {form.periodes.length > 1 && (
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removePeriode(i)}>
                          {t('period.remove')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label={t('period.kind')}>
                        <select className={inputClass} value={p.kind} onChange={(e) => setPeriode(i, { kind: e.target.value })}>
                          {TYPES_CONTRAT.map((k) => <option key={k} value={k}>{t('contract.' + k)}</option>)}
                        </select>
                      </Field>
                      <Field label={t('period.label')}>
                        <input className={inputClass} value={p.label} onChange={(e) => setPeriode(i, { label: e.target.value })} placeholder={t('period.labelPlaceholder')} />
                      </Field>
                      <Field label={t('period.debut')}>
                        <input className={inputClass} type="month" value={p.debut} onChange={(e) => setPeriode(i, { debut: e.target.value })} required />
                      </Field>
                      <Field label={t('period.fin')} help={t('period.finHelp')}>
                        <input className={inputClass} type="month" value={p.fin} onChange={(e) => setPeriode(i, { fin: e.target.value })} />
                      </Field>
                      <Field label={t('period.salaireBase')}>
                        <input className={inputClass} type="number" min="0" value={p.salaireBase} onChange={(e) => setPeriode(i, { salaireBase: e.target.value })} required />
                      </Field>
                      <Field label={t('period.netCible')}>
                        <input className={inputClass} type="number" min="0" value={p.netCible} onChange={(e) => setPeriode(i, { netCible: e.target.value })} required />
                      </Field>
                      <Field label={t('period.transport')}>
                        <input className={inputClass} type="number" min="0" value={p.transport} onChange={(e) => setPeriode(i, { transport: e.target.value })} />
                      </Field>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{t('period.netCibleHelp')}</p>

                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-600">{t('period.primes')}</span>
                        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => addPrime(i)}>
                          + {t('period.addPrime')}
                        </button>
                      </div>
                      {p.primes.map((pr, j) => (
                        <div key={j} className="mb-1 flex items-center gap-2">
                          <input className={inputClass + ' flex-1'} value={pr.label} onChange={(e) => setPrime(i, j, { label: e.target.value })} placeholder={t('period.primeLabel')} />
                          <input className={inputClass + ' w-28'} type="number" min="0" value={pr.montant} onChange={(e) => setPrime(i, j, { montant: e.target.value })} placeholder={t('period.primeMontant')} />
                          <label className="flex items-center gap-1 whitespace-nowrap text-xs text-stone-600">
                            <input type="checkbox" checked={pr.imposable !== false} onChange={(e) => setPrime(i, j, { imposable: e.target.checked })} />
                            {t('period.primeImposable')}
                          </label>
                          <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removePrime(i, j)} aria-label={t('period.remove')}>✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <ErrorNote>{error}</ErrorNote>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={saving}>{t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
