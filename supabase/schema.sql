-- Life OS · Datenbankschema für Supabase
-- Einmal im SQL-Editor des Supabase-Projekts ausführen (Dashboard → SQL Editor → New query → Run).
-- Danach: Authentication → Sign In / Providers → "Allow new users to sign up" AUSSCHALTEN.

-- 1) Mitglieder: wer darf was (owner = Jan, alles; partner = Sophie, nur Haushalt)
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','partner')),
  name text,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;
drop policy if exists "members read own" on public.members;
create policy "members read own" on public.members for select using (user_id = auth.uid());

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.members where user_id = auth.uid() $$;

-- 2) Dokumentenspeicher: eine Zeile pro Dokument, gruppiert nach Collection-Pfad
create table if not exists public.docs (
  coll text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists docs_coll_idx on public.docs (coll);
alter table public.docs replica identity full;
alter table public.docs enable row level security;

create or replace function public.can_access(c text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(
     (select role = 'owner' or (role = 'partner' and (c = 'hh' or c like 'hh/%'))
      from public.members where user_id = auth.uid()), false) $$;

drop policy if exists "docs select" on public.docs;
drop policy if exists "docs insert" on public.docs;
drop policy if exists "docs update" on public.docs;
drop policy if exists "docs delete" on public.docs;
create policy "docs select" on public.docs for select using (public.can_access(coll));
create policy "docs insert" on public.docs for insert with check (public.can_access(coll));
create policy "docs update" on public.docs for update using (public.can_access(coll)) with check (public.can_access(coll));
create policy "docs delete" on public.docs for delete using (public.can_access(coll));

-- Felder zusammenführen (für update); läuft mit den Rechten des Aufrufers, RLS gilt
create or replace function public.doc_merge(p_coll text, p_id text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as
$$ begin
  update public.docs set data = data || p_patch, updated_at = now() where coll = p_coll and id = p_id;
  if not found then raise exception 'Dokument % / % nicht gefunden', p_coll, p_id; end if;
end $$;

-- 3) Live-Aktualisierung
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 4) Dateiablage (Belege, Dokumente) – nur für Jan
insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do nothing;
drop policy if exists "files owner all" on storage.objects;
create policy "files owner all" on storage.objects for all
  using (bucket_id = 'files' and public.my_role() = 'owner')
  with check (bucket_id = 'files' and public.my_role() = 'owner');

-- 5) Zugänge freischalten – NACHDEM die Nutzer unter Authentication → Users angelegt sind:
-- insert into public.members (user_id, role, name) select id, 'owner', 'Jan' from auth.users where email = 'jpleuker@gmail.com' on conflict (user_id) do update set role = excluded.role;
-- insert into public.members (user_id, role, name) select id, 'partner', 'Sophie' from auth.users where email = 'SOPHIES-MAIL' on conflict (user_id) do update set role = excluded.role;
