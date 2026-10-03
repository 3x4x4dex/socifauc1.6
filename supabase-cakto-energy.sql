-- Sessões de checkout e créditos de recarga Cakto, processados apenas pelo webhook.
-- Execute no SQL Editor depois de supabase-schema.sql.

create table if not exists public.energy_checkout_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists public.energy_checkout_orders (
  cakto_order_id text primary key,
  callback_token uuid not null unique references public.energy_checkout_sessions(token),
  user_id uuid not null references auth.users(id) on delete cascade,
  fulfilled_at timestamptz not null default now()
);

alter table public.energy_checkout_sessions enable row level security;
alter table public.energy_checkout_orders enable row level security;
revoke all on public.energy_checkout_sessions from anon, authenticated;
revoke all on public.energy_checkout_orders from anon, authenticated;

create or replace function public.create_energy_checkout_session()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  checkout_token uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.energy_checkout_sessions (user_id)
  values (current_user_id)
  returning token into checkout_token;

  return checkout_token;
end;
$function$;

revoke all on function public.create_energy_checkout_session() from public, anon;
grant execute on function public.create_energy_checkout_session() to authenticated;

create or replace function public.cakto_fulfill_energy_purchase(
  p_callback_token uuid,
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  buyer_id uuid;
  session_used_at timestamptz;
  inserted_rows integer;
begin
  if p_callback_token is null or p_order_id is null or length(btrim(p_order_id)) = 0 then
    raise exception 'invalid checkout reference' using errcode = '22023';
  end if;

  select user_id, used_at
  into buyer_id, session_used_at
  from public.energy_checkout_sessions
  where token = p_callback_token
  for update;

  if not found then
    raise exception 'checkout session not found' using errcode = 'P0002';
  end if;

  if session_used_at is not null then
    return jsonb_build_object('status', 'already_fulfilled');
  end if;

  insert into public.energy_checkout_orders (cakto_order_id, callback_token, user_id)
  values (p_order_id, p_callback_token, buyer_id)
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 0 then
    return jsonb_build_object('status', 'duplicate');
  end if;

  update public.wallets
  set energy = energy_capacity,
      energy_updated_at = now(),
      updated_at = now()
  where user_id = buyer_id;

  if not found then
    raise exception 'wallet not found for checkout user' using errcode = 'P0002';
  end if;

  update public.energy_checkout_sessions
  set used_at = now()
  where token = p_callback_token;

  return jsonb_build_object('status', 'energy_restored');
end;
$function$;

revoke all on function public.cakto_fulfill_energy_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.cakto_fulfill_energy_purchase(uuid, text) to service_role;

-- Atualização do saldo de energia na sessão conectada.
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
