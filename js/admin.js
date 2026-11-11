// X Shoes — لوحة التحكم: المنتجات والمخزون والصور، الطلبيات، الإعدادات (تعتمد على js/core.js)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;
const esc = XS.esc;

const THUMB = { maxW: 360, quality: 0.7 };   // صورة القائمة — داخل مستند المنتج
const FULL = { maxW: 1000, quality: 0.75 };  // الصور الكاملة — مستند لكل صورة

// ── AUTH (كلمة مرور مشفّرة في settings/admin تطبق على كل الأجهزة) ──
async function doLogin() {
  const v = document.getElementById('pass-inp').value;
  const err = document.getElementById('login-err');
  err.textContent = '';
  try {
    const doc = await db.collection('settings').doc('admin').get();
    const ok = await XS.verifyPassword(v, doc.exists ? doc.data() : null);
    if (!ok) { err.textContent = 'كلمة المرور غير صحيحة'; return; }
    sessionStorage.setItem('xshoes_authed', '1');
    showApp();
    if (!doc.exists) showToast('غيّر كلمة المرور الافتراضية من الإعدادات');
  } catch (e) {
    console.error(e);
    err.textContent = 'تعذر الاتصال — حاول مرة أخرى';
  }
}
document.getElementById('pass-inp').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

function logout() { sessionStorage.removeItem('xshoes_authed'); location.reload(); }

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  init();
}

async function changePass() {
  const np = document.getElementById('cfg-new-pass').value.trim();
  if (np.length < 6) { showToast('كلمة المرور 6 أحرف على الأقل'); return; }
  try {
    await db.collection('settings').doc('admin').set({ ...(await XS.makePasswordRecord(np)), updatedAt: FV.serverTimestamp() });
    document.getElementById('cfg-new-pass').value = '';
    showToast('تم تغيير كلمة المرور على كل الأجهزة');
  } catch (e) { console.error(e); showToast('تعذر الحفظ'); }
}

// ── STATE ──
let products = [];
let orders = [];
let orderFilter = 'new';
let uploadedImgs = [];
let editingId = null;
let editingImageCount = 0;
let storeSettings = {};
let started = false;

function init() {
  if (started) return;
  started = true;
  loadSettings();
  loadProducts();
  loadHeroSlots();
  loadOrders();
}

// ── SETTINGS ──
const DEFAULT_HERO = ['موديلات تواكب كل الصيحات، من الكلاسيكي إلى الرياضي، وبأكثر من لون.', 'توصيل داخل طرابلس وخارجها، والدفع نقداً أو موبي كاش.'].join(String.fromCharCode(10));
async function loadSettings() {
  try {
    const doc = await db.collection('settings').doc('store').get();
    document.getElementById('cfg-hero').value = DEFAULT_HERO;
    if (doc.exists) {
      storeSettings = doc.data();
      document.getElementById('cfg-phone').value = storeSettings.phone || '0920007485';
      document.getElementById('cfg-address').value = storeSettings.address || 'جنزور سيمافرو';
      document.getElementById('cfg-delivery').value = storeSettings.delivery || 'توصيل داخل وخارج طرابلس';
      if (String(storeSettings.heroText || '').trim()) document.getElementById('cfg-hero').value = storeSettings.heroText;
      if (storeSettings.showPrices === false) document.getElementById('cfg-show-prices').classList.remove('on');
    }
  } catch (e) { console.log(e); }
}

async function saveSettings() {
  const settings = {
    phone: document.getElementById('cfg-phone').value.trim(),
    address: document.getElementById('cfg-address').value.trim(),
    delivery: document.getElementById('cfg-delivery').value.trim(),
    showPrices: document.getElementById('cfg-show-prices').classList.contains('on'),
    heroText: document.getElementById('cfg-hero').value.trim().slice(0, 400),
    updatedAt: FV.serverTimestamp(),
  };
  try {
    await db.collection('settings').doc('store').set(settings);
    showToast('تم حفظ الإعدادات');
  } catch (e) { showToast('خطأ في الحفظ'); console.error(e); }
}

// ── PRODUCTS ──
function loadProducts() {
  db.collection('products').orderBy('createdAt', 'desc').onSnapshot((snap) => {
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderList();
    updateStats();
  }, (e) => console.error(e));
}

