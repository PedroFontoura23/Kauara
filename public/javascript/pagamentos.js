// pagamentos.js - Checkout Pro Payment System for Multiple Products
console.log('💰 pagamentos.js - Production ready checkout system v2.5 (Multi-Product Simplified)');

let cartProducts = [];
let currentPayment = null;
let selectedShipping = {
  cost: 0,
  formatted: 'R$ 0,00'
};
const FUNCTIONS_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';

// 1. Load products and initialize page
window.onload = async function() {
    console.log('🛒 Loading checkout page for multiple products...');
    
    try {
        // Try to get cart from session storage
        const cartString = sessionStorage.getItem('cartToPay');
        
        if (!cartString) {
            // Fallback to single product for backward compatibility
            const productString = sessionStorage.getItem('selectedProduct');
            if (!productString) {
                throw new Error('No products found. Please return to the store and add products to cart.');
            }
            
            const productData = JSON.parse(productString);
            if (productData.type === 'multi_product_cart') {
                cartProducts = productData.products || [];
            } else {
                cartProducts = [productData];
            }
        } else {
            cartProducts = JSON.parse(cartString);
        }
        
        if (cartProducts.length === 0) {
            throw new Error('No products found in cart.');
        }
        
        console.log('✅ Products loaded:', {
            count: cartProducts.length,
            products: cartProducts.map(p => p.productTitle)
        });
        
        displayProductsInfo();
        setupCheckoutForm();
        setupShippingTrigger();
        updateUIForCheckoutPro();
        
        console.log('✅ Checkout Pro page loaded successfully for', cartProducts.length, 'products');
        
        // 🚚 NEW: Calculate shipping immediately after page loads
        console.log('🚚 Auto-calculating shipping on page load...');
        try {
            await calculateCartShipping();
            console.log('✅ Shipping auto-calculated successfully');
        } catch (shippingError) {
            console.warn('⚠️ Could not auto-calculate shipping on load:', shippingError.message);
            // Don't show error to user - just log it
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        showError(`Erro ao carregar checkout: ${error.message}`);
    }
};

// 2. Display multiple products information
function displayProductsInfo() {
    const productsContainer = document.getElementById('productsContainer');
    if (!productsContainer) { console.error('❌ productsContainer not found'); return; }
    productsContainer.innerHTML = '';

    // Accumulate the three components separately so the breakdown is accurate
    let baseCostTotal    = 0; // product_price (Printful cost)
    let artistCutTotal   = 0; // artist markup
    let platformFeeTotal = 0; // 5% platform fee
    let itemsTotal       = 0; // what the customer pays per item = sum of above three

    cartProducts.forEach(function(product) {
        var baseCost    = 0;
        var artistCut   = 0;
        var platformFee = 0;
        var itemTotal   = 0;

        if (product.pricing && product.pricing.total_price) {
            // FIX: use exact stored values — never fall back to percentage guesses
            baseCost    = parseFloat(product.pricing.product_price) || 0;
            artistCut   = parseFloat(product.pricing.artist_cut)    || 0;  // 0 is valid!
            platformFee = parseFloat(product.pricing.platform_fee)  || 0;
            itemTotal   = parseFloat(product.pricing.total_price)   || 0;

            // Sanity check — warn if stored total drifts from components
            var recalc = Math.round((baseCost + artistCut + platformFee) * 100) / 100;
            if (Math.abs(itemTotal - recalc) > 0.05) {
                console.warn('⚠️ total_price drift for ' + product.productTitle + ':', itemTotal, '≠', recalc);
                itemTotal = recalc;
            }
        } else if (product.selectedVariant && product.selectedVariant.price) {
            itemTotal = parseFloat(product.selectedVariant.price) || 0;
            baseCost  = itemTotal; // no breakdown available
        }

        baseCostTotal    += baseCost;
        artistCutTotal   += artistCut;
        platformFeeTotal += platformFee;
        itemsTotal       += itemTotal;

        var img     = product.thumbnailUrl || product.thumbnail || product.imageUrl || product.image || '../public/images/default-product.png';
        var color   = (product.selectedVariant && product.selectedVariant.color) ? product.selectedVariant.color : null;
        var size    = (product.selectedVariant && product.selectedVariant.size)  ? product.selectedVariant.size  : null;
        var designer = product.designerName || product.designerUserId || 'Designer';

        productsContainer.innerHTML +=
            '<div class="product-item">' +
                '<img src="' + img + '" alt="' + (product.productTitle || 'Produto') + '" ' +
                     'onerror="this.src=\'../public/images/default-product.png\'">' +
                '<div class="pi-info">' +
                    '<div class="pi-title" title="' + (product.productTitle || 'Produto') + '">' + (product.productTitle || 'Produto') + '</div>' +
                    '<div class="pi-meta">' +
                        '<span class="pi-designer">' + designer + '</span>' +
                        (color ? '<span class="pi-tag">' + color + '</span>' : '') +
                        (size  ? '<span class="pi-tag">' + size  + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="pi-price">' + formatCurrency(itemTotal) + '</div>' +
            '</div>';
    });

    // Update cart count badge
    var badge = document.getElementById('cartCountBadge');
    if (badge) badge.textContent = cartProducts.length + ' item' + (cartProducts.length !== 1 ? 's' : '');

    // Update the price breakdown panel
    updatePricingDisplay(baseCostTotal, artistCutTotal, platformFeeTotal, itemsTotal);
}

// 3. Update the price breakdown panel (RIGHT values in the summary card)
function updatePricingDisplay(baseCost, artistCut, platformFee, itemsTotal) {
    var set  = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    var show = function(id, vis) { var el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };

    // Base product cost (always shown)
    set('productPrice', formatCurrency(baseCost));

    // Artist cut — show only if > 0 (0 is a real valid value, not missing data)
    if (artistCut > 0) {
        set('artistMarkup', formatCurrency(artistCut));
        show('artistCutRow', true);
    } else {
        show('artistCutRow', false);
    }

    // Platform fee — show only if > 0
    if (platformFee > 0) {
        set('platformFee', formatCurrency(platformFee));
        show('platformFeeRow', true);
    } else {
        show('platformFeeRow', false);
    }

    // Subtotal = items total (no shipping yet)
    set('subtotalPrice', formatCurrency(itemsTotal));

    // Grand total starts as items total; shipping will be added by updateShippingUI
    set('totalPrice', formatCurrency(itemsTotal));

    console.log('💰 Breakdown — base:', baseCost, '| artist_cut:', artistCut, '| platform_fee:', platformFee, '| items_total:', itemsTotal);
}

// 4. Setup checkout form for Checkout Pro
function setupCheckoutForm() {
    const form = document.getElementById('checkoutForm');
    if (!form) {
        console.error('❌ Checkout form not found');
        return;
    }
    
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
    
    // Auto-format phone
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', formatPhone);
    }
    
    // Auto-format zip code
    const zipCodeInput = document.getElementById('zipCode');
    if (zipCodeInput) {
        zipCodeInput.addEventListener('input', formatZipCode);
    }
}

// 5. Process Checkout Pro payment for multiple products - UPDATED with correct return URLs
async function processCheckoutPro() {
    console.log('💳 Processing Checkout Pro payment for', cartProducts.length, 'products...');
    
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
        
        // 5. Calculate total price from all products
        let totalPrice = 0;
        let pricingBreakdowns = [];
        
        cartProducts.forEach(product => {
            let productPrice = 0;
            let productPricingData = null;
            
            if (product.pricing && product.pricing.total_price) {
                productPrice = parseFloat(product.pricing.total_price || 0);
                productPricingData = product.pricing;
            } else if (product.selectedVariant && product.selectedVariant.price) {
                productPrice = parseFloat(product.selectedVariant.price);
                productPricingData = {
                    product_price: productPrice * 0.7,
                    artist_cut: productPrice * 0.25,
                    platform_fee: productPrice * 0.05,
                    total_price: productPrice
                };
            } else {
                // Fallback if no price found
                productPrice = 0;
                productPricingData = {
                    product_price: 0,
                    artist_cut: 0,
                    platform_fee: 0,
                    total_price: 0
                };
            }
            
            totalPrice += productPrice;
            pricingBreakdowns.push({
                product_id: product.id || product.productId || `product_${Date.now()}`,
                title: product.productTitle || 'Product',
                pricing: productPricingData
            });
        });
        
        // Add shipping cost to total price
        const shippingCost = selectedShipping.cost || 0;
        const totalWithShipping = totalPrice + shippingCost;
        
        console.log('💰 Price breakdown:', {
            productsTotal: totalPrice,
            shippingCost: shippingCost,
            totalWithShipping: totalWithShipping
        });
        
        // Ensure minimum price (Mercado Pago requires at least 0.5)
        if (totalWithShipping < 0.5) {
            showLoading(false);
            showError('Valor mínimo da compra é R$ 0,50');
            return;
        }
        
        console.log('💰 Total price to charge (with shipping):', totalWithShipping, 'from', cartProducts.length, 'products');
        
        // Use first product for main image and description
        const firstProduct = cartProducts[0];
        
        // CRITICAL: Mercado Pago requires a valid HTTPS image URL
        const productImageUrl = firstProduct.thumbnailUrl || 
                               firstProduct.thumbnail || 
                               firstProduct.imageUrl || 
                               firstProduct.image || 
                               'https://http2.mlstatic.com/frontend-assets/ui-nav/5.19.1/mercadolibre/180x180.png';
        
        // Create a description that includes all products
        const productTitles = cartProducts.map(p => p.productTitle || 'Produto').join(', ');
        const description = cartProducts.length === 1 
            ? `${firstProduct.productTitle || 'Product'} by ${firstProduct.designerName || 'Designer'}`
            : `${cartProducts.length} produtos: ${productTitles.substring(0, 100)}${productTitles.length > 100 ? '...' : ''}`;
        
        // Ensure we have required designer information
        const cart_products = cartProducts.map(product => {
            // Validate each product has required fields
            const productData = {
                product_id: product.firestoreProductId || product.id || product.productId || `product_${Date.now()}`,
                title: product.productTitle || 'Product',
                designer_id: product.designerUserId || 'unknown_designer',
                designer_name: product.designerName || 'Designer',
                designer_email: product.designerEmail || 'designer@example.com',
                variant_id: product.selectedVariant?.variant_id || product.selectedVariant?.id || null,
                firestoreCollection: product.firestoreCollection || 'products',
                pricing: product.pricing || {
                    product_price: parseFloat(product.selectedVariant?.price || 0) * 0.7,
                    artist_cut: parseFloat(product.selectedVariant?.price || 0) * 0.25,
                    platform_fee: parseFloat(product.selectedVariant?.price || 0) * 0.05,
                    total_price: parseFloat(product.selectedVariant?.price || 0)
                }
            };
            
            // Log any missing required fields
            if (!productData.designer_id || !productData.designer_email) {
                console.warn('⚠️ Product missing designer info:', productData);
            }
            
            return productData;
        });
        
        // Get base URL for return URLs
        const baseUrl = window.location.origin;
        
        // Build payment request
        const paymentRequest = {
            title: cartProducts.length === 1 
                ? (firstProduct.productTitle || 'Product Purchase')
                : `${cartProducts.length} Produtos - Compra Múltipla`,
            description: description,
            quantity: 1, // Mercado Pago quantity, not product quantity
            unit_price: parseFloat(totalWithShipping.toFixed(2)), // INCLUDES SHIPPING
            picture_url: productImageUrl, // Required by Mercado Pago
            
            // CRITICAL: Buyer info - Mercado Pago validates these
            email: buyerInfo.email,
            payer_name: buyerInfo.name,
            
            // Phone must be properly formatted
            phone: buyerInfo.phone ? buyerInfo.phone.replace(/\D/g, '') : '11999999999',
            
            // CPF if available
            cpf: buyerInfo.cpf?.replace(/\D/g, '') || '',
            
            // Product info
            product_id: 'multi_product_cart_' + Date.now(),
            external_reference: generateOrderId(),
            
            // Cart products array
            cart_products: cart_products,
            
            // Total pricing with shipping breakdown
            total_price: totalWithShipping, // INCLUDES SHIPPING
            products_subtotal: totalPrice, // Products subtotal without shipping
            shipping_cost: shippingCost, // Shipping cost
            shipping_method: selectedShipping.method || 'PAC', // Shipping method
            shipping_formatted: selectedShipping.formatted || 'R$ 0,00', // Formatted shipping
            pricing_breakdowns: pricingBreakdowns,
            
            // FIXED: Return URLs - using absolute paths with base URL
            return_url: `${baseUrl}/success.html`,
            cancel_url: `${baseUrl}/checkout.html`,
            
            // Add payer info for Mercado Pago validation
            payer_info: {
                name: buyerInfo.name,
                email: buyerInfo.email,
                phone: {
                    number: buyerInfo.phone ? buyerInfo.phone.replace(/\D/g, '') : '11999999999',
                    area_code: '55'
                }
            }
        };
        
        // Add shipping address if available
        if (buyerInfo.street && buyerInfo.city && buyerInfo.state && buyerInfo.zipCode) {
            paymentRequest.shipping_address = {
                zip_code: buyerInfo.zipCode.replace(/\D/g, ''),
                street_name: buyerInfo.street,
                street_number: buyerInfo.number || 'S/N',
                complement: buyerInfo.complement || '',
                neighborhood: buyerInfo.neighborhood || '',
                city_name: buyerInfo.city,
                state_name: buyerInfo.state
            };
        }
        
        // Validate required fields before sending
        const requiredFields = ['email', 'payer_name', 'unit_price'];
        const missingFields = [];
        
        requiredFields.forEach(field => {
            if (!paymentRequest[field]) {
                missingFields.push(field);
            }
        });
        
        if (missingFields.length > 0) {
            throw new Error(`Campos obrigatórios faltando: ${missingFields.join(', ')}`);
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
        
        const responseText = await response.text();
        let responseData;
        
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse response:', responseText);
            throw new Error('Resposta inválida do servidor');
        }
        
        if (!response.ok) {
            console.error('❌ Server response error:', responseData);
            
            // Better error messages
            if (responseData.details && Array.isArray(responseData.details)) {
                throw new Error(`Erro de validação: ${responseData.details.join(', ')}`);
            } else if (responseData.error) {
                throw new Error(responseData.error);
            } else {
                throw new Error(`Erro do servidor: ${response.status}`);
            }
        }
        
        if (!responseData.success) {
            throw new Error(responseData.error || 'Falha ao criar pagamento');
        }
        
        console.log('✅ Checkout Pro payment created:', responseData);
        
        // 7. Store payment info
        currentPayment = responseData;
        
        // 8. Show payment options or redirect
        showPaymentOptions(responseData);
        
    } catch (error) {
        console.error('❌ Checkout Pro error:', error);
        showError(`Falha na configuração do pagamento: ${error.message}`);
        
        // Debug info
        console.log('🛒 Cart products:', cartProducts);
        console.log('👤 Buyer info:', getBuyerInfo());
        console.log('🚚 Shipping info:', selectedShipping);
    } finally {
        showLoading(false);
    }
}

