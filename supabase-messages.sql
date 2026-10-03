-- Seguidores e mensagens privadas do socifauc.
-- Execute no SQL Editor do Supabase depois de supabase-schema.sql e supabase-admin.sql.

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

create index if not exists follows_following_created_idx
  on public.follows (following_id, created_at desc);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint direct_messages_no_self_message check (sender_id <> recipient_id)
);

create index if not exists direct_messages_sender_created_idx
  on public.direct_messages (sender_id, created_at desc);
create index if not exists direct_messages_recipient_created_idx
  on public.direct_messages (recipient_id, created_at desc);

alter table public.follows enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "Users can view their follow relationships" on public.follows;
drop policy if exists "Users can follow from their account" on public.follows;
drop policy if exists "Users can unfollow from their account" on public.follows;
drop policy if exists "Participants can read direct messages" on public.direct_messages;
drop policy if exists "Users can message their followers" on public.direct_messages;

create policy "Users can view their follow relationships"
  on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or following_id = (select auth.uid()));

create policy "Users can follow from their account"
  on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and follower_id <> following_id);

create policy "Users can unfollow from their account"
  on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

create policy "Participants can read direct messages"
  on public.direct_messages for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy "Users can message their followers"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_id <> recipient_id
    and exists (
      select 1
      from public.follows f
      where f.follower_id = recipient_id
        and f.following_id = (select auth.uid())
    )
  );

-- Atualiza os contadores existentes em profiles quando alguém segue/deixa de seguir.
create or replace function public.sync_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set followers_count = followers_count + 1 where id = new.following_id;
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    return new;
  end if;

  update public.profiles set followers_count = greatest(0, followers_count - 1) where id = old.following_id;
  update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
  return old;
end;
$$;

drop trigger if exists sync_follow_counts_after_insert on public.follows;
drop trigger if exists sync_follow_counts_after_delete on public.follows;
create trigger sync_follow_counts_after_insert
  after insert on public.follows
  for each row execute function public.sync_follow_counts();
create trigger sync_follow_counts_after_delete
  after delete on public.follows
  for each row execute function public.sync_follow_counts();

grant select, insert, delete on public.follows to authenticated;
grant select, insert on public.direct_messages to authenticated;

-- Habilita atualizações em tempo real da caixa de entrada, sem falhar se já estiver publicada.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
