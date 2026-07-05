# 🥖 Boulange ERP — V2

SaaS de gestion de boulangerie (suivi des ingrédients, achats, production,
ventes et rapports), conforme au **cahier des charges V2 du 5 juillet 2026** :
les 15 anomalies du diagnostic y sont corrigées structurellement, pas
seulement à l'affichage.

## Pile technique

- **Frontend** : React 18 + Vite + Tailwind CSS (responsive mobile / desktop)
- **Données** : couche de données locale (localStorage) qui reproduit les
  garanties du schéma PostgreSQL cible — le schéma Supabase complet est prêt
  dans [`supabase/schema.sql`](supabase/schema.sql) pour la migration
  (transactions, contraintes UNIQUE d'idempotence, ENUM, RLS par rôle)
- **Déploiement cible** : Cloudflare Pages (frontend) + Supabase Cloud

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

### Comptes de démonstration

| Rôle | Email | Mot de passe | Accès |
|---|---|---|---|
| Administrateur | `admin@boulangerie.com` | `admin123` | complet (9 modules) |
| Opérateur | `vendeur@boulangerie.com` | `vendeur123` | Ventes + Production, sans coûts ni marges |

L'application démarre avec des données de démonstration réalistes
(7 jours d'achats, productions et ventes).

## Correspondance anomalies → corrections

| # | Anomalie | Correction structurelle |
|---|---|---|
| 1, 3 | Arrondis flottants (499,999… FCFA) | `roundFCFA()` appliqué **avant chaque écriture** ; FCFA toujours entiers (`src/lib/money.js`) |
| 2 | « Valeur totale du stock » = 0 | Cartes de synthèse calculées **à partir des lignes du tableau affiché**, jamais d'agrégat en cache (`src/pages/Stock.jsx`) |
| 4, 5 | Productions dupliquées | **Clé d'idempotence** générée côté client + bouton désactivé pendant l'appel ; contrainte `UNIQUE(idempotency_key)` (`src/lib/db.js`, `supabase/schema.sql`) |
| 6 | Marge à −5 633 % | Séparation stricte **Dépenses (trésorerie)** / **COGS** ; marge = (CA − COGS) ÷ CA, « n/a » si CA = 0 (`src/lib/reports.js`) |
| 7 | Coût aperçu ≠ coût historique | Le **même moteur de calcul** produit l'aperçu et fige `total_cost` à la validation ; jamais recalculé (`productionPreview` / `recordProduction`) |
| 8 | « Sel : 0,00 kg » | Unité de **base** par ingrédient (g/ml/unité) ; stockage et consommation en base, conversion kg/L à l'affichage uniquement (`src/lib/units.js`) |
| 9 | 1 kg de glaçage / baguette | Garde-fou à la saisie de recette : alerte si une quantité par unité dépasse un seuil réaliste (`src/pages/Products.jsx`) |
| 10 | « Pain » → « DOULEUR » | Catégories = **liste fermée (enum)** ; libellés uniquement via `fr.json` / `en.json` statiques, aucune traduction automatique |
| 11 | « Économisez un achat » | Tous les libellés d'interface viennent des fichiers de traduction statiques |
| 12 | Suppression d'achat orpheline | Suppression **transactionnelle** : achat + mouvement retirés ensemble ; bloquée avec message explicite si le stock est déjà consommé |
| 13 | « Événements » vs « Ventes » | Menu **identique** desktop/mobile : 9 modules, même ordre, libellé unique « Ventes » (`src/components/Layout.jsx`) |
| 14 | Graphique 7 jours incohérent | Deux séries regroupées sur le **même référentiel de dates** (fuseau unique `Africa/Abidjan`), données `TEST_*` exclues ; un graphique par mesure (pas de double axe) |
| 15 | Bénéfice vs Marge brute | Deux cartes **étiquetées explicitement** avec leur formule en info-bulle + note méthodologique (`src/pages/Dashboard.jsx`) |

## Règles de gestion implémentées

- **CMP** = (valeur de stock avant + qté achetée × coût) ÷ (qté avant + qté
  achetée), recalculé à chaque achat, arrondi à l'entier FCFA.
- **Coût de production** = Σ (quantité consommée × CMP au moment de la
  production), figé définitivement à la validation.
- **Dépenses** = Σ achats de la période (trésorerie) ; **COGS** = Σ coûts de
  production figés — seule donnée comparée au chiffre d'affaires.
- **Stock courant** = Σ des mouvements de stock (source de vérité unique).
- La vente ne décrémente que le stock de **produits finis**.

## Migration Supabase

1. Créer le projet Supabase et exécuter `supabase/schema.sql`.
2. Activer Supabase Auth (email + mot de passe) et créer les profils
   `admin` / `operateur`.
3. Remplacer les fonctions de `src/lib/db.js` par des appels
   `supabase.rpc('record_purchase' | 'record_production' | 'record_sale' |
   'delete_purchase', …)` — l'API applicative est identique.
4. Déployer sur Cloudflare Pages (`npm run build`, dossier `dist/`).
5. Recette de non-régression : rejouer les 15 scénarios d'anomalies de la
   section 2 du cahier des charges.
