import { useState } from 'react';
import { Card, InfoNote } from '../components/ui';

export default function Apropos() {
  const [photoOk, setPhotoOk] = useState(true);

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

      {/* Concepteur */}
      <Card title="Concepteur">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="flex-none">
            {photoOk ? (
              <img
                src="./concepteur.jpg"
                alt="Franck G. KONHI"
                onError={() => setPhotoOk(false)}
                className="h-32 w-32 rounded-2xl object-cover shadow-md ring-1 ring-stone-200"
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-brand-100 text-3xl font-bold text-brand-700 shadow-inner ring-1 ring-stone-200">
                FK
              </div>
            )}
          </div>
          <div className="text-center sm:text-left">
            <p className="text-lg font-bold text-stone-900">Mr Franck G. KONHI</p>
            <ul className="mt-2 space-y-1 text-sm text-stone-600">
              <li>Concepteur &amp; développeur de l'application</li>
              <li>Solutions de gestion &amp; automatisation comptable</li>
            </ul>
            <p className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-stone-800 sm:justify-start">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="text-brand-600">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              Téléphone : 07 78 08 44 06
            </p>
          </div>
        </div>
        <p className="mt-5 text-center text-xs text-stone-400 sm:text-left">
          © {new Date().getFullYear()} Wave → SAGE — Mr Franck G. KONHI. Tous droits réservés.
        </p>
      </Card>
    </div>
  );
}
