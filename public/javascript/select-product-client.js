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

// 🔁 Dimona Cloud Function — same as select-product-dimona.js
const CLOUD_FUNCTION_URL = 'https://us-central1-kauara1.cloudfunctions.net/getDimonaProducts';

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

let products = [], selectedProduct, selectedColor = null, selectedSize = null, baseImage = new Image(), loading = false;
let hoverTimeout = null;

// Dimona products are always one-sided
const TWO_SIDED_PRODUCTS = new Set([]);

// Get selected art from URL parameters or session storage
let selectedArt = null;

const escapeHtml = t => { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; };

// ─── Art initialization ────────────────────────────────────────────────────

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

async function tryGetArtFromAlternateSources(artId) {
    console.log("Trying alternate sources for art data...");

    try {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#art=')) {
            const artData = JSON.parse(decodeURIComponent(hash.substring(5)));
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

function displaySelectedArt() {
    if (!selectedArt) {
        console.log("No art to display");
        toggle(artInfoContainer, false);
        return;
    }

    console.log("Displaying selected art:", selectedArt);
    toggle(artInfoContainer, true);

    if (artImageEl) {
        artImageEl.src = selectedArt.downloadURL;
        artImageEl.alt = selectedArt.name || 'Selected Art';
        artImageEl.onerror = function() {
            console.error("Failed to load art image:", selectedArt.downloadURL);
            this.src = 'images/default-art.png';
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
        toggle(artDescriptionEl, !!selectedArt.description);
    }

    console.log("Art display completed, container should be visible");
}

// ─── Product loading ───────────────────────────────────────────────────────

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

function renderProducts() {
    productsEl.innerHTML = products.map(p => `
    <div class="product-card" data-id="${escapeHtml(p.id)}">
      <img src="images/flatlays/${escapeHtml(p.title.replace(/^Dimona\s+/i, ''))}-base-front.png"
           alt="${escapeHtml(p.title)}" class="product-image"
           data-fallback="${escapeHtml(p.image)}">
      ...
    </div>`
    ).join('');

    // Attach onerror handlers via JS to comply with CSP (no inline event handlers)
    productsEl.querySelectorAll('img.product-image[data-fallback]').forEach(img => {
        img.addEventListener('error', function () {
            this.src = this.dataset.fallback;
            this.removeAttribute('data-fallback'); // prevent infinite loop if fallback also 404s
        });
    });
}

// ─── Flatlay / canvas ──────────────────────────────────────────────────────

function loadBaseOverlay(productTitle) {
    return new Promise((resolve) => {
        baseImage.onload = () => {
            canvas.width = baseImage.width;
            canvas.height = baseImage.height;
            resolve();
        };
        baseImage.onerror = () => {
            canvas.width = 400;
            canvas.height = 400;
            resolve();
        };
        baseImage.src = `images/flatlays/${productTitle.replace(/^Dimona\s+/i, '')}-base-front.png`;
    });
}

function renderShirtColor(hex) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (baseImage.complete && baseImage.naturalWidth > 0) {
        ctx.drawImage(baseImage, 0, 0);
    }
}

// ─── Variant modal with color + size selection ─────────────────────────────────────────

function showVariantModal(product) {
    selectedProduct = product;
    selectedColor = null;
    selectedSize = null;
    confirmBtn.disabled = true;

    modalEl.querySelector('h3').textContent = `Choose a color and size for ${escapeHtml(product.title)}`;

    loadBaseOverlay(product.title).then(() => renderShirtColor('#ffffff'));

    // Build unique color map from Dimona variants
    const colorMap = {};
    product.variants.forEach(v => {
        if (!colorMap[v.color]) {
            colorMap[v.color] = v.color_code || '#cccccc';
        }
    });

    // Store all variants by color for later size lookup
    window._variantsByColor = {};
    product.variants.forEach(v => {
        if (!window._variantsByColor[v.color]) {
            window._variantsByColor[v.color] = [];
        }
        window._variantsByColor[v.color].push(v);
    });

    variantSelectionEl.innerHTML = `
    <div class="variant-section">
      <div class="section-title">Available Colors (select one)</div>
      <div class="variant-selection-grid" data-type="color">
        ${Object.entries(colorMap).map(([colorName, hex]) => `
          <div class="variant-option color-option"
               data-color="${escapeHtml(colorName)}"
               data-hex="${escapeHtml(hex)}"
               data-action="hoverColor"
               data-color="${escapeHtml(hex)}">
            <div class="color-dot" style="background:${hex};border:1px solid ${
                ['#FFFFFF','#FAF9F6','#FFFFF0','#F5F0E8'].includes(hex) ? '#ccc' : hex
            }"></div>
            <div>${escapeHtml(colorName)}</div>
          </div>`
        ).join('')}
      </div>
    </div>
    <div id="size-selection-container" style="display:none;">
      <div class="variant-section">
        <div class="section-title">Available Sizes (select one)</div>
        <div class="variant-selection-grid" data-type="size" id="size-grid"></div>
      </div>
    </div>`;

    updateSelectedDisplay();
    modalEl.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function renderSizeOptions(colorName) {
    const sizeContainer = document.getElementById('size-selection-container');
    const sizeGrid = document.getElementById('size-grid');
    
    if (!sizeContainer || !sizeGrid) return;
    
    const variants = window._variantsByColor?.[colorName] || [];
    const uniqueSizes = [...new Map(variants.map(v => [v.size, v])).values()];
    
    if (uniqueSizes.length === 0) {
        sizeContainer.style.display = 'none';
        return;
    }
    
    sizeGrid.innerHTML = uniqueSizes.map(v => `
        <div class="variant-option size-option ${selectedSize === v.size ? 'selected' : ''}"
             data-size="${escapeHtml(v.size)}"
             data-sku="${escapeHtml(v.sku || v.id)}"
             data-price="${escapeHtml(v.price)}">
            <div class="size-label">${escapeHtml(v.size)}</div>
            <div class="size-price">${formatCurrency(parseFloat(v.price))}</div>
        </div>
    `).join('');
    
    sizeContainer.style.display = 'block';
}

function formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

function updateSelectedDisplay() {
    const container = document.getElementById('selected-colors');
    if (!container) return;
    
    if (!selectedColor && !selectedSize) {
        container.innerHTML = '<div style="color:#999;font-size:0.9rem">No color or size selected yet</div>';
        confirmBtn.disabled = true;
        return;
    }
    
    let html = '';
    if (selectedColor) {
        const colorHex = selectedProduct?.variants.find(v => v.color === selectedColor)?.color_code || '#ccc';
        html += `<div class="selected-color">
            <div class="selected-color-dot" style="background:${colorHex}"></div>
            <span>Color: ${escapeHtml(selectedColor)}</span>
        </div>`;
    }
    if (selectedSize) {
        html += `<div class="selected-size" style="margin-top:8px;">
            <i class="fas fa-ruler"></i> Size: ${escapeHtml(selectedSize)}
        </div>`;
    }
    
    container.innerHTML = html;
    confirmBtn.disabled = !selectedColor || !selectedSize;
    
    if (selectedColor && selectedSize) {
        const variant = selectedProduct.variants.find(v => v.color === selectedColor && v.size === selectedSize);
        if (variant) {
            renderShirtColor(variant.color_code || '#ffffff');
        }
    }
}

// ─── Color hover ───────────────────────────────────────────────────────────

function handleColorHover(hex) {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => renderShirtColor(hex), 200);
}

function handleColorHoverEnd() {
    clearTimeout(hoverTimeout);
    if (selectedColor && selectedSize) {
        const variant = selectedProduct.variants.find(v => v.color === selectedColor && v.size === selectedSize);
        if (variant) {
            renderShirtColor(variant.color_code || '#ffffff');
        }
    } else {
        renderShirtColor('#ffffff');
    }
}

function closeModal() {
    modalEl.style.display = 'none';
    document.body.style.overflow = '';
    selectedProduct = null;
    selectedColor = null;
    selectedSize = null;
    window._variantsByColor = null;
}

// ─── Confirm — store Dimona data then go to canvas ─────────────────────────

confirmBtn.addEventListener('click', () => {
    if (!selectedProduct || !selectedColor || !selectedSize) {
        alert('Please select both a color and a size.');
        return;
    }

    if (!selectedArt) {
        alert('No art selected. Please go back and select an art first.');
        window.location.href = 'inicio.html';
        return;
    }

    // Find the exact variant for the selected color + size
    const selectedVariant = selectedProduct.variants.find(v => 
        v.color === selectedColor && v.size === selectedSize
    );

    if (!selectedVariant) {
        alert('No valid variant found for the selected color and size.');
        return;
    }

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                           sessionStorage.getItem('currentFirestoreUserId');

    if (!firestoreUserId) {
        alert('User information not found. Please log in again.');
        window.location.href = 'profile.html';
        return;
    }

    // Persist art
    sessionStorage.setItem('selectedArt', JSON.stringify(selectedArt));

    // Persist SINGLE variant (not all sizes!)
    sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
    sessionStorage.setItem('selectedVariants', JSON.stringify([selectedVariant]));  // ← Only ONE variant!
    sessionStorage.setItem('productType', 'one-sided');
    sessionStorage.setItem('provider', 'dimona');

    sessionStorage.setItem('designerFirestoreUserId', firestoreUserId);
    sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);

    console.log("Navigation data prepared:");
    console.log("- Selected Art:", selectedArt);
    console.log("- Selected Product:", selectedProduct);
    console.log("- Selected Variant (ONE size):", selectedVariant);
    console.log("- User ID:", firestoreUserId);

    closeModal();
    window.location.href = 'canvas-client.html';
});

