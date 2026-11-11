// X Shoes — واجهة الزبائن: المنتجات، المخزون، السلة، والطلبيات (تعتمد على js/core.js)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const esc = XS.esc;

// ── STATE ──
let products = [];
let cart = loadCart();
let currentProduct = null;
let currentSize = null;
let currentColor = null;
const DEFAULT_SIZES = ['41', '42', '43', '44', '45'];
let storeSettings = { phone: '0920007485', showPrices: true };

function loadCart() {
  try { return XS.normalizeCart(JSON.parse(sessionStorage.getItem('xshoes_cart') || '[]')); } catch (e) { return []; }
}
function saveCart() {
  try { sessionStorage.setItem('xshoes_cart', JSON.stringify(cart)); } catch (e) { console.warn('sessionStorage unavailable — cart lives in memory only'); }
}
function storePhone() { return '218' + String(storeSettings.phone || '0920007485').replace(/^0/, ''); }
function showPrice(p) { return storeSettings.showPrices !== false && p.showPrice && p.price; }

// ── SETTINGS ──
async function loadSettings() {
  try {
    const doc = await db.collection('settings').doc('store').get();
    if (doc.exists) { storeSettings = { ...storeSettings, ...doc.data() }; applySettings(); }
  } catch (e) { console.log('Settings load error', e); }
}
function applySettings() {
  const p = storeSettings.phone || '0920007485';
  ['nav-phone', 'banner-phone', 'footer-phone'].forEach((id) => { document.getElementById(id).textContent = p; });
  document.getElementById('wa-link').href = 'https://wa.me/' + storePhone();
  document.getElementById('footer-wa').href = 'https://wa.me/' + storePhone();
}

// ── PRODUCTS (REALTIME) ──
function loadProducts() {
  db.collection('products').orderBy('createdAt', 'desc').onSnapshot((snap) => {
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProducts();
    updateHeroImgs();
    hideLoading();
    if (currentProduct) {   // تحديث المخزون في النافذة المفتوحة
      const fresh = products.find((p) => p.id === currentProduct.id);
      if (fresh) { currentProduct = fresh; renderModalColors(); renderModalSizes(); }
    }
  }, (err) => { console.error(err); hideLoading(); });
}
function hideLoading() {
  const el = document.getElementById('loading');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 500);
}
function thumbOf(p) { return p.thumb || (p.images && p.images[0]) || ''; }

