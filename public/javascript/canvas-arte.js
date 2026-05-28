// canvas-arte.js — Art creation canvas
// Plain script, no imports/exports.

// =============================================
// FIREBASE
// =============================================
const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

let firebaseApp, firebaseAuth;
try {
    if (typeof firebase !== 'undefined') {
        try { firebaseApp = firebase.initializeApp(firebaseConfig); }
        catch (e) { if (e.code === 'app/duplicate-app') firebaseApp = firebase.app(); }
        firebaseAuth = firebase.auth();
    }
} catch (e) { console.error('Firebase init error:', e); }

// =============================================
// CONSTANTS
// =============================================
const CANVAS_SIZE    = 1000;   // square canvas for art
const HANDLE_SIZE    = 10;
const PLATFORM_FEE   = 0.05;   // 5%

// =============================================
// DOM
// =============================================
const canvas     = document.getElementById('product-canvas');
const ctx        = canvas.getContext('2d');
const uploadInput = document.getElementById('upload-input');
const saveBtn    = document.getElementById('save-btn');

// =============================================
// STATE
// =============================================
const state = {
    overlayImage:    null,
    overlayX:        0,
    overlayY:        0,
    overlayW:        0,
    overlayH:        0,
    overlayRotation: 0,
    scale:           1.0,
    bgColor:         '#ffffff',
    artPrice:        0,
    artPlatformFee:  0,
    artTotalPrice:   0,

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
};

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                           sessionStorage.getItem('currentFirestoreUserId');
    if (!firestoreUserId) {
        alert('Please log in to continue.');
        window.location.href = 'profile.html';
        return;
    }

    canvas.width  = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    renderCanvas();
    updateCanvasScale();
    setupEventListeners();
});

// =============================================
// RENDER
// =============================================
function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.overlayImage) {
        drawOverlay();
        drawTransformHandles();
    }
}

function drawOverlay() {
    ctx.save();
    const rotation = (state.overlayRotation || 0) * Math.PI / 180;
    if (rotation !== 0) {
        const cx = state.overlayX + state.overlayW / 2;
        const cy = state.overlayY + state.overlayH / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.drawImage(state.overlayImage, -state.overlayW / 2, -state.overlayH / 2, state.overlayW, state.overlayH);
    } else {
        ctx.drawImage(state.overlayImage, state.overlayX, state.overlayY, state.overlayW, state.overlayH);
    }
    ctx.restore();
}

function drawTransformHandles() {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    const hs = HANDLE_SIZE;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,120,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    [{ x, y }, { x: x+w, y }, { x, y: y+h }, { x: x+w, y: y+h }].forEach(p => {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,120,255,1)';
        ctx.fillRect(p.x - hs/2, p.y - hs/2, hs, hs);
        ctx.strokeRect(p.x - hs/2, p.y - hs/2, hs, hs);
    });
    ctx.restore();
}

// =============================================
// OVERLAY POSITION
// =============================================
function initializeOverlayPosition() {
    if (!state.overlayImage) return;
    const maxW = canvas.width  * 0.8;
    const maxH = canvas.height * 0.8;
    const fit  = Math.min(maxW / state.overlayImage.width, maxH / state.overlayImage.height);
    state.overlayW = state.overlayImage.width  * fit * state.scale;
    state.overlayH = state.overlayImage.height * fit * state.scale;
    state.overlayX = canvas.width  / 2 - state.overlayW / 2;
    state.overlayY = canvas.height / 2 - state.overlayH / 2;
}

// =============================================
// FILE UPLOAD
// =============================================
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file?.type.startsWith('image/')) { alert('Please select a valid image.'); return; }

    state.scale = 1.0;
    const slider = document.getElementById('scale-slider');
    const label  = document.getElementById('scale-value');
    if (slider) slider.value = 100;
    if (label)  label.textContent = '100%';

    const reader = new FileReader();
    reader.onload = evt => {
        const img = new Image();
        img.onload = () => {
            state.overlayImage    = img;
            state.overlayRotation = 0;
            initializeOverlayPosition();
            renderCanvas();
        };
        img.onerror = () => alert('Error loading image.');
        img.src = evt.target.result;
    };
    reader.onerror = () => alert('Error reading file.');
    reader.readAsDataURL(file);
}

// =============================================
// SCALE, ROTATE, CLEAR, BG COLOR
// =============================================
function handleScaleChange(event) {
    if (!state.overlayImage) return;
    state.scale = parseInt(event.target.value) / 100;
    document.getElementById('scale-value').textContent = `${event.target.value}%`;
    initializeOverlayPosition();
    renderCanvas();
}

