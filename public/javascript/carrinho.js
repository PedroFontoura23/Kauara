// carrinho.js
// Firestore é a fonte de verdade. localStorage é apenas cache offline.
// Fluxo: login → carrega do Firestore → onSnapshot mantém tudo sincronizado em tempo real.

// =============================================
// INICIALIZAÇÃO
// =============================================

document.addEventListener('DOMContentLoaded', function () {
    // Renderiza imediatamente com o cache local (evita tela em branco)
    renderCart();

    // Botão de limpar carrinho
    const clearCartBtn = document.getElementById('clearCartButton');
    if (clearCartBtn) clearCartBtn.addEventListener('click', clearCart);

    // Botão principal de pagamento (sidebar)
    const checkoutBtn = document.getElementById('checkoutButton');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkoutSelected);

    // Botão de limpar histórico de compras
    const clearHistoryBtn = document.getElementById('clearHistoryButton');
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearPurchaseHistory);

    // Botão de sincronização manual
    const syncBtn = document.getElementById('syncOrdersBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sincronizando...';
            try {
                await checkRecentlyApprovedOrders();
                showToast('Pedidos sincronizados com sucesso!', 'success');
            } catch (error) {
                showToast('Erro ao sincronizar: ' + error.message, 'error');
            } finally {
                syncBtn.disabled = false;
                syncBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Sincronizar Pedidos';
            }
        });
    }

    // Verifica se voltou de um pagamento
    checkForNewPurchases();

    // Auto-atualiza status de pedidos na carga
    autoRefreshAllOrderStatuses();

    // CORREÇÃO: Verificar se veio de uma página de sucesso
    const urlParams = new URLSearchParams(window.location.search);
    const forceRefresh = urlParams.get('refresh') === 'true';
    const pendingOrder = sessionStorage.getItem('pendingOrderCheck');
    
    if (forceRefresh || pendingOrder) {
        console.log('🔄 Forçando verificação de pedidos pendentes...');
        sessionStorage.removeItem('pendingOrderCheck');
        
        // Aguardar um pouco e forçar verificação
        setTimeout(async () => {
            await checkRecentlyApprovedOrders();
            // Remover parâmetro da URL sem recarregar
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }, 1000);
    }

    // Escuta mudanças de autenticação — inicia ou cancela o sync do Firestore.
    const auth = _auth();
    const db   = _db();
    if (auth && db) {
        auth.onAuthStateChanged(async user => {
            if (user) {
                try {
                    let firestoreUserId = sessionStorage.getItem('currentFirestoreUserId');
                    if (!firestoreUserId) {
                        const q = await db.collection('users').where('firebaseUID', '==', user.uid).get();
                        if (!q.empty) {
                            firestoreUserId = q.docs[0].id;
                            sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);
                        }
                    }
                    if (firestoreUserId) {
                        initFirestoreSync(firestoreUserId);
                    } else {
                        console.warn('Nao foi possivel resolver firestoreUserId para uid:', user.uid);
                    }
                } catch (e) {
                    console.error('Erro ao resolver firestoreUserId no onAuthStateChanged:', e);
                }
            } else {
                if (_cartUnsub)      { _cartUnsub();      _cartUnsub      = null; }
                if (_purchasedUnsub) { _purchasedUnsub(); _purchasedUnsub = null; }
                sessionStorage.removeItem('currentFirestoreUserId');
                sessionStorage.removeItem('lastFirestoreUserId');
                localStorage.removeItem('cart');
                localStorage.removeItem('purchasedItems');
                renderCart();
                console.log('Usuario deslogado — carrinho limpo');
            }
        });
    }
});

// =============================================
// HELPERS FIREBASE
// =============================================

function _db() {
    if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    return null;
}

function _auth() {
    if (typeof firebase !== 'undefined' && firebase.auth) return firebase.auth();
    return null;
}

async function getCurrentUserId() {
    const cached = sessionStorage.getItem('currentFirestoreUserId');
    if (cached) return cached;
    const auth = _auth();
    const db   = _db();
    if (!auth || !db) return null;
    const user = auth.currentUser;
    if (!user) return null;
    try {
        const q = await db.collection('users').where('firebaseUID', '==', user.uid).get();
        if (!q.empty) {
            const id = q.docs[0].id;
            sessionStorage.setItem('currentFirestoreUserId', id);
            return id;
        }
    } catch (e) {
        console.error('Erro ao buscar firestoreUserId:', e);
    }
    return null;
}