// ─── Event listeners ───────────────────────────────────────────────────────

productsEl.addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (card) showVariantModal(products.find(p => p.id === card.dataset.id));
});

variantSelectionEl.addEventListener('click', e => {
    // Handle color selection
    const colorOpt = e.target.closest('.color-option');
    if (colorOpt) {
        const colorName = colorOpt.dataset.color;
        
        // Remove selected class from other color options
        document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
        colorOpt.classList.add('selected');
        
        selectedColor = colorName;
        selectedSize = null;  // Reset size when color changes
        
        // Clear size selections
        document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
        
        renderSizeOptions(colorName);
        updateSelectedDisplay();
        return;
    }
    
    // Handle size selection
    const sizeOpt = e.target.closest('.size-option');
    if (sizeOpt) {
        // Remove selected class from other size options
        document.querySelectorAll('.size-option').forEach(el => el.classList.remove('selected'));
        sizeOpt.classList.add('selected');
        
        selectedSize = sizeOpt.dataset.size;
        updateSelectedDisplay();
    }
});

closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', e => e.target === modalEl && closeModal());
document.addEventListener('keydown', e => e.key === 'Escape' && modalEl.style.display === 'block' && closeModal());
refreshBtn.addEventListener('click', () => loadProducts());

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Content Loaded - Starting initialization");

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                           sessionStorage.getItem('currentFirestoreUserId');

    console.log("Checking authentication - Firestore User ID:", firestoreUserId);

    if (!firestoreUserId) {
        alert('Please log in to continue.');
        window.location.href = 'inicio.html';
        return;
    }

    console.log("User authenticated with Firestore ID:", firestoreUserId);

    try {
        await initializeSelectedArt();
        console.log("Art initialization completed");
    } catch (error) {
        console.error("Error initializing art:", error);
    }

    loadProducts();
});

// Expose globals for inline HTML event handlers
window.handleColorHover = handleColorHover;
window.handleColorHoverEnd = handleColorHoverEnd;