const BADGES = { new: 'جديد', sale: 'تخفيض', exclusive: 'حصري' };
function renderProducts() {
  const grid = document.getElementById('products-grid');
  const empty = document.getElementById('empty-state');
  if (!products.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = products.map((p) => {
    const soldOut = XS.isSoldOut(p);
    const t = thumbOf(p);
    const img = t ? `<img src="${esc(t)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="prod-placeholder">X</div>';
    const badge = soldOut ? '<div class="prod-badge soldout">نفد</div>'
      : (p.badge ? `<div class="prod-badge ${esc(p.badge)}">${esc(BADGES[p.badge] || p.badge)}</div>` : '');
    const price = showPrice(p) ? `<div class="prod-price">${esc(p.price)}<small>د.ل</small></div>` : '<div></div>';
    const allSizes = XS.parseSizes(p.sizes);
    const sizes = allSizes.slice(0, 4).map((s) => `<div class="prod-size">${esc(s)}</div>`).join('');
    const more = allSizes.length > 4 ? `<div class="prod-size">+${allSizes.length - 4}</div>` : '';
    return `<div class="prod-card reveal${soldOut ? ' soldout' : ''}" data-id="${esc(p.id)}">
      <div class="prod-img">${img}${badge}</div>
      <div class="prod-body">
        <div class="prod-brand">${esc(p.brand || 'X Shoes')}</div>
        <div class="prod-name">${esc(p.name)}</div>
        ${XS.hasColors(p) ? `<div class="prod-colors">${XS.colorsOf(p).map((c) => `<span class="swatch" style="--c:${esc(c.hex || '#999')}" title="${esc(c.name)}"></span>`).join('')}</div>` : ''}
        <div class="prod-desc">${esc(p.desc || 'أحذية فاخرة بتصميم عصري')}</div>
        <div class="prod-sizes">${sizes}${more}</div>
        <div class="prod-footer">${price}<button class="prod-add" aria-label="اختر المقاس وأضف للسلة">+</button></div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.prod-card').forEach((card) => card.addEventListener('click', () => openModal(card.dataset.id)));
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}

function updateHeroImgs() {
  const imgs = products.filter((p) => thumbOf(p)).slice(0, 4);
  if (!imgs.length) return;
  const cells = document.querySelectorAll('#hero-imgs .hero-img-cell');
  imgs.forEach((p, i) => {
    if (cells[i]) cells[i].innerHTML = `<img src="${esc(thumbOf(p))}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover">`;
  });
}

// ── MODAL + GALLERY ──
async function loadGallery(p) {
  if (p.imageCount > 0) {   // الصور الكاملة في مستندات منفصلة — تُحمَّل عند الفتح فقط
    try {
      const snap = await db.collection('products').doc(p.id).collection('images').orderBy('i').get();
      const list = snap.docs.map((d) => d.data().data).filter(Boolean);
      if (list.length) return list;
    } catch (e) { console.warn('gallery load error', e); }
  }
  return (p.images && p.images.length) ? p.images : (p.thumb ? [p.thumb] : []);
}

function setModalImage(src) {
  const side = document.getElementById('modal-img-side');
  const ph = document.getElementById('modal-placeholder');
  let main = side.querySelector('img.main');
  if (!src) { if (main) main.remove(); ph.style.display = 'flex'; return; }
  if (!main) { main = document.createElement('img'); main.className = 'main'; main.style.cssText = 'width:100%;height:100%;object-fit:cover'; side.insertBefore(main, ph); }
  main.src = src;
  ph.style.display = 'none';
}

async function openModal(id) {
  currentProduct = products.find((p) => p.id === id);
  if (!currentProduct) return;
  currentSize = null;
  currentColor = null;
  const p = currentProduct;
  document.getElementById('modal-brand').textContent = p.brand || 'X Shoes';
  document.getElementById('modal-name').textContent = p.name;
  document.getElementById('modal-desc').textContent = p.desc || 'أحذية فاخرة بتصميم عصري ومريح';
  document.getElementById('modal-price').textContent = showPrice(p) ? p.price + ' د.ل' : '';
  const firstColor = XS.colorsOf(p).find((c) => XS.colorAvailable(p, c.name));
  currentColor = firstColor ? firstColor.name : null;
  renderModalColors();
  renderModalSizes();

  const side = document.getElementById('modal-img-side');
  side.querySelectorAll('.modal-thumbs').forEach((el) => el.remove());
  setModalImage(thumbOf(p));
  document.getElementById('modal').classList.add('open');
  document.getElementById('overlay').classList.add('show');

  const gallery = await loadGallery(p);
  if (currentProduct !== p) return;
  setModalImage(gallery[0] || '');
  if (gallery.length > 1) {
    const strip = document.createElement('div');
    strip.className = 'modal-thumbs';
    gallery.forEach((src, i) => {
      const t = document.createElement('img');
      t.src = src;
      if (i === 0) t.classList.add('active');
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        strip.querySelectorAll('img').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        setModalImage(src);
      });
      strip.appendChild(t);
    });
    side.appendChild(strip);
  }
}

function renderModalSizes() {
  const p = currentProduct;
  const parsed = XS.parseSizes(p.sizes);
  const sizes = parsed.length ? parsed : DEFAULT_SIZES;
  const box = document.getElementById('modal-sizes');
  box.innerHTML = '';
  sizes.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'size-btn' + (String(s) === currentSize ? ' active' : '');
    b.textContent = s;
    if (!XS.sizeAvailable(p, s, currentColor)) { b.disabled = true; b.title = 'غير متوفر'; }
    b.addEventListener('click', () => selectSize(String(s)));
    box.appendChild(b);
  });
  updateStockNote();
}

