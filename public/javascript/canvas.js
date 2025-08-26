import { PRINT_AREAS } from './printAreas.js';

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
  uploadInput: document.getElementById('upload-input'),
  frontBtn: document.getElementById('front-btn'),
  backBtn: document.getElementById('back-btn'),
  saveBtn: document.getElementById('save-btn'),
  saveSideFront: document.querySelector('input[name="saveSide"][value="front"]'),
  saveSideBack: document.querySelector('input[name="saveSide"][value="back"]'),
  productNameInput: document.getElementById('item-name'),
  bgColorPicker: document.getElementById('bg-color'),
  clearCanvasBtn: document.getElementById('clear-canvas'),
  saveSideContainer: document.getElementById('save-side') // Added this element
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
  scale: 1.0, // Scale factor for the overlay image
  isArtMode: false,
  bgColor: '#ffffff' // Default background color for art mode
};


// Base Images
const baseImages = { front: new Image(), back: new Image() };
const imagesLoaded = { front: false, back: false };

// Initialize
document.addEventListener('DOMContentLoaded', initializeApp);

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

// Modify the initializeApp function to handle both modes
async function initializeApp() {
    try {
        // Check mode here instead
        const isArtMode = sessionStorage.getItem('creationMode') === 'art';
        
        // Get Firestore user ID from session storage
        const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                               sessionStorage.getItem('currentFirestoreUserId');
        
        console.log("Initializing canvas with Firestore User ID:", firestoreUserId);
        console.log("Current mode:", isArtMode ? "Art" : "Product");
        
        if (!firestoreUserId) {
            console.error("No Firestore user ID found in session storage");
            alert('User information not found. Please log in again.');
            window.location.href = 'profile.html';
            return;
        }
        
        console.log("User authenticated successfully with Firestore ID:", firestoreUserId);
        
        // Update UI based on mode
        updateUIForMode(isArtMode);
        
        if (isArtMode) {
            setupArtMode();
        } else {
            loadSessionData();
            renderVariantOptions();
            preloadBaseImages();
        }
        
        setupEventListeners(isArtMode);
        
        // Store isArtMode in state for other functions to access
        state.isArtMode = isArtMode;
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
}

// Add this function to update UI based on mode
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
    const saveSideContainer = document.getElementById('save-side'); // Added this element
    
    if (isArtMode) {
        // Art mode UI code
        if (sideSelector) sideSelector.style.display = 'none';
        if (viewButtons) viewButtons.style.display = 'none';
        if (variantSelection) variantSelection.style.display = 'none';
        if (saveSideContainer) saveSideContainer.style.display = 'none'; // Hide save side options
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
        
        // Set canvas to a larger size for art mode
        elements.canvas.width = 1000; // Higher resolution for art
        elements.canvas.height = 1000;
        
        // Initialize with default background color
        renderCanvas();
    } else {
        // Product mode UI code
        if (sideSelector) sideSelector.style.display = 'block';
        if (viewButtons) viewButtons.style.display = 'block';
        if (variantSelection) variantSelection.style.display = 'block';
        if (saveSideContainer) saveSideContainer.style.display = 'block'; // Show save side options
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
    }
}

// Add this function to setup art mode
function setupArtMode() {
    // Initialize with background color
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
}

// Modify the renderCanvas function to handle art mode
function renderCanvas() {
    if (state.isArtMode) {
        // For art mode, clear to background color (cosmetic only)
        ctx.fillStyle = state.bgColor;
        ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
        
        if (state.overlayImage) {
            drawOverlay();
        }
        return;
    }
    
    // Original product mode rendering code
    if (!state.selectedVariant || !imagesLoaded[state.side]) return;
    
    const { canvas } = elements;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear properly
    
    // Background
    ctx.fillStyle = state.selectedVariant.color_code || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Base image
    const baseImage = baseImages[state.side];
    if (baseImage.complete && baseImage.naturalWidth > 0) {
        ctx.drawImage(baseImage, 0, 0);
    }
    
    // Print area and overlay
    const printArea = getPrintArea();
    if (printArea) {
        drawPrintArea(printArea);
    }
    
    if (state.overlayImage) {
        drawOverlay(printArea);
        drawControls();
    }
}

