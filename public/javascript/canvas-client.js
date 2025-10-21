// canvas-client.js - Main controller for client product customization
import { PRINT_AREAS } from './printAreas.js';
import * as ClientOneSideModule from './client-one-side.js';
import * as ClientTwoSideModule from './client-two-side.js';

// Constants
const DPI = 300;

// Physical dimensions for Printful (in inches)
const PHYSICAL_PRINT_AREAS = {
  71: { front: { widthInches: 20, heightInches: 24 }, back: { widthInches: 14, heightInches: 16 } },
  146: { front: { widthInches: 14, heightInches: 14 }, back: { widthInches: 14, heightInches: 16 } },
  19: { default: { widthInches: 8.5, heightInches: 3.5 } }
};

// DOM Elements (cached)
const elements = {
  canvas: document.getElementById('product-canvas'),
  variantSelection: document.getElementById('variant-selection'),
  frontBtn: document.getElementById('front-btn'),
  backBtn: document.getElementById('back-btn'),
  saveBtn: document.getElementById('save-btn'),
  saveSideFront: document.querySelector('input[name="saveSide"][value="front"]'),
  saveSideBack: document.querySelector('input[name="saveSide"][value="back"]'),
  productNameInput: document.getElementById('item-name'),
  artInfo: document.getElementById('art-info'),
  artName: document.getElementById('art-name'),
  artDescription: document.getElementById('art-description'),
  artPrice: document.getElementById('art-price')
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
  isDragging: false,
  dragStartX: 0, dragStartY: 0,
  scale: 1.0,
  basePrice: 0,
  totalPrice: 0,
  pricingLoaded: false,
  selectedArt: null,
  currentModule: null,
  moduleState: {}
};

// Product type detection
function getProductType(productId) {
  const TWO_SIDED_PRODUCTS = [71, 146]; // tshirts, hoodies
  return TWO_SIDED_PRODUCTS.includes(parseInt(productId)) ? 'two-sided' : 'one-sided';
}

// Initialize
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  try {
    // Get Firestore user ID
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                           sessionStorage.getItem('currentFirestoreUserId');
    
    if (!firestoreUserId) {
      console.error("No Firestore user ID found in session storage");
      alert('User information not found. Please log in again.');
      window.location.href = 'profile.html';
      return;
    }

    // Load session data first
    loadSessionData();
    
    // Determine product type and load appropriate module
    const productType = getProductType(state.product?.id);
    console.log(`Loading ${productType} product module for product ID: ${state.product?.id}`);
    
    if (productType === 'two-sided') {
      state.currentModule = ClientTwoSideModule;
    } else {
      state.currentModule = ClientOneSideModule;
    }
    
    // Initialize the module
    const moduleState = state.currentModule.initialize(state, elements, ctx);
    state.moduleState = { ...state.moduleState, ...moduleState };
    
    // Setup UI
    renderVariantOptions();
    setupEventListeners();
    
    // Load art and fetch pricing
    await loadSelectedArt();
    fetchProductPricing();

  } catch (error) {
    console.error('Failed to initialize app:', error);
    alert('Failed to initialize product customization. Please try again.');
  }
}

// Simple CORS-enabled image loading
async function loadSelectedArt() {
    const selectedArtData = sessionStorage.getItem('selectedArt');
    if (!selectedArtData) {
        alert('No art selected. Please choose an art first.');
        window.location.href = 'shared-arts.html';
        return;
    }
    
    try {
        const artData = JSON.parse(selectedArtData);
        console.log("Loading selected art:", artData);
        state.selectedArt = artData;
        
        // Update art info display
        if (elements.artName) elements.artName.textContent = artData.name || 'Untitled Art';
        if (elements.artDescription) elements.artDescription.textContent = artData.description || '';
        if (elements.artPrice) elements.artPrice.textContent = `R$ ${(artData.totalPrice || artData.price || 0).toFixed(2)}`;
        
        console.log("Loading art image with CORS from:", artData.downloadURL);
        
        // Load image with CORS enabled
        await loadImageWithCORS(artData.downloadURL);
        
        console.log("✅ Art image loaded successfully with CORS!");
        
    } catch (error) {
        console.error('Error loading selected art:', error);
        alert('Failed to load art image. Please try again.');
        window.location.href = 'shared-arts.html';
    }
}

