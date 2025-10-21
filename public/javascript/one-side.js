// one-side.js - Handles one-sided products (notebooks, stickers, posters)
import { PRINT_AREAS } from './printAreas.js';

const DPI = 300;

// Module-level state reference
let moduleState = null;
let moduleElements = null;
let moduleCtx = null;

export function initialize(state, elements, ctx) {
    console.log("Initializing one-sided product mode");
    
    // Store references to state and elements
    moduleState = state;
    moduleElements = elements;
    moduleCtx = ctx;
    
    state.side = 'front'; // Always use front for one-sided products
    
    // Hide side-related UI elements
    const viewButtons = document.getElementById('view-buttons');
    const saveSideContainer = document.getElementById('save-side');
    
    if (viewButtons) viewButtons.style.display = 'none';
    if (saveSideContainer) saveSideContainer.style.display = 'none';
    
    // Base Images - only front for one-sided products
    const baseImages = { front: new Image() };
    const imagesLoaded = { front: false };
    
    return { baseImages, imagesLoaded };
}

export function preloadBaseImages(productId, baseImages, imagesLoaded) {
    if (!productId) return;
    
    console.log(`Loading one-sided base image for product: ${productId}`);
    
    const handleLoad = () => {
        imagesLoaded.front = true;
        console.log("One-sided base image loaded successfully");
        
        // Update canvas size and render
        if (moduleState && moduleElements && moduleCtx) {
            updateCanvasSize(baseImages.front, moduleElements);
            renderCanvas(moduleState, moduleElements, moduleCtx, baseImages, imagesLoaded);
        }
    };
    
    baseImages.front.onload = handleLoad;
    baseImages.front.onerror = () => {
        console.error('Failed to load base image for product:', productId);
        imagesLoaded.front = true;
    };
    
    // One-sided products use single base image
    baseImages.front.src = `images/flatlays/${productId}-base.png`;
}

export function renderCanvas(state, elements, ctx, baseImages, imagesLoaded) {
    if (!state.selectedVariant || !imagesLoaded.front) {
        console.log("Cannot render: missing variant or image not loaded");
        return;
    }
    
    console.log("Rendering one-sided canvas");
    
    const { canvas } = elements;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Background
    ctx.fillStyle = state.selectedVariant.color_code || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Base image
    const baseImage = baseImages.front;
    if (baseImage.complete && baseImage.naturalWidth > 0) {
        ctx.drawImage(baseImage, 0, 0);
        console.log("Base image drawn");
    }
    
    // Print area and overlay
    const printArea = getPrintArea(state);
    if (printArea) {
        console.log("Drawing print area:", printArea);
        drawPrintArea(printArea, ctx);
    } else {
        console.log("No print area found for product:", state.product?.id);
    }
    
    if (state.overlayImage) {
        console.log("Drawing overlay image");
        drawOverlay(state, ctx, printArea);
        drawControls(state, ctx);
    } else {
        console.log("No overlay image to draw");
    }
}

export function handleSideSwitch(newSide) {
    // One-sided products don't support side switching
    console.log("One-sided product - side switching not supported");
    return 'front'; // Always return front
}

export function getPrintArea(state) {
    if (!state.product?.id) {
        console.log("No product ID available for print area");
        return null;
    }
    
    // One-sided products use 'default' print area
    const area = PRINT_AREAS[state.product.id]?.default || PRINT_AREAS[state.product.id]?.front;
    console.log("Print area lookup:", {
        productId: state.product.id,
        found: !!area,
        area: area
    });
    
    return area ? {
        x: cmToPx(area.xCm),
        y: cmToPx(area.yCm),
        width: cmToPx(area.widthCm),
        height: cmToPx(area.heightCm)
    } : null;
}

export function getSaveSide() {
    // One-sided products always save as 'front'
    console.log("Save side: front (one-sided product)");
    return 'front';
}

export function initializeOverlayPosition(state, elements) {
    if (!state.overlayImage) {
        console.log("No overlay image to initialize position");
        return;
    }
    
    console.log("Initializing overlay position");
    
    const printArea = getPrintArea(state);
    const centerX = printArea ? printArea.x + printArea.width / 2 : elements.canvas.width / 2;
    const centerY = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
    
    const maxWidth = printArea ? printArea.width * 0.8 : elements.canvas.width * 0.5;
    const maxHeight = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
    const scaleToFit = Math.min(maxWidth / state.overlayImage.width, maxHeight / state.overlayImage.height);
    
    state.overlayW = state.overlayImage.width * scaleToFit * state.scale;
    state.overlayH = state.overlayImage.height * scaleToFit * state.scale;
    state.overlayX = centerX - state.overlayW / 2;
    state.overlayY = centerY - state.overlayH / 2;
    
    console.log("Overlay position initialized:", {
        x: state.overlayX,
        y: state.overlayY,
        width: state.overlayW,
        height: state.overlayH
    });
}

export function handleScaleChange(state, elements, scaleValue) {
    if (!state.overlayImage) return;
    
    console.log("Handling scale change:", scaleValue);
    state.scale = scaleValue;
    
    const printArea = getPrintArea(state);
    const centerX = printArea ? printArea.x + printArea.width / 2 : elements.canvas.width / 2;
    const centerY = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
    
    const maxWidth = printArea ? printArea.width * 0.8 : elements.canvas.width * 0.5;
    const maxHeight = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
    const scaleToFit = Math.min(maxWidth / state.overlayImage.width, maxHeight / state.overlayImage.height);
    
    state.overlayW = state.overlayImage.width * scaleToFit * state.scale;
    state.overlayH = state.overlayImage.height * scaleToFit * state.scale;
    
    // Keep the image centered
    state.overlayX = centerX - state.overlayW / 2;
    state.overlayY = centerY - state.overlayH / 2;
    
    // Trigger re-render
    if (moduleCtx && moduleState && moduleElements) {
        renderCanvas(moduleState, moduleElements, moduleCtx, moduleState.moduleState?.baseImages, moduleState.moduleState?.imagesLoaded);
    }
}

// Helper functions
function updateCanvasSize(image, elements) {
    elements.canvas.width = image.width;
    elements.canvas.height = image.height;
    console.log("Canvas size updated to:", image.width, "x", image.height);
}

function drawPrintArea(area, ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(area.x, area.y, area.width, area.height);
    
    // Center guidelines
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    
    ctx.beginPath();
    ctx.moveTo(area.x, centerY);
    ctx.lineTo(area.x + area.width, centerY);
    ctx.moveTo(centerX, area.y);
    ctx.lineTo(centerX, area.y + area.height);
    ctx.stroke();
    
    ctx.restore();
}

function drawOverlay(state, ctx, printArea) {
    ctx.save();
    
    if (printArea) {
        ctx.beginPath();
        ctx.rect(printArea.x, printArea.y, printArea.width, printArea.height);
        ctx.clip();
    }
    
    ctx.drawImage(state.overlayImage, state.overlayX, state.overlayY, state.overlayW, state.overlayH);
    ctx.restore();
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

function cmToPx(cm, dpi = DPI) {
    return Math.round((cm / 2.54) * dpi);
}