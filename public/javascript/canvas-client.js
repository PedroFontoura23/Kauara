// =============================================
// FIREBASE
// =============================================
// Use shared-firebase-init.js to initialize Firebase in the page.
if (typeof window._canvasClientLoaded === 'undefined') {
    window._canvasClientLoaded = true;
}

let firebaseApp, firebaseAuth;
const canvasMode = sessionStorage.getItem('creationMode') || 'client';


async function waitForFirebase() {
    return new Promise((resolve, reject) => {
        // Poll for both the SDK global and app initialization (up to 5 seconds)
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                clearInterval(interval);
                firebaseApp = firebase.app();
                firebaseAuth = firebase.auth();
                resolve();
            } else if (attempts >= 50) {
                clearInterval(interval);
                const reason = typeof firebase === 'undefined'
                    ? 'Firebase SDK not loaded. Ensure firebase-app-compat.js is included.'
                    : 'Firebase has not been initialized. Ensure shared-firebase-init.js is loaded first.';
                reject(new Error(reason));
            }
        }, 100);
    });
}

// =============================================
// CONSTANTS
// =============================================
const PLATFORM_FEE_FIXED = 5.00;
const HANDLE_SIZE = 10;
const DPI = 300;

// =============================================
// Helper: cm to pixels
// =============================================
function cmToPx(cm) {
    return Math.round((cm / 2.54) * DPI);
}

// =============================================
// Print Area Helper
// =============================================
function getPrintAreaPx(product, side) {
    if (!product || !product.printAreas) return null;
    const area = product.printAreas[side];
    if (!area) return null;

    const scale  = area.scale ?? 1.0;
    const cx     = cmToPx(area.xCm);
    const cy     = cmToPx(area.yCm);
    const width  = cmToPx(area.widthCm)  * scale;
    const height = cmToPx(area.heightCm) * scale;

    return {
        x:      cx - width  / 2,
        y:      cy - height / 2,
        width:  width,
        height: height,
    };
}

// =============================================
// DOM
// =============================================
const elements = {
    canvas:         document.getElementById('product-canvas'),
    frontBtn:       document.getElementById('front-btn'),
    backBtn:        document.getElementById('back-btn'),
    saveBtn:        document.getElementById('save-btn'),
    uploadInput:    document.getElementById('upload-input'),
    bgColorPicker:  document.getElementById('bg-color'),
    clearCanvasBtn: document.getElementById('clear-canvas'),
};
const ctx = elements.canvas.getContext('2d');

// =============================================
// STATE
// =============================================
const state = {
    product:         null,
    variants:        [],
    selectedVariant: null,
    side:            'front',

    sides: {
        front: { overlayImage: null, overlayX: 0, overlayY: 0, overlayW: 0, overlayH: 0, overlayRotation: 0, scale: 1.0 },
        back:  { overlayImage: null, overlayX: 0, overlayY: 0, overlayW: 0, overlayH: 0, overlayRotation: 0, scale: 1.0 },
    },

    baseImages:   { front: new Image(), back: new Image() },
    imagesLoaded: { front: false, back: false },

    isDragging:    false,
    isResizing:    false,
    resizeHandle:  null,
    dragStartX:    0, dragStartY:    0,
    resizeStartX:  0, resizeStartY:  0,
    resizeStartW:  0, resizeStartH:  0,
    resizeStartOX: 0, resizeStartOY: 0,

    canvasScale:     1,
    initialDistance: null,
    initialScale:    1,

    selectedArt:    null,
    artistCut:      0,
    variantPricing: new Map(),
    isArtMode:      false,
    hasFront:       true,
    hasBack:        false,
};

function activeSide() { return state.sides[state.side]; }

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    try {
        await waitForFirebase();

        const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                               sessionStorage.getItem('currentFirestoreUserId');
        if (!firestoreUserId) throw new Error('Please log in again.');

        loadSessionData();
        updateSideControls();
        loadSelectedArt();          // must run first — sets state.artistCut from art price
        buildPricingFromCatalog();  // uses state.artistCut
        renderVariantOptions();
        updatePricingDisplay();
        setupEventListeners();
        preloadBaseImages();
        updateCanvasScale();

    } catch (err) {
        console.error('Init error:', err);
        alert(err.message);
        window.location.href = 'profile.html';
    }
}

// =============================================
// SESSION DATA
// =============================================
function loadSessionData() {
    const productData = sessionStorage.getItem('selectedProduct');
    const variantData = sessionStorage.getItem('selectedVariants');
    if (!productData) throw new Error('No product selected.');
    if (!variantData) throw new Error('No variant selected.');

    state.product  = JSON.parse(productData);
    state.variants = JSON.parse(variantData);

    state.variants = state.variants.map(v => ({ ...v, id: v.sku || v.id }));

    const _seen = new Set();
    state.variants = state.variants.filter(v => {
        const key = `${v.id}|${v.color}|${v.size}`;
        if (_seen.has(key)) return false;
        _seen.add(key);
        return true;
    });

    state.selectedVariant = state.variants[0] || null;
    if (!state.selectedVariant) throw new Error('No variants available.');

    state.hasFront = !!(state.product.printAreas?.front);
    state.hasBack  = !!(state.product.printAreas?.back);

    if (!state.hasFront && state.hasBack) state.side = 'back';

    console.log('Product:', state.product.id, '| Front:', state.hasFront, '| Back:', state.hasBack);
}

