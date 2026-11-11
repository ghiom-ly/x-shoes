// اختبارات منطق المتجر: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const XS = require('../js/core.js');

const shoe = (over = {}) => ({ id: 'p1', name: 'FENDI Runner', brand: 'FENDI', price: '250', showPrice: true, sizes: ['40', '41', '42'], ...over });

test('esc يمنع حقن HTML', () => {
  assert.equal(XS.esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  assert.equal(XS.esc(null), '');
  assert.equal(XS.esc(42), '42');
});

test('المخزون: منتج بلا مخزون = غير محدود، والمقاس الصفر غير متوفر', () => {
  assert.equal(XS.stockOf(shoe(), '40'), null);
  assert.equal(XS.sizeAvailable(shoe(), '40'), true);
  const p = shoe({ stock: { 40: 0, 41: 2, 42: 0 } });
  assert.equal(XS.stockOf(p, '41'), 2);
  assert.equal(XS.sizeAvailable(p, '40'), false);
  assert.equal(XS.sizeAvailable(p, '41'), true);
  assert.equal(XS.stockOf(p, '43'), 0);   // مقاس غير مسجّل في مخزون مُتتبَّع = صفر
  assert.equal(XS.isSoldOut(p), false);
  assert.equal(XS.isSoldOut(shoe({ stock: { 40: 0, 41: 0, 42: 0 } })), true);
  assert.equal(XS.isSoldOut(shoe()), false);
});

test('السلة: نفس المنتج والمقاس يزيد الكمية، ولا تتجاوز المخزون', () => {
  const p = shoe({ stock: { 40: 2, 41: 5, 42: 0 } });
  let r = XS.cartAdd([], p, '40', 1);
  assert.equal(r.ok, true);
  r = XS.cartAdd(r.cart, p, '40', 1);
  assert.equal(r.cart.length, 1);
  assert.equal(r.cart[0].qty, 2);
  const over = XS.cartAdd(r.cart, p, '40', 1);
  assert.equal(over.ok, false);
  assert.match(over.reason, /المتوفر/);
  assert.equal(over.cart[0].qty, 2);
  assert.equal(XS.cartAdd([], p, '42', 1).ok, false);
  assert.equal(XS.cartAdd([], p, '', 1).ok, false);
  r = XS.cartAdd(r.cart, p, '41', 3);
  assert.equal(XS.cartCount(r.cart), 5);
});

test('مجموع السلة يتجاهل المنتجات بدون سعر ظاهر', () => {
  const cart = [
    { id: 'a', size: '40', qty: 2, price: '250', showPrice: true },
    { id: 'b', size: '41', qty: 1, price: '100', showPrice: false },
    { id: 'c', size: '42', qty: 1, price: '', showPrice: true },
  ];
  assert.equal(XS.cartTotal(cart), 500);
  assert.equal(XS.cartTotal([]), 0);
});

test('السلة القديمة (بلا كمية) تُقرأ بكمية 1 وتُدمج', () => {
  const old = [{ id: 'p1', size: '40', name: 'x' }, { id: 'p1', size: '40', name: 'x' }];
  const c = XS.normalizeCart(old);
  assert.equal(c.length, 1);
  assert.equal(c[0].qty, 2);
  assert.deepEqual(XS.normalizeCart('garbage'), []);
});

test('هاتف ليبي: يقبل 09x وأرقام عربية و+218، ويرفض غيره', () => {
  assert.equal(XS.normalizePhone('0912345678'), '218912345678');
  assert.equal(XS.normalizePhone('٠٩٢٥٥٥٥٥٥٥'), '218925555555');
  assert.equal(XS.normalizePhone('+218 94 123 4567'), '218941234567');
  assert.equal(XS.normalizePhone('00218911111111'), '218911111111');
  assert.equal(XS.normalizePhone('12345'), null);
  assert.equal(XS.normalizePhone('0812345678'), null);
});

test('بيانات الزبون مطلوبة', () => {
  const e = XS.validateCustomer({ name: '', phone: '123', city: '', address: '' });
  assert.deepEqual(Object.keys(e).sort(), ['address', 'city', 'name', 'phone']);
  assert.deepEqual(XS.validateCustomer({ name: 'علي', phone: '0912345678', city: 'طرابلس', address: 'جنزور' }), {});
  assert.ok(XS.validateCustomer({ name: 'x'.repeat(81), phone: '0912345678', city: 'a', address: 'b' }).name);
});

test('بناء الطلبية: رقم مميز، أسطر، مجموع، حالة جديدة', () => {
  const cart = [{ id: 'p1', name: 'FENDI Runner', brand: 'FENDI', size: '41', qty: 2, price: '250', showPrice: true, image: 'data:xxx' }];
  const o = XS.buildOrder(cart, { name: ' علي ', phone: '0912345678', city: 'طرابلس', address: 'جنزور', note: '' }, new Date('2026-11-11T10:00:00Z'), () => 0.5);
  assert.match(o.code, /^XS-261111-[A-Z0-9]{4}$/);
  assert.equal(o.status, 'new');
  assert.equal(o.stockApplied, false);
  assert.equal(o.total, 500);
  assert.equal(o.customer.name, 'علي');
  assert.equal(o.customer.phone, '218912345678');
  assert.deepEqual(o.items, [{ productId: 'p1', name: 'FENDI Runner', brand: 'FENDI', size: '41', qty: 2, price: 250 }]);
  assert.throws(() => XS.buildOrder([], { name: 'a', phone: '0912345678', city: 'a', address: 'a' }), /السلة فارغة/);
});

test('رسالة واتساب للطلبية فيها الرقم والأسطر والمجموع', () => {
  const o = { code: 'XS-261111-ABCD', total: 500, customer: { name: 'علي', phone: '218912345678', city: 'طرابلس', address: 'جنزور', note: 'بعد العصر' },
    items: [{ name: 'FENDI Runner', brand: 'FENDI', size: '41', qty: 2, price: 250 }] };
  const m = XS.orderMessage(o);
  assert.match(m, /XS-261111-ABCD/);
  assert.match(m, /FENDI Runner/);
  assert.match(m, /مقاس 41 × 2/);
  assert.match(m, /500 د\.ل/);
  assert.match(m, /بعد العصر/);
});

test('تطبيق المخزون عند التأكيد والإرجاع عند الإلغاء', () => {
  const stocks = { p1: { 40: 3, 41: 1 }, p2: null };   // p2 بلا تتبّع
  const items = [{ productId: 'p1', name: 'A', size: '40', qty: 2 }, { productId: 'p2', name: 'B', size: '42', qty: 5 }];
  const r = XS.applyStock(stocks, items, -1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.stocks.p1, { 40: 1, 41: 1 });
  assert.equal(r.stocks.p2, null);
  assert.deepEqual(stocks.p1, { 40: 3, 41: 1 }, 'لا يعدّل الأصل');

  const short = XS.applyStock(stocks, [{ productId: 'p1', name: 'A', size: '41', qty: 2 }], -1);
  assert.equal(short.ok, false);
  assert.deepEqual(short.shortages, [{ name: 'A', size: '41', need: 2, have: 1 }]);

  assert.deepEqual(XS.applyStock(stocks, items, +1).stocks.p1, { 40: 5, 41: 1 });
});

test('انتقالات حالة الطلبية', () => {
  assert.equal(XS.canTransition('new', 'confirmed'), true);
  assert.equal(XS.canTransition('new', 'cancelled'), true);
  assert.equal(XS.canTransition('confirmed', 'shipped'), true);
  assert.equal(XS.canTransition('shipped', 'delivered'), true);
  assert.equal(XS.canTransition('delivered', 'cancelled'), false);
  assert.equal(XS.canTransition('cancelled', 'new'), false);
  assert.equal(XS.canTransition('new', 'delivered'), false);
});

test('كلمة المرور: تشفير PBKDF2 والتحقق', async () => {
  const rec = await XS.makePasswordRecord('secret123', 'a1b2c3d4e5f60718');
  assert.equal(rec.salt, 'a1b2c3d4e5f60718');
  assert.match(rec.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rec.hash, 'secret123');
  assert.equal(await XS.verifyPassword('secret123', rec), true);
  assert.equal(await XS.verifyPassword('wrong', rec), false);
  assert.equal(await XS.verifyPassword('xshoes2026', null), true, 'بدون سجل: كلمة المرور الافتراضية القديمة');
  assert.equal(await XS.verifyPassword('other', null), false);
});

test('المقاسات: تُفصل بالنقطة والفاصلة والمسافة، ونصف المقاس يبقى', () => {
  assert.deepEqual(XS.parseSizes(['40.41.42.43.44.45']), ['40', '41', '42', '43', '44', '45']);
  assert.deepEqual(XS.parseSizes('40,41، 42 43/44'), ['40', '41', '42', '43', '44']);
  assert.deepEqual(XS.parseSizes(['40', '42.5', '43']), ['40', '42.5', '43']);
  assert.deepEqual(XS.parseSizes('٤٠-٤١'), ['40', '41']);
  assert.deepEqual(XS.parseSizes(['40', '40', '']), ['40']);
  assert.deepEqual(XS.parseSizes(null), []);
});

test('المنتج القديم بمقاسات ملتصقة يُقرأ صحيحاً في المخزون', () => {
  const p = { id: 'p', sizes: ['40.41.42'], stock: { 40: 0, 41: 0, 42: 0 } };
  assert.equal(XS.isSoldOut(p), true);
});
