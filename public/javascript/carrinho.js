// carrinho.js
document.addEventListener('DOMContentLoaded', function() {
    renderCart();
    
    // Botão de limpar carrinho
    const clearCartBtn = document.getElementById('clearCartButton');
    if (clearCartBtn) {
        clearCartBtn.addEventListener('click', clearCart);
    }
    
    // Botão de limpar histórico de compras
    const clearHistoryBtn = document.getElementById('clearHistoryButton');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearPurchaseHistory);
    }
    
    // Verificar se há produtos comprados na sessão (quando voltar do pagamento)
    checkForNewPurchases();
});

// =============================================
// VERIFICAR NOVAS COMPRAS APÓS PAGAMENTO
// =============================================

function checkForNewPurchases() {
    // NOTE: cartIndicesToRemove is intentionally NOT cleared here on page load.
    // Items are only removed from the cart after payment is confirmed as approved
    // (inside checkPaymentStatus when status === 'approved').
    // Returning to this page after cancelling payment must leave the cart intact.

    const lastPayment = sessionStorage.getItem('lastPayment');
    const pendingPurchases = sessionStorage.getItem('pendingPurchases');
    
    if (lastPayment) {
        try {
            const paymentInfo = JSON.parse(lastPayment);
            console.log('💰 Pagamento detectado:', paymentInfo);
            
            // Verificar status do pagamento
            checkPaymentStatus(paymentInfo.external_reference);
            
        } catch (error) {
            console.error('Erro ao processar último pagamento:', error);
        }
    }
    
    if (pendingPurchases) {
        try {
            const purchases = JSON.parse(pendingPurchases);
            console.log('📦 Compras pendentes detectadas:', purchases);
            
            // Mover produtos pendentes para itens comprados
            movePendingToPurchased(purchases);
            
            // Limpar pendingPurchases
            sessionStorage.removeItem('pendingPurchases');
        } catch (error) {
            console.error('Erro ao processar compras pendentes:', error);
        }
    }
}

// =============================================
// VERIFICAR STATUS DO PAGAMENTO
// =============================================

async function checkPaymentStatus(externalReference) {
    try {
        console.log('🔍 Verificando status do pagamento:', externalReference);
        
        const response = await fetch(
            `https://us-central1-kauara1.cloudfunctions.net/getPaymentStatus?external_reference=${externalReference}`
        );
        
        const data = await response.json();
        
        if (data.success && data.payment) {
            const payment = data.payment;
            
            if (payment.status === 'approved') {
                console.log('✅ Pagamento aprovado! Movendo produtos para itens comprados');

                // ✅ Only now is it safe to remove the purchased items from the cart
                const indicesToRemove = sessionStorage.getItem('cartIndicesToRemove');
                if (indicesToRemove) {
                    try {
                        const indices = JSON.parse(indicesToRemove);
                        let cart = JSON.parse(localStorage.getItem('cart') || '[]');
                        indices.sort((a, b) => b - a).forEach(i => cart.splice(i, 1));
                        localStorage.setItem('cart', JSON.stringify(cart));
                        sessionStorage.removeItem('cartIndicesToRemove');
                        console.log('🛒 Cart items removed after confirmed payment, remaining:', cart.length);
                    } catch (e) {
                        console.error('Error removing purchased items from cart:', e);
                    }
                }
                
                // Buscar detalhes completos do pedido
                const orderResponse = await fetch(
                    `https://us-central1-kauara1.cloudfunctions.net/getOrderDetails?order_id=${externalReference}`
                );
                
                const orderData = await orderResponse.json();
                
                if (orderData.success && orderData.order) {
                    // Mover produtos para itens comprados
                    moveCartToPurchased(orderData.order.cart_products, {
                        order_id: externalReference,
                        payment_id: payment.payment_id,
                        date: new Date().toISOString()
                    });
                }
                
                // Limpar sessão
                sessionStorage.removeItem('lastPayment');
                sessionStorage.removeItem('cartToPay');
                sessionStorage.removeItem('selectedProduct');
                
                // Mostrar mensagem de sucesso
                showToast('🎉 Pagamento aprovado! Seus produtos foram movidos para "Itens Comprados"', 'success');
            } else if (payment.status === 'pending' || payment.status === 'in_process') {
                console.log('⏳ Pagamento pendente. Aguardando confirmação...');
                
                // Aguardar e verificar novamente após alguns segundos
                setTimeout(() => checkPaymentStatus(externalReference), 5000);
            } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
                console.log('❌ Pagamento não aprovado — cart preserved');
                sessionStorage.removeItem('lastPayment');
                sessionStorage.removeItem('cartIndicesToRemove'); // clean up — cart stays intact
                sessionStorage.removeItem('cartToPay');
                sessionStorage.removeItem('selectedProduct');
                
                showToast('❌ Pagamento não foi concluído. Os produtos permanecem no carrinho.', 'warning');
            }
        }
    } catch (error) {
        console.error('Erro ao verificar status do pagamento:', error);
    }
}