function _cartKey(item) {
    if (item.cartItemId) return item.cartItemId;
    if (item.firestoreProductId) return item.firestoreProductId;
    if (item.product_id) {
        const size  = item.selectedVariant?.size  || '';
        const color = item.selectedVariant?.color || '';
        return `${item.product_id}_${size}_${color}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
    }
    return JSON.stringify({ t: item.productTitle, v: item.selectedVariant })
        .replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

function _purchasedKey(item) {
    const orderId    = item.order_id    || 'no_order';
    const productId  = item.product_id  || item.firestoreProductId || item.productTitle || 'no_product';
    return `${orderId}_${productId}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

// =============================================
// FIRESTORE — FONTE DE VERDADE
// =============================================

let _cartUnsub      = null;
let _purchasedUnsub = null;

async function initFirestoreSync(firestoreUserId) {
    const uid = firestoreUserId;
    if (!uid) {
        console.log('ℹ️ Usuário não logado — carrinho local apenas');
        return;
    }
    const db = _db();
    if (!db) return;

    console.log('🔄 Iniciando sync Firestore para uid:', uid);
    const userRef = db.collection('users').doc(uid);

    const previousUid        = sessionStorage.getItem('lastFirestoreUserId');
    const isSameOrFreshSession = !previousUid || previousUid === firestoreUserId;
    const localCartBeforeSync  = JSON.parse(localStorage.getItem('cart') || '[]');

    if (localCartBeforeSync.length > 0 && isSameOrFreshSession) {
        console.log('⬆️ Enviando', localCartBeforeSync.length, 'item(ns) local(is) para o Firestore antes do sync...');
        const batch   = db.batch();
        const cartRef = userRef.collection('cart');
        localCartBeforeSync.forEach(item => {
            const key = _cartKey(item);
            batch.set(cartRef.doc(key), { ...item, _synced_at: new Date().toISOString() }, { merge: true });
        });
        await batch.commit();
        console.log('✅ Itens locais enviados para o Firestore');
    } else if (localCartBeforeSync.length > 0 && !isSameOrFreshSession) {
        localStorage.removeItem('cart');
        localStorage.removeItem('purchasedItems');
        console.log('🔄 Troca de conta detectada — cache local da conta anterior descartado');
    }

    sessionStorage.setItem('lastFirestoreUserId', firestoreUserId);

    if (_cartUnsub) _cartUnsub();
    _cartUnsub = userRef.collection('cart').onSnapshot(snap => {
        const cart = snap.docs.map(d => d.data());
        localStorage.setItem('cart', JSON.stringify(cart));
        renderCart();
        console.log('🛒 Carrinho atualizado do Firestore:', cart.length, 'itens');
    }, err => {
        console.warn('⚠️ Erro no listener do carrinho:', err.message);
    });

    if (_purchasedUnsub) _purchasedUnsub();
    _purchasedUnsub = userRef.collection('purchasedItems').onSnapshot(snap => {
        const purchased = snap.docs.map(d => d.data());
        localStorage.setItem('purchasedItems', JSON.stringify(purchased));
        renderCart();
        console.log('📦 Compras atualizadas do Firestore:', purchased.length, 'itens');
    }, err => {
        console.warn('⚠️ Erro no listener de compras:', err.message);
    });

    await _syncPurchasedFromBackend();
}

function _sanitize(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, _sanitize(v)])
    );
}

// =============================================
// ESCRITA NO FIRESTORE
// =============================================

async function saveCartToFirestore(cart) {
    try {
        const uid = await getCurrentUserId();
        if (!uid) return;
        const db = _db();
        if (!db) return;

        const cartRef = db.collection('users').doc(uid).collection('cart');
        const snapshot = await cartRef.get();
        const batch = db.batch();

        snapshot.forEach(doc => batch.delete(doc.ref));

        cart.forEach(item => {
            const key = _cartKey(item);
            batch.set(cartRef.doc(key), { ..._sanitize(item), _synced_at: new Date().toISOString() });
        });

        await batch.commit();
        console.log(`✅ Carrinho salvo no Firestore (${cart.length} itens)`);
    } catch (err) {
        console.warn('⚠️ Erro ao salvar carrinho no Firestore:', err.message);
    }
}

async function savePurchasedToFirestore(purchasedItems) {
    try {
        const uid = await getCurrentUserId();
        if (!uid) return;
        const db = _db();
        if (!db) return;

        const ref   = db.collection('users').doc(uid).collection('purchasedItems');
        const batch = db.batch();

        purchasedItems.forEach(item => {
            const key = _purchasedKey(item);
            batch.set(ref.doc(key), { ..._sanitize(item), _synced_at: new Date().toISOString() }, { merge: true });
        });

        await batch.commit();
        console.log(`✅ Compras salvas no Firestore (${purchasedItems.length} itens)`);
    } catch (err) {
        console.warn('⚠️ Erro ao salvar compras no Firestore:', err.message);
    }
}

// =============================================
// SINCRONIZAR COMPRAS DO BACKEND
// =============================================

async function _syncPurchasedFromBackend() {
    try {
        const uid = await getCurrentUserId();
        if (!uid) {
            console.log('ℹ️ Usuário não logado — não é possível sincronizar compras');
            return;
        }

        console.log('🔄 Sincronizando compras do backend para user_id:', uid);

        let response;
        try {
            response = await fetch(
                `https://us-central1-kauara1.cloudfunctions.net/getUserOrdersByUserId?user_id=${uid}&limit=100`
            );
        } catch (fetchErr) {
            console.warn('⚠️ Não foi possível contatar o backend (offline?):', fetchErr.message);
            return;
        }

        if (!response.ok) {
            console.warn(`⚠️ Backend retornou ${response.status} para getUserOrdersByUserId — sincronização ignorada`);
            return;
        }

        const data = await response.json();

        const approvedOrders = (data.orders || []).filter(o =>
            o.status === 'approved' || o.payment_status === 'approved'
        );

        if (!data.success || approvedOrders.length === 0) {
            console.log('ℹ️ Nenhum pedido aprovado encontrado no backend para este usuário');
            return;
        }

        console.log(`📦 Encontrados ${approvedOrders.length} pedido(s) aprovado(s) no backend`);

        const purchasedFromBackend = [];

        approvedOrders.forEach(order => {
            if (order.products && order.products.length > 0) {
                order.products.forEach(product => {
                    purchasedFromBackend.push({
                        product_id: product.product_id,
                        productTitle: product.title,
                        designerName: product.designer_name,
                        designer_id: product.designer_id,
                        order_id: order.id,
                        order_status: order.order_status,
                        payment_status: order.status,
                        purchased_at: order.created_at,
                        delivery_status: order.order_status,
                        selectedVariant: product.selectedVariant || null,
                        thumbnail: product.thumbnail || null,
                        thumbnailUrl: product.thumbnailUrl || null,
                        pricing: product.pricing || null,
                        synced_from_backend: true,
                        synced_at: new Date().toISOString()
                    });
                });
            }
        });

        if (purchasedFromBackend.length > 0) {
            let existingItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
            const existingMap = new Map();
            existingItems.forEach(item => {
                const key = `${item.order_id}_${item.product_id}`;
                existingMap.set(key, item);
            });

            purchasedFromBackend.forEach(newItem => {
                const key = `${newItem.order_id}_${newItem.product_id}`;
                if (!existingMap.has(key)) {
                    existingItems.push(newItem);
                }
            });

            localStorage.setItem('purchasedItems', JSON.stringify(existingItems));
            await savePurchasedToFirestore(existingItems);
            console.log(`✅ Sincronizados ${purchasedFromBackend.length} itens aprovados do backend`);
            renderCart();
        }
    } catch (error) {
        console.warn('⚠️ Sync de compras do backend falhou (não crítico):', error.message);
    }
}

