// pagamentos.js - Checkout Pro Payment System for Multiple Products
console.log('💰 pagamentos.js - v3.3');

let cartProducts = [];
let currentPayment = null;
let selectedShipping = {
  cost: 0,
  formatted: 'R$ 0,00'
};
const FUNCTIONS_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';

// Resolved once on page load — reused by processCheckoutPro without waiting again
let _currentUser = null;
let _firestoreUserId = null;

// ─── Auth helpers (mirrors app.js pattern) ───────────────────────────────────

// Resolves with the Firebase user as soon as auth is initialised (or null if not logged in).
// Uses onAuthStateChanged so it works even when currentUser is not yet populated.
function waitForAuthUser() {
    return new Promise(resolve => {
        const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            unsubscribe();
            resolve(user);
        });
    });
}

// Exact same function as app.js – queries users collection by firebaseUID field.
async function getUserIdFromUid(uid) {
    const snapshot = await firebase.firestore()
        .collection('users')
        .where('firebaseUID', '==', uid)
        .limit(1)
        .get();

    if (!snapshot.empty) {
        return snapshot.docs[0].id;
    }
    throw new Error(`No Firestore user document found for UID: ${uid}`);
}

// 1. Load products and initialize page
window.onload = async function() {
    console.log('🛒 Loading checkout page for multiple products...');
    console.log('🔍 DEBUG: window.onload triggered');
    
    try {
        const cartString = sessionStorage.getItem('cartToPay');
        console.log('🔍 DEBUG: cartString from sessionStorage:', cartString ? 'found' : 'not found');
        
        if (!cartString) {
            const productString = sessionStorage.getItem('selectedProduct');
            console.log('🔍 DEBUG: productString from sessionStorage:', productString ? 'found' : 'not found');
            
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
        
        console.log('🚚 Auto-calculating shipping on page load...');
        try {
            await calculateCartShipping();
            console.log('✅ Shipping auto-calculated successfully');
        } catch (shippingError) {
            console.warn('⚠️ Could not auto-calculate shipping on load:', shippingError.message);
        }

        // ─── Resolve auth eagerly so it's ready when the form is submitted ──────
        try {
            _currentUser = await waitForAuthUser();
            if (_currentUser) {
                _firestoreUserId = await getUserIdFromUid(_currentUser.uid);
                console.group('👤 Logged-in user');
                console.log('Email            :', _currentUser.email);
                console.log('UID              :', _currentUser.uid);
                console.log('Firestore user ID:', _firestoreUserId);
                console.log('Email verified   :', _currentUser.emailVerified);
                console.groupEnd();
            } else {
                console.warn('👤 No user logged in');
            }
        } catch (authError) {
            console.error('❌ Auth/Firestore user lookup failed:', authError.message);
        }

    } catch (error) {
        console.error('❌ Error:', error);
        showError(`Erro ao carregar checkout: ${error.message}`);
    }
};

// 2. Display multiple products information
function displayProductsInfo() {
    console.log('🔍 DEBUG: displayProductsInfo called');
    const productsContainer = document.getElementById('productsContainer');
    if (!productsContainer) { console.error('❌ productsContainer not found'); return; }
    productsContainer.innerHTML = '';

    let itemsTotal = 0;

    cartProducts.forEach(function(product) {
        if (!product.pricing || !product.pricing.total_price) {
            throw new Error('Produto "' + (product.productTitle || 'desconhecido') + '" sem pricing.total_price. Adicione o produto ao carrinho novamente.');
        }
        var itemTotal = parseFloat(product.pricing.total_price);
        if (isNaN(itemTotal) || itemTotal <= 0) {
            throw new Error('Preco invalido no produto "' + (product.productTitle || 'desconhecido') + '": ' + product.pricing.total_price);
        }

        console.log('🏷️ Produto:', (product.productTitle || 'desconhecido'), '| pricing.total_price =', product.pricing.total_price, '| parsed =', itemTotal);
        itemsTotal += itemTotal;

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

    var badge = document.getElementById('cartCountBadge');
    if (badge) badge.textContent = cartProducts.length + ' item' + (cartProducts.length !== 1 ? 's' : '');

    updatePricingDisplay(itemsTotal);
}

function updatePricingDisplay(itemsTotal) {
    var set  = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    var hide = function(id)      { var el = document.getElementById(id); if (el) el.style.display = 'none'; };

    ['artistCutRow', 'platformFeeRow', 'productPriceRow'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    set('subtotalPrice', formatCurrency(itemsTotal));
    set('totalPrice',    formatCurrency(itemsTotal));

    console.log('💰 Subtotal (soma dos produtos):', itemsTotal);
}

function setupCheckoutForm() {
    console.log('🔍 DEBUG: setupCheckoutForm called');
    const form = document.getElementById('checkoutForm');
    if (!form) {
        console.error('❌ Checkout form not found');
        return;
    }
    
    form.addEventListener('submit', async function(e) {
        console.log('🔍 DEBUG: Form submit event triggered!');
        e.preventDefault();
        await processCheckoutPro();
    });
    
    const backButton = document.getElementById('backButton');
    if (backButton) {
        backButton.addEventListener('click', function() {
            window.history.back();
        });
    }
    
    setupRealTimeValidation();
    
    const cpfInput = document.getElementById('cpf');
    if (cpfInput) {
        cpfInput.addEventListener('input', formatCPF);
    }
    
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', formatPhone);
    }
    
    const zipCodeInput = document.getElementById('zipCode');
    if (zipCodeInput) {
        zipCodeInput.addEventListener('input', formatZipCode);
    }
    
    console.log('🔍 DEBUG: Checkout form setup complete');
}

// 5. Process Checkout Pro payment - FIXED authentication
async function processCheckoutPro() {
    console.log('🔍🔍🔍 DEBUG: processCheckoutPro STARTED! 🔍🔍🔍');
    console.log('💳 Processing Checkout Pro payment for', cartProducts.length, 'products...');
    
    try {
        const buyerInfo = getBuyerInfo();
        
        if (!validateForm()) {
            alert('Por favor, preencha todos os campos obrigatórios corretamente.');
            return;
        }
        
        const termsCheck = document.getElementById('termsCheck');
        if (!termsCheck || !termsCheck.checked) {
            alert('Você precisa aceitar os Termos de Serviço para continuar.');
            return;
        }
        
        showLoading(true);
        
        let totalPrice = 0;
        let pricingBreakdowns = [];
        
        cartProducts.forEach(product => {
            let productPrice = 0;
            let productPricingData = null;
            
            if (!product.pricing || !product.pricing.total_price) {
                throw new Error('Produto "' + (product.productTitle || 'desconhecido') + '" sem pricing.total_price. Recarregue o carrinho.');
            }
            productPrice = parseFloat(product.pricing.total_price);
            if (isNaN(productPrice) || productPrice <= 0) {
                throw new Error('Preco invalido no produto "' + (product.productTitle || 'desconhecido') + '": ' + product.pricing.total_price);
            }
            productPricingData = product.pricing;
            console.log('💳 Produto (checkout):', (product.productTitle || 'desconhecido'), '| pricing.total_price =', product.pricing.total_price, '| parsed =', productPrice);
            
            totalPrice += productPrice;
            pricingBreakdowns.push({
                product_id: product.id || product.productId || `product_${Date.now()}`,
                title: product.productTitle || 'Product',
                pricing: productPricingData
            });
        });
        
        const shippingCost = selectedShipping.cost || 0;
        const totalWithShipping = totalPrice + shippingCost;
        
        console.log('💰 Price breakdown:', {
            productsTotal: totalPrice,
            shippingCost: shippingCost,
            totalWithShipping: totalWithShipping
        });
        
        if (totalWithShipping < 0.5) {
            showLoading(false);
            showError('Valor mínimo da compra é R$ 0,50');
            return;
        }
        
        console.log('💰 Total price to charge (with shipping):', totalWithShipping, 'from', cartProducts.length, 'products');
        
        const firstProduct = cartProducts[0];
        
        const productImageUrl = firstProduct.thumbnailUrl || 
                               firstProduct.thumbnail || 
                               firstProduct.imageUrl || 
                               firstProduct.image || 
                               'https://http2.mlstatic.com/frontend-assets/ui-nav/5.19.1/mercadolibre/180x180.png';
        
        const productTitles = cartProducts.map(p => p.productTitle || 'Produto').join(', ');
        const description = cartProducts.length === 1 
            ? `${firstProduct.productTitle || 'Product'} by ${firstProduct.designerName || 'Designer'}`
            : `${cartProducts.length} produtos: ${productTitles.substring(0, 100)}${productTitles.length > 100 ? '...' : ''}`;
        
        // ─── Use auth already resolved on page load ──────────────────────────────
        const currentUser = _currentUser;
        const firestoreUserId = _firestoreUserId;

        if (!currentUser) {
            showLoading(false);
            sessionStorage.setItem('cartToPay', JSON.stringify(cartProducts));
            window.location.href = 'login.html?redirect=pagamentos.html';
            return;
        }

        if (!firestoreUserId) {
            showLoading(false);
            showError('Sua conta não foi encontrada. Por favor, complete seu cadastro antes de comprar.');
            return;
        }
        
        const cart_products = cartProducts.map(product => {
            const isDimona = product.provider === 'dimona' || !!product.dimona_sku ||
                             !!(product.selectedVariant?.dimona_sku);

            const dimonaSku = product.dimona_sku ||
                              product.selectedVariant?.dimona_sku ||
                              product.selectedVariant?.sku ||
                              null;

            const designUrlFront = product.designUrls?.front || product.designUrl || null;
            const designUrlBack  = product.designUrls?.back  || product.design_url_back || null;

            const mockUrlFront = product.thumbnailUrls?.front || product.thumbnailUrl || null;
            const mockUrlBack  = product.thumbnailUrls?.back  || null;

            const productData = {
                product_id:          product.firestoreProductId || product.id || product.productId || `product_${Date.now()}`,
                title:               product.productTitle || 'Product',
                designer_id:         product.designerUserId || product.designer_id || 'unknown_designer',
                designer_name:       product.designerName  || 'Designer',
                designer_email:      product.designerEmail || 'designer@example.com',
                designerUserId:      product.designerUserId || product.designer_id || null,
                provider:            isDimona ? 'dimona' : (product.provider || 'printful'),
                dimona_sku:          isDimona ? dimonaSku : null,
                design_url:          isDimona ? designUrlFront : null,
                design_url_back:     isDimona ? designUrlBack  : null,
                mock_url:            isDimona ? mockUrlFront   : null,
                mock_url_back:       isDimona ? mockUrlBack    : null,
                designUrls:          isDimona ? (product.designUrls || {}) : null,
                thumbnailUrls:       isDimona ? (product.thumbnailUrls || {}) : null,
                variant_id:          !isDimona ? (product.selectedVariant?.variant_id || product.selectedVariant?.id || null) : null,
                quantity:            product.quantity || 1,
                firestoreCollection: product.firestoreCollection || 'products',
                thumbnailUrl:        product.thumbnailUrls?.front || product.thumbnailUrl || null,
                thumbnail:           product.thumbnailUrls?.front || product.thumbnailUrl || null,
                selectedVariant:     product.selectedVariant || {},
                pricing:             product.pricing
            };

            if (!productData.designer_id || !productData.designer_email) {
                console.warn('⚠️ Product missing designer info:', productData);
            }
            if (isDimona && !productData.dimona_sku) {
                console.warn('⚠️ Dimona product missing dimona_sku:', productData);
            }
            if (isDimona && !productData.design_url) {
                console.warn('⚠️ Dimona product missing design_url (frente):', productData);
            }

            return productData;
        });
        
        // ─────────────────────────────────────────────
        // 🪵 CHECKOUT SNAPSHOT LOG
        // ─────────────────────────────────────────────

        // 👤 Current user
        console.group('👤 Current User');
        console.log('UID              :', currentUser.uid);
        console.log('Email            :', currentUser.email);
        console.log('Email verified   :', currentUser.emailVerified);
        console.log('Display name     :', currentUser.displayName || '—');
        console.log('Provider         :', currentUser.providerData?.[0]?.providerId || '—');
        console.log('Firestore user ID:', firestoreUserId);
        console.groupEnd();

        // 🛒 Products (one group per item)
        console.group(`🛒 Cart Products (${cart_products.length} item${cart_products.length !== 1 ? 's' : ''})`);
        cart_products.forEach((p, i) => {
            console.group(`  [${i + 1}] ${p.title}`);
            console.log('product_id    :', p.product_id);
            console.log('provider      :', p.provider);
            console.log('dimona_sku    :', p.dimona_sku ?? '—');
            console.log('variant_id    :', p.variant_id ?? '—');
            console.log('quantity      :', p.quantity);
            console.log('designer      :', `${p.designer_name} (${p.designer_id})`);
            console.log('designer email:', p.designer_email);
            console.log('pricing       :', p.pricing);
            console.log('selectedVariant:', p.selectedVariant);
            console.log('design_url    :', p.design_url ?? '—');
            console.log('design_url_back:', p.design_url_back ?? '—');
            console.log('mock_url      :', p.mock_url ?? '—');
            console.log('thumbnailUrl  :', p.thumbnailUrl ?? '—');
            console.groupEnd();
        });
        console.groupEnd();

        // 💰 Pricing summary
        console.group('💰 Pricing Summary');
        console.log('Products subtotal:', formatCurrency(totalPrice));
        console.log('Shipping cost    :', formatCurrency(shippingCost));
        console.log('Total with shipping:', formatCurrency(totalWithShipping));
        console.log('Pricing breakdowns:', pricingBreakdowns);
        console.groupEnd();

        // 🚚 Shipping
        console.group('🚚 Shipping');
        console.log('Method     :', selectedShipping.method ?? '—');
        console.log('Cost       :', selectedShipping.formatted);
        console.log('Method ID  :', selectedShipping.delivery_method_id ?? '—');
        console.log('Business days:', selectedShipping.business_days ?? '—');
        console.groupEnd();

        // 🙍 Buyer info (from form)
        console.group('🙍 Buyer Info (form)');
        console.log('Name  :', buyerInfo.name);
        console.log('Email :', buyerInfo.email);
        console.log('Phone :', buyerInfo.phone);
        console.log('CPF   :', buyerInfo.cpf);
        console.log('Address:', {
            street: buyerInfo.street,
            number: buyerInfo.number,
            complement: buyerInfo.complement,
            neighborhood: buyerInfo.neighborhood,
            city: buyerInfo.city,
            state: buyerInfo.state,
            zipCode: buyerInfo.zipCode,
        });
        console.groupEnd();

        // ─────────────────────────────────────────────

        const baseUrl = window.location.origin;
        
        // Generate external_reference - MUST match server format
        const externalReference = generateOrderId();
        
        const paymentRequest = {
            title: cartProducts.length === 1 
                ? (firstProduct.productTitle || 'Product Purchase')
                : `${cartProducts.length} Produtos - Compra Múltipla`,
            description: description,
            quantity: 1,
            unit_price: parseFloat(totalWithShipping.toFixed(2)),
            picture_url: productImageUrl,
            
            email: buyerInfo.email,
            payer_name: buyerInfo.name,
            
            phone: buyerInfo.phone ? buyerInfo.phone.replace(/\D/g, '') : '11999999999',
            
            cpf: buyerInfo.cpf?.replace(/\D/g, '') || '',
            
            // 🔥 CRITICAL FIX: Include user information
            user_uid: currentUser ? currentUser.uid : null,
            firestore_user_id: firestoreUserId,

            product_id: 'multi_product_cart_' + Date.now(),
            external_reference: externalReference,
            
            cart_products: cart_products,
            
            total_price: totalWithShipping,
            products_subtotal: totalPrice,
            shipping_cost: shippingCost,
            shipping_method: selectedShipping.method || 'PAC',
            shipping_formatted: selectedShipping.formatted || 'R$ 0,00',
            shipping_delivery_method_id: selectedShipping.delivery_method_id || null,
            shipping_speed: (function() {
                const name = (selectedShipping.method || '').toLowerCase();
                if (name.includes('sedex'))  return 'sedex';
                if (name.includes('mini'))   return 'mini';
                if (name.includes('jadlog')) return 'jadlog';
                if (name.includes('pac'))    return 'pac';
                return 'pac';
            })(),
            pricing_breakdowns: pricingBreakdowns,
            
            return_url: `${baseUrl}/success.html?external_reference=${encodeURIComponent(externalReference)}`,
            cancel_url: `${baseUrl}/checkout.html`,
            
            payer_info: {
                name: buyerInfo.name,
                email: buyerInfo.email,
                phone: {
                    number: buyerInfo.phone ? buyerInfo.phone.replace(/\D/g, '') : '11999999999',
                    area_code: '55'
                }
            }
        };
        
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
        
        currentPayment = responseData;
        
        showPaymentOptions(responseData);
        
    } catch (error) {
        console.error('❌ Checkout Pro error:', error);
        showError(`Falha na configuração do pagamento: ${error.message}`);
        
        console.log('🛒 Cart products:', cartProducts);
        console.log('👤 Buyer info:', getBuyerInfo());
        console.log('🚚 Shipping info:', selectedShipping);
    } finally {
        showLoading(false);
    }
}

function showPaymentOptions(paymentData) {
    const totalElement = document.getElementById('totalPrice');
    const displayedTotal = totalElement ? totalElement.textContent.replace('R$ ', '').replace(',', '.') : '0';
    const totalPrice = parseFloat(displayedTotal);
    
    const productListHtml = cartProducts.map(product => {
        if (!product.pricing || !product.pricing.total_price) {
            throw new Error('Produto "' + (product.productTitle || 'desconhecido') + '" sem pricing.total_price no modal de confirmacao.');
        }
        const productPrice = parseFloat(product.pricing.total_price);
        
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
    
    const existingModal = document.getElementById('paymentOptionsModal');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', paymentOptionsHtml);
    const modal = new bootstrap.Modal(document.getElementById('paymentOptionsModal'));
    
    document.getElementById('redirectToCheckoutBtn').addEventListener('click', redirectToCheckout);
    
    modal.show();
}

function redirectToCheckout() {
    if (!currentPayment) {
        showError('Informações de pagamento não disponíveis');
        return;
    }
    
    const checkoutUrl = currentPayment.checkout_url || currentPayment.init_point || currentPayment.sandbox_url || currentPayment.sandbox_init_point;
    
    if (!checkoutUrl) {
        showError('URL de checkout não disponível');
        return;
    }
    
    console.log('🌐 Redirecting to Mercado Pago:', checkoutUrl);
    
    sessionStorage.setItem('lastPayment', JSON.stringify({
        external_reference: currentPayment.external_reference,
        amount: currentPayment.amount,
        product_count: cartProducts.length,
        timestamp: new Date().toISOString()
    }));
    
    sessionStorage.setItem('lastPaymentRef', currentPayment.external_reference);
    
    sessionStorage.removeItem('cartToPay');
    sessionStorage.removeItem('selectedProduct');
    
    window.location.href = checkoutUrl;
}

// 8. Helper functions
function getBuyerInfo() {
    const name = document.getElementById('fullName')?.value || '';
    const email = document.getElementById('email')?.value || '';
    
    if (!name || !email) {
        console.error('Missing required buyer info:', { name, email });
    }
    
    return {
        name: name,
        cpf: document.getElementById('cpf')?.value || '',
        email: email,
        phone: document.getElementById('phone')?.value || '11999999999',
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

// FIXED: Generate order ID that matches server expectation
function generateOrderId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `ORDER_${timestamp}_${random}`;
}

function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        if (show) {
            loadingOverlay.classList.add('active');
        } else {
            loadingOverlay.classList.remove('active');
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

function updateUIForCheckoutPro() {
    document.title = `Finalizar Compra - ${cartProducts.length} Produto${cartProducts.length !== 1 ? 's' : ''} - Kauara`;
    
    const formTitle = document.querySelector('h1');
    if (formTitle) {
        formTitle.innerHTML = `<i class="fas fa-shopping-cart text-primary me-2"></i> Finalizar Compra (${cartProducts.length} produto${cartProducts.length !== 1 ? 's' : ''})`;
    }
    
    const submitButton = document.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.innerHTML = '<i class="fas fa-lock me-2"></i> Finalizar Compra e Pagar';
    }
    
    console.log('✅ UI updated for Checkout Pro with', cartProducts.length, 'products');
}

async function calculateCartShipping() {
    console.log('🚚 Calculando frete Dimona...');

    if (!cartProducts || cartProducts.length === 0) {
        console.warn('⚠️ Nenhum produto no carrinho');
        return null;
    }

    const zipCode = document.getElementById('zipCode')?.value?.replace(/\D/g, '');
    if (!zipCode || zipCode.length !== 8) {
        console.warn('⚠️ CEP inválido ou não preenchido');
        return null;
    }

    const quantity = cartProducts.length;

    try {
        showLoading(true);

        const response = await fetch(
            `${FUNCTIONS_BASE_URL}/getDimonaShipping`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ zipcode: zipCode, quantity }),
            }
        );

        const data = await response.json();

        if (!data.success || !data.options?.length) {
            throw new Error(data.error || 'Nenhuma opção de frete disponível');
        }

        console.log('✅ Opções de frete recebidas:', data.options);

        renderShippingOptions(data.options);
        selectShippingOption(data.options[0]);

        return data.options[0].value;

    } catch (error) {
        console.error('❌ Erro ao calcular frete:', error);
        throw new Error(`Falha ao calcular frete: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function renderShippingOptions(options) {
    const container = document.getElementById('shippingOptionsContainer');
    if (!container) return;

    container._shippingOptions = options;

    container.innerHTML = options.map((opt, i) => `
        <div class="shipping-option ${i === 0 ? 'selected' : ''}"
             data-shipping-index="${i}">
            <input class="form-check-input shipping-radio" type="radio"
                   name="shippingOption" id="shipping_${i}"
                   value="${opt.delivery_method_id}" ${i === 0 ? 'checked' : ''}>
            <div style="flex:1;min-width:0;">
                <div class="so-name">${opt.name}</div>
                <div class="so-days">${opt.business_days} dias úteis</div>
            </div>
            <div class="so-price">${opt.formatted}</div>
        </div>`
    ).join('');

    container.addEventListener('click', function(e) {
        const row = e.target.closest('[data-shipping-index]');
        if (!row) return;
        const idx = parseInt(row.getAttribute('data-shipping-index'), 10);
        const opt = container._shippingOptions[idx];
        if (opt) selectShippingOption(opt);
    });

    const section = document.getElementById('shippingSection');
    if (section) section.style.display = 'block';
}

function selectShippingOption(option) {
    selectedShipping = {
        cost:               option.value,
        formatted:          option.formatted,
        method:             option.name,
        delivery_method_id: option.delivery_method_id,
        business_days:      option.business_days,
    };

    document.querySelectorAll('.shipping-option').forEach(el => {
        const radio = el.querySelector('.shipping-radio');
        const isSelected = parseInt(radio.value) === option.delivery_method_id;
        radio.checked = isSelected;
        el.classList.toggle('selected', isSelected);
    });

    const fakeData = {
        shipping:  option.value,
        formatted: option.formatted,
    };
    updateShippingUI(fakeData);

    console.log('🚚 Frete selecionado:', selectedShipping);
}

function updateShippingUI(data) {
    var shippingEl  = document.getElementById('shippingPrice');
    var totalEl     = document.getElementById('totalPrice');
    var subtotalEl  = document.getElementById('subtotalPrice');
    var dotEl       = document.getElementById('shippingDot');
    var stateTextEl = document.getElementById('shippingStatusText');

    if (shippingEl) shippingEl.textContent = data.formatted || selectedShipping.formatted;
    if (dotEl)       dotEl.classList.add('ready');
    if (stateTextEl) stateTextEl.textContent = 'Frete calculado';

    if (totalEl && subtotalEl) {
        var raw = subtotalEl.textContent
            .replace('R$', '')
            .trim()
            .replace(/\./g, '')
            .replace(',', '.');
        var subtotal = parseFloat(raw) || 0;
        var total = Math.round((subtotal + (data.shipping || 0)) * 100) / 100;
        totalEl.textContent = formatCurrency(total);
    }

    console.log('💰 Frete atualizado:', data.formatted);
}

function setupShippingTrigger() {
    const zipCodeInput = document.getElementById('zipCode');
    
    if (zipCodeInput) {
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

window.testShippingWithCart = testShippingWithCart;
console.log('✅ Production checkout system for multiple products loaded');