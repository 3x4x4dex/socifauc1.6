-- Stories com expiração garantida no servidor e atualizações em tempo real.
-- Execute no SQL Editor do Supabase depois de supabase-schema.sql.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  image_url text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists stories_active_created_idx
  on public.stories (expires_at, created_at desc);

alter table public.stories enable row level security;

drop policy if exists "stories are readable" on public.stories;
drop policy if exists "users create own stories" on public.stories;
drop policy if exists "Active stories are readable" on public.stories;
drop policy if exists "Authenticated users create own stories" on public.stories;

create policy "Active stories are readable"
  on public.stories for select
  using (expires_at > now());

create policy "Authenticated users create own stories"
  on public.stories for insert to authenticated
  with check (author_id = (select auth.uid()));

create or replace function public.set_story_expiration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := now();
  new.expires_at := new.created_at + interval '24 hours';
  return new;
end;
$$;

drop trigger if exists set_story_expiration_before_insert on public.stories;
create trigger set_story_expiration_before_insert
  before insert on public.stories
  for each row execute function public.set_story_expiration();

grant select on public.stories to anon, authenticated;
grant insert on public.stories to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end $$;