// =============================================
// MOVER PRODUTOS DO CARRINHO PARA ITENS COMPRADOS (CORRIGIDO)
// =============================================

function moveCartToPurchased(cartProducts, purchaseInfo) {
    console.log('📦 Movendo produtos para itens comprados:', cartProducts);
    console.log('📦 Informações da compra:', purchaseInfo);
    
    // Buscar carrinho atual e itens comprados existentes
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    
    console.log('📊 Estado atual:', {
        cartItems: cart.length,
        purchasedItems: purchasedItems.length
    });
    
    // Identificar quais produtos do carrinho foram comprados
    // Usar múltiplos critérios para garantir correspondência correta
    const purchasedProductIds = cartProducts.map(p => p.product_id || p.id).filter(id => id);
    
    console.log('🔍 IDs dos produtos comprados:', purchasedProductIds);
    
    // IMPORTANTE: Filtrar o carrinho para REMOVER apenas os produtos comprados
    const remainingCart = cart.filter(item => {
        const itemId = item.product_id || item.id;
        const isPurchased = purchasedProductIds.includes(itemId);
        
        // Se for comprado, NÃO deve permanecer no carrinho
        if (isPurchased) {
            console.log('✅ Produto será removido do carrinho:', item.productTitle || item.title);
            return false; // Remove do carrinho
        }
        return true; // Mantém no carrinho
    });
    
    // Preparar novos itens comprados (apenas os que foram comprados AGORA)
    const newlyPurchased = cart
        .filter(item => {
            const itemId = item.product_id || item.id;
            return purchasedProductIds.includes(itemId);
        })
        .map(item => {
            // Adicionar informações de compra ao produto
            return {
                ...item,
                purchased_at: purchaseInfo.date || new Date().toISOString(),
                order_id: purchaseInfo.order_id,
                payment_id: purchaseInfo.payment_id,
                purchase_status: 'completed',
                delivery_status: 'processing',
                purchase_date: new Date().toISOString()
            };
        });
    
    console.log('📦 Novos itens comprados:', newlyPurchased.length);
    console.log('🛒 Itens restantes no carrinho:', remainingCart.length);
    
    // Adicionar novos itens comprados ao histórico (evitando duplicatas)
    // Verificar se já não existe um item com mesmo order_id e product_id
    const existingKeys = new Set(
        purchasedItems.map(item => `${item.order_id}_${item.product_id || item.id}`)
    );
    
    const uniqueNewPurchases = newlyPurchased.filter(item => {
        const key = `${item.order_id}_${item.product_id || item.id}`;
        return !existingKeys.has(key);
    });
    
    // Combinar itens comprados existentes com os novos
    const updatedPurchasedItems = [...uniqueNewPurchases, ...purchasedItems];
    
    console.log('📊 Novo estado:', {
        remainingCart: remainingCart.length,
        newPurchased: uniqueNewPurchases.length,
        totalPurchased: updatedPurchasedItems.length
    });
    
    // Atualizar localStorage
    localStorage.setItem('cart', JSON.stringify(remainingCart));
    localStorage.setItem('purchasedItems', JSON.stringify(updatedPurchasedItems));
    
    // Disparar evento para notificar outras abas/janelas
    window.dispatchEvent(new StorageEvent('storage', {
        key: 'cart',
        newValue: JSON.stringify(remainingCart)
    }));
    
    window.dispatchEvent(new StorageEvent('storage', {
        key: 'purchasedItems',
        newValue: JSON.stringify(updatedPurchasedItems)
    }));
    
    console.log('✅ Produtos movidos com sucesso: carrinho limpo, itens adicionados ao histórico');
    
    // Re-renderizar o carrinho
    renderCart();
    
    // Mostrar toast de confirmação
    showToast(`🎉 ${uniqueNewPurchases.length} produto(s) comprado(s) movido(s) para "Itens Comprados"`, 'success');
    
    return uniqueNewPurchases;
}
// =============================================
// VERIFICAR SE PRODUTO JÁ EXISTE NO HISTÓRICO
// =============================================

function isProductAlreadyPurchased(purchasedItems, newItem) {
    return purchasedItems.some(existingItem => 
        existingItem.order_id === newItem.order_id && 
        (existingItem.product_id || existingItem.id) === (newItem.product_id || newItem.id)
    );
}
// =============================================
// MOVER PENDENTES PARA COMPRADOS
// =============================================

function movePendingToPurchased(purchases) {
    console.log('📦 Movendo compras pendentes:', purchases);
    
    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    
    // Adicionar cada compra pendente ao histórico
    purchases.forEach(purchase => {
        // Verificar se já não existe
        const exists = purchasedItems.some(item => 
            item.order_id === purchase.order_id && 
            item.product_id === purchase.product_id
        );
        
        if (!exists) {
            purchasedItems.push({
                ...purchase,
                purchase_status: 'completed',
                delivery_status: 'processing',
                moved_at: new Date().toISOString()
            });
        }
    });
    
    localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
    
    // Limpar carrinho se todos os produtos foram comprados
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const remainingCart = cart.filter(item => {
        // Manter apenas produtos que não estão na lista de comprados
        return !purchases.some(p => p.product_id === (item.product_id || item.id));
    });
    
    localStorage.setItem('cart', JSON.stringify(remainingCart));
    
    renderCart();
}

