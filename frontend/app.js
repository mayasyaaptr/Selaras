(() => {
'use strict';

/* ---------- util ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const rp = n => (n < -0.5 ? '-' : '') + 'Rp ' + Math.abs(Math.round(num(n))).toLocaleString('id-ID');
const pct = n => (isFinite(n) ? (n * 100).toFixed(1).replace('.', ',') + '%' : '–');
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pLabel = p => { const [y, m] = p.split('-'); return MONTHS[+m - 1] + ' ' + y; };
const shift = (p, d) => { const [y, m] = p.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); };
const nowP = () => shift(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'), 0);
const dbP = p => p + '-01';
const pOf = d => String(d).slice(0, 7);
const money = el => Number(String(el.value).replace(/\D/g, '')) || 0;
const fmtIn = n => (n ? Math.round(n).toLocaleString('id-ID') : '');

const METHODS = {
  revenue: ['Proporsi omzet', 'Brand dengan omzet lebih besar menanggung porsi lebih besar. Cocok untuk sewa dan iklan bersama.'],
  orders: ['Proporsi pesanan', 'Dibagi menurut jumlah pesanan. Cocok untuk listrik, gas, dan tenaga dapur.'],
  equal: ['Dibagi rata', 'Semua brand yang berjalan di bulan itu menanggung sama besar. Cocok untuk internet, kasir, kebersihan.'],
  manual: ['Persentase manual', 'Anda menentukan sendiri persentasenya, misalnya dari hasil pengukuran pemakaian.']
};
const CATS = ['Sewa & Properti', 'Listrik, Gas & Air', 'Tenaga Kerja Bersama', 'Peralatan & Perawatan', 'Kebersihan & Limbah', 'Internet & Software', 'Marketing Umum', 'Administrasi & Legal', 'Lainnya'];
const TEMPLATES = [
  ['Sewa dapur', 'Sewa & Properti', 'revenue'], ['Listrik & gas', 'Listrik, Gas & Air', 'orders'],
  ['Gaji tim dapur bersama', 'Tenaga Kerja Bersama', 'orders'], ['Internet & sistem kasir', 'Internet & Software', 'equal'],
  ['Kebersihan & limbah', 'Kebersihan & Limbah', 'equal'], ['Perawatan peralatan', 'Peralatan & Perawatan', 'orders'],
  ['Iklan bersama', 'Marketing Umum', 'revenue'], ['Akuntan & administrasi', 'Administrasi & Legal', 'equal']
];
const PALETTE = ['#A8C3B0', '#F0C9C2', '#C5CCE8', '#F2DFA7', '#BFDDE0', '#E3C4DC', '#F2D2A9', '#CFE0B4'];
const TITLES = { ringkasan: 'Ringkasan', kinerja: 'Kinerja brand', biaya: 'Biaya bersama', alokasi: 'Hasil alokasi', brand: 'Daftar brand' };

const cfg = window.SELARAS_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/GANTI/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
let sb = null;
const state = { brands: [], perf: [], costs: [], period: nowP(), view: 'ringkasan' };
const view = $('#view'), dlg = $('#dlg');

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ''; }, 3200);
}
const errText = e => {
  if (!e) return 'Terjadi kesalahan.';
  if (e.code === '23505') return 'Nama sudah dipakai. Gunakan nama lain.';
  if (e.code === '42P01') return 'Tabel belum ada. Jalankan sql/01_schema.sql di Supabase.';
  return e.message || String(e);
};
async function run(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { console.error(e); toast(errText(e), true); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- data ---------- */
async function load() {
  const [b, p, c] = await Promise.all([
    sb.from('brands').select('*').order('created_at'),
    sb.from('brand_performance').select('*'),
    sb.from('shared_costs').select('*').order('created_at')
  ]);
  const err = [b, p, c].find(r => r.error);
  if (err) throw err.error;
  state.brands = b.data;
  state.perf = p.data.map(x => ({ ...x, revenue: num(x.revenue), orders: num(x.orders), cogs: num(x.cogs), platform_fee: num(x.platform_fee), direct_cost: num(x.direct_cost) }));
  state.costs = c.data.map(x => ({ ...x, amount: num(x.amount), manual_split: x.manual_split || {} }));
}
async function reload(msg) { await load(); render(); if (msg) toast(msg); }

/* ---------- perhitungan ---------- */
function compute(period) {
  const rows = state.perf.filter(p => pOf(p.period) === period)
    .map(p => ({ p, brand: state.brands.find(b => b.id === p.brand_id) })).filter(r => r.brand);
  const costs = state.costs.filter(c => pOf(c.period) === period);
  const tRev = rows.reduce((s, r) => s + r.p.revenue, 0);
  const tOrd = rows.reduce((s, r) => s + r.p.orders, 0);
  rows.forEach(r => { r.items = {}; r.alloc = 0; });
  costs.forEach(c => rows.forEach(r => {
    let s = 0;
    if (c.method === 'revenue') s = tRev ? r.p.revenue / tRev : 0;
    else if (c.method === 'orders') s = tOrd ? r.p.orders / tOrd : 0;
    else if (c.method === 'equal') s = rows.length ? 1 / rows.length : 0;
    else s = num(c.manual_split[r.p.brand_id]) / 100;
    const a = c.amount * s; r.items[c.id] = a; r.alloc += a;
  }));
  rows.forEach(r => {
    const p = r.p;
    r.rev = p.revenue; r.contrib = p.revenue - p.cogs - p.platform_fee - p.direct_cost;
    r.cm = p.revenue ? r.contrib / p.revenue : 0;
    r.net = r.contrib - r.alloc; r.nm = p.revenue ? r.net / p.revenue : 0;
    r.aov = p.orders ? p.revenue / p.orders : 0;
    r.be = r.cm > 0 ? r.alloc / r.cm : null;
  });
  rows.sort((a, b) => b.net - a.net);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const T = { rev: sum('rev'), contrib: sum('contrib'), alloc: sum('alloc'), net: sum('net'), cost: costs.reduce((s, c) => s + c.amount, 0), orders: tOrd };
  T.unalloc = T.cost - T.alloc; T.nm = T.rev ? T.net / T.rev : 0;
  return { rows, costs, T };
}
const status = r => !r.rev ? ['flat', 'Belum ada omzet'] : r.net > 0.5 ? ['up', 'Untung'] : r.net < -0.5 ? ['down', 'Rugi'] : ['flat', 'Impas'];
const dot = c => `<span class="dot" style="background:${esc(c)}"></span>`;

/* ---------- tampilan ---------- */
const empty = (title, text, btn) => `<div class="panel empty"><h2>${title}</h2><p>${text}</p>${btn || ''}</div>`;
const goBtn = (v, label) => `<button class="btn" data-view="${v}">${label}</button>`;

function bars(items, fmt) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.v)));
  return `<div class="bars">${items.map(i => `<div class="bar ${i.v < 0 ? 'neg' : ''}"><span>${esc(i.label)}</span><i><b style="width:${Math.max(2, Math.abs(i.v) / max * 100)}%${i.color ? ';background:' + esc(i.color) : ''}"></b></i><span class="v">${fmt(i.v)}</span></div>`).join('')}</div>`;
}

