-- =====================================================================
-- Selaras · Data contoh (OPSIONAL). Jalankan setelah 01_schema.sql.
-- Berisi 3 brand dan data 3 bulan terakhir (relatif terhadap hari ini).
-- Untuk membersihkan: truncate public.brands cascade; truncate public.shared_costs;
-- =====================================================================

insert into public.brands (name, cuisine, color) values
  ('Dapur Aruna',  'Nasi & lauk rumahan', '#A8C3B0'),
  ('Sajian Teduh', 'Mie & pasta',         '#F0C9C2'),
  ('Manis Sore',   'Dessert & minuman',   '#C5CCE8')
on conflict do nothing;

-- Kinerja 3 bulan (bulan berjalan, 1 bulan lalu, 2 bulan lalu)
with m(off, f) as (values (0, 1.00), (1, 0.94), (2, 0.86)),
v(name, rev, ord, cogs, fee, direct) as (values
  ('Dapur Aruna',  48000000, 1450, 0.36, 0.20, 3600000),
  ('Sajian Teduh', 31000000,  820, 0.33, 0.20, 3200000),
  ('Manis Sore',   14500000,  690, 0.30, 0.20, 2800000))
insert into public.brand_performance (brand_id, period, revenue, orders, cogs, platform_fee, direct_cost)
select b.id,
       (date_trunc('month', current_date) - make_interval(months => m.off))::date,
       round(v.rev * m.f, -3),
       round(v.ord * m.f)::int,
       round(v.rev * m.f * v.cogs, -3),
       round(v.rev * m.f * v.fee, -3),
       round(v.direct * m.f, -3)
from m cross join v
join public.brands b on lower(b.name) = lower(v.name)
on conflict (brand_id, period) do nothing;

-- Biaya bersama (metode alokasi berbeda-beda sesuai sifat biayanya)
insert into public.shared_costs (period, name, category, amount, method)
select (date_trunc('month', current_date) - make_interval(months => m.off))::date,
       c.name, c.category, c.amount, c.method
from generate_series(0, 2) as m(off)
cross join (values
  ('Sewa dapur',                 'Sewa & Properti',         9000000, 'revenue'),
  ('Listrik & gas',              'Listrik, Gas & Air',      4200000, 'orders'),
  ('Gaji tim dapur bersama',     'Tenaga Kerja Bersama',   12500000, 'orders'),
  ('Internet & sistem kasir',    'Internet & Software',      900000, 'equal'),
  ('Kebersihan & limbah',        'Kebersihan & Limbah',     1200000, 'equal')
) as c(name, category, amount, method);

insert into public.shared_costs (period, name, category, amount, method, manual_split)
select (date_trunc('month', current_date) - make_interval(months => m.off))::date,
       'Iklan bersama', 'Marketing Umum', 2500000, 'manual',
       (select jsonb_object_agg(id::text,
                case name when 'Dapur Aruna' then 50 when 'Sajian Teduh' then 30 else 20 end)
        from public.brands)
from generate_series(0, 2) as m(off);