// =============================================
// RENDERIZAR CARRINHO COM SEÇÃO DE COMPRADOS
// =============================================

function renderCart() {
    const cartList = document.getElementById('cartList');
    const purchasedList = document.getElementById('purchasedList');
    const checkoutBtn = document.getElementById('checkoutButton');
    const clearCartBtn = document.getElementById('clearCartButton');
    const clearHistoryBtn = document.getElementById('clearHistoryButton');
    const purchasedSection = document.getElementById('purchasedSection');
    
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');

    // Atualizar contadores
    updateCartCounters(cart.length, purchasedItems.length);

    // Renderizar carrinho ativo
    if (cart.length === 0) {
        if (cartList) {
            cartList.innerHTML = `
                <div class="text-center py-5 empty-cart-message">
                    <i class="fas fa-shopping-basket fa-4x mb-3 text-muted"></i>
                    <h5 class="text-muted">Seu carrinho está vazio</h5>
                    <p class="text-muted mb-4">Adicione produtos para continuar</p>
                    <a href="inicio.html" class="btn btn-primary">
                        <i class="fas fa-store me-2"></i>Ver Produtos
                    </a>
                </div>`;
        }
        
        if (checkoutBtn) checkoutBtn.disabled = true;
        if (clearCartBtn) clearCartBtn.disabled = true;
    } else {
        if (checkoutBtn) {
            checkoutBtn.disabled = false;
            checkoutBtn.innerHTML = '<i class="fas fa-credit-card me-2"></i>Ir para Pagamentos';
        }
        if (clearCartBtn) clearCartBtn.disabled = false;
        
        renderActiveCart(cart, cartList);
    }

    // Renderizar itens comprados
    if (purchasedItems.length === 0) {
        if (purchasedSection) purchasedSection.style.display = 'none';
    } else {
        if (purchasedSection) purchasedSection.style.display = 'block';
        if (clearHistoryBtn) clearHistoryBtn.disabled = false;
        
        renderPurchasedItems(purchasedItems, purchasedList);
    }

    // Calcular e atualizar totais
    updateTotals(calculateCartTotal(cart));
}

// =============================================
// RENDERIZAR CARRINHO ATIVO (com checkboxes de seleção)
// =============================================

function renderActiveCart(cart, container) {
    if (!container) return;

    container.innerHTML = `
        <div class="d-flex align-items-center gap-2 mb-3 px-1">
            <input type="checkbox" id="selectAllItems" class="form-check-input mt-0"
                   onchange="toggleSelectAll(this.checked)" style="width:18px;height:18px;cursor:pointer;">
            <label for="selectAllItems" class="mb-0 text-muted" style="cursor:pointer;">
                Selecionar todos
            </label>
            <button id="buySelectedBtn" class="btn btn-sm btn-primary ms-auto"
                    onclick="checkoutSelected()" disabled>
                <i class="fas fa-credit-card me-1"></i>Comprar Selecionados
            </button>
        </div>`;

    cart.forEach((item, index) => {
        let itemPrice = 0;
        if (item.pricing?.total_price) itemPrice = parseFloat(item.pricing.total_price);
        else if (item.selectedVariant?.price) itemPrice = parseFloat(item.selectedVariant.price);
        
        // Get color code from selected variant
        const backgroundColor = item.selectedVariant?.color_code || 
                                item.selectedVariant?.colorCode || 
                                '#f8f9fa';
        
        container.innerHTML += createCartItemHtml(item, index, itemPrice, false, backgroundColor);
    });
}

function toggleSelectAll(checked) {
    document.querySelectorAll('.cart-item-checkbox').forEach(cb => { cb.checked = checked; });
    updateSelectionTotal();
}

function updateSelectionTotal() {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const checked = document.querySelectorAll('.cart-item-checkbox:checked');
    const buyBtn = document.getElementById('buySelectedBtn');
    const checkoutBtn = document.getElementById('checkoutButton');

    let total = 0;
    checked.forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        const item = cart[idx];
        if (item) {
            if (item.pricing?.total_price) total += parseFloat(item.pricing.total_price);
            else if (item.selectedVariant?.price) total += parseFloat(item.selectedVariant.price);
        }
    });

    const hasSelection = checked.length > 0;
    if (buyBtn) {
        buyBtn.disabled = !hasSelection;
        buyBtn.innerHTML = hasSelection
            ? `<i class="fas fa-credit-card me-1"></i>Comprar ${checked.length} item(s) · ${formatCurrency(total)}`
            : `<i class="fas fa-credit-card me-1"></i>Comprar Selecionados`;
    }
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
}

