import { PRINT_AREAS } from './printAreas.js';
import * as OneSideModule from './one-side.js';
import * as TwoSideModule from './two-side.js';
import * as ArtModeModule from './art-mode.js';

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
const TWO_SIDED_PRODUCTS = [71, 146]; // tshirts, hoodies

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
  uploadInput: document.getElementById('upload-input'),
  frontBtn: document.getElementById('front-btn'),
  backBtn: document.getElementById('back-btn'),
  saveBtn: document.getElementById('save-btn'),
  saveSideFront: document.querySelector('input[name="saveSide"][value="front"]'),
  saveSideBack: document.querySelector('input[name="saveSide"][value="back"]'),
  productNameInput: document.getElementById('item-name'),
  bgColorPicker: document.getElementById('bg-color'),
  clearCanvasBtn: document.getElementById('clear-canvas'),
  saveSideContainer: document.getElementById('save-side')
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
  isArtMode: false,
  bgColor: '#ffffff',
  basePrice: 0,
  artistCut: 0,
  totalPrice: 0,
  pricingLoaded: false,
  artPrice: 0,
  artPlatformFee: 0,
  artTotalPrice: 0,
  canvasScale: 1,
  currentModule: null,
  moduleState: {},
  variantPrices: new Map(),
  variantPricingLoaded: false,
  // NEW: Touch gesture support (EXACTLY like canvas-client.js)
  initialDistance: null,
  initialScale: 1
};

// Initialize
document.addEventListener('DOMContentLoaded', initializeApp);

// Product type detection
function getProductType(productId) {
  return TWO_SIDED_PRODUCTS.includes(parseInt(productId)) ? 'two-sided' : 'one-sided';
}

async function initializeApp() {
    try {
        console.log("Initializing canvas application...");
        
        // Wait for Firebase to be ready
        await waitForFirebase();
        
        // Check mode
        const isArtMode = sessionStorage.getItem('creationMode') === 'art';
        
        // Get Firestore user ID
        const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                               sessionStorage.getItem('currentFirestoreUserId');
        
        console.log("Firestore User ID:", firestoreUserId);
        console.log("Current mode:", isArtMode ? "Art" : "Product");
        
        if (!firestoreUserId) {
            throw new Error("No Firestore user ID found. Please log in again.");
        }
        
        // Update UI based on mode
        updateUIForMode(isArtMode);
        
        // Load appropriate module
        if (isArtMode) {
            await loadArtMode();
        } else {
            await loadProductMode();
        }
        
        setupEventListeners(isArtMode);
        state.isArtMode = isArtMode;
        updateCanvasScale();
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        alert(error.message);
        window.location.href = 'profile.html';
    }
}