function thumbOf(p) { return p.thumb || (p.images && p.images[0]) || ''; }

function stockSummary(p) {
  if (!p.stock) return 'الكمية غير مُتتبَّعة';
  const sizes = XS.sizeList(p);
  const cell = (s, c) => { const n = XS.stockOf(p, s, c); return `${esc(s)}: <b style="color:${n ? 'inherit' : 'var(--oxblood)'}">${n}</b>`; };
  if (XS.hasColors(p)) {
    return XS.colorsOf(p).map((c) => `<span class="swatch" style="--c:${esc(c.hex || '#999')}"></span> ${esc(c.name)} — ${sizes.map((s) => cell(s, c.name)).join('، ')}`).join('<br>');
  }
  return sizes.map((s) => cell(s)).join('، ');
}

function renderList() {
  const el = document.getElementById('prod-list');
  const empty = document.getElementById('prod-empty');
  if (!products.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const labels = { new: 'جديد', sale: 'تخفيض', exclusive: 'حصري' };
  el.innerHTML = products.map((p) => {
    const t = thumbOf(p);
    const img = t ? `<img src="${esc(t)}" alt="">` : '<div class="ph">X</div>';
    const soldOut = XS.isSoldOut(p);
    const badge = soldOut ? 'none' : (p.badge || 'none');
    const badgeLabel = soldOut ? 'نفد' : (labels[p.badge] || '—');
    const legacy = p.images && p.images.length && !p.imageCount ? ' · <span style="color:#e0a050">صور بالطريقة القديمة</span>' : '';
    return `<div class="prod-row">
      ${img}
      <div><div class="pr-name">${esc(p.name)}</div>
        <div class="pr-meta">${esc(p.brand || 'X Shoes')} — مقاسات ${esc(XS.parseSizes(p.sizes).join('، '))}${legacy}</div>
        <div class="pr-meta">${stockSummary(p)}</div></div>
      <div class="pr-price">${p.showPrice && p.price ? esc(p.price) + ' د.ل' : '—'}</div>
      <div class="pr-badge ${esc(badge)}">${badgeLabel}</div>
      <div class="row-actions">
        <button class="row-btn" data-act="edit" data-id="${esc(p.id)}">تعديل</button>
        <button class="row-btn del" data-act="del" data-id="${esc(p.id)}">حذف</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'edit') editProduct(b.dataset.id); else deleteProduct(b.dataset.id);
  }));
}

function updateStats() {
  document.getElementById('stat-total').textContent = products.length;
  document.getElementById('stat-visible').textContent = products.filter((p) => p.showPrice && p.price).length;
  document.getElementById('stat-new').textContent = products.filter((p) => XS.isSoldOut(p)).length;
}

// ── STOCK FORM ──
function formSizes() {
  return XS.parseSizes(document.getElementById('f-sizes').value);
}
// ── الألوان ──
let colorsState = [];
function cleanColors() {
  const seen = new Set();
  return colorsState.map((c) => ({ name: String(c.name || '').trim(), hex: c.hex || '#999999' }))
    .filter((c) => c.name && !seen.has(c.name) && seen.add(c.name));
}
function renderColorRows() {
  const box = document.getElementById('color-rows');
  box.innerHTML = colorsState.map((c, i) => `
    <div class="color-row">
      <input type="color" value="${esc(c.hex || '#999999')}" data-i="${i}" data-f="hex" aria-label="درجة اللون">
      <input class="inp" value="${esc(c.name || '')}" data-i="${i}" data-f="name" placeholder="اسم اللون (أسود، بني…)" maxlength="30">
      <button type="button" class="row-btn del" data-rm="${i}" aria-label="حذف اللون">✕</button>
    </div>`).join('');
  box.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
    colorsState[+inp.dataset.i][inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'name') renderStockInputs();
  }));
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    colorsState.splice(+b.dataset.rm, 1); renderColorRows(); renderStockInputs();
  }));
}
function addColorRow() { colorsState.push({ name: '', hex: '#1d1e20' }); renderColorRows(); }

function renderStockInputs(stock) {
  const box = document.getElementById('stock-inputs');
  const on = document.getElementById('t-stock').classList.contains('on');
  box.style.display = on ? 'block' : 'none';
  const prev = {};
  box.querySelectorAll('input').forEach((i) => { prev[i.dataset.key] = i.value; });
  const sizes = formSizes();
  const colors = cleanColors();
  if (!sizes.length) { box.innerHTML = '<p class="hint">أدخل المقاسات أولاً</p>'; return; }
  const val = (k) => (stock ? (stock[k] ?? 0) : (prev[k] ?? 0));
  const cell = (k) => `<input type="number" min="0" max="9999" class="inp" data-key="${esc(k)}" value="${esc(val(k))}" aria-label="${esc(k.replace('|', ' مقاس '))}">`;
  const rows = colors.length ? colors.map((c) => ({ label: `<span class="swatch" style="--c:${esc(c.hex)}"></span>${esc(c.name)}`, color: c.name })) : [{ label: 'الكمية', color: '' }];
  box.innerHTML = `<table class="stock-table"><thead><tr><th></th>${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><th>${r.label}</th>${sizes.map((s) => `<td>${cell(XS.stockKey(s, r.color))}</td>`).join('')}</tr>`).join('')}
  </tbody></table>`;
}
function toggleStock(el) { el.classList.toggle('on'); renderStockInputs(); }
function readStock() {
  if (!document.getElementById('t-stock').classList.contains('on')) return null;
  const out = {};
  document.querySelectorAll('#stock-inputs input').forEach((i) => { out[i.dataset.key] = Math.max(0, parseInt(i.value, 10) || 0); });
  return out;
}

// ── صور الواجهة ──
const HERO_IMG = { maxW: 1200, quality: 0.78 };
const HERO_SLOTS = ['الصورة 1 — في النص فوق', 'الصورة 2 — الكبيرة', 'الصورة 3 — في النص تحت', 'الصورة 4 — الصغيرة (ما تظهرش في الهاتف)'];
let heroSlots = [null, null, null, null];
async function loadHeroSlots() {
  try {
    const docs = await Promise.all(HERO_SLOTS.map((_, i) => db.collection('settings').doc('hero-' + i).get()));
    heroSlots = docs.map((d) => (d.exists && d.data().data) || null);
  } catch (e) { console.log(e); }
  renderHeroSlots();
}
function renderHeroSlots() {
  const box = document.getElementById('hero-slots');
  box.innerHTML = HERO_SLOTS.map((label, i) => `
    <div class="hero-slot">
      <div class="hero-slot-img">${heroSlots[i] ? `<img src="${esc(heroSlots[i])}" alt="">` : '<span>تلقائي من المنتجات</span>'}</div>
      <div class="hero-slot-label">${esc(label)}</div>
      <label class="btn btn-line btn-sm">${heroSlots[i] ? 'غيّر الصورة' : 'اختر صورة'}<input type="file" accept="image/*" hidden data-slot="${i}"></label>
      ${heroSlots[i] ? `<button type="button" class="btn btn-text btn-sm" data-clear="${i}">رجّعها تلقائي</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('input[data-slot]').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.files[0]) setHeroSlot(+inp.dataset.slot, inp.files[0]);
  }));
  box.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => clearHeroSlot(+b.dataset.clear)));
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('ما قدرناش نقرأ الصورة'));
    r.readAsDataURL(file);
  });
}
async function setHeroSlot(i, file) {
  showToast('جاري رفع الصورة…');
  try {
    const data = await compressImage(await readFileAsDataURL(file), HERO_IMG);
    await db.collection('settings').doc('hero-' + i).set({ data, updatedAt: FV.serverTimestamp() });
    heroSlots[i] = data;
    renderHeroSlots();
    showToast('تم حفظ صورة الواجهة');
  } catch (e) { console.error(e); showToast('ما قدرناش نحفظ الصورة، جرّب صورة ثانية'); }
}
async function clearHeroSlot(i) {
  try {
    await db.collection('settings').doc('hero-' + i).delete();
    heroSlots[i] = null;
    renderHeroSlots();
    showToast('رجعت تلقائي من المنتجات');
  } catch (e) { console.error(e); showToast('خطأ في الحفظ'); }
}

