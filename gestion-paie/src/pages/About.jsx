import { useI18n } from '../i18n/I18nContext';
import { Card, PageTitle } from '../components/ui';
import Logo from '../components/Logo';

export default function About() {
  const { t } = useI18n();
  const formulas = [
    ['Salaire de base', 'Saisi manuellement pour chaque période contractuelle.'],
    ['Sursalaire', 'Calculé automatiquement (résolution inverse) pour atteindre le salaire NET cible saisi.'],
    ['Prime d’ancienneté', '2 % à la 2ᵉ année, +1 % par année, plafonnée à 25 % — appliquée au salaire catégoriel (minimum conventionnel).'],
    ['ITS (impôt sur salaire)', 'Barème progressif par tranches sur le brut imposable, diminué de la RICF (charges de famille) ; jamais négatif.'],
    ['RICF', 'Réduction selon le nombre de parts IGR (situation matrimoniale + enfants) : 11 000 FCFA par demi-part au-delà de la première.'],
    ['Cotisations salariales', 'Retraite CNPS 6,3 % (assiette plafonnée) + CMU 500 FCFA (part salariale du forfait de 1 000 FCFA).'],
    ['Charges patronales', 'Retraite 7,7 %, prestations familiales 5,75 % et accident du travail 2–5 % (assiette plafonnée à 75 000), IS local 1,2 % (ou 11,5 % pour un expatrié), taxe d’apprentissage 0,4 %, FPC 0,6 %, CMU 500 FCFA.'],
    ['Prime de transport', 'Exonérée jusqu’à 30 000 FCFA ; l’excédent est imposable et cotisable.'],
    ['Renouvellements CDD / passage CDI', 'Chaque période porte ses propres salaire de base, NET cible et primes ; le bon régime est appliqué mois par mois.']
  ];

  return (
    <div>
      <PageTitle>{t('about.title')}</PageTitle>
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <Logo size={44} />
          <div>
            <p className="text-lg font-bold text-stone-900">{t('app.name')}</p>
            <p className="text-sm text-stone-500">{t('app.tagline')}</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-stone-700">{t('about.intro')}</p>

        <h2 className="mt-5 mb-2 text-sm font-semibold text-stone-800">{t('about.formulasTitle')}</h2>
        <ul className="space-y-2">
          {formulas.map(([k, v]) => (
            <li key={k} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
              <p className="text-sm font-semibold text-stone-800">{k}</p>
              <p className="text-xs leading-relaxed text-stone-600">{v}</p>
            </li>
          ))}
        </ul>

        <h2 className="mt-5 mb-2 text-sm font-semibold text-stone-800">{t('about.migrationTitle')}</h2>
        <p className="text-xs leading-relaxed text-stone-600">
          Les données de paie sont enregistrées dans une base <strong>Supabase (PostgreSQL)</strong> —
          sauvegarde centralisée, multi-appareils, synchronisation temps réel. Le schéma complet et la
          fonction d'enregistrement transactionnelle sont fournis dans <code>supabase/setup.sql</code>.
          En l'absence de base configurée, le <strong>mode démonstration</strong> rejoue toute la
          logique dans un bac à sable local, sans rien transmettre à un serveur.
        </p>
      </Card>
    </div>
  );
}
