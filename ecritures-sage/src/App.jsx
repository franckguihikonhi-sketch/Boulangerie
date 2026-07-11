import { useState } from 'react';
import { useEntries } from './lib/useStore';
import { usingSupabase, addEntry, deleteEntry, clearEntries } from './lib/db';
import {
  JOURNAUX_SUGGESTIONS, controleEquilibre, jjmmaaDepuisDate, telechargerFichierSage
} from './lib/sage';
import DbGate from './components/DbGate';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, TableWrap, inputClass, td, th
} from './components/ui';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR'); // nombre sans unité (colonnes serrées)
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ journal: 'VT', pieceDate: today(), account: '', label: '', debit: '', credit: '' });

function Journal() {
  const rows = useEntries();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const entries = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const balance = controleEquilibre(entries);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await addEntry({
        journal: form.journal,
        pieceDate: form.pieceDate,
        account: form.account,
        label: form.label,
        debit: Number(form.debit) || 0,
        credit: Number(form.credit) || 0
      });
      // On garde journal + date pour enchaîner la contrepartie plus vite.
      setForm((f) => ({ ...f, account: '', label: '', debit: '', credit: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteEntry(id);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Supprimer toutes les écritures saisies ?')) return;
    try {
      await clearEntries();
    } catch (err) {
      window.alert(err.message);
    }
  };

  const exportFile = () => telechargerFichierSage(entries);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {entries.length > 0 && (
          <Button variant="danger" onClick={clearAll}>Tout supprimer</Button>
        )}
        <Button variant="primary" onClick={exportFile} disabled={entries.length === 0}
          title="Génère le fichier texte à largeur fixe (88 caractères, CRLF, Windows-1252) importable dans SAGE.">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
          Exporter SAGE
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">Nouvelle écriture</h2>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code journal" help="6 caractères max — ex. VT, AC, BQ, OD">
                <input className={inputClass} list="journaux" value={form.journal}
                  onChange={(e) => set({ journal: e.target.value.toUpperCase() })} maxLength={6} required />
                <datalist id="journaux">
                  {JOURNAUX_SUGGESTIONS.map((j) => <option key={j.code} value={j.code}>{j.libelle}</option>)}
                </datalist>
              </Field>
              <Field label="Date de pièce">
                <input type="date" className={inputClass} value={form.pieceDate}
                  onChange={(e) => set({ pieceDate: e.target.value })} required />
              </Field>
            </div>
            <Field label="N° compte général" help="13 caractères max — ex. 571000, 401000">
              <input className={inputClass} value={form.account}
                onChange={(e) => set({ account: e.target.value })} maxLength={13} required />
            </Field>
            <Field label="Libellé">
              <input className={inputClass} value={form.label}
                onChange={(e) => set({ label: e.target.value })} maxLength={35} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Débit">
                <input type="number" step="1" min="0" className={inputClass} value={form.debit}
                  onChange={(e) => set({ debit: e.target.value })} />
              </Field>
              <Field label="Crédit">
                <input type="number" step="1" min="0" className={inputClass} value={form.credit}
                  onChange={(e) => set({ credit: e.target.value })} />
              </Field>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Enregistrement…' : "Ajouter l'écriture"}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-stone-900">Écritures saisies</h2>
              {entries.length > 0 && (
                <Badge tone={balance.equilibre ? 'success' : 'warning'}>
                  {balance.equilibre ? 'Équilibré' : 'Déséquilibré'}
                </Badge>
              )}
            </div>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>Journal</th>
                  <th className={th}>Date pièce</th>
                  <th className={th}>N° compte</th>
                  <th className={th}>Libellé</th>
                  <th className={`${th} text-right`}>Débit</th>
                  <th className={`${th} text-right`}>Crédit</th>
                  <th className={`${th} w-10`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className={`${td} font-medium`}>{e.journal}</td>
                    <td className={`${td} tabular-nums`}>{jjmmaaDepuisDate(e.pieceDate)}</td>
                    <td className={`${td} tabular-nums`}>{e.account}</td>
                    <td className={td}>{e.label || '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{e.debit ? fmt(e.debit) : '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>{e.credit ? fmt(e.credit) : '—'}</td>
                    <td className={`${td} w-10`}>
                      <button onClick={() => remove(e.id)}
                        className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                        aria-label="Supprimer" title="Supprimer">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a2 2 0 01-2 2H7a2 2 0 01-2-2V7h14zM10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td className={`${td} text-stone-500`} colSpan="7">Aucune écriture saisie pour le moment.</td></tr>
                )}
              </tbody>
              {entries.length > 0 && (
                <tfoot className="border-t border-stone-200 font-semibold">
                  <tr>
                    <td className={td} colSpan="4">Total · {entries.length} écriture(s) · FCFA</td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(balance.debit)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(balance.credit)}</td>
                    <td className={`${td} w-10`}></td>
                  </tr>
                </tfoot>
              )}
            </TableWrap>
          </Card>
          <div className="mt-3">
            <InfoNote>
              Format SAGE : largeur fixe 88 caractères — Code journal (6), Date de pièce (6, jjmmaa),
              N° compte (13), Libellé (35), Débit (14), Crédit (14). Montants à 2 décimales (virgule),
              fins de ligne CRLF, encodage Windows-1252. Vérifiez l'équilibre débit = crédit avant l'export.
            </InfoNote>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-brand-700 text-lg text-white">🧾</span>
            <div>
              <h1 className="text-base font-bold leading-tight sm:text-lg">Écritures SAGE</h1>
              <p className="text-xs text-stone-500">Export comptable au format SAGE 100 Comptabilité</p>
            </div>
          </div>
          <Badge tone={usingSupabase() ? 'success' : 'neutral'}>
            {usingSupabase() ? 'Base Supabase connectée' : 'Stockage local (navigateur)'}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <p className="mb-5 max-w-3xl text-sm text-stone-600">
          Saisissez vos écritures comptables (journal, date de pièce, compte, libellé, débit, crédit),
          puis exportez-les d'un clic en un fichier texte conforme au format d'import de SAGE 100
          Comptabilité. La colonne « Code journal » aiguille chaque écriture vers le bon journal SAGE.
        </p>
        <DbGate>
          <Journal />
        </DbGate>
      </main>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-stone-400 sm:px-6">
        Application indépendante — écritures comptables &amp; export SAGE.
      </footer>
    </div>
  );
}