function handleRotate() {
    if (!state.overlayImage) return;
    state.overlayRotation = ((state.overlayRotation || 0) + 90) % 360;
    const cx = state.overlayX + state.overlayW / 2;
    const cy = state.overlayY + state.overlayH / 2;
    [state.overlayW, state.overlayH] = [state.overlayH, state.overlayW];
    state.overlayX = cx - state.overlayW / 2;
    state.overlayY = cy - state.overlayH / 2;
    renderCanvas();
}

function handleClearCanvas() {
    state.overlayImage    = null;
    state.overlayRotation = 0;
    renderCanvas();
}

function handleBgColorChange(event) {
    state.bgColor = event.target.value;
    renderCanvas();
}

// =============================================
// PRICING
// =============================================
function roundTwo(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function formatCurrency(n) { return `R$ ${roundTwo(n).toFixed(2)}`; }

function updatePricingDisplay() {
    const input    = document.getElementById('art-price');
    const feeEl    = document.getElementById('art-platform-fee');
    const totalEl  = document.getElementById('art-total-price');
    if (!input) return;

    state.artPrice       = roundTwo(parseFloat(input.value) || 0);
    input.value          = state.artPrice.toFixed(2);
    state.artPlatformFee = roundTwo(state.artPrice * PLATFORM_FEE);
    state.artTotalPrice  = roundTwo(state.artPrice + state.artPlatformFee);

    if (feeEl)   feeEl.textContent   = formatCurrency(state.artPlatformFee);
    if (totalEl) totalEl.textContent = formatCurrency(state.artTotalPrice);
}

// =============================================
// SAVE ART
// =============================================
async function handleSaveArt() {
    if (!state.overlayImage) throw new Error('Please upload an image first.');

    const artName = document.getElementById('art-name').value.trim();
    if (!artName) throw new Error('Please enter an art name.');

    if (state.artPrice <= 0) throw new Error('Please enter a price for your art.');

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') ||
                           sessionStorage.getItem('currentFirestoreUserId');
    if (!firestoreUserId) throw new Error('User not found. Please log in again.');

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving...';

    try {
        // Export the art at its natural resolution
        const tempCanvas      = document.createElement('canvas');
        tempCanvas.width      = state.overlayImage.naturalWidth;
        tempCanvas.height     = state.overlayImage.naturalHeight;
        tempCanvas.getContext('2d').drawImage(state.overlayImage, 0, 0);
        const artData = tempCanvas.toDataURL('image/png');

        const filename = `${firestoreUserId}-${artName.replace(/\s+/g, '-').toLowerCase()}`;

        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveArt', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                artData,
                filename,
                artName,
                userId:      firestoreUserId,
                price:       roundTwo(state.artPrice),
                platformFee: roundTwo(state.artPlatformFee),
                totalPrice:  roundTwo(state.artTotalPrice),
                bgColor:     state.bgColor,
            }),
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Failed to save art.');

        alert('Art saved successfully!');
        window.location.href = 'profile.html';

    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Art';
    }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
    document.getElementById('upload-btn')
        ?.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', handleFileUpload);

    document.getElementById('scale-slider')
        ?.addEventListener('input', handleScaleChange);
    document.getElementById('rotate-btn')
        ?.addEventListener('click', handleRotate);
    document.getElementById('clear-canvas')
        ?.addEventListener('click', handleClearCanvas);
    document.getElementById('bg-color')
        ?.addEventListener('input', handleBgColorChange);
    document.getElementById('art-price')
        ?.addEventListener('input', updatePricingDisplay);

    document.getElementById('back-to-profile')
        ?.addEventListener('click', () => window.location.href = 'profile.html');

    saveBtn.addEventListener('click', async () => {
        try {
            await handleSaveArt();
        } catch (err) {
            console.error('Save error:', err);
            alert(`Error: ${err.message}`);
        }
    });

    // Mouse
    canvas.addEventListener('mousedown',  handlePointerDown);
    canvas.addEventListener('mousemove',  handlePointerMove);
    canvas.addEventListener('mouseup',    handlePointerUp);
    canvas.addEventListener('mouseleave', handlePointerUp);
    canvas.addEventListener('dragstart',  e => e.preventDefault());

    // Touch
    canvas.addEventListener('touchstart',  handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove',   handleTouchMove,  { passive: false });
    canvas.addEventListener('touchend',    handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    window.addEventListener('resize', () => setTimeout(updateCanvasScale, 100));
    window.addEventListener('beforeunload', () => sessionStorage.removeItem('creationMode'));
}

// =============================================
// CANVAS SCALE
// =============================================
function updateCanvasScale() {
    const rect = canvas.getBoundingClientRect();
    state.canvasScale = canvas.width / rect.width;
}

// =============================================
// POINTER HELPERS
// =============================================
function getPointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }
    return {
        x: (clientX - rect.left) * state.canvasScale,
        y: (clientY - rect.top)  * state.canvasScale,
    };
}

