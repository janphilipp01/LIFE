-- Life OS · Ergänzung: Zwei-Faktor-Pflicht, nächtliche Sicherung, Push-Mitteilungen, Handy-Zugänge
-- Einmal im SQL-Editor ausführen, NACH schema.sql. Kann gefahrlos erneut ausgeführt werden.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- 1) Zwei-Faktor: Wer einen Authenticator eingerichtet hat, kommt nur mit Code an die Daten
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as
$$ select coalesce(auth.jwt()->>'aal','aal1') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') $$;

drop policy if exists "docs mfa" on public.docs;
create policy "docs mfa" on public.docs as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
drop policy if exists "files mfa" on storage.objects;
create policy "files mfa" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'files' or public.mfa_ok()) with check (bucket_id <> 'files' or public.mfa_ok());

-- 2) Nächtliche Sicherung: Kopie aller Daten, 30 Tage aufbewahrt (nur per SQL lesbar)
create table if not exists private.backups (day date primary key, data jsonb not null, created_at timestamptz not null default now());
create or replace function private.make_backup() returns void
language sql security definer set search_path = public, private as
$$ insert into private.backups(day, data)
     select current_date, coalesce(jsonb_agg(jsonb_build_object('coll', coll, 'id', id, 'data', data)), '[]'::jsonb) from public.docs
   on conflict (day) do update set data = excluded.data, created_at = now();
   delete from private.backups where day < current_date - 30; $$;
select cron.unschedule(jobid) from cron.job where jobname = 'lifeos-backup';
select cron.schedule('lifeos-backup', '15 1 * * *', $$select private.make_backup()$$);
-- Wiederherstellen eines Tages (Beispiel):
-- insert into public.docs(coll,id,data) select x->>'coll', x->>'id', x->'data' from private.backups b, jsonb_array_elements(b.data) x
--   where b.day = '2026-10-20' on conflict (coll,id) do update set data = excluded.data, updated_at = now();

-- 3) Interne Schlüssel (Cron-Geheimnis, Push-Schlüssel, Projekt-Adresse) – nur für die Server-Funktionen
create table if not exists private.secrets (k text primary key, v text not null);
insert into private.secrets values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (k) do nothing;
create or replace function public.srv_secret(p_k text) returns text
language sql stable security definer set search_path = private as $$ select v from private.secrets where k = p_k $$;
create or replace function public.srv_secret_set(p_k text, p_v text) returns void
language sql security definer set search_path = private as
$$ insert into private.secrets values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
revoke execute on function public.srv_secret(text) from public, anon, authenticated;
revoke execute on function public.srv_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.srv_secret(text) to service_role;
grant execute on function public.srv_secret_set(text, text) to service_role;

-- 4) Push-Abos je Gerät
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push own" on public.push_subs;
create policy "push own" on public.push_subs for all to authenticated
  using (user_id = auth.uid() and public.mfa_ok()) with check (user_id = auth.uid() and public.mfa_ok());

-- Stündlicher Aufruf der Push-Funktion; sie sendet nur um 7 und 18 Uhr (deutsche Zeit).
-- Wird von der App beim Einschalten der Mitteilungen eingerichtet (kein manueller Schritt nötig).
create or replace function public.setup_push(p_url text) returns void
language plpgsql security definer set search_path = public, private, extensions as
$$ begin
  if public.my_role() is distinct from 'owner' or not public.mfa_ok() then raise exception 'nur für Jan'; end if;
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co$' then raise exception 'ungültige Projekt-Adresse'; end if;
  insert into private.secrets values ('url', p_url) on conflict (k) do update set v = excluded.v;
  perform cron.unschedule(jobid) from cron.job where jobname = 'lifeos-push';
  perform cron.schedule('lifeos-push', '15 * * * *',
    format($c$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron',(select v from private.secrets where k='cron')), body := '{}'::jsonb)$c$,
           p_url || '/functions/v1/push?slot=auto'));
end $$;
revoke execute on function public.setup_push(text) from public, anon;
grant execute on function public.setup_push(text) to authenticated;

-- 5) Handy-Zugänge für Kurzbefehle, Widget und Kalender-Abo (Schlüssel wird nur als Hash gespeichert)
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  scope text not null check (scope in ('handy', 'kalender')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
alter table public.device_tokens enable row level security;
drop policy if exists "tokens read own" on public.device_tokens;
drop policy if exists "tokens delete own" on public.device_tokens;
create policy "tokens read own" on public.device_tokens for select to authenticated using (user_id = auth.uid() and public.mfa_ok());
create policy "tokens delete own" on public.device_tokens for delete to authenticated using (user_id = auth.uid() and public.mfa_ok());

create or replace function public.create_device_token(p_label text, p_scope text) returns text
language plpgsql security definer set search_path = public, extensions as
$$ declare t text; begin
  if public.my_role() is null then raise exception 'kein Zugang'; end if;
  if not public.mfa_ok() then raise exception 'Bitte erst mit Zwei-Faktor-Code anmelden'; end if;
  if p_scope not in ('handy', 'kalender') then raise exception 'ungültiger Bereich'; end if;
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.device_tokens(user_id, label, scope, token_hash)
    values (auth.uid(), left(coalesce(nullif(trim(p_label), ''), 'Handy'), 60), p_scope, encode(extensions.digest(t, 'sha256'), 'hex'));
  return t;
end $$;
revoke execute on function public.create_device_token(text, text) from public, anon;
grant execute on function public.create_device_token(text, text) to authenticated;
