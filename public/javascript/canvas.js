import { PRINT_AREAS } from './printAreas.js';
import * as OneSideModule from './one-side.js';
import * as TwoSideModule from './two-side.js';
import * as ArtModeModule from './art-mode.js';

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
  moduleState: {}
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
        
        // Check mode
        const isArtMode = sessionStorage.getItem('creationMode') === 'art';
        
        // Get Firestore user ID
        const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                               sessionStorage.getItem('currentFirestoreUserId');
        
        console.log("Firestore User ID:", firestoreUserId);
        console.log("Current mode:", isArtMode ? "Art" : "Product");
        
        if (!firestoreUserId) {
            console.error("No Firestore user ID found");
            alert('User information not found. Please log in again.');
            window.location.href = 'profile.html';
            return;
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
    }
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
    fetchProductPricing();
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
    state.artPlatformFee = state.artPrice * 0.05; // 5% platform fee
    state.artTotalPrice = state.artPrice + state.artPlatformFee;
    
    platformFeeElement.textContent = `R$ ${state.artPlatformFee.toFixed(2)}`;
    totalPriceElement.textContent = `R$ ${state.artTotalPrice.toFixed(2)}`;
  }
}

async function fetchProductPricing() {
  if (state.isArtMode || !state.selectedVariant) return;
  
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
        updatePricingDisplay();
        state.pricingLoaded = true;
      }
    }
  } catch (error) {
    console.error('Error fetching pricing:', error);
    // Set a fallback price
    state.basePrice = state.selectedVariant.retail_price || 29.99;
    updatePricingDisplay();
  }
}

function updatePricingDisplay() {
  const basePriceElement = document.getElementById('base-price');
  const artistCutElement = document.getElementById('artist-cut');
  const totalPriceElement = document.getElementById('total-price');
  
  if (basePriceElement) {
    basePriceElement.textContent = `$${state.basePrice.toFixed(2)}`;
  }
  
  if (artistCutElement) {
    artistCutElement.value = state.artistCut.toFixed(2);
  }
  
  if (totalPriceElement) {
    state.totalPrice = state.basePrice + state.artistCut + (state.basePrice + state.artistCut) * 0.05; // 10% platform fee
    totalPriceElement.textContent = `$${state.totalPrice.toFixed(2)}`;
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
        // Art mode UI code
        if (sideSelector) sideSelector.style.display = 'none';
        if (viewButtons) viewButtons.style.display = 'none';
        if (variantSelection) variantSelection.style.display = 'none';
        if (saveSideContainer) saveSideContainer.style.display = 'none';
        if (pricingSection) pricingSection.style.display = 'none';
        if (pageTitle) pageTitle.textContent = 'Art Canvas';
        if (canvasTitle) canvasTitle.textContent = 'Art Canvas';
        if (nameLabel) nameLabel.textContent = 'Art Name:';
        if (saveBtn) saveBtn.textContent = 'Save Art';
        
        // Show art-only elements
        if (bgColorContainer) bgColorContainer.style.display = 'block';
        if (clearCanvasBtn) clearCanvasBtn.style.display = 'inline-block';
        document.querySelectorAll('.art-only').forEach(el => {
            if (el) el.style.display = 'block';
        });
    } else {
        // Product mode UI code
        if (sideSelector) sideSelector.style.display = 'block';
        if (saveSideContainer) saveSideContainer.style.display = 'block';
        if (pricingSection) pricingSection.style.display = 'block';
        if (pageTitle) pageTitle.textContent = 'Product Canvas';
        if (canvasTitle) canvasTitle.textContent = 'Product Canvas';
        if (nameLabel) nameLabel.textContent = 'Product Name:';
        if (saveBtn) saveBtn.textContent = 'Save Product';
        
        // Hide art-only elements
        if (bgColorContainer) bgColorContainer.style.display = 'none';
        if (clearCanvasBtn) clearCanvasBtn.style.display = 'none';
        document.querySelectorAll('.art-only').forEach(el => {
            if (el) el.style.display = 'none';
        });
        
        // View buttons handled by modules
    }
    
    // Update canvas scale after UI changes
    setTimeout(updateCanvasScale, 100);
}