function renderModalColors() {
  const p = currentProduct;
  const wrap = document.getElementById('modal-colors-wrap');
  const box = document.getElementById('modal-colors');
  const colors = XS.colorsOf(p);
  wrap.style.display = colors.length ? 'block' : 'none';
  box.innerHTML = '';
  colors.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'color-btn' + (c.name === currentColor ? ' active' : '');
    b.style.setProperty('--c', c.hex || '#999');
    b.innerHTML = `<span class="swatch"></span>${esc(c.name)}`;
    if (!XS.colorAvailable(p, c.name)) { b.disabled = true; b.title = 'غير متوفر'; }
    b.addEventListener('click', () => {
      currentColor = c.name;
      if (currentSize && !XS.sizeAvailable(p, currentSize, currentColor)) currentSize = null;
      renderModalColors();
      renderModalSizes();
    });
    box.appendChild(b);
  });
  document.getElementById('modal-color-name').textContent = currentColor || '';
}

function selectSize(size) {
  currentSize = size;
  document.querySelectorAll('#modal-sizes .size-btn').forEach((b) => b.classList.toggle('active', b.textContent === size));
  updateStockNote();
}

function updateStockNote() {
  const p = currentProduct;
  const note = document.getElementById('modal-stock-note');
  if (XS.isSoldOut(p)) { note.textContent = 'نفد هذا المنتج حالياً'; return; }
  const left = currentSize ? XS.stockOf(p, currentSize, currentColor) : null;
  note.textContent = left !== null && left > 0 && left <= 3 ? `باقي ${left} فقط من هذا المقاس` : '';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  currentProduct = null;
}

// ── CART ──
function addToCartFromModal() {
  if (!currentProduct) return;
  const r = XS.cartAdd(cart, currentProduct, currentSize, 1, currentColor);
  if (!r.ok) { showToast(r.reason); return; }
  const p = currentProduct;
  const size = currentSize + (currentColor ? ' ' + currentColor : '');
  cart = r.cart;
  saveCart();
  updateCartCount();
  closeModal();
  setTimeout(() => showToast(`أضفنا ${p.name} مقاس ${size} للسلة`), 150);
}

function changeQty(i, delta) {
  const line = cart[i];
  if (!line) return;
  if (delta < 0) {
    line.qty -= 1;
    if (line.qty < 1) cart.splice(i, 1);
  } else {
    const p = products.find((x) => x.id === line.id) || { id: line.id };
    const r = XS.cartAdd(cart, p, line.size, 1, line.color);
    if (!r.ok) { showToast(r.reason); return; }
    cart = r.cart;
  }
  saveCart(); updateCartCount(); renderCart();
}