function vRingkasan() {
  if (!state.brands.length) return empty('Mulai dari daftar brand', 'Tambahkan brand yang berjalan di dapur Anda, lalu isi kinerja dan biaya bulanannya.', goBtn('brand', 'Tambah brand'));
  const { rows, costs, T } = compute(state.period);
  if (!rows.length) return empty('Belum ada data bulan ' + pLabel(state.period), 'Isi omzet dan biaya langsung tiap brand agar laba bisa dihitung.', goBtn('kinerja', 'Isi kinerja brand'));

  const notes = [];
  const best = rows[0];
  if (T.net > 0 && best.net > 0) notes.push(['ok', `<b>${esc(best.brand.name)}</b> penyumbang laba bersih terbesar: ${rp(best.net)} (${pct(best.net / T.net)} dari total).`]);
  rows.filter(r => r.rev && r.net < -0.5).forEach(r => {
    const gap = r.be ? `Omzet perlu naik sekitar ${rp(r.be - r.rev)} untuk impas.` : 'Margin kontribusinya belum positif, jadi periksa HPP, komisi, dan biaya langsung.';
    notes.push(['bad', `<b>${esc(r.brand.name)}</b> rugi ${rp(-r.net)} setelah menanggung biaya bersama. ${gap}`]);
  });
  if (T.rev && T.cost / T.rev > 0.25) notes.push(['warn', `Biaya bersama memakan ${pct(T.cost / T.rev)} dari omzet. Coba tinjau sewa dan tenaga kerja bersama.`]);
  if (T.unalloc > 1) notes.push(['warn', `${rp(T.unalloc)} biaya belum teralokasi. Periksa persentase manual (harus 100%) atau pastikan semua brand sudah punya data bulan ini.`]);
  if (!costs.length) notes.push(['warn', 'Belum ada biaya bersama bulan ini, sehingga laba bersih masih sama dengan laba kontribusi.']);

  const trend = [];
  for (let i = 5; i >= 0; i--) { const p = shift(state.period, -i); const c = compute(p); if (c.rows.length) trend.push({ label: pLabel(p).replace(/ \d{4}$/, m => m), v: c.T.net }); }
  const catMap = {}; costs.forEach(c => { catMap[c.category] = (catMap[c.category] || 0) + c.amount; });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, v }));

  return `
  <div class="strip">
    <div><span>Omzet</span><strong>${rp(T.rev)}</strong><em>${T.orders.toLocaleString('id-ID')} pesanan</em></div>
    <div><span>Laba kontribusi</span><strong>${rp(T.contrib)}</strong><em>Sebelum biaya bersama</em></div>
    <div><span>Biaya bersama</span><strong>${rp(T.cost)}</strong><em>${costs.length} pos biaya</em></div>
    <div><span>Laba bersih</span><strong class="${T.net < 0 ? 'bad' : ''}">${rp(T.net)}</strong><em>Margin ${pct(T.nm)}</em></div>
  </div>
  <div class="panel"><header><div><h2>Laba tiap brand</h2><p>Laba kontribusi dikurangi bagian biaya bersama yang ditanggung brand.</p></div></header>
  <div class="tbl"><table><thead><tr><th>Brand</th><th class="n">Omzet</th><th class="n">Laba kontribusi</th><th class="n">Biaya bersama</th><th class="n">Laba bersih</th><th class="n">Margin</th><th class="n">Omzet impas</th><th>Status</th></tr></thead><tbody>
  ${rows.map(r => { const [k, t] = status(r); return `<tr><td>${dot(r.brand.color)}${esc(r.brand.name)}</td><td class="n">${rp(r.rev)}</td><td class="n">${rp(r.contrib)}</td><td class="n">${rp(r.alloc)}</td><td class="n ${r.net < 0 ? 'bad' : ''}"><b>${rp(r.net)}</b></td><td class="n">${pct(r.nm)}</td><td class="n">${r.be ? rp(r.be) : '–'}</td><td><span class="chip ${k}">${t}</span></td></tr>`; }).join('')}
  </tbody></table></div>
  <p class="hint">Omzet impas adalah omzet minimum agar brand tidak rugi, dengan margin kontribusi dan biaya bersama bulan ini tetap.</p></div>
  ${notes.length ? `<div class="panel"><header><h2>Catatan bulan ini</h2></header><ul class="notes">${notes.map(([k, t]) => `<li class="${k}">${t}</li>`).join('')}</ul></div>` : ''}
  <div class="two-col">
    <div class="panel"><header><div><h2>Laba bersih 6 bulan terakhir</h2><p>Total semua brand</p></div></header>${trend.length ? bars(trend, rp) : '<p class="muted">Belum ada riwayat.</p>'}</div>
    <div class="panel"><header><div><h2>Ke mana biaya bersama pergi</h2><p>${pLabel(state.period)}</p></div></header>${cats.length ? bars(cats, rp) : '<p class="muted">Belum ada biaya bersama.</p>'}</div>
  </div>`;
}

