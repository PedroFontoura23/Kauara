const $ = id => document.getElementById(id);
const toggle = (el, show) => el.style.display = show ? '' : 'none';

// 🔁 Troca só essa URL — aponta pro novo Cloud Function da Dimona
const CLOUD_FUNCTION_URL = 'https://us-central1-kauara1.cloudfunctions.net/getDimonaProducts';

const loadingEl = $('loading'), errorEl = $('error'), productsEl = $('products'), productCountEl = $('product-count');
const refreshBtn = $('refresh-btn'), modalEl = $('variant-modal'), closeBtn = modalEl.querySelector('.close-modal');
const confirmBtn = $('confirm-variant'), variantSelectionEl = $('variant-selection'), selectedColorsEl = $('selected-colors');
const canvas = $('flatlay-canvas'), ctx = canvas.getContext('2d');

let products = [], selectedProduct, selectedColors = [], baseImage = new Image(), loading = false;
let hoverTimeout = null;

const escapeHtml = t => { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; };

sessionStorage.removeItem('creationMode');

// Load products from backend
async function loadProducts() {
  if (loading) return; loading = true;
  toggle(loadingEl, true); toggle(errorEl, false); productsEl.innerHTML = '';
  try {
    const res = await fetch(CLOUD_FUNCTION_URL);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    products = data.products || [];
    productCountEl.textContent = products.length + (data.cached ? ' (cached)' : '');
    renderProducts();
  } catch (e) {
    errorEl.textContent = `Erro ao carregar produtos: ${e.message}`;
    toggle(errorEl, true);
  } finally {
    toggle(loadingEl, false);
    loading = false;
  }
}

// Render product cards — igual ao original
function renderProducts() {
  productsEl.innerHTML = '';
  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.dataset.id = p.id;

    const img = document.createElement('img');
    img.className = 'product-image';
    img.alt = p.title;
    img.src = `images/flatlays/${p.title.replace(/^Dimona\s+/i, '')}-base-front.png`;
    img.onerror = () => { img.src = p.image; };

    const title = document.createElement('div');
    title.className = 'product-title';
    title.textContent = p.title;

    const info = document.createElement('div');
    info.className = 'product-info';
    info.textContent = `${p.type_name} • ${p.variant_count} variantes`;

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(info);
    productsEl.appendChild(card);
  });
}

// Load overlay image (flatlay)
function loadBaseOverlay(productId) {
  return new Promise((resolve, reject) => {
    baseImage.onload = () => {
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      resolve();
    };
    baseImage.onerror = () => {
      // Sem flatlay? Usa canvas em branco
      canvas.width = 400;
      canvas.height = 400;
      resolve();
    };
    baseImage.src = `images/flatlays/${productId.replace(/^Dimona\s+/i, '')}-base-front.png`;
  });
}

// Draw shirt with selected color
function renderShirtColor(hex) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (baseImage.complete && baseImage.naturalWidth > 0) {
    ctx.drawImage(baseImage, 0, 0);
  }
}

// Show modal with variants
function showVariantModal(product) {
  selectedProduct = product;
  selectedColors = [];
  confirmBtn.disabled = true;

  modalEl.querySelector('h3').textContent = `Escolha as cores — ${escapeHtml(product.title)}`;

  loadBaseOverlay(product.title).then(() => renderShirtColor('#ffffff'));

  // Cores únicas do produto Dimona
  // variants têm: { sku, color, color_code, size, price }
  const colorMap = {};
  product.variants.forEach(v => {
    if (!colorMap[v.color]) {
      colorMap[v.color] = v.color_code || '#cccccc';
    }
  });

  variantSelectionEl.innerHTML = `
    <div class="variant-section">
      <div class="section-title">Cores disponíveis</div>
      <div class="variant-selection-grid" data-type="color">
        ${Object.entries(colorMap).map(([colorName, hex]) => `
          <div class="variant-option"
               data-color="${escapeHtml(colorName)}"
               data-hex="${escapeHtml(hex)}"
               data-action="hoverColor"
               data-color="${escapeHtml(hex)}">
            <div class="color-dot" style="background:${escapeHtml(hex)};border:1px solid ${hex === '#FFFFFF' || hex === '#FAF9F6' || hex === '#FFFFF0' || hex === '#F5F0E8' ? '#ccc' : hex}"></div>
            <div>${escapeHtml(colorName)}</div>
          </div>`
        ).join('')}
      </div>
    </div>`;

  updateSelectedColors();
  modalEl.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

// Handle color hover with delay
function handleColorHover(hex) {
  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => renderShirtColor(hex), 200);
}

