// pagamentos.js - Checkout Pro Payment System
console.log('💰 pagamentos.js - Production ready checkout system v2.2');

let productData = null;
let currentPayment = null;
const FUNCTIONS_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';

// 1. Load product and initialize page
window.onload = async function() {
    console.log('🛒 Loading checkout page...');
    
    try {
        // Get product from session storage
        const productString = sessionStorage.getItem('selectedProduct');
        if (!productString) {
            throw new Error('No product found. Please return to the store and select a product.');
        }
        
        productData = JSON.parse(productString);
        console.log('✅ Product loaded:', {
            title: productData.productTitle,
            pricing: productData.pricing,
            designer: productData.designerName,
            variant: productData.selectedVariant
        });
        
        // Display product info with new pricing structure
        displayProductInfo();
        
        // Setup checkout form
        setupCheckoutForm();
        
        // Update UI for Checkout Pro
        updateUIForCheckoutPro();
        
        console.log('✅ Checkout Pro page loaded successfully');
        
    } catch (error) {
        console.error('❌ Error:', error);
        showError(`Error loading checkout: ${error.message}`);
    }
};

// 2. Display product information with new pricing
function displayProductInfo() {
    // Product title
    const productTitle = document.getElementById('productTitle');
    if (productTitle) {
        productTitle.textContent = productData.productTitle || 'Product';
    }
    
    // Product image with color background
    const productImageContainer = document.getElementById('productImageContainer');
    const productImage = document.getElementById('productImage');
    
    if (productImageContainer && productImage) {
        const imageUrl = productData.thumbnailUrl || 
                        productData.thumbnail || 
                        productData.imageUrl || 
                        productData.image;
        
        // Add color background if variant has color
        if (productData.selectedVariant?.color_code || productData.selectedVariant?.colorCode) {
            const colorCode = productData.selectedVariant.color_code || productData.selectedVariant.colorCode;
            const colorLayer = document.createElement('div');
            colorLayer.className = 'color-layer';
            colorLayer.style.backgroundColor = colorCode;
            colorLayer.style.opacity = '1';
            productImageContainer.appendChild(colorLayer);
        }
        
        if (imageUrl) {
            productImage.src = imageUrl;
            productImage.alt = productData.productTitle || 'Product';
            productImage.style.display = 'block';
        }
    }
    
    // Variant info
    const variantInfo = document.getElementById('variantInfo');
    if (variantInfo && productData.selectedVariant) {
        const variant = productData.selectedVariant;
        variantInfo.innerHTML = `
            <div class="mb-1">
                ${variant.color ? `<span class="badge bg-secondary me-1">${variant.color}</span>` : ''}
                ${variant.size ? `<span class="badge bg-info me-1">${variant.size}</span>` : ''}
            </div>
        `;
    }
    
    // Display artist info
    const artistInfo = document.getElementById('artistName');
    if (artistInfo && productData.designerName) {
        artistInfo.textContent = productData.designerName;
    }
    
    // Update pricing display with new structure
    updatePricingDisplay();
    
    // Show split information if available
    displaySplitInfo();
}

// 3. Update pricing display with new structure
function updatePricingDisplay() {
    const priceElement = document.getElementById('productPrice');
    const artistMarkupElement = document.getElementById('artistMarkup');
    const platformFeeElement = document.getElementById('platformFee');
    const totalElement = document.getElementById('totalPrice');
    
    // Try to get pricing from new structure first
    let pricingData = productData.pricing;
    
    // If no pricing in productData, check selectedVariant
    if (!pricingData && productData.selectedVariant?.pricing) {
        pricingData = productData.selectedVariant.pricing;
    }
    
    // Fallback: calculate from variant price
    if (!pricingData) {
        const price = parseFloat(productData.selectedVariant?.price || productData.selectedVariant?.retail_price || 0);
        console.log('erro: não foi possível processar o preço do produto')
    }
    
    // Ensure all values are numbers
    const productPrice = parseFloat(pricingData.product_price || 0);
    const artistCut = parseFloat(pricingData.artist_cut || 0);
    const platformFee = parseFloat(pricingData.platform_fee || 0);
    const totalPrice = parseFloat(pricingData.total_price || productPrice + artistCut + platformFee);
    
    console.log('💰 Pricing breakdown:', { productPrice, artistCut, platformFee, totalPrice });
    
    if (priceElement) {
        priceElement.textContent = formatCurrency(productPrice);
    }
    
    if (artistMarkupElement) {
        artistMarkupElement.textContent = formatCurrency(artistCut);
    }
    
    if (platformFeeElement) {
        platformFeeElement.textContent = formatCurrency(platformFee);
    }
    
    if (totalElement) {
        totalElement.textContent = formatCurrency(totalPrice);
    }
}