// =============================================
// VERIFICAR NOVAS COMPRAS APÓS PAGAMENTO - CORRIGIDO
// =============================================

async function checkForNewPurchases() {
    const lastPayment = sessionStorage.getItem('lastPayment');
    
    if (lastPayment) {
        try {
            const paymentInfo = JSON.parse(lastPayment);
            console.log('💰 Verificando pagamento pendente:', paymentInfo.external_reference);
            if (paymentInfo.external_reference) {
                await checkPaymentStatus(paymentInfo.external_reference);
                return;
            }
        } catch (error) {
            console.error('Erro ao processar último pagamento:', error);
        }
    }
    
    await checkRecentlyApprovedOrders();
}

async function checkRecentlyApprovedOrders() {
    try {
        const uid = await getCurrentUserId();
        if (!uid) {
            console.log('ℹ️ Usuário não logado, não é possível verificar pedidos');
            return;
        }
        
        console.log('🔍 Verificando pedidos recentes aprovados para usuário:', uid);
        
        const response = await fetch(
            `https://us-central1-kauara1.cloudfunctions.net/getUserOrdersByUserId?user_id=${uid}&limit=50`
        );
        
        if (!response.ok) {
            console.warn('⚠️ Não foi possível buscar pedidos recentes:', response.status);
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.orders || data.orders.length === 0) {
            console.log('ℹ️ Nenhum pedido encontrado');
            return;
        }
        
        // Buscar orders aprovadas das últimas 48 horas
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const approvedOrders = data.orders.filter(order => {
            const isApproved = order.status === 'approved' || order.payment_status === 'approved';
            const orderDate = order.created_at ? new Date(order.created_at) : null;
            const isRecent = orderDate && orderDate > twoDaysAgo;
            return isApproved && isRecent;
        });
        
        if (approvedOrders.length === 0) {
            console.log('ℹ️ Nenhum pedido recente aprovado encontrado');
            return;
        }
        
        console.log(`✅ Encontrados ${approvedOrders.length} pedido(s) aprovado(s) recentemente`);
        
        let cart = JSON.parse(localStorage.getItem('cart') || '[]');
        let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
        let cartChanged = false;
        let purchasedChanged = false;
        
        for (const order of approvedOrders) {
            // Verificar se já foi processado
            const alreadyProcessed = purchasedItems.some(item => item.order_id === order.id);
            if (alreadyProcessed) {
                console.log(`⏭️ Pedido ${order.id} já foi processado anteriormente`);
                continue;
            }
            
            // Buscar detalhes do pedido
            const orderDetailsResponse = await fetch(
                `https://us-central1-kauara1.cloudfunctions.net/getOrderDetails?order_id=${order.id}`
            );
            
            if (!orderDetailsResponse.ok) {
                console.warn(`⚠️ Não foi possível buscar detalhes do pedido ${order.id}`);
                continue;
            }
            
            const orderDetails = await orderDetailsResponse.json();
            
            if (!orderDetails.success || !orderDetails.order) {
                console.warn(`⚠️ Detalhes do pedido ${order.id} inválidos`);
                continue;
            }
            
            const fullOrder = orderDetails.order;
            const productsInOrder = fullOrder.cart_products || [];
            
            if (productsInOrder.length === 0) {
                console.warn(`⚠️ Pedido ${order.id} não tem produtos`);
                continue;
            }
            
            // CORREÇÃO: Criar um Set com IDs flexíveis para comparação
            const productKeysInOrder = new Set();
            productsInOrder.forEach(p => {
                const productId = p.product_id || p.id;
                const title = (p.title || p.productTitle || '').toLowerCase().trim();
                const sku = p.dimona_sku || p.sku;
                
                if (productId) productKeysInOrder.add(productId);
                if (title) productKeysInOrder.add(title);
                if (sku) productKeysInOrder.add(sku);
            });
            
            console.log('🔑 Chaves do pedido para comparação:', Array.from(productKeysInOrder));
            
            // Filtrar itens do carrinho que foram comprados
            const remainingCart = cart.filter(item => {
                const itemProductId = item.product_id || item.firestoreProductId || item.id;
                const itemTitle = (item.productTitle || item.title || '').toLowerCase().trim();
                const itemSku = item.selectedVariant?.dimona_sku || item.dimona_sku;
                
                const isPurchased = productKeysInOrder.has(itemProductId) ||
                                   productKeysInOrder.has(itemTitle) ||
                                   (itemSku && productKeysInOrder.has(itemSku));
                
                if (isPurchased) {
                    console.log(`✅ Removendo do carrinho: ${item.productTitle || item.title} (ID: ${itemProductId})`);
                    cartChanged = true;
                    return false;
                }
                return true;
            });
            
            // Adicionar aos itens comprados
            for (const product of productsInOrder) {
                const productId = product.product_id || product.id;
                const existingKey = `${order.id}_${productId}`;
                const alreadyExists = purchasedItems.some(
                    item => `${item.order_id}_${item.product_id}` === existingKey
                );
                
                if (!alreadyExists) {
                    // CORREÇÃO: Mapear os dados do produto corretamente
                    const purchasedItem = {
                        // Dados básicos
                        product_id: productId,
                        productTitle: product.title || product.productTitle || 'Produto',
                        designerName: product.designer_name || product.designerName || 'Designer',
                        designer_id: product.designer_id || product.designerUserId || null,
                        
                        // Dados do pedido
                        order_id: order.id,
                        payment_id: fullOrder.payment_id,
                        purchased_at: fullOrder.approved_at || fullOrder.date_approved || new Date().toISOString(),
                        purchase_date: new Date().toISOString(),
                        
                        // Status
                        purchase_status: 'completed',
                        delivery_status: fullOrder.dimona_order_status || 'processing',
                        payment_status: fullOrder.payment_status || 'approved',
                        
                        // Variante (se disponível)
                        selectedVariant: product.selectedVariant || {
                            color: product.color || 'N/A',
                            size: product.size || 'Único',
                            price: product.price || product.pricing?.total_price || 0
                        },
                        
                        // Imagem
                        thumbnail: product.thumbnail || product.thumbnailUrl || product.thumbnailUrls?.front || null,
                        thumbnailUrl: product.thumbnailUrl || product.thumbnail || product.thumbnailUrls?.front || null,
                        
                        // Preço
                        pricing: product.pricing || {
                            total_price: product.price || product.unit_price || 0,
                            product_price: product.product_price || product.price || 0,
                            artist_cut: product.artist_cut || 0,
                            platform_fee: product.platform_fee || 0
                        },
                        
                        // Metadados
                        synced_from_backend: true,
                        synced_at: new Date().toISOString(),
                        moved_from_cart: true,
                        moved_at: new Date().toISOString()
                    };
                    
                    purchasedItems.push(purchasedItem);
                    purchasedChanged = true;
                    console.log(`✅ Adicionado aos comprados: ${purchasedItem.productTitle}`);
                }
            }
            
            cart = remainingCart;
        }
        
        if (cartChanged) {
            localStorage.setItem('cart', JSON.stringify(cart));
            await saveCartToFirestore(cart);
            console.log(`🛒 Carrinho atualizado: ${cart.length} itens restantes`);
        }
        
        if (purchasedChanged) {
            // Remover duplicatas antes de salvar
            const uniquePurchased = [];
            const seen = new Set();
            for (const item of purchasedItems) {
                const key = `${item.order_id}_${item.product_id}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniquePurchased.push(item);
                }
            }
            
            localStorage.setItem('purchasedItems', JSON.stringify(uniquePurchased));
            await savePurchasedToFirestore(uniquePurchased);
            console.log(`📦 Itens comprados atualizados: ${uniquePurchased.length} itens`);
            
            showToast(`🎉 ${approvedOrders.length} pedido(s) confirmado(s)! Seus produtos foram movidos para "Itens Comprados"`, 'success');
        }
        
        if (cartChanged || purchasedChanged) {
            renderCart();
        }
        
        // Limpar sessionStorage
        sessionStorage.removeItem('lastPayment');
        sessionStorage.removeItem('cartIndicesToRemove');
        sessionStorage.removeItem('cartToPay');
        sessionStorage.removeItem('selectedProduct');
        
    } catch (error) {
        console.error('❌ Erro ao verificar pedidos recentes:', error);
    }
}

async function checkPaymentStatus(externalReference) {
    try {
        console.log('🔍 [carrinho.js] Verificando status do pagamento:', externalReference);
        
        // Aguarda um tempo inicial para o webhook processar no backend
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const response = await fetch(
            `https://us-central1-kauara1.cloudfunctions.net/getPaymentStatus?external_reference=${externalReference}`
        );
        
        if (!response.ok) {
            console.warn(`⚠️ Erro ao consultar status (${response.status}). Tentando sync geral...`);
            await checkRecentlyApprovedOrders();
            return;
        }

        const data = await response.json();
        console.log('📊 Resposta do status:', data);
        
        if (data.success && data.payment) {
            const status = data.payment.status;
            
            if (status === 'approved') {
                console.log('✅ Pagamento aprovado! Sincronizando produtos...');
                
                // Tentativa de obter detalhes específicos para mover itens exatos
                const orderResponse = await fetch(
                    `https://us-central1-kauara1.cloudfunctions.net/getOrderDetails?order_id=${externalReference}`
                );
                const orderData = await orderResponse.json();
                
                if (orderData.success && orderData.order) {
                    // Se encontrou os detalhes, move especificamente estes produtos
                    await moveCartToPurchased(orderData.order.cart_products, {
                        order_id: externalReference,
                        payment_id: data.payment.payment_details?.id || 'N/A',
                        date: new Date().toISOString()
                    });
                } else {
                    // FALLBACK: Se o detalhe falhar, rodamos a verificação geral por UID
                    // Isso evita que o usuário veja a mensagem de erro se o pedido já existir no banco
                    console.log('🔄 Detalhes específicos não encontrados. Iniciando sincronização geral...');
                    await checkRecentlyApprovedOrders();
                }
                
                // Limpeza de segurança da sessão
                sessionStorage.removeItem('lastPayment');
                sessionStorage.removeItem('cartToPay');
                sessionStorage.removeItem('selectedProduct');
                
                renderCart();
                
            } else if (status === 'pending' || status === 'in_process') {
                console.log('⏳ Pagamento pendente. Verificando novamente em 6s...');
                setTimeout(() => checkPaymentStatus(externalReference), 6000);
                
            } else if (status === 'rejected' || status === 'cancelled') {
                console.log('❌ Pagamento não aprovado — preservando carrinho');
                sessionStorage.removeItem('lastPayment');
                showToast('O pagamento não foi aprovado. Seus itens continuam no carrinho.', 'warning');
            }
        }
    } catch (error) {
        console.error('❌ Erro crítico em checkPaymentStatus:', error);
        // Em caso de erro de rede, tenta o sync geral por segurança
        await checkRecentlyApprovedOrders();
    }
}

// =============================================
// MOVER CARRINHO → COMPRADOS - CORRIGIDO
// =============================================

async function moveCartToPurchased(cartProducts, purchaseInfo) {
    console.log('📦 Movendo produtos para itens comprados:', cartProducts);
    console.log('📦 Purchase info:', purchaseInfo);

    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');

    // CORREÇÃO: Comparação mais flexível
    const purchasedIdentifiers = new Set();
    cartProducts.forEach(p => {
        const id = p.product_id || p.id;
        const title = (p.title || p.productTitle || '').toLowerCase().trim();
        const sku = p.dimona_sku || p.sku;
        
        if (id) purchasedIdentifiers.add(id);
        if (title) purchasedIdentifiers.add(title);
        if (sku) purchasedIdentifiers.add(sku);
    });

    console.log('🔍 Identificadores dos produtos comprados:', Array.from(purchasedIdentifiers));

    const remainingCart = cart.filter(item => {
        const itemId = item.product_id || item.firestoreProductId || item.id;
        const itemTitle = (item.productTitle || item.title || '').toLowerCase().trim();
        const itemSku = item.selectedVariant?.dimona_sku || item.dimona_sku;
        
        const shouldRemove = purchasedIdentifiers.has(itemId) ||
                            purchasedIdentifiers.has(itemTitle) ||
                            (itemSku && purchasedIdentifiers.has(itemSku));
        
        if (shouldRemove) {
            console.log('✅ Removendo do carrinho:', item.productTitle || item.title);
            return false;
        }
        return true;
    });

    // Criar novos itens comprados
    const newlyPurchased = [];
    for (const item of cart) {
        const itemId = item.product_id || item.firestoreProductId || item.id;
        const itemTitle = (item.productTitle || item.title || '').toLowerCase().trim();
        const itemSku = item.selectedVariant?.dimona_sku || item.dimona_sku;
        
        const shouldMove = purchasedIdentifiers.has(itemId) ||
                          purchasedIdentifiers.has(itemTitle) ||
                          (itemSku && purchasedIdentifiers.has(itemSku));
        
        if (shouldMove) {
            const orderProduct = cartProducts.find(p => 
                (p.product_id || p.id) === itemId ||
                (p.title || p.productTitle || '').toLowerCase().trim() === itemTitle ||
                (p.dimona_sku || p.sku) === itemSku
            );
            
            const finalPricing = orderProduct?.pricing || item.pricing;
            
            newlyPurchased.push({
                ...item,
                pricing: finalPricing,
                purchased_at: purchaseInfo.date || new Date().toISOString(),
                order_id: purchaseInfo.order_id,
                payment_id: purchaseInfo.payment_id,
                purchase_status: 'completed',
                delivery_status: 'processing',
                purchase_date: new Date().toISOString(),
                designer_id: item.designerUserId || item.designer_id || null,
                moved_from_cart: true,
                moved_at: new Date().toISOString()
            });
        }
    }

    // Remover duplicatas nos itens comprados existentes
    const existingKeys = new Set();
    purchasedItems.forEach(item => {
        existingKeys.add(`${item.order_id}_${item.product_id}`);
    });

    const uniqueNewPurchased = newlyPurchased.filter(item => {
        const key = `${item.order_id}_${item.product_id}`;
        return !existingKeys.has(key);
    });

    const updatedPurchasedItems = [...uniqueNewPurchased, ...purchasedItems];

    localStorage.setItem('cart', JSON.stringify(remainingCart));
    localStorage.setItem('purchasedItems', JSON.stringify(updatedPurchasedItems));

    await saveCartToFirestore(remainingCart);
    await savePurchasedToFirestore(updatedPurchasedItems);

    console.log(`✅ ${uniqueNewPurchased.length} produto(s) movido(s) para comprados. Carrinho agora: ${remainingCart.length} itens`);
    
    if (uniqueNewPurchased.length > 0) {
        showToast(`🎉 ${uniqueNewPurchased.length} produto(s) movido(s) para "Itens Comprados"`, 'success');
    }
    
    renderCart();
    
    return uniqueNewPurchased;
}

async function movePendingToPurchased(purchases) {
    console.log('📦 Movendo compras pendentes:', purchases);

    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');

    purchases.forEach(purchase => {
        const exists = purchasedItems.some(item =>
            item.order_id  === purchase.order_id &&
            item.product_id === purchase.product_id
        );
        if (!exists) {
            purchasedItems.push({
                ...purchase,
                purchase_status: 'completed',
                delivery_status: 'processing',
                moved_at:        new Date().toISOString()
            });
        }
    });

    localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
    await savePurchasedToFirestore(purchasedItems);

    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const remainingCart = cart.filter(item =>
        !purchases.some(p => p.product_id === (item.product_id || item.id))
    );

    localStorage.setItem('cart', JSON.stringify(remainingCart));
    await saveCartToFirestore(remainingCart);

    renderCart();
}

// =============================================
// RENDERIZAR CARRINHO
// =============================================

function renderCart() {
    const cartList       = document.getElementById('cartList');
    const purchasedList  = document.getElementById('purchasedList');
    const checkoutBtn    = document.getElementById('checkoutButton');
    const clearCartBtn   = document.getElementById('clearCartButton');
    const clearHistoryBtn = document.getElementById('clearHistoryButton');
    const purchasedSection = document.getElementById('purchasedSection');

    const cart           = JSON.parse(localStorage.getItem('cart')           || '[]');
    const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');

    updateCartCounters(cart.length, purchasedItems.length);

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
            checkoutBtn.disabled = true;
            checkoutBtn.innerHTML = '<i class="fas fa-credit-card me-2"></i>Selecione itens para comprar';
        }
        if (clearCartBtn) clearCartBtn.disabled = false;
        renderActiveCart(cart, cartList);
    }

    if (purchasedItems.length === 0) {
        if (purchasedSection) purchasedSection.style.display = 'none';
    } else {
        if (purchasedSection) purchasedSection.style.display = 'block';
        if (clearHistoryBtn) clearHistoryBtn.disabled = false;
        renderPurchasedItems(purchasedItems, purchasedList);
    }

    updateTotals(calculateCartTotal(cart));
}

