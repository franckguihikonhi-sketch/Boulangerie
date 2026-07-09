# 🐟 Fish-Afric — Gestion des devis

Application de **gestion des devis** pour Fish-Afric (vente en gros de cartons
de poisson, sachets de frites et cartons de viande), conforme au *Cahier des
charges – Gestion des devis*.

> **Projet indépendant.** Cette application n'a aucun lien avec la Boulangerie
> ERP présente à la racine du dépôt : base, code et déploiement séparés.

## Fonctionnalités (cahier des charges)

- **Authentification** email / mot de passe avec **rôles** Responsable (admin)
  et Commercial.
- **Articles prédéfinis** — catalogue référence / désignation / prix unitaire
  (réservé au Responsable). Chaque devis conserve une *copie* de ses lignes.
- **Devis** — composition depuis le catalogue ou en lignes libres, quantité et
  **montant calculé automatiquement**, infos client, **numérotation automatique
  `DV-0001`**, statuts **en cours / validé / refusé**. Le commercial ne voit que
  ses devis, le Responsable les voit tous.
- **Finalisation** d'un devis validé — date + adresse de livraison, **signatures
  client et commercial** (tracé tactile), e-mail récapitulatif au Responsable.
- **Paiement** — acompte ou solde, signature client, **reçu imprimable (PDF)**,
  e-mail au Responsable. Un paiement ne peut dépasser le solde restant.
- **Suivi des paiements** — total facturé / encaissé / solde restant, statut
  **non réglé / acompte / réglé**.
- **Utilitaires** — profil et déconnexion.
- **Tableau de bord** — compteurs par statut et indicateurs d'encaissement.

## Pile technique

- **Frontend** : React 18 + Vite + Tailwind CSS, **pensé mobile-first** et
  installable (PWA) — la cible du cahier des charges est le mobile.
- **Données** : Supabase (PostgreSQL) via un cache mémoire hydraté, plus un
  **mode démonstration** entièrement local (accès invité, bac à sable de
  30 min) pour essayer l'app sans base ni compte.
- **Devise** : FCFA (entiers).

## Démarrage

```bash
cd gestion-devis
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

### Base de données

1. Créer un projet Supabase, exécuter [`supabase/setup.sql`](supabase/setup.sql)
   dans le SQL Editor.
2. Renseigner les variables d'environnement au build :
   `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
3. Sans base configurée, l'application reste utilisable via **l'accès invité
   (démo)** : bac à sable local avec des données d'exemple Fish-Afric.

### Comptes de démonstration

| Rôle | Email | Mot de passe |
|---|---|---|
| Responsable | `admin@fish-afric.com` | `admin123` |
| Commercial | `commercial@fish-afric.com` | `commercial123` |

> Note sur l'envoi d'e-mail : sans backend d'envoi (fonction Edge Supabase /
> SMTP), le navigateur ne peut pas expédier un courriel silencieux ;
> l'application ouvre le client de messagerie pré-rempli (`mailto:`). Brancher
> une fonction Edge pour un envoi réellement automatique est l'étape suivante.
