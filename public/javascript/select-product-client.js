const $ = id => document.getElementById(id);
const toggle = (el, show) => {
    if (!el) return;
    // Elements using the 'hidden' CSS class (art container)
    if (el.classList.contains('hidden') || el.id === 'selected-art-info') {
        show ? el.classList.remove('hidden') : el.classList.add('hidden');
    } else {
        // Elements using inline style.display (loading, error, description)
        el.style.display = show ? '' : 'none';
    }
};

const CLOUD_FUNCTION_URL = 'https://us-central1-kauara1.cloudfunctions.net/getProducts';

const loadingEl = $('loading'), errorEl = $('error'), productsEl = $('products'), productCountEl = $('product-count');
const refreshBtn = $('refresh-btn'), modalEl = $('variant-modal'), closeBtn = modalEl.querySelector('.close-modal');
const confirmBtn = $('confirm-variant'), variantSelectionEl = $('variant-selection'), selectedColorsEl = $('selected-colors');
const canvas = $('flatlay-canvas'), ctx = canvas.getContext('2d');

// Art display elements
const artInfoContainer = $('selected-art-info');
const artImageEl = $('art-image');
const artNameEl = $('art-name');
const artPriceEl = $('art-price');
const artDescriptionEl = $('art-description');

let products = [], selectedProduct, selectedColors = [], baseImage = new Image(), loading = false;
let hoverTimeout = null;

// Product type classification - same as original
const TWO_SIDED_PRODUCTS = [71, 146, 509]; // tshirts, hoodies, men's fitted

// Get selected art from URL parameters or session storage
let selectedArt = null;

const escapeHtml = t => { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; };

// Initialize selected art on page load - FIXED: More robust initialization
function initializeSelectedArt() {
    console.log("Initializing selected art...");
    
    const urlParams = new URLSearchParams(window.location.search);
    const artId = urlParams.get('artId');
    
    if (artId) {
        console.log("Art ID from URL:", artId);
        fetchArtData(artId);
    } else {
        const storedArt = sessionStorage.getItem('selectedArt');
        if (storedArt) {
            try {
                selectedArt = JSON.parse(storedArt);
                console.log("Selected art from session:", selectedArt);
                displaySelectedArt();
            } catch (e) {
                console.error("Error parsing stored art:", e);
                redirectToSharedArts();
            }
        } else {
            console.log("No art selected, redirecting to shared arts");
            redirectToSharedArts();
        }
    }
}

function redirectToSharedArts() {
    alert('No art selected. Please choose an art first.');
    window.location.href = 'inicio.html';
}

// Fetch art data from Firestore using artId - FIXED: Better error handling
async function fetchArtData(artId) {
    try {
        console.log("Attempting to fetch art data for ID:", artId);
        
        const firebaseReady = await waitForFirebase();
        
        if (!firebaseReady) {
            console.warn("Firebase not available, trying alternative methods");
            const fallbackData = await tryGetArtFromAlternateSources(artId);
            if (fallbackData) {
                selectedArt = fallbackData;
                sessionStorage.setItem('selectedArt', JSON.stringify(selectedArt));
                displaySelectedArt();
                return;
            }
            throw new Error('Firebase not available and no fallback data found');
        }
        
        console.log("Firebase initialized, fetching art document...");
        
        const db = firebase.firestore();
        const artDoc = await db.collection('arts').doc(artId).get();
        
        if (!artDoc.exists) {
            throw new Error('Art not found in database');
        }
        
        const artData = artDoc.data();
        selectedArt = { id: artDoc.id, ...artData };
        console.log("Successfully fetched art data:", selectedArt);
        
        if (!selectedArt.downloadURL || !selectedArt.name) {
            throw new Error('Art data is incomplete');
        }
        
        sessionStorage.setItem('selectedArt', JSON.stringify(selectedArt));
        displaySelectedArt();
        
    } catch (error) {
        console.error('Error fetching art data:', error);
        
        const fallbackData = await tryGetArtFromAlternateSources(artId);
        if (fallbackData) {
            selectedArt = fallbackData;
            sessionStorage.setItem('selectedArt', JSON.stringify(selectedArt));
            displaySelectedArt();
            return;
        }
        
        alert(`Failed to load art information: ${error.message}. Please try selecting the art again.`);
        redirectToSharedArts();
    }
}

function waitForFirebase() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 50;

        const overallTimeout = setTimeout(() => {
            console.warn('Firebase initialization overall timeout');
            resolve(false);
        }, 3000);

        const checkFirebase = () => {
            attempts++;
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                console.log("Firebase is ready");
                clearTimeout(overallTimeout);
                resolve(true);
                return;
            }
            if (attempts >= maxAttempts) {
                console.warn('Firebase initialization timeout');
                clearTimeout(overallTimeout);
                resolve(false);
                return;
            }
            setTimeout(checkFirebase, 100);
        };

        checkFirebase();
    });
}