function renderActiveCart(cart, container) {
    if (!container) return;

    let html = `
        <div class="d-flex align-items-center gap-2 mb-3 px-1">
            <input type="checkbox" id="selectAllItems" class="form-check-input mt-0"
                   style="width:18px;height:18px;cursor:pointer;">
            <label for="selectAllItems" class="mb-0 text-muted" style="cursor:pointer;">
                Selecionar todos
            </label>
            <span class="ms-auto text-muted small" id="selectionSummary"></span>
        </div>`;

    cart.forEach((item, index) => {
        let itemPrice = 0;
        if (item.pricing?.total_price)      itemPrice = parseFloat(item.pricing.total_price);
        else if (item.selectedVariant?.price) itemPrice = parseFloat(item.selectedVariant.price);

        const backgroundColor = item.selectedVariant?.color_code ||
                                 item.selectedVariant?.colorCode  || '#f8f9fa';

        html += createCartItemHtml(item, index, itemPrice, false, backgroundColor);
    });

    container.innerHTML = html;

    const selectAll = container.querySelector('#selectAllItems');
    if (selectAll) {
        selectAll.addEventListener('change', function() {
            container.querySelectorAll('.cart-item-checkbox').forEach(cb => { cb.checked = this.checked; });
            updateSelectionTotal();
        });
    }

    container.querySelectorAll('.cart-item-checkbox').forEach(cb => {
        cb.addEventListener('change', function() {
            const allCbs = container.querySelectorAll('.cart-item-checkbox');
            const allChecked = Array.from(allCbs).every(c => c.checked);
            if (selectAll) selectAll.checked = allChecked;
            updateSelectionTotal();
        });
    });

    container.querySelectorAll('[data-action="removeFromCart"]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            removeFromCart(parseInt(this.dataset.index));
        });
    });
}