// ── IMAGES ──
function compressImage(src, opts) {
  return new Promise((resolve, reject) => {
    if (src.startsWith('http')) { resolve(src); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width; let h = img.height;
      if (w > opts.maxW) { h = Math.round(h * opts.maxW / w); w = opts.maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', opts.quality));
    };
    img.onerror = () => reject(new Error('صورة غير صالحة'));
    img.src = src;
  });
}

async function loadProductImages(p) {
  if (p.imageCount > 0) {
    const snap = await db.collection('products').doc(p.id).collection('images').orderBy('i').get();
    return snap.docs.map((d) => d.data().data).filter(Boolean);
  }
  return [...(p.images || [])];
}

/** يكتب الصورة المصغّرة في المنتج والصور الكاملة في products/{id}/images ويحذف الزائد والقديم */
async function writeImages(ref, images, oldCount) {
  const full = [];
  for (const src of images) full.push(await compressImage(src, FULL));
  const thumb = full.length ? await compressImage(full[0], THUMB) : '';
  for (let i = 0; i < full.length; i++) await ref.collection('images').doc(String(i)).set({ i, data: full[i] });
  for (let i = full.length; i < Math.max(oldCount, 0); i++) await ref.collection('images').doc(String(i)).delete();
  await ref.update({ thumb, imageCount: full.length, images: FV.delete() });
}

function handleUpload(e) {
  Array.from(e.target.files).forEach((f) => {
    const reader = new FileReader();
    reader.onload = (ev) => { uploadedImgs.push(ev.target.result); renderImgPreview(); };
    reader.readAsDataURL(f);
  });
  e.target.value = '';
}
function renderImgPreview() {
  const box = document.getElementById('img-preview');
  box.innerHTML = uploadedImgs.map((src, i) => `
    <div class="img-thumb">
      <img src="${esc(src)}">
      <button class="img-del" data-i="${i}">✕</button>
      ${i === 0 ? '<span class="img-main">الرئيسية</span>' : ''}
    </div>`).join('');
  box.querySelectorAll('.img-del').forEach((b) => b.addEventListener('click', () => removeImg(+b.dataset.i)));
}
function removeImg(i) { uploadedImgs.splice(i, 1); renderImgPreview(); }

// ── SAVE PRODUCT ──
async function submitProduct() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('أدخل اسم المنتج'); return; }
  const sizes = formSizes();
  const stock = readStock();
  const btn = document.getElementById('submit-btn');
  btn.textContent = 'جاري الحفظ…'; btn.disabled = true;
  try {
    const data = {
      name,
      brand: document.getElementById('f-brand').value.trim() || 'X Shoes',
      desc: document.getElementById('f-desc').value.trim(),
      price: document.getElementById('f-price').value.trim(),
      showPrice: document.getElementById('t-price').classList.contains('on'),
      sizes,
      colors: cleanColors().length ? cleanColors() : FV.delete(),
      badge: document.getElementById('f-badge').value,
      stock: stock || FV.delete(),
      updatedAt: FV.serverTimestamp(),
    };
    let ref;
    if (editingId) {
      ref = db.collection('products').doc(editingId);
      await ref.update(data);
    } else {
      data.createdAt = FV.serverTimestamp();
      if (!stock) delete data.stock;
      if (!cleanColors().length) delete data.colors;
      ref = await db.collection('products').add(data);
    }
    await writeImages(ref, uploadedImgs, editingId ? editingImageCount : 0);
    showToast(editingId ? 'تم تعديل المنتج' : 'تم إضافة المنتج');
    if (editingId) cancelEdit(); else resetForm();
  } catch (e) {
    console.error(e);
    showToast('خطأ: ' + e.message);
  }
  btn.textContent = editingId ? 'حفظ التعديل' : 'إضافة المنتج';
  btn.disabled = false;
}