// 6. Show payment options
function showPaymentOptions(paymentData) {
    // Get the EXACT total from the displayed resumo do pedido
    const totalElement = document.getElementById('totalPrice');
    const displayedTotal = totalElement ? totalElement.textContent.replace('R$ ', '').replace(',', '.') : '0';
    const totalPrice = parseFloat(displayedTotal);
    
    // Create simplified product list for modal
    const productListHtml = cartProducts.map(product => {
        let productPrice = 0;
        if (product.pricing && product.pricing.total_price) {
            productPrice = parseFloat(product.pricing.total_price);
        } else if (product.selectedVariant && product.selectedVariant.price) {
            productPrice = parseFloat(product.selectedVariant.price);
        }
        
        return `
            <div class="d-flex align-items-center justify-content-between mb-2">
                <div class="d-flex align-items-center">
                    <img src="${product.thumbnailUrl || product.thumbnail || 'default-product.png'}" 
                         class="rounded me-2"
                         style="width: 40px; height: 40px; object-fit: cover;"
                         alt="${product.productTitle}"
                         onerror="this.src='../public/images/default-product.png'">
                    <div>
                        <div class="small fw-bold">${product.productTitle || 'Produto'}</div>
                        <div class="text-muted small">${product.designerName || 'Designer'}</div>
                    </div>
                </div>
                <div class="text-end">
                    <div class="fw-bold">${formatCurrency(productPrice)}</div>
                </div>
            </div>
        `;
    }).join('');
    
    const paymentOptionsHtml = `
        <div class="modal fade" id="paymentOptionsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="fas fa-credit-card me-2"></i> Complete Seu Pagamento</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="text-center mb-4">
                            <i class="fas fa-shopping-bag fa-4x text-primary mb-3"></i>
                            <h3>Quase lá!</h3>
                            <p class="lead">Você será redirecionado para o Mercado Pago para completar seu pagamento</p>
                        </div>
                        
                        <div class="payment-summary card mb-4">
                            <div class="card-body">
                                <h6 class="card-title">Resumo do Pedido</h6>
                                
                                <!-- Lista de Produtos -->
                                <div class="products-summary-modal mb-3" style="max-height: 200px; overflow-y: auto; padding-right: 5px;">
                                    ${productListHtml}
                                </div>
                                
                                <hr>
                                
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Quantidade de Itens:</span>
                                    <span>${cartProducts.length} produto${cartProducts.length !== 1 ? 's' : ''}</span>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Valor Total:</span>
                                    <span class="fw-bold">${formatCurrency(totalPrice)}</span>
                                </div>
                                <hr>
                                <p class="small text-muted mb-0">
                                    <i class="fas fa-info-circle me-1"></i>
                                    Referência do pedido: ${paymentData.external_reference || 'N/A'}
                                </p>
                            </div>
                        </div>
                        
                        <div class="alert alert-success">
                            <div class="d-flex align-items-center">
                                <i class="fas fa-shield-alt fa-2x me-3"></i>
                                <div>
                                    <h6 class="mb-1">Pagamento Seguro</h6>
                                    <p class="mb-0">Seu pagamento é processado com segurança pelo Mercado Pago</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button id="redirectToCheckoutBtn" class="btn btn-primary">
                            <i class="fas fa-lock me-2"></i> Continuar para Pagamento Seguro
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

// 7. Redirect to Mercado Pago Checkout
// Modificar a função redirectToCheckout em pagamentos.js
function redirectToCheckout() {
    if (!currentPayment) {
        showError('Informações de pagamento não disponíveis');
        return;
    }
    
    // Use production URL if available, otherwise sandbox
    const checkoutUrl = currentPayment.init_point || currentPayment.sandbox_init_point;
    
    if (!checkoutUrl) {
        showError('URL de checkout não disponível');
        return;
    }
    
    console.log('🌐 Redirecting to Mercado Pago:', checkoutUrl);
    
    // IMPORTANTE: Salvar produtos que estão sendo comprados
    // para que possam ser movidos para "itens comprados" quando o pagamento for aprovado
    sessionStorage.setItem('pendingPurchases', JSON.stringify(
        cartProducts.map(product => ({
            ...product,
            order_id: currentPayment.external_reference,
            payment_id: currentPayment.preference_id,
            purchased_at: new Date().toISOString()
        }))
    ));
    
    // Store payment info in session for when user returns
    sessionStorage.setItem('lastPayment', JSON.stringify({
        external_reference: currentPayment.external_reference,
        amount: currentPayment.amount,
        product_count: cartProducts.length,
        timestamp: new Date().toISOString()
    }));
    
    // Clear cart after starting payment
    sessionStorage.removeItem('cartToPay');
    sessionStorage.removeItem('selectedProduct');
    
    // Redirect to Mercado Pago Checkout
    window.location.href = checkoutUrl;
}

// 8. Helper functions
function getBuyerInfo() {
    const name = document.getElementById('fullName')?.value || '';
    const email = document.getElementById('email')?.value || '';
    
    // Ensure we have required fields
    if (!name || !email) {
        console.error('Missing required buyer info:', { name, email });
    }
    
    return {
        name: name,
        cpf: document.getElementById('cpf')?.value || '',
        email: email,
        phone: document.getElementById('phone')?.value || '11999999999', // Default if empty
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
    let firstInvalidField = null;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            const isValid = validateField(fieldId, field.value, true);
            if (!isValid && !firstInvalidField) {
                firstInvalidField = field;
                allValid = false;
            }
        }
    });
    
    // Validate email format specifically
    const emailField = document.getElementById('email');
    if (emailField) {
        const email = emailField.value;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showError('Email inválido. Use um email válido como: nome@exemplo.com');
            emailField.focus();
            return false;
        }
    }
    
    if (firstInvalidField) {
        firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstInvalidField.focus();
    }
    
    return allValid;
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
            loadingOverlay.classList.add('active');
            // active class handles display
        } else {
            loadingOverlay.classList.remove('active');
            // active removed above
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

// 9. Update UI for Checkout Pro (simplified)
function updateUIForCheckoutPro() {
    // Update page title
    document.title = `Finalizar Compra - ${cartProducts.length} Produto${cartProducts.length !== 1 ? 's' : ''} - Kauara`;
    
    // Update form title
    const formTitle = document.querySelector('h1');
    if (formTitle) {
        formTitle.innerHTML = `<i class="fas fa-shopping-cart text-primary me-2"></i> Finalizar Compra (${cartProducts.length} produto${cartProducts.length !== 1 ? 's' : ''})`;
    }
    
    // Update button text
    const submitButton = document.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.innerHTML = '<i class="fas fa-lock me-2"></i> Finalizar Compra e Pagar';
    }
    
    console.log('✅ UI updated for Checkout Pro with', cartProducts.length, 'products');
}

// Função principal para calcular frete do carrinho - NO FALLBACKS
async function calculateCartShipping() {
    console.log('🚚 Calculating shipping for cart products...');
    
    // 1. Verificar se tem produtos
    if (!cartProducts || cartProducts.length === 0) {
        console.warn('⚠️ No products in cart');
        return null;
    }
    
    // 2. Build URL with indexed parameters (product1, product2, qty1, qty2, etc.)
    const baseUrl = 'https://us-central1-kauara1.cloudfunctions.net/calculateCartShipping';
    
    // Create URLSearchParams object
    const params = new URLSearchParams();
    
    // Add each product as product1, product2, etc. and each quantity as qty1, qty2, etc.
    cartProducts.forEach((product, index) => {
        const productId = product.productId || product.id;
        const position = index + 1; // Start at 1, not 0
        
        params.append(`product${position}`, productId);
        params.append(`qty${position}`, '1'); // Each product quantity 1
    });
    
    // Construct full URL with parameters
    const url = `${baseUrl}?${params.toString()}`;
    
    console.log('📤 Sending shipping request (GET):', url);
    
    try {
        showLoading(true);
        
        // 3. USE GET with proper parameter format
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const responseText = await response.text();
        let data;
        
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse response:', responseText);
            throw new Error('Resposta inválida do servidor');
        }
        
        if (!data.success) {
            throw new Error(data.error || 'Falha ao calcular frete');
        }
        
        console.log('✅ Shipping calculated:', data);
        
        // 4. Salvar resultado
        selectedShipping = {
            cost: data.shipping,
            formatted: data.formatted,
            breakdown: data.breakdown,
            method: data.method
        };
        
        // 5. Atualizar UI
        updateShippingUI(data);
        
        return data.shipping;
        
    } catch (error) {
        console.error('❌ Shipping calculation error:', error);
        // NO FALLBACK - throw error to be handled by caller
        throw new Error(`Falha ao calcular frete: ${error.message}`);
        
    } finally {
        showLoading(false);
    }
}

// Atualizar UI com o frete calculado
function updateShippingUI(data) {
    var shippingEl   = document.getElementById('shippingPrice');
    var breakdownEl  = document.getElementById('shippingBreakdown');
    var totalEl      = document.getElementById('totalPrice');
    var subtotalEl   = document.getElementById('subtotalPrice');
    var dotEl        = document.getElementById('shippingDot');
    var stateTextEl  = document.getElementById('shippingStatusText');

    // Show shipping value
    if (shippingEl) shippingEl.textContent = data.formatted || selectedShipping.formatted;

    // Mark dot as ready
    if (dotEl)       { dotEl.classList.add('ready'); }
    if (stateTextEl) { stateTextEl.textContent = 'Frete calculado'; }

    // Optional breakdown detail
    if (data.breakdown && breakdownEl) {
        breakdownEl.classList.add('visible');
        breakdownEl.innerHTML =
            '<details>' +
                '<summary style="cursor:pointer;list-style:none;">▸ Ver detalhamento do frete</summary>' +
                '<div style="margin-top:5px;line-height:1.7;">' +
                    'Base (maior produto): R$ ' + data.breakdown.calculation.highestBase.toFixed(2).replace('.', ',') +
                    ' (' + (data.breakdown.highestBaseItem ? data.breakdown.highestBaseItem.name : 'Produto') + ')' +
                    '<br>Adicionais (' + cartProducts.length + ' itens): R$ ' +
                    data.breakdown.calculation.totalAdditionals.toFixed(2).replace('.', ',') +
                '</div>' +
            '</details>';
    }

    // FIX: Calculate total from subtotalPrice element using locale-safe parsing
    // Uses the stored itemsTotal via subtotalPrice, then adds shipping.
    // This avoids the broken .replace('.','') that fails for values >= R$1.000
    if (totalEl && subtotalEl) {
        var raw = subtotalEl.textContent
            .replace(/[^\d,]/g, '')   // keep only digits and comma
            .replace(',', '.');        // comma → decimal point
        var subtotal = parseFloat(raw) || 0;
        var total = Math.round((subtotal + (data.shipping || 0)) * 100) / 100;
        totalEl.textContent = formatCurrency(total);
    }

    console.log('💰 UI updated with shipping:', data.formatted);
}

// Disparar cálculo quando CEP for preenchido
function setupShippingTrigger() {
    const zipCodeInput = document.getElementById('zipCode');
    
    if (zipCodeInput) {
        // Calcular quando CEP for preenchido
        zipCodeInput.addEventListener('blur', async function(e) {
            const zipDigits = this.value.replace(/\D/g, '');
            if (zipDigits.length === 8) {
                try {
                    await calculateCartShipping();
                } catch (error) {
                    showError(`Erro ao calcular frete: ${error.message}`);
                }
            }
        });
        
        // Também calcular quando endereço for auto-preenchido pelo ViaCEP
        zipCodeInput.addEventListener('change', async function(e) {
            const zipDigits = this.value.replace(/\D/g, '');
            if (zipDigits.length === 8) {
                try {
                    await calculateCartShipping();
                } catch (error) {
                    showError(`Erro ao calcular frete: ${error.message}`);
                }
            }
        });
    }
}

// Função de teste rápido
async function testShippingWithCart() {
    console.log('🧪 TESTING SHIPPING CALCULATION WITH CURRENT CART');
    console.log('Cart products:', cartProducts);
    
    try {
        const shipping = await calculateCartShipping();
        console.log('📦 Test result:', {
            products: cartProducts.length,
            shippingCost: shipping,
            formatted: selectedShipping.formatted
        });
        return shipping;
    } catch (error) {
        console.error('❌ Shipping test failed:', error);
        throw error;
    }
}

// Export para console
window.testShippingWithCart = testShippingWithCart;
console.log('✅ Production checkout system for multiple products loaded');