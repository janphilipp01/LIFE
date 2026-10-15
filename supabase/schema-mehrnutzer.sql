-- Life OS · Ergänzung: eigene App für weitere Personen, Zuhause (Haushalt + Reisen) gemeinsam
-- Rollen: owner = Jan (eigener Bereich ohne Präfix) · user = eigene App im Bereich u/<space>/ · partner = nur Zuhause
-- Einmal nach schema.sql und schema-handy.sql ausführen; kann erneut ausgeführt werden.

alter table public.members add column if not exists space text;
alter table public.members add column if not exists hh text;
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'partner', 'user'));
alter table public.members drop constraint if exists members_hh_check;
alter table public.members add constraint members_hh_check check (hh is null or hh in ('a', 'b'));
alter table public.members drop constraint if exists members_space_check;
alter table public.members add constraint members_space_check check (space is null or space ~ '^[a-z0-9-]{2,30}$');
create unique index if not exists members_space_uniq on public.members (space) where space is not null;

-- Wer darf welche Sammlung sehen
create or replace function public.can_access(c text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((
     select c = 'hh' or c like 'hh/%'
        or (m.role = 'owner' and c not like 'u/%')
        or (m.role = 'user' and m.space is not null and c like 'u/' || m.space || '/%')
     from public.members m where m.user_id = auth.uid()), false) $$;

-- Dateien: jede Person nur ihre eigenen
create or replace function public.can_file(n text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((
     select (m.role = 'owner' and n not like 'u/%')
         or (m.role = 'user' and m.space is not null and n like 'u/' || m.space || '/%')
     from public.members m where m.user_id = auth.uid()), false) $$;
drop policy if exists "files owner all" on storage.objects;
drop policy if exists "files own" on storage.objects;
create policy "files own" on storage.objects for all to authenticated
  using (bucket_id = 'files' and public.can_file(name))
  with check (bucket_id = 'files' and public.can_file(name));

-- Reisen werden gemeinsam
update public.docs set coll = 'hh/main/trips' where coll = 'trips';
update public.members set hh = 'a' where role = 'owner' and hh is null;

-- Person freischalten (Beispiel):
-- update public.members set role = 'user', space = 'sophie', hh = 'b'
--   where user_id = (select id from auth.users where email = 'SOPHIES-MAIL');