// =============================================
// ART LOADING
// =============================================
function loadSelectedArt() {
    const artData = sessionStorage.getItem('selectedArt');
    if (!artData) {
        alert('No art selected. Please choose an art first.');
        window.location.href = 'select-product-client.html';
        return;
    }

    try {
        state.selectedArt = JSON.parse(artData);
        console.log('Selected art loaded:', state.selectedArt);

        // Set artistCut from the art's price so pricing builds correctly
        state.artistCut = roundTwo(parseFloat(state.selectedArt.totalPrice || state.selectedArt.price) || 0);

        const artNameEl  = document.getElementById('art-name');
        const artPriceEl = document.getElementById('art-price');
        if (artNameEl)  artNameEl.textContent  = state.selectedArt.name || 'Untitled Art';
        if (artPriceEl) artPriceEl.textContent = `Art price: ${formatCurrency(state.artistCut)}`;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            ['front', 'back'].forEach(side => {
                if (!state.product.printAreas?.[side]) return;
                const sd = state.sides[side];
                sd.overlayImage    = img;
                sd.overlayRotation = 0;
                sd.scale           = 1.0;
                const prevSide = state.side;
                state.side = side;
                initializeOverlayPosition();
                state.side = prevSide;
            });
            renderCanvas();
        };
        img.onerror = () => {
            console.error('Failed to load art image:', state.selectedArt.downloadURL);
            alert('Failed to load art image. Please try again.');
            window.location.href = 'select-product-client.html';
        };
        img.src = state.selectedArt.downloadURL + '?t=' + Date.now();

    } catch (e) {
        console.error('Error loading selected art:', e);
        alert('Failed to load art. Please try again.');
        window.location.href = 'select-product-client.html';
    }
}

