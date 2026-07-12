import { useMemo, useState } from 'react';
import { normaliser } from '../lib/rules';
import { normaliserCompte } from '../data/planComptable';
import { upsertCompte, removeCompte, reinitialiserPlan } from '../lib/db';
import { Badge, Button, Card, ErrorNote, Field, InfoNote, TableWrap, inputClass, td, th } from '../components/ui';

const vide = { compte: '', intitule: '', edition: false };

export default function Plan({ store }) {
  const plan = store.plan;
  const [q, setQ] = useState('');
  const [form, setForm] = useState(vide);
  const [erreur, setErreur] = useState('');
  const set = (p) => {
    setForm((f) => ({ ...f, ...p }));
    setErreur('');
  };

  const resultats = useMemo(() => {
    const t = normaliser(q);
    const base = t
      ? plan.filter((c) => c.compte.includes(t.replace(/\D/g, '')) || normaliser(c.intitule).includes(t))
      : plan;
    return base.slice(0, 300);
  }, [q, plan]);

  const editer = (c) => {
    setForm({ compte: c.compte, intitule: c.intitule, edition: true });
    setErreur('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    const c = normaliserCompte(form.compte);
    if (!/^\d{8}$/.test(c)) {
      setErreur('Le numéro de compte doit comporter 8 chiffres (ex. 60220000).');
      return;
    }
    if (!form.intitule.trim()) {
      setErreur("L'intitulé est obligatoire.");
      return;
    }
    if (!form.edition && plan.some((x) => x.compte === c)) {
      setErreur(`Le compte ${c} existe déjà — utilisez « Modifier ».`);
      return;
    }
    await upsertCompte({ compte: c, intitule: form.intitule });
    setForm(vide);
  };

  const supprimer = async (c) => {
    if (!window.confirm(`Supprimer le compte ${c.compte} — ${c.intitule} ?`)) return;
    await removeCompte(c.compte);
  };

  return (
    <div className="space-y-6">
      <Card
        title={form.edition ? 'Modifier un compte' : 'Ajouter un compte'}
        subtitle="Le plan comptable est éditable : ajoutez, modifiez ou supprimez vos comptes. Ils deviennent aussitôt disponibles dans les règles, les paramètres et l'imputation."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              window.confirm('Restaurer le plan comptable SYSCOHADA d\'origine ? Vos ajouts/suppressions seront perdus.') &&
              reinitialiserPlan()
            }
          >
            Restaurer le plan d'origine
          </Button>
        }
      >
        <form onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Field label="N° de compte (8 chiffres)">
              <input
                value={form.compte}
                onChange={(e) => set({ compte: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                disabled={form.edition}
                placeholder="60220000"
                inputMode="numeric"
                className={`${inputClass} ${form.edition ? 'bg-stone-100' : ''}`}
              />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="Intitulé">
              <input
                value={form.intitule}
                onChange={(e) => set({ intitule: e.target.value })}
                placeholder="Achats de matières premières (bois)"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              {form.edition ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </div>
        </form>
        {form.edition && (
          <button className="mt-2 text-xs text-brand-700 hover:underline" onClick={() => setForm(vide)}>
            Annuler la modification
          </button>
        )}
        <div className="mt-3">
          <ErrorNote>{erreur}</ErrorNote>
        </div>
      </Card>

      <Card
        title={`Plan comptable — ${plan.length} comptes`}
        subtitle="Recherche par numéro ou intitulé (300 premiers résultats affichés)."
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un compte (ex. « carburant », « 605 », « caisse »)…"
          className={`${inputClass} mb-4`}
        />
        <TableWrap>
          <table className="min-w-full divide-y divide-stone-100">
            <thead>
              <tr>
                <th className={th}>Compte</th>
                <th className={th}>Intitulé</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {resultats.map((c) => (
                <tr key={c.compte}>
                  <td className={`${td} font-mono`}>{c.compte}</td>
                  <td className={td}>{c.intitule}</td>
                  <td className={`${td} text-right`}>
                    <button className="text-xs text-brand-700 hover:underline" onClick={() => editer(c)}>
                      Modifier
                    </button>
                    <button className="ml-3 text-xs text-red-600 hover:underline" onClick={() => supprimer(c)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!resultats.length && <p className="mt-4 text-sm text-stone-500">Aucun compte ne correspond.</p>}
      </Card>

      <InfoNote>
        Astuce : pour qu'un <strong>motif</strong> tombe sur le bon compte, soit vous créez une <strong>règle</strong>
        (mot-clé → compte), soit l'application propose automatiquement le compte dont l'<strong>intitulé du plan</strong>
        correspond le mieux à la Raison du paiement (proposition signalée « à vérifier »).
      </InfoNote>
    </div>
  );
}
