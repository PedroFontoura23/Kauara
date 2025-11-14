// canvas-client.js - Modernized client product customization
import { PRINT_AREAS } from './printAreas.js';
import * as ClientOneSideModule from './client-one-side.js';
import * as ClientTwoSideModule from './client-two-side.js';

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

// Application State - EXACTLY like canvas.js
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
  moduleState: {},
  // EXACTLY like canvas.js
  variantPrices: new Map(),
  variantPricingLoaded: false,
  canvasScale: 1,
  // NEW: Touch gesture support
  initialDistance: null,
  initialScale: 1
};

// Product type detection
function getProductType(productId) {
  return TWO_SIDED_PRODUCTS.includes(parseInt(productId)) ? 'two-sided' : 'one-sided';
}

// Initialize
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  try {
    console.log("Initializing modernized client canvas application...");
    
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
    
    // Setup UI with modern variant selection
    renderVariantOptions();
    setupEventListeners();
    updateCanvasScale();
    
    // Load art and fetch pricing
    await loadSelectedArt();
    await fetchProductPricing();

    // FIXED: Auto-select smallest price variant after pricing loads
    console.log('Pricing loaded, auto-selecting variant...');
    // Remove the setTimeout and call directly since fetchProductPricing is already awaited
    autoSelectSmallestPriceVariant();

  } catch (error) {
    console.error('Failed to initialize app:', error);
    alert('Failed to initialize product customization. Please try again.');
  }
}

function loadSessionData() {
  const productData = sessionStorage.getItem('selectedProduct');
  const variantData = sessionStorage.getItem('selectedVariants');
  const artData = sessionStorage.getItem('selectedArt');
  
  if (!productData) throw new Error('No product data found in session storage');
  if (!variantData) throw new Error('No variant data found in session storage');
  
  state.product = JSON.parse(productData);
  state.variants = JSON.parse(variantData);
  state.selectedVariant = state.variants[0] || null;
  
  if (artData) {
    state.selectedArt = JSON.parse(artData);
  }
  
  if (!state.selectedVariant) {
    throw new Error('No variants available for selected product');
  }

  // EXACTLY like canvas.js
  console.log("=== PRODUCT DATA ===");
  console.log("Product ID:", state.product.id);
  console.log("Product Name:", state.product.name);
  console.log("Total variants:", state.variants.length);
}

