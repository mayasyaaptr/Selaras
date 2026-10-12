-- =====================================================================
-- Selaras · Skema database (PostgreSQL / Supabase)
-- Jalankan di Supabase → SQL Editor → New query → Run
-- =====================================================================

-- 1) BRANDS ------------------------------------------------------------
create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cuisine     text,
  color       text not null default '#A8C3B0',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists brands_name_uq on public.brands (lower(name));

-- 2) BRAND_PERFORMANCE : kinerja satu brand dalam satu bulan -----------
create table if not exists public.brand_performance (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  period        date not null check (period = date_trunc('month', period)::date),
  revenue       numeric(14,0) not null default 0 check (revenue >= 0),      -- omzet bersih
  orders        integer       not null default 0 check (orders >= 0),       -- jumlah pesanan
  cogs          numeric(14,0) not null default 0 check (cogs >= 0),         -- HPP / bahan baku
  platform_fee  numeric(14,0) not null default 0 check (platform_fee >= 0), -- komisi GoFood/Grab/Shopee
  direct_cost   numeric(14,0) not null default 0 check (direct_cost >= 0),  -- kemasan, iklan brand, dll
  created_at    timestamptz not null default now(),
  unique (brand_id, period)
);
create index if not exists brand_perf_period_idx on public.brand_performance (period);

-- 3) SHARED_COSTS : biaya yang dipakai bersama oleh semua brand --------
create table if not exists public.shared_costs (
  id            uuid primary key default gen_random_uuid(),
  period        date not null check (period = date_trunc('month', period)::date),
  name          text not null,
  category      text not null default 'Lainnya',
  amount        numeric(14,0) not null check (amount > 0),
  method        text not null default 'revenue'
                check (method in ('revenue','orders','equal','manual')),
  manual_split  jsonb not null default '{}'::jsonb,   -- {"<brand_id>": persen} bila method = manual
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists shared_costs_period_idx on public.shared_costs (period);

-- VIEW : hasil alokasi per biaya per brand (untuk laporan / BI) ---------
create or replace view public.v_alokasi
with (security_invoker = true) as
with tot as (
  select period, sum(revenue) as rev, sum(orders) as ord, count(*) as n
  from public.brand_performance group by period
)
select
  c.id as cost_id, c.period, c.name as cost_name, c.category, c.method,
  b.id as brand_id, b.name as brand_name,
  round(c.amount * case c.method
    when 'revenue' then bp.revenue / nullif(t.rev, 0)
    when 'orders'  then bp.orders::numeric / nullif(t.ord, 0)
    when 'equal'   then 1.0 / nullif(t.n, 0)
    when 'manual'  then coalesce((c.manual_split ->> b.id::text)::numeric, 0) / 100
  end, 0) as allocated
from public.shared_costs c
join public.brand_performance bp on bp.period = c.period
join public.brands b on b.id = bp.brand_id
join tot t on t.period = c.period;

-- VIEW : laba rugi per brand per bulan ---------------------------------
create or replace view public.v_profit_brand
with (security_invoker = true) as
select
  bp.period, b.id as brand_id, b.name as brand_name,
  bp.revenue, bp.orders,
  bp.revenue - bp.cogs - bp.platform_fee - bp.direct_cost as contribution,
  coalesce(sum(a.allocated), 0) as shared_cost,
  bp.revenue - bp.cogs - bp.platform_fee - bp.direct_cost - coalesce(sum(a.allocated), 0) as net_profit
from public.brand_performance bp
join public.brands b on b.id = bp.brand_id
left join public.v_alokasi a on a.brand_id = bp.brand_id and a.period = bp.period
group by bp.period, b.id, b.name, bp.revenue, bp.orders, bp.cogs, bp.platform_fee, bp.direct_cost;

-- AKSES TANPA LOGIN -----------------------------------------------------
-- Aplikasi ini sengaja tanpa login, jadi role "anon" diberi akses penuh.
-- Siapa pun yang memegang URL + anon key dapat membaca & mengubah data.
-- Jangan bagikan alamat aplikasi ke publik. Jika nanti butuh login,
-- ganti kebijakan di bawah dengan kebijakan berbasis auth.uid().
alter table public.brands            enable row level security;
alter table public.brand_performance enable row level security;
alter table public.shared_costs      enable row level security;

drop policy if exists "akses_penuh" on public.brands;
drop policy if exists "akses_penuh" on public.brand_performance;
drop policy if exists "akses_penuh" on public.shared_costs;
create policy "akses_penuh" on public.brands            for all to anon, authenticated using (true) with check (true);
create policy "akses_penuh" on public.brand_performance for all to anon, authenticated using (true) with check (true);
create policy "akses_penuh" on public.shared_costs      for all to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.brands, public.brand_performance, public.shared_costs to anon, authenticated;
grant select on public.v_alokasi, public.v_profit_brand to anon, authenticated;