function checkoutSelected() {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const checked = document.querySelectorAll('.cart-item-checkbox:checked');

    if (checked.length === 0) {
        alert('Selecione ao menos um produto.');
        return;
    }

    const selectedItems = [];
    checked.forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        if (cart[idx]) selectedItems.push(cart[idx]);
    });

    let total = 0;
    selectedItems.forEach(item => {
        if (item.pricing?.total_price) total += parseFloat(item.pricing.total_price);
        else if (item.selectedVariant?.price) total += parseFloat(item.selectedVariant.price);
    });

    sessionStorage.setItem('cartToPay', JSON.stringify(selectedItems));
    sessionStorage.setItem('selectedProduct', JSON.stringify({
        type: 'multi_product_cart',
        products: selectedItems,
        total_price: total
    }));

    // Remember which indices to remove after successful payment
    const selectedIndices = Array.from(checked).map(cb => parseInt(cb.dataset.index));
    sessionStorage.setItem('cartIndicesToRemove', JSON.stringify(selectedIndices));

    showLoading(true);
    setTimeout(() => { window.location.href = 'pagamentos.html'; }, 500);
}

// =============================================
// RENDERIZAR ITENS COMPRADOS
// =============================================

function renderPurchasedItems(items, container) {
    if (!container) return;
    
    container.innerHTML = '';
    
    // Ordenar por data de compra (mais recentes primeiro)
    const sortedItems = [...items].sort((a, b) => {
        const dateA = new Date(a.purchased_at || a.created_at || 0);
        const dateB = new Date(b.purchased_at || b.created_at || 0);
        return dateB - dateA;
    });

    sortedItems.forEach((item, index) => {
        // Calcula preço
        let itemPrice = 0;
        if (item.pricing && item.pricing.total_price) {
            itemPrice = parseFloat(item.pricing.total_price);
        } else if (item.selectedVariant && item.selectedVariant.price) {
            itemPrice = parseFloat(item.selectedVariant.price);
        }
        
        // Get color code from selected variant
        const backgroundColor = item.selectedVariant?.color_code || 
                                item.selectedVariant?.colorCode || 
                                '#f8f9fa';
        
        // Formatar data
        const purchaseDate = item.purchased_at || item.created_at;
        const formattedDate = purchaseDate ? new Date(purchaseDate).toLocaleDateString('pt-BR') : 'Data desconhecida';
        
        // Determinar status de entrega
        const deliveryStatus = getDeliveryStatus(item);
        
        const itemHtml = createPurchasedItemHtml(item, index, itemPrice, formattedDate, deliveryStatus, backgroundColor);
        container.innerHTML += itemHtml;
    });
}

// =============================================
// CRIAR HTML PARA ITEM DO CARRINHO
// =============================================