function loadImageWithCORS(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        // Enable CORS - this should now work!
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            console.log("✅ Image loaded successfully with CORS");
            state.overlayImage = img;
            initializeOverlayPosition();
            renderCanvas();
            resolve();
        };
        
        img.onerror = (error) => {
            console.error('❌ CORS image load failed:', error);
            reject(new Error('Failed to load image with CORS'));
        };
        
        // Add cache busting to ensure fresh load
        img.src = url + '?t=' + Date.now();
    });
}

function loadSessionData() {
  const productData = sessionStorage.getItem('selectedProduct');
  const variantData = sessionStorage.getItem('selectedVariants');
  const artData = sessionStorage.getItem('selectedArt');
  
  if (!productData || !variantData) {
    throw new Error('No product or variant data found');
  }
  
  state.product = JSON.parse(productData);
  state.variants = JSON.parse(variantData);
  state.selectedVariant = state.variants[0] || null;
  
  if (artData) {
    state.selectedArt = JSON.parse(artData);
  }
  
  if (!state.selectedVariant) {
    throw new Error('No variants available');
  }
}

function renderVariantOptions() {
  if (!state.variants.length) return;
  
  elements.variantSelection.innerHTML = state.variants.map(variant => {
    const isSelected = variant.id === state.selectedVariant?.id;
    const colorCode = variant.color_code || '#ccc';
    
    return `
      <div class="variant-option ${isSelected ? 'selected' : ''}" 
           data-id="${variant.id}">
        <span class="color-indicator" style="background: ${colorCode}"></span>
        ${variant.color || 'N/A'}
      </div>
    `;
  }).join('');
}

function renderCanvas() {
    if (!state.currentModule) return;
    
    state.currentModule.renderCanvas(state, elements, ctx, state.moduleState.baseImages, state.moduleState.imagesLoaded);
}

function initializeOverlayPosition() {
    if (!state.currentModule?.initializeOverlayPosition) return;
    state.currentModule.initializeOverlayPosition(state, elements);
}

function handleVariantSelection(event) {
  const variantOption = event.target.closest('.variant-option');
  if (!variantOption) return;
  
  const variantId = parseInt(variantOption.dataset.id);
  const newVariant = state.variants.find(v => v.id === variantId);
  
  if (newVariant && newVariant !== state.selectedVariant) {
    state.selectedVariant = newVariant;
    renderVariantOptions();
    renderCanvas();
    fetchProductPricing();
  }
}

function handleScaleChange(event) {
    if (!state.overlayImage || !state.currentModule?.handleScaleChange) return;
    
    const scaleValue = parseInt(event.target.value) / 100;
    state.currentModule.handleScaleChange(state, elements, scaleValue);
    document.getElementById('scale-value').textContent = `${event.target.value}%`;
    renderCanvas();
}

function handleSideSwitch(newSide) {
    if (!state.currentModule?.handleSideSwitch) return;
    
    const result = state.currentModule.handleSideSwitch(newSide, state, elements, state.moduleState.baseImages, state.moduleState.imagesLoaded);
    if (result) {
        state.side = result;
    }
}

async function fetchProductPricing() {
  if (!state.selectedVariant) return;
  
  try {
    const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/getProductPricing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: state.product.id,
        variantId: state.selectedVariant.id
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        state.basePrice = result.basePrice;
        updateTotalPrice();
        state.pricingLoaded = true;
      }
    }
  } catch (error) {
    console.error('Error fetching pricing:', error);
    state.basePrice = state.selectedVariant.retail_price || 29.99;
    updateTotalPrice();
  }
}

