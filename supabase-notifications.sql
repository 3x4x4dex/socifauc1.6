-- Notificacoes geradas no banco para interacoes sociais.
-- Execute depois de supabase-schema.sql e supabase-messages.sql.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('like','comment','repost','tip','follow','message','new_post')),
  post_id uuid references public.posts(id) on delete cascade,
  source_id uuid,
  content text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_no_self_event check (recipient_id <> actor_id)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
drop policy if exists "Users mark own notifications read" on public.notifications;

create policy "Users read own notifications"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy "Users mark own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select author_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id, source_id)
    values (post_owner, new.user_id, 'like', new.post_id, new.post_id);
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_after_post_like on public.post_likes;
create trigger notifications_after_post_like
  after insert on public.post_likes
  for each row execute function public.notify_post_like();

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select author_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id, source_id, content)
    values (post_owner, new.author_id, 'comment', new.post_id, new.id, left(new.body, 180));
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_after_post_comment on public.comments;
create trigger notifications_after_post_comment
  after insert on public.comments
  for each row execute function public.notify_post_comment();

create or replace function public.notify_post_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select author_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id, source_id)
    values (post_owner, new.user_id, 'repost', new.post_id, new.post_id);
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_after_post_repost on public.reposts;
create trigger notifications_after_post_repost
  after insert on public.reposts
  for each row execute function public.notify_post_repost();

create or replace function public.notify_tip_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  summary text;
begin
  if new.sender_id <> new.recipient_id then
    summary := format('Gorjeta de %s SFC', to_char(new.amount_sfc, 'FM999999999990.000000'));
    if length(btrim(coalesce(new.message, ''))) > 0 then
      summary := summary || ': ' || left(btrim(new.message), 160);
    end if;
    insert into public.notifications (recipient_id, actor_id, type, post_id, source_id, content)
    values (new.recipient_id, new.sender_id, 'tip', new.post_id, new.id, left(summary, 240));
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_after_tip on public.tips;
create trigger notifications_after_tip
  after insert on public.tips
  for each row execute function public.notify_tip_received();

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id <> new.following_id then
    insert into public.notifications (recipient_id, actor_id, type, source_id)
    values (new.following_id, new.follower_id, 'follow', new.follower_id);
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_after_follow on public.follows;
create trigger notifications_after_follow
  after insert on public.follows
  for each row execute function public.notify_new_follower();

create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, source_id, content)
  values (new.recipient_id, new.sender_id, 'message', new.id, left(new.body, 180));
  return new;
end;
$$;

drop trigger if exists notifications_after_direct_message on public.direct_messages;
create trigger notifications_after_direct_message
  after insert on public.direct_messages
  for each row execute function public.notify_direct_message();

create or replace function public.notify_followers_of_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  preview text;
begin
  preview := coalesce(nullif(left(btrim(new.body), 180), ''), 'Compartilhou uma imagem, enquete ou atualizacao.');
  insert into public.notifications (recipient_id, actor_id, type, post_id, source_id, content)
  select f.follower_id, new.author_id, 'new_post', new.id, new.id, preview
  from public.follows f
  where f.following_id = new.author_id
    and f.follower_id <> new.author_id;
  return new;
end;
$$;

drop trigger if exists notifications_after_new_post on public.posts;
create trigger notifications_after_new_post
  after insert on public.posts
  for each row execute function public.notify_followers_of_post();

-- Publica novos avisos em Realtime; o RLS limita cada evento ao proprio destinatario.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