function setupArtMode() {
    // Initialize with background color
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
  
  if (!productData || !variantData) {
    throw new Error('No product or variant data found');
  }
  
  state.product = JSON.parse(productData);
  state.variants = JSON.parse(variantData);
  state.selectedVariant = state.variants[0] || null;
  
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

function handleVariantSelection(event) {
  const variantOption = event.target.closest('.variant-option');
  if (!variantOption) return;
  
  const variantId = parseInt(variantOption.dataset.id);
  const newVariant = state.variants.find(v => v.id === variantId);
  
  if (newVariant && newVariant !== state.selectedVariant) {
    state.selectedVariant = newVariant;
    renderVariantOptions();
    renderCanvas();
    // Fetch pricing for the new variant
    fetchProductPricing();
  }
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file?.type.startsWith('image/')) {
    alert('Please select a valid image file');
    return;
  }
  
  // Reset scale to 100%
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
    
    // Prevent default for touch events to avoid scrolling
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
  
  // Handle both mouse and touch events
  let clientX, clientY;
  
  if (event.type.includes('touch')) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  
  // Convert screen coordinates to canvas coordinates
  // Account for canvas scaling (CSS vs actual canvas size)
  const x = (clientX - rect.left) * (elements.canvas.width / rect.width);
  const y = (clientY - rect.top) * (elements.canvas.height / rect.height);
  
  return { x, y };
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
      console.warn('Firebase not available, proceeding without auth token');
      return null;
    }
    
    const user = firebase.auth().currentUser;
    if (!user) {
      console.warn('No authenticated user, proceeding without auth token');
      return null;
    }
    
    console.log("Getting auth token for user:", user.uid);
    const token = await user.getIdToken();
    console.log("Auth token retrieved successfully");
    return token;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
}

