-- Creditos autoritativos para recompensas e bonus de missao.
-- Execute depois de supabase-rewards.sql.

create table if not exists public.daily_mission_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mission_key text not null check (mission_key in ('daily_post', 'daily_engagement')),
  mission_day date not null,
  reward_sfc numeric(18,6) not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission_key, mission_day)
);

alter table public.daily_mission_claims enable row level security;
revoke all on public.daily_mission_claims from anon, authenticated;

create or replace function public.award_configured_reward(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_post_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  update public.wallets
  set sfc_balance = sfc_balance + p_amount,
      updated_at = now()
  where user_id = p_user_id;

  if found then
    insert into public.ledger_entries (user_id, type, amount_sfc, post_id, metadata)
    values (p_user_id, p_type, p_amount, p_post_id, coalesce(p_metadata, '{}'::jsonb));
  end if;
end;
$function$;

create or replace function public.claim_daily_mission_reward(
  p_user_id uuid,
  p_mission_key text,
  p_amount numeric,
  p_post_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  utc_day date := (now() at time zone 'utc')::date;
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  insert into public.daily_mission_claims (user_id, mission_key, mission_day, reward_sfc)
  values (p_user_id, p_mission_key, utc_day, p_amount)
  on conflict (user_id, mission_key, mission_day) do nothing;

  if found then
    perform public.award_configured_reward(
      p_user_id,
      p_amount,
      'post_reward',
      p_post_id,
      jsonb_build_object('mission', p_mission_key, 'day', utc_day)
    );
  end if;
end;
$function$;

create or replace function public.set_configured_post_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  select settings.post_reward into new.reward_sfc
  from public.reward_settings settings
  where settings.id = true;
  return new;
end;
$function$;

drop trigger if exists set_configured_post_reward_before_insert on public.posts;
create trigger set_configured_post_reward_before_insert
  before insert on public.posts
  for each row execute function public.set_configured_post_reward();

create or replace function public.award_post_and_daily_mission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings public.reward_settings%rowtype;
begin
  select * into settings from public.reward_settings where id = true;
  perform public.award_configured_reward(new.author_id, settings.post_reward, 'post_reward', new.id, jsonb_build_object('source', 'post'));
  perform public.claim_daily_mission_reward(new.author_id, 'daily_post', settings.mission_post_reward, new.id);
  return new;
end;
$function$;

drop trigger if exists award_post_and_daily_mission_after_insert on public.posts;
create trigger award_post_and_daily_mission_after_insert
  after insert on public.posts
  for each row execute function public.award_post_and_daily_mission();

create or replace function public.award_like_and_daily_mission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  post_owner uuid;
  settings public.reward_settings%rowtype;
  engagement_count integer;
begin
  select author_id into post_owner from public.posts where id = new.post_id;
  select * into settings from public.reward_settings where id = true;
  if post_owner is not null and post_owner <> new.user_id then
    perform public.award_configured_reward(post_owner, settings.like_reward, 'like_reward', new.post_id, jsonb_build_object('source', 'like', 'actor_id', new.user_id));
    select count(*) into engagement_count
    from public.ledger_entries
    where user_id = post_owner
      and type in ('like_reward', 'comment_reward', 'repost_reward')
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if engagement_count >= settings.mission_engagement_goal then
      perform public.claim_daily_mission_reward(post_owner, 'daily_engagement', settings.mission_engagement_reward, new.post_id);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists award_like_and_daily_mission_after_insert on public.post_likes;
create trigger award_like_and_daily_mission_after_insert
  after insert on public.post_likes
  for each row execute function public.award_like_and_daily_mission();

create or replace function public.award_comment_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings public.reward_settings%rowtype;
  engagement_count integer;
begin
  select * into settings from public.reward_settings where id = true;
  perform public.award_configured_reward(new.author_id, settings.comment_reward, 'comment_reward', new.post_id, jsonb_build_object('source', 'comment', 'comment_id', new.id));
  select count(*) into engagement_count
  from public.ledger_entries
  where user_id = new.author_id
    and type in ('like_reward', 'comment_reward', 'repost_reward')
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if engagement_count >= settings.mission_engagement_goal then
    perform public.claim_daily_mission_reward(new.author_id, 'daily_engagement', settings.mission_engagement_reward, new.post_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists award_comment_reward_after_insert on public.comments;
create trigger award_comment_reward_after_insert
  after insert on public.comments
  for each row execute function public.award_comment_reward();

create or replace function public.award_repost_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings public.reward_settings%rowtype;
  engagement_count integer;
begin
  select * into settings from public.reward_settings where id = true;
  perform public.award_configured_reward(new.user_id, settings.repost_reward, 'repost_reward', new.post_id, jsonb_build_object('source', 'repost'));
  select count(*) into engagement_count
  from public.ledger_entries
  where user_id = new.user_id
    and type in ('like_reward', 'comment_reward', 'repost_reward')
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if engagement_count >= settings.mission_engagement_goal then
    perform public.claim_daily_mission_reward(new.user_id, 'daily_engagement', settings.mission_engagement_reward, new.post_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists award_repost_reward_after_insert on public.reposts;
create trigger award_repost_reward_after_insert
  after insert on public.reposts
  for each row execute function public.award_repost_reward();

create or replace function public.award_story_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings public.reward_settings%rowtype;
begin
  select * into settings from public.reward_settings where id = true;
  perform public.award_configured_reward(new.author_id, settings.story_reward, 'post_reward', null, jsonb_build_object('source', 'story', 'story_id', new.id));
  return new;
end;
$function$;

drop trigger if exists award_story_reward_after_insert on public.stories;
create trigger award_story_reward_after_insert
  after insert on public.stories
  for each row execute function public.award_story_reward();

revoke all on function public.award_configured_reward(uuid, numeric, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_daily_mission_reward(uuid, text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.set_configured_post_reward() from public, anon, authenticated;
revoke all on function public.award_post_and_daily_mission() from public, anon, authenticated;
revoke all on function public.award_like_and_daily_mission() from public, anon, authenticated;
revoke all on function public.award_comment_reward() from public, anon, authenticated;
revoke all on function public.award_repost_reward() from public, anon, authenticated;
revoke all on function public.award_story_reward() from public, anon, authenticated;

-- Keep public engagement counters authoritative and repair counts from existing rows.
update public.posts post
set likes_count = (
      select count(*)::integer from public.post_likes reaction where reaction.post_id = post.id
    ),
    comments_count = (
      select count(*)::integer from public.comments comment where comment.post_id = post.id
    );

update public.profiles profile
set likes_received = coalesce((
  select count(*)::integer
  from public.post_likes reaction
  join public.posts post on post.id = reaction.post_id
  where post.author_id = profile.id
), 0);

create or replace function public.sync_post_engagement_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_post_id uuid;
  change_by integer;
  post_owner_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_post_id := old.post_id;
    change_by := -1;
  else
    affected_post_id := new.post_id;
    change_by := 1;
  end if;

  if tg_table_name = 'post_likes' then
    update public.posts
    set likes_count = greatest(0, likes_count + change_by)
    where id = affected_post_id
    returning author_id into post_owner_id;
    if post_owner_id is not null then
      update public.profiles
      set likes_received = greatest(0, likes_received + change_by)
      where id = post_owner_id;
    end if;
  elsif tg_table_name = 'comments' then
    update public.posts
    set comments_count = greatest(0, comments_count + change_by)
    where id = affected_post_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_post_like_counters on public.post_likes;
create trigger sync_post_like_counters
  after insert or delete on public.post_likes
  for each row execute function public.sync_post_engagement_counters();

drop trigger if exists sync_post_comment_counters on public.comments;
create trigger sync_post_comment_counters
  after insert or delete on public.comments
  for each row execute function public.sync_post_engagement_counters();

revoke all on function public.sync_post_engagement_counters() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wallets'
  ) then
    alter publication supabase_realtime add table public.wallets;
  end if;
end $$;