function createCartItemHtml(item, index, price, isPurchased = false, backgroundColor = '#f8f9fa') {
    const isClientProduct = !!item.originalArtId; // products from canvas-client have this field
    const clientBadge = isClientProduct
        ? `<span class="badge ms-1" style="background:#f59e0b;color:#fff;">
               <i class="fas fa-user-circle me-1"></i>Meu Design
           </span>`
        : '';

    return `
        <div class="card mb-3 cart-item ${isClientProduct ? 'border-warning' : ''}" data-index="${index}">
            <div class="card-body">
                <div class="row align-items-center g-2">
                    ${!isPurchased ? `
                    <div class="col-auto d-flex align-items-center ps-2">
                        <input type="checkbox" class="cart-item-checkbox form-check-input mt-0"
                               data-index="${index}"
                               onchange="updateSelectionTotal()"
                               style="width:20px;height:20px;cursor:pointer;">
                    </div>` : ''}
                    <div class="col-auto">
                        <div class="product-image-container" 
                             style="background-color: ${backgroundColor}; border-radius: 8px; line-height: 0; display: inline-block;">
                            <img src="${item.thumbnailUrl || item.thumbnail || 'default-product.png'}"
                                 class="img-fluid rounded cart-item-img"
                                 alt="${item.productTitle || ''}"
                                 style="max-width: 100px; max-height: 100px; width: auto; height: auto; object-fit: contain; display: block;"
                                 onerror="this.src='../public/images/default-product.png'">
                        </div>
                    </div>
                    <div class="col">
                        <h6 class="card-title mb-1">
                            ${item.productTitle || 'Produto sem nome'}
                            ${clientBadge}
                        </h6>
                        <p class="text-muted mb-1 small">
                            <i class="fas fa-user me-1"></i>
                            ${isClientProduct ? 'Seu produto personalizado' : 'Designer: ' + (item.designerName || 'Desconhecido')}
                        </p>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1">
                                ${item.selectedVariant?.color_code || item.selectedVariant?.colorCode
                                    ? `<span class="color-indicator" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${item.selectedVariant.color_code || item.selectedVariant.colorCode};border:1px solid #ccc;flex-shrink:0;"></span>`
                                    : ''}
                                ${item.selectedVariant?.color || 'Cor padrão'}
                            </span>
                            <span class="badge bg-light text-dark border">
                                Tamanho: ${item.selectedVariant?.size || 'Único'}
                            </span>
                        </div>
                    </div>
                    <div class="col-auto text-end">
                        <div class="fw-bold text-primary fs-5 mb-2">
                            ${formatCurrency(price)}
                        </div>
                        ${!isPurchased ? `
                            <button class="btn btn-sm btn-outline-danger remove-btn"
                                    onclick="removeFromCart(${index})"
                                    title="Remover do carrinho">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// =============================================
// CRIAR HTML PARA ITEM COMPRADO (PRINTFUL COMPLETO)
// =============================================

function createPurchasedItemHtml(item, index, price, purchaseDate, deliveryStatus, backgroundColor = '#f8f9fa') {
    const { status, icon, label, color, description, tracking, holdReason, estimatedDelivery, shipDate } = deliveryStatus;

    // Progress steps — which ones are active for current status
    const steps = [
        { key: 'processing',        icon: 'fa-clock',        text: 'Pedido Recebido' },
        { key: 'in_production',     icon: 'fa-print',        text: 'Em Produção'     },
        { key: 'shipped',           icon: 'fa-truck',        text: 'Enviado'         },
        { key: 'delivered',         icon: 'fa-check-circle', text: 'Entregue'        }
    ];

    const stepOrder = ['processing', 'printful_received', 'in_production', 'on_hold', 'shipped', 'delivered'];
    const currentStepIndex = stepOrder.indexOf(status);

    // Only show progress bar for normal flow (not cancelled/failed/returned)
    const showProgress = !['cancelled', 'failed', 'returned'].includes(status);

    const progressHtml = showProgress ? `
        <div class="d-flex align-items-center justify-content-between mt-3 mb-1 progress-steps">
            ${steps.map((step, i) => {
                const stepIdx = stepOrder.indexOf(step.key);
                const isDone    = currentStepIndex > stepIdx;
                const isActive  = currentStepIndex === stepIdx ||
                                  (step.key === 'in_production' && status === 'printful_received') ||
                                  (step.key === 'in_production' && status === 'on_hold');
                const stepColor = isDone ? 'success' : isActive ? color : 'secondary';
                return `
                <div class="text-center flex-fill">
                    <div class="rounded-circle d-inline-flex align-items-center justify-content-center mb-1"
                         style="width:28px;height:28px;background:${isDone||isActive ? `var(--bs-${stepColor})` : '#dee2e6'};color:white;font-size:12px;">
                        <i class="fas ${isDone ? 'fa-check' : step.icon}"></i>
                    </div>
                    <div class="small" style="font-size:10px;color:${isDone||isActive ? `var(--bs-${stepColor})` : '#adb5bd'}">
                        ${step.text}
                    </div>
                </div>
                ${i < steps.length - 1 ? `<div class="flex-fill border-top mt-2 mx-1" style="border-color:${isDone ? 'var(--bs-success)' : '#dee2e6'} !important;height:0;align-self:start;margin-top:14px !important;"></div>` : ''}
            `}).join('')}
        </div>
    ` : '';

    const trackingHtml = tracking ? `
        <div class="mt-2 p-2 rounded" style="background:#f8f9fa;font-size:13px;">
            <i class="fas fa-box-open me-1 text-primary"></i>
            <strong>Rastreio:</strong>
            ${tracking.url
                ? `<a href="${tracking.url}" target="_blank" class="ms-1">${tracking.code}</a>`
                : `<span class="ms-1">${tracking.code}</span>`
            }
            ${tracking.carrier ? `<span class="ms-2 text-muted">(${tracking.carrier})</span>` : ''}
            ${estimatedDelivery ? `
                <div class="mt-1 text-muted">
                    <i class="fas fa-calendar-check me-1"></i>
                    Previsão: ${new Date(estimatedDelivery).toLocaleDateString('pt-BR')}
                </div>
            ` : ''}
        </div>
    ` : '';

    const holdHtml = holdReason ? `
        <div class="mt-2 alert alert-warning py-1 px-2 mb-0" style="font-size:12px;">
            <i class="fas fa-exclamation-triangle me-1"></i> ${holdReason}
        </div>
    ` : '';

    return `
        <div class="card mb-3 purchased-item" style="border-left: 4px solid var(--bs-${color});">
            <div class="card-body">
                <div class="row align-items-start">
                    <div class="col-md-2">
                        <div class="product-image-container" 
                             style="background-color: ${backgroundColor}; border-radius: 8px; line-height: 0; display: inline-block;">
                            <img src="${item.thumbnailUrl || item.thumbnail || 'default-product.png'}"
                                 class="img-fluid rounded cart-item-img"
                                 alt="${item.productTitle || ''}"
                                 style="max-width: 100%; max-height: 150px; width: auto; height: auto; object-fit: contain; display: block;"
                                 onerror="this.src='../public/images/default-product.png'">
                        </div>
                    </div>
                    <div class="col-md-7">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <h6 class="card-title mb-1">${item.productTitle || 'Produto sem nome'}</h6>
                                <p class="text-muted mb-1 small">
                                    <i class="fas fa-user me-1"></i>Designer: ${item.designerName || 'Desconhecido'}
                                </p>
                            </div>
                            <span class="badge bg-${color} ms-2 text-nowrap">
                                <i class="fas ${icon} me-1"></i>${label}
                            </span>
                        </div>

                        <div class="text-muted small mb-1">${description}</div>

                        <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
                            <span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1">
                                ${item.selectedVariant?.color_code || item.selectedVariant?.colorCode
                                    ? `<span class="color-indicator" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${item.selectedVariant.color_code || item.selectedVariant.colorCode};border:1px solid #ccc;flex-shrink:0;"></span>`
                                    : ''}
                                ${item.selectedVariant?.color || 'Cor padrão'}
                            </span>
                            <span class="badge bg-light text-dark border">
                                Tamanho: ${item.selectedVariant?.size || 'Único'}
                            </span>
                            <span class="badge bg-secondary">
                                <i class="fas fa-calendar me-1"></i>${purchaseDate}
                            </span>
                        </div>

                        ${progressHtml}
                        ${trackingHtml}
                        ${holdHtml}

                        ${item.order_id ? `
                            <div class="mt-2">
                                <small class="text-muted">
                                    <i class="fas fa-receipt me-1"></i>
                                    Pedido: ${item.order_id}
                                </small>
                            </div>
                        ` : ''}
                    </div>
                    <div class="col-md-3 text-end">
                        <div class="fw-bold text-success fs-5 mb-2">
                            ${formatCurrency(price)}
                        </div>
                        <div class="d-flex flex-column gap-1 align-items-end mt-1">
                            ${item.order_id ? `
                                <button class="btn btn-sm btn-outline-secondary"
                                        data-refresh="${item.order_id}"
                                        onclick="refreshOrderStatus('${item.order_id}', ${index})"
                                        title="Atualizar status do pedido">
                                    <i class="fas fa-sync-alt me-1"></i>Atualizar
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-outline-danger"
                                    onclick="cancelPurchase('${item.order_id || ''}', ${index})"
                                    title="Cancelar compra">
                                <i class="fas fa-times-circle me-1"></i>Cancelar Compra
                            </button>
                            <button class="btn btn-sm btn-outline-primary"
                                    onclick="buyAgain('${index}')"
                                    title="Comprar novamente">
                                <i class="fas fa-redo-alt me-1"></i>Comprar de novo
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// =============================================
// DETERMINAR STATUS DE ENTREGA (PRINTFUL COMPLETO)
// =============================================

/**
 * Printful delivery_status values stored in Firestore:
 *   processing    — payment approved, order queued
 *   printful_received — Printful acknowledged the order
 *   in_production — Printful is printing / assembling
 *   on_hold       — order on hold (needs action)
 *   shipped       — package dispatched, tracking available
 *   returned      — package returned to sender
 *   delivered     — confirmed delivered
 *   failed        — Printful could not fulfill
 *   cancelled     — order cancelled
 */
function getDeliveryStatus(item) {
    const status = item.delivery_status || item.shipping_status || item.order_status || 'processing';

    const statusConfig = {
        'processing': {
            icon: 'fa-clock',
            label: 'Processando',
            color: 'info',
            description: 'Pagamento aprovado, pedido em fila'
        },
        'printful_received': {
            icon: 'fa-check',
            label: 'Pedido Recebido',
            color: 'info',
            description: 'Printful recebeu seu pedido'
        },
        'in_production': {
            icon: 'fa-print',
            label: 'Em Produção',
            color: 'warning',
            description: 'Seu produto está sendo impresso'
        },
        'on_hold': {
            icon: 'fa-pause-circle',
            label: 'Em Espera',
            color: 'warning',
            description: 'Pedido pausado — aguardando ação'
        },
        'shipped': {
            icon: 'fa-truck',
            label: 'Enviado',
            color: 'primary',
            description: 'Produto a caminho!'
        },
        'returned': {
            icon: 'fa-undo',
            label: 'Devolvido',
            color: 'danger',
            description: 'Encomenda devolvida ao remetente'
        },
        'delivered': {
            icon: 'fa-check-circle',
            label: 'Entregue',
            color: 'success',
            description: 'Produto entregue com sucesso!'
        },
        'failed': {
            icon: 'fa-exclamation-circle',
            label: 'Falhou',
            color: 'danger',
            description: 'Problema na produção — entre em contato'
        },
        'cancelled': {
            icon: 'fa-times-circle',
            label: 'Cancelado',
            color: 'danger',
            description: 'Pedido cancelado'
        }
    };

    // Normalize legacy/shopFunctions status values
    const normalizeMap = {
        'printful_processing': 'in_production',
        'printful_failed':     'failed',
        'fulfilled':           'shipped',
        'inprocess':           'in_production',
        'onhold':              'on_hold',
        'pending':             'processing',
        'draft':               'processing',
        'completed':           'delivered'
    };

    const normalized = normalizeMap[status] || status;
    const config = statusConfig[normalized] || statusConfig['processing'];

    return {
        status: normalized,
        icon: config.icon,
        label: config.label,
        color: config.color,
        description: config.description,
        tracking: item.tracking_code ? {
            code: item.tracking_code,
            url: item.tracking_url,
            carrier: item.carrier
        } : null,
        holdReason: item.hold_reason || null,
        estimatedDelivery: item.estimated_delivery || null,
        shipDate: item.ship_date || null
    };
}

// =============================================
// ATUALIZAR STATUS DO PEDIDO (FETCH DO FIRESTORE)
// =============================================

async function refreshOrderStatus(orderId, itemIndex) {
    const btn = document.querySelector(`[data-refresh="${orderId}"]`);
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
    }

    try {
        const response = await fetch(
            `https://us-central1-kauara1.cloudfunctions.net/getPrintfulOrderStatus?order_id=${orderId}`
        );
        const data = await response.json();

        if (!data.success) throw new Error(data.error || 'Falha ao buscar status');

        const pData = data.printful_data || {};
        const localStatus = data.local_status;
        const printfulStatus = data.printful_status;

        // Map Printful status → delivery_status
        const statusMap = {
            'draft':     'processing',
            'pending':   'processing',
            'onhold':    'on_hold',
            'inprocess': 'in_production',
            'partial':   'in_production',
            'fulfilled': 'shipped',
            'cancelled': 'cancelled',
            'failed':    'failed'
        };
        const deliveryStatus = statusMap[printfulStatus] || localStatus || 'processing';

        // FIX: full fallback chain for tracking — matches what the webhook saves
        const shipments = pData.shipments || [];
        const firstShipment = shipments[0] || {};

        const trackingCode = firstShipment.tracking_number || null;
        const trackingUrl  = firstShipment.tracking_url    || null;
        const carrier      = firstShipment.carrier         || null;
        const shipDate     = firstShipment.ship_date       || null;

        // FIX: same fallback chain as the webhook (max → min → plain)
        const estimatedDelivery =
            firstShipment.estimated_delivery_max ||
            firstShipment.estimated_delivery_min ||
            firstShipment.estimated_delivery     ||
            null;

        // Update localStorage
        let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
        let updated = false;

        purchasedItems = purchasedItems.map(item => {
            if (item.order_id !== orderId) return item;
            updated = true;
            return {
                ...item,
                delivery_status:       deliveryStatus,
                printful_order_status: printfulStatus,
                // Only overwrite tracking fields if Printful returned new data
                tracking_code:      trackingCode  || item.tracking_code      || null,
                tracking_url:       trackingUrl   || item.tracking_url       || null,
                carrier:            carrier       || item.carrier            || null,
                ship_date:          shipDate      || item.ship_date          || null,
                estimated_delivery: estimatedDelivery || item.estimated_delivery || null,
                last_refreshed: new Date().toISOString()
            };
        });

        if (updated) {
            localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
            renderCart();
            showToast('✅ Status atualizado!', 'success');
        } else {
            showToast('ℹ️ Nenhuma alteração encontrada', 'info');
        }

    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('❌ Não foi possível atualizar o status', 'error');
    } finally {
        // Always restore the button whether it succeeded or failed
        if (btn) {
            btn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Atualizar';
            btn.disabled = false;
        }
    }
}

