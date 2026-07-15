import { useMemo, useRef, useState } from 'react';
import { lireFichierWave } from '../lib/parseWave';
import { construirePieces, controlePieces, toutesLesLignes } from '../lib/impute';
import { telechargerFichierSage } from '../lib/sage';
import { formatFCFA } from '../lib/money';
import { enregistrerImport, setImportCourant } from '../lib/db';
import { Badge, Button, Card, ErrorNote, InfoNote, TableWrap, td, th } from '../components/ui';
import CompteSelect from '../components/CompteSelect';

const TYPE_LABEL = {
  single_payment: 'Paiement',
  bulk_payment: 'Paiement groupé',
  merchant_payment: 'Encaissement',
  single_payment_reversal: 'Annulation'
};

const SOURCE = {
  auto: { tone: 'neutral', texte: 'Automatique' },
  manuel: { tone: 'success', texte: 'Manuel' }
};

export default function Import({ store }) {
  const inputRef = useRef(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [overrides, setOverrides] = useState({}); // { txId: compte }
  const [ouvert, setOuvert] = useState({}); // pièces dépliées
  const [message, setMessage] = useState('');

  const { parametres, regles, mappings, plan } = store;
  // Le relevé courant est conservé dans le magasin (partagé avec l'onglet Analyse).
  const transactions = store.importCourant?.transactions || [];
  const meta = store.importCourant?.meta || null;

  // Table compte -> intitulé pour l'affichage (plan comptable éditable).
  const intitulePar = useMemo(
    () => Object.fromEntries((plan || []).map((c) => [c.compte, c.intitule])),
    [plan]
  );

  // Recalcule les pièces à chaque changement d'override / règle / paramètre / plan.
  const pieces = useMemo(
    () =>
      construirePieces(transactions, {
        parametres,
        regles,
        mappingsContrepartie: mappings,
        plan,
        intitulePar,
        overrides
      }),
    [transactions, parametres, regles, mappings, plan, intitulePar, overrides]
  );
  const controle = useMemo(() => controlePieces(pieces), [pieces]);

  // Garde-fou anti-doublon : transactions dont l'identifiant Wave a déjà été
  // exporté vers SAGE lors d'un import précédent.
  const exportedSet = useMemo(() => new Set(store.exportedTx || []), [store.exportedTx]);
  const dejaExporte = (p) => Boolean(p.txId && exportedSet.has(p.txId));
  const nbDejaExporte = useMemo(() => pieces.filter(dejaExporte).length, [pieces, exportedSet]);

  const [filtre, setFiltre] = useState('toutes'); // toutes | verifier | exportees
  const piecesAffichees = useMemo(() => {
    if (filtre === 'verifier') return pieces.filter((p) => p.aVerifier);
    if (filtre === 'exportees') return pieces.filter(dejaExporte);
    return pieces;
  }, [pieces, filtre, exportedSet]);

  const choisirFichier = () => inputRef.current?.click();

  const onFichier = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = ''; // permet de réimporter le même fichier
    if (!fichier) return;
    setChargement(true);
    setErreur('');
    setMessage('');
    setOverrides({});
    setOuvert({});
    try {
      const res = await lireFichierWave(fichier);
      if (!res.transactions.length) throw new Error('Aucune transaction trouvée dans le fichier.');
      setImportCourant(res.transactions, {
        nomFichier: fichier.name,
        periodeDebut: res.periodeDebut,
        periodeFin: res.periodeFin
      });
    } catch (err) {
      setErreur(err.message || 'Lecture impossible.');
      setImportCourant([], null);
    } finally {
      setChargement(false);
    }
  };

  const changerCompte = (txId, compte) => setOverrides((o) => ({ ...o, [txId]: compte }));

  const exporter = async () => {
    const lignes = toutesLesLignes(pieces);
    if (!lignes.length) return;
    const nb = telechargerFichierSage(lignes);
    await enregistrerImport({
      nomFichier: meta?.nomFichier,
      periode: { debut: meta?.periodeDebut, fin: meta?.periodeFin },
      pieces,
      controle
    });
    setMessage(`Fichier SAGE généré : ${nb} lignes (${controle.nbPieces} pièces). Import enregistré dans l'historique.`);
  };

  return (
    <div className="space-y-6">
      <Card
        title="1 · Importer le relevé Wave Business"
        subtitle="Fichier d'export Wave (.xls, .xlsx ou .csv). Le traitement est 100 % local dans votre navigateur."
        actions={
          <Button onClick={choisirFichier} disabled={chargement}>
            {chargement ? 'Lecture…' : '📥 Importer un relevé'}
          </Button>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFichier}
          className="hidden"
        />
        <ErrorNote>{erreur}</ErrorNote>
        {!transactions.length && !erreur && (
          <InfoNote>
            Cliquez sur <strong>« Importer un relevé »</strong> puis sélectionnez le fichier envoyé par Wave.
            L'application impute automatiquement chaque transaction selon le plan SYSCOHADA révisé, puis génère
            un fichier d'import SAGE.
          </InfoNote>
        )}
        {meta && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <Badge tone="brand">{meta.nomFichier}</Badge>
            <span>
              Période : <strong>{meta.periodeDebut}</strong> → <strong>{meta.periodeFin}</strong>
            </span>
            <span>·</span>
            <span>{transactions.length} transactions</span>
          </div>
        )}
      </Card>

      {transactions.length > 0 && (
        <>
          <Card title="2 · Contrôle comptable" subtitle="Écriture à 2 lignes par transaction — montant unique (frais inclus).">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Pièces" valeur={controle.nbPieces} />
              <Stat label="Lignes d'écriture" valeur={controle.nbLignes} />
              <Stat label="Total débit" valeur={formatFCFA(controle.debit)} />
              <Stat label="Total crédit" valeur={formatFCFA(controle.credit)} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {controle.equilibre ? (
                <Badge tone="success">✔ Équilibré (débit = crédit)</Badge>
              ) : (
                <Badge tone="danger">✘ Déséquilibre : {controle.desequilibrees} pièce(s)</Badge>
              )}
              <div className="ml-auto">
                <Button onClick={exporter} disabled={!controle.equilibre}>
                  📤 Export SAGE
                </Button>
              </div>
            </div>
            {!controle.equilibre && (
              <p className="mt-2 text-xs text-red-600">
                L'export est bloqué tant qu'une pièce n'est pas équilibrée (contrôle de sécurité).
              </p>
            )}
            {nbDejaExporte > 0 && (
              <div className="mt-3">
                <InfoNote tone="warn">
                  ⚠️ <strong>{nbDejaExporte}</strong> transaction(s) de ce fichier ont déjà été exportées vers SAGE
                  lors d'un import précédent (risque de doublon). Utilisez le filtre « Déjà exportées » pour les
                  repérer et, au besoin, réimportez seulement la nouvelle période.
                </InfoNote>
              </div>
            )}
          </Card>

          {message && <InfoNote tone="success">{message}</InfoNote>}

          <Card
            title="3 · Écritures générées"
            subtitle="Sortie : Débit 47100000 / Crédit 57100000 · Entrée : Débit 57100000 / Crédit 58500000. La contrepartie reste modifiable ligne à ligne."
            actions={
              <div className="flex flex-wrap gap-1">
                {[
                  { id: 'toutes', label: `Toutes (${pieces.length})` },
                  { id: 'exportees', label: `Déjà exportées (${nbDejaExporte})` }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFiltre(f.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      filtre === f.id
                        ? 'border-brand-600 bg-brand-700 text-white'
                        : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            }
          >
            <TableWrap>
              <table className="min-w-full divide-y divide-stone-100">
                <thead>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Type</th>
                    <th className={th}>Contrepartie / motif</th>
                    <th className={`${th} text-right`}>Montant</th>
                    <th className={th}>Compte de contrepartie</th>
                    <th className={th}>Source</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {piecesAffichees.map((p) => {
                    const src = SOURCE[p.source] || SOURCE.auto;
                    const estOuvert = ouvert[p.ref];
                    const estDejaExporte = dejaExporte(p);
                    return (
                      <>
                        <tr key={p.ref} className={estDejaExporte ? 'bg-red-50/60' : p.aVerifier ? 'bg-amber-50/50' : ''}>
                          <td className={td}>{p.date}</td>
                          <td className={td}>
                            <Badge tone={p.sens === 'entree' ? 'success' : p.sens === 'contrepassation' ? 'warn' : 'neutral'}>
                              {TYPE_LABEL[p.type] || p.type}
                            </Badge>
                          </td>
                          <td className={`${td} max-w-xs`}>
                            <div className="truncate font-medium text-stone-800">{p.contrepartie || '—'}</div>
                            {p.motif && <div className="truncate text-xs text-stone-500">{p.motif}</div>}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{formatFCFA(p.montant)}</td>
                          <td className={`${td} min-w-[220px]`}>
                            <CompteSelect
                              value={p.compteContrepartie}
                              onChange={(c) => changerCompte(p.txId, c)}
                              compact
                            />
                            <div className="mt-0.5 truncate text-xs text-stone-400">
                              {p.lignes.find((l) => l.role === 'contrepartie')?.intituleCompte}
                            </div>
                          </td>
                          <td className={td}>
                            <div className="flex flex-col items-start gap-1">
                              <Badge tone={src.tone}>{src.texte}</Badge>
                              {estDejaExporte && <Badge tone="danger">Déjà exporté</Badge>}
                            </div>
                          </td>
                          <td className={`${td} text-right`}>
                            <button
                              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
                              onClick={() => setOuvert((o) => ({ ...o, [p.ref]: !o[p.ref] }))}
                            >
                              {estOuvert ? '▲' : '▼'}
                            </button>
                          </td>
                        </tr>
                        {estOuvert && (
                          <tr key={p.ref + '-detail'} className="bg-stone-50">
                            <td className={td} colSpan={7}>
                              <div className="rounded-lg border border-stone-200 bg-white p-3">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                                  Pièce {p.ref} · Journal {p.journal}
                                </div>
                                <table className="min-w-full">
                                  <thead>
                                    <tr>
                                      <th className={th}>Compte</th>
                                      <th className={th}>Intitulé</th>
                                      <th className={th}>Libellé</th>
                                      <th className={`${th} text-right`}>Débit</th>
                                      <th className={`${th} text-right`}>Crédit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.lignes.map((l, i) => (
                                      <tr key={i}>
                                        <td className={`${td} font-mono`}>{l.compte}</td>
                                        <td className={`${td} text-stone-500`}>{l.intituleCompte}</td>
                                        <td className={td}>{l.libelle}</td>
                                        <td className={`${td} text-right tabular-nums`}>{l.debit ? formatFCFA(l.debit) : ''}</td>
                                        <td className={`${td} text-right tabular-nums`}>{l.credit ? formatFCFA(l.credit) : ''}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <InfoNote>
            📊 La <strong>ventilation par nature de charge</strong> (dépenses par carburant, transport, chantier, etc.)
            est disponible dans l'onglet <strong>Analyse</strong>.
          </InfoNote>
        </>
      )}
    </div>
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
