const $ = id => document.getElementById(id);
const toggle = (el, show) => el.style.display = show ? '' : 'none';

const CLOUD_FUNCTION_URL = 'https://us-central1-kauara1.cloudfunctions.net/getProducts';

const loadingEl = $('loading'), errorEl = $('error'), productsEl = $('products'), productCountEl = $('product-count');
const refreshBtn = $('refresh-btn'), modalEl = $('variant-modal'), closeBtn = modalEl.querySelector('.close-modal');
const confirmBtn = $('confirm-variant'), variantSelectionEl = $('variant-selection'), selectedColorsEl = $('selected-colors');
const canvas = $('flatlay-canvas'), ctx = canvas.getContext('2d');

let products = [], selectedProduct, selectedColors = [], baseImage = new Image(), loading = false;
let hoverTimeout = null;

const escapeHtml = t => { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; };

// Product type classification
const TWO_SIDED_PRODUCTS = [71, 146]; // tshirts, hoodies

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
    errorEl.textContent = `Failed to load products: ${e.message}`;
    toggle(errorEl, true);
  } finally {
    toggle(loadingEl, false);
    loading = false;
  }
}

// Render product cards
function renderProducts() {
  productsEl.innerHTML = products.map(p => {
    const productType = TWO_SIDED_PRODUCTS.includes(p.id) ? 'two-sided' : 'one-sided';
    const typeBadge = productType === 'two-sided' ? '<span class="product-type-badge">Front & Back</span>' : '<span class="product-type-badge">Single Side</span>';
    
    return `
    <div class="product-card" data-id="${p.id}" data-type="${productType}">
      <img src="${p.image}" alt="${escapeHtml(p.title)}" class="product-image">
      <div class="product-title">${escapeHtml(p.title)}</div>
      <div class="product-info">
        ${escapeHtml(p.type_name)} • ${p.variant_count} variants
        ${typeBadge}
      </div>
    </div>`;
  }).join('');
}

// Load overlay image
function loadBaseOverlay(productId) {
  return new Promise((resolve, reject) => {
    baseImage.onload = () => {
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      resolve();
    };
    baseImage.onerror = reject;
    baseImage.src = `images/flatlays/${productId}-base-front.png`;
  });
}

// Draw shirt with selected color
function renderShirtColor(hex) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
}

// Show modal with variants
function showVariantModal(product) {
  selectedProduct = product;
  selectedColors = [];
  confirmBtn.disabled = true;
  
  // Update modal title with product type info
  const productType = TWO_SIDED_PRODUCTS.includes(product.id) ? 'two-sided' : 'one-sided';
  const typeInfo = productType === 'two-sided' ? '(Front & Back Printing)' : '(Single Side Printing)';
  
  modalEl.querySelector('h3').textContent = `Choose colors for ${escapeHtml(product.title)} ${typeInfo}`;
  
  loadBaseOverlay(product.id).then(() => renderShirtColor('#ffffff')); // default white

  // FIX: Handle variants with missing color property
  const colors = new Set();
  product.variants.forEach(v => {
    const color = v.color || 'N/A'; // Default to 'N/A' if color is missing
    colors.add(color);
  });
  
  // Always include white as an option
  colors.add('White');
  const colorArray = [...colors];

  variantSelectionEl.innerHTML = `
    <div class="variant-section">
      <div class="section-title">Available Colors</div>
      <div class="variant-selection-grid" data-type="color">
        ${colorArray.map(c => {
          const v = product.variants.find(vv => (vv.color || 'N/A') === c);
          const hex = v?.color_code || (c.toLowerCase() === 'white' ? '#ffffff' : '#cccccc');
          return `<div class="variant-option" 
                    data-color="${escapeHtml(c)}" 
                    data-hex="${hex}"
                    data-action="hoverColor"
                    data-color="${hex}">
                    <div class="color-dot" style="background:${hex}"></div>
                    <div>${escapeHtml(c)}</div>
                  </div>`;
        }).join('')}
      </div>
    </div>`;

  updateSelectedColors();
  modalEl.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

// Handle color hover with delay
function handleColorHover(hex) {
  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    renderShirtColor(hex);
  }, 200);
}