// 4. Display split payment information
function displaySplitInfo() {
    const splitInfo = document.getElementById('splitInfo');
    const artistSplitAmount = document.getElementById('artistSplitAmount');
    const platformSplitAmount = document.getElementById('platformSplitAmount');
    
    if (!splitInfo || !artistSplitAmount || !platformSplitAmount) return;
    
    // Get pricing data
    let pricingData = productData.pricing || productData.selectedVariant?.pricing;
    
    if (pricingData) {
        const artistCut = parseFloat(pricingData.artist_cut || 0);
        const platformFee = parseFloat(pricingData.platform_fee || 0);
        
        artistSplitAmount.textContent = formatCurrency(artistCut);
        platformSplitAmount.textContent = formatCurrency(platformFee);
        
        // Only show split info if there's an artist cut
        if (artistCut > 0) {
            splitInfo.classList.remove('split-info-hidden');
        }
    }
}

// 5. Setup checkout form for Checkout Pro
function setupCheckoutForm() {
    const form = document.getElementById('checkoutForm');
    if (!form) return;
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await processCheckoutPro();
    });
    
    // Setup back button with JavaScript instead of inline onclick
    const backButton = document.getElementById('backButton');
    if (backButton) {
        backButton.addEventListener('click', function() {
            window.history.back();
        });
    }
    
    // Setup real-time validation
    setupRealTimeValidation();
    
    // Auto-format CPF
    const cpfInput = document.getElementById('cpf');
    if (cpfInput) {
        cpfInput.addEventListener('input', formatCPF);
    }
}