// =============================================
// PRICING
// =============================================
function roundTwo(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function formatCurrency(n) { return `R$ ${roundTwo(n).toFixed(2)}`; }

function buildPricingFromCatalog() {
    state.variantPricing.clear();
    state.variants.forEach(v => {
        const productPrice = roundTwo(parseFloat(v.price) || 0);
        const platformFee  = PLATFORM_FEE_FIXED;
        const totalPrice   = roundTwo(productPrice + platformFee + state.artistCut);
        state.variantPricing.set(v.id, {
            product_price: productPrice,
            artist_cut:    state.artistCut,
            platform_fee:  platformFee,
            total_price:   totalPrice,
        });
    });
}

function recalcPricing() {
    state.variantPricing.forEach((p, id) => {
        p.artist_cut  = state.artistCut;
        p.total_price = roundTwo(p.product_price + p.platform_fee + state.artistCut);
        state.variantPricing.set(id, p);
    });
}

function updatePricingDisplay() {
    const v = state.selectedVariant;
    const p = v ? state.variantPricing.get(v.id) : null;

    // Populate the individual price row elements in canvas-client.html
    const baseEl        = document.getElementById('base-price');
    const artPriceDisp  = document.getElementById('art-price-display');
    const artNameDisp   = document.getElementById('art-name-display');
    const platformFeeEl = document.getElementById('platform-fee');
    const totalEl       = document.getElementById('total-price');

    if (baseEl)        baseEl.textContent        = formatCurrency(p?.product_price ?? 0);
    if (artPriceDisp)  artPriceDisp.textContent  = formatCurrency(p?.artist_cut    ?? 0);
    if (artNameDisp)   artNameDisp.textContent   = state.selectedArt?.name || '';
    if (platformFeeEl) platformFeeEl.textContent = formatCurrency(p?.platform_fee  ?? 0);
    if (totalEl)       totalEl.innerHTML         = `<strong>${formatCurrency(p?.total_price ?? 0)}</strong>`;

    showDetailedPricing();
}

function showDetailedPricing() {
    let container = document.getElementById('variant-pricing-details');
    if (!container) {
        container = document.createElement('div');
        container.id = 'variant-pricing-details';
        container.style.cssText = 'margin-top:15px;padding:15px;background:#f8f9fa;border-radius:6px;border:1px solid #dee2e6;';
        document.getElementById('pricing-section')?.appendChild(container);
    }

    const byColor = {};
    state.variants.forEach(v => {
        const c = v.color || 'Default';
        if (!byColor[c]) byColor[c] = [];
        byColor[c].push(v);
    });

    let html = '<h4 style="margin-bottom:12px;color:#333;">Price Breakdown</h4>';
    Object.entries(byColor).forEach(([color, variants]) => {
        const hex = variants[0].color_code || '#ccc';
        html += `<div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="width:14px;height:14px;border-radius:50%;background:${hex};border:1px solid #ccc;display:inline-block;"></span>
                <strong style="color:#555;">${color}</strong>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-left:22px;">
                <thead><tr style="border-bottom:2px solid #dee2e6;">
                    <th style="text-align:left;padding:6px 4px;color:#555;font-size:.85rem;">Size</th>
                    <th style="text-align:right;padding:6px 4px;color:#555;font-size:.85rem;">Base</th>
                    <th style="text-align:right;padding:6px 4px;color:#555;font-size:.85rem;">Artist</th>
                    <th style="text-align:right;padding:6px 4px;color:#555;font-size:.85rem;">Fee (R$ 5,00)</th>
                    <th style="text-align:right;padding:6px 4px;color:#555;font-size:.85rem;">Total</th>
                </tr></thead><tbody>`;

        variants.forEach(v => {
            const p = state.variantPricing.get(v.id);
            if (!p) return;
            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px 4px;font-size:.85rem;">${v.size || '—'}</td>
                <td style="text-align:right;padding:6px 4px;font-size:.85rem;">${formatCurrency(p.product_price)}</td>
                <td style="text-align:right;padding:6px 4px;font-size:.85rem;">${formatCurrency(p.artist_cut)}</td>
                <td style="text-align:right;padding:6px 4px;font-size:.85rem;">${formatCurrency(p.platform_fee)}</td>
                <td style="text-align:right;padding:6px 4px;font-size:.85rem;"><strong>${formatCurrency(p.total_price)}</strong></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
    });

    html += `<div style="margin-top:10px;padding:8px;background:#e9ecef;border-radius:4px;font-size:.85rem;color:#495057;">
        <strong>Formula:</strong> Total = Dimona base cost + Art price + R$ 5.00 (platform fee)
    </div>`;
    container.innerHTML = html;
}

// =============================================
// VARIANT OPTIONS
// =============================================
function renderVariantOptions() {
    const variantSelection = document.getElementById('variant-selection');
    if (!variantSelection || !state.variants.length) return;
    const byColor = {};
    state.variants.forEach(v => {
        const c = v.color || 'N/A';
        if (!byColor[c]) byColor[c] = [];
        byColor[c].push(v);
    });

    let html = '';
    Object.entries(byColor).forEach(([color, variants]) => {
        const hex = variants[0].color_code || '#ccc';
        html += `<div class="color-group mb-3">
            <div class="color-header d-flex align-items-center mb-2">
                <span class="color-indicator me-2" style="background:${hex};width:20px;height:20px;border-radius:50%;border:1px solid #ddd;display:inline-block;"></span>
                <strong>${color}</strong>
            </div>
            <div class="size-options d-flex flex-wrap gap-2">`;
        variants.forEach(v => {
            const selected = v.id === state.selectedVariant?.id;
            html += `<div class="variant-option ${selected ? 'selected' : ''}" data-id="${v.id}">${v.size || 'One size'}</div>`;
        });
        html += `</div></div>`;
    });
    variantSelection.innerHTML = html;
}


function preloadBaseImages() {
    const productId    = state.product?.id;
    const productTitle = state.product?.title;
    if (!productId) return;

    const baseName = (productTitle || productId).replace(/^Dimona\s+/i, '');

    ['front', 'back'].forEach(side => {
        state.baseImages[side].onload = () => {
            state.imagesLoaded[side] = true;
            if (side === state.side) {
                elements.canvas.width  = state.baseImages[side].width;
                elements.canvas.height = state.baseImages[side].height;
                updateCanvasScale();
                renderCanvas();
            }
        };
        state.baseImages[side].onerror = () => {
            console.warn(`Flatlay not found: images/flatlays/${baseName}-base-${side}.png`);
            state.imagesLoaded[side] = true;
            if (side === state.side) renderCanvas();
        };
        state.baseImages[side].src = `images/flatlays/${encodeURIComponent(baseName)}-base-${side}.png`;
    });
}

// =============================================
// RENDER
// =============================================
function renderCanvas() {
    const { canvas } = elements;
    const sd = activeSide();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = state.selectedVariant?.color_code || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const baseImg = state.baseImages[state.side];
    if (baseImg.complete && baseImg.naturalWidth > 0) {
        ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    }

    const printArea = getPrintAreaPx(state.product, state.side);
    if (printArea) drawPrintAreaGuide(printArea);

    if (sd.overlayImage) {
        drawOverlay(sd, printArea);
        drawTransformHandles(sd);
    }
}

function drawPrintAreaGuide(area) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,0,0.6)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(area.x, area.y, area.width, area.height);
    const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
    ctx.beginPath();
    ctx.moveTo(area.x, cy); ctx.lineTo(area.x + area.width, cy);
    ctx.moveTo(cx, area.y); ctx.lineTo(cx, area.y + area.height);
    ctx.stroke();
    ctx.restore();
}

function drawOverlay(sd, printArea) {
    ctx.save();
    if (printArea) {
        ctx.beginPath();
        ctx.rect(printArea.x, printArea.y, printArea.width, printArea.height);
        ctx.clip();
    }
    const rotation = (sd.overlayRotation || 0) * Math.PI / 180;
    if (rotation !== 0) {
        const cx = sd.overlayX + sd.overlayW / 2;
        const cy = sd.overlayY + sd.overlayH / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.drawImage(sd.overlayImage, -sd.overlayW / 2, -sd.overlayH / 2, sd.overlayW, sd.overlayH);
    } else {
        ctx.drawImage(sd.overlayImage, sd.overlayX, sd.overlayY, sd.overlayW, sd.overlayH);
    }
    ctx.restore();
}

function drawTransformHandles(sd) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,120,255,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(sd.overlayX, sd.overlayY, sd.overlayW, sd.overlayH);
    ctx.setLineDash([]);
    const hs = HANDLE_SIZE;
    [
        { x: sd.overlayX,               y: sd.overlayY },
        { x: sd.overlayX + sd.overlayW, y: sd.overlayY },
        { x: sd.overlayX,               y: sd.overlayY + sd.overlayH },
        { x: sd.overlayX + sd.overlayW, y: sd.overlayY + sd.overlayH },
    ].forEach(p => {
        ctx.fillStyle   = '#fff';
        ctx.strokeStyle = 'rgba(0,120,255,1)';
        ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    });
    ctx.restore();
}

