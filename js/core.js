/*
 * X Shoes — منطق المتجر المشترك بين واجهة الزبائن ولوحة التحكم (بلا اعتماد على المتصفح أو Firebase).
 * يعمل كسكربت عادي (window.XS) وكوحدة Node للاختبارات.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PASSWORD = 'xshoes2026';
  const PBKDF2_ITERATIONS = 150000;
  const MAX_QTY_PER_LINE = 10;

  const STATUSES = { new: 'جديدة', confirmed: 'مؤكدة', shipped: 'مشحونة', delivered: 'مسلّمة', cancelled: 'ملغاة' };
  const TRANSITIONS = {
    new: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  };

  const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function num(v) {
    const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[٠-٩]/g, (d) => AR_DIGITS[d]));
    return Number.isFinite(n) ? n : 0;
  }

  // ── المخزون: product.stock = { 'مقاس': عدد } — غيابه يعني منتجاً بلا تتبّع (غير محدود)
  function tracked(p) {
    return !!(p && p.stock && typeof p.stock === 'object');
  }
  function stockOf(p, size) {
    if (!tracked(p)) return null;
    return Math.max(0, parseInt(p.stock[size], 10) || 0);
  }
  function sizeAvailable(p, size) {
    const s = stockOf(p, size);
    return s === null || s > 0;
  }
  function isSoldOut(p) {
    if (!tracked(p)) return false;
    const sizes = (p.sizes && p.sizes.length ? p.sizes : Object.keys(p.stock));
    return sizes.every((s) => stockOf(p, s) === 0);
  }

  // ── السلة: أسطر { id, name, brand, price, showPrice, size, image, qty }
  function normalizeCart(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((it) => {
      if (!it || !it.id || !it.size) return;
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const same = out.find((x) => x.id === it.id && String(x.size) === String(it.size));
      if (same) same.qty += qty;
      else out.push({ ...it, size: String(it.size), qty });
    });
    return out;
  }

  function cartAdd(cart, p, size, qty) {
    const items = normalizeCart(cart).map((x) => ({ ...x }));
    qty = Math.max(1, parseInt(qty, 10) || 1);
    if (!size) return { ok: false, cart: items, reason: 'اختر المقاس أولاً' };
    size = String(size);
    const line = items.find((x) => x.id === p.id && x.size === size);
    const want = (line ? line.qty : 0) + qty;
    const have = stockOf(p, size);
    if (have !== null && want > have) {
      return { ok: false, cart: items, reason: have === 0 ? 'هذا المقاس غير متوفر' : `المتوفر من هذا المقاس ${have} فقط` };
    }
    if (want > MAX_QTY_PER_LINE) return { ok: false, cart: items, reason: `الحد الأقصى ${MAX_QTY_PER_LINE} قطع لكل مقاس` };
    if (line) line.qty = want;
    else items.push({ id: p.id, name: p.name, brand: p.brand || '', price: p.price || '', showPrice: !!p.showPrice, size, image: p.thumb || (p.images && p.images[0]) || '', qty });
    return { ok: true, cart: items };
  }

  function cartCount(cart) {
    return normalizeCart(cart).reduce((s, x) => s + x.qty, 0);
  }

  function linePrice(it) {
    return it.showPrice && num(it.price) > 0 ? num(it.price) : 0;
  }

  function cartTotal(cart) {
    return normalizeCart(cart).reduce((s, x) => s + linePrice(x) * x.qty, 0);
  }

  // ── الزبون والطلبية
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/[٠-٩]/g, (c) => AR_DIGITS[c]).replace(/\D+/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('2180')) d = '218' + d.slice(4);
    if (d.startsWith('0')) d = '218' + d.slice(1);
    if (!d.startsWith('218')) d = '218' + d;
    return /^2189[1-6]\d{7}$/.test(d) ? d : null;
  }

  function validateCustomer(c) {
    c = c || {};
    const e = {};
    const t = (v) => String(v || '').trim();
    if (!t(c.name) || t(c.name).length > 80) e.name = 'اكتب الاسم';
    if (!normalizePhone(c.phone)) e.phone = 'رقم هاتف ليبي صحيح (09xxxxxxxx)';
    if (!t(c.city) || t(c.city).length > 60) e.city = 'اكتب المدينة';
    if (!t(c.address) || t(c.address).length > 200) e.address = 'اكتب العنوان';
    if (t(c.note).length > 300) e.note = 'الملاحظة طويلة';
    return e;
  }

  function orderCode(date, rand) {
    const d = date || new Date();
    const r = rand || Math.random;
    const p2 = (n) => String(n).padStart(2, '0');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let tail = '';
    for (let i = 0; i < 4; i++) tail += chars[Math.floor(r() * chars.length) % chars.length];
    return `XS-${p2(d.getUTCFullYear() % 100)}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${tail}`;
  }

  function buildOrder(cart, customer, date, rand) {
    const items = normalizeCart(cart);
    if (!items.length) throw new Error('السلة فارغة');
    const errors = validateCustomer(customer);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    const t = (v) => String(v || '').trim();
    return {
      code: orderCode(date, rand),
      status: 'new',
      stockApplied: false,
      customer: { name: t(customer.name), phone: normalizePhone(customer.phone), city: t(customer.city), address: t(customer.address), note: t(customer.note) },
      items: items.map((x) => ({ productId: x.id, name: String(x.name || ''), brand: String(x.brand || ''), size: x.size, qty: x.qty, price: linePrice(x) })),
      total: cartTotal(items),
    };
  }

  function orderMessage(o) {
    const lines = [`مرحباً، طلبية جديدة رقم ${o.code}`, ''];
    o.items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.name}${it.brand ? ' (' + it.brand + ')' : ''} — مقاس ${it.size} × ${it.qty}${it.price ? ' — ' + it.price * it.qty + ' د.ل' : ''}`);
    });
    if (o.total) lines.push('', `المجموع: ${o.total} د.ل`);
    lines.push('', `الاسم: ${o.customer.name}`, `الهاتف: 0${String(o.customer.phone).slice(3)}`, `المدينة: ${o.customer.city}`, `العنوان: ${o.customer.address}`);
    if (o.customer.note) lines.push(`ملاحظة: ${o.customer.note}`);
    return lines.join('\n');
  }

  // ── تطبيق المخزون على أسطر طلبية: direction = -1 (تأكيد) أو +1 (إلغاء بعد التأكيد)
  function applyStock(stocks, items, direction) {
    const out = {};
    Object.keys(stocks).forEach((k) => { out[k] = stocks[k] ? { ...stocks[k] } : stocks[k]; });
    const need = {};
    items.forEach((it) => {
      const key = it.productId + '|' + it.size;
      need[key] = need[key] || { productId: it.productId, name: it.name, size: String(it.size), qty: 0 };
      need[key].qty += Math.max(1, parseInt(it.qty, 10) || 1);
    });
    const shortages = [];
    Object.values(need).forEach((n) => {
      const st = out[n.productId];
      if (!st) return;   // منتج بلا تتبّع أو محذوف
      const have = Math.max(0, parseInt(st[n.size], 10) || 0);
      if (direction < 0 && have < n.qty) shortages.push({ name: n.name, size: n.size, need: n.qty, have });
      st[n.size] = have + direction * n.qty;
    });
    return shortages.length ? { ok: false, shortages, stocks } : { ok: true, stocks: out };
  }

  function canTransition(from, to) {
    return (TRANSITIONS[from] || []).includes(to);
  }

  // ── كلمة مرور لوحة التحكم (PBKDF2-SHA256 عبر WebCrypto)
  function toHex(buf) {
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    (globalThis.crypto || self.crypto).getRandomValues(a);
    return toHex(a);
  }
  async function hashPassword(password, salt, iterations) {
    const subtle = (globalThis.crypto || self.crypto).subtle;
    const enc = new TextEncoder();
    const key = await subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
    return toHex(bits);
  }
  async function makePasswordRecord(password, salt) {
    salt = salt || randomSalt();
    return { salt, iterations: PBKDF2_ITERATIONS, hash: await hashPassword(password, salt, PBKDF2_ITERATIONS) };
  }
  async function verifyPassword(password, rec) {
    if (!rec || !rec.hash) return String(password) === DEFAULT_PASSWORD;
    const h = await hashPassword(password, rec.salt, rec.iterations || PBKDF2_ITERATIONS);
    return h === rec.hash;
  }

  return {
    STATUSES, TRANSITIONS, MAX_QTY_PER_LINE, DEFAULT_PASSWORD,
    esc, num, stockOf, sizeAvailable, isSoldOut,
    normalizeCart, cartAdd, cartCount, cartTotal, linePrice,
    normalizePhone, validateCustomer, orderCode, buildOrder, orderMessage,
    applyStock, canTransition, makePasswordRecord, verifyPassword,
  };
});
