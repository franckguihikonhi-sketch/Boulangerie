# 🧾 PaieCI — Bulletins de paie (Côte d'Ivoire)

SaaS de génération de **bulletins de paie conformes à la législation ivoirienne**
(CNPS, CMU, ITS/IGR). Il produit des bulletins **en lot** (tous les salariés)
ou **par salarié**, sur **plusieurs mois**, exportables en **PDF** (via la boîte
d'impression du navigateur), à partir d'un minimum de saisie :

> **Nom et prénoms · Situation matrimoniale · Nombre d'enfants · N° CNPS ·
> Type de contrat** (avec **renouvellements de CDD** successifs) · **passage en
> CDI**.

Pour chaque **période contractuelle** (CDD initial, chaque renouvellement, CDI)
on saisit simplement le **salaire de base**, le **salaire NET cible** et
d'éventuelles **primes** : le **sursalaire** est alors calculé automatiquement
pour atteindre exactement ce net.

## Pile technique

- **Frontend** : React 18 + Vite + Tailwind CSS (responsive mobile / desktop)
- **Données** : **Supabase (PostgreSQL)** + cache mémoire hydraté et
  synchronisation temps réel — même architecture que les autres modules du
  dépôt. Un **mode démonstration** (accès invité, 30 min) rejoue toute la
  logique dans un bac à sable **entièrement local**, sans toucher la base.
- **Moteur de paie** : [`src/lib/payroll.js`](src/lib/payroll.js), isolé et testé.

### Base de données

1. Créer un projet Supabase, ouvrir **SQL Editor** et exécuter
   [`supabase/setup.sql`](supabase/setup.sql) (tables `settings` / `employees` /
   `periodes` / `primes`, fonction transactionnelle `save_employee`, politiques
   RLS pour la clé `anon`).
2. Renseigner les variables d'environnement `VITE_SUPABASE_URL` et
   `VITE_SUPABASE_ANON_KEY` (fichier `.env`), puis `npm run dev`.
3. Sans configuration Supabase, l'écran d'accueil propose le **mode
   démonstration** (bac à sable local) : idéal pour tester sans compte.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

### Comptes de démonstration

| Rôle | Email | Mot de passe |
|---|---|---|
| Responsable Paie | `admin@paie.ci` | `admin123` |
| Gestionnaire RH | `rh@paie.ci` | `rh123` |

Un bouton **« Essayer en mode démonstration »** ouvre directement l'application
avec deux salariés d'exemple (dont un CDD renouvelé deux fois puis passé en CDI).

## Règles de calcul implémentées (cahier « Résumé Paie »)

| Élément | Règle |
|---|---|
| **Salaire de base** | Saisi manuellement par période. |
| **Sursalaire** | Résolu automatiquement (recherche dichotomique) pour atteindre le **salaire NET cible**. |
| **Prime d'ancienneté** | 2 % à la 2ᵉ année, +1 %/an, plafond **25 %** ; assiette = **salaire catégoriel** (minimum conventionnel). |
| **Impôt brut avant RICF** | Barème **ITS progressif** par tranches (0 / 16 / 21 / 24 / 28 / 32 %). |
| **RICF** | Réduction pour charges de famille = **11 000 FCFA par demi-part** au-delà de la 1ʳᵉ part (parts IGR selon situation + enfants). |
| **ITS** | `Impôt brut − RICF`, jamais négatif. |
| **Retenues salariales** | Retraite CNPS **6,3 %** (assiette plafonnée à 3 375 000) + CMU **500 FCFA** (part salariale du forfait de 1 000 FCFA, réparti 500/500). |
| **Charges patronales** | Retraite **7,7 %** · prestations familiales **5,75 %** & accident du travail **2–5 %** (assiette plafonnée à **75 000**) · IS local **1,2 %** (ou **11,5 %** pour un expatrié) · taxe d'apprentissage **0,4 %** · FPC **0,6 %** · CMU **500**. |
| **Prime de transport** | Exonérée jusqu'à **30 000 FCFA** ; l'excédent devient imposable et cotisable. |

Le bulletin PDF reproduit la présentation standard ivoirienne (rubriques codées
`10 / 12 / 20 / 412 / 416 / 452 / 480 / 490 / 500 / 511 / 520 / 530 / 551 / 708`,
colonnes *Part salariale* / *Part patronale*, *Total Brut*, *Total Cotisations*,
bloc *Cumuls* et *Net à payer*) — validé au FCFA près contre un bulletin de
référence.

Tous les montants sont en **FCFA entiers**, arrondis **avant** écriture
(`src/lib/money.js`) pour éviter toute dérive flottante sur les cumuls.

## Modèle « périodes contractuelles »

Un salarié porte une liste ordonnée de périodes `[{ kind, debut, fin, salaireBase,
netCible, transport, primes }]`. Pour chaque mois d'une plage demandée, le moteur
sélectionne la période applicable (`periodePourMois`) et calcule le bulletin.
Ce modèle couvre nativement **un CDD renouvelé plusieurs fois puis basculé en CDI**,
chaque période ayant son propre salaire et ses primes.

## Génération & aperçu PDF

`src/lib/bulletin.js` construit un document HTML autonome (un bulletin par page,
saut de page automatique). **L'aperçu à l'écran affiche exactement le bulletin
imprimé** (parts salariale ET patronale, cotisations, cumuls, net) via un iframe
isolé : « ce qui est affiché est ce qui est imprimé ». L'impression passe par un
**iframe caché same-origin** (et non `window.open`), ce qui contourne les
bloqueurs de pop-ups et fonctionne dans un cadre restreint, avec repli sur un
onglet si l'impression directe échoue. Aucune dépendance PDF externe.

## Production

1. Exécuter `supabase/setup.sql` dans Supabase (voir « Base de données »).
2. Activer Supabase **Auth + Row Level Security** par utilisateur (ajouter une
   colonne `owner uuid references auth.users` et des policies par propriétaire).
   Le calcul de paie reste côté client (`src/lib/payroll.js`).
3. Déployer sur Cloudflare Pages (`npm run build`, dossier `dist/`), avec les
   variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
