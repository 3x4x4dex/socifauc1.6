-- Ranking publico dos ganhos registrados nos ultimos 7 dias.
-- Execute depois de supabase-schema.sql.

create or replace function public.weekly_earnings_leaderboard()
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  earned_sfc numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  with earning_events as (
    select p.author_id as user_id, p.reward_sfc as amount_sfc
    from public.posts p
    where p.created_at >= now() - interval '7 days'
      and p.reward_sfc > 0

    union all

    select t.recipient_id as user_id, t.amount_sfc
    from public.tips t
    where t.created_at >= now() - interval '7 days'
      and t.amount_sfc > 0
  ), weekly_totals as (
    select events.user_id, sum(events.amount_sfc) as earned_sfc
    from earning_events events
    group by events.user_id
  )
  select profile.id, profile.username, profile.display_name, profile.avatar_url, totals.earned_sfc
  from weekly_totals totals
  join public.profiles profile on profile.id = totals.user_id
  order by totals.earned_sfc desc, profile.username asc
  limit 10;
$function$;

revoke all on function public.weekly_earnings_leaderboard() from public;
grant execute on function public.weekly_earnings_leaderboard() to anon, authenticated;

-- Signal publico sem dados pessoais para notificar os clientes sobre novos ganhos.
create table if not exists public.leaderboard_signal (
  id boolean primary key default true check (id),
  refreshed_at timestamptz not null default now()
);

insert into public.leaderboard_signal (id, refreshed_at)
values (true, now())
on conflict (id) do nothing;

alter table public.leaderboard_signal enable row level security;
drop policy if exists "Leaderboard refresh is public" on public.leaderboard_signal;
create policy "Leaderboard refresh is public"
  on public.leaderboard_signal for select to anon, authenticated
  using (true);

revoke all on public.leaderboard_signal from anon, authenticated;
grant select on public.leaderboard_signal to anon, authenticated;

create or replace function public.signal_leaderboard_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.leaderboard_signal (id, refreshed_at)
  values (true, now())
  on conflict (id) do update set refreshed_at = excluded.refreshed_at;
  return new;
end;
$function$;

drop trigger if exists leaderboard_refresh_after_post on public.posts;
create trigger leaderboard_refresh_after_post
  after insert on public.posts
  for each row execute function public.signal_leaderboard_refresh();

drop trigger if exists leaderboard_refresh_after_tip on public.tips;
create trigger leaderboard_refresh_after_tip
  after insert on public.tips
  for each row execute function public.signal_leaderboard_refresh();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_signal'
  ) then
    alter publication supabase_realtime add table public.leaderboard_signal;
  end if;
end $$;