// =============================================
// SIDE SWITCHING
// =============================================
function updateSideControls() {
    const viewButtons = document.getElementById('view-buttons');
    const saveSide    = document.getElementById('save-side');
    const isTwoSided  = state.product?.sides === 2;

    if (viewButtons) {
        viewButtons.style.display = isTwoSided ? '' : 'none';
    }
    if (saveSide) {
        saveSide.style.display = isTwoSided ? '' : 'none';
    }

    if (!isTwoSided) {
        state.side = 'front';
        state.hasBack = false;
    }

    updateSideButtons();
}

function updateSideButtons() {
    const showFront = !!state.hasFront;
    const showBack  = state.product?.sides === 2 && !!state.hasBack;

    if (elements.frontBtn) elements.frontBtn.style.display = showFront ? '' : 'none';
    if (elements.backBtn)  elements.backBtn.style.display  = showBack  ? '' : 'none';

    elements.frontBtn?.classList.toggle('active', state.side === 'front');
    elements.backBtn?.classList.toggle('active',  state.side === 'back');
}

function switchSide(newSide) {
    if (newSide === state.side) return;
    state.side = newSide;
    updateSideButtons();
    const baseImg = state.baseImages[newSide];
    if (baseImg.complete && baseImg.naturalWidth > 0) {
        elements.canvas.width  = baseImg.width;
        elements.canvas.height = baseImg.height;
        updateCanvasScale();
    }
    renderCanvas();
}

// =============================================
// OVERLAY POSITION
// =============================================
function initializeOverlayPosition() {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    const printArea = getPrintAreaPx(state.product, state.side);
    const cx   = printArea ? printArea.x + printArea.width  / 2 : elements.canvas.width  / 2;
    const cy   = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
    const maxW = printArea ? printArea.width  * 0.8 : elements.canvas.width  * 0.5;
    const maxH = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
    const fit  = Math.min(maxW / sd.overlayImage.width, maxH / sd.overlayImage.height);
    sd.overlayW = sd.overlayImage.width  * fit * sd.scale;
    sd.overlayH = sd.overlayImage.height * fit * sd.scale;
    sd.overlayX = cx - sd.overlayW / 2;
    sd.overlayY = cy - sd.overlayH / 2;
}

// =============================================
// SCALE & ROTATE
// =============================================
function handleScaleChange(event) {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    const newScale  = parseInt(event.target.value) / 100;
    document.getElementById('scale-value').textContent = `${event.target.value}%`;
    const printArea = getPrintAreaPx(state.product, state.side);
    const cx   = printArea ? printArea.x + printArea.width  / 2 : elements.canvas.width  / 2;
    const cy   = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
    const maxW = printArea ? printArea.width  * 0.8 : elements.canvas.width  * 0.5;
    const maxH = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
    const fit  = Math.min(maxW / sd.overlayImage.width, maxH / sd.overlayImage.height);
    sd.scale    = newScale;
    sd.overlayW = sd.overlayImage.width  * fit * newScale;
    sd.overlayH = sd.overlayImage.height * fit * newScale;
    sd.overlayX = cx - sd.overlayW / 2;
    sd.overlayY = cy - sd.overlayH / 2;
    renderCanvas();
}