// =============================================
// COMPRAR NOVAMENTE
// =============================================

function buyAgain(itemIndex) {
    const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    
    if (itemIndex < 0 || itemIndex >= purchasedItems.length) {
        showToast('Item não encontrado', 'error');
        return;
    }
    
    const item = purchasedItems[itemIndex];
    
    // Remover informações de compra
    const newCartItem = { ...item };
    delete newCartItem.purchased_at;
    delete newCartItem.order_id;
    delete newCartItem.payment_id;
    delete newCartItem.purchase_status;
    delete newCartItem.delivery_status;
    
    // Adicionar ao carrinho
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    cart.push(newCartItem);
    localStorage.setItem('cart', JSON.stringify(cart));
    
    showToast('✅ Produto adicionado ao carrinho novamente!', 'success');
    
    // Re-renderizar
    renderCart();
}

// =============================================
// VER DETALHES DA COMPRA
// =============================================

function viewPurchaseDetails(orderId, productId) {
    if (!orderId) {
        showToast('Detalhes da compra não disponíveis', 'info');
        return;
    }
    
    // Abrir modal com detalhes ou redirecionar
    window.location.href = `order-details.html?order_id=${orderId}&product_id=${productId}`;
}

// =============================================
// LIMPAR HISTÓRICO DE COMPRAS
// =============================================

