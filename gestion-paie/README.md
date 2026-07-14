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
- **Données** : couche locale (localStorage) — l'application fonctionne
  immédiatement, hors-ligne, sans compte. Le schéma PostgreSQL cible est prêt
  dans [`supabase/schema.sql`](supabase/schema.sql) pour une migration Supabase.
- **Moteur de paie** : [`src/lib/payroll.js`](src/lib/payroll.js), isolé et testé.

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
| **Retenues salariales** | Retraite CNPS **6,3 %** (dans la limite du plafond 3 375 000) + CMU **1 000 FCFA**. |
| **Charges patronales** | Prestations familiales 5 % · accident du travail 2–5 % · retraite 7,7 % · taxe d'apprentissage 0,4 % · FPC 1,2 % · IS local 1,2 %. |
| **Prime de transport** | Exonérée jusqu'à **30 000 FCFA** ; l'excédent devient imposable et cotisable. |

Tous les montants sont en **FCFA entiers**, arrondis **avant** écriture
(`src/lib/money.js`) pour éviter toute dérive flottante sur les cumuls.

## Modèle « périodes contractuelles »

Un salarié porte une liste ordonnée de périodes `[{ kind, debut, fin, salaireBase,
netCible, transport, primes }]`. Pour chaque mois d'une plage demandée, le moteur
sélectionne la période applicable (`periodePourMois`) et calcule le bulletin.
Ce modèle couvre nativement **un CDD renouvelé plusieurs fois puis basculé en CDI**,
chaque période ayant son propre salaire et ses primes.

## Génération PDF

`src/lib/bulletin.js` construit un document HTML autonome (un bulletin par page,
saut de page automatique) ouvert dans la boîte d'impression du navigateur —
« Enregistrer en PDF ». Aucune dépendance PDF externe : le rendu imprimé est
identique à l'aperçu écran, en lot comme à l'unité.

## Migration Supabase

1. Créer le projet Supabase et exécuter `supabase/schema.sql`.
2. Renseigner `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. Remplacer les fonctions de `src/lib/db.js` par des appels `supabase.from(...)`
   (l'API applicative — `saveEmployee`, `deleteEmployee`, `saveSettings` — reste
   identique).
4. Activer Supabase Auth + Row Level Security (colonne `owner`).
5. Déployer sur Cloudflare Pages (`npm run build`, dossier `dist/`).
