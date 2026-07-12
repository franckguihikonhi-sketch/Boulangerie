# 🌊 Wave → SAGE — Import comptable (SYSCOHADA révisé)

Application autonome qui **supprime la ressaisie manuelle** des transactions
Wave Business. Elle importe le relevé exporté par Wave (`.xls` / `.xlsx` /
`.csv`), **impute automatiquement** chaque transaction selon le plan comptable
**SYSCOHADA révisé**, puis génère un **fichier d'import SAGE 100** que le
comptable charge dans le journal désigné.

> Projet **indépendant** des autres applications du dépôt : il a **sa propre
> base de données** (`supabase/setup.sql`), aucune donnée n'est partagée.

## Flux d'utilisation

1. **📥 Importer un relevé** — sélectionnez le fichier Wave. Tout le traitement
   est réalisé **localement dans le navigateur** (aucun envoi de fichier).
2. **Vérifier** — l'application affiche les écritures imputées, le contrôle de
   partie double et signale les lignes imputées « par défaut » à contrôler.
   Vous pouvez corriger le compte de contrepartie de chaque ligne et
   **mémoriser** un compte pour une contrepartie donnée.
3. **📤 Export SAGE** — télécharge le fichier texte à largeur fixe, prêt à
   importer dans SAGE. L'export est **bloqué tant qu'une pièce n'est pas
   équilibrée**.

## Logique comptable

Le solde Wave est un compte de **trésorerie** (monnaie électronique). Le solde
bouge toujours du **montant exact** de la transaction ; les **frais Wave** sont
isolés sur une charge financière dédiée.

| Cas | Écriture générée |
|---|---|
| **Paiement** (`montant < 0`), total `T`, frais `F`, net `N = T − F` | **D** compte de charge `N` · **D** `63170000` frais `F` · **C** `57100000` trésorerie `T` |
| **Encaissement** (`montant > 0`), net `N`, frais `F`, brut `B = N + F` | **D** `57100000` trésorerie `N` · **D** `63170000` frais `F` · **C** compte de produit `B` |
| **Annulation** (`*_reversal`) | contre-passation : trésorerie ré-alimentée, charge et frais au crédit |

Comptes par défaut (modifiables dans **Paramètres**) :

| Rôle | Compte | Intitulé SYSCOHADA |
|---|---|---|
| Trésorerie (journal caisse) | `57100000` | Caisse (compte de trésorerie du journal CAI) |
| Frais Wave | `63170000` | Frais sur instruments de monnaie électronique |
| Charge par défaut | `60580000` | Achats de travaux, matériels et équipements |
| Produit par défaut | `70610000` | Services vendus dans la région |

Le **compte de contrepartie** (charge ou produit) est déterminé par une
cascade : compte mémorisé par contrepartie → **règles par mots-clés** (écran
**Règles**, éditables) → compte par défaut signalé « à vérifier ».

## Format d'export SAGE

Fichier texte à **largeur fixe**, origine Windows (encodage **Windows-1252**),
une écriture par ligne, sans entête :

| Champ | Longueur | Position |
|---|---|---|
| Code journal | 6 | 1 |
| Date de pièce (`jjmmaa`) | 6 | 7 |
| N° compte général | 13 | 13 |
| Libellé écriture | 35 | 26 |
| Montant débit | 14 | 61 |
| Montant crédit | 14 | 75 |

Montants à 2 décimales, séparateur décimal « , », cadrés à droite. Conforme à
l'import « écritures comptables » de SAGE 100 Comptabilité i7.

## Pile technique

- **Frontend** : React 18 + Vite + Tailwind CSS (responsive)
- **Lecture Excel/CSV** : SheetJS (`xlsx`)
- **Données** : local-first (localStorage) avec base **Supabase dédiée**
  optionnelle — l'app reste pleinement utilisable sans configuration

## Démarrage

```bash
cd wave-sage
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

## Base de données dédiée (optionnelle)

Pour partager les paramètres, règles, mappings et l'historique entre postes :

1. Créez un **nouveau projet Supabase** (base propre à cette application).
2. Dans **SQL Editor**, exécutez [`supabase/setup.sql`](supabase/setup.sql) :
   il crée les tables, active RLS, insère le **plan SYSCOHADA (1091 comptes, numéros à 8 chiffres)**,
   les **paramètres** et les **règles** par défaut.
3. Renseignez les variables d'environnement avant le build :

```bash
VITE_SUPABASE_URL=...           # URL du projet dédié
VITE_SUPABASE_ANON_KEY=...      # clé publishable (anon) — jamais la clé secret
```

Sans ces variables, l'application fonctionne en **mode local** (navigateur).