async function editProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  editingId = id;
  editingImageCount = p.imageCount || 0;
  document.getElementById('f-name').value = p.name || '';
  document.getElementById('f-brand').value = p.brand || '';
  document.getElementById('f-desc').value = p.desc || '';
  document.getElementById('f-price').value = p.price || '';
  document.getElementById('f-sizes').value = XS.parseSizes(p.sizes).join(',');
  document.getElementById('f-badge').value = p.badge || '';
  document.getElementById('t-price').classList.toggle('on', !!p.showPrice);
  document.getElementById('t-stock').classList.toggle('on', !!p.stock);
  colorsState = (p.colors || []).map((c) => ({ ...c }));
  renderColorRows();
  renderStockInputs(p.stock || null);
  document.getElementById('submit-btn').textContent = 'حفظ التعديل';
  document.getElementById('cancel-btn').style.display = 'block';
  document.getElementById('edit-banner').classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  uploadedImgs = [];
  renderImgPreview();
  try { uploadedImgs = await loadProductImages(p); } catch (e) { console.error(e); showToast('تعذر تحميل الصور'); }
  if (editingId === id) renderImgPreview();
}

function cancelEdit() {
  editingId = null;
  editingImageCount = 0;
  resetForm();
  document.getElementById('submit-btn').textContent = 'إضافة المنتج';
  document.getElementById('cancel-btn').style.display = 'none';
  document.getElementById('edit-banner').classList.remove('show');
}