function updateCartCount() {
  const el = document.getElementById('cart-count');
  el.textContent = XS.cartCount(cart);
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function openCart() {
  renderCart();
  document.getElementById('cart-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closeCart() {
  document.getElementById('cart-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

function renderCart() {
  const el = document.getElementById('cart-items');
  const footer = document.getElementById('cart-footer');
  const checkoutOpen = document.getElementById('checkout').classList.contains('show');
  if (!cart.length) {
    if (!el.querySelector('.co-done')) el.innerHTML = '<div class="cart-empty"><p>السلة فارغة</p></div>';
    footer.style.display = 'none';
    closeCheckout();
    return;
  }
  footer.style.display = checkoutOpen ? 'none' : 'block';
  el.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      ${item.image ? `<img src="${esc(item.image)}" alt="">` : '<div class="cart-item-placeholder">X</div>'}
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(item.name)}</div>
        <div class="cart-item-size">${item.color ? 'اللون ' + esc(item.color) + '، ' : ''}المقاس ${esc(item.size)}</div>
        <div class="cart-item-price">${XS.linePrice(item) ? XS.linePrice(item) * item.qty + ' د.ل' : ''}</div>
        <div class="qty-ctl"><button onclick="changeQty(${i},-1)">−</button><span>${item.qty}</span><button onclick="changeQty(${i},1)">+</button></div>
      </div>
      <button class="cart-item-del" onclick="removeFromCart(${i})">✕</button>
    </div>`).join('');
  const total = XS.cartTotal(cart);
  document.getElementById('cart-total').textContent = total > 0 ? total.toFixed(0) + ' د.ل' : '—';
}

function removeFromCart(i) { cart.splice(i, 1); saveCart(); updateCartCount(); renderCart(); }
function clearCart() { cart = []; saveCart(); updateCartCount(); renderCart(); showToast('فرّغنا السلة'); }

// ── CHECKOUT ──
function openCheckout() {
  if (!cart.length) return;
  document.getElementById('checkout').classList.add('show');
  document.getElementById('cart-footer').style.display = 'none';
  document.getElementById('co-name').focus();
}
function closeCheckout() {
  document.getElementById('checkout').classList.remove('show');
  if (cart.length) document.getElementById('cart-footer').style.display = 'block';
}

let submitting = false;
async function submitOrder() {
  if (submitting) return;
  const customer = {};
  ['name', 'phone', 'city', 'address', 'note'].forEach((k) => { customer[k] = document.getElementById('co-' + k).value; });
  const errors = XS.validateCustomer(customer);
  ['name', 'phone', 'city', 'address', 'note'].forEach((k) => { document.getElementById('err-' + k).textContent = errors[k] || ''; });
  if (Object.keys(errors).length) return;

  // تحقق أخير من المخزون الحالي
  for (const line of cart) {
    const p = products.find((x) => x.id === line.id);
    if (p) {
      const have = XS.stockOf(p, line.size, line.color);
      if (have !== null && have < line.qty) { showToast(`${line.name} مقاس ${line.size}: المتوفر ${have} فقط — عدّل الكمية`); return; }
    }
  }

  const order = XS.buildOrder(cart, customer);
  const btn = document.getElementById('co-submit');
  submitting = true;
  btn.disabled = true; btn.textContent = 'جاري الإرسال…';
  const waWin = window.open('', '_blank');   // تُفتح الآن حتى لا يمنعها المتصفح بعد الانتظار
  let saved = true;
  try {
    await db.collection('orders').add({
      ...order,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      history: [{ status: 'new', at: Date.now() }],
    });
  } catch (e) {
    console.error('order save error', e);
    saved = false;   // لا نخسر الطلبية: تُرسل عبر واتساب على أي حال
  }
  const url = `https://wa.me/${storePhone()}?text=${encodeURIComponent(XS.orderMessage(order))}`;
  if (waWin) waWin.location.href = url; else window.location.href = url;

  cart = []; saveCart(); updateCartCount();
  document.getElementById('checkout').classList.remove('show');
  document.getElementById('cart-footer').style.display = 'none';
  document.getElementById('cart-items').innerHTML = `<div class="co-done"><div style="font-size:2.5rem">✅</div>
    <p>وصلنا طلبك${saved ? '' : ' على واتساب'}. رقمه:</p><div class="code">${esc(order.code)}</div>
    <p style="font-size:0.78rem;color:rgba(255,255,255,0.4)">نتواصل معك على هذا الرقم لتأكيد الطلبية.</p></div>`;
  ['name', 'phone', 'address', 'note'].forEach((k) => { document.getElementById('co-' + k).value = ''; });
  btn.disabled = false; btn.textContent = 'أرسل الطلب على واتساب';
  submitting = false;
}

function orderNowWA() {
  if (!currentProduct) return;
  const p = currentProduct;
  const msg = `مرحباً، أريد الاستفسار عن:\n${p.name} (${p.brand || ''})${currentColor ? '\nاللون: ' + currentColor : ''}\nالمقاس: ${currentSize || 'غير محدد'}`;
  window.open(`https://wa.me/${storePhone()}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── HELPERS ──
function closeAll() {
  closeModal(); closeCart();
  document.getElementById('overlay').classList.remove('show');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => { if (e.isIntersecting) setTimeout(() => e.target.classList.add('visible'), i * 60); });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
window.addEventListener('scroll', () => {
  document.getElementById('main-nav').classList.toggle('scrolled', window.scrollY > 60);
});

// ── INIT ──
updateCartCount();
loadSettings();
loadProducts();