async function handleSaveArt() {
  if (!state.overlayImage) {
    alert('Please upload an image first');
    return;
  }

  // Validate art name
  const artName = document.getElementById('item-name').value.trim();
  if (!artName) {
    alert('Please enter an art name');
    return;
  }

  // Validate art price
  if (state.artPrice <= 0) {
    alert('Please enter a valid price for your art');
    return;
  }

  // Get Firestore user ID from session storage
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

    // Create a temporary canvas with just the original image dimensions
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = state.overlayImage.naturalWidth;
    tempCanvas.height = state.overlayImage.naturalHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the original image at full resolution with transparent background
    // This preserves the original image's transparency
    tempCtx.drawImage(state.overlayImage, 0, 0);
    
    // Use PNG format to preserve transparency
    const artData = tempCanvas.toDataURL('image/png');
    const filename = `${firestoreUserId}-${artName.replace(/\s+/g, '-').toLowerCase()}`;
    
    // Save to Firebase with pricing information
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
    alert(`Error saving art: ${error.message}`);
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
          price: price,           // Direct fields, not nested
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
    
    // Original product saving code below...
    if (!state.overlayImage) {
        alert('Please upload an image first');
        return;
    }

    // Validate product name
    const customName = elements.productNameInput.value.trim();
    if (!customName) {
        alert('Please enter a product name');
        return;
    }

    // Validate artist cut
    if (state.artistCut < 0) {
        alert('Artist cut cannot be negative');
        return;
    }

    // Get Firestore user ID from session storage
    const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
    
    // Log the user IDs
    console.log("Firestore User ID for product:", firestoreUserId);
    console.log("Product details:", {
        productId: state.product?.id,
        customName: customName,
        variants: state.variants.length,
        basePrice: state.basePrice,
        artistCut: state.artistCut,
        totalPrice: state.totalPrice
    });
    
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

        console.log("Physical print area:", physicalArea);
        console.log("Selected side:", saveSide);

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

        console.log("Canvas print area:", printArea);

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
        
        // Create thumbnail
        const thumbnail = await createThumbnail(saveSide, printArea);

        const placement = {
            area_width: areaWidthPx,
            area_height: areaHeightPx,
            left: 0, top: 0,
            width: areaWidthPx,
            height: areaHeightPx
        };

        // Create product name with Firestore user ID and custom name
        const productName = `${firestoreUserId}-${customName}`;
        console.log("Final product name:", productName);

        const requestBody = {
            name: productName, // Use Firestore user ID + custom name
            thumbnail,
            side: saveSide,
            variants: state.variants.map(v => ({ 
                id: v.id, 
                price: v.retail_price || 29.99,
                color: v.color || 'N/A'
            })),
            designImage: compositeImage,
            placement,
            designerUserId: firestoreUserId, // Include Firestore designer ID
            productId: state.product.id,
            productTitle: customName, // Use custom name as product title
            pricing: {
                basePrice: state.basePrice,
                userMarkup: state.artistCut,
                totalPrice: state.totalPrice,
                platformFee: (state.basePrice + state.artistCut) * 0.10
            }
        };

        // Log the request body (without the large image data)
        console.log("Request body to server:", {
            name: requestBody.name,
            side: requestBody.side,
            variants: requestBody.variants.length,
            designerUserId: requestBody.designerUserId,
            productId: requestBody.productId,
            productTitle: requestBody.productTitle,
            hasThumbnail: !!requestBody.thumbnail,
            hasDesignImage: !!requestBody.designImage,
            placement: requestBody.placement,
            pricing: requestBody.pricing
        });

        // Get auth token
        const authToken = await getAuthToken();
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
            console.log("Auth token available, adding to headers");
        } else {
            console.log("No auth token available, proceeding without");
        }

        console.log("Sending request to server...");
        const startTime = Date.now();
        
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/saveProduct', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        const endTime = Date.now();
        console.log(`Request completed in ${endTime - startTime}ms`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Server error response:", errorText);
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("Server response:", result);
        
        if (result.success) {
            alert('Product saved successfully!');
            console.log("Product saved successfully for Firestore user:", firestoreUserId);
            console.log("Firestore product ID:", result.firestoreProductId);
            
            // You can store the Firestore product ID if needed
            if (result.firestoreProductId) {
                sessionStorage.setItem('lastSavedProductId', result.firestoreProductId);
            }
            
            renderCanvas();
        } else {
            throw new Error(result.error || 'Failed to save product');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        
        // More specific error messages
        if (error.message.includes('Failed to fetch')) {
            alert('Network error. Please check your connection and try again.');
        } else if (error.message.includes('Server error')) {
            alert('Server error. Please try again later.');
        } else {
            alert(`Error saving product: ${error.message}`);
        }
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
  
  // Background
  ctx.fillStyle = state.selectedVariant.color_code || '#ffffff';
  ctx.fillRect(0, 0, size, size);
  
  // Base image - use module's base images if available
  const baseImage = state.moduleState.baseImages?.[saveSide] || state.moduleState.baseImages?.front;
  if (baseImage && baseImage.complete) {
    const scale = Math.min(size / baseImage.width, size / baseImage.height);
    const w = baseImage.width * scale;
    const h = baseImage.height * scale;
    const x = (size - w) / 2;
    const y = (size - h) / 2;
    ctx.drawImage(baseImage, x, y, w, h);
    
    // Overlay
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
    
    document.getElementById('upload-btn').addEventListener('click', () => elements.uploadInput.click());
    elements.uploadInput.addEventListener('change', handleFileUpload);
    elements.saveBtn.addEventListener('click', handleSaveProduct);
    
    // Mouse listeners for desktop
    elements.canvas.addEventListener('mousedown', handlePointerDown);
    elements.canvas.addEventListener('mousemove', handlePointerMove);
    elements.canvas.addEventListener('mouseup', handlePointerUp);
    elements.canvas.addEventListener('mouseleave', handlePointerUp);

    // Touch listeners for mobile
    elements.canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
    elements.canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
    elements.canvas.addEventListener('touchend', handlePointerUp);
    elements.canvas.addEventListener('touchcancel', handlePointerUp);
    
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