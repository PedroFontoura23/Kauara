// Replace with your Firebase Cloud Function URLs
const CLOUD_FUNCTION_URL = 'https://us-central1-kauara1.cloudfunctions.net/getProducts';
let currentProducts = [];
let isLoading = false;

// Create a data URL placeholder image
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;base64,' + btoa(`
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" fill="#f0f0f0"/>
  <text x="100" y="100" text-anchor="middle" dy=".3em" fill="#999" font-family="Arial, sans-serif" font-size="14">No Image</text>
</svg>
`);

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const productsEl = document.getElementById('products');
const statsEl = document.getElementById('stats');
const productCountEl = document.getElementById('product-count');

// Performance optimized rendering
function renderProducts(products) {
    if (!products || products.length === 0) {
        productsEl.innerHTML = '<div class="error">No products found</div>';
        return;
    }

    // Use DocumentFragment for efficient DOM manipulation
    const fragment = document.createDocumentFragment();
    
    products.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        productCard.innerHTML = createProductHTML(product);
        fragment.appendChild(productCard);
    });
    
    // Single DOM update
    productsEl.innerHTML = '';
    productsEl.appendChild(fragment);
}

// Optimized HTML generation
function createProductHTML(product) {
    return `
        <img src="${product.image || PLACEHOLDER_IMAGE}" 
             alt="${escapeHtml(product.title)}" 
             class="product-image"
             loading="lazy"
             onerror="this.src='${PLACEHOLDER_IMAGE}'">
        
        <div class="product-title">${escapeHtml(product.title)}</div>
        
        <div class="product-info">
            <span>ID: ${product.id}</span>
            <span>Type: ${escapeHtml(product.type_name)}</span>
            ${product.brand ? `<span>Brand: ${escapeHtml(product.brand)}</span>` : ''}
            ${product.model ? `<span>Model: ${escapeHtml(product.model)}</span>` : ''}
            <span>Variants: ${product.variant_count || 0}</span>
        </div>

        ${createVariantsHTML(product)}
        ${createMockupsHTML(product)}
    `;
}

function createVariantsHTML(product) {
    if (!product.variants || product.variants.length === 0) return '';
    
    const visibleVariants = product.variants.slice(0, 12);
    const remainingCount = Math.max(0, product.variants.length - 12);
    
    return `
        <div class="variants-section">
            <div class="section-title">Available Variants (${product.variants.length})</div>
            <div class="variants-grid">
                ${visibleVariants.map(variant => `
                    <div class="variant-item">
                        ${variant.color_code ? `<span class="color-dot" style="background-color: ${variant.color_code}"></span>` : ''}
                        <div>${escapeHtml(variant.color || 'N/A')}</div>
                        <div>${escapeHtml(variant.size || 'One Size')}</div>
                        <div class="availability-status">
                            ${escapeHtml(variant.availability_status || 'Unknown')}
                        </div>
                    </div>
                `).join('')}
                ${remainingCount > 0 ? `<div class="variant-item more-variants">+${remainingCount} more</div>` : ''}
            </div>
        </div>
    `;
}

function createMockupsHTML(product) {
    if (!product.mockups || product.mockups.length === 0) return '';
    
    return `
        <div class="mockups-section">
            <div class="section-title">Mockup Images (${product.mockups.length})</div>
            <div class="mockups-grid">
                ${product.mockups.map(mockupUrl => `
                    <img src="${mockupUrl}" 
                         alt="Product mockup" 
                         class="mockup-image"
                         loading="lazy"
                         onerror="this.src='${PLACEHOLDER_IMAGE}'">
                `).join('')}
            </div>
        </div>
    `;
}

// Utility function for HTML escaping
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show/hide elements
function showLoading() {
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    productsEl.innerHTML = '';
    statsEl.style.display = 'none';
}

function hideLoading() {
    loadingEl.style.display = 'none';
}

function showError(message) {
    errorEl.innerHTML = `<h3>Error</h3><p>${message}</p>`;
    errorEl.style.display = 'block';
    hideLoading();
}

function showStats(count, cached = false) {
    productCountEl.innerHTML = `${count} ${cached ? '<span style="color: #27ae60;">(cached)</span>' : ''}`;
    statsEl.style.display = 'block';
}

// Optimized product loading with retry logic
async function loadProducts(retryCount = 0) {
    if (isLoading) return;
    
    isLoading = true;
    showLoading();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(CLOUD_FUNCTION_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Failed to fetch products');
        }

        currentProducts = data.products || [];
        renderProducts(currentProducts);
        showStats(currentProducts.length, data.cached);
        
        console.log(`Loaded ${currentProducts.length} products successfully`);
        
    } catch (error) {
        console.error('Error loading products:', error);
        
        // Retry logic for transient failures
        if (retryCount < 2 && (error.name === 'AbortError' || error.message.includes('network'))) {
            console.log(`Retrying... (${retryCount + 1}/3)`);
            setTimeout(() => loadProducts(retryCount + 1), 2000);
            return;
        }
        
        showError(`Failed to load products: ${error.message}`);
    } finally {
        isLoading = false;
        hideLoading();
    }
}

function setupProductSelection() {
    // Create modal elements
    const modal = document.createElement('div');
    modal.id = 'variant-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h3>Select Variant</h3>
            <div id="variant-selection" class="variant-selection-grid"></div>
            <button id="confirm-variant" class="confirm-button">Continue to Canvas</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Style the modal (add to your CSS)
    const style = document.createElement('style');
    style.textContent = `
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.7);
        }
        
        .modal-content {
            background-color: #fff;
            margin: 10% auto;
            padding: 20px;
            border-radius: 12px;
            width: 80%;
            max-width: 600px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        }
        
        .close-modal {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        
        .close-modal:hover {
            color: #333;
        }
        
        .variant-selection-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 10px;
            margin: 20px 0;
            max-height: 400px;
            overflow-y: auto;
        }
        
        .variant-option {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .variant-option:hover {
            background-color: #f0f0f0;
        }
        
        .variant-option.selected {
            background-color: #e3f2fd;
            border-color: #2196F3;
        }
        
        .confirm-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            width: 100%;
            margin-top: 20px;
        }
        
        .confirm-button:disabled {
            background: #cccccc;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);
    
    // Modal functionality
    const modalEl = document.getElementById('variant-modal');
    const closeBtn = modalEl.querySelector('.close-modal');
    const confirmBtn = document.getElementById('confirm-variant');
    let selectedProduct = null;
    let selectedVariant = null;
    
    // Close modal when clicking X or outside
    closeBtn.addEventListener('click', () => modalEl.style.display = 'none');
    window.addEventListener('click', (e) => {
        if (e.target === modalEl) modalEl.style.display = 'none';
    });
    
    // Handle variant selection
    document.addEventListener('click', (e) => {
        const variantOption = e.target.closest('.variant-option');
        if (variantOption) {
            document.querySelectorAll('.variant-option').forEach(el => 
                el.classList.remove('selected'));
            variantOption.classList.add('selected');
            selectedVariant = JSON.parse(variantOption.dataset.variant);
            confirmBtn.disabled = false;
        }
    });
    
    // Handle confirm button click
    confirmBtn.addEventListener('click', () => {
        if (selectedProduct && selectedVariant) {
            // Store selection in sessionStorage
            sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
            sessionStorage.setItem('selectedVariant', JSON.stringify(selectedVariant));
            
            // Redirect to canvas page
            window.location.href = 'canvas.html';
        }
    });
    
    // Expose function to show modal
    window.showVariantModal = (product) => {
        selectedProduct = product;
        selectedVariant = null;
        confirmBtn.disabled = true;
        
        const selectionGrid = document.getElementById('variant-selection');
        selectionGrid.innerHTML = '';
        
        if (product.variants && product.variants.length > 0) {
            product.variants.forEach(variant => {
                const option = document.createElement('div');
                option.className = 'variant-option';
                option.dataset.variant = JSON.stringify(variant);
                option.innerHTML = `
                    ${variant.color_code ? `<span class="color-dot" style="background-color: ${variant.color_code}"></span>` : ''}
                    <div><strong>${escapeHtml(variant.color || 'N/A')}</strong></div>
                    <div>${escapeHtml(variant.size || 'One Size')}</div>
                    <div class="availability-status">
                        ${escapeHtml(variant.availability_status || 'Unknown')}
                    </div>
                `;
                selectionGrid.appendChild(option);
            });
        } else {
            selectionGrid.innerHTML = '<div class="no-variants">No variants available for this product</div>';
        }
        
        modalEl.style.display = 'block';
    };
}

function addProductClickHandlers() {
    document.addEventListener('click', (e) => {
        const productCard = e.target.closest('.product-card');
        if (productCard) {
            const productId = parseInt(productCard.querySelector('.product-info span').textContent.replace('ID: ', ''));
            const product = currentProducts.find(p => p.id === productId);
            if (product) {
                showVariantModal(product);
            }
        }
    });
}

// Initialize these when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setupProductSelection();
    addProductClickHandlers();
});

// Preload products immediately when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, starting product load...');
    loadProducts();
});

// Preload on script load if DOM is already ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadProducts);
} else {
    loadProducts();
}

// Expose functions to global scope
window.loadProducts = loadProducts;