// 6. Process Checkout Pro payment with updated data - FIXED PRICING
async function processCheckoutPro() {
    console.log('💳 Processing Checkout Pro payment...');
    
    try {
        // 1. Get buyer info
        const buyerInfo = getBuyerInfo();
        
        // 2. Validate form
        if (!validateForm()) {
            alert('Por favor, preencha todos os campos obrigatórios corretamente.');
            return;
        }
        
        // 3. Validate terms
        const termsCheck = document.getElementById('termsCheck');
        if (!termsCheck || !termsCheck.checked) {
            alert('Você precisa aceitar os Termos de Serviço para continuar.');
            return;
        }
        
        // 4. Show loading
        showLoading(true);
        
        // 5. Prepare payment data - FIX: Use total_price directly
        const pricingData = productData.pricing || productData.selectedVariant?.pricing;
        
        // Get the total price from pricing breakdown
        const totalPrice = parseFloat(pricingData?.total_price || 
                                    productData.selectedVariant?.price || 
                                    productData.selectedVariant?.retail_price || 0);
        
        console.log('💰 Total price to charge:', totalPrice);
        
        // CRITICAL: Always provide a valid image URL for Mercado Pago
        const productImageUrl = productData.thumbnailUrl || 
                               productData.thumbnail || 
                               productData.imageUrl || 
                               productData.image || 
                               'https://http2.mlstatic.com/frontend-assets/ui-nav/5.19.1/mercadolibre/180x180.png';
        
        const paymentRequest = {
            title: productData.productTitle || 'Product Purchase',
            description: `${productData.productTitle || 'Product'} by ${productData.designerName || 'Designer'}`,
            quantity: 1,
            unit_price: totalPrice, // FIX: Use total_price directly
            picture_url: productImageUrl, // Required by Mercado Pago
            email: buyerInfo.email,
            payer_name: buyerInfo.name,
            phone: buyerInfo.phone.replace(/\D/g, ''), // Remove formatting
            cpf: buyerInfo.cpf?.replace(/\D/g, '') || '', // Add CPF
            product_id: productData.id || 'custom_product',
            external_reference: generateOrderId(),
            
            // Add pricing breakdown for backend
            pricing_breakdown: pricingData || {
                product_price: parseFloat(pricingData?.product_price || totalPrice * 0.7),
                artist_cut: parseFloat(pricingData?.artist_cut || totalPrice * 0.25),
                platform_fee: parseFloat(pricingData?.platform_fee || totalPrice * 0.05),
                total_price: totalPrice
            },
            
            // Designer info for split payments
            designer_info: {
                user_id: productData.designerUserId,
                name: productData.designerName,
                email: productData.designerEmail,
                pix_key: productData.pix_key,
                pix_key_type: productData.pix_keyType
            },
            
            return_url: `${window.location.origin}/success.html`,
            cancel_url: window.location.href
        };
        
        // Add shipping address if available
        if (buyerInfo.street && buyerInfo.city && buyerInfo.state && buyerInfo.zipCode) {
            paymentRequest.shipping_address = {
                zip_code: buyerInfo.zipCode.replace(/\D/g, ''),
                street_name: buyerInfo.street,
                street_number: buyerInfo.number || 'S/N',
                city_name: buyerInfo.city,
                state_name: buyerInfo.state
            };
        }
        
        console.log('📤 Sending to server:', JSON.stringify(paymentRequest, null, 2));
        
        // 6. Create Checkout Pro payment
        const response = await fetch(
          `${FUNCTIONS_BASE_URL}/createCheckoutProPayment`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(paymentRequest)
          }
        );
        
        const responseData = await response.json();
        
        if (!response.ok) {
            console.error('❌ Server response error:', responseData);
            throw new Error(responseData.error || responseData.details?.join(', ') || `Server error: ${response.status}`);
        }
        
        if (!responseData.success) {
            throw new Error(responseData.error || 'Failed to create payment');
        }
        
        console.log('✅ Checkout Pro payment created:', responseData);
        
        // 7. Store payment info
        currentPayment = responseData;
        
        // 8. Show payment options or redirect
        showPaymentOptions(responseData);
        
    } catch (error) {
        console.error('❌ Checkout Pro error:', error);
        showError(`Payment setup failed: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// 7. Show payment options (simplified)
function showPaymentOptions(paymentData) {
    // Get the EXACT total from the displayed resumo do pedido
    const totalElement = document.getElementById('totalPrice');
    const displayedTotal = totalElement ? totalElement.textContent.replace('R$ ', '').replace(',', '.') : '0';
    const totalPrice = parseFloat(displayedTotal);
    
    const paymentOptionsHtml = `
        <div class="modal fade" id="paymentOptionsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="fas fa-credit-card me-2"></i> Complete Your Payment</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="text-center mb-4">
                            <i class="fas fa-shopping-bag fa-4x text-primary mb-3"></i>
                            <h3>Almost there!</h3>
                            <p class="lead">You'll be redirected to Mercado Pago to complete your payment</p>
                        </div>
                        
                        <div class="payment-summary card mb-4">
                            <div class="card-body">
                                <h6 class="card-title">Order Summary</h6>
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Product:</span>
                                    <span>${productData.productTitle}</span>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Artist:</span>
                                    <span>${productData.designerName || 'Designer'}</span>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Price:</span>
                                    <span class="fw-bold">${formatCurrency(totalPrice)}</span>
                                </div>
                                <hr>
                                <p class="small text-muted mb-0">
                                    <i class="fas fa-info-circle me-1"></i>
                                    Order reference: ${paymentData.external_reference || 'N/A'}
                                </p>
                            </div>
                        </div>
                        
                        <div class="alert alert-success">
                            <div class="d-flex align-items-center">
                                <i class="fas fa-shield-alt fa-2x me-3"></i>
                                <div>
                                    <h6 class="mb-1">Secure Payment</h6>
                                    <p class="mb-0">Your payment is processed securely by Mercado Pago</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="redirectToCheckoutBtn" class="btn btn-primary">
                            <i class="fas fa-lock me-2"></i> Continue to Secure Payment
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('paymentOptionsModal');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', paymentOptionsHtml);
    const modal = new bootstrap.Modal(document.getElementById('paymentOptionsModal'));
    
    // Add event listener to redirect button
    document.getElementById('redirectToCheckoutBtn').addEventListener('click', redirectToCheckout);
    
    modal.show();
}

// 8. Redirect to Mercado Pago Checkout
function redirectToCheckout() {
    if (!currentPayment) {
        showError('Payment information not available');
        return;
    }
    
    // Use production URL if available, otherwise sandbox
    const checkoutUrl = currentPayment.init_point || currentPayment.sandbox_init_point;
    
    if (!checkoutUrl) {
        showError('Checkout URL not available');
        return;
    }
    
    console.log('🌐 Redirecting to Mercado Pago:', checkoutUrl);
    
    // Store payment info in session for when user returns
    sessionStorage.setItem('lastPayment', JSON.stringify({
        external_reference: currentPayment.external_reference,
        amount: currentPayment.amount,
        product_title: productData.productTitle,
        designer_name: productData.designerName,
        timestamp: new Date().toISOString()
    }));
    
    // Redirect to Mercado Pago Checkout
    window.location.href = checkoutUrl;
}

// 9. Helper functions
function getBuyerInfo() {
    return {
        name: document.getElementById('fullName')?.value || '',
        cpf: document.getElementById('cpf')?.value || '',
        email: document.getElementById('email')?.value || '',
        phone: document.getElementById('phone')?.value || '',
        zipCode: document.getElementById('zipCode')?.value || '',
        street: document.getElementById('street')?.value || '',
        number: document.getElementById('number')?.value || '',
        complement: document.getElementById('complement')?.value || '',
        neighborhood: document.getElementById('neighborhood')?.value || '',
        city: document.getElementById('city')?.value || '',
        state: document.getElementById('state')?.value || ''
    };
}

function formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return 'R$ ' + num.toFixed(2).replace('.', ',');
}