function handleRotate() {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    sd.overlayRotation = ((sd.overlayRotation || 0) + 90) % 360;
    const cx = sd.overlayX + sd.overlayW / 2;
    const cy = sd.overlayY + sd.overlayH / 2;
    [sd.overlayW, sd.overlayH] = [sd.overlayH, sd.overlayW];
    sd.overlayX = cx - sd.overlayW / 2;
    sd.overlayY = cy - sd.overlayH / 2;
    renderCanvas();
}

// =============================================
// SAVE PRODUCT
// =============================================
async function handleSaveProduct() {
    const frontSd = state.sides.front;
    const backSd  = state.sides.back;
    const hasFrontArt = state.hasFront && frontSd.overlayImage;
    const hasBackArt  = state.hasBack  && backSd.overlayImage;

    if (!hasFrontArt && !hasBackArt) throw new Error('Add at least one art before saving.');
    if (!state.selectedArt) throw new Error('No art selected.');

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                           sessionStorage.getItem('currentFirestoreUserId');
    if (!firestoreUserId) throw new Error('User not found. Please log in again.');

    if (!firebaseAuth?.currentUser) throw new Error('You are not logged in. Please log in again.');
    const authToken = await firebaseAuth.currentUser.getIdToken(true);

    elements.saveBtn.disabled    = true;
    elements.saveBtn.textContent = 'Saving...';

    try {
        const designs    = {};
        const thumbnails = {};

        for (const side of ['front', 'back']) {
            const sd      = state.sides[side];
            const hasArea = state.product.printAreas?.[side];
            if (!sd.overlayImage || !hasArea) continue;

            const printArea = getPrintAreaPx(state.product, side);
            if (!printArea) continue;

            const printSize = {
                w: cmToPx(hasArea.widthCm),
                h: cmToPx(hasArea.heightCm),
            };

            const artCanvas      = document.createElement('canvas');
            artCanvas.width      = printSize.w;
            artCanvas.height     = printSize.h;
            const artCtx         = artCanvas.getContext('2d');
            const scaleX         = printSize.w / printArea.width;
            const scaleY         = printSize.h / printArea.height;
            const rotation       = (sd.overlayRotation || 0) * Math.PI / 180;

            if (rotation !== 0) {
                const cx = ((sd.overlayX - printArea.x) + sd.overlayW / 2) * scaleX;
                const cy = ((sd.overlayY - printArea.y) + sd.overlayH / 2) * scaleY;
                artCtx.translate(cx, cy);
                artCtx.rotate(rotation);
                artCtx.drawImage(sd.overlayImage, -sd.overlayW * scaleX / 2, -sd.overlayH * scaleY / 2, sd.overlayW * scaleX, sd.overlayH * scaleY);
            } else {
                artCtx.drawImage(
                    sd.overlayImage,
                    (sd.overlayX - printArea.x) * scaleX,
                    (sd.overlayY - printArea.y) * scaleY,
                    sd.overlayW * scaleX,
                    sd.overlayH * scaleY
                );
            }
            designs[side] = artCanvas.toDataURL('image/png');

            const thumbCanvas  = document.createElement('canvas');
            thumbCanvas.width  = thumbCanvas.height = 800;
            const thumbCtx     = thumbCanvas.getContext('2d');
            const baseImg      = state.baseImages[side];
            if (baseImg.complete && baseImg.naturalWidth > 0) {
                const s  = Math.min(800 / baseImg.width, 800 / baseImg.height);
                const w  = baseImg.width  * s, h  = baseImg.height * s;
                const ox = (800 - w) / 2,      oy = (800 - h) / 2;
                thumbCtx.drawImage(baseImg, ox, oy, w, h);

                const tpx = ox + (printArea.x      / baseImg.width)  * w;
                const tpy = oy + (printArea.y      / baseImg.height) * h;
                const tpw =      (printArea.width  / baseImg.width)  * w;
                const tph =      (printArea.height / baseImg.height) * h;
                thumbCtx.save();
                thumbCtx.beginPath();
                thumbCtx.rect(tpx, tpy, tpw, tph);
                thumbCtx.clip();

                const tax = ox + (sd.overlayX / baseImg.width)  * w;
                const tay = oy + (sd.overlayY / baseImg.height) * h;
                const taw =      (sd.overlayW / baseImg.width)  * w;
                const tah =      (sd.overlayH / baseImg.height) * h;
                if (rotation !== 0) {
                    thumbCtx.translate(tax + taw / 2, tay + tah / 2);
                    thumbCtx.rotate(rotation);
                    thumbCtx.drawImage(sd.overlayImage, -taw / 2, -tah / 2, taw, tah);
                } else {
                    thumbCtx.drawImage(sd.overlayImage, tax, tay, taw, tah);
                }
                thumbCtx.restore();
            }
            thumbnails[side] = thumbCanvas.toDataURL('image/png');
        }

        if (Object.keys(designs).length === 0) throw new Error('No print area found for this product.');

        const processedVariants = state.variants.map(v => {
            const p = state.variantPricing.get(v.id);
            return {
                id:         v.id,
                sku:        v.sku || v.id,
                dimona_sku: v.sku || v.id,
                name:       `${state.selectedArt?.name || state.product.id} - ${v.color} - ${v.size}`,
                size:       v.size,
                color:      v.color,
                color_code: v.color_code,
                pricing: {
                    product_price:      p?.product_price || 0,
                    artist_cut:         p?.artist_cut    || 0,
                    platform_fee:       p?.platform_fee  || 0,
                    platform_fee_fixed: PLATFORM_FEE_FIXED,
                    total_price:        p?.total_price   || 0,
                    currency:           'BRL',
                },
                retail_price: p?.total_price || 0,
                price:        p?.total_price || 0,
            };
        });

        const artName = state.selectedArt.name || state.product.id;

        const requestBody = {
            name:            `${firestoreUserId}-${artName}`,
            productTitle:    artName,
            productId:       state.product.id,
            provider:        'dimona',
            designerUserId:  firestoreUserId,
            firebaseUserId:  firebaseAuth.currentUser.uid,
            userEmail:       firebaseAuth.currentUser.email,
            artistUserId:    state.selectedArt?.userId,
            originalArtId:   state.selectedArt?.id,
            designs,
            thumbnails,
            thumbnail: thumbnails.front || thumbnails.back,
            variants:        processedVariants,
            availableColors: [...new Set(processedVariants.map(v => v.color))],
            availableSizes:  [...new Set(processedVariants.map(v => v.size))],
            totalVariants:   processedVariants.length,
            pricing_summary: {
                artist_cut:         state.artistCut,
                platform_fee_fixed: PLATFORM_FEE_FIXED,
                currency:           'BRL',
            },
            firestoreCollection: 'products-client',
            created_at: new Date().toISOString(),
        };

        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveProductDimona', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body:    JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`Server error: ${response.status} — ${txt}`);
        }

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to save product.');

        if (result.firestoreProductId) {
            sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
            sessionStorage.setItem('checkoutProductId',  result.firestoreProductId);
        }

        const cartVariant = state.selectedVariant;
        const cartPricing = state.variantPricing.get(cartVariant.id);

        // Build design/thumbnail URL maps for pagamentos.js compatibility
        const designUrls    = {};
        const thumbnailUrls = {};
        if (result.designUrls) {
            Object.assign(designUrls, result.designUrls);
        } else {
            // Fall back to whatever the server echoed, or reconstruct from known sides
            if (result.design_url)      designUrls.front = result.design_url;
            if (result.design_url_back) designUrls.back  = result.design_url_back;
        }
        if (result.thumbnailUrls) {
            Object.assign(thumbnailUrls, result.thumbnailUrls);
        } else {
            if (result.thumbnailUrl) thumbnailUrls.front = result.thumbnailUrl;
        }

        const cartItem = {
            firestoreProductId: result.firestoreProductId,
            productTitle:       artName,
            product_id:         String(state.product.id),
            title:              artName,
            variant_id:         String(cartVariant.id),
            designer_id:        firestoreUserId,
            designer_email:     firebaseAuth.currentUser.email || '',
            designer_name:      state.selectedArt?.artistName || artName,
            provider:           'dimona',
            // dimona_sku at top level (pagamentos.js checks product.dimona_sku first)
            dimona_sku:         cartVariant.sku || cartVariant.id,
            // design_url / design_url_back at top level (pagamentos.js fallback)
            design_url:         designUrls.front || null,
            design_url_back:    designUrls.back  || null,
            // Structured maps — primary source for pagamentos.js
            designUrls,
            thumbnailUrls,
            selectedVariant: {
                id:           cartVariant.id,
                variant_id:   cartVariant.id,
                sku:          cartVariant.sku || cartVariant.id,
                dimona_sku:   cartVariant.sku || cartVariant.id,
                size:         cartVariant.size,
                color:        cartVariant.color,
                color_code:   cartVariant.color_code,
                price:        cartPricing?.total_price || 0,
                retail_price: cartPricing?.total_price || 0,
                pricing:      cartPricing,
            },
            firestoreCollection: 'products-client',
            pricing: {
                product_price: cartPricing?.product_price || 0,
                artist_cut:    cartPricing?.artist_cut    || 0,
                platform_fee:  cartPricing?.platform_fee  || 0,
                total_price:   cartPricing?.total_price   || 0,
                currency:      'BRL',
            },
            originalArtId:  state.selectedArt?.id,
            artistUserId:   state.selectedArt?.userId,
            designerUserId: firestoreUserId,
            thumbnailUrl: (() => {
                try {
                    const snap = document.createElement('canvas');
                    snap.width = snap.height = 200;
                    snap.getContext('2d').drawImage(elements.canvas, 0, 0, elements.canvas.width, elements.canvas.height, 0, 0, 200, 200);
                    return snap.toDataURL('image/jpeg', 0.7);
                } catch (e) { return null; }
            })(),
            purchaseTimestamp: new Date().toISOString(),
            cartItemId:        Date.now() + Math.random().toString(36).substr(2, 9),
        };

        let cart = JSON.parse(localStorage.getItem('cart') || '[]');
        const existingIdx = cart.findIndex(item =>
            item.firestoreProductId === cartItem.firestoreProductId &&
            item.selectedVariant?.variant_id === cartItem.selectedVariant?.variant_id
        );
        if (existingIdx === -1) {
            cart.push(cartItem);
            localStorage.setItem('cart', JSON.stringify(cart));
        }

        window.location.href = 'carrinho.html';

    } finally {
        elements.saveBtn.disabled    = false;
        elements.saveBtn.textContent = 'Save Product';
    }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
    const variantSelection = document.getElementById('variant-selection');
    if (variantSelection) {
        variantSelection.addEventListener('click', e => {
            const opt = e.target.closest('.variant-option');
            if (!opt) return;
            const v = state.variants.find(v => v.id === opt.dataset.id);
            if (v && v !== state.selectedVariant) {
                state.selectedVariant = v;
                renderVariantOptions();
                updatePricingDisplay();
                renderCanvas();
            }
        });
    }

    elements.frontBtn?.addEventListener('click', () => switchSide('front'));
    elements.backBtn?.addEventListener('click',  () => switchSide('back'));

    document.getElementById('scale-slider')?.addEventListener('input', handleScaleChange);
    document.getElementById('rotate-btn')?.addEventListener('click', handleRotate);

    const cutInput = document.getElementById('artist-cut');
    if (cutInput) {
        cutInput.value = '0.00';
        cutInput.addEventListener('input', e => {
            state.artistCut = roundTwo(parseFloat(e.target.value) || 0);
            e.target.value  = state.artistCut.toFixed(2);
            recalcPricing();
            updatePricingDisplay();
        });
    }

    elements.saveBtn?.addEventListener('click', async () => {
        try {
            await handleSaveProduct();
        } catch (err) {
            console.error('Save error:', err);
            if (err.message.toLowerCase().includes('log in')) {
                alert(err.message);
                window.location.href = 'profile.html';
            } else {
                alert(`Error: ${err.message}`);
            }
        }
    });

    document.getElementById('back-to-profile')?.addEventListener('click', () => {
        window.location.href = 'profile.html';
    });

    elements.canvas.addEventListener('mousedown',  handlePointerDown);
    elements.canvas.addEventListener('mousemove',  handlePointerMove);
    elements.canvas.addEventListener('mouseup',    handlePointerUp);
    elements.canvas.addEventListener('mouseleave', handlePointerUp);
    elements.canvas.addEventListener('dragstart',  e => e.preventDefault());

    elements.canvas.addEventListener('touchstart',  handleTouchStart, { passive: false });
    elements.canvas.addEventListener('touchmove',   handleTouchMove,  { passive: false });
    elements.canvas.addEventListener('touchend',    handleTouchEnd);
    elements.canvas.addEventListener('touchcancel', handleTouchEnd);

    window.addEventListener('resize', () => setTimeout(updateCanvasScale, 100));
}

