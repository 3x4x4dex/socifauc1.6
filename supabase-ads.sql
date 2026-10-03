-- Publicidade: campanhas pre-pagas, entrega no feed e analytics por usuario.
-- Execute depois de supabase-rewards.sql e supabase-reward-payouts.sql.

alter table public.reward_settings
  add column if not exists ad_cpm_sfc numeric(18,6) not null default 10
  check (ad_cpm_sfc between 0.001 and 1000000);

grant update (ad_cpm_sfc) on public.reward_settings to authenticated;

alter table public.ledger_entries drop constraint if exists ledger_entries_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_type_check
  check (type in ('post_reward','like_reward','comment_reward','repost_reward','tip_sent','tip_received','energy_purchase','withdrawal','ad_spend','ad_refund'));

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  budget_sfc numeric(18,6) not null check (budget_sfc between 1 and 1000000),
  spent_sfc numeric(18,6) not null default 0 check (spent_sfc >= 0 and spent_sfc <= budget_sfc),
  cpm_sfc numeric(18,6) not null check (cpm_sfc between 0.001 and 1000000),
  status text not null default 'active' check (status in ('active','paused','exhausted','cancelled')),
  impressions_count bigint not null default 0 check (impressions_count >= 0),
  clicks_count bigint not null default 0 check (clicks_count >= 0),
  engagements_count bigint not null default 0 check (engagements_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_campaigns_delivery_idx
  on public.ad_campaigns (status, created_at desc)
  where status = 'active';
create index if not exists ad_campaigns_advertiser_idx
  on public.ad_campaigns (advertiser_id, created_at desc);

create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('impression','click','engagement')),
  event_day date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now(),
  unique (campaign_id, viewer_id, event_type, event_day)
);

alter table public.ad_campaigns enable row level security;
alter table public.ad_events enable row level security;

drop policy if exists "Advertisers read their campaigns" on public.ad_campaigns;
create policy "Advertisers read their campaigns"
  on public.ad_campaigns for select to authenticated
  using (advertiser_id = (select auth.uid()));

revoke all on public.ad_campaigns from anon, authenticated;
grant select on public.ad_campaigns to authenticated;
revoke all on public.ad_events from anon, authenticated;