function updateSelectionTotal() {
    const cart     = JSON.parse(localStorage.getItem('cart') || '[]');
    const checked  = document.querySelectorAll('.cart-item-checkbox:checked');
    const checkoutBtn = document.getElementById('checkoutButton');
    const summaryEl   = document.getElementById('selectionSummary');

    let total = 0;
    checked.forEach(cb => {
        const item = cart[parseInt(cb.dataset.index)];
        if (item) {
            if (item.pricing?.total_price)      total += parseFloat(item.pricing.total_price);
            else if (item.selectedVariant?.price) total += parseFloat(item.selectedVariant.price);
        }
    });

    const hasSelection = checked.length > 0;

    if (checkoutBtn) {
        checkoutBtn.disabled = !hasSelection;
        checkoutBtn.innerHTML = hasSelection
            ? `<i class="fas fa-credit-card me-2"></i>Ir para Pagamentos (${checked.length}) · ${formatCurrency(total)}`
            : `<i class="fas fa-credit-card me-2"></i>Selecione itens para comprar`;
    }

    if (summaryEl) {
        summaryEl.textContent = hasSelection
            ? `${checked.length} selecionado(s) · ${formatCurrency(total)}`
            : '';
    }

    updateTotals(calculateCartTotal(cart));
}

function checkoutSelected() {
    const cart    = JSON.parse(localStorage.getItem('cart') || '[]');
    const checked = document.querySelectorAll('.cart-item-checkbox:checked');

    if (checked.length === 0) { alert('Selecione ao menos um produto.'); return; }

    const selectedItems = [];
    checked.forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        if (cart[idx]) selectedItems.push(cart[idx]);
    });

    let total = 0;
    for (const item of selectedItems) {
        if (!item.pricing || !item.pricing.total_price) {
            alert('Produto "' + (item.productTitle || 'desconhecido') + '" sem preço. Remova-o do carrinho e adicione novamente.');
            showLoading(false);
            return;
        }
        total += parseFloat(item.pricing.total_price);
    }

    sessionStorage.setItem('cartToPay',     JSON.stringify(selectedItems));
    sessionStorage.setItem('selectedProduct', JSON.stringify({
        type:        'multi_product_cart',
        products:    selectedItems,
        total_price: total
    }));

    const selectedIndices = Array.from(checked).map(cb => parseInt(cb.dataset.index));
    sessionStorage.setItem('cartIndicesToRemove', JSON.stringify(selectedIndices));

    showLoading(true);
    setTimeout(() => { window.location.href = 'pagamentos.html'; }, 500);
}

