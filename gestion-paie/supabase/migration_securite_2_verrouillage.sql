-- ===========================================================================
-- PaieCI — sécurité (partie 2/2) : verrouillage réel.
-- ⚠️ NE PAS EXÉCUTER avant d'avoir : (1) appliqué la partie 1/2, (2) créé les
-- deux comptes dans Supabase → Authentication → Users, (3) VÉRIFIÉ que la
-- connexion réelle fonctionne avec ces comptes depuis l'application déployée.
-- Après cette partie, la clé publique (anon) seule ne donne plus AUCUN accès
-- aux données : seuls les comptes listés ci-dessous (et tout futur compte
-- ajouté à `profiles`) pourront se connecter et voir quoi que ce soit.
--
-- Remplacez les noms ci-dessous si besoin (ils sont indicatifs), puis Run.
-- ===========================================================================

-- 1) Enregistre les deux comptes autorisés (doivent déjà exister dans
--    Authentication → Users au moment de l'exécution).
insert into profiles (id, email, name, role)
select id, email, 'Franck G. KONHI', 'admin' from auth.users where email = 'franckguihikonhi@gmail.com'
on conflict (id) do update set email = excluded.email, role = excluded.role;

insert into profiles (id, email, name, role)
select id, email, 'Christ Ithiel Kony', 'gestionnaire' from auth.users where email = 'chrisithielkony@gmail.com'
on conflict (id) do update set email = excluded.email, role = excluded.role;

-- 2) Verrouille chaque table : accès réservé aux comptes authentifiés ayant
--    une ligne dans profiles (la clé anon, seule, n'a plus aucun accès).
drop policy if exists anon_all on settings;
drop policy if exists anon_all on employees;
drop policy if exists anon_all on periodes;
drop policy if exists anon_all on primes;
drop policy if exists anon_all on retenues;
drop policy if exists anon_all on heures_supplementaires;
drop policy if exists anon_all on versements;
drop policy if exists anon_all on audit_log;

create policy profiles_only on settings               for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on employees              for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on periodes               for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on primes                 for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on retenues               for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on heures_supplementaires for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on versements             for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));
create policy profiles_only on audit_log              for all to authenticated using (exists (select 1 from profiles where profiles.id = auth.uid())) with check (exists (select 1 from profiles where profiles.id = auth.uid()));

-- 3) Les fonctions RPC restent exécutables par les comptes authentifiés
--    uniquement (la clé anon seule ne peut plus les appeler).
revoke execute on function save_employee(jsonb) from anon;
revoke execute on function save_versement(text, text, text, text) from anon;
