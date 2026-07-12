import { formatFCFA } from '../lib/money';
import { Badge, Card, InfoNote, TableWrap, td, th } from '../components/ui';

export default function Historique({ store }) {
  const { imports } = store;
  return (
    <Card title="Historique des imports" subtitle="Chaque export SAGE est journalisé (traçabilité).">
      {!imports.length ? (
        <InfoNote>Aucun import pour l'instant. Importez un relevé Wave puis générez le fichier SAGE.</InfoNote>
      ) : (
        <TableWrap>
          <table className="min-w-full divide-y divide-stone-100">
            <thead>
              <tr>
                <th className={th}>Date d'import</th>
                <th className={th}>Fichier</th>
                <th className={th}>Période</th>
                <th className={`${th} text-right`}>Pièces</th>
                <th className={`${th} text-right`}>Lignes</th>
                <th className={`${th} text-right`}>Débit</th>
                <th className={`${th} text-right`}>Crédit</th>
                <th className={th}>Équilibre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {imports.map((im) => {
                const eq = (im.controle?.debit || 0) === (im.controle?.credit || 0);
                return (
                  <tr key={im.id}>
                    <td className={td}>{new Date(im.dateImport).toLocaleString('fr-FR')}</td>
                    <td className={td}>{im.nomFichier || '—'}</td>
                    <td className={td}>
                      {im.periode?.debut} → {im.periode?.fin}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{im.controle?.nbPieces}</td>
                    <td className={`${td} text-right tabular-nums`}>{im.controle?.nbLignes}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatFCFA(im.controle?.debit)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatFCFA(im.controle?.credit)}</td>
                    <td className={td}>{eq ? <Badge tone="success">OK</Badge> : <Badge tone="danger">≠</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