// Try to get art data from alternate sources
async function tryGetArtFromAlternateSources(artId) {
    console.log("Trying alternate sources for art data...");
    
    try {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#art=')) {
            const artDataString = decodeURIComponent(hash.substring(5));
            const artData = JSON.parse(artDataString);
            if (artData.id === artId) {
                console.log("Found art data in URL hash");
                return artData;
            }
        }
    } catch (e) {
        console.log("No valid art data in URL hash");
    }
    
    try {
        const recentArts = localStorage.getItem('recentArts');
        if (recentArts) {
            const arts = JSON.parse(recentArts);
            const matchingArt = arts.find(art => art.id === artId);
            if (matchingArt) {
                console.log("Found art data in recent arts cache");
                return matchingArt;
            }
        }
    } catch (e) {
        console.log("No valid art data in recent arts cache");
    }
    
    try {
        if (window.artManager && window.artManager.artsCache) {
            const cachedArt = window.artManager.artsCache[artId];
            if (cachedArt) {
                console.log("Found art data in shared arts cache");
                return { id: artId, ...cachedArt };
            }
        }
    } catch (e) {
        console.log("No art data in shared arts cache");
    }
    
    return null;
}

// Display selected art information - FIXED: More reliable display logic
function displaySelectedArt() {
    if (!selectedArt) {
        console.log("No art to display");
        toggle(artInfoContainer, false);
        return;
    }
    
    console.log("Displaying selected art:", selectedArt);
    
    // Show the art container
    toggle(artInfoContainer, true);
    
    // Update art information
    if (artImageEl) {
        artImageEl.src = selectedArt.downloadURL;
        artImageEl.alt = selectedArt.name || 'Selected Art';
        artImageEl.onerror = function() {
            console.error("Failed to load art image:", selectedArt.downloadURL);
            this.src = 'images/default-art.png'; // Fallback image
        };
    }
    
    if (artNameEl) {
        artNameEl.textContent = selectedArt.name || 'Untitled Art';
    }
    
    if (artPriceEl) {
        const price = selectedArt.totalPrice || selectedArt.price || 0;
        artPriceEl.textContent = `Price: R$ ${price.toFixed(2)}`;
    }
    
    if (artDescriptionEl) {
        artDescriptionEl.textContent = selectedArt.description || '';
        // Hide description element if no description
        toggle(artDescriptionEl, !!selectedArt.description);
    }
    
    console.log("Art display completed, container should be visible");
}

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

