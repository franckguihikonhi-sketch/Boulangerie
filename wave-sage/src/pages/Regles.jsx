import { useState } from 'react';
import { upsertRegle, removeRegle, reinitialiserRegles } from '../lib/db';
import { Badge, Button, Card, Field, InfoNote, TableWrap, inputClass, td, th } from '../components/ui';
import CompteSelect from '../components/CompteSelect';

const SENS = [
  { v: 'sortie', t: 'Paiement (charge)' },
  { v: 'entree', t: 'Encaissement (produit)' },
  { v: 'tous', t: 'Tous' }
];
const vide = { id: '', priorite: 100, sens: 'sortie', motsCles: '', compte: '', libelle: '', actif: true };

export default function Regles({ store }) {
  const { regles } = store;
  const [form, setForm] = useState(vide);
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const editer = (r) => setForm({ ...r, motsCles: (r.motsCles || []).join(', ') });

  const enregistrer = async (e) => {
    e.preventDefault();
    if (!form.compte) return;
    await upsertRegle({
      ...form,
      motsCles: form.motsCles.split(',').map((m) => m.trim()).filter(Boolean)
    });
    setForm(vide);
  };

  return (
    <div className="space-y-6">
      <Card
        title="Règles d'imputation automatique"
        subtitle="Un mot-clé trouvé dans la Raison du paiement (motif Wave) impute la transaction sur le compte choisi. La règle de plus petite priorité s'applique en premier. Le nom de la contrepartie n'entre pas dans le rapprochement."
        actions={
          <Button
            variant="secondary"
            onClick={() => window.confirm('Réinitialiser les règles au jeu par défaut ?') && reinitialiserRegles()}
          >
            Réinitialiser
          </Button>
        }
      >
        <form onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Priorité">
            <input
              type="number"
              value={form.priorite}
              onChange={(e) => set({ priorite: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Sens">
            <select value={form.sens} onChange={(e) => set({ sens: e.target.value })} className={inputClass}>
              {SENS.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.t}
                </option>
              ))}
            </select>
          </Field>
          <div className="lg:col-span-2">
            <Field label="Mots-clés (séparés par des virgules)" hint="Accents et casse ignorés.">
              <input
                value={form.motsCles}
                onChange={(e) => set({ motsCles: e.target.value })}
                placeholder="carburant, essence, gasoil"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Compte">
            <CompteSelect value={form.compte} onChange={(c) => set({ compte: c })} compact />
          </Field>
          <Field label="Libellé règle">
            <input value={form.libelle} onChange={(e) => set({ libelle: e.target.value })} className={inputClass} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button type="submit">{form.id ? 'Mettre à jour la règle' : 'Ajouter la règle'}</Button>
            {form.id && (
              <Button type="button" variant="ghost" onClick={() => setForm(vide)} className="ml-2">
                Annuler
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card title={`${regles.length} règles`} subtitle="De la plus prioritaire à la plus générale.">
        <TableWrap>
          <table className="min-w-full divide-y divide-stone-100">
            <thead>
              <tr>
                <th className={th}>Prio.</th>
                <th className={th}>Sens</th>
                <th className={th}>Mots-clés</th>
                <th className={th}>Compte</th>
                <th className={th}>Libellé</th>
                <th className={th}>État</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {regles.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} tabular-nums`}>{r.priorite}</td>
                  <td className={td}>
                    <Badge tone={r.sens === 'entree' ? 'success' : r.sens === 'tous' ? 'neutral' : 'info'}>
                      {r.sens}
                    </Badge>
                  </td>
                  <td className={`${td} max-w-sm whitespace-normal`}>{(r.motsCles || []).join(', ')}</td>
                  <td className={`${td} font-mono`}>{r.compte}</td>
                  <td className={`${td} text-stone-500`}>{r.libelle}</td>
                  <td className={td}>{r.actif !== false ? <Badge tone="success">actif</Badge> : <Badge>inactif</Badge>}</td>
                  <td className={`${td} text-right`}>
                    <button className="text-xs text-brand-700 hover:underline" onClick={() => editer(r)}>
                      Modifier
                    </button>
                    <button
                      className="ml-3 text-xs text-red-600 hover:underline"
                      onClick={() => removeRegle(r.id)}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <InfoNote>
        Les <strong>frais Wave</strong> et le <strong>compte de trésorerie</strong> (solde Wave) ne dépendent pas des
        règles : ils sont fixés dans <strong>Paramètres</strong>. Les règles ne concernent que le compte de
        contrepartie (charge ou produit).
      </InfoNote>
    </div>
  );
}
