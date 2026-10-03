create extension if not exists pgcrypto;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  safe_username text;
  safe_display_name text;
begin
  safe_display_name := coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1), 'usuario');
  safe_username := lower(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1), 'usuario'), '[^a-zA-Z0-9_]', '', 'g'));
  if safe_username = '' then safe_username := 'usuario'; end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, left(safe_username, 24), safe_display_name)
  on conflict (id) do nothing;
  insert into public.wallets (user_id, sfc_balance, energy, energy_capacity)
  values (new.id, 0, 100, 100)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text not null default '',
  age integer check (age is null or age >= 13),
  avatar_url text,
  followers_count integer not null default 0,
  following_count integer not null default 0,
  likes_received integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sfc_balance numeric(24,6) not null default 0,
  energy numeric(12,6) not null default 100,
  energy_capacity numeric(12,6) not null default 100 check (energy_capacity between 100 and 1000),
  energy_updated_at timestamptz not null default now(),
  polygon_wallet text,
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  image_url text,
  poll_question text,
  poll_options jsonb,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  reposts_count integer not null default 0,
  reward_sfc numeric(24,6) not null default 0,
  created_at timestamptz not null default now(),
  check (length(body) <= 280)
);

create table if not exists public.post_likes (
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 240),
  created_at timestamptz not null default now()
);

create table if not exists public.reposts (
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete set null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  amount_sfc numeric(24,6) not null check (amount_sfc > 0),
  message text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  image_url text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('post_reward','like_reward','comment_reward','repost_reward','tip_sent','tip_received','energy_purchase','withdrawal')),
  amount_sfc numeric(24,6) not null,
  post_id uuid references public.posts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists stories_expires_at_idx on public.stories(expires_at);
create index if not exists ledger_user_created_idx on public.ledger_entries(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.reposts enable row level security;
alter table public.tips enable row level security;
alter table public.stories enable row level security;
alter table public.ledger_entries enable row level security;

drop policy if exists "published profiles are readable" on public.profiles;
drop policy if exists "users manage own profile" on public.profiles;
drop policy if exists "wallet owner reads wallet" on public.wallets;
drop policy if exists "wallet owner creates wallet" on public.wallets;
drop policy if exists "wallet owner updates wallet" on public.wallets;
drop policy if exists "posts are readable" on public.posts;
drop policy if exists "users create own posts" on public.posts;
drop policy if exists "users edit own posts" on public.posts;
drop policy if exists "likes are readable" on public.post_likes;
drop policy if exists "users manage own likes" on public.post_likes;
drop policy if exists "comments are readable" on public.comments;
drop policy if exists "users create own comments" on public.comments;
drop policy if exists "users manage own reposts" on public.reposts;
drop policy if exists "tips participants read" on public.tips;
drop policy if exists "users create sent tips" on public.tips;
drop policy if exists "stories are readable" on public.stories;
drop policy if exists "users create own stories" on public.stories;
drop policy if exists "owners read ledger" on public.ledger_entries;

create policy "published profiles are readable" on public.profiles for select using (true);
create policy "users manage own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "wallet owner reads wallet" on public.wallets for select using (auth.uid() = user_id);
create policy "wallet owner creates wallet" on public.wallets for insert with check (auth.uid() = user_id);
create policy "wallet owner updates wallet" on public.wallets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "posts are readable" on public.posts for select using (true);
create policy "users create own posts" on public.posts for insert with check (auth.uid() = author_id);
create policy "users edit own posts" on public.posts for update using (auth.uid() = author_id);
create policy "likes are readable" on public.post_likes for select using (true);
create policy "users manage own likes" on public.post_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments are readable" on public.comments for select using (true);
create policy "users create own comments" on public.comments for insert with check (auth.uid() = author_id);
create policy "users manage own reposts" on public.reposts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tips participants read" on public.tips for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
create policy "users create sent tips" on public.tips for insert with check (auth.uid() = sender_id);
create policy "stories are readable" on public.stories for select using (expires_at > now());
create policy "users create own stories" on public.stories for insert with check (auth.uid() = author_id);
create policy "owners read ledger" on public.ledger_entries for select using (auth.uid() = user_id);

-- Realtime feed updates.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts') then
    alter publication supabase_realtime add table public.posts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_likes') then
    alter publication supabase_realtime add table public.post_likes;
  end if;
end $$;