function formatCPF(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    
    if (value.length <= 11) {
        if (value.length > 3) {
            value = value.substring(0, 3) + '.' + value.substring(3);
        }
        if (value.length > 7) {
            value = value.substring(0, 7) + '.' + value.substring(7);
        }
        if (value.length > 11) {
            value = value.substring(0, 11) + '-' + value.substring(11);
        }
    }
    
    e.target.value = value;
    validateField('cpf', value);
}

function generateOrderId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `KAUARA-${timestamp}-${random}`.toUpperCase();
}

function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        if (show) {
            loadingOverlay.classList.remove('d-none');
            loadingOverlay.classList.add('d-flex');
        } else {
            loadingOverlay.classList.remove('d-flex');
            loadingOverlay.classList.add('d-none');
        }
    }
}

function showError(message) {
    document.querySelectorAll('.alert-danger').forEach(alert => alert.remove());
    
    const errorHtml = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            <strong>Erro:</strong> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    const container = document.querySelector('.container');
    if (container) {
        container.insertAdjacentHTML('afterbegin', errorHtml);
    } else {
        alert(message);
    }
}

// 10. Update UI for Checkout Pro (simplified)
function updateUIForCheckoutPro() {
    // Update page title
    document.title = 'Finalizar Compra - ' + (productData.productTitle || 'Produto');
    
    // Update form title
    const formTitle = document.querySelector('h1');
    if (formTitle) {
        formTitle.innerHTML = '<i class="fas fa-shopping-cart text-primary me-2"></i> Finalizar Compra';
    }
    
    // Update button text
    const submitButton = document.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.innerHTML = '<i class="fas fa-lock me-2"></i> Finalizar Compra e Pagar';
    }
    
    console.log('✅ UI updated for Checkout Pro');
}

// 11. Form validation functions
function formatPhone(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    
    if (value.length <= 11) {
        if (value.length > 2) {
            value = `(${value.substring(0, 2)}) ${value.substring(2)}`;
        }
        if (value.length > 10) {
            value = value.substring(0, 10) + '-' + value.substring(10);
        }
    }
    
    e.target.value = value;
    validateField('phone', value);
}