function renderPurchasedItems(items, container) {
    if (!container) return;

    container.innerHTML = '';

    const sortedItems = [...items].sort((a, b) => {
        return new Date(b.purchased_at || b.created_at || 0) -
               new Date(a.purchased_at || a.created_at || 0);
    });

    sortedItems.forEach((item, index) => {
        let itemPrice = 0;
        if (item.pricing?.total_price)      itemPrice = parseFloat(item.pricing.total_price);
        else if (item.selectedVariant?.price) itemPrice = parseFloat(item.selectedVariant.price);

        const backgroundColor = item.selectedVariant?.color_code ||
                                 item.selectedVariant?.colorCode  || '#f8f9fa';

        const purchaseDate   = item.purchased_at || item.created_at;
        const formattedDate  = purchaseDate
            ? new Date(purchaseDate).toLocaleDateString('pt-BR')
            : 'Data desconhecida';

        const deliveryStatus = getDeliveryStatus(item);
        container.innerHTML += createPurchasedItemHtml(item, index, itemPrice, formattedDate, deliveryStatus, backgroundColor);
    });
}

function createCartItemHtml(item, index, price, isPurchased = false, backgroundColor = '#f8f9fa') {
    const isClientProduct = !!item.originalArtId;
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
                               style="width:20px;height:20px;cursor:pointer;">
                    </div>` : ''}
                    <div class="col-auto">
                        <div class="product-image-container"
                             style="background-color: ${backgroundColor}; border-radius: 8px; line-height: 0; display: inline-block;">
                            <img src="${item.thumbnailUrl || item.thumbnail || 'default-product.png'}"
                                 class="img-fluid rounded cart-item-img"
                                 alt="${item.productTitle || ''}"
                                 style="max-width: 100px; max-height: 100px; width: auto; height: auto; object-fit: contain; display: block;"
                                 data-fallback-src="../public/images/default-product.png">
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
                                    data-action="removeFromCart"
                                    data-index="${index}"
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

function createPurchasedItemHtml(item, index, price, purchaseDate, deliveryStatus, backgroundColor = '#f8f9fa') {
    const { status, icon, label, color, description, tracking, holdReason, estimatedDelivery } = deliveryStatus;

    const steps = [
        { key: 'processing',    icon: 'fa-clock',        text: 'Pedido Recebido' },
        { key: 'in_production', icon: 'fa-print',        text: 'Em Produção'     },
        { key: 'shipped',       icon: 'fa-truck',        text: 'Enviado'         },
        { key: 'delivered',     icon: 'fa-check-circle', text: 'Entregue'        }
    ];
    const stepOrder         = ['processing', 'in_production', 'shipped', 'delivered'];
    const currentStepIndex  = stepOrder.indexOf(status);
    const showProgress      = !['cancelled', 'failed', 'returned'].includes(status);

    const progressHtml = showProgress ? `
        <div class="d-flex align-items-center justify-content-between mt-3 mb-1 progress-steps">
            ${steps.map((step, i) => {
                const stepIdx  = stepOrder.indexOf(step.key);
                const isDone   = currentStepIndex > stepIdx;
                const isActive = currentStepIndex === stepIdx;
                const stepColor = isDone ? 'success' : isActive ? color : 'secondary';
                return `
                <div class="text-center flex-fill">
                    <div class="rounded-circle d-inline-flex align-items-center justify-content-center mb-1"
                         style="width:28px;height:28px;background:${isDone || isActive ? `var(--bs-${stepColor})` : '#dee2e6'};color:white;font-size:12px;">
                        <i class="fas ${isDone ? 'fa-check' : step.icon}"></i>
                    </div>
                    <div class="small" style="font-size:10px;color:${isDone || isActive ? `var(--bs-${stepColor})` : '#adb5bd'}">
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
                : `<span class="ms-1">${tracking.code}</span>`}
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
                                    <i class="fas fa-receipt me-1"></i>Pedido: ${item.order_id}
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
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// =============================================
// AUTO-ATUALIZAR STATUS DE PEDIDOS
// =============================================

async function autoRefreshAllOrderStatuses() {
    const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    if (purchasedItems.length === 0) return;

    const orderIds = [...new Set(
        purchasedItems
            .filter(item => {
                if (!item.order_id) return false;
                if (item.delivery_status === 'delivered') return false;
                if (item.order_id.startsWith('TEST_')) return false;
                if (item.order_id.startsWith('ORDER_')) return false;
                if (item.order_id.startsWith('KAUARA-')) return false;
                if (!/^\d+$/.test(item.order_id) && !item.dimona_order_id) return false;
                return true;
            })
            .map(item => item.dimona_order_id || item.order_id)
    )];
    if (orderIds.length === 0) return;

    console.log(`🔄 Auto-atualizando ${orderIds.length} pedido(s)...`);

    let changed      = false;
    let updatedItems = [...purchasedItems];

    await Promise.all(orderIds.map(async orderId => {
        try {
            const response = await fetch(
                `https://us-central1-kauara1.cloudfunctions.net/getDimonaOrderStatus?order_id=${orderId}`
            );
            if (response.status === 404) return;
            if (!response.ok) return;
            const data = await response.json();
            if (!data.success) return;

            updatedItems = updatedItems.map(item => {
                if (item.order_id !== orderId) return item;
                const newStatus = data.local_status || 'processing';
                const newRaw    = data.dimona_status || null;
                if (item.delivery_status === newStatus && item.dimona_raw_status === newRaw) return item;
                changed = true;
                return {
                    ...item,
                    delivery_status:    newStatus,
                    dimona_raw_status:  newRaw                       || item.dimona_raw_status  || null,
                    tracking_code:      data.tracking_code           || item.tracking_code      || null,
                    tracking_url:       data.tracking_url            || item.tracking_url       || null,
                    carrier:            data.carrier                 || item.carrier            || null,
                    estimated_delivery: data.estimated_delivery      || item.estimated_delivery || null,
                    last_refreshed:     new Date().toISOString()
                };
            });
        } catch (err) {
            console.warn(`⚠️ Auto-refresh falhou para pedido ${orderId}:`, err.message);
        }
    }));

    if (changed) {
        localStorage.setItem('purchasedItems', JSON.stringify(updatedItems));
        await savePurchasedToFirestore(updatedItems);
        renderCart();
        console.log('✅ Status dos pedidos atualizados');
    }
}

