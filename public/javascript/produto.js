console.log("produto.js loaded!");

// ─── Config (mesmo padrão do shared-products-dimona.js) ───────────────────────
const PRODUCT_PAGE_CONFIG = {
    collection:             "products",
    likesCollection:        "product_likes",
    userIdField:            "userId",
    commentsCollection:     "product_comments",
    commentLikesCollection: "product_comment_likes",
    contentIdField:         "productId",
    contentCollection:      "products",
    notificationType:       "product_comment",
};

const SIZE_ORDER = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL'];

let likesManager    = null;
let commentsManager = null;
let usersCache      = {};
let currentUserId   = null;
let db              = null;
let auth            = null;
let freightUnsubscribe = null;

// ─────────────────────────────────────────────────────────────────────────────
//  Init — mesmo padrão do app.js
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const firebaseConfig = {
        apiKey:            "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain:        "kauara1.firebaseapp.com",
        projectId:         "kauara1",
        storageBucket:     "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId:             "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId:     "G-KL18R1CJ6S"
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    // ── Fallback para imagem do designer (CSP-safe) ──
    const designerAvatar = document.getElementById('designerAvatar');
    if (designerAvatar) {
        designerAvatar.addEventListener('error', function() {
            this.src = '/images/default-profile.png';
        });
    }



    auth = firebase.auth();
    db = firebase.firestore();

    sessionStorage.setItem('_firestorePersistenceEnabled', '1');

    likesManager    = new window.SharedLikesManager(db, auth);
    commentsManager = new window.SharedCommentsManager(db, auth, usersCache, likesManager);

    const productId = new URLSearchParams(window.location.search).get('id');
    if (!productId) { showError(); return; }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                const q = await db.collection('users').where('firebaseUID', '==', user.uid).get();
                if (!q.empty) {
                    currentUserId = q.docs[0].id;
                    sessionStorage.setItem('currentFirestoreUserId', currentUserId);
                }
            } catch (e) { console.warn('[produto.js] auth resolve:', e); }
        } else {
            currentUserId = null;
        }
        loadProduct(productId);
    });
    
    setupFreightListener();
});

// ─────────────────────────────────────────────────────────────────────────────
//  Freight listener
// ─────────────────────────────────────────────────────────────────────────────