// EXACTLY like canvas.js variant rendering
function renderVariantOptions() {
  if (!state.variants.length) return;
  
  const variantsByColor = {};
  state.variants.forEach(variant => {
    const color = variant.color;
    if (!color) throw new Error(`Variant ${variant.id} is missing color property`);
    
    if (!variantsByColor[color]) {
      variantsByColor[color] = [];
    }
    variantsByColor[color].push(variant);
  });
  
  let html = '';
  
  Object.keys(variantsByColor).forEach(color => {
    const colorVariants = variantsByColor[color];
    const firstVariant = colorVariants[0];
    const colorCode = firstVariant.color_code;
    
    if (!colorCode) throw new Error(`Variant ${firstVariant.id} is missing color_code property`);
    
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
function updatePricingForSelectedVariant() {
  if (!state.selectedVariant || !state.variantPricingLoaded) return;
  
  const variantPrice = state.variantPrices.get(state.selectedVariant.id);
  const artPrice = state.selectedArt?.totalPrice || state.selectedArt?.price || 0;
  
  if (variantPrice && !isNaN(variantPrice)) {
    state.basePrice = variantPrice;
    const platformFee = (variantPrice + artPrice) * 0.05;
    state.totalPrice = (variantPrice + artPrice) * 1.05; // Include 5% platform fee
    
    console.log('Updating pricing display:', {
      variantPrice,
      artPrice,
      platformFee,
      totalPrice: state.totalPrice
    });
    
    // Call with explicit values
    updatePricingDisplay(variantPrice, artPrice, platformFee, state.totalPrice);
  }
  
  updateSelectedVariantDisplay();
  renderCanvas();
}
// EXACTLY LIKE canvas.js PRICING FETCH
async function fetchProductPricing() {
  if (!state.selectedVariant) return;
  
  try {
    console.log("=== STARTING PRICING FETCH ===");
    console.log("Fetching pricing for all variants of product:", state.product.id);
    
    // Clear previous prices - EXACTLY like canvas.js
    state.variantPrices.clear();
    
    // Fetch pricing for ALL variants - EXACTLY like canvas.js
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

    // Don't call updatePricingDisplay here - let autoSelectSmallestPriceVariant handle it
    console.log('Pricing loaded successfully, ready for variant selection');

    // Don't call updatePricingDisplay here - let autoSelectSmallestPriceVariant handle it
    console.log('Pricing loaded successfully, ready for variant selection');
    
  } catch (error) {
    console.error('❌ Error in pricing fetch:', error);
    throw new Error(`Pricing fetch failed: ${error.message}`);
  }
}

// Enhanced pricing display with breakdown
function updatePricingDisplay(productPrice = state.basePrice, artPrice = (state.selectedArt?.totalPrice || state.selectedArt?.price || 0), platformFee = 0, totalPrice = state.totalPrice) {
  const artPriceElement = document.getElementById('art-price-display');
  const basePriceElement = document.getElementById('base-price');
  const totalPriceElement = document.getElementById('total-price');
  
  if (artPriceElement) artPriceElement.textContent = `R$ ${artPrice.toFixed(2)}`;
  
  if (basePriceElement && totalPriceElement) {
    if (productPrice && !isNaN(productPrice) && productPrice > 0) {
      basePriceElement.textContent = `R$ ${productPrice.toFixed(2)}`;
      totalPriceElement.textContent = `R$ ${totalPrice.toFixed(2)}`;
      basePriceElement.style.color = ''; // Reset color
      totalPriceElement.style.color = ''; // Reset color
    } else {
      basePriceElement.textContent = 'Select a size';
      totalPriceElement.textContent = 'R$ 0.00';
      // Add visual warning
      basePriceElement.style.color = '#dc3545';
      totalPriceElement.style.color = '#dc3545';
    }
  }
  
  // Show detailed pricing breakdown
  showDetailedPricingBreakdown(productPrice, artPrice, platformFee, totalPrice);
}

// NEW: Detailed pricing breakdown display
function showDetailedPricingBreakdown(productPrice = state.basePrice, artPrice = (state.selectedArt?.totalPrice || state.selectedArt?.price || 0), platformFee = 0, totalPrice = state.totalPrice) {
  const platformFeeEl = document.getElementById('platform-fee');
  const priceRangeInfo = document.getElementById('price-range-info');
  
  // Calculate platform fee if not provided
  if (platformFee === 0 && productPrice && artPrice) {
    platformFee = (productPrice + artPrice) * 0.05;
  }
  
  if (platformFeeEl) {
    platformFeeEl.textContent = `R$ ${platformFee.toFixed(2)}`;
  }
  
  // Show/hide price range info
  if (priceRangeInfo) {
    if (state.variantPricingLoaded && state.variantPrices.size > 1) {
      const prices = Array.from(state.variantPrices.values()).filter(p => p && !isNaN(p));
      if (prices.length > 1) {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        priceRangeInfo.innerHTML = `<small>Price range: R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)} (varies by size)</small>`;
        priceRangeInfo.style.display = 'block';
      } else {
        priceRangeInfo.style.display = 'none';
      }
    } else {
      priceRangeInfo.style.display = 'none';
    }
  }
  
  // Update selected variant display
  updateSelectedVariantDisplay();
}
function updateSelectedVariantDisplay() {
  if (!state.selectedVariant || !state.variantPricingLoaded) return;
  
  const selectedVariantDisplay = document.getElementById('selected-variant-display');
  const variantPriceDisplay = document.getElementById('variant-price-display');
  
  if (selectedVariantDisplay) {
    selectedVariantDisplay.textContent = `${state.selectedVariant.color} - ${state.selectedVariant.size || 'One Size'}`;
  }
  
  if (variantPriceDisplay && state.selectedVariant) {
    const variantPrice = state.variantPrices.get(state.selectedVariant.id);
    if (variantPrice && !isNaN(variantPrice)) {
      variantPriceDisplay.textContent = `R$ ${variantPrice.toFixed(2)}`;
    } else {
      variantPriceDisplay.textContent = 'Loading...';
    }
  }
}

// MODERNIZED: Art loading with CORS
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
    if (elements.artName) elements.artName.textContent = artData.name || 'Untitled Art';
    if (elements.artDescription) elements.artDescription.textContent = artData.description || '';
    if (elements.artPrice) elements.artPrice.textContent = `Price: R$ ${(artData.totalPrice || artData.price || 0).toFixed(2)}`;
    
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
    
    img.src = url + '?t=' + Date.now();
  });
}