function vKinerja() {
  const cur = pOf(state.period);
  const list = state.brands.filter(b => b.is_active || state.perf.some(p => p.brand_id === b.id && pOf(p.period) === cur));
  if (!list.length) return empty('Belum ada brand', 'Tambahkan brand terlebih dahulu.', goBtn('brand', 'Tambah brand'));
  const f = [['revenue', 'Omzet bersih'], ['orders', 'Jumlah pesanan'], ['cogs', 'HPP / bahan baku'], ['platform_fee', 'Komisi platform'], ['direct_cost', 'Biaya langsung lain']];
  return `<div class="panel"><header><div><h2>Kinerja ${pLabel(state.period)}</h2><p>Isi angka sebulan penuh untuk tiap brand. Laba kontribusi terhitung otomatis.</p></div>
  <div class="row"><button class="btn ghost" data-act="perf-copy">Isi dari bulan lalu</button><button class="btn" data-act="perf-save">Simpan semua</button></div></header>
  <div class="tbl"><table id="perfTbl"><thead><tr><th>Brand</th>${f.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th class="n">Laba kontribusi</th></tr></thead><tbody>
  ${list.map(b => { const p = state.perf.find(x => x.brand_id === b.id && pOf(x.period) === cur) || {};
    return `<tr data-brand="${b.id}"><td>${dot(b.color)}${esc(b.name)}</td>${f.map(([k]) => `<td class="n"><input class="cell money ${k === 'orders' ? 's' : ''}" inputmode="numeric" data-f="${k}" value="${fmtIn(p[k])}" placeholder="0" aria-label="${esc(b.name)} ${k}"></td>`).join('')}<td class="n" data-c="${b.id}">–</td></tr>`; }).join('')}
  </tbody></table></div>
  <ul class="hint" style="padding-left:18px;margin-bottom:0"><li><b>Omzet bersih</b>: penjualan setelah diskon, sebelum dipotong komisi.</li><li><b>Komisi platform</b>: potongan GoFood, GrabFood, ShopeeFood, termasuk promo yang Anda tanggung.</li><li><b>Biaya langsung lain</b>: kemasan, iklan, dan gaji yang khusus untuk brand itu.</li></ul></div>`;
}

