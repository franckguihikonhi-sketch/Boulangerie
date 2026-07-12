import { useMemo, useState } from 'react';
import { PLAN_COMPTABLE } from '../data/planComptable';
import { normaliser } from '../lib/rules';
import { Card, TableWrap, inputClass, td, th } from '../components/ui';

export default function Plan() {
  const [q, setQ] = useState('');
  const resultats = useMemo(() => {
    const t = normaliser(q);
    if (!t) return PLAN_COMPTABLE.slice(0, 200);
    return PLAN_COMPTABLE.filter(
      (c) => c.compte.includes(t) || normaliser(c.intitule).includes(t)
    ).slice(0, 300);
  }, [q]);

  return (
    <Card
      title="Plan comptable SYSCOHADA révisé"
      subtitle={`${PLAN_COMPTABLE.length} comptes. Recherche par numéro ou intitulé.`}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher un compte (ex. « carburant », « 605 », « tva »)…"
        className={`${inputClass} mb-4`}
      />
      <TableWrap>
        <table className="min-w-full divide-y divide-stone-100">
          <thead>
            <tr>
              <th className={th}>Compte</th>
              <th className={th}>Intitulé</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {resultats.map((c) => (
              <tr key={c.compte}>
                <td className={`${td} font-mono`}>{c.compte}</td>
                <td className={td}>{c.intitule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!resultats.length && <p className="mt-4 text-sm text-stone-500">Aucun compte ne correspond.</p>}
    </Card>
  );
}
