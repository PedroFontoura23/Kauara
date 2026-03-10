// canvas-client.js - Client product customization (based on canvas.js)
import { PRINT_AREAS } from './printAreas.js';
import * as ClientOneSideModule from './client-one-side.js';
import * as ClientTwoSideModule from './client-two-side.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

// Initialize Firebase
let firebaseApp;
let firebaseAuth;

try {
    if (typeof firebase !== 'undefined') {
        firebaseApp = firebase.initializeApp(firebaseConfig);
        firebaseAuth = firebase.auth();
        console.log("Firebase initialized successfully");
    } else {
        console.warn("Firebase SDK not loaded");
    }
} catch (error) {
    console.error("Firebase initialization error:", error);
}

// Constants
const DPI = 300;
const TWO_SIDED_PRODUCTS = [71, 146, 509]; // tshirts, hoodies, men's fitted
const PLATFORM_FEE_PERCENTAGE = 0.05; // 5% platform fee

// Physical dimensions for Printful (in inches)
const PHYSICAL_PRINT_AREAS = {
    71:  { front: { widthInches: 20, heightInches: 24 }, back: { widthInches: 14, heightInches: 16 } },
    146: { front: { widthInches: 14, heightInches: 14 }, back: { widthInches: 14, heightInches: 16 } },
    509: { front: { widthInches: 14, heightInches: 16 }, back: { widthInches: 14, heightInches: 16 } },
    19:  { default: { widthInches: 8.5, heightInches: 3.5 } }
};

// DOM Elements (cached)
const elements = {
    canvas: document.getElementById('product-canvas'),
    frontBtn: document.getElementById('front-btn'),
    backBtn: document.getElementById('back-btn'),
    saveBtn: document.getElementById('save-btn'),
    saveSideFront: document.querySelector('input[name="saveSide"][value="front"]'),
    saveSideBack: document.querySelector('input[name="saveSide"][value="back"]'),
    artInfo: document.getElementById('art-info'),
    artName: document.getElementById('art-name'),
    artDescription: document.getElementById('art-description'),
    artPriceEl: document.getElementById('art-price')
};

const ctx = elements.canvas.getContext('2d');

// Application State
const state = {
    product: null,
    variants: [],
    selectedVariant: null,
    side: 'front',
    overlayImage: null,
    overlayX: 0, overlayY: 0, overlayW: 0, overlayH: 0,
    overlayRotation: 0,
    isDragging: false,
    isResizing: false,
    resizeHandle: null,
    dragStartX: 0, dragStartY: 0,
    resizeStartX: 0, resizeStartY: 0,
    resizeStartW: 0, resizeStartH: 0,
    resizeStartOX: 0, resizeStartOY: 0,
    scale: 1.0,
    pricingLoaded: false,
    selectedArt: null,
    currentModule: null,
    moduleState: {},
    variantPricing: new Map(), // Full pricing data per variant (like canvas.js)
    variantPricingLoaded: false,
    canvasScale: 1,
    canvasScaleX: 1,
    canvasScaleY: 1,
    initialDistance: null,
    initialScale: 1
};

// ─── Price helpers (identical to canvas.js) ───────────────────────────────────

function roundToTwoDecimals(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
    return `R$ ${roundToTwoDecimals(amount).toFixed(2)}`;
}

function calculatePlatformFee(productPrice) {
    return roundToTwoDecimals(productPrice * PLATFORM_FEE_PERCENTAGE);
}

// Total = product_price + platform_fee(product_price) + art_price
function calculateTotalPrice(productPrice, artPrice) {
    const platformFee = calculatePlatformFee(productPrice);
    return roundToTwoDecimals(productPrice + platformFee + artPrice);
}

// ─── Product type detection ────────────────────────────────────────────────────

function getProductType(productId) {
    return TWO_SIDED_PRODUCTS.includes(parseInt(productId)) ? 'two-sided' : 'one-sided';
}

// ─── Initialize ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    try {
        console.log("Initializing client canvas application...");

        await waitForFirebase();

        const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                                sessionStorage.getItem('currentFirestoreUserId');

        console.log("Firestore User ID:", firestoreUserId);

        if (!firestoreUserId) {
            throw new Error("No Firestore user ID found. Please log in again.");
        }

        loadSessionData();
        buildSizeSelector(); // populate size buttons from loaded variants and load appropriate module
        const productType = getProductType(state.product?.id);
        console.log(`Loading ${productType} module for product ID: ${state.product?.id}`);

        state.currentModule = productType === 'two-sided'
            ? ClientTwoSideModule
            : ClientOneSideModule;

        const moduleState = state.currentModule.initialize(state, elements, ctx);
        state.moduleState = { ...state.moduleState, ...moduleState };

        // Preload base images
        if (state.currentModule.preloadBaseImages) {
            state.currentModule.preloadBaseImages(
                state.product?.id,
                state.moduleState.baseImages,
                state.moduleState.imagesLoaded
            );
        }

        setupEventListeners();
        updateCanvasScale();

        // Load art image (must come before pricing so art price is available)
        await loadSelectedArt();

        // Fetch pricing for the default variant
        await fetchProductPricing();

    } catch (error) {
        console.error('Failed to initialize app:', error);
        alert(error.message);
        window.location.href = 'profile.html';
    }
}