// =============================================
// POINTER / TOUCH HELPERS
// =============================================
function updateCanvasScale() {
    const rect = elements.canvas.getBoundingClientRect();
    state.canvasScale = elements.canvas.width / rect.width;
}

function getPointerPos(event) {
    const rect = elements.canvas.getBoundingClientRect();
    let clientX, clientY;
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        // FIX: handles touchend where event.touches is empty
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }
    return { x: (clientX - rect.left) * state.canvasScale, y: (clientY - rect.top) * state.canvasScale };
}

function getResizeHandles() {
    const sd = activeSide();
    return {
        tl: { x: sd.overlayX,               y: sd.overlayY },
        tr: { x: sd.overlayX + sd.overlayW,  y: sd.overlayY },
        bl: { x: sd.overlayX,               y: sd.overlayY + sd.overlayH },
        br: { x: sd.overlayX + sd.overlayW,  y: sd.overlayY + sd.overlayH },
    };
}

function getHandleAt(pt) {
    const handles = getResizeHandles();
    for (const [key, pos] of Object.entries(handles)) {
        if (Math.abs(pt.x - pos.x) <= HANDLE_SIZE && Math.abs(pt.y - pos.y) <= HANDLE_SIZE) return key;
    }
    return null;
}

function isInOverlay(pt) {
    const sd = activeSide();
    return pt.x >= sd.overlayX && pt.x <= sd.overlayX + sd.overlayW &&
           pt.y >= sd.overlayY && pt.y <= sd.overlayY + sd.overlayH;
}