function vBiaya() {
  const costs = state.costs.filter(c => pOf(c.period) === state.period);
  const total = costs.reduce((s, c) => s + c.amount, 0);
  return `<div class="panel"><header><div><h2>Biaya bersama ${pLabel(state.period)}</h2><p>Biaya yang dipakai semua brand dan perlu dibagi.</p></div>
  <div class="row"><button class="btn ghost" data-act="cost-copy">Salin dari bulan lalu</button><button class="btn" data-act="cost-add">Tambah biaya</button></div></header>
  ${costs.length ? `<div class="tbl"><table><thead><tr><th>Nama biaya</th><th>Kategori</th><th class="n">Jumlah</th><th>Dibagi berdasarkan</th><th></th></tr></thead><tbody>
  ${costs.map(c => `<tr><td>${esc(c.name)}${c.notes ? `<div class="muted small">${esc(c.notes)}</div>` : ''}</td><td>${esc(c.category)}</td><td class="n">${rp(c.amount)}</td><td><span class="chip tag">${METHODS[c.method][0]}</span></td>
  <td class="n"><button class="btn ghost sm" data-act="cost-edit" data-id="${c.id}">Ubah</button> <button class="btn danger sm" data-act="cost-del" data-id="${c.id}">Hapus</button></td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="2">Total</td><td class="n">${rp(total)}</td><td colspan="2"></td></tr></tfoot></table></div>`
    : `<div class="empty" style="padding:26px 0 8px"><p>Belum ada biaya bulan ini. Pilih salah satu contoh di bawah atau tambah sendiri.</p></div>`}
  </div>
  <div class="panel"><header><div><h2>Tambah cepat</h2><p>Pilih jenis biaya, nama dan cara bagi sudah terisi. Tinggal masukkan jumlahnya.</p></div></header>
  <div class="chips">${TEMPLATES.map((t, i) => `<button data-act="cost-tpl" data-id="${i}">${t[0]}</button>`).join('')}</div>
  <p class="hint">Tidak yakin cara baginya? Sewa dan iklan biasanya mengikuti omzet. Listrik, gas, dan tenaga dapur mengikuti jumlah pesanan. Internet dan kebersihan dibagi rata.</p></div>`;
}

function vAlokasi() {
  const { rows, costs, T } = compute(state.period);
  if (!rows.length || !costs.length) return empty('Belum ada yang bisa dialokasikan', 'Alokasi muncul setelah ada kinerja brand dan biaya bersama di bulan ' + pLabel(state.period) + '.', `<div class="row" style="justify-content:center">${goBtn('kinerja', 'Isi kinerja')} ${goBtn('biaya', 'Isi biaya')}</div>`);
  return `<div class="panel"><header><div><h2>Siapa menanggung apa, ${pLabel(state.period)}</h2><p>Setiap biaya dibagi ke brand sesuai cara bagi yang dipilih.</p></div>
  <div class="row noprint"><button class="btn ghost" data-act="print">Cetak</button><button class="btn soft" data-act="csv">Unduh CSV</button></div></header>
  <div class="tbl"><table><thead><tr><th>Biaya</th><th>Cara bagi</th><th class="n">Total</th>${rows.map(r => `<th class="n">${dot(r.brand.color)}${esc(r.brand.name)}</th>`).join('')}</tr></thead><tbody>
  ${costs.map(c => `<tr><td>${esc(c.name)}</td><td><span class="chip tag">${METHODS[c.method][0]}</span></td><td class="n">${rp(c.amount)}</td>${rows.map(r => `<td class="n">${rp(r.items[c.id])}</td>`).join('')}</tr>`).join('')}
  <tr class="sum"><td colspan="2">Total biaya bersama</td><td class="n">${rp(T.cost)}</td>${rows.map(r => `<td class="n">${rp(r.alloc)}</td>`).join('')}</tr>
  <tr><td colspan="2">Laba kontribusi</td><td class="n">${rp(T.contrib)}</td>${rows.map(r => `<td class="n">${rp(r.contrib)}</td>`).join('')}</tr>
  <tr class="sum"><td colspan="2">Laba bersih</td><td class="n ${T.net < 0 ? 'bad' : ''}">${rp(T.net)}</td>${rows.map(r => `<td class="n ${r.net < 0 ? 'bad' : ''}">${rp(r.net)}</td>`).join('')}</tr>
  </tbody></table></div>
  ${T.unalloc > 1 ? `<p class="err">${rp(T.unalloc)} belum teralokasi. Biasanya karena persentase manual belum 100% atau ada brand yang belum diisi kinerjanya.</p>` : ''}
  <p class="hint">Hanya brand yang punya data kinerja di bulan ini yang ikut menanggung biaya. Pembagian rata dihitung dari jumlah brand tersebut.</p></div>`;
}

function vBrand() {
  return `<div class="panel"><header><div><h2>Brand di dapur Anda</h2><p>Brand nonaktif tidak muncul di form kinerja, tetapi riwayatnya tetap tersimpan.</p></div><button class="btn" data-act="brand-add">Tambah brand</button></header>
  ${state.brands.length ? `<div class="brands">${state.brands.map(b => `<div class="bcard ${b.is_active ? '' : 'off'}"><div class="sw" style="background:${esc(b.color)}"></div><h3>${esc(b.name)}</h3><p class="muted small">${esc(b.cuisine || 'Jenis menu belum diisi')}${b.is_active ? '' : ' · nonaktif'}</p>
  <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-act="brand-edit" data-id="${b.id}">Ubah</button><button class="btn danger sm" data-act="brand-del" data-id="${b.id}">Hapus</button></div></div>`).join('')}</div>`
    : '<div class="empty"><p>Belum ada brand.</p></div>'}</div>`;
}

const VIEWS = { ringkasan: vRingkasan, kinerja: vKinerja, biaya: vBiaya, alokasi: vAlokasi, brand: vBrand };

function render() {
  $('#title').textContent = TITLES[state.view];
  $('#periodBox').style.display = state.view === 'brand' ? 'none' : '';
  $('#period').value = state.period;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  view.innerHTML = VIEWS[state.view]();
  if (state.view === 'kinerja') $$('#perfTbl tbody tr').forEach(updateContrib);
}
function go(v) { state.view = v; render(); window.scrollTo({ top: 0 }); }

function updateContrib(tr) {
  const g = f => money($(`[data-f="${f}"]`, tr));
  const c = g('revenue') - g('cogs') - g('platform_fee') - g('direct_cost');
  const cell = $('[data-c]', tr);
  cell.textContent = rp(c); cell.className = 'n ' + (c < 0 ? 'bad' : 'good');
}

/* ---------- modal ---------- */
function openDlg(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }

function openCost(c = {}) {
  const act = state.brands.filter(b => b.is_active || (c.manual_split || {})[b.id] != null);
  if (!act.length) return toast('Tambahkan brand lebih dulu.', true);
  const sp = c.manual_split || {};
  openDlg(`<form id="f" class="modal"><h2>${c.id ? 'Ubah' : 'Tambah'} biaya bersama</h2>
  <label>Nama biaya<input name="name" required maxlength="80" value="${esc(c.name)}" placeholder="mis. Sewa dapur"></label>
  <div class="two"><label>Kategori<select name="category">${CATS.map(x => `<option ${x === (c.category || 'Lainnya') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
  <label>Jumlah per bulan (Rp)<input class="money" name="amount" inputmode="numeric" required value="${fmtIn(c.amount)}" placeholder="0"></label></div>
  <label>Dibagi berdasarkan<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${k === (c.method || 'revenue') ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
  <p class="hint" id="mh"></p>
  <div id="man" hidden><div class="split">${act.map(b => `<span>${dot(b.color)}${esc(b.name)}</span><input type="number" min="0" max="100" step="0.1" data-b="${b.id}" value="${sp[b.id] ?? ''}" placeholder="0" aria-label="Persen ${esc(b.name)}">`).join('')}
  <b>Total</b><b id="mt" style="text-align:right">0%</b></div></div>
  <label style="margin-top:12px">Catatan (opsional)<input name="notes" maxlength="160" value="${esc(c.notes)}"></label>
  <div class="actions"><button type="button" class="btn ghost" data-act="close">Batal</button><button class="btn">Simpan</button></div></form>`);
  const f = $('#f'), man = $('#man');
  const sync = () => {
    const m = f.elements.method.value; $('#mh').textContent = METHODS[m][1]; man.hidden = m !== 'manual';
    const t = $$('[data-b]', f).reduce((s, i) => s + num(i.value), 0);
    const el = $('#mt'); el.textContent = t.toFixed(1).replace('.0', '').replace('.', ',') + '%'; el.className = Math.abs(t - 100) < 0.05 ? 'good' : 'bad';
  };
  f.addEventListener('input', sync); sync();
  f.onsubmit = e => { e.preventDefault(); run(async () => {
    const amount = money(f.amount); if (amount <= 0) return toast('Jumlah biaya harus lebih dari 0.', true);
    const method = f.elements.method.value; let split = {};
    if (method === 'manual') {
      $$('[data-b]', f).forEach(i => { if (num(i.value) > 0) split[i.dataset.b] = num(i.value); });
      const t = Object.values(split).reduce((s, v) => s + v, 0);
      if (Math.abs(t - 100) > 0.05) return toast('Total persentase harus tepat 100%.', true);
    }
    const row = { name: f.elements.name.value.trim(), category: f.category.value, amount, method, manual_split: split, notes: f.notes.value.trim() || null };
    const { error } = c.id ? await sb.from('shared_costs').update(row).eq('id', c.id)
      : await sb.from('shared_costs').insert({ ...row, period: dbP(state.period) });
    if (error) throw error;
    dlg.close(); await reload('Biaya disimpan.');
  }, $('.btn:not(.ghost)', f)); };
}

function openBrand(b = {}) {
  const col = b.color || PALETTE[state.brands.length % PALETTE.length];
  const pal = PALETTE.includes(col) ? PALETTE : [col, ...PALETTE];
  openDlg(`<form id="f" class="modal"><h2>${b.id ? 'Ubah' : 'Tambah'} brand</h2>
  <label>Nama brand<input name="name" required maxlength="60" value="${esc(b.name)}" placeholder="mis. Dapur Aruna"></label>
  <label>Jenis menu<input name="cuisine" maxlength="80" value="${esc(b.cuisine)}" placeholder="mis. Nasi & lauk rumahan"></label>
  <label>Warna penanda</label><div class="swatches">${pal.map(c => `<label><input type="radio" name="color" value="${c}" ${c === col ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
  <label style="margin-top:14px"><span class="row"><input type="checkbox" name="active" ${b.is_active === false ? '' : 'checked'}> Brand aktif</span></label>
  <div class="actions"><button type="button" class="btn ghost" data-act="close">Batal</button><button class="btn">Simpan</button></div></form>`);
  const f = $('#f');
  f.onsubmit = e => { e.preventDefault(); run(async () => {
    const row = { name: f.elements.name.value.trim(), cuisine: f.cuisine.value.trim() || null, color: f.color.value, is_active: f.active.checked };
    const { error } = b.id ? await sb.from('brands').update(row).eq('id', b.id) : await sb.from('brands').insert(row);
    if (error) throw error;
    dlg.close(); await reload('Brand disimpan.');
  }, $('.btn:not(.ghost)', f)); };
}

/* ---------- aksi ---------- */
const actions = {
  prev: () => setPeriod(shift(state.period, -1)),
  next: () => setPeriod(shift(state.period, 1)),
  close: () => dlg.close(),
  print: () => window.print(),
  'brand-add': () => openBrand(),
  'brand-edit': id => openBrand(state.brands.find(b => b.id === id)),
  'brand-del': id => {
    const b = state.brands.find(x => x.id === id);
    if (!confirm(`Hapus brand "${b.name}"?\nSeluruh data kinerjanya ikut terhapus dan tidak bisa dikembalikan. Jika hanya ingin berhenti memakai, ubah menjadi nonaktif.`)) return;
    run(async () => { const { error } = await sb.from('brands').delete().eq('id', id); if (error) throw error; await reload('Brand dihapus.'); });
  },
  'cost-add': () => openCost(),
  'cost-edit': id => openCost(state.costs.find(c => c.id === id)),
  'cost-tpl': i => { const t = TEMPLATES[i]; openCost({ name: t[0], category: t[1], method: t[2] }); },
  'cost-del': id => {
    const c = state.costs.find(x => x.id === id);
    if (!confirm(`Hapus biaya "${c.name}" bulan ${pLabel(state.period)}?`)) return;
    run(async () => { const { error } = await sb.from('shared_costs').delete().eq('id', id); if (error) throw error; await reload('Biaya dihapus.'); });
  },
  'cost-copy': (id, btn) => run(async () => {
    const prev = pOf(dbP(shift(state.period, -1)));
    const have = new Set(state.costs.filter(c => pOf(c.period) === state.period).map(c => c.name.toLowerCase()));
    const add = state.costs.filter(c => pOf(c.period) === prev && !have.has(c.name.toLowerCase()))
      .map(c => ({ period: dbP(state.period), name: c.name, category: c.category, amount: c.amount, method: c.method, manual_split: c.manual_split, notes: c.notes }));
    if (!add.length) return toast(`Tidak ada biaya baru untuk disalin dari ${pLabel(prev)}.`, true);
    const { error } = await sb.from('shared_costs').insert(add); if (error) throw error;
    await reload(`${add.length} biaya disalin dari ${pLabel(prev)}. Cek jumlahnya bila ada yang berubah.`);
  }, btn),
  'perf-copy': () => {
    const prev = shift(state.period, -1); let n = 0;
    $$('#perfTbl tbody tr').forEach(tr => {
      const p = state.perf.find(x => x.brand_id === tr.dataset.brand && pOf(x.period) === prev); if (!p) return;
      $$('[data-f]', tr).forEach(i => { i.value = fmtIn(p[i.dataset.f]); }); updateContrib(tr); n++;
    });
    toast(n ? `Terisi dari ${pLabel(prev)}. Perbarui angkanya lalu klik Simpan semua.` : `Tidak ada data di ${pLabel(prev)}.`, !n);
  },
  'perf-save': (id, btn) => run(async () => {
    const rows = [];
    $$('#perfTbl tbody tr').forEach(tr => {
      const g = f => money($(`[data-f="${f}"]`, tr));
      const r = { brand_id: tr.dataset.brand, period: dbP(state.period), revenue: g('revenue'), orders: g('orders'), cogs: g('cogs'), platform_fee: g('platform_fee'), direct_cost: g('direct_cost') };
      const exists = state.perf.some(p => p.brand_id === r.brand_id && pOf(p.period) === state.period);
      if (exists || r.revenue || r.orders || r.cogs || r.platform_fee || r.direct_cost) rows.push(r);
    });
    if (!rows.length) return toast('Belum ada angka yang diisi.', true);
    const { error } = await sb.from('brand_performance').upsert(rows, { onConflict: 'brand_id,period' });
    if (error) throw error;
    await reload('Kinerja ' + pLabel(state.period) + ' disimpan.');
  }, btn),
  csv: () => {
    const { rows, costs, T } = compute(state.period);
    const L = [['Biaya', 'Kategori', 'Cara bagi', 'Total', ...rows.map(r => r.brand.name)],
      ...costs.map(c => [c.name, c.category, METHODS[c.method][0], c.amount, ...rows.map(r => Math.round(r.items[c.id] || 0))]),
      ['Total biaya bersama', '', '', T.cost, ...rows.map(r => Math.round(r.alloc))],
      ['Omzet', '', '', T.rev, ...rows.map(r => r.rev)],
      ['Laba kontribusi', '', '', T.contrib, ...rows.map(r => r.contrib)],
      ['Laba bersih', '', '', Math.round(T.net), ...rows.map(r => Math.round(r.net))]];
    const text = '\ufeff' + L.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `selaras-alokasi-${state.period}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
};

function setPeriod(p) { if (!/^\d{4}-\d{2}$/.test(p)) return; state.period = p; render(); }

document.addEventListener('click', e => {
  const v = e.target.closest('[data-view]'); if (v) return go(v.dataset.view);
  const t = e.target.closest('[data-act]'); if (t && actions[t.dataset.act]) actions[t.dataset.act](t.dataset.id, t);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList.contains('money')) {
    const d = el.value.replace(/\D/g, ''); el.value = d ? Number(d).toLocaleString('id-ID') : '';
    const tr = el.closest('#perfTbl tr'); if (tr) updateContrib(tr);
  }
});
$('#period').addEventListener('change', e => setPeriod(e.target.value));
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

/* ---------- mulai ---------- */
function setupScreen(err) {
  view.innerHTML = `<div class="panel setup"><h2>${err ? 'Database belum siap' : 'Hubungkan ke Supabase'}</h2>
  ${err ? `<p class="err">${esc(errText(err))}</p>` : ''}
  <ol><li>Buat project di <code>supabase.com</code>.</li><li>Buka <b>SQL Editor</b>, jalankan isi <code>sql/01_schema.sql</code> (lalu <code>sql/02_seed.sql</code> bila ingin data contoh).</li>
  <li>Salin <b>Project URL</b> dan <b>anon key</b> dari <i>Project Settings → API</i> ke file <code>js/config.js</code>.</li><li>Muat ulang halaman ini.</li></ol></div>`;
  $('#periodBox').style.display = 'none';
}

(async function init() {
  $('#nav button[data-view="ringkasan"]').classList.add('on');
  if (!configured) return setupScreen();
  if (!window.supabase) { view.innerHTML = '<p class="err">Library Supabase gagal dimuat. Periksa koneksi internet.</p>'; return; }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  try { await load(); render(); } catch (e) { console.error(e); setupScreen(e); }
})();
})();
