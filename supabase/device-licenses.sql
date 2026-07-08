-- ===========================================================================
-- Verrouillage par appareil (licence) pour l'application Android
-- ---------------------------------------------------------------------------
-- Un « code d'activation » ne peut activer l'application que sur UN SEUL
-- téléphone. Réutilisé ailleurs, il est refusé. La réinstallation sur le même
-- téléphone reste possible (l'identifiant Android est stable).
--
-- À exécuter une fois dans Supabase : SQL Editor → coller tout ce fichier → Run.
-- ===========================================================================

create table if not exists public.device_licenses (
  code         text primary key,
  device_id    text,
  label        text,
  active       boolean not null default true,
  activated_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Sécurité : aucune lecture/écriture directe via la clé publique. Tout passe
-- par les fonctions ci-dessous (SECURITY DEFINER), qui appliquent la règle
-- « un code = un appareil ».
alter table public.device_licenses enable row level security;

-- Active (ou lie) un appareil à un code.
create or replace function public.activate_device(p_code text, p_device_id text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  r public.device_licenses;
begin
  select * into r from public.device_licenses where code = p_code;
  if not found or not r.active then
    return json_build_object('ok', false, 'reason', 'invalide');
  end if;
  if r.device_id is null then
    update public.device_licenses
       set device_id = p_device_id, activated_at = now()
     where code = p_code;
    return json_build_object('ok', true);
  elsif r.device_id = p_device_id then
    return json_build_object('ok', true);
  else
    return json_build_object('ok', false, 'reason', 'autre_appareil');
  end if;
end;
$func$;

-- Vérifie, à chaque ouverture, que le code correspond bien à cet appareil.
create or replace function public.verify_device(p_code text, p_device_id text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  r public.device_licenses;
begin
  select * into r from public.device_licenses where code = p_code;
  if not found or not r.active or r.device_id is null then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', r.device_id = p_device_id);
end;
$func$;

grant execute on function public.activate_device(text, text) to anon, authenticated;
grant execute on function public.verify_device(text, text)  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- CRÉER DES CODES POUR VOS CLIENTS
-- ---------------------------------------------------------------------------
-- Ajoutez une ligne par appareil autorisé (choisissez le code que vous voulez).
-- Exemples (décommentez / adaptez) :
--
--   insert into public.device_licenses (code, label) values ('BOUL-2026-0001', 'Téléphone boutique');
--   insert into public.device_licenses (code, label) values ('BOUL-2026-0002', 'Téléphone gérant');
--
-- Pour LIBÉRER un appareil (ex. client qui change de téléphone) :
--   update public.device_licenses set device_id = null where code = 'BOUL-2026-0001';
--
-- Pour DÉSACTIVER un code :
--   update public.device_licenses set active = false where code = 'BOUL-2026-0001';
-- ===========================================================================