function resetForm() {
  ['f-name', 'f-brand', 'f-desc', 'f-price', 'f-sizes'].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('f-badge').value = '';
  document.getElementById('t-price').classList.add('on');
  document.getElementById('t-stock').classList.add('on');
  document.getElementById('stock-inputs').innerHTML = '';
  colorsState = [];
  renderColorRows();
  renderStockInputs({});
  uploadedImgs = [];
  renderImgPreview();
}

async function deleteProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p || !confirm(`حذف "${p.name}"؟`)) return;
  try {
    const ref = db.collection('products').doc(id);
    const imgs = await ref.collection('images').get();
    for (const d of imgs.docs) await d.ref.delete();
    await ref.delete();
    showToast('تم الحذف');
  } catch (e) { console.error(e); showToast('خطأ في الحذف'); }
}

/** تحويل صور المنتجات القديمة (داخل مستند المنتج) إلى الطريقة الجديدة */
async function migrateImages() {
  const legacy = products.filter((p) => p.images && p.images.length && !p.imageCount);
  if (!legacy.length) { showToast('كل المنتجات بالطريقة الجديدة'); return; }
  if (!confirm(`تحويل صور ${legacy.length} منتج؟ قد يستغرق دقيقة.`)) return;
  const btn = document.getElementById('migrate-btn');
  btn.disabled = true;
  let done = 0;
  for (const p of legacy) {
    btn.textContent = `جاري التحويل ${done} من ${legacy.length}`;
    try { await writeImages(db.collection('products').doc(p.id), p.images, 0); done++; } catch (e) { console.error(p.id, e); }
  }
  btn.disabled = false; btn.textContent = 'تحويل الصور';
  showToast(done === legacy.length ? `تم تحويل ${done} منتج` : `تم ${done} من ${legacy.length} — أعد المحاولة للباقي`);
}

// ── ORDERS ──
function loadOrders() {
  db.collection('orders').orderBy('createdAt', 'desc').limit(300).onSnapshot((snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOrders();
  }, (e) => {
    console.error(e);
    document.getElementById('orders-list').innerHTML = '<div class="empty"><p>تعذر تحميل الطلبيات — تحقق من صلاحيات قاعدة البيانات</p></div>';
  });
}