function clearPurchaseHistory() {
    if (!confirm('Tem certeza que deseja limpar todo o histórico de compras?')) {
        return;
    }
    
    localStorage.removeItem('purchasedItems');
    renderCart();
    showToast('Histórico de compras limpo!', 'info');
}

// =============================================
// ATUALIZAR CONTADORES
// =============================================

function updateCartCounters(cartCount, purchasedCount) {
    // Header badge and active section badge
    const cartCountEl      = document.getElementById('cartCount');
    const activeCartCountEl = document.getElementById('activeCartCount');
    if (cartCountEl)       cartCountEl.textContent       = cartCount;
    if (activeCartCountEl) activeCartCountEl.textContent = cartCount;

    // Purchased section badge and sidebar summary count
    const purchasedCountEl      = document.getElementById('purchasedCount');
    const totalPurchasedCountEl = document.getElementById('totalPurchasedCount');
    if (purchasedCountEl)       purchasedCountEl.textContent      = purchasedCount;
    if (totalPurchasedCountEl)  totalPurchasedCountEl.textContent = purchasedCount;

    // Update sidebar purchase total value
    const purchaseSummary = document.getElementById('purchaseSummary');
    if (purchaseSummary) {
        purchaseSummary.style.display = purchasedCount > 0 ? 'block' : 'none';
        if (purchasedCount > 0) {
            const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
            let total = 0;
            purchasedItems.forEach(item => {
                if (item.pricing?.total_price) total += parseFloat(item.pricing.total_price);
                else if (item.selectedVariant?.price) total += parseFloat(item.selectedVariant.price);
            });
            const totalPurchasedValueEl = document.getElementById('totalPurchasedValue');
            if (totalPurchasedValueEl) totalPurchasedValueEl.textContent = formatCurrency(total);
        }
    }
}

