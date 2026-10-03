-- Recompensas configuraveis para engajamentos e missoes diarias.
-- Execute depois de supabase-schema.sql e supabase-admin.sql.

create table if not exists public.reward_settings (
  id boolean primary key default true check (id),
  post_reward numeric(18,6) not null default 0.500000 check (post_reward between 0 and 1000000),
  like_reward numeric(18,6) not null default 0.010000 check (like_reward between 0 and 1000000),
  comment_reward numeric(18,6) not null default 0.005000 check (comment_reward between 0 and 1000000),
  repost_reward numeric(18,6) not null default 0.015000 check (repost_reward between 0 and 1000000),
  story_reward numeric(18,6) not null default 0.100000 check (story_reward between 0 and 1000000),
  mission_post_reward numeric(18,6) not null default 0.500000 check (mission_post_reward between 0 and 1000000),
  mission_video_reward numeric(18,6) not null default 0.800000 check (mission_video_reward between 0 and 1000000),
  mission_engagement_reward numeric(18,6) not null default 0.200000 check (mission_engagement_reward between 0 and 1000000),
  mission_engagement_goal integer not null default 5 check (mission_engagement_goal between 1 and 1000),
  updated_at timestamptz not null default now()
);

insert into public.reward_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.reward_settings enable row level security;

drop policy if exists "Everyone can read reward settings" on public.reward_settings;
drop policy if exists "Admins manage reward settings" on public.reward_settings;

create policy "Everyone can read reward settings"
  on public.reward_settings for select to anon, authenticated
  using (true);

create policy "Admins manage reward settings"
  on public.reward_settings for update to authenticated
  using (coalesce(lower((select auth.jwt() ->> 'email')) = '3x4x4dex@gmail.com', false))
  with check (coalesce(lower((select auth.jwt() ->> 'email')) = '3x4x4dex@gmail.com', false));

revoke all on public.reward_settings from anon, authenticated;
grant select on public.reward_settings to anon, authenticated;
grant update (
  post_reward,
  like_reward,
  comment_reward,
  repost_reward,
  story_reward,
  mission_post_reward,
  mission_video_reward,
  mission_engagement_reward,
  mission_engagement_goal,
  updated_at
) on public.reward_settings to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reward_settings'
  ) then
    alter publication supabase_realtime add table public.reward_settings;
  end if;
end $$;
