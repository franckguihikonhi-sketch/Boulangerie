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
              Écriture <strong>simplifiée à 2 lignes</strong> par transaction, avec un <strong>montant unique</strong>
              (frais Wave inclus, pas de ligne de frais séparée) : le montant est le mouvement réel sur la caisse.
            </li>
            <li>
              <strong>Sortie</strong> (paiement) : <strong>Débit <code>47100000</code></strong> / <strong>Crédit
              <code>57100000</code></strong> (caisse).
            </li>
            <li>
              <strong>Entrée</strong> (encaissement) : <strong>Débit <code>57100000</code></strong> (caisse) /
              <strong>Crédit <code>58500000</code></strong>.
            </li>
            <li>
              La contrepartie est fixée par le sens de l'opération mais reste <strong>modifiable ligne à ligne</strong>.
              Chaque pièce est équilibrée ; l'export est bloqué en cas de déséquilibre.
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