// Wait for Firebase to be ready
async function waitForFirebase() {
  return new Promise((resolve, reject) => {
    if (typeof firebase === 'undefined') {
      reject(new Error('Firebase SDK not loaded. Please check your internet connection.'));
      return;
    }

    // Check if Firebase is already initialized
    if (firebase.apps.length > 0) {
      console.log("Firebase already initialized");
      resolve();
      return;
    }

    // Try to initialize Firebase
    try {
      firebaseApp = firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      console.log("Firebase initialized successfully");
      resolve();
    } catch (error) {
      if (error.code === 'app/duplicate-app') {
        // Firebase already initialized
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

async function loadArtMode() {
    console.log("Loading art mode module");
    state.currentModule = ArtModeModule;
    const moduleState = state.currentModule.initialize(state, elements, ctx);
    state.moduleState = { ...state.moduleState, ...moduleState };
}

async function loadProductMode() {
    loadSessionData();
    renderVariantOptions();
    
    // Determine product type and load appropriate module
    const productType = getProductType(state.product?.id);
    console.log(`Loading ${productType} product module for product ID: ${state.product?.id}`);
    
    if (productType === 'two-sided') {
        state.currentModule = TwoSideModule;
    } else {
        state.currentModule = OneSideModule;
    }
    
    const moduleState = state.currentModule.initialize(state, elements, ctx);
    state.moduleState = { ...state.moduleState, ...moduleState };
    
    // Preload base images using the appropriate module
    if (state.currentModule.preloadBaseImages) {
        state.currentModule.preloadBaseImages(state.product?.id, state.moduleState.baseImages, state.moduleState.imagesLoaded);
    }
    
    // Fetch pricing
    await fetchProductPricing();
}

function updateCanvasScale() {
    const rect = elements.canvas.getBoundingClientRect();
    state.canvasScale = elements.canvas.width / rect.width;
}

function handleBgColorChange(event) {
    if (!state.isArtMode) return;
    
    state.bgColor = event.target.value;
    renderCanvas();
}

function handleClearCanvas() {
    if (!state.isArtMode) return;
    
    state.overlayImage = null;
    renderCanvas();
}

function updateArtPricingDisplay() {
  const artPriceInput = document.getElementById('art-price');
  const platformFeeElement = document.getElementById('art-platform-fee');
  const totalPriceElement = document.getElementById('art-total-price');
  
  if (artPriceInput && platformFeeElement && totalPriceElement) {
    state.artPrice = parseFloat(artPriceInput.value) || 0;
    state.artPlatformFee = state.artPrice * 0.05;
    state.artTotalPrice = state.artPrice + state.artPlatformFee;
    
    platformFeeElement.textContent = `R$ ${state.artPlatformFee.toFixed(2)}`;
    totalPriceElement.textContent = `R$ ${state.artTotalPrice.toFixed(2)}`;
  }
}

async function fetchProductPricing() {
  if (state.isArtMode || !state.selectedVariant) return;
  
  try {
    console.log("=== STARTING PRICING FETCH ===");
    console.log("Fetching pricing for all variants of product:", state.product.id);
    
    // Clear previous prices
    state.variantPrices.clear();
    
    // Fetch pricing for ALL variants
    const pricingPromises = state.variants.map(async (variant) => {
      try {
        const requestBody = {
          productId: state.product.id,
          variantId: variant.id
        };
        
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/getProductPricing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success && result.basePrice) {
          state.variantPrices.set(variant.id, result.basePrice);
          console.log(`✅ Variant ${variant.id} API price:`, result.basePrice);
          return { variantId: variant.id, price: result.basePrice, success: true };
        } else {
          throw new Error(`API returned success:false - ${result.error}`);
        }
      } catch (error) {
        console.error(`❌ Failed to fetch price for variant ${variant.id}:`, error);
        throw new Error(`Failed to get price for variant ${variant.id}: ${error.message}`);
      }
    });

    const results = await Promise.all(pricingPromises);
    const successful = results.filter(r => r.success).length;
    
    console.log(`=== PRICING RESULTS ===`);
    console.log(`Total variants: ${results.length}`);
    console.log(`Successful API calls: ${successful}`);
    console.log(`Variant prices map:`, Array.from(state.variantPrices.entries()));
    
    if (successful === 0) {
      throw new Error("No variant prices could be fetched from API");
    }
    
    state.variantPricingLoaded = true;
    state.pricingLoaded = true;
    updatePricingDisplay(); // This will now show the detailed pricing
    
  } catch (error) {
    console.error('❌ Error in pricing fetch:', error);
    throw new Error(`Pricing fetch failed: ${error.message}`);
  }
}

function updatePricingDisplay() {
  const basePriceElement = document.getElementById('base-price');
  const artistCutElement = document.getElementById('artist-cut');
  const totalPriceElement = document.getElementById('total-price');
  
  if (basePriceElement) {
    if (state.variantPricingLoaded && state.variantPrices.size > 0) {
      // Calculate price range from all variant prices
      const prices = Array.from(state.variantPrices.values())
        .filter(price => price && !isNaN(price) && price > 0);
      
      if (prices.length === 0) {
        basePriceElement.textContent = 'Price not available';
      } else {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        if (minPrice === maxPrice) {
          basePriceElement.textContent = `R$ ${minPrice.toFixed(2)}`;
        } else {
          basePriceElement.textContent = `R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}`;
        }
      }
    } else {
      // Fallback to old logic if variant pricing not loaded
      const prices = state.variants
        .filter(v => v.availability_status === 'active')
        .map(v => v.price || v.cost)
        .filter(price => price && !isNaN(price) && price > 0);
      
      if (prices.length === 0) {
        basePriceElement.textContent = 'Price not available';
      } else {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        if (minPrice === maxPrice) {
          basePriceElement.textContent = `R$ ${minPrice.toFixed(2)}`;
        } else {
          basePriceElement.textContent = `R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}`;
        }
      }
    }
    
    // Always show detailed pricing if we're in product mode
    if (!state.isArtMode) {
      showDetailedVariantPricing();
    }
  }
  
  if (artistCutElement) {
    artistCutElement.value = state.artistCut.toFixed(2);
  }
  
  if (totalPriceElement) {
    if (state.variantPricingLoaded && state.variantPrices.size > 0) {
      // Calculate total price range from variant prices
      const basePrices = Array.from(state.variantPrices.values())
        .filter(price => price && !isNaN(price) && price > 0);
      
      if (basePrices.length === 0) {
        totalPriceElement.textContent = 'R$ 0.00';
      } else {
        const totalPrices = basePrices.map(basePrice => (basePrice + state.artistCut) * 1.05);
        
        const minTotal = Math.min(...totalPrices);
        const maxTotal = Math.max(...totalPrices);
        
        if (minTotal === maxTotal) {
          totalPriceElement.textContent = `R$ ${minTotal.toFixed(2)}`;
        } else {
          totalPriceElement.textContent = `R$ ${minTotal.toFixed(2)} - R$ ${maxTotal.toFixed(2)}`;
        }
      }
    } else {
      // Fallback logic
      const prices = state.variants
        .filter(v => v.availability_status === 'active')
        .map(v => {
          const basePrice = v.price || v.cost;
          if (basePrice && !isNaN(basePrice) && basePrice > 0) {
            return (basePrice + state.artistCut) * 1.05;
          }
          return null;
        })
        .filter(price => price !== null);
      
      if (prices.length === 0) {
        totalPriceElement.textContent = 'R$ 0.00';
      } else {
        const minTotal = Math.min(...prices);
        const maxTotal = Math.max(...prices);
        
        if (minTotal === maxTotal) {
          totalPriceElement.textContent = `R$ ${minTotal.toFixed(2)}`;
        } else {
          totalPriceElement.textContent = `R$ ${minTotal.toFixed(2)} - R$ ${maxTotal.toFixed(2)}`;
        }
      }
    }
  }
}

function handleArtistCutChange(event) {
  state.artistCut = parseFloat(event.target.value) || 0;
  updatePricingDisplay();
}

function updateUIForMode(isArtMode) {
    const sideSelector = document.getElementById('side-selector');
    const viewButtons = document.getElementById('view-buttons');
    const variantSelection = document.getElementById('variant-selection');
    const pageTitle = document.getElementById('page-title');
    const canvasTitle = document.getElementById('canvas-title');
    const nameLabel = document.getElementById('name-label');
    const saveBtn = document.getElementById('save-btn');
    const bgColorContainer = document.getElementById('bg-color-container');
    const clearCanvasBtn = document.getElementById('clear-canvas');
    const saveSideContainer = document.getElementById('save-side');
    const pricingSection = document.getElementById('pricing-section');
    const artPricingSection = document.getElementById('art-pricing-section');
    const productPricingSection = document.getElementById('pricing-section');

    if (isArtMode) {
        if (artPricingSection) artPricingSection.style.display = 'block';
        if (productPricingSection) productPricingSection.style.display = 'none';
    } else {
        if (artPricingSection) artPricingSection.style.display = 'none';
        if (productPricingSection) productPricingSection.style.display = 'block';
    }
    
    if (isArtMode) {
        if (sideSelector) sideSelector.style.display = 'none';
        if (viewButtons) viewButtons.style.display = 'none';
        if (variantSelection) variantSelection.style.display = 'none';
        if (saveSideContainer) saveSideContainer.style.display = 'none';
        if (pricingSection) pricingSection.style.display = 'none';
        if (pageTitle) pageTitle.textContent = 'Art Canvas';
        if (canvasTitle) canvasTitle.textContent = 'Art Canvas';
        if (nameLabel) nameLabel.textContent = 'Art Name:';
        if (saveBtn) saveBtn.textContent = 'Save Art';
        
        if (bgColorContainer) bgColorContainer.style.display = 'block';
        if (clearCanvasBtn) clearCanvasBtn.style.display = 'inline-block';
        document.querySelectorAll('.art-only').forEach(el => {
            if (el) el.style.display = 'block';
        });
    } else {
        if (sideSelector) sideSelector.style.display = 'block';
        if (saveSideContainer) saveSideContainer.style.display = 'block';
        if (pricingSection) pricingSection.style.display = 'block';
        if (pageTitle) pageTitle.textContent = 'Product Canvas';
        if (canvasTitle) canvasTitle.textContent = 'Product Canvas';
        if (nameLabel) nameLabel.textContent = 'Product Name:';
        if (saveBtn) saveBtn.textContent = 'Save Product';
        
        if (bgColorContainer) bgColorContainer.style.display = 'none';
        if (clearCanvasBtn) clearCanvasBtn.style.display = 'none';
        document.querySelectorAll('.art-only').forEach(el => {
            if (el) el.style.display = 'none';
        });
    }
    
    setTimeout(updateCanvasScale, 100);
}

function setupArtMode() {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
}

function renderCanvas() {
    if (!state.currentModule) return;
    
    if (state.isArtMode) {
        state.currentModule.renderCanvas(state, elements, ctx);
    } else {
        state.currentModule.renderCanvas(state, elements, ctx, state.moduleState.baseImages, state.moduleState.imagesLoaded);
    }
}

function loadSessionData() {
  const productData = sessionStorage.getItem('selectedProduct');
  const variantData = sessionStorage.getItem('selectedVariants');
  
  if (!productData) throw new Error('No product data found in session storage');
  if (!variantData) throw new Error('No variant data found in session storage');
  
  state.product = JSON.parse(productData);
  state.variants = JSON.parse(variantData);
  state.selectedVariant = state.variants[0] || null;
  
  if (!state.selectedVariant) {
    throw new Error('No variants available for selected product');
  }

  console.log("=== PRODUCT DATA ===");
  console.log("Product ID:", state.product.id);
  console.log("Product Name:", state.product.name);
  console.log("Total variants:", state.variants.length);
}

function renderVariantOptions() {
  if (!state.variants.length) return;
  
  const variantsByColor = {};
  state.variants.forEach(variant => {
    // FIX: Handle missing color property
    const color = variant.color || 'N/A';
    if (!color) {
      console.warn(`Variant ${variant.id} has no color property, defaulting to 'N/A'`);
    }
    
    if (!variantsByColor[color]) {
      variantsByColor[color] = [];
    }
    variantsByColor[color].push(variant);
  });
  
  let html = '';
  
  Object.keys(variantsByColor).forEach(color => {
    const colorVariants = variantsByColor[color];
    const firstVariant = colorVariants[0];
    
    // FIX: Handle missing color_code property
    const colorCode = firstVariant.color_code || '#cccccc';
    
    html += `
      <div class="color-group mb-3">
        <div class="color-header d-flex align-items-center mb-2">
          <span class="color-indicator me-2" style="background: ${colorCode}; width: 20px; height: 20px; border-radius: 50%; border: 1px solid #ddd;"></span>
          <strong>${color}</strong>
        </div>
        <div class="size-options d-flex flex-wrap gap-2">
    `;
    
    colorVariants.forEach(variant => {
      const isSelected = variant.id === state.selectedVariant?.id;
      
      html += `
        <div class="variant-option ${isSelected ? 'selected' : ''}" 
             data-id="${variant.id}"
             title="${variant.size || 'One Size'}">
          ${variant.size || 'One Size'}
        </div>
      `;
    });
    
    html += `</div></div>`;
  });
  
  elements.variantSelection.innerHTML = html;
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
  }
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file?.type.startsWith('image/')) {
    alert('Please select a valid image file');
    return;
  }
  
  state.scale = 1.0;
  document.getElementById('scale-slider').value = 100;
  document.getElementById('scale-value').textContent = '100%';
  
  const reader = new FileReader();
  reader.onload = (evt) => loadOverlayImage(evt.target.result);
  reader.onerror = () => alert('Error reading file');
  reader.readAsDataURL(file);
}

function loadOverlayImage(imageSrc) {
  state.overlayImage = new Image();
  state.overlayImage.onload = () => {
    initializeOverlayPosition();
    renderCanvas();
  };
  state.overlayImage.onerror = () => alert('Error loading image');
  state.overlayImage.src = imageSrc;
}

function initializeOverlayPosition() {
    if (!state.currentModule?.initializeOverlayPosition) return;
    state.currentModule.initializeOverlayPosition(state, elements);
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

// MODERNIZED: Touch gesture support (EXACTLY like canvas-client.js)
function handleTouchStart(event) {
  if (!state.overlayImage) return;
  
  if (event.touches.length === 1) {
    // Single touch - start dragging
    const pointerPos = getPointerPosition(event);
    if (isPointInOverlay(pointerPos)) {
      state.isDragging = true;
      state.dragStartX = pointerPos.x - state.overlayX;
      state.dragStartY = pointerPos.y - state.overlayY;
      elements.canvas.style.cursor = 'grabbing';
      event.preventDefault();
    }
  } else if (event.touches.length === 2) {
    // Two touches - start pinch to zoom
    state.initialDistance = getTouchDistance(event);
    state.initialScale = state.scale;
    event.preventDefault();
  }
}

function handleTouchMove(event) {
  if (!state.overlayImage) return;
  
  if (event.touches.length === 1 && state.isDragging) {
    // Single touch dragging
    const pointerPos = getPointerPosition(event);
    state.overlayX = pointerPos.x - state.dragStartX;
    state.overlayY = pointerPos.y - state.dragStartY;
    scheduleRender();
    event.preventDefault();
  } else if (event.touches.length === 2) {
    // Pinch to zoom
    const currentDistance = getTouchDistance(event);
    if (state.initialDistance !== null) {
      const scaleFactor = currentDistance / state.initialDistance;
      const newScale = Math.max(0.1, Math.min(5, state.initialScale * scaleFactor));
      
      // Update scale slider and value
      const scaleSlider = document.getElementById('scale-slider');
      const scaleValue = document.getElementById('scale-value');
      const sliderValue = Math.round(newScale * 100);
      
      if (scaleSlider) scaleSlider.value = sliderValue;
      if (scaleValue) scaleValue.textContent = `${sliderValue}%`;
      
      // Apply scale change
      if (state.currentModule?.handleScaleChange) {
        state.currentModule.handleScaleChange(state, elements, newScale);
      }
      event.preventDefault();
    }
  }
}

function handleTouchEnd(event) {
  state.isDragging = false;
  state.initialDistance = null;
  elements.canvas.style.cursor = 'default';
}

function getTouchDistance(event) {
  const touch1 = event.touches[0];
  const touch2 = event.touches[1];
  return Math.hypot(
    touch2.clientX - touch1.clientX,
    touch2.clientY - touch1.clientY
  );
}

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
    x: (clientX - rect.left) * state.canvasScale,
    y: (clientY - rect.top) * state.canvasScale
  };
}

function isPointInOverlay(point) {
  return point.x >= state.overlayX && 
         point.x <= state.overlayX + state.overlayW && 
         point.y >= state.overlayY && 
         point.y <= state.overlayY + state.overlayH;
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
    const token = await user.getIdToken(true); // Force refresh to get latest token
    console.log("Auth token retrieved successfully");
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

async function handleSaveArt() {
  if (!state.overlayImage) {
    throw new Error('Please upload an image first');
  }

  const artName = document.getElementById('item-name').value.trim();
  if (!artName) {
    throw new Error('Please enter an art name');
  }

  if (state.artPrice <= 0) {
    throw new Error('Please enter a valid price for your art');
  }

  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
  
  if (!firestoreUserId) {
    throw new Error('User information not found. Please log in again.');
  }

  const { saveBtn } = elements;
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = state.overlayImage.naturalWidth;
    tempCanvas.height = state.overlayImage.naturalHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(state.overlayImage, 0, 0);
    
    const artData = tempCanvas.toDataURL('image/png');
    const filename = `${firestoreUserId}-${artName.replace(/\s+/g, '-').toLowerCase()}`;
    
    const artId = await saveArtToFirebase(
      artData, 
      filename, 
      artName, 
      firestoreUserId,
      state.artPrice,
      state.artPlatformFee,
      state.artTotalPrice
    );
    
    alert('Art saved successfully!');
    console.log("Art saved with ID:", artId);
    
  } catch (error) {
    console.error('Error saving art:', error);
    throw error;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Art';
  }
}

async function saveArtToFirebase(artData, filename, artName, userId, price, platformFee, totalPrice) {
  try {
    const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveArt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
          artData: artData,
          filename: filename,
          artName: artName,
          userId: userId,
          price: price,
          platformFee: platformFee,
          totalPrice: totalPrice
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success) {
      return result.downloadURL;
    } else {
      throw new Error(result.error || 'Failed to save art');
    }
  } catch (error) {
    console.error('Error saving art via cloud function:', error);
    throw error;
  }
}

