// art-mode.js - Handles art creation mode

export function initialize(state, elements, ctx) {
    console.log("Initializing art mode");
    
    // Set canvas to a larger size for art mode
    elements.canvas.width = 1000;
    elements.canvas.height = 1000;
    
    // Initialize with background color
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    
    return { baseImages: {}, imagesLoaded: {} };
}

export function renderCanvas(state, elements, ctx) {
    // For art mode, clear to background color
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    
    if (state.overlayImage) {
        drawOverlay(state, ctx);
        drawControls(state, ctx);
    }
}

export function initializeOverlayPosition(state, elements) {
    if (!state.overlayImage) return;
    
    // For art mode, center on canvas
    const centerX = elements.canvas.width / 2;
    const centerY = elements.canvas.height / 2;
    
    const maxWidth = elements.canvas.width * 0.8;
    const maxHeight = elements.canvas.height * 0.8;
    const scaleToFit = Math.min(maxWidth / state.overlayImage.width, maxHeight / state.overlayImage.height);
    
    state.overlayW = state.overlayImage.width * scaleToFit * state.scale;
    state.overlayH = state.overlayImage.height * scaleToFit * state.scale;
    state.overlayX = centerX - state.overlayW / 2;
    state.overlayY = centerY - state.overlayH / 2;
}

export function handleScaleChange(state, elements, scaleValue) {
    if (!state.overlayImage) return;
    
    state.scale = scaleValue;
    
    const centerX = elements.canvas.width / 2;
    const centerY = elements.canvas.height / 2;
    
    const maxWidth = elements.canvas.width * 0.8;
    const maxHeight = elements.canvas.height * 0.8;
    const scaleToFit = Math.min(maxWidth / state.overlayImage.width, maxHeight / state.overlayImage.height);
    
    state.overlayW = state.overlayImage.width * scaleToFit * state.scale;
    state.overlayH = state.overlayImage.height * scaleToFit * state.scale;
    
    // Keep the image centered
    state.overlayX = centerX - state.overlayW / 2;
    state.overlayY = centerY - state.overlayH / 2;
}

// Helper functions
function drawOverlay(state, ctx) {
    ctx.drawImage(state.overlayImage, state.overlayX, state.overlayY, state.overlayW, state.overlayH);
}

function drawControls(state, ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(state.overlayX, state.overlayY, state.overlayW, state.overlayH);
    
    ctx.fillStyle = 'rgba(0, 150, 255, 0.8)';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(state.overlayX + state.overlayW / 2, state.overlayY + state.overlayH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}