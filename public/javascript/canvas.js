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
const TWO_SIDED_PRODUCTS = [71, 146, 509]; // tshirts, hoodies
const PLATFORM_FEE_PERCENTAGE = 0.05; // 5% platform fee

// Physical dimensions for Printful (in inches)
const PHYSICAL_PRINT_AREAS = {
  71: { front: { widthInches: 20, heightInches: 24 }, back: { widthInches: 14, heightInches: 16 } },
  146: { front: { widthInches: 14, heightInches: 14 }, back: { widthInches: 14, heightInches: 16 } },
  509: { // Men's Fitted
    front: { widthInches: 8.74, heightInches: 10.43 }, // Converted from 25.5/30 cm at 2.54 cm/inch
    back: { widthInches: 12.99, heightInches: 16.54 }  // Converted from 33/42 cm at 2.54 cm/inch
  },
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
  overlayRotation: 0, // degrees: 0, 90, 180, 270
  isDragging: false,
  isResizing: false,
  resizeHandle: null, // 'tl','tr','bl','br'
  dragStartX: 0, dragStartY: 0,
  resizeStartX: 0, resizeStartY: 0,
  resizeStartW: 0, resizeStartH: 0,
  resizeStartOX: 0, resizeStartOY: 0,
  scale: 1.0,
  isArtMode: false,
  bgColor: '#ffffff',
  artistCut: 0, // User input for artist markup
  pricingLoaded: false,
  artPrice: 0,
  artPlatformFee: 0,
  artTotalPrice: 0,
  canvasScale: 1,
  currentModule: null,
  moduleState: {},
  variantPricing: new Map(), // Store full pricing data per variant
  variantPricingLoaded: false,
  // NEW: Touch gesture support (EXACTLY like canvas-client.js)
  initialDistance: null,
  initialScale: 1
};

// Price helper functions
function roundToTwoDecimals(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
  return `R$ ${roundToTwoDecimals(amount).toFixed(2)}`;
}

// Calculate platform fee (5% of product price)
function calculatePlatformFee(productPrice) {
  return roundToTwoDecimals(productPrice * PLATFORM_FEE_PERCENTAGE);
}

// Calculate total price: product_price + platform_fee + artist_cut
function calculateTotalPrice(productPrice, artistCut) {
  const platformFee = calculatePlatformFee(productPrice);
  return roundToTwoDecimals(productPrice + platformFee + artistCut);
}

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
    console.log('🎨 bgColor changed to:', state.bgColor);
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
    // Round the input price to 2 decimals
    state.artPrice = roundToTwoDecimals(parseFloat(artPriceInput.value) || 0);
    
    // Update the input field with the rounded value
    artPriceInput.value = state.artPrice.toFixed(2);
    
    // Calculate fees with rounding
    state.artPlatformFee = roundToTwoDecimals(state.artPrice * 0.05);
    state.artTotalPrice = roundToTwoDecimals(state.artPrice + state.artPlatformFee);
    
    platformFeeElement.textContent = formatCurrency(state.artPlatformFee);
    totalPriceElement.textContent = formatCurrency(state.artTotalPrice);
  }
}

