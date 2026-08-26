import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useActivePeriod } from '../lib/useStore';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/I18nContext';
import { SITUATIONS, TYPES_CONTRAT, deleteEmployee, uid } from '../lib/db';
// saveEmployee vient de cloture.js (et non de db.js directement) : il refuse
// toute modification qui changerait le bulletin déjà calculé d'un mois
// clôturé — voir ce module pour le détail du garde-fou.
import { saveEmployee } from '../lib/cloture';
import { periodeEffective, moisPrecedent, MAJORATIONS_HEURES_SUP, BAREME_CATEGORIES, salaireMinimumCategoriel } from '../lib/payroll';
import { formatFCFA } from '../lib/money';
import { employeesFromCsv, employeesCsvTemplate } from '../lib/csvImport';
import {
  Button, Card, PageTitle, Modal, Field, inputClass, ErrorNote, InfoNote,
  Badge, TableWrap, th, td, EmployeeNav
} from '../components/ui';

// Déclenche le téléchargement d'un fichier texte (CSV) côté navigateur.
function downloadTextFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const emptyPeriode = (kind = 'cdd') => ({
  id: uid(), kind, label: '', debut: '', fin: '', salaireBase: '', netCible: '', transport: 30000,
  primes: [], retenues: [], heuresSupplementaires: []
});

function emptyForm() {
  return {
    id: null, matricule: '', nom: '', situation: 'celibataire', enfants: 0,
    cnps: '', emploi: '', categorie: '', expatrie: false, dateEmbauche: '', salaireCategoriel: '',
    sousControle: false, controleMotif: '', controleDepuis: null, compteBancaire: '', email: '',
    periodes: [emptyPeriode('cdd')]
  };
}