// ─── Firebase ─────────────────────────────────────────────────────────────────

async function waitForFirebase() {
    return new Promise((resolve, reject) => {
        if (typeof firebase === 'undefined') {
            reject(new Error('Firebase SDK not loaded. Please check your internet connection.'));
            return;
        }

        if (firebase.apps.length > 0) {
            console.log("Firebase already initialized");
            resolve();
            return;
        }

        try {
            firebaseApp = firebase.initializeApp(firebaseConfig);
            firebaseAuth = firebase.auth();
            console.log("Firebase initialized successfully");
            resolve();
        } catch (error) {
            if (error.code === 'app/duplicate-app') {
                firebaseApp = firebase.app();
                firebaseAuth = firebase.auth();
                console.log("Using existing Firebase app");
                resolve();
            } else {
                console.error("Firebase initialization failed:", error);
                reject(new Error('Failed to initialize authentication. Please refresh the page.'));
            }
        }
    });
}

async function getAuthToken() {
    try {
        if (typeof firebase === 'undefined' || !firebaseAuth) {
            throw new Error('Firebase authentication is not available. Please refresh the page.');
        }

        const user = firebaseAuth.currentUser;
        if (!user) {
            throw new Error('No authenticated user found. Please sign in.');
        }

        console.log("Getting auth token for user:", user.uid);
        const token = await user.getIdToken(true);
        console.log("Auth token retrieved successfully");
        return token;
    } catch (error) {
        console.error('Error getting auth token:', error);
        throw new Error(`Authentication failed: ${error.message}`);
    }
}

// ─── Session data ─────────────────────────────────────────────────────────────

function loadSessionData() {
    const productData = sessionStorage.getItem('selectedProduct');
    const variantData = sessionStorage.getItem('selectedVariants');
    const artData    = sessionStorage.getItem('selectedArt');

    if (!productData) throw new Error('No product data found in session storage');
    if (!variantData) throw new Error('No variant data found in session storage');

    state.product  = JSON.parse(productData);
    state.variants = JSON.parse(variantData);
    state.selectedVariant = state.variants[0] || null;

    if (artData) {
        state.selectedArt = JSON.parse(artData);
    }

    if (!state.selectedVariant) {
        throw new Error('No variants available for selected product');
    }

    console.log("=== PRODUCT DATA ===");
    console.log("Product ID:", state.product.id);
    console.log("Product Name:", state.product.name);
    console.log("Total variants:", state.variants.length);
}

// ─── Canvas scale ─────────────────────────────────────────────────────────────

function updateCanvasScale() {
    const rect = elements.canvas.getBoundingClientRect();
    state.canvasScaleX = elements.canvas.width  / rect.width;
    state.canvasScaleY = elements.canvas.height / rect.height;
    state.canvasScale  = state.canvasScaleX; // legacy
}

// ─── Variant rendering ────────────────────────────────────────────────────────

// ─── Size selector ────────────────────────────────────────────────────────────

function buildSizeSelector() {
    const container = document.getElementById('size-selector');
    if (!container) return;

    // Deduplicate sizes while preserving variant reference (one variant per size)
    const seenSizes = new Set();
    const uniqueVariants = state.variants.filter(v => {
        if (!v.size || seenSizes.has(v.size)) return false;
        seenSizes.add(v.size);
        return true;
    });

    if (uniqueVariants.length === 0) {
        document.getElementById('size-selector-group').style.display = 'none';
        return;
    }

    container.innerHTML = '';

    uniqueVariants.forEach(variant => {
        const btn = document.createElement('button');
        btn.className = 'size-btn';
        btn.textContent = variant.size;
        btn.dataset.variantId = variant.id;

        if (state.selectedVariant && String(variant.id) === String(state.selectedVariant.id)) {
            btn.classList.add('selected');
        }

        btn.addEventListener('click', () => handleSizeSelect(variant, btn));
        container.appendChild(btn);
    });
}

async function handleSizeSelect(variant, clickedBtn) {
    if (state.selectedVariant && String(state.selectedVariant.id) === String(variant.id)) return;

    // Update selected variant
    state.selectedVariant = variant;

    // Update button styles
    document.querySelectorAll('#size-selector .size-btn').forEach(b => b.classList.remove('selected'));
    clickedBtn.classList.add('selected');

    // Reset pricing display while loading
    ['base-price', 'art-price-display', 'platform-fee', 'total-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '...';
    });

    // Fetch new pricing for selected variant
    await fetchProductPricing();
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

async function fetchProductPricing() {
    if (!state.selectedVariant) return;

    console.log(`=== FETCHING PRICE: variant ${state.selectedVariant.id} ===`);

    try {
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/getProductPricing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: state.product.id, variantId: state.selectedVariant.id, size: state.selectedVariant.size })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        console.log('RAW API response:', result);

        if (!result.success || !result.basePrice) {
            throw new Error(result.error || 'API returned no basePrice');
        }

        const basePrice = roundToTwoDecimals(result.basePrice);
        const artPrice  = roundToTwoDecimals(state.selectedArt?.totalPrice || state.selectedArt?.price || 0);
        const fee       = calculatePlatformFee(basePrice);
        const total     = calculateTotalPrice(basePrice, artPrice);

        const pricing = { product_price: basePrice, art_price: artPrice, platform_fee: fee, total_price: total };

        state.variantPricing.set(parseInt(state.selectedVariant.id), pricing);
        state.variantPricingLoaded = true;
        state.pricingLoaded        = true;

        console.log(`✅ Price fetched:`, pricing);
        updatePricingDisplay(pricing);

    } catch (error) {
        console.error(`❌ Failed to fetch price:`, error);
        ['base-price', 'platform-fee', 'total-price'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Error';
        });
    }
}

