import { Card, InfoNote } from '../components/ui';

export default function Apropos() {
  return (
    <div className="space-y-6">
      <Card title="À propos" subtitle="Wave → SAGE · automatisation de la saisie comptable des transactions Wave Business.">
        <div className="space-y-3 text-sm leading-relaxed text-stone-700">
          <p>
            Cette application supprime la ressaisie manuelle du relevé Wave. Vous importez le fichier d'export Wave
            Business, l'application <strong>impute automatiquement</strong> chaque transaction selon le plan comptable
            <strong> SYSCOHADA révisé</strong>, puis génère un <strong>fichier d'import SAGE 100</strong> que vous
            chargez dans le journal désigné.
          </p>
          <p className="font-semibold text-stone-800">Logique comptable appliquée</p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Le solde Wave est un compte de <strong>trésorerie</strong> (par défaut <code>552000</code> — monnaie
              téléphonique portable). Il bouge toujours du montant exact de la transaction.
            </li>
            <li>
              Les <strong>frais Wave</strong> sont isolés sur une charge financière (par défaut <code>631700</code> —
              frais sur instruments de monnaie électronique).
            </li>
            <li>
              Le <strong>compte de contrepartie</strong> (charge ou produit) est déterminé par les règles par mots-clés,
              puis par les comptes mémorisés par contrepartie ; à défaut, un compte par défaut signalé « à vérifier ».
            </li>
            <li>
              Chaque transaction produit une <strong>pièce équilibrée</strong> (partie double). L'export est bloqué si
              une pièce n'est pas équilibrée.
            </li>
          </ul>
        </div>
      </Card>
      <InfoNote>
        Format SAGE : fichier texte à largeur fixe (journal 6, date jjmmaa 6, compte 13, libellé 35, débit 14, crédit
        14), encodage Windows-1252, une écriture par ligne — conforme à l'import « écritures comptables » de SAGE 100.
      </InfoNote>
    </div>
  );
}