function renderCanvas() {
  if (!state.currentModule) return;
  
  state.currentModule.renderCanvas(state, elements, ctx, state.moduleState.baseImages, state.moduleState.imagesLoaded);
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

async function handleSaveProduct() {
  console.log('=== handleSaveProduct STARTED ===');
  
  // Validation
  if (!state.overlayImage) {
    console.error('No overlay image');
    alert('No art image available');
    return;
  }

  const customName = elements.productNameInput.value.trim();
  if (!customName) {
    console.error('No product name');
    alert('Please enter a product name');
    return;
  }

  if (!state.variantPricingLoaded || state.variantPrices.size === 0) {
    console.error('Pricing not loaded');
    alert('Product pricing not loaded. Please wait or try again.');
    return;
  }

  // Strict price validation
  const artPrice = state.selectedArt?.totalPrice || state.selectedArt?.price || 0;
  const variantPrice = state.variantPrices.get(state.selectedVariant?.id);
  
  console.log('Price validation:', {
    selectedVariant: state.selectedVariant,
    variantPrice: variantPrice,
    artPrice: artPrice
  });
  
  if (!state.selectedVariant) {
    console.error('No variant selected');
    alert('Please select a size before saving.');
    autoSelectSmallestPriceVariant();
    return;
  }
  
  if (!variantPrice || variantPrice <= 0 || isNaN(variantPrice)) {
    console.error('Invalid variant price:', variantPrice);
    alert(`The selected size "${state.selectedVariant.size}" has an invalid price. Please select a different size.`);
    autoSelectSmallestPriceVariant();
    return;
  }

  const totalPrice = (variantPrice + artPrice) * 1.05;
  if (totalPrice <= 0) {
    console.error('Invalid total price:', totalPrice);
    alert('Total price calculation error. Please try selecting a different size.');
    autoSelectSmallestPriceVariant();
    return;
  }

  console.log('✅ All validations passed');

  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                       sessionStorage.getItem('currentFirestoreUserId');
  
  if (!firestoreUserId) {
    console.error('No user ID found');
    alert('User information not found. Please log in again.');
    window.location.href = 'profile.html';
    return;
  }

  const { saveBtn } = elements;
  try {
    console.log('Starting save process...');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Get save side from module
    const saveSide = state.currentModule?.getSaveSide ? state.currentModule.getSaveSide(elements) : 'front';
    const physicalArea = PHYSICAL_PRINT_AREAS[state.product.id]?.[saveSide] || 
                     PHYSICAL_PRINT_AREAS[state.product.id]?.default;
    
    if (!physicalArea) {
      console.error('No physical area for product:', state.product.id, 'side:', saveSide);
      alert('Physical print area not defined for this product');
      return;
    }

    console.log('Creating composite image...');
    const areaWidthPx = Math.round(physicalArea.widthInches * 300);
    const areaHeightPx = Math.round(physicalArea.heightInches * 300);

    // Create composite for Printful
    const compositeCanvas = document.createElement('canvas');
    const compositeCtx = compositeCanvas.getContext('2d');
    compositeCanvas.width = areaWidthPx;
    compositeCanvas.height = areaHeightPx;

    const printArea = state.currentModule?.getPrintArea ? state.currentModule.getPrintArea(state) : null;
    if (!printArea) {
      console.error('No print area found');
      alert('Print area not defined for this product');
      return;
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

    const compositeImage = compositeCanvas.toDataURL('image/png');
    
    console.log('Creating thumbnail...');
    const thumbnail = await createThumbnail(saveSide, printArea);

    // Process variants
    console.log('Processing selected variant only...');
    const selectedVariant = state.selectedVariant;

    if (!selectedVariant.id) throw new Error(`Selected variant missing ID`);
    if (!selectedVariant.size) throw new Error(`Selected variant missing size`);
    if (!selectedVariant.color) throw new Error(`Selected variant missing color`);
    if (!selectedVariant.color_code) throw new Error(`Selected variant missing color_code`);

    const processedVariants = [{
      id: selectedVariant.id,
      productId: state.product.id,
      name: selectedVariant.name,
      size: selectedVariant.size,
      color: selectedVariant.color,
      colorCode: selectedVariant.color_code,
      color_code: selectedVariant.color_code,
      price: totalPrice, // Use the already calculated totalPrice
      flatLayUrl: selectedVariant.flat_lay_url || null,
      retail_price: totalPrice,
      availability_status: 'active'
    }];

    console.log('Processed variant:', processedVariants[0]);

    // Calculate price ranges
    const prices = processedVariants.map(v => v.price);
    const minPrice = prices[0]; // Only one variant
    const maxPrice = prices[0]; // Only one variant

    // Create request body
    const requestBody = {
      name: `${firestoreUserId}-${customName}`,
      productTitle: customName,
      productId: state.product.id,
      designerUserId: firestoreUserId,
      side: saveSide,
      firestoreCollection: 'products-client',
      artistUserId: state.selectedArt?.userId,
      originalArtId: state.selectedArt?.id,
      designImage: compositeImage,
      thumbnail: thumbnail,
      designScale: state.scale,
      placement: {
        area_width: areaWidthPx,
        area_height: areaHeightPx,
        width: areaWidthPx,
        height: areaHeightPx,
        left: 0,
        top: 0,
        side: saveSide
      },
      pricing: {
        priceRange: {
          min: minPrice,
          max: maxPrice
        },
        currency: "BRL",
        artPrice: artPrice
      },
      availableColors: [selectedVariant.color], // Single color
      availableSizes: [selectedVariant.size], // Single size
      totalVariants: 1, // Always 1 now
      variants: processedVariants
    };

    console.log('Sending request to cloud function...', {
      productId: state.product.id,
      variantsCount: processedVariants.length,
      collection: 'products-client'
    });

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

    console.log('Cloud function response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cloud function error:', errorText);
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Cloud function result:', result);
    
    if (result.success) {
      console.log('✅ Product saved successfully!');
      alert(`Product saved successfully for ${saveSide} side with ${processedVariants.length} variants!`);
      sessionStorage.removeItem('selectedArt');
      
      if (result.firestoreProductId) {
        sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
        sessionStorage.setItem('checkoutProductId', result.firestoreProductId);
      }
      
      showPurchaseNowButton();
      
    } else {
      throw new Error(result.error || 'Failed to save product');
    }
  } catch (error) {
    console.error('Error in handleSaveProduct:', error);
    alert(`Error saving product: ${error.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Product';
    console.log('=== handleSaveProduct COMPLETED ===');
  }
}

// NEW: Show purchase now button after save
function showPurchaseNowButton() {
  const saveBtn = elements.saveBtn;
  saveBtn.textContent = 'Purchase Now';
  saveBtn.onclick = () => {
    const productId = sessionStorage.getItem('checkoutProductId');
    if (productId) {
      // Redirect to checkout page
      window.location.href = `checkout.html?productId=${productId}`;
    } else {
      alert('Product ID not found. Please save the product again.');
    }
  };
}

// MODERNIZED: Thumbnail generation with 0.7 quality
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
  
  return canvas.toDataURL('image/jpeg', 0.7); // 0.7 quality for thumbnails
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

// MODERNIZED: Touch gesture support
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
function autoSelectSmallestPriceVariant() {
  if (!state.variantPricingLoaded || state.variantPrices.size === 0) {
    console.log('Pricing not loaded yet, cannot auto-select');
    return;
  }
  
  console.log('Auto-selecting smallest price variant...');
  console.log('Available variant prices:', Array.from(state.variantPrices.entries()));
  
  // Find variant with smallest price
  let smallestPrice = Infinity;
  let smallestPriceVariant = null;
  
  state.variants.forEach(variant => {
    const price = state.variantPrices.get(variant.id);
    console.log(`Variant ${variant.id} (${variant.size}): price = ${price}, available = ${variant.availability_status}`);
    
    // Remove availability_status check - it might not exist or be set correctly
    if (price && price > 0 && !isNaN(price) && price < smallestPrice) {
      smallestPrice = price;
      smallestPriceVariant = variant;
    }
  });
  
  // Select the variant if found
  if (smallestPriceVariant) {
    state.selectedVariant = smallestPriceVariant;
    
    // Calculate prices immediately
    const variantPrice = state.variantPrices.get(smallestPriceVariant.id);
    const artPrice = state.selectedArt?.totalPrice || state.selectedArt?.price || 0;
    const platformFee = (variantPrice + artPrice) * 0.05;
    const totalPrice = (variantPrice + artPrice) * 1.05;
    
    // Update state
    state.basePrice = variantPrice;
    state.totalPrice = totalPrice;
    
    console.log('Calculated pricing:', {
      variantPrice,
      artPrice,
      platformFee,
      totalPrice
    });
    
    // Update UI to show selected state
    document.querySelectorAll('.variant-option').forEach(option => {
      option.classList.remove('selected');
    });
    
    const selectedOption = document.querySelector(`.variant-option[data-id="${smallestPriceVariant.id}"]`);
    if (selectedOption) {
      selectedOption.classList.add('selected');
      console.log('✅ Auto-selected variant:', smallestPriceVariant.size, smallestPriceVariant.color, 'Price: R$', smallestPrice);
    } else {
      console.warn('Could not find DOM element for variant:', smallestPriceVariant.id);
    }
    
    // Force pricing display update with calculated values
    updatePricingDisplay(variantPrice, artPrice, platformFee, totalPrice);
    updateSelectedVariantDisplay();
    renderCanvas();
  } else {
    console.warn('No valid variant found for auto-selection');
  }
}
function updateCanvasScale() {
  const rect = elements.canvas.getBoundingClientRect();
  state.canvasScale = elements.canvas.width / rect.width;
}
function handleVariantSelection(event) {
  const variantOption = event.target.closest('.variant-option');
  if (!variantOption) return;
  
  const variantId = parseInt(variantOption.dataset.id);
  const newVariant = state.variants.find(v => v.id === variantId);
  
  if (newVariant && newVariant !== state.selectedVariant) {
    state.selectedVariant = newVariant;
    
    // Update UI to show selected state
    document.querySelectorAll('.variant-option').forEach(option => {
      option.classList.remove('selected');
    });
    variantOption.classList.add('selected');
    
    console.log("Selected variant:", newVariant);
    
    // Update pricing for the SELECTED variant
    updatePricingForSelectedVariant();
    
    // NEW: Validate if price is available
    const variantPrice = state.variantPrices.get(newVariant.id);
    if (!variantPrice || variantPrice <= 0) {
      console.warn('Selected variant has no price:', newVariant.id);
    }
  }
}

// MODERNIZED: Event listener setup with touch gestures
function setupEventListeners() {
  elements.variantSelection.addEventListener('click', (event) => handleVariantSelection(event));  
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
  elements.canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  elements.canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  elements.canvas.addEventListener('touchend', handleTouchEnd);
  elements.canvas.addEventListener('touchcancel', handleTouchEnd);
  
  elements.canvas.addEventListener('dragstart', e => e.preventDefault());
  
  // FIXED: Direct function reference with proper error handling
  elements.saveBtn.addEventListener('click', function(event) {
    console.log('Save button clicked!');
    event.preventDefault();
    
    // Call the function directly
    handleSaveProduct().catch(error => {
      console.error('Save product error:', error);
      alert(`Error saving product: ${error.message}`);
    });
  });
  
  window.addEventListener('resize', () => {
    setTimeout(updateCanvasScale, 100);
  });
}

function cmToPx(cm, dpi = DPI) {
  return Math.round((cm / 2.54) * dpi);
}

export { state, elements, ctx };