function updatePricingDisplay(pricing) {
    if (!pricing) return;

    const basePriceEl   = document.getElementById('base-price');
    const artPriceEl    = document.getElementById('art-price-display');
    const platformFeeEl = document.getElementById('platform-fee');
    const totalPriceEl  = document.getElementById('total-price');
    const artNameEl     = document.getElementById('art-name-display');

    if (basePriceEl)   basePriceEl.textContent  = formatCurrency(pricing.product_price);
    if (artPriceEl)    artPriceEl.textContent    = formatCurrency(pricing.art_price);
    if (platformFeeEl) platformFeeEl.textContent = formatCurrency(pricing.platform_fee);
    if (totalPriceEl)  totalPriceEl.innerHTML    = `<strong>${formatCurrency(pricing.total_price)}</strong>`;

    if (artNameEl && state.selectedArt) {
        artNameEl.textContent = state.selectedArt.name || 'Selected Art';
    }
}

// ─── Art loading ──────────────────────────────────────────────────────────────

async function loadSelectedArt() {
    const selectedArtData = sessionStorage.getItem('selectedArt');
    if (!selectedArtData) {
        alert('No art selected. Please choose an art first.');
        window.location.href = 'select-product-client.html';
        return;
    }

    try {
        const artData = JSON.parse(selectedArtData);
        console.log("Loading selected art:", artData);
        state.selectedArt = artData;

        // Update art info display
        if (elements.artName)        elements.artName.textContent        = artData.name || 'Untitled Art';
        if (elements.artDescription) elements.artDescription.textContent = artData.description || '';
        if (elements.artPriceEl)     elements.artPriceEl.textContent     =
            `Price: ${formatCurrency(artData.totalPrice || artData.price || 0)}`;

        console.log("Loading art image with CORS from:", artData.downloadURL);
        await loadImageWithCORS(artData.downloadURL);

    } catch (error) {
        console.error('Error loading selected art:', error);
        alert('Failed to load art image. Please try again.');
        window.location.href = 'select-product-client.html';
    }
}

function loadImageWithCORS(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            console.log("✅ Art image loaded with CORS");
            state.overlayImage = img;
            initializeOverlayPosition();
            renderCanvas();
            resolve();
        };

        img.onerror = (err) => {
            console.error('❌ CORS image load failed:', err);
            reject(new Error('Failed to load art image with CORS'));
        };

        img.src = url + '?t=' + Date.now();
    });
}

// ─── Canvas rendering ─────────────────────────────────────────────────────────

function renderCanvas() {
    if (!state.currentModule) return;

    const originalDrawImage = ctx.drawImage.bind(ctx);
    const rotation = (state.overlayRotation || 0) * Math.PI / 180;

    if (state.overlayImage && rotation !== 0) {
        ctx.drawImage = function(...args) {
            const img = args[0];
            if (img === state.overlayImage) {
                const [, dx, dy, dw, dh] = args;
                const cx = dx + dw / 2;
                const cy = dy + dh / 2;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rotation);
                ctx.translate(-dw / 2, -dh / 2);
                originalDrawImage(img, 0, 0, dw, dh);
                ctx.restore();
            } else {
                originalDrawImage(...args);
            }
        };
    }

    state.currentModule.renderCanvas(
        state, elements, ctx,
        state.moduleState.baseImages,
        state.moduleState.imagesLoaded
    );

    ctx.drawImage = originalDrawImage;

    if (state.overlayImage) {
        drawTransformHandles(ctx);
    }
}

function drawTransformHandles(ctx) {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    const hs = HANDLE_SIZE;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 120, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    const handles = getResizeHandles();
    for (const pos of Object.values(handles)) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0, 120, 255, 1)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(pos.x - hs / 2, pos.y - hs / 2, hs, hs);
        ctx.strokeRect(pos.x - hs / 2, pos.y - hs / 2, hs, hs);
    }
    ctx.restore();
}

function initializeOverlayPosition() {
    if (!state.currentModule?.initializeOverlayPosition) return;
    state.currentModule.initializeOverlayPosition(state, elements);
}

// ─── Scale ────────────────────────────────────────────────────────────────────

function handleScaleChange(event) {
    if (!state.overlayImage || !state.currentModule?.handleScaleChange) return;
    const scaleValue = parseInt(event.target.value) / 100;
    state.currentModule.handleScaleChange(state, elements, scaleValue);
    document.getElementById('scale-value').textContent = `${event.target.value}%`;
    renderCanvas();
}

// ─── Side switch ──────────────────────────────────────────────────────────────