function handleColorHoverEnd() {
  clearTimeout(hoverTimeout);
  if (selectedColors.length > 0) {
    renderShirtColor(selectedColors[selectedColors.length - 1].hex);
  } else {
    renderShirtColor('#ffffff');
  }
}

// Update selected colors display
function updateSelectedColors() {
  selectedColorsEl.innerHTML = selectedColors.map((color, index) => `
    <div class="selected-color">
      <div class="selected-color-dot" style="background:${color.hex}"></div>
      <span>${escapeHtml(color.name)}</span>
      <span class="remove-color" data-action="removeSelectedColor" data-index="${index}">&times;</span>
    </div>
  `).join('') || '<div style="color:#999;font-size:0.9rem">Nenhuma cor selecionada</div>';

  confirmBtn.disabled = selectedColors.length === 0;
}

function addSelectedColor(colorName, hex) {
  if (!selectedColors.some(c => c.name === colorName)) {
    selectedColors.push({ name: colorName, hex });
    updateSelectedColors();
    renderShirtColor(hex);
  }
}

function removeSelectedColor(index) {
  selectedColors.splice(index, 1);
  updateSelectedColors();
  if (selectedColors.length > 0) {
    renderShirtColor(selectedColors[selectedColors.length - 1].hex);
  } else {
    renderShirtColor('#ffffff');
  }
}

function closeModal() {
  modalEl.style.display = 'none';
  document.body.style.overflow = '';
  selectedProduct = null;
  selectedColors = [];
}

// Create art button
const createArtBtn = $('create-art-btn');
createArtBtn.addEventListener('click', () => {
  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                         sessionStorage.getItem('currentFirestoreUserId');
  if (!firestoreUserId) {
    alert('Faça login para criar uma arte');
    window.location.href = 'inicio.html';
    return;
  }
  sessionStorage.setItem('creationMode', 'art');
  window.location.href = 'canvas-arte.html';
});

// Event listeners
productsEl.addEventListener('click', e => {
  const card = e.target.closest('.product-card');
  if (card) showVariantModal(products.find(p => p.id === card.dataset.id));
});

variantSelectionEl.addEventListener('click', e => {
  const opt = e.target.closest('.variant-option');
  if (!opt) return;

  const colorName = opt.dataset.color;
  const hex = opt.dataset.hex;

  if (opt.classList.contains('selected')) {
    opt.classList.remove('selected');
    const index = selectedColors.findIndex(c => c.name === colorName);
    if (index !== -1) removeSelectedColor(index);
  } else {
    opt.classList.add('selected');
    addSelectedColor(colorName, hex);
  }
});

// Confirm button
// Salva produto no sessionStorage no mesmo formato que o canvas.js já espera,
// mas agora com dimona_sku em vez de printful variant_id
confirmBtn.addEventListener('click', () => {
  if (!selectedProduct || selectedColors.length === 0) return;

  sessionStorage.removeItem('creationMode');

  // Pega todas as variantes das cores selecionadas
  // Cada entrada tem: { sku, color, color_code, size, price }
  const variants = selectedColors.flatMap(color =>
    selectedProduct.variants.filter(v => v.color === color.name)
  );

  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                         sessionStorage.getItem('currentFirestoreUserId');

  if (!firestoreUserId) {
    alert('Sessão expirada. Faça login novamente.');
    window.location.href = 'inicio.html';
    return;
  }

  // Mesmo formato do sessionStorage que o canvas.js já usa,
  // só que agora as variantes têm `sku` em vez de `variant_id`
  sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
  sessionStorage.setItem('selectedVariants', JSON.stringify(variants));
  sessionStorage.setItem('productType', 'one-sided');   // Dimona = one-sided por padrão
  sessionStorage.setItem('provider', 'dimona');          // novo campo para o canvas saber o provider
  sessionStorage.setItem('designerFirestoreUserId', firestoreUserId);
  sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);

  closeModal();
  window.location.href = 'canvas-dimona.html';
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                         sessionStorage.getItem('currentFirestoreUserId');
  if (!firestoreUserId) {
    alert('Faça login para acessar esta página');
    window.location.href = 'profile.html';
    return;
  }
  loadProducts();
});

closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', e => e.target === modalEl && closeModal());
document.addEventListener('keydown', e => e.key === 'Escape' && modalEl.style.display === 'block' && closeModal());
refreshBtn.addEventListener('click', () => loadProducts());

// Expose globals para os handlers inline do HTML
window.handleColorHover = handleColorHover;
window.handleColorHoverEnd = handleColorHoverEnd;
window.removeSelectedColor = removeSelectedColor;

// CSS extra para o badge de provider
const style = document.createElement('style');
style.textContent = `
  .product-card { position: relative; }
  .product-info { font-size: .9rem; color: #666; margin-top: 4px; }
`;
document.head.appendChild(style);