function getDeliveryStatus(item) {
    const rawFromDimona = item.dimona_raw_status ? item.dimona_raw_status.toLowerCase() : null;
    const status = rawFromDimona || item.delivery_status || item.shipping_status || item.order_status || 'processing';

    const statusConfig = {
        'processing':    { icon: 'fa-clock',          label: 'Processando',  color: 'info',    description: 'Pagamento aprovado, pedido em fila' },
        'in_production': { icon: 'fa-print',           label: 'Em Produção',  color: 'warning', description: 'Seu produto está sendo impresso e embalado' },
        'shipped':       { icon: 'fa-truck',           label: 'Enviado',      color: 'primary', description: 'Produto a caminho!' },
        'delivered':     { icon: 'fa-check-circle',    label: 'Entregue',     color: 'success', description: 'Produto entregue com sucesso!' },
        'failed':        { icon: 'fa-exclamation-circle', label: 'Falhou',    color: 'danger',  description: 'Problema na produção — entre em contato' },
        'cancelled':     { icon: 'fa-times-circle',    label: 'Cancelado',    color: 'danger',  description: 'Pedido cancelado' }
    };

    const normalizeMap = {
        'dimona_processing':      'in_production',
        'dimona_failed':          'failed',
        'preparando aprovado':    'in_production',
        'preparando envio':       'in_production',
        'faturado':               'in_production',
        'em produção':            'in_production',
        'pronto para envio':      'in_production',
        'enviado':                'shipped',
        'em trânsito':            'shipped',
        'entregue':               'delivered',
        'cancelado':              'cancelled',
        'pagamento não aprovado': 'failed',
        'pending':                'processing',
        'completed':              'delivered'
    };

    const normalized = normalizeMap[status.toLowerCase()] || normalizeMap[status] || status;
    const config     = statusConfig[normalized] || statusConfig['processing'];

    return {
        status:           normalized,
        icon:             config.icon,
        label:            config.label,
        color:            config.color,
        description:      config.description,
        tracking:         item.tracking_code ? { code: item.tracking_code, url: item.tracking_url, carrier: item.carrier } : null,
        estimatedDelivery: item.estimated_delivery || null,
        shipDate:         item.ship_date || null
    };
}