// Modify the drawOverlay function to handle art mode
function drawOverlay(printArea) {
    ctx.save();
    
    if (printArea && !state.isArtMode) {
        ctx.beginPath();
        ctx.rect(printArea.x, printArea.y, printArea.width, printArea.height);
        ctx.clip();
    }
    
    ctx.drawImage(state.overlayImage, state.overlayX, state.overlayY, state.overlayW, state.overlayH);
    ctx.restore();
}

// Create a new function for saving art
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

        // Create a high-resolution temporary canvas
        const highResFactor = 2; // 2x resolution for higher quality
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = elements.canvas.width * highResFactor;
        tempCanvas.height = elements.canvas.height * highResFactor;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Scale up for higher resolution
        tempCtx.scale(highResFactor, highResFactor);
        
        // Clear to transparent
        tempCtx.clearRect(0, 0, tempCanvas.width / highResFactor, tempCanvas.height / highResFactor);
        
        // Draw only the overlay image at higher resolution
        if (state.overlayImage) {
            // Calculate scaled dimensions for high resolution
            const scaleX = tempCanvas.width / elements.canvas.width;
            const scaleY = tempCanvas.height / elements.canvas.height;
            
            tempCtx.drawImage(
                state.overlayImage, 
                state.overlayX * scaleX, 
                state.overlayY * scaleY, 
                state.overlayW * scaleX, 
                state.overlayH * scaleY
            );
        }
        
        // Convert to data URL with higher quality
        const artData = tempCanvas.toDataURL('image/png');
        
        // Generate filename
        const filename = `${firestoreUserId}-${artName.replace(/\s+/g, '-').toLowerCase()}`;
        
        // Save to Firebase
        const artId = await saveArtToFirebase(artData, filename, artName, firestoreUserId);
        
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