create or replace function public.create_ad_campaign(p_post_id uuid, p_budget_sfc numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  viewer_id uuid := auth.uid();
  available_sfc numeric(24,6);
  campaign_cpm numeric(18,6);
  campaign_id uuid;
  campaign_budget numeric(18,6) := round(p_budget_sfc, 6);
begin
  if viewer_id is null then
    raise exception 'Entre na sua conta para criar uma campanha.';
  end if;
  if p_post_id is null or not exists (
    select 1 from public.posts where id = p_post_id and author_id = viewer_id
  ) then
    raise exception 'Selecione uma publicacao sua.';
  end if;
  if campaign_budget is null or campaign_budget < 1 or campaign_budget > 1000000 then
    raise exception 'O orcamento deve ser de pelo menos 1 SFC.';
  end if;

  select settings.ad_cpm_sfc into campaign_cpm
  from public.reward_settings settings
  where settings.id = true;
  if campaign_cpm is null or campaign_cpm <= 0 then
    raise exception 'O CPM da publicidade ainda nao foi configurado.';
  end if;

  select wallet.sfc_balance into available_sfc
  from public.wallets wallet
  where wallet.user_id = viewer_id
  for update;
  if available_sfc is null or available_sfc < campaign_budget then
    raise exception 'Saldo SFC insuficiente para este orcamento.';
  end if;

  update public.wallets
  set sfc_balance = sfc_balance - campaign_budget,
      updated_at = now()
  where user_id = viewer_id;

  insert into public.ad_campaigns (advertiser_id, post_id, budget_sfc, cpm_sfc)
  values (viewer_id, p_post_id, campaign_budget, campaign_cpm)
  returning id into campaign_id;

  insert into public.ledger_entries (user_id, type, amount_sfc, post_id, metadata)
  values (
    viewer_id,
    'ad_spend',
    -campaign_budget,
    p_post_id,
    jsonb_build_object('campaign_id', campaign_id, 'cpm_sfc', campaign_cpm)
  );

  return campaign_id;
end;
$function$;

create or replace function public.get_feed_ad_campaigns(p_limit integer default 10)
returns table (
  campaign_id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  image_url text,
  poll_question text,
  poll_options jsonb,
  likes_count integer,
  comments_count integer,
  reposts_count integer,
  reward_sfc numeric,
  created_at timestamptz,
  display_name text,
  username text,
  avatar_url text
)
language sql
volatile
security definer
set search_path = ''
as $function$
  select campaign.id,
         post.id,
         post.author_id,
         post.body,
         post.image_url,
         post.poll_question,
         post.poll_options,
         post.likes_count,
         post.comments_count,
         post.reposts_count,
         post.reward_sfc,
         post.created_at,
         profile.display_name,
         profile.username,
         profile.avatar_url
  from public.ad_campaigns campaign
  join public.posts post on post.id = campaign.post_id
  join public.profiles profile on profile.id = post.author_id
  where auth.uid() is not null
    and campaign.advertiser_id <> auth.uid()
    and campaign.status = 'active'
    and campaign.spent_sfc + round(campaign.cpm_sfc / 1000, 6) <= campaign.budget_sfc
  order by random()
  limit greatest(0, least(coalesce(p_limit, 0), 100));
$function$;

create or replace function public.record_ad_event(p_campaign_id uuid, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  viewer_id uuid := auth.uid();
  campaign public.ad_campaigns%rowtype;
  impression_cost numeric(18,6);
begin
  if viewer_id is null then
    return false;
  end if;
  if p_event_type not in ('impression','click','engagement') then
    raise exception 'Tipo de evento invalido.';
  end if;

  select * into campaign
  from public.ad_campaigns
  where id = p_campaign_id
  for update;
  if not found or campaign.advertiser_id = viewer_id or campaign.status = 'cancelled' then
    return false;
  end if;

  if p_event_type = 'impression' then
    impression_cost := round(campaign.cpm_sfc / 1000, 6);
    if campaign.status <> 'active' or campaign.spent_sfc + impression_cost > campaign.budget_sfc then
      if campaign.status = 'active' then
        update public.ad_campaigns set status = 'exhausted', updated_at = now() where id = campaign.id;
      end if;
      return false;
    end if;
  end if;

  insert into public.ad_events (campaign_id, viewer_id, event_type)
  values (campaign.id, viewer_id, p_event_type)
  on conflict (campaign_id, viewer_id, event_type, event_day) do nothing;
  if not found then
    return true;
  end if;

  if p_event_type = 'impression' then
    update public.ad_campaigns
    set spent_sfc = spent_sfc + impression_cost,
        impressions_count = impressions_count + 1,
        status = case when spent_sfc + impression_cost >= budget_sfc then 'exhausted' else status end,
        updated_at = now()
    where id = campaign.id;
  elsif p_event_type = 'click' then
    update public.ad_campaigns
    set clicks_count = clicks_count + 1, updated_at = now()
    where id = campaign.id;
  else
    update public.ad_campaigns
    set engagements_count = engagements_count + 1, updated_at = now()
    where id = campaign.id;
  end if;

  return true;
end;
$function$;

create or replace function public.set_ad_campaign_status(p_campaign_id uuid, p_action text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $function$
declare
  viewer_id uuid := auth.uid();
  campaign public.ad_campaigns%rowtype;
  refund_sfc numeric(18,6) := 0;
begin
  if viewer_id is null then
    raise exception 'Entre na sua conta para gerenciar campanhas.';
  end if;
  select * into campaign
  from public.ad_campaigns
  where id = p_campaign_id and advertiser_id = viewer_id
  for update;
  if not found then
    raise exception 'Campanha nao encontrada.';
  end if;

  if p_action = 'pause' then
    update public.ad_campaigns set status = 'paused', updated_at = now()
    where id = campaign.id and status = 'active';
  elsif p_action = 'resume' then
    if campaign.status <> 'paused' or campaign.spent_sfc >= campaign.budget_sfc then
      raise exception 'Esta campanha nao pode ser retomada.';
    end if;
    update public.ad_campaigns set status = 'active', updated_at = now()
    where id = campaign.id;
  elsif p_action = 'cancel' then
    if campaign.status = 'cancelled' then
      return 0;
    end if;
    refund_sfc := greatest(0, campaign.budget_sfc - campaign.spent_sfc);
    update public.ad_campaigns set status = 'cancelled', updated_at = now()
    where id = campaign.id;
    if refund_sfc > 0 then
      update public.wallets
      set sfc_balance = sfc_balance + refund_sfc, updated_at = now()
      where user_id = viewer_id;
      insert into public.ledger_entries (user_id, type, amount_sfc, post_id, metadata)
      values (viewer_id, 'ad_refund', refund_sfc, campaign.post_id, jsonb_build_object('campaign_id', campaign.id));
    end if;
  else
    raise exception 'Acao de campanha invalida.';
  end if;

  return refund_sfc;
end;
$function$;

revoke all on function public.create_ad_campaign(uuid, numeric) from public, anon;
revoke all on function public.get_feed_ad_campaigns(integer) from public, anon;
revoke all on function public.record_ad_event(uuid, text) from public, anon;
revoke all on function public.set_ad_campaign_status(uuid, text) from public, anon;
grant execute on function public.create_ad_campaign(uuid, numeric) to authenticated;
grant execute on function public.get_feed_ad_campaigns(integer) to authenticated;
grant execute on function public.record_ad_event(uuid, text) to authenticated;
grant execute on function public.set_ad_campaign_status(uuid, text) to authenticated;