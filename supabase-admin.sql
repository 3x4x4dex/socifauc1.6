-- Admin module: withdrawals queue, analytics (DAU) and admin-only access.
-- Execute AFTER supabase-schema.sql, no SQL Editor do projeto qozlxgophtixgyjxyjhz.
-- Este arquivo contem apenas statements simples + UMA funcao SQL de linha unica,
-- para nao confundir o divisor de statements do editor do Supabase.

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  polygon_wallet text not null,
  amount_sfc numeric(24,6) not null check (amount_sfc > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  note text not null default '',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  tx_hash text,
  created_at timestamptz not null default now()
);

create index if not exists withdrawals_status_created_idx on public.withdrawals(status, created_at desc);
create index if not exists withdrawals_user_created_idx on public.withdrawals(user_id, created_at desc);

create table if not exists public.daily_active_users (
  day date not null default (now() at time zone 'utc')::date,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hits integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (day, user_id)
);

create index if not exists dau_day_idx on public.daily_active_users(day desc);

alter table public.withdrawals enable row level security;
alter table public.daily_active_users enable row level security;

create or replace function public.is_admin() returns boolean language sql stable as $fn_is_admin$ select coalesce(lower(auth.jwt() ->> 'email') = '3x4x4dex@gmail.com', false) $fn_is_admin$;

drop policy if exists "users create own withdrawals" on public.withdrawals;
drop policy if exists "users read own withdrawals" on public.withdrawals;
drop policy if exists "admin updates withdrawals" on public.withdrawals;
drop policy if exists "admin deletes withdrawals" on public.withdrawals;
drop policy if exists "users insert own activity" on public.daily_active_users;
drop policy if exists "users update own activity" on public.daily_active_users;
drop policy if exists "admin reads activity" on public.daily_active_users;
drop policy if exists "admin reads tips" on public.tips;
drop policy if exists "admin reads wallets" on public.wallets;
drop policy if exists "admin updates wallets" on public.wallets;
drop policy if exists "admin reads ledger" on public.ledger_entries;
drop policy if exists "admin inserts ledger" on public.ledger_entries;

create policy "users create own withdrawals" on public.withdrawals for insert with check (auth.uid() = user_id and status = 'pending');
create policy "users read own withdrawals" on public.withdrawals for select using (auth.uid() = user_id or public.is_admin());
create policy "admin updates withdrawals" on public.withdrawals for update using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes withdrawals" on public.withdrawals for delete using (public.is_admin());

create policy "users insert own activity" on public.daily_active_users for insert with check (auth.uid() = user_id);
create policy "users update own activity" on public.daily_active_users for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "admin reads activity" on public.daily_active_users for select using (auth.uid() = user_id or public.is_admin());

create policy "admin reads tips" on public.tips for select using (public.is_admin());
create policy "admin reads wallets" on public.wallets for select using (public.is_admin());
create policy "admin updates wallets" on public.wallets for update using (public.is_admin()) with check (public.is_admin());
create policy "admin reads ledger" on public.ledger_entries for select using (public.is_admin());
create policy "admin inserts ledger" on public.ledger_entries for insert with check (public.is_admin());