async function handleSaveProduct() {
    if (state.isArtMode) {
        return handleSaveArt();
    }
    
    // Validation
    if (!state.overlayImage) {
        throw new Error('Please upload an image first');
    }

    const customName = elements.productNameInput.value.trim();
    if (!customName) {
        throw new Error('Please enter a product name');
    }

    if (state.artistCut < 0) {
        throw new Error('Artist cut cannot be negative');
    }

    if (!state.variantPricingLoaded || state.variantPrices.size === 0) {
        throw new Error('Product pricing not loaded. Please wait or try again.');
    }

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
    
    if (!firestoreUserId) {
        throw new Error('User information not found. Please log in again.');
    }

    // FIREBASE AUTHENTICATION CHECK
    let currentUser = null;
    let authToken = null;
    
    try {
        // Check if Firebase is available
        if (typeof firebase === 'undefined' || !firebaseAuth) {
            throw new Error('Firebase authentication is not available. Please refresh the page.');
        }

        // Get current user
        currentUser = firebaseAuth.currentUser;
        if (!currentUser) {
            throw new Error('You are not logged in. Please sign in to save products.');
        }

        console.log("Firebase user authenticated:", currentUser.uid);
        
        // Get authentication token
        authToken = await currentUser.getIdToken(true); // Force token refresh
        console.log("Auth token retrieved successfully");
        
    } catch (authError) {
        console.error('Firebase authentication error:', authError);
        throw new Error(`Authentication failed: ${authError.message}`);
    }

    const { saveBtn } = elements;
    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        // FIX: Get save side from radio buttons
        const saveSide = getSaveSide();
        console.log("Saving product for side:", saveSide);

        // FIX: Use the correct base image for the selected save side
        const physicalArea = PHYSICAL_PRINT_AREAS[state.product.id]?.[saveSide] || 
                         PHYSICAL_PRINT_AREAS[state.product.id]?.default;
        
        if (!physicalArea) {
            throw new Error(`Physical print area not defined for product ${state.product.id} for side ${saveSide}`);
        }

        // Create design image for Printful
        const areaWidthPx = Math.round(physicalArea.widthInches * 300);
        const areaHeightPx = Math.round(physicalArea.heightInches * 300);

        const compositeCanvas = document.createElement('canvas');
        const compositeCtx = compositeCanvas.getContext('2d');
        compositeCanvas.width = areaWidthPx;
        compositeCanvas.height = areaHeightPx;

        // FIX: Temporarily switch to the save side to get the correct print area
        const originalSide = state.side;
        state.side = saveSide; // Switch to the save side temporarily
        
        const printArea = state.currentModule?.getPrintArea ? state.currentModule.getPrintArea(state) : null;
        
        if (!printArea) {
            // Restore original side before throwing error
            state.side = originalSide;
            throw new Error(`Print area not defined for ${saveSide} side of this product`);
        }

        const scaleX = areaWidthPx / printArea.width;
        const scaleY = areaHeightPx / printArea.height;
        
        compositeCtx.drawImage(
            state.overlayImage,
            (state.overlayX - printArea.x) * scaleX,
            (state.overlayY - printArea.y) * scaleY,
            state.overlayW * scaleX,
            state.overlayH * scaleY
        );

        const designImage = compositeCanvas.toDataURL('image/png');
        
        // FIX: Create thumbnail using the correct side
        const thumbnail = await createThumbnail(saveSide, printArea);
        
        // Restore original side after processing
        state.side = originalSide;

        // Process variants with strict validation
        const processedVariants = state.variants.map(variant => {
            // FIX: Handle missing variant properties with defaults
            if (!variant.id) throw new Error(`Variant missing ID`);
            
            const size = variant.size || 'One Size';
            const color = variant.color || 'N/A';
            const colorCode = variant.color_code || '#cccccc';
            const variantName = variant.name || `${state.product.name} - ${color} - ${size}`;
            
            // Get price from API results
            const price = state.variantPrices.get(variant.id);
            if (!price || isNaN(price)) {
                throw new Error(`No valid price found for variant ${variant.id}`);
            }

            return {
                id: variant.id,
                productId: state.product.id,
                name: variantName,
                size: size,
                color: color,
                colorCode: colorCode,
                price: (parseFloat(price) + state.artistCut) * 1.05,
                flatLayUrl: variant.flat_lay_url || null,
                // Include original variant data for Printful
                retail_price: (parseFloat(price) + state.artistCut) * 1.05,
                availability_status: variant.availability_status || 'active'
            };
        });

        // Calculate price ranges
        const prices = processedVariants.map(v => v.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        console.log("Print area for placement:", printArea);
        console.log("Save side for placement:", saveSide);
        // Create clean request body with user authentication info
        const requestBody = {
            // Basic Information
            name: `${firestoreUserId}-${customName}`,
            productTitle: customName,
            productId: state.product.id,
            designerUserId: firestoreUserId,
            side: saveSide, // This will now be correctly set to 'back' if selected
            
            // Firebase Authentication Info
            firebaseUserId: currentUser.uid,
            userEmail: currentUser.email,
            
            // Design Information
            designImage: designImage,
            thumbnail: thumbnail,
            designScale: state.scale,
            
            // Placement Information - FIXED: Include side-specific placement
            placement: {
                area_width: areaWidthPx,
                area_height: areaHeightPx,
                width: areaWidthPx,
                height: areaHeightPx,
                left: 0,
                top: 0,
                side: saveSide // Explicitly include side in placement
            },
            
            // Pricing Information
            pricing: {
                priceRange: {
                    min: minPrice,
                    max: maxPrice
                },
                currency: "BRL",
                userCut: state.artistCut
            },
            
            // Variant Information
            availableColors: [...new Set(processedVariants.map(v => v.color))],
            availableSizes: [...new Set(processedVariants.map(v => v.size))],
            totalVariants: processedVariants.length,
            variants: processedVariants
        };

        console.log("Saving product with side:", saveSide, "using print area:", printArea);
        console.log("Placement data:", requestBody.placement);

        // Send request with authentication header
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        };

        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveProduct', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            // Handle specific authentication errors
            if (response.status === 401) {
                throw new Error('Authentication expired. Please sign in again.');
            } else if (response.status === 403) {
                throw new Error('You do not have permission to save products.');
            }
            
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        if (result.success) {
            alert(`Product saved successfully for ${saveSide} side with ${processedVariants.length} variants!`);
            console.log("Product saved successfully. Firestore ID:", result.firestoreProductId);
            
            if (result.firestoreProductId) {
                sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
            }
            
        } else {
            throw new Error(result.error || 'Failed to save product');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        
        // Handle specific error types
        if (error.message.includes('Authentication failed') || 
            error.message.includes('not logged in') ||
            error.message.includes('Authentication expired')) {
            // Redirect to login
            alert('Please sign in to continue.');
            window.location.href = 'profile.html';
            return;
        }
        
        throw error;
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Product';
    }
}