function updateTotalPrice() {
  const artPrice = state.selectedArt?.totalPrice || state.selectedArt?.price || 0;
  state.totalPrice = artPrice + state.basePrice;
  
  const totalPriceElement = document.getElementById('total-price');
  if (totalPriceElement) {
    totalPriceElement.textContent = `R$ ${state.totalPrice.toFixed(2)}`;
  }
  
  const basePriceElement = document.getElementById('base-price');
  const artPriceElement = document.getElementById('art-price-display');
  
  if (basePriceElement) {
    basePriceElement.textContent = `R$ ${state.basePrice.toFixed(2)}`;
  }
  if (artPriceElement) {
    artPriceElement.textContent = `R$ ${artPrice.toFixed(2)}`;
  }
}

// Pointer event handlers
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

function handlePointerDown(event) {
  if (!state.overlayImage) return;
  
  const pointerPos = getPointerPosition(event);
  if (isPointInOverlay(pointerPos)) {
    state.isDragging = true;
    state.dragStartX = pointerPos.x - state.overlayX;
    state.dragStartY = pointerPos.y - state.overlayY;
    elements.canvas.style.cursor = 'grabbing';
    
    if (event.type.includes('touch')) {
      event.preventDefault();
    }
  }
}

function handlePointerMove(event) {
  if (!state.overlayImage) return;
  
  const pointerPos = getPointerPosition(event);
  
  if (state.isDragging) {
    state.overlayX = pointerPos.x - state.dragStartX;
    state.overlayY = pointerPos.y - state.dragStartY;
    scheduleRender();
  } else {
    elements.canvas.style.cursor = isPointInOverlay(pointerPos) ? 'grab' : 'default';
  }
}

function handlePointerUp() {
  state.isDragging = false;
  elements.canvas.style.cursor = 'default';
}

function getPointerPosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  
  let clientX, clientY;
  
  if (event.type.includes('touch')) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  
  return { 
    x: clientX - rect.left, 
    y: clientY - rect.top 
  };
}

function isPointInOverlay(point) {
  return point.x >= state.overlayX && point.x <= state.overlayX + state.overlayW && 
         point.y >= state.overlayY && point.y <= state.overlayY + state.overlayH;
}