// =============================================
// MOUSE HANDLERS
// =============================================
function handlePointerDown(event) {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    const pt     = getPointerPos(event);
    const handle = getHandleAt(pt);
    if (handle) {
        state.isResizing    = true;
        state.resizeHandle  = handle;
        state.resizeStartX  = pt.x; state.resizeStartY  = pt.y;
        state.resizeStartW  = sd.overlayW; state.resizeStartH  = sd.overlayH;
        state.resizeStartOX = sd.overlayX; state.resizeStartOY = sd.overlayY;
        elements.canvas.style.cursor = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' }[handle];
    } else if (isInOverlay(pt)) {
        state.isDragging = true;
        state.dragStartX = pt.x - sd.overlayX;
        state.dragStartY = pt.y - sd.overlayY;
        elements.canvas.style.cursor = 'grabbing';
    }
}

function handlePointerMove(event) {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    const pt = getPointerPos(event);

    if (state.isResizing) {
        const dx = pt.x - state.resizeStartX, dy = pt.y - state.resizeStartY;
        const h  = state.resizeHandle;
        if (h === 'br') { sd.overlayW = Math.max(20, state.resizeStartW + dx); sd.overlayH = Math.max(20, state.resizeStartH + dy); }
        if (h === 'bl') { sd.overlayW = Math.max(20, state.resizeStartW - dx); sd.overlayH = Math.max(20, state.resizeStartH + dy); sd.overlayX = state.resizeStartOX + dx; }
        if (h === 'tr') { sd.overlayW = Math.max(20, state.resizeStartW + dx); sd.overlayH = Math.max(20, state.resizeStartH - dy); sd.overlayY = state.resizeStartOY + dy; }
        if (h === 'tl') { sd.overlayW = Math.max(20, state.resizeStartW - dx); sd.overlayH = Math.max(20, state.resizeStartH - dy); sd.overlayX = state.resizeStartOX + dx; sd.overlayY = state.resizeStartOY + dy; }
        scheduleRender();
    } else if (state.isDragging) {
        sd.overlayX = pt.x - state.dragStartX;
        sd.overlayY = pt.y - state.dragStartY;
        scheduleRender();
    } else {
        const handle  = getHandleAt(pt);
        const cursors = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' };
        elements.canvas.style.cursor = handle ? cursors[handle] : (isInOverlay(pt) ? 'grab' : 'default');
    }
}