function formatZipCode(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 8) value = value.substring(0, 8);
    
    if (value.length > 5) {
        value = value.substring(0, 5) + '-' + value.substring(5);
    }
    
    e.target.value = value;
    validateField('zipCode', value);
}

async function fetchAddressFromCEP(e) {
    const cep = e.target.value.replace(/\D/g, '');
    if (cep.length !== 8) return;
    
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        
        if (!response.ok) {
            throw new Error(`CEP API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.erro) {
            document.getElementById('street').value = data.logradouro || '';
            document.getElementById('neighborhood').value = data.bairro || '';
            document.getElementById('city').value = data.localidade || '';
            document.getElementById('state').value = data.uf || '';
            
            ['street', 'neighborhood', 'city', 'state'].forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.dispatchEvent(new Event('change'));
                }
            });
        }
    } catch (error) {
        console.error('Error fetching CEP:', error.message);
    }
}

function setupRealTimeValidation() {
    const requiredFields = ['fullName', 'cpf', 'email', 'phone'];
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('change', function() {
                validateField(fieldId, this.value);
            });
            field.addEventListener('input', function() {
                if (fieldId === 'cpf') formatCPF({ target: this });
                if (fieldId === 'phone') formatPhone({ target: this });
                if (fieldId === 'zipCode') formatZipCode({ target: this });
                validateField(fieldId, this.value);
            });
        }
    });
    
    // CEP auto-fill
    const zipCodeInput = document.getElementById('zipCode');
    if (zipCodeInput) {
        zipCodeInput.addEventListener('blur', async function(e) {
            await fetchAddressFromCEP(e);
        });
    }
}

function validateField(fieldId, value, isRequired = true) {
    const errorElement = document.getElementById(fieldId + 'Error');
    if (!errorElement) return true;
    
    let isValid = true;
    let errorMessage = '';
    
    if (isRequired && !value.trim()) {
        errorElement.textContent = 'Este campo é obrigatório';
        errorElement.style.display = 'block';
        
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.add('is-invalid');
            field.classList.remove('is-valid');
        }
        return false;
    }
    
    if (!isRequired && !value.trim()) {
        errorElement.textContent = '';
        errorElement.style.display = 'none';
        
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.remove('is-invalid', 'is-valid');
        }
        return true;
    }
    
    switch(fieldId) {
        case 'fullName':
            isValid = value.trim().length >= 2;
            errorMessage = isValid ? '' : 'Nome deve ter pelo menos 2 caracteres';
            break;
        case 'cpf':
            const cpfDigits = value.replace(/\D/g, '');
            isValid = cpfDigits.length === 11;
            errorMessage = isValid ? '' : 'CPF inválido (11 dígitos)';
            break;
        case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            isValid = emailRegex.test(value);
            errorMessage = isValid ? '' : 'Email inválido (exemplo: nome@email.com)';
            break;
        case 'phone':
            const phoneDigits = value.replace(/\D/g, '');
            isValid = phoneDigits.length >= 10 && phoneDigits.length <= 11;
            errorMessage = isValid ? '' : 'Telefone inválido (10 ou 11 dígitos)';
            break;
        case 'zipCode':
            const zipDigits = value.replace(/\D/g, '');
            isValid = zipDigits.length === 8 || value.trim() === '';
            errorMessage = isValid ? '' : 'CEP inválido (8 dígitos)';
            break;
        default:
            isValid = true;
    }
    
    const field = document.getElementById(fieldId);
    if (field) {
        field.classList.toggle('is-invalid', !isValid);
        field.classList.toggle('is-valid', isValid && value.trim() !== '');
    }
    
    errorElement.textContent = errorMessage;
    errorElement.style.display = errorMessage ? 'block' : 'none';
    
    return isValid;
}

function validateForm() {
    const requiredFields = ['fullName', 'cpf', 'email', 'phone'];
    
    let allValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            const isValid = validateField(fieldId, field.value, true);
            if (!isValid) {
                allValid = false;
                if (allValid === false) {
                    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    field.focus();
                }
            }
        }
    });
    
    return allValid;
}

console.log('✅ Production checkout system loaded');