// Add this function to save art to Firebase
async function saveArtToFirebase(artData, filename, artName, userId) {
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
                userId: userId
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

function preloadBaseImages() {
  if (!state.product?.id) return;
  
  const handleLoad = (side) => {
    imagesLoaded[side] = true;
    if (state.side === side) {
      updateCanvasSize(side);
      renderCanvas();
    }
  };
  
  baseImages.front.onload = () => handleLoad('front');
  baseImages.back.onload = () => handleLoad('back');
  
  baseImages.front.src = `images/flatlays/${state.product.id}-base-front.png`;
  baseImages.back.src = `images/flatlays/${state.product.id}-base-back.png`;
}

function updateCanvasSize(imageSide) {
  const image = baseImages[imageSide];
  elements.canvas.width = image.width;
  elements.canvas.height = image.height;
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


function drawPrintArea(area) {
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

function drawControls() {
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
  if (state.isArtMode) {
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
  } else {
    // For product mode, use print area
    const printArea = getPrintArea();
    const centerX = printArea ? printArea.x + printArea.width / 2 : elements.canvas.width / 2;
    const centerY = printArea ? printArea.y + printArea.height / 2 : elements.canvas.height / 2;
    
    const maxWidth = printArea ? printArea.width * 0.8 : elements.canvas.width * 0.5;
    const maxHeight = printArea ? printArea.height * 0.8 : elements.canvas.height * 0.5;
    const scaleToFit = Math.min(maxWidth / state.overlayImage.width, maxHeight / state.overlayImage.height);
    
    state.overlayW = state.overlayImage.width * scaleToFit * state.scale;
    state.overlayH = state.overlayImage.height * scaleToFit * state.scale;
    state.overlayX = centerX - state.overlayW / 2;
    state.overlayY = centerY - state.overlayH / 2;
  }
}

function handleScaleChange(event) {
  if (!state.overlayImage) return;
  
  const scaleValue = parseInt(event.target.value) / 100;
  state.scale = scaleValue;
  
  // Update the scale value display
  document.getElementById('scale-value').textContent = `${event.target.value}%`;
  
  // Recalculate overlay dimensions based on scale
  if (state.isArtMode) {
    // For art mode, center on canvas
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
  } else {
    // For product mode, use print area
    const printArea = getPrintArea();
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
  }
  
  renderCanvas();
}

function handleSideSwitch(newSide) {
  if (state.side === newSide) return;
  
  state.side = newSide;
  elements.frontBtn.classList.toggle('active', newSide === 'front');
  elements.backBtn.classList.toggle('active', newSide === 'back');
  
  if (imagesLoaded[newSide]) {
    updateCanvasSize(newSide);
    renderCanvas();
  }
}

// Mouse handling with throttled rendering
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

function handleMouseDown(event) {
  if (!state.overlayImage) return;
  
  const mousePos = getMousePosition(event);
  if (isPointInOverlay(mousePos)) {
    state.isDragging = true;
    state.dragStartX = mousePos.x - state.overlayX;
    state.dragStartY = mousePos.y - state.overlayY;
    elements.canvas.style.cursor = 'grabbing';
  }
  event.preventDefault();
}

function handleMouseMove(event) {
  if (!state.overlayImage) return;
  
  const mousePos = getMousePosition(event);
  
  if (state.isDragging) {
    state.overlayX = mousePos.x - state.dragStartX;
    state.overlayY = mousePos.y - state.dragStartY;
    scheduleRender();
  } else {
    elements.canvas.style.cursor = isPointInOverlay(mousePos) ? 'grab' : 'default';
  }
}

function handleMouseUp() {
  state.isDragging = false;
  elements.canvas.style.cursor = 'default';
}

function isPointInOverlay(point) {
  return point.x >= state.overlayX && point.x <= state.overlayX + state.overlayW && 
         point.y >= state.overlayY && point.y <= state.overlayY + state.overlayH;
}

function getMousePosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function getPrintArea() {
  const area = PRINT_AREAS[state.product?.id]?.[state.side];
  return area ? {
    x: cmToPx(area.xCm),
    y: cmToPx(area.yCm),
    width: cmToPx(area.widthCm),
    height: cmToPx(area.heightCm)
  } : null;
}

// Get Firebase auth token
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

  // Get Firestore user ID from session storage
  const firestoreUserId = sessionStorage.getItem('designerFirestoreUserId') || 
                         sessionStorage.getItem('currentFirestoreUserId');
  
  // Log the user IDs
  console.log("Firestore User ID for product:", firestoreUserId);
  console.log("Product details:", {
    productId: state.product?.id,
    customName: customName,
    variants: state.variants.length,
    selectedSide: elements.saveSideFront.checked ? 'front' : 'back'
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

    const saveSide = elements.saveSideFront.checked ? 'front' : 'back';
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

    const printArea = getPrintArea();
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
      productTitle: customName // Use custom name as product title
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
      placement: requestBody.placement
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
  
  // Base image
  const baseImage = baseImages[saveSide];
  if (baseImage.complete) {
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
    if (!isArtMode) {
        elements.variantSelection.addEventListener('click', handleVariantSelection);
        elements.frontBtn.addEventListener('click', () => handleSideSwitch('front'));
        elements.backBtn.addEventListener('click', () => handleSideSwitch('back'));
    }
    
    document.getElementById('upload-btn').addEventListener('click', () => elements.uploadInput.click());
    elements.uploadInput.addEventListener('change', handleFileUpload);
    elements.canvas.addEventListener('mousedown', handleMouseDown);
    elements.canvas.addEventListener('mousemove', handleMouseMove);
    elements.canvas.addEventListener('mouseup', handleMouseUp);
    elements.canvas.addEventListener('mouseleave', handleMouseUp);
    elements.saveBtn.addEventListener('click', handleSaveProduct);
    elements.canvas.addEventListener('dragstart', e => e.preventDefault());
    
    // Add scale slider event listener
    document.getElementById('scale-slider').addEventListener('input', handleScaleChange);
    
    // Add art mode specific event listeners
    if (isArtMode) {
        elements.bgColorPicker.addEventListener('input', handleBgColorChange);
        elements.clearCanvasBtn.addEventListener('click', handleClearCanvas);
    }
}

function cmToPx(cm, dpi = DPI) {
  return Math.round((cm / 2.54) * dpi);
}