function handleColorHoverEnd() {
  clearTimeout(hoverTimeout);
  if (selectedColors.length > 0) {
    // Show last selected color
    renderShirtColor(selectedColors[selectedColors.length - 1].hex);
  } else {
    // Show default white
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
  `).join('') || '<div style="color:#999;font-size:0.9rem">No colors selected yet</div>';

  confirmBtn.disabled = selectedColors.length === 0;
}

// Add color to selection
function addSelectedColor(colorName, hex) {
  if (!selectedColors.some(c => c.name === colorName)) {
    selectedColors.push({ name: colorName, hex });
    updateSelectedColors();
    renderShirtColor(hex);
  }
}

// create art button
const createArtBtn = $('create-art-btn');

// Add this event listener with the others
createArtBtn.addEventListener('click', () => {
  // Get Firestore user ID
  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
  
  if (!firestoreUserId) {
    alert('Please log in to create art');
    window.location.href = 'inicio.html';
    return;
  }
  
  // Store that we're in art creation mode
  sessionStorage.setItem('creationMode', 'art');
  window.location.href = 'canvas.html';
});

// Remove color from selection
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

// Event listeners
productsEl.addEventListener('click', e => {
  const card = e.target.closest('.product-card');
  if (card) showVariantModal(products.find(p => p.id == card.dataset.id));
});

variantSelectionEl.addEventListener('click', e => {
  const opt = e.target.closest('.variant-option');
  if (!opt) return;
  
  const colorName = opt.dataset.color;
  const hex = opt.dataset.hex;
  
  if (opt.classList.contains('selected')) {
    // Deselect color
    opt.classList.remove('selected');
    const index = selectedColors.findIndex(c => c.name === colorName);
    if (index !== -1) {
      removeSelectedColor(index);
    }
  } else {
    // Select color
    opt.classList.add('selected');
    addSelectedColor(colorName, hex);
  }
});

// SIMPLIFIED CONFIRM BUTTON - ONLY FIRESTORE USER ID
confirmBtn.addEventListener('click', () => {
    if (!selectedProduct || selectedColors.length === 0) return;
    
    // Clear art mode when selecting a product
    sessionStorage.removeItem('creationMode');
    
    // Find ALL variants for all selected colors (not just one per color)
    const variants = selectedColors.flatMap(color => {
        return selectedProduct.variants.filter(v => (v.color||'N/A') === color.name);
    });

    // Get Firestore user ID from session storage
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                           sessionStorage.getItem('currentFirestoreUserId');
    
    console.log("Firestore User ID for product creation:", firestoreUserId);
    console.log("Selected variants count:", variants.length);
    console.log("All selected variants:", variants);
    
    if (!firestoreUserId) {
        alert('User information not found. Please log in again.');
        window.location.href = 'inicio.html';
        return;
    }
    
    // Store product and variant data
    sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
    sessionStorage.setItem('selectedVariants', JSON.stringify(variants));
    
    // Store product type for canvas.js to use
    const productType = TWO_SIDED_PRODUCTS.includes(selectedProduct.id) ? 'two-sided' : 'one-sided';
    sessionStorage.setItem('productType', productType);
    console.log("Product type stored:", productType, "for product ID:", selectedProduct.id);
    
    // Store ONLY the Firestore user ID (both keys for compatibility)
    sessionStorage.setItem('designerFirestoreUserId', firestoreUserId);
    sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);
    
    console.log("Navigating to canvas with Firestore User ID:", firestoreUserId);
    console.log("Product details:", {
        productId: selectedProduct.id,
        productName: selectedProduct.title,
        productType: productType,
        variantsCount: variants.length,
        selectedColors: selectedColors.map(c => c.name),
        // Log size distribution
        sizeDistribution: variants.reduce((acc, v) => {
            acc[v.size] = (acc[v.size] || 0) + 1;
            return acc;
        }, {})
    });
    
    closeModal();
    window.location.href = 'canvas.html';
});

//show user id
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

// Expose functions to global scope for HTML event handlers
window.handleColorHover = handleColorHover;
window.handleColorHoverEnd = handleColorHoverEnd;
window.removeSelectedColor = removeSelectedColor;

// Add CSS for product type badges
const style = document.createElement('style');
style.textContent = `
  .product-type-badge {
    display: inline-block;
    padding: 2px 6px;
    margin-left: 8px;
    font-size: 0.7rem;
    background: #e0e7ff;
    color: #3b82f6;
    border-radius: 4px;
    font-weight: 500;
  }
  
  .product-card {
    position: relative;
  }
  
  .product-info {
    font-size: 0.9rem;
    color: #666;
    margin-top: 4px;
  }
`;
document.head.appendChild(style);