function isInOverlay(pt) {
    return pt.x >= state.overlayX && pt.x <= state.overlayX + state.overlayW &&
           pt.y >= state.overlayY && pt.y <= state.overlayY + state.overlayH;
}

function getResizeHandles() {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    return {
        tl: { x,     y },
        tr: { x: x+w, y },
        bl: { x,     y: y+h },
        br: { x: x+w, y: y+h },
    };
}

function getHandleAt(pt) {
    for (const [key, pos] of Object.entries(getResizeHandles())) {
        if (Math.abs(pt.x - pos.x) <= HANDLE_SIZE && Math.abs(pt.y - pos.y) <= HANDLE_SIZE) return key;
    }
    return null;
}

// =============================================
// POINTER / TOUCH HANDLERS
// =============================================
function handlePointerDown(event) {
    if (!state.overlayImage) return;
    const pt     = getPointerPos(event);
    const handle = getHandleAt(pt);

    if (handle) {
        state.isResizing    = true;
        state.resizeHandle  = handle;
        state.resizeStartX  = pt.x; state.resizeStartY  = pt.y;
        state.resizeStartW  = state.overlayW; state.resizeStartH  = state.overlayH;
        state.resizeStartOX = state.overlayX; state.resizeStartOY = state.overlayY;
        canvas.style.cursor = { tl:'nw-resize', tr:'ne-resize', bl:'sw-resize', br:'se-resize' }[handle];
    } else if (isInOverlay(pt)) {
        state.isDragging  = true;
        state.dragStartX  = pt.x - state.overlayX;
        state.dragStartY  = pt.y - state.overlayY;
        canvas.style.cursor = 'grabbing';
    }
}

function handlePointerMove(event) {
    if (!state.overlayImage) return;
    const pt = getPointerPos(event);

    if (state.isResizing) {
        const dx = pt.x - state.resizeStartX, dy = pt.y - state.resizeStartY;
        const ar = state.resizeStartW / state.resizeStartH;
        const h  = state.resizeHandle;
        let newW = state.resizeStartW, newX = state.resizeStartOX, newY = state.resizeStartOY;

        if (h === 'br') { newW = Math.max(20, state.resizeStartW + dx); }
        if (h === 'bl') { newW = Math.max(20, state.resizeStartW - dx); newX = state.resizeStartOX + state.resizeStartW - newW; }
        if (h === 'tr') { newW = Math.max(20, state.resizeStartW + dx); newY = state.resizeStartOY + state.resizeStartH - newW / ar; }
        if (h === 'tl') { newW = Math.max(20, state.resizeStartW - dx); newX = state.resizeStartOX + state.resizeStartW - newW; newY = state.resizeStartOY + state.resizeStartH - newW / ar; }

        state.overlayW = newW;
        state.overlayH = newW / ar;
        state.overlayX = newX;
        state.overlayY = newY;
        scheduleRender();
    } else if (state.isDragging) {
        state.overlayX = pt.x - state.dragStartX;
        state.overlayY = pt.y - state.dragStartY;
        scheduleRender();
    } else {
        const handle  = getHandleAt(pt);
        const cursors = { tl:'nw-resize', tr:'ne-resize', bl:'sw-resize', br:'se-resize' };
        canvas.style.cursor = handle ? cursors[handle] : (isInOverlay(pt) ? 'grab' : 'default');
    }
}

function handlePointerUp() {
    state.isDragging = state.isResizing = false;
    state.resizeHandle = null;
    canvas.style.cursor = 'default';
}

function handleTouchStart(event) {
    if (!state.overlayImage) return;
    if (event.touches.length === 1) {
        const pt = getPointerPos(event);
        state.isDragging = true;
        state.dragStartX = pt.x - state.overlayX;
        state.dragStartY = pt.y - state.overlayY;
        event.preventDefault();
    } else if (event.touches.length === 2) {
        state.isDragging      = false;
        state.initialDistance = Math.hypot(
            event.touches[1].clientX - event.touches[0].clientX,
            event.touches[1].clientY - event.touches[0].clientY
        );
        state.initialScale = state.scale;
        event.preventDefault();
    }
}

function handleTouchMove(event) {
    if (!state.overlayImage) return;
    event.preventDefault();
    if (event.touches.length === 1 && state.isDragging) {
        const pt = getPointerPos(event);
        state.overlayX = pt.x - state.dragStartX;
        state.overlayY = pt.y - state.dragStartY;
        scheduleRender();
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
        state.scale = newScale;
        initializeOverlayPosition();
        scheduleRender();
    }
}

function handleTouchEnd() {
    state.isDragging      = false;
    state.initialDistance = null;
    canvas.style.cursor   = 'default';
}

let renderScheduled = false;
function scheduleRender() {
    if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => { renderCanvas(); renderScheduled = false; });
    }
}