function setupFreightListener() {
    if (window.ShippingManager) {
        freightUnsubscribe = window.ShippingManager.onChange(() => {
            const productId = new URLSearchParams(window.location.search).get('id');
            if (productId && document.getElementById('productContent').style.display !== 'none') {
                loadProduct(productId);
            }
            updateCartBtn();
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getCurrentUser helper (mesmo padrão do shared-products-dimona.js)
// ─────────────────────────────────────────────────────────────────────────────

function getCurrentUser() {
    return new Promise((resolve) => {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const q = await db.collection('users').where('firebaseUID', '==', user.uid).get();
                    if (!q.empty) user.firestoreUserId = q.docs[0].id;
                } catch (e) { console.warn('[produto.js] getCurrentUser:', e); }
            }
            resolve(user);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Load product
// ─────────────────────────────────────────────────────────────────────────────

async function loadProduct(productId) {
    try {
        const doc = await db.collection('products').doc(productId).get();
        if (!doc.exists) { showError(); return; }

        const product = { id: doc.id, ...doc.data() };

        let designer = null;
        try {
            const uDoc = await db.collection('users').doc(product.designerUserId).get();
            if (uDoc.exists) {
                designer = uDoc.data();
                usersCache[product.designerUserId] = designer;
            }
        } catch (e) { console.warn('[produto.js] designer fetch:', e); }

        renderProduct(product, designer, productId);

    } catch (e) {
        console.error('[produto.js] loadProduct:', e);
        showError();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helper functions for price with freight
// ─────────────────────────────────────────────────────────────────────────────

function getTotalPriceWithFreight(product, freight) {
    if (!product.variants?.length) return '0,00';
    
    const prices = product.variants
        .filter(v => isVariantAvailable(v))
        .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
        .filter(p => p > 0);
    
    if (!prices.length) return '0,00';
    
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const totalMin = min + freight;
    const totalMax = max + freight;
    
    if (min === max) {
        return totalMin.toFixed(2).replace('.',',');
    }
    return `${totalMin.toFixed(2).replace('.',',')} – ${totalMax.toFixed(2).replace('.',',')}`;
}

function getTotalPriceValueWithFreight(product, freight) {
    if (!product.variants?.length) return 0;
    
    const prices = product.variants
        .filter(v => isVariantAvailable(v))
        .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
        .filter(p => p > 0);
    
    if (!prices.length) return 0;
    
    return Math.min(...prices) + freight;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────────────────────────────────────

function renderProduct(product, designer, productId) {
    document.title = product.productTitle || 'Produto';
    
    const freight = window.ShippingManager?.getFreight() || 0;
    const basePriceDisplay = getPriceDisplay(product);
    const totalPriceDisplay = getTotalPriceWithFreight(product, freight);
    
    const priceContainer = document.getElementById('productPrice');
    priceContainer.innerHTML = `
        ${basePriceDisplay}
        ${freight > 0 ? `
            <div class="small text-muted mt-1">
                <i class="fas fa-truck"></i> Frete: R$ ${freight.toFixed(2).replace('.',',')}
            </div>
            <div class="text-success fw-bold mt-1">
                Total com frete: R$ ${totalPriceDisplay}
            </div>
        ` : ''}
    `;

    // ── Freight row (ShippingManager) ─────────────────────────────────────
    if (window.ShippingManager) {
        const priceEl = document.getElementById('productPrice');
        window.ShippingManager.renderProductPageFreightRow(priceEl.parentElement);
    }

    // Designer
    const designerEl = document.getElementById('designerInfo');
    if (designer) {
        const avatar = document.getElementById('designerAvatar');
        avatar.src = designer.profilePicture
            ? `data:image/jpeg;base64,${designer.profilePicture}`
            : '/public/images/default-profile.png';
        
        // Garantir fallback CSP-safe
        avatar.onerror = function() {
            this.src = '/images/default-profile.png';
        };
        
        document.getElementById('designerName').textContent = designer.user_Name || 'Designer';
        designerEl.addEventListener('click', () => {
            window.location.href = `public-profile.html?userId=${encodeURIComponent(product.designerUserId)}`;
        });
    } else {
        designerEl.style.display = 'none';
    }

    // Image + color + size
    const variantsByColor = groupByColor(product.variants);
    const colorGroups     = Object.keys(variantsByColor);
    const firstVariant    = variantsByColor[colorGroups[0]]?.[0];

    setMainImage(product, colorGroups[0]);

    // Frente/costas
    if (product.thumbnailUrls?.back) {
        const sideBtns = document.getElementById('sideBtns');
        sideBtns.style.display = 'flex';
        sideBtns.querySelectorAll('.side-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                sideBtns.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                document.getElementById('mainProductImg').src = this.dataset.side === 'back'
                    ? product.thumbnailUrls.back
                    : (product.thumbnailUrls?.front || product.thumbnailUrl || product.thumbnail);
            });
        });
    }

    // Color dots
    const colorDots   = document.getElementById('colorDots');
    const colorNameEl = document.getElementById('selected-color-name');
    colorDots.innerHTML = colorGroups.map((color, i) => {
        const fv = variantsByColor[color][0];
        const cc = fv?.color_code || fv?.colorCode || '#ccc';
        return `<span class="color-dot ${i === 0 ? 'active' : ''}"
                      data-color="${color}" data-color-code="${cc}"
                      style="background:${cc};" title="${color}"></span>`;
    }).join('');
    colorNameEl.textContent = firstVariant?.color || colorGroups[0] || '';

    colorDots.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', function () {
            colorDots.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            this.classList.add('active');
            const color = this.dataset.color;
            colorNameEl.textContent = variantsByColor[color]?.[0]?.color || color;
            setMainImage(product, color);
            renderSizes(variantsByColor[color]);
            selectedVariant = null;
            updateCartBtn();
        });
    });

    renderSizes(variantsByColor[colorGroups[0]]);

    // Add to cart
    document.getElementById('addToCartBtn').addEventListener('click', () => {
        if (selectedVariant) addToCart(product, selectedVariant, designer, productId);
    });

    // Share
    document.getElementById('shareBtn').addEventListener('click', () => {
        openShareModal(productId, product.productTitle);
    });

    // Comments
    setupComments(productId);

    // Setup vinculated art - usando ProductManagerDimona
    setupVinculatedArt(product);

    document.getElementById('loadingState').style.display  = 'none';
    document.getElementById('productContent').style.display = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Comments — usa SharedCommentsManager igual ao shared-products-dimona.js
// ─────────────────────────────────────────────────────────────────────────────

function setupComments(productId) {
    const commentsContainer     = document.getElementById('commentsContainer');
    const commentInputContainer = document.getElementById('commentInputContainer');

    // Real-time listener — sempre visível na página do produto
    commentsManager.loadComments(productId, commentsContainer, currentUserId, PRODUCT_PAGE_CONFIG);

    // Inject image-capable input (replaces any static HTML in the container)
    if (commentInputContainer) {
        commentsManager.renderCommentInput(
            commentInputContainer, productId, commentsContainer, PRODUCT_PAGE_CONFIG, getCurrentUser
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Image
// ─────────────────────────────────────────────────────────────────────────────

function setMainImage(product, color) {
    const fv        = groupByColor(product.variants)[color]?.[0];
    const colorCode = fv?.color_code || fv?.colorCode || '#f8f9fa';
    const img       = document.getElementById('mainProductImg');
    const wrap      = document.getElementById('mainImgWrap');
    img.src               = product.thumbnailUrls?.front || product.thumbnailUrl || product.thumbnail || '';
    img.alt               = product.productTitle;
    wrap.style.background = colorCode;
    
    // Fallback CSP-safe para imagem do produto
    img.onerror = function() { 
        this.src = '/public/images/default-product.png'; 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Size grid
// ─────────────────────────────────────────────────────────────────────────────

let selectedVariant = null;

function renderSizes(variants) {
    const grid = document.getElementById('sizeGrid');
    const freight = window.ShippingManager?.getFreight() || 0;
    
    if (!variants?.length) {
        grid.innerHTML = '<p class="text-muted small">Sem tamanhos disponíveis</p>';
        return;
    }
    grid.innerHTML = [...variants]
        .sort((a, b) => SIZE_ORDER.indexOf(a.size || '') - SIZE_ORDER.indexOf(b.size || ''))
        .map(v => {
            const avail = isVariantAvailable(v);
            const basePrice = parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0);
            const totalPrice = basePrice + freight;
            return `<button class="size-chip ${avail ? '' : 'disabled'}"
                        data-variant='${JSON.stringify(v).replace(/'/g, "&#39;")}'
                        data-base-price="${basePrice}"
                        data-total-price="${totalPrice}"
                        ${!avail ? 'disabled' : ''}>
                        ${v.size || 'Único'}
                    </button>`;
        }).join('');

    grid.querySelectorAll('.size-chip:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', function () {
            grid.querySelectorAll('.size-chip').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const v          = JSON.parse(this.dataset.variant);
            const basePrice  = parseFloat(this.dataset.basePrice);
            const totalPrice = parseFloat(this.dataset.totalPrice);
            selectedVariant = {
                id:         v.sku || v.id,
                sku:        v.sku || v.id,
                dimona_sku: v.dimona_sku || v.sku || v.id,
                variant_id: v.sku || v.id,
                color:      v.color,
                size:       v.size,
                price:      totalPrice,
                base_price: basePrice,
                color_code: v.color_code,
                colorCode:  v.colorCode,
                pricing:    v.pricing || null,
            };
            updateCartBtn();
        });
    });
}

function updateCartBtn() {
    const btn = document.getElementById('addToCartBtn');
    if (selectedVariant) {
        btn.disabled  = false;
        btn.innerHTML = `<i class="fas fa-shopping-cart me-1"></i> Adicionar — R$ ${selectedVariant.price.toFixed(2).replace('.',',')}`;
    } else {
        btn.disabled  = true;
        btn.innerHTML = `<i class="fas fa-shopping-cart me-1"></i> Adicionar ao carrinho`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cart — lógica idêntica ao shared-products-dimona.js com frete
// ─────────────────────────────────────────────────────────────────────────────

async function addToCart(product, variant, designer, productId) {
    try {
        const freight = window.ShippingManager?.getFreight() || 0;
        
        const productWithVariant = {
            ...product,
            firestoreProductId: productId,
            provider:           'dimona',
            selectedVariant:    variant,
            freight:            freight,
            pricing: variant.pricing || {
                product_price: (variant.base_price || variant.price - freight) * 0.7,
                artist_cut:    (variant.base_price || variant.price - freight) * 0.25,
                platform_fee:  8.00,
                total_price:   variant.price,
                currency:      'BRL',
            },
            dimona_sku:        variant.dimona_sku || variant.sku || variant.id,
            designUrls:        product.designUrls || {},
            designUrl:         product.designUrls?.front || product.designUrl,
            designerName:      designer?.user_Name || product.designerName || 'Unknown Designer',
            designerUserId:    product.designerUserId,
            thumbnailUrl:      product.thumbnailUrls?.front || product.thumbnailUrl || product.thumbnail,
            pix_key:           designer?.pix_key || null,
            pix_keyType:       designer?.pix_keyType || null,
            designerEmail:     designer?.email || null,
            purchaseTimestamp: new Date().toISOString(),
            cartItemId:        Date.now() + Math.random().toString(36).substr(2, 9),
        };

        let cart   = JSON.parse(localStorage.getItem('cart') || '[]');
        const exists = cart.findIndex(item =>
            item.firestoreProductId === productId &&
            (item.selectedVariant?.dimona_sku || item.selectedVariant?.sku) ===
            (variant.dimona_sku || variant.sku)
        );
        if (exists !== -1) {
            alert('Este produto já está no seu carrinho!');
            return;
        }

        cart.push(productWithVariant);
        localStorage.setItem('cart', JSON.stringify(cart));
        await _syncCartItemToFirestore(productWithVariant);

        _showCartToast();
    } catch (e) {
        console.error('[produto.js] addToCart:', e);
        alert('Erro ao adicionar ao carrinho. Tente novamente.');
    }
}

async function _syncCartItemToFirestore(productData) {
    try {
        const firestoreUserId = currentUserId || sessionStorage.getItem('currentFirestoreUserId');
        if (!firestoreUserId) return;
        const { variants, availableColors, availableSizes, ...cartItem } = productData;
        const sanitize = obj => {
            if (obj === undefined) return null;
            if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
            return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitize(v)]));
        };
        await db.collection('users').doc(firestoreUserId)
            .collection('cart').doc(productData.cartItemId)
            .set({ ...sanitize(cartItem), _synced_at: new Date().toISOString() }, { merge: true });
    } catch (e) { console.warn('[produto.js] Firestore cart sync:', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vinculated Art — renders the linked art using the shared ArtManager card
// ─────────────────────────────────────────────────────────────────────────────

// Store reference for cleanup (add this at the top of produto.js with other global variables)
let vinculatedArtManager = null;

async function setupVinculatedArt(product) {
    const section = document.getElementById('vinculatedArtSection');
    if (!section) return;

    if (!product.artId) {
        section.style.display = 'none';
        return;
    }

    try {
        const artDoc = await db.collection('arts').doc(product.artId).get();
        if (!artDoc.exists) { 
            section.style.display = 'none'; 
            return; 
        }

        const artData = artDoc.data();

        // Fetch artist data for the card
        let userData = {};
        try {
            const uDoc = await db.collection('users').doc(artData.userId).get();
            if (uDoc.exists) userData = uDoc.data();
        } catch (e) { 
            console.warn('[Vinculated Art] artist fetch:', e); 
        }

        // Clean up previous instance if exists (prevents memory leaks)
        if (vinculatedArtManager) {
            vinculatedArtManager.destroy();
            vinculatedArtManager = null;
        }

        // Create new ArtManager instance
        vinculatedArtManager = new window.ArtManager(db, auth, 'vinculatedArtContainer');
        
        // Get the art element using the shared method
        const artEl = vinculatedArtManager.createArtElement(
            product.artId, 
            artData, 
            userData, 
            currentUserId  // Pass current user ID for proper like/delete permissions
        );

        const container = document.getElementById('vinculatedArtContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Override styles - single card mode (remove horizontal strip styling)
        artEl.style.cssText = `
            width: 100%;
            min-width: 0;
            flex: none;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            margin-bottom: 0;
        `;
        
        container.appendChild(artEl);
        section.style.display = 'block';
        
    } catch (e) {
        console.error('[Vinculated Art] setupVinculatedArt error:', e);
        section.style.display = 'none';
    }
}
// ─────────────────────────────────────────────────────────────────────────────
//  Share modal
// ─────────────────────────────────────────────────────────────────────────────

function openShareModal(productId, productTitle) {
    const url = `${window.location.origin}/produto.html?id=${productId}`;
    document.getElementById('shareModalProductName').textContent = productTitle || '';
    document.getElementById('shareLinkInput').value              = url;
    document.getElementById('copyFeedback').style.display        = 'none';

    const oldBtn = document.getElementById('copyLinkBtn');
    const newBtn = oldBtn.cloneNode(true);
    oldBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => {
        const input    = document.getElementById('shareLinkInput');
        const feedback = document.getElementById('copyFeedback');
        navigator.clipboard.writeText(input.value).then(() => {
            feedback.style.display = 'block';
            newBtn.innerHTML       = '<i class="fas fa-check"></i>';
            setTimeout(() => { feedback.style.display = 'none'; newBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
        }).catch(() => {
            input.select(); document.execCommand('copy');
            feedback.style.display = 'block';
            setTimeout(() => { feedback.style.display = 'none'; }, 2000);
        });
    });

    new bootstrap.Modal(document.getElementById('shareModal')).show();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getPriceDisplay(product) {
    if (product.pricing_summary?.total_price_range) {
        const { min, max } = product.pricing_summary.total_price_range;
        return min === max ? `R$ ${min.toFixed(2)}` : `R$ ${min.toFixed(2)} – R$ ${max.toFixed(2)}`;
    }
    if (!product.variants?.length) return 'Preço indisponível';
    const prices = product.variants
        .filter(v => isVariantAvailable(v))
        .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
        .filter(p => p > 0);
    if (!prices.length) return 'Preço indisponível';
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? `R$ ${min.toFixed(2)}` : `R$ ${min.toFixed(2)} – R$ ${max.toFixed(2)}`;
}

function isVariantAvailable(v) {
    if (v.availability_status && v.availability_status !== 'active') return false;
    if (v.pricing?.total_price) return !isNaN(v.pricing.total_price) && v.pricing.total_price > 0;
    if (v.retail_price)         return !isNaN(v.retail_price) && v.retail_price > 0;
    if (v.price)                return !isNaN(v.price) && v.price > 0;
    return false;
}

function groupByColor(variants) {
    const grouped = {};
    (variants || []).forEach(v => {
        const color = v.color || 'Default';
        if (!grouped[color]) grouped[color] = [];
        grouped[color].push(v);
    });
    return grouped;
}

function showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display   = '';
}

function _showCartToast() {
    const existing = document.querySelector('.cart-toast-wrapper');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="position-fixed bottom-0 end-0 p-3 cart-toast-wrapper" style="z-index:1050">
            <div class="toast show bg-success text-white" role="alert">
                <div class="toast-header bg-success text-white">
                    <strong class="me-auto"><i class="fas fa-check-circle me-2"></i>Sucesso!</strong>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
                </div>
                <div class="toast-body">Produto adicionado ao carrinho!</div>
            </div>
        </div>`);
    setTimeout(() => document.querySelector('.cart-toast-wrapper')?.remove(), 2500);
}

window.addEventListener('beforeunload', () => {
    commentsManager?.cleanupAllListeners();
    
    // Clean up vinculated art manager
    if (vinculatedArtManager) {
        vinculatedArtManager.destroy();
        vinculatedArtManager = null;
    }
    
    if (freightUnsubscribe) {
        freightUnsubscribe();
    }
});