async function refreshOrderStatus(orderId, itemIndex) {
    const btn = document.querySelector(`[data-refresh="${orderId}"]`);
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; }

    try {
        const response = await fetch(
            `https://us-central1-kauara1.cloudfunctions.net/getDimonaOrderStatus?order_id=${orderId}`
        );
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Falha ao buscar status');

        let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
        let updated        = false;

        purchasedItems = purchasedItems.map(item => {
            if (item.order_id !== orderId) return item;
            updated = true;
            return {
                ...item,
                delivery_status:    data.local_status        || 'processing',
                dimona_raw_status:  data.dimona_status        || item.dimona_raw_status || null,
                tracking_code:      data.tracking_code        || item.tracking_code     || null,
                tracking_url:       data.tracking_url         || item.tracking_url      || null,
                carrier:            data.carrier              || item.carrier           || null,
                estimated_delivery: data.estimated_delivery   || item.estimated_delivery || null,
                last_refreshed:     new Date().toISOString()
            };
        });

        if (updated) {
            localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
            await savePurchasedToFirestore(purchasedItems);
            renderCart();
            showToast('✅ Status atualizado!', 'success');
        } else {
            showToast('ℹ️ Nenhuma alteração encontrada', 'info');
        }
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('❌ Não foi possível atualizar o status', 'error');
    } finally {
        if (btn) { btn.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Atualizar'; btn.disabled = false; }
    }
}

function viewPurchaseDetails(orderId, productId) {
    if (!orderId) { showToast('Detalhes da compra não disponíveis', 'info'); return; }
    window.location.href = `order-details.html?order_id=${orderId}&product_id=${productId}`;
}

async function clearPurchaseHistory() {
    if (!confirm('Tem certeza que deseja limpar todo o histórico de compras?')) return;
    localStorage.removeItem('purchasedItems');
    await savePurchasedToFirestore([]);
    renderCart();
    showToast('Histórico de compras limpo!', 'info');
}

function updateCartCounters(cartCount, purchasedCount) {
    const ids = {
        cartCount:           cartCount,
        activeCartCount:     cartCount,
        purchasedCount:      purchasedCount,
        totalPurchasedCount: purchasedCount
    };
    Object.entries(ids).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    });

    const purchaseSummary = document.getElementById('purchaseSummary');
    if (purchaseSummary) {
        purchaseSummary.style.display = purchasedCount > 0 ? 'block' : 'none';
        if (purchasedCount > 0) {
            const purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
            let total = 0;
            purchasedItems.forEach(item => {
                if (item.pricing?.total_price)      total += parseFloat(item.pricing.total_price);
                else if (item.selectedVariant?.price) total += parseFloat(item.selectedVariant.price);
            });
            const el = document.getElementById('totalPurchasedValue');
            if (el) el.textContent = formatCurrency(total);
        }
    }
}

async function removeFromCart(index) {
    if (!confirm('Tem certeza que deseja remover este item do carrinho?')) return;
    let cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const removedItem = cart[index];
    cart.splice(index, 1);
    localStorage.setItem('cart', JSON.stringify(cart));

    try {
        const uid = await getCurrentUserId();
        const db  = _db();
        if (uid && db && removedItem) {
            await db.collection('users').doc(uid)
                .collection('cart').doc(_cartKey(removedItem))
                .delete();
            console.log('Item removido do Firestore:', _cartKey(removedItem));
        }
    } catch (err) {
        console.warn('Erro ao remover item do Firestore:', err.message);
    }

    renderCart();
    showToast('Item removido do carrinho!', 'warning');
}

async function clearCart() {
    if (!confirm('Tem certeza que deseja esvaziar todo o carrinho?')) return;
    localStorage.removeItem('cart');
    await saveCartToFirestore([]);
    renderCart();
    showToast('Carrinho esvaziado!', 'info');
}

async function cancelPurchase(orderId, index) {
    if (!confirm('Tem certeza que deseja cancelar esta compra? Entre em contato com o suporte para reembolsos.')) return;
    let purchasedItems = JSON.parse(localStorage.getItem('purchasedItems') || '[]');
    purchasedItems = purchasedItems.filter((_, i) => i !== index);
    localStorage.setItem('purchasedItems', JSON.stringify(purchasedItems));
    await savePurchasedToFirestore(purchasedItems);
    renderCart();
    showToast('Compra removida do histórico. Contate o suporte para cancelamentos oficiais.', 'warning');
}

function updateTotals(total) {
    const formatted = formatCurrency(total);
    const subtotalEl = document.getElementById('subtotalValue');
    const totalEl    = document.getElementById('totalValue');
    if (subtotalEl) subtotalEl.textContent = formatted;
    if (totalEl)    totalEl.textContent    = formatted;
    const shippingSection = document.getElementById('shippingSection');
    if (shippingSection) shippingSection.style.display = 'none';
}

function calculateCartTotal(cart) {
    return cart.reduce((total, item) => {
        if (item.pricing?.total_price)      return total + parseFloat(item.pricing.total_price);
        if (item.selectedVariant?.price)    return total + parseFloat(item.selectedVariant.price);
        return total;
    }, 0);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    }).format(value || 0);
}

function showToast(message, type = 'info') {
    const toastId = 'cartToast_' + Date.now();
    const bgColor = type === 'success' ? 'success' :
                    type === 'warning' ? 'warning' :
                    type === 'error'   ? 'danger'  : 'info';
    document.body.insertAdjacentHTML('beforeend', `
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 1060">
            <div id="${toastId}" class="toast align-items-center text-white bg-${bgColor} border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        </div>`);
    const toastElement = document.getElementById(toastId);
    if (toastElement) {
        new bootstrap.Toast(toastElement).show();
        setTimeout(() => toastElement.remove(), 3000);
    }
}

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

window.testMoveToPurchased = function () {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    if (cart.length === 0) { alert('Carrinho vazio'); return; }
    moveCartToPurchased(cart, {
        order_id:   'TEST_' + Date.now(),
        payment_id: 'TEST_PAYMENT',
        date:       new Date().toISOString()
    });
};