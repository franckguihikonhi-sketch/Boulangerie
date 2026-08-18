-- ===========================================================================
-- PaieCI — migration additive : logo entreprise imprimé sur le bulletin PDF.
-- À coller dans Supabase → SQL Editor → New query → Run, SUR LA BASE DE
-- PRODUCTION existante. Idempotent, non destructif.
--
-- Ajoute settings.logo_data_url (data URI base64 du logo), à renseigner
-- ensuite depuis l'application : Paramètres → Profil employeur → Logo.
-- ===========================================================================

alter table settings add column if not exists logo_data_url text not null default '';