function handleSideSwitch(newSide) {
    if (!state.currentModule?.handleSideSwitch) return;
    const result = state.currentModule.handleSideSwitch(
        newSide, state, elements,
        state.moduleState.baseImages,
        state.moduleState.imagesLoaded
    );
    if (result) state.side = result;
    // Recalculate after layout reflow in case canvas dimensions changed
    requestAnimationFrame(() => {
        updateCanvasScale();
        initializeOverlayPosition();
    });
}

// ─── Save product ─────────────────────────────────────────────────────────────

function getSaveSide() {
    const selectedSide = document.querySelector('input[name="saveSide"]:checked');
    const side = selectedSide ? selectedSide.value : 'front';
    console.log("Save side selected:", side);
    return side;
}

async function handleSaveProduct() {
    console.log('=== handleSaveProduct STARTED ===');

    // Validate art
    if (!state.overlayImage) {
        alert('No art image available');
        return;
    }

    // Validate pricing loaded
    if (!state.variantPricingLoaded || state.variantPricing.size === 0) {
        alert('Product pricing not loaded. Please wait or try again.');
        return;
    }

    // Validate selected variant
    if (!state.selectedVariant) {
        alert('Please select a size before saving.');
        autoSelectSmallestPriceVariant();
        return;
    }

    const pricing = state.variantPricing.get(parseInt(state.selectedVariant.id));

    if (!pricing || pricing.product_price <= 0 || isNaN(pricing.product_price)) {
        alert(`The selected size "${state.selectedVariant.size}" has an invalid price. Please select a different size.`);
        autoSelectSmallestPriceVariant();
        return;
    }

    if (pricing.total_price <= 0) {
        alert('Total price calculation error. Please try selecting a different size.');
        autoSelectSmallestPriceVariant();
        return;
    }

    // Firestore user ID
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                            sessionStorage.getItem('currentFirestoreUserId');

    if (!firestoreUserId) {
        alert('User information not found. Please log in again.');
        window.location.href = 'profile.html';
        return;
    }

    // Firebase authentication — required
    let currentUser = null;
    let authToken   = null;

    try {
        if (typeof firebase === 'undefined' || !firebaseAuth) {
            throw new Error('Firebase authentication is not available. Please refresh the page.');
        }

        currentUser = firebaseAuth.currentUser;
        if (!currentUser) {
            throw new Error('You are not logged in. Please sign in to save products.');
        }

        console.log("Firebase user authenticated:", currentUser.uid);
        authToken = await currentUser.getIdToken(true);
        console.log("Auth token retrieved successfully");

    } catch (authError) {
        console.error('Firebase authentication error:', authError);
        alert(`Authentication failed: ${authError.message}`);
        window.location.href = 'profile.html';
        return;
    }

    const { saveBtn } = elements;

    try {
        saveBtn.disabled  = true;
        saveBtn.textContent = 'Saving...';

        // Build product name/code from Firestore ID
        const productCode = `${firestoreUserId}-product_${Date.now()}`;

        // Get save side
        const saveSide = getSaveSide();
        console.log("Saving product for side:", saveSide);

        // Physical area for Printful
        const physicalArea = PHYSICAL_PRINT_AREAS[state.product.id]?.[saveSide] ||
                             PHYSICAL_PRINT_AREAS[state.product.id]?.default;

        if (!physicalArea) {
            throw new Error(`Physical print area not defined for product ${state.product.id}, side: ${saveSide}`);
        }

        const areaWidthPx  = Math.round(physicalArea.widthInches * 300);
        const areaHeightPx = Math.round(physicalArea.heightInches * 300);

        // Composite design canvas for Printful
        const compositeCanvas = document.createElement('canvas');
        const compositeCtx    = compositeCanvas.getContext('2d');
        compositeCanvas.width  = areaWidthPx;
        compositeCanvas.height = areaHeightPx;

        // Temporarily switch to save side to get correct print area
        const originalSide = state.side;
        state.side = saveSide;

        const printArea = state.currentModule?.getPrintArea
            ? state.currentModule.getPrintArea(state)
            : null;

        if (!printArea) {
            state.side = originalSide;
            throw new Error(`Print area not defined for ${saveSide} side of this product`);
        }

        const scaleX = areaWidthPx  / printArea.width;
        const scaleY = areaHeightPx / printArea.height;

        compositeCtx.drawImage(
            state.overlayImage,
            (state.overlayX - printArea.x) * scaleX,
            (state.overlayY - printArea.y) * scaleY,
            state.overlayW * scaleX,
            state.overlayH * scaleY
        );

        const designImage = compositeCanvas.toDataURL('image/png');

        // Create thumbnail
        const thumbnail = await createThumbnail(saveSide, printArea);

        // Restore original side
        state.side = originalSide;

        // Build single processed variant (client only saves selected variant)
        const selectedVariant = state.selectedVariant;

        if (!selectedVariant.id)         throw new Error('Selected variant missing ID');
        if (!selectedVariant.size)       throw new Error('Selected variant missing size');
        if (!selectedVariant.color)      throw new Error('Selected variant missing color');
        if (!selectedVariant.color_code) throw new Error('Selected variant missing color_code');

        const processedVariant = {
            // Basic info
            id:         selectedVariant.id,
            variant_id: selectedVariant.id,

            // Product info
            name:       selectedVariant.name || `${state.product.name} – ${selectedVariant.color} – ${selectedVariant.size}`,
            size:       selectedVariant.size,
            color:      selectedVariant.color,
            color_code: selectedVariant.color_code,

            // Pricing (product_price + platform_fee + art_price = total_price)
            pricing: {
                product_price:            pricing.product_price,
                art_price:                pricing.art_price,
                platform_fee:             pricing.platform_fee,
                platform_fee_percentage:  PLATFORM_FEE_PERCENTAGE,
                total_price:              pricing.total_price,
                currency:                 "BRL"
            },

            // Printful compatibility
            retail_price:      pricing.total_price,
            price:             pricing.total_price,
            external_id:       `variant_${selectedVariant.id}`,
            sku:               `KAUARA_${state.product.id}_${selectedVariant.id}`,
            availability_status: selectedVariant.availability_status || 'active'
        };

        const pricingSummary = {
            product_price:           pricing.product_price,
            art_price:               pricing.art_price,
            platform_fee:            pricing.platform_fee,
            platform_fee_percentage: PLATFORM_FEE_PERCENTAGE,
            total_price:             pricing.total_price,
            currency:                "BRL"
        };

        console.log("Print area:", printArea);
        console.log("Save side:", saveSide);
        console.log("Pricing summary:", pricingSummary);
        console.log("Processed variant:", processedVariant);

        const requestBody = {
            // Identity
            name:            productCode,
            productId:       state.product.id,
            designerUserId:  firestoreUserId,
            side:            saveSide,

            // Firebase auth
            firebaseUserId:  currentUser.uid,
            userEmail:       currentUser.email,

            // Art reference
            artistUserId:    state.selectedArt?.userId,
            originalArtId:   state.selectedArt?.id,

            // Design
            designImage:     designImage,
            thumbnail:       thumbnail,
            designScale:     state.scale,

            // Placement
            placement: {
                area_width:  areaWidthPx,
                area_height: areaHeightPx,
                width:       areaWidthPx,
                height:      areaHeightPx,
                left:        0,
                top:         0,
                side:        saveSide
            },

            // Pricing
            pricing_summary: pricingSummary,

            // Variant (single selected variant)
            availableColors: [selectedVariant.color],
            availableSizes:  [selectedVariant.size],
            totalVariants:   1,
            variants:        [processedVariant],

            // Timestamps
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),

            // Firestore collection
            firestoreCollection: 'products-client'
        };

        console.log("Sending request to cloud function...");

        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveProduct', {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Cloud function response status:', response.status);

        if (!response.ok) {
            if (response.status === 401) throw new Error('Authentication expired. Please sign in again.');
            if (response.status === 403) throw new Error('You do not have permission to save products.');
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} – ${errorText}`);
        }

        const result = await response.json();
        console.log('Cloud function result:', result);

        if (result.success) {
            console.log('✅ Product saved successfully!');
            console.log("Firestore ID:", result.firestoreProductId);
            console.log("Printful Sync Product ID:", result.printfulSyncProductId);

            if (result.firestoreProductId) {
                sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
                sessionStorage.setItem('checkoutProductId', result.firestoreProductId);
            }

            // Build cart item the same way shared-products.js handleBuyFromModal does
            const selectedVariant = state.selectedVariant;
            // Build cart item with ALL required fields for shopFunctions.js
            const productWithVariant = {
                // Basic product info
                firestoreProductId: result.firestoreProductId,
                productTitle: state.product.name || state.product.title,
                
                // CRITICAL: These exact snake_case fields are REQUIRED by shopFunctions.js
                product_id: String(state.product.id),                    // ✅ REQUIRED
                title: state.product.name || state.product.title,       // ✅ REQUIRED
                variant_id: String(selectedVariant.id),                  // ✅ REQUIRED (top-level)
                designer_id: firestoreUserId,                            // ✅ REQUIRED
                designer_email: currentUser.email || '',                 // ✅ REQUIRED - FIXED
                designer_name: state.selectedArt?.artistName || 'Seu produto personalizado',
                
                // Selected variant info (keep for reference)
                selectedVariant: {
                    id: selectedVariant.id,
                    variant_id: selectedVariant.id,
                    size: selectedVariant.size,
                    color: selectedVariant.color,
                    color_code: selectedVariant.color_code,
                    price: pricing.total_price,
                    retail_price: pricing.total_price,
                    pricing: pricing
                },
                
                // CRITICAL: Firestore collection where this product was saved.
                // pagamentos.js uses this when building cart_products for the payment function,
                // and printfunctions.js uses it to look up the product document.
                // Without this field both fall back to 'products', causing the
                // "Product document not found in Firestore" error for client products.
                firestoreCollection: 'products-client',

                // Complete pricing information.
                // Key names must match what pagamentos.js reads:
                //   product_price → base Printful cost
                //   artist_cut    → art markup paid to the artist
                //   platform_fee  → 5% platform fee
                //   total_price   → total charged to the customer
                // NOTE: the internal state calls this 'art_price'; renamed here to 'artist_cut'
                // so pagamentos.js displayProductsInfo() reads it correctly.
                pricing: {
                    product_price: pricing.product_price,
                    artist_cut: pricing.art_price,   // art_price → artist_cut (matches pagamentos.js)
                    platform_fee: pricing.platform_fee,
                    platform_fee_percentage: PLATFORM_FEE_PERCENTAGE,
                    total_price: pricing.total_price,
                    currency: 'BRL'
                },
                
                // Designer / art reference
                originalArtId: state.selectedArt?.id,
                artistUserId: state.selectedArt?.userId,
                designerUserId: firestoreUserId,
                
                // Product images
                thumbnailUrl: (() => {
                    try {
                        const snap = document.createElement('canvas');
                        snap.width = snap.height = 200;
                        const snapCtx = snap.getContext('2d');
                        snapCtx.drawImage(elements.canvas, 0, 0, elements.canvas.width, elements.canvas.height, 0, 0, 200, 200);
                        return snap.toDataURL('image/jpeg', 0.7);
                    } catch (e) {
                        return null;
                    }
                })(),
                
                // Timestamp & cart ID
                purchaseTimestamp: new Date().toISOString(),
                cartItemId: Date.now() + Math.random().toString(36).substr(2, 9)
            };

            // Push to localStorage cart — same as shared-products.js addToCart
            let cart = JSON.parse(localStorage.getItem('cart') || '[]');

            const existingIndex = cart.findIndex(item =>
                item.firestoreProductId === productWithVariant.firestoreProductId &&
                item.selectedVariant?.variant_id === productWithVariant.selectedVariant?.variant_id
            );

            if (existingIndex !== -1) {
                // Already in cart — just go there
                window.location.href = 'carrinho.html';
                return;
            }

            cart.push(productWithVariant);
            localStorage.setItem('cart', JSON.stringify(cart));

            console.log('🛒 Product added to cart:', productWithVariant);

            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Product';

            window.location.href = 'carrinho.html';
            return;

        } else {
            throw new Error(result.error || 'Failed to save product');
        }

    } catch (error) {
        console.error('Error in handleSaveProduct:', error);

        if (error.message.includes('Authentication') ||
            error.message.includes('not logged in') ||
            error.message.includes('sign in')) {
            alert(error.message);
            window.location.href = 'profile.html';
            return;
        }

        alert(`Error saving product: ${error.message}`);

    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Product';
        console.log('=== handleSaveProduct COMPLETED ===');
    }
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

async function createThumbnail(saveSide, printArea) {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const size   = 800;
    canvas.width = canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    const baseImage = state.moduleState.baseImages?.[saveSide];
    if (baseImage && baseImage.complete) {
        const scale = Math.min(size / baseImage.width, size / baseImage.height);
        const w = baseImage.width  * scale;
        const h = baseImage.height * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;
        ctx.drawImage(baseImage, x, y, w, h);

        if (printArea && state.overlayImage) {
            // Map print area into thumbnail space, accounting for the centering offset (x, y)
            const thumbPrintAreaX = x + (printArea.x / baseImage.width)  * w;
            const thumbPrintAreaY = y + (printArea.y / baseImage.height) * h;
            const thumbPrintAreaW = (printArea.width  / baseImage.width)  * w;
            const thumbPrintAreaH = (printArea.height / baseImage.height) * h;

            // Map overlay position into thumbnail space using the same scale
            const thumbOverlayX = x + (state.overlayX / baseImage.width)  * w;
            const thumbOverlayY = y + (state.overlayY / baseImage.height) * h;
            const thumbOverlayW = (state.overlayW / baseImage.width)  * w;
            const thumbOverlayH = (state.overlayH / baseImage.height) * h;

            // Clip to print area so the design never bleeds outside its bounds
            ctx.save();
            ctx.beginPath();
            ctx.rect(thumbPrintAreaX, thumbPrintAreaY, thumbPrintAreaW, thumbPrintAreaH);
            ctx.clip();

            const rotation = (state.overlayRotation || 0) * Math.PI / 180;
            if (rotation !== 0) {
                const cx = thumbOverlayX + thumbOverlayW / 2;
                const cy = thumbOverlayY + thumbOverlayH / 2;
                ctx.translate(cx, cy);
                ctx.rotate(rotation);
                ctx.drawImage(state.overlayImage, -thumbOverlayW / 2, -thumbOverlayH / 2, thumbOverlayW, thumbOverlayH);
            } else {
                ctx.drawImage(state.overlayImage, thumbOverlayX, thumbOverlayY, thumbOverlayW, thumbOverlayH);
            }

            ctx.restore();
        }
    } else {
        // Fallback: no base image — show design clipped to a centered print-area-proportioned region
        if (state.overlayImage && printArea) {
            const thumbPrintAreaW = (printArea.width / (printArea.width + printArea.x * 2)) * size;
            const thumbPrintAreaH = (printArea.height / (printArea.height + printArea.y * 2)) * size;
            const thumbPrintAreaX = (size - thumbPrintAreaW) / 2;
            const thumbPrintAreaY = (size - thumbPrintAreaH) / 2;

            const thumbOverlayW = (state.overlayW / printArea.width)  * thumbPrintAreaW;
            const thumbOverlayH = (state.overlayH / printArea.height) * thumbPrintAreaH;
            const thumbOverlayX = thumbPrintAreaX + ((state.overlayX - printArea.x) / printArea.width)  * thumbPrintAreaW;
            const thumbOverlayY = thumbPrintAreaY + ((state.overlayY - printArea.y) / printArea.height) * thumbPrintAreaH;

            ctx.save();
            ctx.beginPath();
            ctx.rect(thumbPrintAreaX, thumbPrintAreaY, thumbPrintAreaW, thumbPrintAreaH);
            ctx.clip();

            const rotation2 = (state.overlayRotation || 0) * Math.PI / 180;
            if (rotation2 !== 0) {
                const cx = thumbOverlayX + thumbOverlayW / 2;
                const cy = thumbOverlayY + thumbOverlayH / 2;
                ctx.translate(cx, cy);
                ctx.rotate(rotation2);
                ctx.drawImage(state.overlayImage, -thumbOverlayW / 2, -thumbOverlayH / 2, thumbOverlayW, thumbOverlayH);
            } else {
                ctx.drawImage(state.overlayImage, thumbOverlayX, thumbOverlayY, thumbOverlayW, thumbOverlayH);
            }

            ctx.restore();
        }
    }

    return canvas.toDataURL('image/png');
}

// ─── Event listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    if (state.currentModule?.handleSideSwitch) {
        elements.frontBtn.addEventListener('click', () => handleSideSwitch('front'));
        elements.backBtn.addEventListener('click',  () => handleSideSwitch('back'));
    }

    document.getElementById('scale-slider').addEventListener('input', handleScaleChange);

    // Rotate button
    const rotateBtn = document.getElementById('rotate-btn');
    if (rotateBtn) rotateBtn.addEventListener('click', handleRotateImage);

    // Mouse
    elements.canvas.addEventListener('mousedown',  handlePointerDown);
    elements.canvas.addEventListener('mousemove',  handlePointerMove);
    elements.canvas.addEventListener('mouseup',    handlePointerUp);
    elements.canvas.addEventListener('mouseleave', handlePointerUp);

    // Touch
    elements.canvas.addEventListener('touchstart',  handleTouchStart,  { passive: false });
    elements.canvas.addEventListener('touchmove',   handleTouchMove,   { passive: false });
    elements.canvas.addEventListener('touchend',    handleTouchEnd);
    elements.canvas.addEventListener('touchcancel', handleTouchEnd);

    elements.canvas.addEventListener('dragstart', e => e.preventDefault());

    elements.saveBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
            await handleSaveProduct();
        } catch (error) {
            console.error('Save product error:', error);
            alert(`Error: ${error.message}`);
        }
    });

    window.addEventListener('resize', () => setTimeout(updateCanvasScale, 100));
}

// ─── Pointer handling ─────────────────────────────────────────────────────────

let renderScheduled = false;
function scheduleRender() {
    if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderCanvas();
            renderScheduled = false;
        });
    }
}

const HANDLE_SIZE = 10;

function getResizeHandles() {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    return {
        tl: { x: x,     y: y },
        tr: { x: x + w, y: y },
        bl: { x: x,     y: y + h },
        br: { x: x + w, y: y + h },
    };
}

function getHandleAtPoint(point) {
    const handles = getResizeHandles();
    for (const [key, pos] of Object.entries(handles)) {
        if (Math.abs(point.x - pos.x) <= HANDLE_SIZE && Math.abs(point.y - pos.y) <= HANDLE_SIZE) {
            return key;
        }
    }
    return null;
}

function getResizeCursor(handle) {
    const cursors = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' };
    return cursors[handle] || 'default';
}

function handleRotateImage() {
    if (!state.overlayImage) return;
    state.overlayRotation = ((state.overlayRotation || 0) + 90) % 360;
    if (state.overlayRotation % 180 !== 0) {
        const cx = state.overlayX + state.overlayW / 2;
        const cy = state.overlayY + state.overlayH / 2;
        const tmp = state.overlayW;
        state.overlayW = state.overlayH;
        state.overlayH = tmp;
        state.overlayX = cx - state.overlayW / 2;
        state.overlayY = cy - state.overlayH / 2;
    } else {
        const cx = state.overlayX + state.overlayW / 2;
        const cy = state.overlayY + state.overlayH / 2;
        const tmp = state.overlayW;
        state.overlayW = state.overlayH;
        state.overlayH = tmp;
        state.overlayX = cx - state.overlayW / 2;
        state.overlayY = cy - state.overlayH / 2;
    }
    renderCanvas();
}

function handlePointerDown(event) {
    if (!state.overlayImage) return;
    const pointerPos = getPointerPosition(event);
    const handle = getHandleAtPoint(pointerPos);

    if (handle) {
        state.isResizing = true;
        state.resizeHandle = handle;
        state.resizeStartX = pointerPos.x;
        state.resizeStartY = pointerPos.y;
        state.resizeStartW = state.overlayW;
        state.resizeStartH = state.overlayH;
        state.resizeStartOX = state.overlayX;
        state.resizeStartOY = state.overlayY;
        elements.canvas.style.cursor = getResizeCursor(handle);
        if (event.type.includes('touch')) event.preventDefault();
    } else if (isPointInOverlay(pointerPos)) {
        state.isDragging  = true;
        state.dragStartX  = pointerPos.x - state.overlayX;
        state.dragStartY  = pointerPos.y - state.overlayY;
        elements.canvas.style.cursor = 'grabbing';
        if (event.type.includes('touch')) event.preventDefault();
    }
}

function handlePointerMove(event) {
    if (!state.overlayImage) return;
    const pointerPos = getPointerPosition(event);

    if (state.isResizing) {
        const dx = pointerPos.x - state.resizeStartX;
        const handle = state.resizeHandle;
        const aspectRatio = state.resizeStartW / state.resizeStartH;

        let newW = state.resizeStartW;
        let newX = state.resizeStartOX;
        let newY = state.resizeStartOY;

        if (handle === 'br') {
            newW = Math.max(20, state.resizeStartW + dx);
        } else if (handle === 'bl') {
            newW = Math.max(20, state.resizeStartW - dx);
            newX = state.resizeStartOX + state.resizeStartW - newW;
        } else if (handle === 'tr') {
            newW = Math.max(20, state.resizeStartW + dx);
            newY = state.resizeStartOY + state.resizeStartH - newW / aspectRatio;
        } else if (handle === 'tl') {
            newW = Math.max(20, state.resizeStartW - dx);
            newX = state.resizeStartOX + state.resizeStartW - newW;
            newY = state.resizeStartOY + state.resizeStartH - newW / aspectRatio;
        }

        state.overlayW = newW;
        state.overlayH = newW / aspectRatio;
        state.overlayX = newX;
        state.overlayY = newY;
        scheduleRender();
    } else if (state.isDragging) {
        state.overlayX = pointerPos.x - state.dragStartX;
        state.overlayY = pointerPos.y - state.dragStartY;
        scheduleRender();
    } else {
        const handle = getHandleAtPoint(pointerPos);
        if (handle) {
            elements.canvas.style.cursor = getResizeCursor(handle);
        } else {
            elements.canvas.style.cursor = isPointInOverlay(pointerPos) ? 'grab' : 'default';
        }
    }
}

function handlePointerUp() {
    state.isDragging = false;
    state.isResizing = false;
    state.resizeHandle = null;
    elements.canvas.style.cursor = 'default';
}

// ─── Touch handling ───────────────────────────────────────────────────────────

function handleTouchStart(event) {
    if (!state.overlayImage) return;

    if (event.touches.length === 1) {
        const pointerPos = getPointerPosition(event);
        // On mobile, start drag from anywhere on the canvas — no hitbox required
        state.isDragging = true;
        state.dragStartX = pointerPos.x - state.overlayX;
        state.dragStartY = pointerPos.y - state.overlayY;
        event.preventDefault(); // always prevent scroll when touching canvas
    } else if (event.touches.length === 2) {
        state.isDragging      = false;
        state.initialDistance = getTouchDistance(event);
        state.initialScale    = state.scale;
        event.preventDefault();
    }
}

function handleTouchMove(event) {
    if (!state.overlayImage) return;
    event.preventDefault(); // always prevent scroll while moving on canvas

    if (event.touches.length === 1 && state.isDragging) {
        const pointerPos = getPointerPosition(event);
        state.overlayX = pointerPos.x - state.dragStartX;
        state.overlayY = pointerPos.y - state.dragStartY;
        scheduleRender();
    } else if (event.touches.length === 2) {
        const currentDistance = getTouchDistance(event);
        if (state.initialDistance !== null) {
            const scaleFactor = currentDistance / state.initialDistance;
            const newScale    = Math.max(0.1, Math.min(5, state.initialScale * scaleFactor));

            const scaleSlider = document.getElementById('scale-slider');
            const scaleValue  = document.getElementById('scale-value');
            const sliderValue = Math.round(newScale * 100);

            if (scaleSlider) scaleSlider.value = sliderValue;
            if (scaleValue)  scaleValue.textContent = `${sliderValue}%`;

            if (state.currentModule?.handleScaleChange) {
                state.currentModule.handleScaleChange(state, elements, newScale);
            }
        }
    }
}

function handleTouchEnd() {
    state.isDragging      = false;
    state.initialDistance = null;
    elements.canvas.style.cursor = 'default';
}

function getTouchDistance(event) {
    const t1 = event.touches[0];
    const t2 = event.touches[1];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

// ─── Pointer position helpers ─────────────────────────────────────────────────

function getPointerPosition(event) {
    const rect = elements.canvas.getBoundingClientRect();
    let clientX, clientY;

    if (event.type.includes('touch')) {
        // touchend has no touches[] — use changedTouches
        const touch = (event.touches && event.touches.length > 0)
            ? event.touches[0]
            : event.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    return {
        x: (clientX - rect.left) * (state.canvasScaleX || state.canvasScale),
        y: (clientY - rect.top)  * (state.canvasScaleY || state.canvasScale)
    };
}

function isPointInOverlay(point) {
    return point.x >= state.overlayX &&
           point.x <= state.overlayX + state.overlayW &&
           point.y >= state.overlayY &&
           point.y <= state.overlayY + state.overlayH;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function cmToPx(cm, dpi = DPI) {
    return Math.round((cm / 2.54) * dpi);
}

export { state, elements, ctx };