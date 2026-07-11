# Écritures SAGE — Export comptable

Application **indépendante** de saisie des écritures comptables et d'export au
format d'import de **SAGE 100 Comptabilité i7**. Aucun lien avec les autres
applications du dépôt : son propre code, son propre build, sa propre base.

## À quoi ça sert

1. On **saisit** les écritures : code journal, date de pièce, n° de compte,
   libellé, montant débit / crédit.
2. On vérifie l'**équilibre** débit = crédit (badge en haut du tableau).
3. On **exporte** d'un clic un fichier texte que l'on importe dans SAGE. La
   colonne « Code journal » aiguille chaque écriture vers le bon journal.

## Format du fichier (fiche Sage)

Fichier à **largeur fixe**, origine Windows, sans entête, une écriture par ligne.

| Champ | Longueur | Position |
| --- | --- | --- |
| Code journal | 6 | 1 |
| Date de pièce (`jjmmaa`) | 6 | 7 |
| N° compte général | 13 | 13 |
| Libellé écriture | 35 | 26 |
| Montant débit | 14 | 61 |
| Montant crédit | 14 | 75 |

Longueur d'un enregistrement : **88 caractères** + `CRLF`. Montants à 2 décimales
(séparateur virgule, sans séparateur de milliers, cadrés à droite). Encodage
**Windows-1252 (ANSI)**.

## Démarrer

```bash
npm install
npm run dev
```

## Stockage des écritures

- **Base Supabase dédiée** si `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
  sont renseignés (les écritures sont partagées entre appareils). Exécuter une
  fois `supabase/setup.sql` dans le projet Supabase pour créer la table.
- **Stockage local** du navigateur sinon : l'application fonctionne
  immédiatement, hors ligne, sans configuration.

Créez un fichier `.env` pour brancher votre base :

```
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

## Build

```bash
npm run build      # génère dist/
npm run preview    # sert le build
```