// Save product functionality - Now with proper CORS handling
async function handleSaveProduct() {
    if (!state.overlayImage) {
        alert('No art image available');
        return;
    }

    const customName = elements.productNameInput.value.trim();
    if (!customName) {
        alert('Please enter a product name');
        return;
    }

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
    
    if (!firestoreUserId) {
        alert('User information not found. Please log in again.');
        window.location.href = 'profile.html';
        return;
    }

    const { saveBtn } = elements;
    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        // Use module to get save side
        const saveSide = state.currentModule?.getSaveSide ? state.currentModule.getSaveSide(elements) : 'front';
        const physicalArea = PHYSICAL_PRINT_AREAS[state.product.id]?.[saveSide] || 
                         PHYSICAL_PRINT_AREAS[state.product.id]?.default;
        
        if (!physicalArea) {
            alert('Physical print area not defined for this product');
            return;
        }

        const areaWidthPx = Math.round(physicalArea.widthInches * 300);
        const areaHeightPx = Math.round(physicalArea.heightInches * 300);

        // Create composite for Printful
        const compositeCanvas = document.createElement('canvas');
        const compositeCtx = compositeCanvas.getContext('2d');
        compositeCanvas.width = areaWidthPx;
        compositeCanvas.height = areaHeightPx;

        const printArea = state.currentModule?.getPrintArea ? state.currentModule.getPrintArea(state) : null;
        if (!printArea) {
            alert('Print area not defined for this product');
            return;
        }

        const scaleX = areaWidthPx / printArea.width;
        const scaleY = areaHeightPx / printArea.height;
        
        // Draw the overlay image - this should now work without CORS issues
        compositeCtx.drawImage(
            state.overlayImage,
            (state.overlayX - printArea.x) * scaleX,
            (state.overlayY - printArea.y) * scaleY,
            state.overlayW * scaleX,
            state.overlayH * scaleY
        );

        // Get the image data - this should work now with CORS
        const compositeImage = compositeCanvas.toDataURL('image/png');
        
        // Create thumbnail
        const thumbnail = await createThumbnail(saveSide, printArea);

        const placement = {
            area_width: areaWidthPx,
            area_height: areaHeightPx,
            left: 0, top: 0,
            width: areaWidthPx,
            height: areaHeightPx
        };

        const productName = `${firestoreUserId}-${customName}`;

        const requestBody = {
            name: productName,
            thumbnail,
            side: saveSide,
            variants: state.variants.map(v => ({ 
                id: v.id, 
                price: v.retail_price || 29.99,
                color: v.color || 'N/A'
            })),
            designImage: compositeImage,
            placement,
            designerUserId: firestoreUserId,
            productId: state.product.id,
            productTitle: customName,
            pricing: {
                basePrice: state.basePrice,
                artPrice: state.selectedArt?.totalPrice || state.selectedArt?.price || 0,
                totalPrice: state.totalPrice
            }
        };

        const authToken = await getAuthToken();
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveProduct', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        if (result.success) {
            alert('Product saved successfully!');
            sessionStorage.removeItem('selectedArt');
            
            if (result.firestoreProductId) {
                sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
            }
            
            renderCanvas();
        } else {
            throw new Error(result.error || 'Failed to save product');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        alert(`Error saving product: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Product';
    }
}

async function createThumbnail(saveSide, printArea) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = 400;
  canvas.width = canvas.height = size;
  
  ctx.fillStyle = state.selectedVariant.color_code || '#ffffff';
  ctx.fillRect(0, 0, size, size);
  
  const baseImage = state.moduleState.baseImages?.[saveSide] || state.moduleState.baseImages?.front;
  if (baseImage && baseImage.complete) {
    const scale = Math.min(size / baseImage.width, size / baseImage.height);
    const w = baseImage.width * scale;
    const h = baseImage.height * scale;
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    
    ctx.drawImage(baseImage, x, y, w, h);
    
    if (printArea) {
      const thumbPrintAreaX = (printArea.x / elements.canvas.width) * size;
      const thumbPrintAreaY = (printArea.y / elements.canvas.height) * size;
      const thumbPrintAreaW = (printArea.width / elements.canvas.width) * size;
      const thumbPrintAreaH = (printArea.height / elements.canvas.height) * size;
      
      const thumbOverlayX = thumbPrintAreaX + ((state.overlayX - printArea.x) / printArea.width) * thumbPrintAreaW;
      const thumbOverlayY = thumbPrintAreaY + ((state.overlayY - printArea.y) / printArea.height) * thumbPrintAreaH;
      const thumbOverlayW = (state.overlayW / printArea.width) * thumbPrintAreaW;
      const thumbOverlayH = (state.overlayH / printArea.height) * thumbPrintAreaH;
      
      ctx.drawImage(state.overlayImage, thumbOverlayX, thumbOverlayY, thumbOverlayW, thumbOverlayH);
    }
  }
  
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function getAuthToken() {
  try {
    if (typeof firebase === 'undefined') {
      return null;
    }
    
    const user = firebase.auth().currentUser;
    if (!user) {
      return null;
    }
    
    const token = await user.getIdToken();
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

function setupEventListeners() {
    elements.variantSelection.addEventListener('click', handleVariantSelection);
    
    if (state.currentModule?.handleSideSwitch) {
        elements.frontBtn.addEventListener('click', () => handleSideSwitch('front'));
        elements.backBtn.addEventListener('click', () => handleSideSwitch('back'));
    }
    
    document.getElementById('scale-slider').addEventListener('input', handleScaleChange);
    
    // Mouse listeners
    elements.canvas.addEventListener('mousedown', handlePointerDown);
    elements.canvas.addEventListener('mousemove', handlePointerMove);
    elements.canvas.addEventListener('mouseup', handlePointerUp);
    elements.canvas.addEventListener('mouseleave', handlePointerUp);

    // Touch listeners
    elements.canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
    elements.canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
    elements.canvas.addEventListener('touchend', handlePointerUp);
    elements.canvas.addEventListener('touchcancel', handlePointerUp);
    
    elements.canvas.addEventListener('dragstart', e => e.preventDefault());
    
    elements.saveBtn.addEventListener('click', handleSaveProduct);
}

function cmToPx(cm, dpi = DPI) {
  return Math.round((cm / 2.54) * dpi);
}

export { state, elements, ctx };