async function fetchProductPricing() {
  if (state.isArtMode || !state.selectedVariant) return;
  
  try {
    console.log("=== STARTING PRICING FETCH ===");
    console.log("Fetching pricing for all variants of product:", state.product.id);
    
    // Clear previous pricing data
    state.variantPricing.clear();
    
    // Fetch pricing for ALL variants
    const pricingPromises = state.variants.map(async (variant) => {
      try {
        const requestBody = {
          productId: state.product.id,
          variantId: variant.id,
          size: variant.size || 'default'  // ← ADD THIS LINE
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
          // Round the base price to 2 decimals
          const basePrice = roundToTwoDecimals(result.basePrice);
          
          // Store full pricing structure for this variant
          const pricingData = {
            product_price: basePrice, // Printful cost
            artist_cut: state.artistCut, // User input
            platform_fee: calculatePlatformFee(basePrice), // 5% of product_price
            total_price: calculateTotalPrice(basePrice, state.artistCut) // Final price to customer
          };
          
          state.variantPricing.set(variant.id, pricingData);
          console.log(`✅ Variant ${variant.id} (${variant.size}) pricing:`, pricingData);
          return { variantId: variant.id, pricing: pricingData, success: true };
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
    console.log(`Variant pricing map:`, Array.from(state.variantPricing.entries()));
    
    if (successful === 0) {
      throw new Error("No variant prices could be fetched from API");
    }
    
    state.variantPricingLoaded = true;
    state.pricingLoaded = true;
    updatePricingDisplay();
    
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
    if (state.variantPricingLoaded && state.variantPricing.size > 0) {
      // Calculate product price range (Printful cost)
      const productPrices = Array.from(state.variantPricing.values())
        .map(p => p.product_price)
        .filter(price => price && !isNaN(price) && price > 0);
      
      if (productPrices.length === 0) {
        basePriceElement.textContent = 'Price not available';
      } else {
        const minPrice = Math.min(...productPrices);
        const maxPrice = Math.max(...productPrices);
        
        if (minPrice === maxPrice) {
          basePriceElement.textContent = `Base Cost: ${formatCurrency(minPrice)}`;
        } else {
          basePriceElement.textContent = `Base Cost: ${formatCurrency(minPrice)} - ${formatCurrency(maxPrice)}`;
        }
      }
    } else {
      // Fallback to old logic if variant pricing not loaded
      const prices = state.variants
        .filter(v => v.availability_status === 'active')
        .map(v => v.price || v.cost)
        .filter(price => price && !isNaN(price) && price > 0)
        .map(price => roundToTwoDecimals(price));
      
      if (prices.length === 0) {
        basePriceElement.textContent = 'Price not available';
      } else {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        if (minPrice === maxPrice) {
          basePriceElement.textContent = `Base Cost: ${formatCurrency(minPrice)}`;
        } else {
          basePriceElement.textContent = `Base Cost: ${formatCurrency(minPrice)} - ${formatCurrency(maxPrice)}`;
        }
      }
    }
    
    // Always show detailed pricing if we're in product mode
    if (!state.isArtMode) {
      showDetailedVariantPricing();
    }
  }
  
  if (artistCutElement) {
    // Update artist cut display
    artistCutElement.value = roundToTwoDecimals(state.artistCut).toFixed(2);
    artistCutElement.setAttribute('data-current-value', state.artistCut);
  }
  
  if (totalPriceElement) {
    if (state.variantPricingLoaded && state.variantPricing.size > 0) {
      // Calculate total price range (final price to customer)
      const totalPrices = Array.from(state.variantPricing.values())
        .map(p => p.total_price)
        .filter(price => price && !isNaN(price) && price > 0);
      
      if (totalPrices.length === 0) {
        totalPriceElement.textContent = formatCurrency(0);
      } else {
        const minTotal = Math.min(...totalPrices);
        const maxTotal = Math.max(...totalPrices);
        
        if (minTotal === maxTotal) {
          totalPriceElement.textContent = `Final Price: ${formatCurrency(minTotal)}`;
        } else {
          totalPriceElement.textContent = `Final Price: ${formatCurrency(minTotal)} - ${formatCurrency(maxTotal)}`;
        }
      }
    } else {
      // Fallback logic
      const prices = state.variants
        .filter(v => v.availability_status === 'active')
        .map(v => {
          const basePrice = v.price || v.cost;
          if (basePrice && !isNaN(basePrice) && basePrice > 0) {
            const roundedBase = roundToTwoDecimals(basePrice);
            return calculateTotalPrice(roundedBase, state.artistCut);
          }
          return null;
        })
        .filter(price => price !== null);
      
      if (prices.length === 0) {
        totalPriceElement.textContent = formatCurrency(0);
      } else {
        const minTotal = Math.min(...prices);
        const maxTotal = Math.max(...prices);
        
        if (minTotal === maxTotal) {
          totalPriceElement.textContent = `Final Price: ${formatCurrency(minTotal)}`;
        } else {
          totalPriceElement.textContent = `Final Price: ${formatCurrency(minTotal)} - ${formatCurrency(maxTotal)}`;
        }
      }
    }
  }
}

function handleArtistCutChange(event) {
  const newArtistCut = roundToTwoDecimals(parseFloat(event.target.value) || 0);
  
  // Update the input field with rounded value
  event.target.value = newArtistCut.toFixed(2);
  event.target.setAttribute('data-current-value', newArtistCut);
  
  // Update state
  state.artistCut = newArtistCut;
  
  // Recalculate pricing for all variants
  if (state.variantPricingLoaded) {
    state.variantPricing.forEach((pricingData, variantId) => {
      pricingData.artist_cut = newArtistCut;
      pricingData.total_price = calculateTotalPrice(pricingData.product_price, newArtistCut);
      // Platform fee remains the same (5% of product_price)
    });
  }
  
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
    
    // Monkey-patch ctx.drawImage to intercept overlay draws and apply rotation
    const originalDrawImage = ctx.drawImage.bind(ctx);
    const rotation = (state.overlayRotation || 0) * Math.PI / 180;

    if (state.overlayImage && rotation !== 0) {
        ctx.drawImage = function(...args) {
            const img = args[0];
            if (img === state.overlayImage) {
                // args: (img, x, y, w, h) — standard 5-arg form used by modules
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

    if (state.isArtMode) {
        state.currentModule.renderCanvas(state, elements, ctx);
    } else {
        state.currentModule.renderCanvas(state, elements, ctx, state.moduleState.baseImages, state.moduleState.imagesLoaded);
    }

    // Restore original drawImage
    ctx.drawImage = originalDrawImage;

    // Draw Photoshop-style transform overlay if image is loaded
    if (state.overlayImage) {
        drawTransformHandles(ctx);
    }
}

function drawTransformHandles(ctx) {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    const hs = HANDLE_SIZE;

    ctx.save();

    // Dashed bounding box
    ctx.strokeStyle = 'rgba(0, 120, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles
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

function handleRotateImage() {
    if (!state.overlayImage) return;
    state.overlayRotation = ((state.overlayRotation || 0) + 90) % 360;
    // Swap W/H on 90/270 to maintain bounding box
    if (state.overlayRotation % 180 !== 0) {
        // 90 or 270: swap width/height to fill same area
        const cx = state.overlayX + state.overlayW / 2;
        const cy = state.overlayY + state.overlayH / 2;
        const tmp = state.overlayW;
        state.overlayW = state.overlayH;
        state.overlayH = tmp;
        state.overlayX = cx - state.overlayW / 2;
        state.overlayY = cy - state.overlayH / 2;
    } else {
        // 0 or 180: restore original aspect from image
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

const HANDLE_SIZE = 10; // px in canvas coords

function getResizeHandles() {
    const { overlayX: x, overlayY: y, overlayW: w, overlayH: h } = state;
    return {
        tl: { x: x,       y: y },
        tr: { x: x + w,   y: y },
        bl: { x: x,       y: y + h },
        br: { x: x + w,   y: y + h },
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
        state.isDragging = true;
        state.dragStartX = pointerPos.x - state.overlayX;
        state.dragStartY = pointerPos.y - state.overlayY;
        elements.canvas.style.cursor = 'grabbing';
        if (event.type.includes('touch')) event.preventDefault();
    }
}

function handlePointerMove(event) {
    if (!state.overlayImage) return;
    const pointerPos = getPointerPosition(event);

    if (state.isResizing) {
        const dx = pointerPos.x - state.resizeStartX;
        const dy = pointerPos.y - state.resizeStartY;
        const handle = state.resizeHandle;
        const aspectRatio = state.resizeStartW / state.resizeStartH;

        let newW = state.resizeStartW;
        let newH = state.resizeStartH;
        let newX = state.resizeStartOX;
        let newY = state.resizeStartOY;

        // Constrain proportionally (hold Shift to constrain — always constrain for simplicity)
        if (handle === 'br') {
            newW = Math.max(20, state.resizeStartW + dx);
            newH = newW / aspectRatio;
        } else if (handle === 'bl') {
            newW = Math.max(20, state.resizeStartW - dx);
            newH = newW / aspectRatio;
            newX = state.resizeStartOX + state.resizeStartW - newW;
        } else if (handle === 'tr') {
            newW = Math.max(20, state.resizeStartW + dx);
            newH = newW / aspectRatio;
            newY = state.resizeStartOY + state.resizeStartH - newH;
        } else if (handle === 'tl') {
            newW = Math.max(20, state.resizeStartW - dx);
            newH = newW / aspectRatio;
            newX = state.resizeStartOX + state.resizeStartW - newW;
            newY = state.resizeStartOY + state.resizeStartH - newH;
        }

        state.overlayW = newW;
        state.overlayH = newH;
        state.overlayX = newX;
        state.overlayY = newY;

        // Sync scale state so slider stays in sync
        if (state.currentModule?.handleScaleChange) {
            const printArea = state.currentModule.getPrintArea?.(state);
            if (printArea) {
                state.scale = newW / printArea.width;
                const sliderValue = Math.round(state.scale * 100);
                const scaleSlider = document.getElementById('scale-slider');
                const scaleValue = document.getElementById('scale-value');
                if (scaleSlider) scaleSlider.value = sliderValue;
                if (scaleValue) scaleValue.textContent = `${sliderValue}%`;
            }
        }

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
    
    console.log('💾 Saving art with bgColor:', state.bgColor);
    
    const artId = await saveArtToFirebase(
      artData, 
      filename, 
      artName, 
      firestoreUserId,
      state.artPrice,
      state.artPlatformFee,
      state.artTotalPrice,
      state.bgColor
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

async function saveArtToFirebase(artData, filename, artName, userId, price, platformFee, totalPrice, bgColor = '#ffffff') {
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
          price: roundToTwoDecimals(price),
          platformFee: roundToTwoDecimals(platformFee),
          totalPrice: roundToTwoDecimals(totalPrice),
          bgColor: bgColor
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

    if (!state.variantPricingLoaded || state.variantPricing.size === 0) {
        throw new Error('Product pricing not loaded. Please wait or try again.');
    }

    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
    
    if (!firestoreUserId) {
        throw new Error('User information not found. Please log in again.');
    }

    // ✅ VALIDAÇÃO ANTES DE SALVAR
    console.log("=== VALIDAÇÃO DE PRICING ===");
    console.log("Variant pricing map:", Array.from(state.variantPricing.entries()));
    console.log("Artist cut:", state.artistCut);
    console.log("Variants count:", state.variants.length);

    // Validar que todos os variants têm pricing
    for (const variant of state.variants) {
        const pricing = state.variantPricing.get(variant.id);
        if (!pricing || pricing.product_price <= 0) {
            throw new Error(`Preço inválido ou não encontrado para variant ${variant.id}`);
        }
        
        console.log(`Variant ${variant.id} pricing:`, pricing);
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

        // ✅ CORRIGIDO: Process variants com cálculo correto e arredondamento
        const processedVariants = state.variants.map(variant => {
          if (!variant.id) throw new Error(`Variant missing ID`);
          
          const size = variant.size || 'One Size';
          const color = variant.color || 'N/A';
          const colorCode = variant.color_code || '#cccccc';
          const variantName = variant.name || `${state.product.name} - ${color} - ${size}`;
          
          // Get pricing data for this variant
          const pricingData = state.variantPricing.get(variant.id);
          if (!pricingData) {
            throw new Error(`No pricing data found for variant ${variant.id}`);
          }
          
          // Create well-organized variant data structure
          return {
            // ✅ Basic variant info
            id: variant.id,
            variant_id: variant.id,
            
            // ✅ Product info
            name: variantName,
            size: size,
            color: color,
            color_code: colorCode,
            
            // ✅ ORGANIZED PRICING STRUCTURE
            pricing: {
              // Base cost from Printful
              product_price: pricingData.product_price,
              
              // User-defined markup
              artist_cut: pricingData.artist_cut,
              
              // Platform fee (5% of product_price)
              platform_fee: pricingData.platform_fee,
              platform_fee_percentage: PLATFORM_FEE_PERCENTAGE,
              
              // Final price to customer
              total_price: pricingData.total_price,
              
              // Currency
              currency: "BRL"
            },
            
            // ✅ For display and compatibility
            retail_price: pricingData.total_price, // For Printful API compatibility
            price: pricingData.total_price, // For display
            
            // ✅ Add these for compatibility
            external_id: `variant_${variant.id}`,
            sku: `KAUARA_${state.product.id}_${variant.id}`,
            
            // ✅ Availability
            availability_status: variant.availability_status || 'active'
          };
        });

        // Calculate price ranges for display
        const totalPrices = processedVariants.map(v => v.pricing.total_price);
        const minPrice = Math.min(...totalPrices);
        const maxPrice = Math.max(...totalPrices);
        
        // ✅ CORRIGIDO: CRIAR pricing summary object
        const pricingSummary = {
            // Base pricing
            product_price_range: {
              min: Math.min(...processedVariants.map(v => v.pricing.product_price)),
              max: Math.max(...processedVariants.map(v => v.pricing.product_price))
            },
            
            // Artist cut (same for all variants)
            artist_cut: state.artistCut,
            
            // Platform fee percentage
            platform_fee_percentage: PLATFORM_FEE_PERCENTAGE,
            
            // Final price range
            total_price_range: {
              min: minPrice,
              max: maxPrice
            },
            
            // Currency
            currency: "BRL"
        };

        console.log("Print area for placement:", printArea);
        console.log("Save side for placement:", saveSide);
        
        // Create clean request body with user authentication info
        const requestBody = {
            // ✅ Basic Information
            name: `${firestoreUserId}-${customName}`,
            productTitle: customName,
            productId: state.product.id,
            designerUserId: firestoreUserId,
            side: saveSide,
            
            // ✅ Firebase Authentication Info
            firebaseUserId: currentUser.uid,
            userEmail: currentUser.email,
            
            // ✅ Design Information
            designImage: designImage,
            thumbnail: thumbnail,
            designScale: state.scale,
            
            // ✅ Placement Information
            placement: {
                area_width: areaWidthPx,
                area_height: areaHeightPx,
                width: areaWidthPx,
                height: areaHeightPx,
                left: 0,
                top: 0,
                side: saveSide
            },
            
            // ✅ ORGANIZED PRICING SUMMARY
            pricing_summary: pricingSummary,
            
            // ✅ ORGANIZED VARIANT INFORMATION
            availableColors: [...new Set(processedVariants.map(v => v.color))],
            availableSizes: [...new Set(processedVariants.map(v => v.size))],
            totalVariants: processedVariants.length,
            variants: processedVariants,
            
            // ✅ Timestamps
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            
            // ✅ Firestore collection
            firestoreCollection: 'products'
        };

        console.log("Saving product with side:", saveSide, "using print area:", printArea);
        console.log("Placement data:", requestBody.placement);
        console.log("Pricing summary:", requestBody.pricing_summary);
        console.log("Variants to save:", processedVariants.length);
        console.log("Request body structure:", Object.keys(requestBody));

        // Send request with authentication header
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        };

        console.log("Sending request to cloud function...");
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
            console.error('Server error response:', errorText);
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        if (result.success) {
            alert(`Product saved successfully for ${saveSide} side with ${processedVariants.length} variants!`);
            console.log("Product saved successfully. Firestore ID:", result.firestoreProductId);
            console.log("Printful Sync Product ID:", result.printfulSyncProductId);
            
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
  
  let html = '<h4 style="margin-bottom: 15px; color: #333;">Detailed Price Breakdown</h4>';
  
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
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Product Cost</th>
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Artist Cut</th>
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Platform Fee (5%)</th>
                <th style="text-align: right; padding: 8px 4px; font-weight: 600; color: #555;">Total Price</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    colorVariants.forEach(variant => {
      // Get the pricing data for this variant
      let pricingData;
      
      if (state.variantPricingLoaded && state.variantPricing.has(variant.id)) {
        pricingData = state.variantPricing.get(variant.id);
      } else {
        // Fallback
        const basePrice = variant.price || variant.cost || 0;
        pricingData = {
          product_price: roundToTwoDecimals(basePrice),
          artist_cut: state.artistCut,
          platform_fee: calculatePlatformFee(basePrice),
          total_price: calculateTotalPrice(basePrice, state.artistCut)
        };
      }
      
      const isAvailable = variant.availability_status === 'active';
      
      if (pricingData.product_price && !isNaN(pricingData.product_price)) {
        html += `
          <tr style="${!isAvailable ? 'opacity: 0.6; color: #6c757d;' : 'color: #333;'} border-bottom: 1px solid #eee;">
            <td style="padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              ${variant.size || 'One Size'}
              ${!isAvailable ? ' (Unavailable)' : ''}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              ${formatCurrency(pricingData.product_price)}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              ${formatCurrency(pricingData.artist_cut)}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              ${formatCurrency(pricingData.platform_fee)}
            </td>
            <td style="text-align: right; padding: 8px 4px; ${!isAvailable ? 'color: #6c757d;' : ''}">
              <strong>${formatCurrency(pricingData.total_price)}</strong>
            </td>
          </tr>
        `;
      } else {
        html += `
          <tr style="opacity: 0.6; color: #6c757d; border-bottom: 1px solid #eee;">
            <td style="padding: 8px 4px;">${variant.size || 'One Size'}</td>
            <td colspan="4" style="text-align: right; padding: 8px 4px;">
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
      <strong>Pricing Formula:</strong> Total Price = Product Cost + Artist Cut + (Product Cost × 5%)<br>
      <small>Platform fee is 5% of the product cost</small>
    </div>
  `;
  
  pricingContainer.innerHTML = html;
}

async function createThumbnail(saveSide, printArea) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = 800;
  canvas.width = canvas.height = size;

  ctx.clearRect(0, 0, size, size);

  const baseImage = state.moduleState.baseImages?.[saveSide];
  if (baseImage && baseImage.complete) {
    const scale = Math.min(size / baseImage.width, size / baseImage.height);
    const w = baseImage.width * scale;
    const h = baseImage.height * scale;
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    ctx.drawImage(baseImage, x, y, w, h);

    if (printArea && state.overlayImage) {
      // Map print area into thumbnail space, accounting for the centering offset (x, y)
      const thumbPrintAreaX = x + (printArea.x / baseImage.width) * w;
      const thumbPrintAreaY = y + (printArea.y / baseImage.height) * h;
      const thumbPrintAreaW = (printArea.width / baseImage.width) * w;
      const thumbPrintAreaH = (printArea.height / baseImage.height) * h;

      // Map overlay position into thumbnail space using the same scale
      const thumbOverlayX = x + (state.overlayX / baseImage.width) * w;
      const thumbOverlayY = y + (state.overlayY / baseImage.height) * h;
      const thumbOverlayW = (state.overlayW / baseImage.width) * w;
      const thumbOverlayH = (state.overlayH / baseImage.height) * h;

      // Clip to print area so the design never bleeds outside its bounds
      ctx.save();
      ctx.beginPath();
      ctx.rect(thumbPrintAreaX, thumbPrintAreaY, thumbPrintAreaW, thumbPrintAreaH);
      ctx.clip();

      // Apply rotation around overlay center
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

      const thumbOverlayW = (state.overlayW / printArea.width) * thumbPrintAreaW;
      const thumbOverlayH = (state.overlayH / printArea.height) * thumbPrintAreaH;
      const thumbOverlayX = thumbPrintAreaX + ((state.overlayX - printArea.x) / printArea.width) * thumbPrintAreaW;
      const thumbOverlayY = thumbPrintAreaY + ((state.overlayY - printArea.y) / printArea.height) * thumbPrintAreaH;

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
  }

  return canvas.toDataURL('image/png');
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

    // Rotate button
    const rotateBtn = document.getElementById('rotate-btn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', handleRotateImage);
    }
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
            // Set initial value
            artistCutInput.value = state.artistCut.toFixed(2);
            artistCutInput.setAttribute('data-current-value', state.artistCut);
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