function handlePointerUp() {
    state.isDragging = state.isResizing = false;
    state.resizeHandle = null;
    elements.canvas.style.cursor = 'default';
}

// =============================================
// TOUCH HANDLERS
// =============================================
function handleTouchStart(event) {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    if (event.touches.length === 1) {
        const pt = getPointerPos(event);
        // FIX: only start dragging when touch is actually on the art (from canvas-dimona)
        if (isInOverlay(pt)) {
            state.isDragging = true;
            state.dragStartX = pt.x - sd.overlayX;
            state.dragStartY = pt.y - sd.overlayY;
            event.preventDefault();
        }
    } else if (event.touches.length === 2) {
        state.isDragging      = false;
        state.initialDistance = Math.hypot(
            event.touches[1].clientX - event.touches[0].clientX,
            event.touches[1].clientY - event.touches[0].clientY
        );
        state.initialScale = sd.scale;
        event.preventDefault();
    }
}

function handleTouchMove(event) {
    const sd = activeSide();
    if (!sd.overlayImage) return;
    if (event.touches.length === 1 && state.isDragging) {
        const pt = getPointerPos(event);
        sd.overlayX = pt.x - state.dragStartX;
        sd.overlayY = pt.y - state.dragStartY;
        scheduleRender();
        event.preventDefault();
    } else if (event.touches.length === 2 && state.initialDistance) {
        const dist     = Math.hypot(
            event.touches[1].clientX - event.touches[0].clientX,
            event.touches[1].clientY - event.touches[0].clientY
        );
        const newScale = Math.max(0.1, Math.min(5, state.initialScale * (dist / state.initialDistance)));
        const slider   = document.getElementById('scale-slider');
        const label    = document.getElementById('scale-value');
        const val      = Math.round(newScale * 100);
        if (slider) slider.value = val;
        if (label)  label.textContent = `${val}%`;
        const printArea = getPrintAreaPx(state.product, state.side);
        const cx   = printArea ? printArea.x + printArea.width  / 2 : elements.canvas.width  / 2;
        const cy   = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
        const maxW = printArea ? printArea.width  * 0.8 : elements.canvas.width  * 0.5;
        const maxH = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
        const fit  = Math.min(maxW / sd.overlayImage.width, maxH / sd.overlayImage.height);
        sd.scale    = newScale;
        sd.overlayW = sd.overlayImage.width  * fit * newScale;
        sd.overlayH = sd.overlayImage.height * fit * newScale;
        sd.overlayX = cx - sd.overlayW / 2;
        sd.overlayY = cy - sd.overlayH / 2;
        scheduleRender();
        event.preventDefault();
    }
}

function handleTouchEnd() {
    state.isDragging      = false;
    state.initialDistance = null;
    elements.canvas.style.cursor = 'default';
}

// =============================================
// RENDER SCHEDULER
// =============================================
let renderScheduled = false;
function scheduleRender() {
    if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => { renderCanvas(); renderScheduled = false; });
    }
}