// =============================================
// REMOVER DO CARRINHO
// =============================================

function removeFromCart(index) {
    if (!confirm('Tem certeza que deseja remover este item do carrinho?')) {
        return;
    }
    
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    cart.splice(index, 1);
    localStorage.setItem('cart', JSON.stringify(cart));
    
    renderCart();
    showToast('Item removido do carrinho!', 'warning');
}

// =============================================
// LIMPAR CARRINHO
// =============================================

function clearCart() {
    if (!confirm('Tem certeza que deseja esvaziar todo o carrinho?')) {
        return;
    }
    
    localStorage.removeItem('cart');
    renderCart();
    showToast('Carrinho esvaziado!', 'info');
}

// =============================================
// ATUALIZAR TOTAIS
// =============================================

function updateTotals(total) {
    const formatted = formatCurrency(total);
    const subtotalEl = document.getElementById('subtotalValue');
    const totalEl = document.getElementById('totalValue');
    
    if (subtotalEl) subtotalEl.textContent = formatted;
    if (totalEl) totalEl.textContent = formatted;
    
    const shippingSection = document.getElementById('shippingSection');
    if (shippingSection) {
        shippingSection.style.display = 'none';
    }
}

// =============================================
// CALCULAR TOTAL DO CARRINHO
// =============================================

function calculateCartTotal(cart) {
    let total = 0;
    cart.forEach(item => {
        if (item.pricing && item.pricing.total_price) {
            total += parseFloat(item.pricing.total_price);
        } else if (item.selectedVariant && item.selectedVariant.price) {
            total += parseFloat(item.selectedVariant.price);
        }
    });
    return total;
}

// =============================================
// FORMATAR MOEDA
// =============================================

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2
    }).format(value || 0);
}

// =============================================
// MOSTRAR TOAST
// =============================================

function showToast(message, type = 'info') {
    const toastId = 'cartToast_' + Date.now();
    const bgColor = type === 'success' ? 'success' : 
                    type === 'warning' ? 'warning' : 
                    type === 'error' ? 'danger' : 'info';
    
    const toastHtml = `
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 1060">
            <div id="${toastId}" class="toast align-items-center text-white bg-${bgColor} border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', toastHtml);
    
    const toastElement = document.getElementById(toastId);
    if (toastElement) {
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        
        setTimeout(() => {
            toastElement.remove();
        }, 3000);
    }
}

// =============================================
// CANCELAR COMPRA
// =============================================

function cancelPurchase(orderId, index) {
    if (!confirm('Tem certeza que deseja cancelar esta compra? Entre em contato com o suporte para reembolsos.')) return;

    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    purchasedItems = purchasedItems.filter((_, i) => i !== index);
    localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));

    renderCart();
    showToast('Compra removida do histórico. Contate o suporte para cancelamentos oficiais.', 'warning');
}

// =============================================
// SHOW LOADING OVERLAY
// =============================================

function showLoading(show) {
    const existingOverlay = document.getElementById('checkoutLoading');
    if (show) {
        if (existingOverlay) existingOverlay.remove();
        const overlay = document.createElement('div');
        overlay.id = 'checkoutLoading';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.9);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:9999;';
        overlay.innerHTML = `
            <div class="spinner-border text-primary" style="width:3rem;height:3rem;" role="status">
                <span class="visually-hidden">Carregando...</span>
            </div>
            <p class="text-primary fw-bold mt-3">Preparando para pagamento...</p>`;
        document.body.appendChild(overlay);
    } else {
        if (existingOverlay) existingOverlay.remove();
    }
}

// Exportar funções para o console (para debugging)
window.testMoveToPurchased = function() {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    if (cart.length === 0) {
        alert('Carrinho vazio');
        return;
    }
    
    moveCartToPurchased(cart, {
        order_id: 'TEST_' + Date.now(),
        payment_id: 'TEST_PAYMENT',
        date: new Date().toISOString()
    });
};