function fmtDate(o) {
  const d = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
  return d ? d.toLocaleString('ar-LY', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

const NEXT_LABELS = { confirmed: 'تأكيد (يخصم المخزون)', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'إلغاء' };

function renderOrders() {
  const counts = {};
  orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  document.getElementById('orders-tab-count').textContent = counts.new ? ` (${counts.new})` : '';
  document.getElementById('order-filters').innerHTML = Object.entries(XS.STATUSES).map(([k, l]) =>
    `<button class="row-btn${k === orderFilter ? ' on' : ''}" data-f="${k}">${l} (${counts[k] || 0})</button>`).join('');
  document.querySelectorAll('#order-filters [data-f]').forEach((b) => b.addEventListener('click', () => { orderFilter = b.dataset.f; renderOrders(); }));

  const list = orders.filter((o) => o.status === orderFilter);
  const el = document.getElementById('orders-list');
  if (!list.length) { el.innerHTML = '<div class="empty"><p>ما فيش طلبيات في هذه الحالة.</p></div>'; return; }
  el.innerHTML = list.map((o) => {
    const c = o.customer || {};
    const items = (o.items || []).map((it) => `<li>${esc(it.name)}${it.color ? ' — ' + esc(it.color) : ''} — مقاس ${esc(it.size)} × ${esc(it.qty)}${it.price ? ` — ${esc(it.price * it.qty)} د.ل` : ''}</li>`).join('');
    const actions = (XS.TRANSITIONS[o.status] || []).map((s) =>
      `<button class="row-btn${s === 'cancelled' ? ' del' : ''}" data-order="${esc(o.id)}" data-to="${s}">${s === 'cancelled' && o.stockApplied ? 'إلغاء (يرجّع المخزون)' : NEXT_LABELS[s]}</button>`).join('');
    const wa = c.phone ? `<a class="row-btn" target="_blank" rel="noopener" href="https://wa.me/${esc(c.phone)}?text=${encodeURIComponent('مرحباً ' + (c.name || '') + '، بخصوص طلبيتك رقم ' + o.code + ' من X Shoes')}">واتساب الزبون</a>` : '';
    return `<div class="order-card">
      <div class="order-head"><b>${esc(o.code)}</b><span class="pr-badge none">${esc(XS.STATUSES[o.status] || o.status)}</span><span class="pr-meta">${fmtDate(o)}</span>
        ${o.stockApplied ? '<span class="pr-meta" style="color:#7fc87f">المخزون مخصوم</span>' : ''}</div>
      <div class="order-body">
        <div><div class="pr-name">${esc(c.name)}</div><div class="pr-meta">0${esc(String(c.phone || '').slice(3))} · ${esc(c.city)} — ${esc(c.address)}</div>
          ${c.note ? `<div class="pr-meta">ملاحظة: ${esc(c.note)}</div>` : ''}</div>
        <ul class="order-items">${items}</ul>
        <div class="pr-price">${o.total ? esc(o.total) + ' د.ل' : '—'}</div>
      </div>
      <div class="row-actions" style="flex-wrap:wrap">${actions}${wa}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => setOrderStatus(b.dataset.order, b.dataset.to)));
}

/** تغيير الحالة داخل معاملة: التأكيد يخصم المخزون، والإلغاء بعد الخصم يرجعه */
async function setOrderStatus(id, to) {
  if (to === 'cancelled' && !confirm('إلغاء هذه الطلبية؟')) return;
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection('orders').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('الطلبية غير موجودة');
      const o = snap.data();
      if (!XS.canTransition(o.status, to)) throw new Error('تغيّرت حالة الطلبية — حدّث الصفحة');

      const update = { status: to, history: FV.arrayUnion({ status: to, at: Date.now() }) };
      const direction = to === 'confirmed' ? -1 : (to === 'cancelled' && o.stockApplied ? +1 : 0);
      if (direction) {
        const ids = [...new Set((o.items || []).map((it) => it.productId))];
        const stocks = {};
        const refs = {};
        for (const pid of ids) {
          refs[pid] = db.collection('products').doc(pid);
          const ps = await tx.get(refs[pid]);
          stocks[pid] = ps.exists && ps.data().stock ? ps.data().stock : null;
        }
        const r = XS.applyStock(stocks, o.items || [], direction);
        if (!r.ok) throw new Error('المخزون لا يكفي: ' + r.shortages.map((s) => `${s.name} مقاس ${s.size} (المطلوب ${s.need}، المتوفر ${s.have})`).join('، '));
        ids.forEach((pid) => { if (r.stocks[pid]) tx.update(refs[pid], { stock: r.stocks[pid] }); });
        update.stockApplied = direction < 0;
      }
      tx.update(ref, update);
    });
    showToast('صارت الطلبية: ' + XS.STATUSES[to]);
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
}

// ── TABS ──
function showTab(id, btn) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
}

// ── TOAST ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── START ──
document.getElementById('f-sizes').addEventListener('input', () => renderStockInputs());
renderStockInputs({});
if (sessionStorage.getItem('xshoes_authed') === '1') showApp();