// Render product cards with one-side/two-side differentiation
function renderProducts() {
  productsEl.innerHTML = products.map(p => {
    const productType = TWO_SIDED_PRODUCTS.includes(p.id) ? 'two-sided' : 'one-sided';
    const typeBadge = productType === 'two-sided' ? 
        '<span class="product-type-badge">Front & Back</span>' : 
        '<span class="product-type-badge">Single Side</span>';
    
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

// Load overlay image - updated to handle both sides
function loadBaseOverlay(productId, side = 'front') {
  return new Promise((resolve, reject) => {
    baseImage.onload = () => {
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      resolve();
    };
    baseImage.onerror = reject;
    // Use appropriate base image based on product type
    const imageSuffix = TWO_SIDED_PRODUCTS.includes(productId) ? `-base-${side}.png` : '-base.png';
    baseImage.src = `images/flatlays/${productId}${imageSuffix}`;
  });
}

// Draw shirt with selected color
function renderShirtColor(hex) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
}

// Show modal with variants - updated to show product type info
function showVariantModal(product) {
  selectedProduct = product;
  selectedColors = [];
  confirmBtn.disabled = true;
  
  // Determine product type and update modal
  const productType = TWO_SIDED_PRODUCTS.includes(product.id) ? 'two-sided' : 'one-sided';
  const typeInfo = productType === 'two-sided' ? '(Front & Back Printing)' : '(Single Side Printing)';
  
  modalEl.querySelector('h3').textContent = `Choose a color for ${escapeHtml(product.title)} ${typeInfo}`;
  
  // Load appropriate base image
  loadBaseOverlay(product.id).then(() => renderShirtColor('#ffffff'));

  const colors = new Set(product.variants.map(v => v.color || 'N/A'));
  colors.add('White');
  const colorArray = [...colors];

  variantSelectionEl.innerHTML = `
    <div class="variant-section">
      <div class="section-title">Available Colors (select one)</div>
      <div class="variant-selection-grid" data-type="color">
        ${colorArray.map(c => {
          const v = product.variants.find(vv => (vv.color||'N/A') === c);
          const hex = v?.color_code || (c.toLowerCase() === 'white' ? '#ffffff' : '#cccccc');
          return `<div class="variant-option" 
                    data-color="${escapeHtml(c)}" 
                    data-hex="${hex}"
                    onmouseenter="handleColorHover('${hex}')"
                    onmouseleave="handleColorHoverEnd()">
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
    renderShirtColor(selectedColors[selectedColors.length - 1].hex);
  } else {
    renderShirtColor('#ffffff');
  }
}

// Update selected color display (single selection)
function updateSelectedColors() {
  selectedColorsEl.innerHTML = selectedColors.length > 0 ? `
    <div class="selected-color">
      <div class="selected-color-dot" style="background:${selectedColors[0].hex}"></div>
      <span>${escapeHtml(selectedColors[0].name)}</span>
    </div>
  ` : '<div style="color:#999;font-size:0.9rem">No color selected yet</div>';

  confirmBtn.disabled = selectedColors.length === 0;
}

// Add color to selection (max 1)
function addSelectedColor(colorName, hex) {
  if (!selectedColors.some(c => c.name === colorName)) {
    selectedColors = [{ name: colorName, hex }];
    updateSelectedColors();
    renderShirtColor(hex);
  }
}

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
    // Deselect current
    opt.classList.remove('selected');
    selectedColors = [];
    updateSelectedColors();
    renderShirtColor('#ffffff');
  } else {
    // Deselect any previously selected color first
    document.querySelectorAll('#variant-selection .variant-option.selected')
      .forEach(el => el.classList.remove('selected'));
    opt.classList.add('selected');
    addSelectedColor(colorName, hex);
  }
});
// Enhanced confirm button with proper art handling
confirmBtn.addEventListener('click', () => {
    if (!selectedProduct || selectedColors.length === 0) {
        alert('Please select a color variant.');
        return;
    }
    
    if (!selectedArt) {
        alert('No art selected. Please go back and select an art first.');
        window.location.href = 'inicio.html';
        return;
    }
    
    // Find variants for all selected colors
    const variants = [];
    selectedColors.forEach(color => {
        const colorVariants = selectedProduct.variants.filter(v => (v.color||'N/A') === color.name);
        variants.push(...colorVariants);
    });
    const validVariants = variants.filter(v => v.id);

    if (validVariants.length === 0) {
        alert('No valid variants found for selected colors.');
        return;
    }

    // Get Firestore user ID from session storage
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                           sessionStorage.getItem('currentFirestoreUserId');
    
    if (!firestoreUserId) {
        alert('User information not found. Please log in again.');
        window.location.href = 'profile.html';
        return;
    }
    
    // Store product type for canvas-client.js to use
    const productType = TWO_SIDED_PRODUCTS.includes(selectedProduct.id) ? 'two-sided' : 'one-sided';
    sessionStorage.setItem('productType', productType);
    console.log("Product type stored:", productType, "for product ID:", selectedProduct.id);
    
    // Ensure selected art is properly stored
    sessionStorage.setItem('selectedArt', JSON.stringify(selectedArt));
    
    // Store product and variant data
    sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
    sessionStorage.setItem('selectedVariants', JSON.stringify(validVariants));
    
    // Store the Firestore user ID in both locations for compatibility
    sessionStorage.setItem('designerFirestoreUserId', firestoreUserId);
    sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);
    
    console.log("Navigation data prepared:");
    console.log("- Selected Art:", selectedArt);
    console.log("- Selected Product:", selectedProduct);
    console.log("- Selected Variants:", validVariants);
    console.log("- User ID:", firestoreUserId);
    console.log("- Product Type:", productType);
    
    closeModal();
    window.location.href = 'canvas-client.html';
});

// Initialize on page load - FIXED: Better initialization flow
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Content Loaded - Starting initialization");
    
    // Check authentication first
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                           sessionStorage.getItem('currentFirestoreUserId');
    
    console.log("Checking authentication - Firestore User ID:", firestoreUserId);
    
    if (!firestoreUserId) {
        alert('Please log in to continue.');
        window.location.href = 'inicio.html';
        return;
    }
    
    console.log("User authenticated with Firestore ID:", firestoreUserId);
    
    // Initialize selected art first, then load products
    try {
        await initializeSelectedArt();
        console.log("Art initialization completed");
    } catch (error) {
        console.error("Error initializing art:", error);
    }
    
    // Load products
    loadProducts();
});

// Event listener setup
closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', e => e.target === modalEl && closeModal());
document.addEventListener('keydown', e => e.key === 'Escape' && modalEl.style.display === 'block' && closeModal());
refreshBtn.addEventListener('click', () => loadProducts());

// Expose functions to global scope for HTML event handlers
window.handleColorHover = handleColorHover;
window.handleColorHoverEnd = handleColorHoverEnd;
window.removeSelectedColor = removeSelectedColor;