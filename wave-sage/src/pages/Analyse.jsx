import { useMemo } from 'react';
import { imputerCompte } from '../lib/rules';
import { normaliserCompte } from '../data/planComptable';
import { formatFCFA } from '../lib/money';
import { Card, InfoNote, TableWrap, td, th } from '../components/ui';

// Page « Analyse » : ventilation des montants du dernier relevé importé par
// NATURE de charge (et de produit), d'après la Raison du paiement. Vue
// d'analyse : n'affecte pas l'export SAGE.
export default function Analyse({ store }) {
  const { parametres, regles, mappings, plan } = store;
  const importCourant = store.importCourant || { transactions: [], meta: null };
  const transactions = importCourant.transactions || [];
  const meta = importCourant.meta;

  const intitulePar = useMemo(
    () => Object.fromEntries((plan || []).map((c) => [c.compte, c.intitule])),
    [plan]
  );

  const analyse = useMemo(() => {
    const charges = new Map();
    const produits = new Map();
    let totalCharges = 0;
    let totalProduits = 0;
    for (const tx of transactions) {
      const montant = Number(tx.montant) || 0;
      const T = Math.round(Math.abs(montant));
      const compte = normaliserCompte(
        imputerCompte(tx, { parametres, regles, mappingsContrepartie: mappings, plan }).compte
      );
      const cible = montant < 0 ? charges : produits;
      const e = cible.get(compte) || { compte, intitule: intitulePar[compte] || '', total: 0, count: 0 };
      e.total += T;
      e.count += 1;
      cible.set(compte, e);
      if (montant < 0) totalCharges += T;
      else totalProduits += T;
    }
    const tri = (m) => [...m.values()].sort((a, b) => b.total - a.total);
    return { charges: tri(charges), produits: tri(produits), totalCharges, totalProduits };
  }, [transactions, parametres, regles, mappings, plan, intitulePar]);

  if (!transactions.length) {
    return (
      <Card title="Analyse — ventilation par nature">
        <InfoNote>
          Importez d'abord un relevé Wave (onglet <strong>Import</strong>) : la ventilation des dépenses par nature de
          charge s'affichera ici automatiquement.
        </InfoNote>
      </Card>
    );
  }

  return (
    <Card
      title="Analyse — ventilation par nature"
      subtitle={
        meta
          ? `Relevé ${meta.nomFichier || ''} · ${meta.periodeDebut} → ${meta.periodeFin} · ${transactions.length} transactions`
          : `${transactions.length} transactions`
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Total dépenses (sorties)" valeur={formatFCFA(analyse.totalCharges)} />
        <Stat label="Total encaissements (entrées)" valeur={formatFCFA(analyse.totalProduits)} />
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold text-stone-700">Dépenses par nature de charge</h3>
      <Ventilation lignes={analyse.charges} total={analyse.totalCharges} />

      {analyse.produits.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-700">Encaissements par nature</h3>
          <Ventilation lignes={analyse.produits} total={analyse.totalProduits} />
        </>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Vue d'analyse basée sur la Raison du paiement. Elle n'affecte pas l'export SAGE (schéma simplifié).
      </p>
    </Card>
  );
}

// Tableau de ventilation : barre proportionnelle + montant + part (%).
function Ventilation({ lignes, total }) {
  if (!lignes.length) return <p className="text-sm text-stone-500">Aucune ligne.</p>;
  const max = lignes[0]?.total || 1;
  return (
    <TableWrap>
      <table className="min-w-full divide-y divide-stone-100">
        <thead>
          <tr>
            <th className={th}>Compte</th>
            <th className={th}>Nature</th>
            <th className={`${th} text-right`}>Nb</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={`${th} text-right`}>Part</th>
            <th className={`${th} w-40`}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {lignes.map((l) => {
            const pct = total ? (l.total / total) * 100 : 0;
            return (
              <tr key={l.compte}>
                <td className={`${td} font-mono`}>{l.compte}</td>
                <td className={`${td} whitespace-normal`}>{l.intitule || '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{l.count}</td>
                <td className={`${td} text-right tabular-nums font-medium`}>{formatFCFA(l.total)}</td>
                <td className={`${td} text-right tabular-nums text-stone-500`}>{pct.toFixed(1)} %</td>
                <td className={td}>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(2, (l.total / max) * 100)}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-stone-200">
            <td className={`${td} font-semibold`} colSpan={3}>
              Total
            </td>
            <td className={`${td} text-right font-semibold tabular-nums`}>{formatFCFA(total)}</td>
            <td className={`${td} text-right text-stone-500`}>100 %</td>
            <td className={td}></td>
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}

function Stat({ label, valeur }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-stone-800">{valeur}</div>
    </div>
  );
}