function fromEmployee(e) {
  return {
    id: e.id, matricule: e.matricule, nom: e.nom, situation: e.situation,
    enfants: e.enfants, cnps: e.cnps, emploi: e.emploi, categorie: e.categorie || '', expatrie: e.expatrie === true,
    dateEmbauche: e.dateEmbauche, salaireCategoriel: e.salaireCategoriel,
    sousControle: e.sousControle === true, controleMotif: e.controleMotif || '', controleDepuis: e.controleDepuis || null,
    compteBancaire: e.compteBancaire || '', email: e.email || '',
    periodes: e.periodes.map((p) => ({
      ...p, fin: p.fin || '', finJour: p.finJour || null,
      primes: p.primes.map((pr) => ({ ...pr, mois: pr.mois || '' })),
      retenues: (p.retenues || []).map((r) => ({ ...r, mois: r.mois || '' })),
      heuresSupplementaires: (p.heuresSupplementaires || []).map((h) => ({ ...h, mois: h.mois || '' }))
    }))
  };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Employees() {
  const { employees } = useStore();
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  // Traçabilité (voir Historique) : nom/email de la personne connectée,
  // joint à chaque création/modification/suppression de salarié.
  const auditMeta = { utilisateur: user?.name || user?.email || '' };
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
  // Mois choisi via le bouton « Base » (en-tête) : la liste ci-dessous
  // n'affiche que les salariés déjà présents à cette période — voir
  // payroll.js#periodeEffective, qui exclut tout salarié dont la date
  // d'embauche enregistrée est postérieure. Remonter Base à une période
  // ancienne masque donc les salariés pas encore embauchés à l'époque,
  // exactement comme le Tableau de bord et les Bulletins.
  const ym = useActivePeriod();
  const enPeriode = useMemo(() => employees.filter((e) => periodeEffective(e, ym)), [employees, ym]);

  // Import en masse (CSV) : un salarié par ligne, avec sa 1ʳᵉ période. Les
  // lignes en erreur (nom manquant, montants invalides…) sont rapportées
  // sans bloquer l'import des lignes valides.
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { ok, errors }

  const downloadCsvTemplate = () => downloadTextFile('modele-salaries.csv', employeesCsvTemplate());

  const handleImportFile = async (evt) => {
    const file = evt.target.files?.[0];
    evt.target.value = ''; // permet de réimporter le même fichier deux fois de suite
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const { employees: toImport, errors: parseErrors } = employeesFromCsv(text);
      const errors = [...parseErrors];
      let ok = 0;
      for (const emp of toImport) {
        try {
          await saveEmployee(emp, auditMeta);
          ok += 1;
        } catch (err) {
          errors.push({ ligne: '—', message: `${emp.nom} : ${t(err.message) || err.message}` });
        }
      }
      setImportResult({ ok, errors });
    } catch {
      setImportResult({ ok: 0, errors: [{ ligne: '—', message: t('employees.importReadError') }] });
    } finally {
      setImporting(false);
    }
  };

  const openNew = () => { setError(''); setForm(emptyForm()); };
  const openEdit = (e) => { setError(''); setForm(fromEmployee(e)); };

  // Précédent/Suivant dans la boîte de dialogue « Modifier » : navigue dans
  // la liste des salariés (même ordre que le tableau), sans avoir à fermer
  // puis rouvrir la fenêtre à chaque fois. Uniquement pour un salarié
  // existant (pas la fiche « Nouveau salarié ») — voir le rendu plus bas.
  const editIndex = form?.id ? enPeriode.findIndex((e) => e.id === form.id) : -1;
  const goEdit = (idx) => {
    if (idx < 0 || idx >= enPeriode.length) return;
    openEdit(enPeriode[idx]);
  };

  const openTerminate = (e, mode) => { setTerminateError(''); setTerminateDate(todayIso()); setTerminate({ employee: e, mode }); };

  const confirmTerminate = async (evt) => {
    evt.preventDefault();
    if (!terminateDate) return;
    setTerminateError('');
    setTerminateSaving(true);
    try {
      const payload = fromEmployee(terminate.employee);
      const last = payload.periodes.length - 1;
      const fin = terminateDate.slice(0, 7);
      // Jour exact de sortie (méthode des 30èmes) : le mois de sortie est
      // proratisé automatiquement sur le bulletin SAUF si la sortie tombe le
      // dernier jour du mois (mois plein, comportement historique).
      const jourSortie = Number(terminateDate.slice(8, 10));
      const dernierJourMois = new Date(Number(terminateDate.slice(0, 4)), Number(terminateDate.slice(5, 7)), 0).getDate();
      const finJour = jourSortie < dernierJourMois ? jourSortie : null;
      payload.periodes = payload.periodes.map((p, idx) => (idx === last ? { ...p, fin, finJour } : p));
      await saveEmployee(payload, auditMeta);
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
        primes: last.primes.map((pr) => ({ ...pr })),
        retenues: (last.retenues || []).map((r) => ({ ...r })),
        heuresSupplementaires: (last.heuresSupplementaires || []).map((h) => ({ ...h }))
      };
      payload.periodes = [...payload.periodes.slice(0, lastIdx), closed, next];
      lastIdx = payload.periodes.length - 1;
    }
    setReviseSaving(true);
    try {
      await saveEmployee(payload, auditMeta);
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
      await saveEmployee(payload, auditMeta);
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
      await saveEmployee(payload, auditMeta);
    } catch (err) {
      window.alert(t(err.message) || err.message);
    }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Choix d'une catégorie du barème : positionne AUTOMATIQUEMENT le salaire
  // de base sur le minimum conventionnel, pour chaque période dont le
  // salaire actuel est vide ou déjà sous ce minimum (une période dont le
  // salaire est déjà conforme, ou supérieur, reste inchangée). Cohérent avec
  // le garde-fou strict de submit() ci-dessus : une fois la catégorie
  // choisie, toutes les périodes sont automatiquement conformes.
  const setCategorie = (categorie) => {
    const min = salaireMinimumCategoriel(categorie);
    setForm((f) => ({
      ...f,
      categorie,
      periodes: min == null
        ? f.periodes
        : f.periodes.map((p) => ((Number(p.salaireBase) || 0) < min ? { ...p, salaireBase: min } : p))
    }));
  };

  const setPeriode = (i, patch) =>
    setForm((f) => ({ ...f, periodes: f.periodes.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));

  const addPeriode = () =>
    setForm((f) => {
      const nouvelle = emptyPeriode('cdd');
      // Si une catégorie du barème est déjà choisie, la nouvelle période
      // démarre directement sur son salaire minimum — même principe que le
      // choix de catégorie ci-dessus.
      const min = salaireMinimumCategoriel(f.categorie);
      if (min != null) nouvelle.salaireBase = min;
      return { ...f, periodes: [...f.periodes, nouvelle] };
    });

  const removePeriode = (i) =>
    setForm((f) => ({ ...f, periodes: f.periodes.filter((_, idx) => idx !== i) }));

  const addPrime = (i) =>
    setPeriode(i, { primes: [...form.periodes[i].primes, { label: '', montant: '', imposable: true, mois: '' }] });

  const setPrime = (i, j, patch) =>
    setPeriode(i, {
      primes: form.periodes[i].primes.map((pr, idx) => (idx === j ? { ...pr, ...patch } : pr))
    });

  const removePrime = (i, j) =>
    setPeriode(i, { primes: form.periodes[i].primes.filter((_, idx) => idx !== j) });

  const addRetenue = (i) =>
    setPeriode(i, { retenues: [...(form.periodes[i].retenues || []), { label: '', montant: '', mois: '' }] });

  const setRetenue = (i, j, patch) =>
    setPeriode(i, {
      retenues: (form.periodes[i].retenues || []).map((r, idx) => (idx === j ? { ...r, ...patch } : r))
    });

  const removeRetenue = (i, j) =>
    setPeriode(i, { retenues: (form.periodes[i].retenues || []).filter((_, idx) => idx !== j) });

  const addHeureSup = (i) =>
    setPeriode(i, {
      heuresSupplementaires: [
        ...(form.periodes[i].heuresSupplementaires || []),
        { heures: '', majoration: MAJORATIONS_HEURES_SUP[0].valeur, mois: '' }
      ]
    });

  const setHeureSup = (i, j, patch) =>
    setPeriode(i, {
      heuresSupplementaires: (form.periodes[i].heuresSupplementaires || [])
        .map((h, idx) => (idx === j ? { ...h, ...patch } : h))
    });

  const removeHeureSup = (i, j) =>
    setPeriode(i, {
      heuresSupplementaires: (form.periodes[i].heuresSupplementaires || []).filter((_, idx) => idx !== j)
    });

  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    // Garde-fou STRICT : le salaire de base d'aucune période ne peut être
    // inférieur au minimum conventionnel de la catégorie socioprofessionnelle
    // choisie (barème 2023) — voir payroll.js#salaireMinimumCategoriel. Sans
    // catégorie reconnue (champ vide ou ancienne valeur libre), aucune
    // contrainte n'est appliquée.
    const minCategoriel = salaireMinimumCategoriel(form.categorie);
    if (minCategoriel != null) {
      const periodeSousMinimum = form.periodes.find((p) => (Number(p.salaireBase) || 0) < minCategoriel);
      if (periodeSousMinimum) {
        setError(t('employees.salaireSousMinimum', {
          categorie: form.categorie,
          min: formatFCFA(minCategoriel),
          salaire: formatFCFA(Number(periodeSousMinimum.salaireBase) || 0)
        }));
        return;
      }
    }
    setSaving(true);
    try {
      await saveEmployee(form, auditMeta);
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
      await deleteEmployee(id, auditMeta);
    } catch (err) {
      window.alert(t(err.message) || err.message);
    }
  };

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={downloadCsvTemplate}>{t('employees.csvTemplate')}</Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? t('employees.importing') : t('employees.csvImport')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button onClick={openNew}>{t('employees.add')}</Button>
          </div>
        }
      >
        {t('employees.title')}
      </PageTitle>

      {importResult && (
        <Modal title={t('employees.importResultTitle')} onClose={() => setImportResult(null)}>
          <p className="mb-2 text-sm text-stone-700">
            {t('employees.importSummary', { ok: importResult.ok, errors: importResult.errors.length })}
          </p>
          {importResult.errors.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {importResult.errors.map((e, i) => (
                <li key={i}>{t('employees.importErrorLine', { ligne: e.ligne })} — {e.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setImportResult(null)}>{t('common.close')}</Button>
          </div>
        </Modal>
      )}

      <Card>
        {employees.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-500">{t('employees.empty')}</p>
        ) : enPeriode.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-500">{t('employees.emptyPeriod')}</p>
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
              {enPeriode.map((e) => {
                const p = periodeEffective(e, ym);
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
                    <td className={td}>
                      {e.emploi || '—'}
                      {e.categorie && <span className="block text-xs text-stone-400">{e.categorie}</span>}
                    </td>
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
            <Field label={t('employees.terminateDate')} help={t('employees.terminateDateHelp')}>
              <input className={inputClass} type="date" value={terminateDate} onChange={(e) => setTerminateDate(e.target.value)} required />
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
            {editIndex >= 0 && (
              <div className="-mt-1 mb-1">
                <EmployeeNav
                  index={editIndex}
                  total={enPeriode.length}
                  onPrev={() => goEdit(editIndex - 1)}
                  onNext={() => goEdit(editIndex + 1)}
                />
              </div>
            )}
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
              <Field label={t('employees.categorie')} help={t('employees.categorieHelp')}>
                <select className={inputClass} value={form.categorie} onChange={(e) => setCategorie(e.target.value)}>
                  <option value="">{t('employees.categorieNonClassee')}</option>
                  <optgroup label={t('employees.groupeAgentMaitrise')}>
                    {BAREME_CATEGORIES.filter((c) => c.groupe === 'EMPLOYE_AGENT_MAITRISE').map((c) => (
                      <option key={c.categorie} value={c.categorie}>
                        {c.categorie}{c.definition ? ` (${c.definition})` : ''} — min. {formatFCFA(c.salaireMin)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('employees.groupeCadre')}>
                    {BAREME_CATEGORIES.filter((c) => c.groupe === 'CADRE').map((c) => (
                      <option key={c.categorie} value={c.categorie}>
                        {c.categorie} — min. {formatFCFA(c.salaireMin)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              <Field label={t('employees.dateEmbauche')} help={t('employees.dateEmbaucheHelp')}>
                <input className={inputClass} type="date" value={form.dateEmbauche} onChange={(e) => setField('dateEmbauche', e.target.value)} />
              </Field>
              <Field label={t('employees.salaireCategoriel')} help={t('employees.salaireCategorielHelp')}>
                <input className={inputClass} type="number" min="0" value={form.salaireCategoriel} onChange={(e) => setField('salaireCategoriel', e.target.value)} placeholder="auto" />
              </Field>
              <Field label={t('employees.compteBancaire')} help={t('employees.compteBancaireHelp')}>
                <input className={inputClass} value={form.compteBancaire} onChange={(e) => setField('compteBancaire', e.target.value)} placeholder="ex. CI93 CI12 3456 7890 1234 5678 90" />
              </Field>
              <Field label={t('employees.email')} help={t('employees.emailHelp')}>
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="ex. salarie@exemple.ci" />
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
                      <InfoNote>{t('period.primesHelp')}</InfoNote>
                      {p.primes.map((pr, j) => (
                        <div key={j} className="mt-1 flex items-center gap-2">
                          <input className={inputClass + ' flex-1'} value={pr.label} onChange={(e) => setPrime(i, j, { label: e.target.value })} placeholder={t('period.primeLabel')} />
                          <input className={inputClass + ' w-28'} type="number" min="0" value={pr.montant} onChange={(e) => setPrime(i, j, { montant: e.target.value })} placeholder={t('period.primeMontant')} />
                          <input className={inputClass + ' w-36'} type="month" value={pr.mois || ''} onChange={(e) => setPrime(i, j, { mois: e.target.value })} title={t('period.retenueMoisHelp')} />
                          <label className="flex items-center gap-1 whitespace-nowrap text-xs text-stone-600">
                            <input type="checkbox" checked={pr.imposable !== false} onChange={(e) => setPrime(i, j, { imposable: e.target.checked })} />
                            {t('period.primeImposable')}
                          </label>
                          <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removePrime(i, j)} aria-label={t('period.remove')}>✕</button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 border-t border-stone-200 pt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-600">{t('period.retenues')}</span>
                        <button type="button" className="text-xs font-medium text-red-700 hover:underline" onClick={() => addRetenue(i)}>
                          + {t('period.addRetenue')}
                        </button>
                      </div>
                      <InfoNote>{t('period.retenuesHelp')}</InfoNote>
                      {(p.retenues || []).map((r, j) => (
                        <div key={j} className="mt-1 flex items-center gap-2">
                          <input className={inputClass + ' flex-1'} value={r.label} onChange={(e) => setRetenue(i, j, { label: e.target.value })} placeholder={t('period.retenueLabel')} />
                          <input className={inputClass + ' w-28'} type="number" min="0" value={r.montant} onChange={(e) => setRetenue(i, j, { montant: e.target.value })} placeholder={t('period.retenueMontant')} />
                          <input className={inputClass + ' w-36'} type="month" value={r.mois || ''} onChange={(e) => setRetenue(i, j, { mois: e.target.value })} title={t('period.retenueMoisHelp')} />
                          <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removeRetenue(i, j)} aria-label={t('period.remove')}>✕</button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 border-t border-stone-200 pt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-stone-600">{t('period.heuresSup')}</span>
                        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => addHeureSup(i)}>
                          + {t('period.addHeureSup')}
                        </button>
                      </div>
                      <InfoNote>{t('period.heuresSupHelp')}</InfoNote>
                      {(p.heuresSupplementaires || []).map((h, j) => (
                        <div key={j} className="mt-1 flex items-center gap-2">
                          <input className={inputClass + ' w-24'} type="number" min="0" step="0.5" value={h.heures} onChange={(e) => setHeureSup(i, j, { heures: e.target.value })} placeholder={t('period.heuresSupNombre')} />
                          <select className={inputClass + ' flex-1'} value={h.majoration} onChange={(e) => setHeureSup(i, j, { majoration: Number(e.target.value) })}>
                            {MAJORATIONS_HEURES_SUP.map((m) => <option key={m.valeur} value={m.valeur}>{m.label}</option>)}
                          </select>
                          <input className={inputClass + ' w-36'} type="month" value={h.mois || ''} onChange={(e) => setHeureSup(i, j, { mois: e.target.value })} title={t('period.retenueMoisHelp')} />
                          <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removeHeureSup(i, j)} aria-label={t('period.remove')}>✕</button>
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