// Add this helper function to get the selected save side
function getSaveSide() {
    const selectedSide = document.querySelector('input[name="saveSide"]:checked');
    const side = selectedSide ? selectedSide.value : 'front';
    console.log("Save side selected:", side);
    return side;
}

function showDetailedVariantPricing() {
  let pricingContainer = document.getElementById('variant-pricing-details');
  
  if (!pricingContainer) {
    pricingContainer = document.createElement('div');
    pricingContainer.id = 'variant-pricing-details';
    pricingContainer.style.marginTop = '15px';
    pricingContainer.style.padding = '15px';
    pricingContainer.style.backgroundColor = '#f8f9fa';
    pricingContainer.style.borderRadius = '6px';
    pricingContainer.style.border = '1px solid #dee2e6';
    
    const pricingSection = document.getElementById('pricing-section');
    if (pricingSection) {
      pricingSection.appendChild(pricingContainer);
    } else {
      return;
    }
  }
  
  // Group variants by color for better organization
  const variantsByColor = {};
  state.variants.forEach(variant => {
    const color = variant.color || 'Default';
    if (!variantsByColor[color]) {
      variantsByColor[color] = [];
    }
    variantsByColor[color].push(variant);
  });
  
  let html = '<h4 style="margin-bottom: 15px; color: #333;">Price Preview</h4>';
  
  Object.keys(variantsByColor).forEach(color => {
    const colorVariants = variantsByColor[color];
    const firstVariant = colorVariants[0];
    
    html += `
      <div class="color-pricing-group" style="margin-bottom: 20px;">
        <div class="color-header d-flex align-items-center mb-2">
          <span class="color-indicator" style="background: ${firstVariant.color_code || '#ccc'}; display: inline-block; width: 16px; height: 16px; border-radius: 50%; margin-right: 8px; vertical-align: middle;"></span>
          <strong style="color: #555;">${color}</strong>
        </div>
        <div class="size-pricing" style="margin-left: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid #dee2e6;">
                <th style="text-align: left; padding: 8px 4px; font-weight: 600; color: #555;">Size</th>
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Base Price</th>
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Total Price</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    colorVariants.forEach(variant => {
      // Get the specific price for this variant
      let basePrice;
      
      if (state.variantPricingLoaded && state.variantPrices.has(variant.id)) {
        basePrice = state.variantPrices.get(variant.id);
      } else {
        // Fallback to variant's own price properties
        basePrice = variant.price || variant.cost;
      }
      
      const isAvailable = variant.availability_status === 'active';
      
      if (basePrice && !isNaN(basePrice)) {
        const totalPrice = (basePrice + state.artistCut) * 1.05; // base price + artist cut + 5% platform fee
        
        html += `
          <tr style="${!isAvailable ? 'opacity: 0.6; color: #6c757d;' : 'color: #333;'} border-bottom: 1px solid #eee;">
            <td style="padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              ${variant.size || 'One Size'}
              ${!isAvailable ? ' (Unavailable)' : ''}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              R$ ${parseFloat(basePrice).toFixed(2)}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              <strong>R$ ${totalPrice.toFixed(2)}</strong>
            </td>
          </tr>
        `;
      } else {
        html += `
          <tr style="opacity: 0.6; color: #6c757d; border-bottom: 1px solid #eee;">
            <td style="padding: 8px 4px;">${variant.size || 'One Size'}</td>
            <td colspan="2" style="text-align: right; padding: 8px 4px;">
              Price not available (Currently Unavailable)
            </td>
          </tr>
        `;
      }
    });
    
    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
  
  // Add pricing formula explanation
  html += `
    <div style="margin-top: 15px; padding: 10px; background: #e9ecef; border-radius: 4px; font-size: 0.9em; color: #495057;">
      <strong>Pricing Formula:</strong> Total Price = (Base Price + Artist Cut) × 1.05<br>
      <small>Includes 5% platform fee</small>
    </div>
  `;
  
  pricingContainer.innerHTML = html;
}

async function createThumbnail(saveSide, printArea) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = 800;
  canvas.width = canvas.height = size;
  
  // Use transparent background instead of color
  ctx.clearRect(0, 0, size, size);
  
  // FIX: Use the correct base image for the save side
  const baseImage = state.moduleState.baseImages?.[saveSide];
  if (baseImage && baseImage.complete) {
    const scale = Math.min(size / baseImage.width, size / baseImage.height);
    const w = baseImage.width * scale;
    const h = baseImage.height * scale;
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    ctx.drawImage(baseImage, x, y, w, h);
    
    // Overlay design
    if (printArea && state.overlayImage) {
      const thumbPrintAreaX = (printArea.x / baseImage.width) * w;
      const thumbPrintAreaY = (printArea.y / baseImage.height) * h;
      const thumbPrintAreaW = (printArea.width / baseImage.width) * w;
      const thumbPrintAreaH = (printArea.height / baseImage.height) * h;
      
      const thumbOverlayX = thumbPrintAreaX + ((state.overlayX - printArea.x) / printArea.width) * thumbPrintAreaW;
      const thumbOverlayY = thumbPrintAreaY + ((state.overlayY - printArea.y) / printArea.height) * thumbPrintAreaH;
      const thumbOverlayW = (state.overlayW / printArea.width) * thumbPrintAreaW;
      const thumbOverlayH = (state.overlayH / printArea.height) * thumbPrintAreaH;
      
      ctx.drawImage(state.overlayImage, thumbOverlayX, thumbOverlayY, thumbOverlayW, thumbOverlayH);
    }
  } else {
    // Fallback: if no base image, just show the design on transparent background
    if (state.overlayImage && printArea) {
      const thumbOverlayW = (state.overlayW / printArea.width) * size;
      const thumbOverlayH = (state.overlayH / printArea.height) * size;
      const thumbOverlayX = (size - thumbOverlayW) / 2;
      const thumbOverlayY = (size - thumbOverlayH) / 2;
      
      ctx.drawImage(state.overlayImage, thumbOverlayX, thumbOverlayY, thumbOverlayW, thumbOverlayH);
    }
  }
  
  return canvas.toDataURL('image/png'); // Use PNG to preserve transparency
}

function setupEventListeners(isArtMode) {
    if (!isArtMode && state.currentModule?.handleSideSwitch) {
        elements.variantSelection.addEventListener('click', handleVariantSelection);
        elements.frontBtn.addEventListener('click', () => handleSideSwitch('front'));
        elements.backBtn.addEventListener('click', () => handleSideSwitch('back'));
    }

    if (isArtMode) {
        const artPriceInput = document.getElementById('art-price');
        if (artPriceInput) {
          artPriceInput.addEventListener('input', updateArtPricingDisplay);
        }
    }
    const backButton = document.getElementById('back-to-profile');
    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = 'profile.html';
        });
    }
    
    document.getElementById('upload-btn').addEventListener('click', () => elements.uploadInput.click());
    elements.uploadInput.addEventListener('change', handleFileUpload);
    elements.saveBtn.addEventListener('click', async () => {
        try {
            await handleSaveProduct();
        } catch (error) {
            console.error('Save product error:', error);
            
            // Handle authentication errors specifically
            if (error.message.includes('Authentication') || 
                error.message.includes('not logged in') ||
                error.message.includes('sign in')) {
                alert(error.message);
                window.location.href = 'profile.html';
            } else {
                alert(`Error: ${error.message}`);
            }
        }
    });
    
    // Mouse listeners for desktop
    elements.canvas.addEventListener('mousedown', handlePointerDown);
    elements.canvas.addEventListener('mousemove', handlePointerMove);
    elements.canvas.addEventListener('mouseup', handlePointerUp);
    elements.canvas.addEventListener('mouseleave', handlePointerUp);

    // Touch listeners for mobile (EXACTLY like canvas-client.js)
    elements.canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    elements.canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    elements.canvas.addEventListener('touchend', handleTouchEnd);
    elements.canvas.addEventListener('touchcancel', handleTouchEnd);
    
    elements.canvas.addEventListener('dragstart', e => e.preventDefault());
    
    // Add scale slider event listener
    const scaleSlider = document.getElementById('scale-slider');
    if (scaleSlider) {
        scaleSlider.addEventListener('input', handleScaleChange);
    }
    
    // Add art mode specific event listeners
    if (isArtMode) {
        elements.bgColorPicker.addEventListener('input', handleBgColorChange);
        elements.clearCanvasBtn.addEventListener('click', handleClearCanvas);
    }
    
    // Add pricing input listener for product mode
    if (!isArtMode) {
        const artistCutInput = document.getElementById('artist-cut');
        if (artistCutInput) {
            artistCutInput.addEventListener('input', handleArtistCutChange);
        }
    }
    
    // Add window resize listener to update canvas scale
    window.addEventListener('resize', () => {
        setTimeout(updateCanvasScale, 100);
    });
}

function cmToPx(cm, dpi = DPI) {
  return Math.round((cm / 2.54) * dpi);
}

export { state, elements, ctx };