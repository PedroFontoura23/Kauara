console.log("shared-products-dimona.js loaded!");

// ─── Responsive grid/strip CSS (injected once) ───────────────────────────────
(function _injectLayoutStyles() {
    if (document.getElementById("shared-layout-styles")) return;
    const s = document.createElement("style");
    s.id = "shared-layout-styles";
    s.textContent = `
        /* 4-col grid: products & posts */
        .products-grid, .posts-grid,
        [id="productsContainer"], [id="allPostsContainer"] {
            container-type: inline-size;
        }
        @media (max-width: 1100px) {
            [id="productsContainer"],
            [id="allPostsContainer"] {
                grid-template-columns: repeat(3, 1fr) !important;
            }
        }
        @media (max-width: 768px) {
            [id="productsContainer"],
            [id="allPostsContainer"] {
                grid-template-columns: repeat(2, 1fr) !important;
            }
        }
        @media (max-width: 480px) {
            [id="productsContainer"],
            [id="allPostsContainer"] {
                grid-template-columns: repeat(1, 1fr) !important;
            }
        }
        /* Horizontal strip scrollbar styling */
        [id="artContainer"]::-webkit-scrollbar,
        [id="candidatoArtsContainer"]::-webkit-scrollbar {
            height: 4px;
        }
        [id="artContainer"]::-webkit-scrollbar-track,
        [id="candidatoArtsContainer"]::-webkit-scrollbar-track {
            background: transparent;
        }
        [id="artContainer"]::-webkit-scrollbar-thumb,
        [id="candidatoArtsContainer"]::-webkit-scrollbar-thumb {
            background: #ccc;
            border-radius: 4px;
        }
    `;
    document.head.appendChild(s);
})();


// ─── Config ───────────────────────────────────────────────────────────────────
const PRODUCT_CONFIG = {
    collection:             "products",
    likesCollection:        "product_likes",
    userIdField:            "userId",
    commentsCollection:     "product_comments",
    commentLikesCollection: "product_comment_likes",
    contentIdField:         "productId",
    contentCollection:      "products",
    notificationType:       "product_comment",
};

window.ProductManagerDimona = class ProductManagerDimona {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db                    = db;
        this.auth                  = auth;
        this.containerId           = containerId;
        this.container             = document.getElementById(containerId);
        this.usersCache            = {};
        this.lastVisibleProduct    = null;
        this.batchSize             = 2;
        this.isLoading             = false;
        this.currentFilterUserId   = filterUserId;
        this.currentUserId         = null;
        this.freightUnsubscribe    = null;

        // ── Shared managers ──────────────────────────────────────────────────
        this.likesManager    = new window.SharedLikesManager(db, auth);
        this.commentsManager = new window.SharedCommentsManager(db, auth, this.usersCache, this.likesManager);

        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const q = await this.db.collection("users").where("firebaseUID", "==", user.uid).get();
                    this.currentUserId = !q.empty ? q.docs[0].id : null;
                    sessionStorage.setItem('currentFirestoreUserId', this.currentUserId);
                } catch (e) {
                    console.error("[ProductManager] Auth error:", e);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
                sessionStorage.removeItem('currentFirestoreUserId');
            }
        });
        
        // Listen for freight changes to refresh display
        if (window.ShippingManager) {
            this.freightUnsubscribe = window.ShippingManager.onChange(() => {
                this.refreshProducts();
            });
        }
    }

    // ─── Auth helpers ─────────────────────────────────────────────────────────

    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        const q = await this.db.collection("users").where("firebaseUID", "==", user.uid).get();
                        if (!q.empty) user.firestoreUserId = q.docs[0].id;
                    } catch (e) {
                        console.error("[ProductManager] getCurrentUser error:", e);
                    }
                }
                resolve(user);
            });
        });
    }

    // ─── User cache ───────────────────────────────────────────────────────────

    async cacheUsers(userIds) {
        if (!userIds.length) return;
        const missing = userIds.filter(id => id && !this.usersCache[id]);
        if (!missing.length) return;
        const q = await this.db.collection("users").where("userId", "in", missing).get();
        q.forEach(doc => { this.usersCache[doc.data().userId] = doc.data(); });
    }

    // ─── Refresh products ────────────────────────────────────────────────────
    
    async refreshProducts() {
        if (this.container && this.currentFilterUserId !== undefined) {
            await this.displayProducts(this.currentFilterUserId, this.currentUserId);
        }
    }

    // ─── Display products ─────────────────────────────────────────────────────

    async displayProducts(filterUserId = null, currentUserId = null) {
        if (!this.container || this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) currentUserId = this.currentUserId;

        this.currentFilterUserId = filterUserId;
        this.container.innerHTML = "<p>Loading products...</p>";

        try {
            let query = this.db.collection("products").where("provider", "==", "dimona").orderBy("createdAt", "desc");
            if (this.currentFilterUserId) query = query.where("designerUserId", "==", this.currentFilterUserId);

            const snapshot = await query.get();
            if (snapshot.empty) {
                this.container.innerHTML = "<p>No products available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().designerUserId);
            await this.cacheUsers([...new Set(userIds)]);

            // Pre-warm likes cache for all items at once
            const productIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                productIds, PRODUCT_CONFIG.likesCollection, "productId", "userId", currentUserId
            );

            // Build 4-column grid
            this.container.innerHTML = "";
            this.container.style.cssText = `
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 16px;
                padding: 8px 0;
            `;

            snapshot.docs.forEach(doc => {
                const productData   = doc.data();
                const userData      = this.usersCache[productData.designerUserId] || {};
                const isCurrentUser = currentUserId === productData.designerUserId;
                const productEl     = this.createProductElement(doc.id, productData, userData, currentUserId, isCurrentUser);
                this.container.appendChild(productEl);
            });
        } catch (error) {
            console.error("[ProductManager] displayProducts error:", error);
            this.container.innerHTML = "<p>Error loading products.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Create product element ───────────────────────────────────────────────

    createProductElement(productId, productData, userData, currentUserId, isCurrentUserProduct) {
        const timestamp     = productData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const thumbnailSrc       = productData.thumbnailUrl || productData.thumbnail;
        const basePriceDisplay   = this.getPriceDisplay(productData);
        const freight            = window.ShippingManager?.getFreight() || 0;
        const totalPriceRange    = this.getTotalPriceRangeWithFreight(productData, freight);
        const firstVariant       = productData.variants?.find(v => this.isVariantAvailable(v)) || productData.variants?.[0];
        const backgroundColor    = firstVariant?.color_code || firstVariant?.colorCode || '#f8f9fa';

        const productEl = document.createElement("div");
        productEl.className = "card product-card";
        productEl.style.cssText = `
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            min-width: 0;
        `;
        productEl.innerHTML = `
            <div style="position:relative;width:100%;aspect-ratio:1;background:${backgroundColor};overflow:hidden;cursor:pointer;">
                ${thumbnailSrc ? `
                    <img src="${thumbnailSrc}"
                         class="product-image lazy-load"
                         alt="${this.escapeHtml(productData.productTitle)}"
                         style="width:100%;height:100%;object-fit:contain;"
                         loading="lazy"
                         data-product-id="${productId}">
                ` : `<div class="d-flex align-items-center justify-content-center w-100 h-100 text-muted">
                        <i class="fas fa-image fa-2x"></i>
                     </div>`}
            </div>
            <div class="p-2" style="flex:1;min-width:0;">
                <p class="mb-0 fw-semibold text-truncate" style="font-size:0.82rem;" title="${this.escapeHtml(productData.productTitle)}">${this.escapeHtml(productData.productTitle)}</p>
                <div style="font-size:0.78rem;">
                    ${basePriceDisplay}
                    ${freight > 0 ? `<span class="text-muted small ms-1">+ frete R$ ${freight.toFixed(2).replace('.',',')}</span>` : ''}
                    ${freight > 0 && totalPriceRange ? `<div class="text-primary small fw-bold mt-1">Total: ${totalPriceRange}</div>` : ''}
                </div>
                <div class="product-freight-badge-slot" style="min-height:18px;"></div>
                <div style="font-size:0.72rem;margin-top:4px;">${this.getVariantPreview(productData.variants)}</div>
                <div class="d-flex align-items-center gap-1 mt-1" style="overflow:hidden;">
                    <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../public/images/default-profile.png'}"
                         class="rounded-circle user-profile-link flex-shrink-0"
                         style="width:18px;height:18px;object-fit:cover;cursor:pointer;"
                         data-user-id="${productData.designerUserId}">
                    <small class="text-muted text-truncate user-profile-link" style="font-size:0.7rem;cursor:pointer;" data-user-id="${productData.designerUserId}">
                        ${this.escapeHtml(userData.user_Name || "Unknown Designer")}
                    </small>
                </div>
            </div>
            <div class="px-2 pb-2 d-flex gap-1">
                <button class="btn btn-outline-secondary btn-sm like-button px-2 py-1 d-flex align-items-center gap-1"
                        data-product-id="${productId}" style="font-size:0.72rem;">
                    <i class="far fa-thumbs-up"></i>
                    <span class="like-count">${productData.likes_count || 0}</span>
                </button>
                <button class="btn btn-outline-secondary btn-sm comments-toggle-button px-2 py-1"
                        data-product-id="${productId}" style="font-size:0.72rem;">
                    <i class="far fa-comment"></i>
                </button>
                <button class="btn btn-outline-secondary btn-sm share-button px-2 py-1"
                        data-product-id="${productId}" style="font-size:0.72rem;">
                    <i class="fas fa-share"></i>
                </button>
                ${isCurrentUserProduct ? `
                    <button class="btn btn-outline-primary btn-sm vinculate-art-button px-2 py-1 ms-auto"
                            data-product-id="${productId}" 
                            data-product-data='${JSON.stringify({ id: productId, productTitle: productData.productTitle, artId: productData.artId || null, designerUserId: productData.designerUserId }).replace(/'/g, "&#39;")}'
                            style="font-size:0.72rem;">
                        <i class="fas fa-link me-1"></i>Arte
                    </button>
                ` : ''}
                ${isCurrentUserProduct ? `<button class="btn btn-outline-danger btn-sm delete-product-button px-2 py-1" data-product-id="${productId}" style="font-size:0.72rem;">✕</button>` : ''}
            </div>
            <div class="px-2 pb-2">
                <div class="comments-container" id="comments-${productId}" style="display:none;"></div>
                <div class="comment-input-container" id="commentInputContainer-${productId}" style="display:none;"></div>
            </div>
        `;

        this._setupProductEventListeners(productEl, productId, productData, currentUserId, isCurrentUserProduct);

        // ── Freight badge ──────────────────────────────────────────────────
        const badgeSlot = productEl.querySelector('.product-freight-badge-slot');
        if (badgeSlot && window.ShippingManager) {
            badgeSlot.appendChild(window.ShippingManager.createFreightBadge());
        }

        return productEl;
    }

    getTotalPriceRangeWithFreight(productData, freight) {
        if (!productData.variants?.length) return null;
        
        const prices = productData.variants
            .filter(v => this.isVariantAvailable(v))
            .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
            .filter(p => p > 0);
        
        if (!prices.length) return null;
        
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const totalMin = min + freight;
        const totalMax = max + freight;
        
        if (min === max) {
            return `R$ ${totalMin.toFixed(2).replace('.',',')}`;
        }
        return `R$ ${totalMin.toFixed(2).replace('.',',')} – R$ ${totalMax.toFixed(2).replace('.',',')}`;
    }

    _setupProductEventListeners(productEl, productId, productData, currentUserId, isCurrentUserProduct) {
        // Profile links
        productEl.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', () => {
                window.location.href = `public-profile.html?userId=${encodeURIComponent(link.dataset.userId)}`;
            });
        });

        // Like button — delegate to SharedLikesManager
        const likeBtn = productEl.querySelector('.like-button');
        likeBtn?.addEventListener('click', async () => {
            const currentUser = await this.getCurrentUser();
            const fromUserId = currentUser?.firestoreUserId || null;

            // Fetch current user's name and pic for the notification
            let fromUsername = "Someone";
            let profilePic = null;
            if (fromUserId) {
                try {
                    const userDoc = await this.db.collection("users").doc(fromUserId).get();
                    if (userDoc.exists) {
                        fromUsername = userDoc.data().user_Name || "Someone";
                        profilePic = userDoc.data().profilePicture || null;
                    }
                } catch (e) { /* non-critical */ }
            }

            const configWithNotify = {
                ...PRODUCT_CONFIG,
                notifyConfig: {
                    toUserId: productData.designerUserId,
                    fromUsername,
                    profilePic,
                    type: 'product_like',
                    message: 'liked your product'
                }
            };

            await this.likesManager.toggleLike(
                productId,
                configWithNotify,
                likeBtn,
                () => this.getCurrentUser()
            );
        });

        // Product image click → open buy popup
        const productImg = productEl.querySelector('.product-image');
        if (productImg) {
            productImg.addEventListener('click', async () => {
                const designerInfo = await this.getDesignerWithPixKey(productData.designerUserId);
                this.showProductModal(productId, productData, designerInfo);
            });
        }

        // Share button
        productEl.querySelector('.share-button')?.addEventListener('click', () => {
            this.showShareModal(productId, productData.productTitle);
        });

        // Comments toggle
        const commentsContainer     = productEl.querySelector('.comments-container');
        const commentInputContainer = productEl.querySelector('.comment-input-container');
        const toggleBtn             = productEl.querySelector('.comments-toggle-button');
        let   commentsLoaded        = false;

        toggleBtn?.addEventListener('click', () => {
            const visible = commentsContainer.style.display === "block";
            if (!visible) {
                if (!commentsLoaded) {
                    this.commentsManager.loadComments(productId, commentsContainer, currentUserId, PRODUCT_CONFIG);
                    this.commentsManager.renderCommentInput(
                        commentInputContainer, productId, commentsContainer, PRODUCT_CONFIG, () => this.getCurrentUser()
                    );
                    commentsLoaded = true;
                }
                commentsContainer.style.display     = "block";
                commentInputContainer.style.display  = "block";
                toggleBtn.textContent = "Ocultar comentários";
            } else {
                commentsContainer.style.display     = "none";
                commentInputContainer.style.display  = "none";
                toggleBtn.textContent = "Mostrar comentários";
            }
        });

        // Delete product (owner only)
        productEl.querySelector('.delete-product-button')?.addEventListener('click', () => {
            if (confirm("Tem certeza que deseja excluir este produto e todos os seus comentários e curtidas?")) {
                this._deleteProduct(productId, this.currentFilterUserId);
            }
        });

        // Vincular arte button (apenas dono)
        productEl.querySelector('.vinculate-art-button')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const productData = JSON.parse(btn.dataset.productData);
            // Verifica se o usuário atual é o dono
            if (this.currentUserId !== productData.designerUserId) {
                alert('Apenas o criador do produto pode vincular uma arte.');
                return;
            }
            await this.showVinculateArtModal(productData.id, { 
                productTitle: productData.productTitle, 
                artId: productData.artId,
                designerUserId: productData.designerUserId 
            });
        });
    }

    // ─── Variant / price helpers ───────────────────────────────────

    getVariantPreview(variants) {
        if (!variants || variants.length === 0) return '<span class="text-muted small">Sem variantes</span>';

        const sizeOrder  = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL'];
        const colorGroups = {};
        const allSizes    = new Set();

        variants.forEach(variant => {
            if (this.isVariantAvailable(variant)) {
                const color = variant.color || 'Default';
                if (!colorGroups[color]) colorGroups[color] = { color_code: variant.color_code || variant.colorCode };
                if (variant.size) allSizes.add(variant.size);
            }
        });

        const colorDots = Object.values(colorGroups).map(g =>
            `<span style="background:${g.color_code||'#ccc'};width:18px;height:18px;display:inline-block;
                          border-radius:50%;border:1px solid rgba(0,0,0,0.15);flex-shrink:0;"
                   title="${g.color_code||''}"></span>`
        ).join('');

        const sortedSizes = [...allSizes].sort((a,b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
        const sizesText   = sortedSizes.join(' · ');

        return `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="display:flex;gap:4px;flex-wrap:wrap;">${colorDots}</div>
                <span class="text-muted small">${sizesText}</span>
            </div>`;
    }

    isVariantAvailable(variant) {
        if (variant.availability_status && variant.availability_status !== 'active') return false;
        if (variant.pricing?.total_price) return !isNaN(variant.pricing.total_price) && variant.pricing.total_price > 0;
        if (variant.retail_price) return !isNaN(variant.retail_price) && variant.retail_price > 0;
        if (variant.price) return !isNaN(variant.price) && variant.price > 0;
        return false;
    }

    groupVariantsByColor(variants) {
        const grouped = {};
        if (!variants?.length) return grouped;
        variants.forEach(v => {
            const color = v.color || 'Default Color';
            if (!grouped[color]) grouped[color] = [];
            grouped[color].push({ ...v });
        });
        return grouped;
    }

    getPriceDisplay(productData) {
        if (productData.pricing_summary?.total_price_range) {
            const { min, max } = productData.pricing_summary.total_price_range;
            return min === max
                ? `<strong class="text-primary">R$ ${min.toFixed(2)}</strong>`
                : `<strong class="text-primary">R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}</strong>`;
        }
        if (!productData.variants?.length) return '<strong class="text-muted">Preço indisponível</strong>';
        const prices = productData.variants
            .filter(v => this.isVariantAvailable(v))
            .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
            .filter(p => p > 0);
        if (!prices.length) return '<strong class="text-muted">Preço indisponível</strong>';
        const min = Math.min(...prices), max = Math.max(...prices);
        return min === max
            ? `<strong class="text-primary">R$ ${min.toFixed(2)}</strong>`
            : `<strong class="text-primary">R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}</strong>`;
    }

    getModalPriceDisplay(productData) {
        if (!productData.pricing_summary) {
            return `<h4 class="text-primary fw-bold">${this.getPriceDisplay(productData)}</h4>`;
        }
        const s = productData.pricing_summary;
        const min = s.total_price_range?.min || 0, max = s.total_price_range?.max || 0;
        let html = min === max
            ? `<h4 class="text-primary fw-bold">R$ ${min.toFixed(2)}</h4>`
            : `<h4 class="text-primary fw-bold">R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}</h4>`;
        if (s.product_price_range) html += `<small class="text-muted d-block">Custo base: R$ ${s.product_price_range.min.toFixed(2)} - R$ ${s.product_price_range.max.toFixed(2)}</small>`;
        if (s.artist_cut)          html += `<small class="text-muted d-block">Margem do artista: R$ ${s.artist_cut.toFixed(2)}</small>`;
        if (s.platform_fee_fixed)      html += `<small class="text-muted d-block">Taxa da plataforma: R$ ${s.platform_fee_fixed.toFixed(2)}</small>`;
        return html;
    }

    getColorName(colorCode, colorNameFromFirestore = '') {
        if (colorNameFromFirestore && colorNameFromFirestore !== 'Default Color') return colorNameFromFirestore;
        if (!colorCode) return colorNameFromFirestore || 'Unknown Color';
        const colorMap = {
            '#000000':'Black','#ffffff':'White','#ff0000':'Red','#00ff00':'Green',
            '#0000ff':'Blue','#ffff00':'Yellow','#ff00ff':'Magenta','#00ffff':'Cyan',
            '#808080':'Gray','#c0c0c0':'Silver','#800000':'Maroon','#000080':'Navy',
            '#808000':'Olive','#800080':'Purple','#008080':'Teal'
        };
        return colorMap[colorCode.toLowerCase()] || colorNameFromFirestore || 'Unknown Color';
    }

    getContrastColor(hexcolor) {
        if (!hexcolor || hexcolor === '#cccccc') return '#000000';
        const r = parseInt(hexcolor.substr(1,2),16), g = parseInt(hexcolor.substr(3,2),16), b = parseInt(hexcolor.substr(5,2),16);
        return ((r*299 + g*587 + b*114) / 1000) > 128 ? '#000000' : '#FFFFFF';
    }

    createSizeOptions(variants) {
        if (!variants?.length) return '<p class="text-muted">Nenhum tamanho disponível</p>';
        const order = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL'];
        const freight = window.ShippingManager?.getFreight() || 0;
        return [...variants]
            .sort((a,b) => order.indexOf(a.size||'') - order.indexOf(b.size||''))
            .map(v => {
                const available = this.isVariantAvailable(v);
                const price     = parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0);
                const totalPrice = price + freight;
                const priceStr  = totalPrice > 0 ? `R$ ${totalPrice.toFixed(2)}` : 'Preço indisponível';
                return `<button class="btn btn-outline-secondary size-option ${available ? '' : 'disabled'}"
                            data-variant-id="${v.id}"
                            data-variant-full='${JSON.stringify(v).replace(/'/g, "\\'")}'
                            data-color="${v.color}"
                            data-size="${v.size}"
                            data-base-price="${price}"
                            data-total-price="${totalPrice}"
                            ${!available ? 'disabled' : ''}>
                            ${v.size || 'Único'} ${!available ? '(Indisponível)' : `- ${priceStr}`}
                        </button>`;
            }).join('');
    }

    createThumbnailDisplay(productData, selectedColor) {
        const src         = productData.thumbnailUrls?.front || productData.thumbnailUrl || productData.thumbnail;
        const backSrc     = productData.thumbnailUrls?.back;
        const colorVars   = this.groupVariantsByColor(productData.variants)[selectedColor] || [];
        const colorCode   = colorVars[0]?.color_code || colorVars[0]?.colorCode || '#ffffff';
        if (!src) return `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-3x mb-2"></i><p>Sem imagem disponível</p></div>`;
        return `<div style="background-color:${colorCode};border-radius:8px;line-height:0;width:100%;">
                   <img src="${src}" class="img-fluid rounded" alt="Produto"
                        style="max-width:100%;max-height:260px;width:auto;height:auto;object-fit:contain;display:block;margin:0 auto;"
                        id="modal-thumb-img">
                   ${backSrc ? `<div class="d-flex gap-2 mt-2 justify-content-center" style="line-height:normal;padding:8px 0 4px;">
                       <button class="btn btn-sm btn-outline-secondary thumb-side-btn active" data-src="${src}">Frente</button>
                       <button class="btn btn-sm btn-outline-secondary thumb-side-btn" data-src="${backSrc}">Costas</button>
                   </div>` : ''}
               </div>`;
    }

    createLightboxThumbnailDisplay(productData, selectedColor) {
        const src       = productData.thumbnailUrls?.front || productData.thumbnailUrl || productData.thumbnail;
        const backSrc   = productData.thumbnailUrls?.back;
        const colorVars = this.groupVariantsByColor(productData.variants)[selectedColor] || [];
        const colorCode = colorVars[0]?.color_code || colorVars[0]?.colorCode || '#ffffff';
        if (!src) return `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-5x mb-3"></i><p>Sem imagem disponível</p></div>`;
        return `<div style="background-color:${colorCode};border-radius:8px;padding:20px;text-align:center;">
                   <img src="${src}" class="img-fluid rounded" alt="Produto"
                        style="max-width:100%;max-height:70vh;width:auto;height:auto;object-fit:contain;"
                        id="lightbox-thumb-img">
                   ${backSrc ? `<div class="d-flex gap-2 mt-2 justify-content-center">
                       <button class="btn btn-sm btn-outline-secondary lightbox-side-btn active" data-src="${src}">Frente</button>
                       <button class="btn btn-sm btn-outline-secondary lightbox-side-btn" data-src="${backSrc}">Costas</button>
                   </div>` : ''}
               </div>`;
    }

    // ─── Product modals ───────────────────────────────────────────────────────

    async getDesignerWithPixKey(designerUserId) {
        try {
            const doc = await this.db.collection("users").doc(designerUserId).get();
            if (!doc.exists) return null;
            const d = doc.data();
            return {
                userId: designerUserId,
                name: d.user_Name || d.displayName || "Unknown Designer",
                pix_key: d.pix_key || null, pix_keyType: d.pix_keyType || null,
                profilePicture: d.profilePicture || null, email: d.email || null
            };
        } catch (e) { console.error("[ProductManager] getDesignerWithPixKey:", e); return null; }
    }

    // ─── Escape HTML helper ───────────────────────────────────────────────────
    
    escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── Show Product Modal with Vinculated Art ───────────────────────────────

    showProductModal(productId, productData, designerInfo = null) {
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups     = Object.keys(variantsByColor);
        const self            = this;
        const freight         = window.ShippingManager?.getFreight() || 0;

        const firstVariant    = variantsByColor[colorGroups[0]]?.[0];
        
        // Check if product has vinculated art
        const hasVinculatedArt = !!(productData.artId);
        
        const artThumbnail    = productData.artThumbnailUrl || null;
        const artName         = productData.artTitle || null;
        const artPrice        = productData.artPrice != null
                                ? `R$ ${parseFloat(productData.artPrice).toFixed(2).replace('.',',')}`
                                : null;
        const artId           = productData.artId || null;

        // ── Build color dots HTML ─────────────────────────────────────────────
        const colorDotsHtml = colorGroups.map((color, i) => {
            const fv = variantsByColor[color][0];
            const cc = fv?.color_code || fv?.colorCode || '#ffffff';
            return `<button class="color-option-btn"
                        data-color="${color}" data-color-code="${cc}"
                        style="background-color:${cc};
                               width:28px;height:28px;border-radius:50%;
                               border:2px solid ${i===0?'#007bff':'#ccc'};
                               cursor:pointer;padding:0;flex-shrink:0;"
                        title="${this.getColorName(cc, fv?.color||color)}"></button>`;
        }).join('');

        // ── Build size panel HTML ─────────────────────────────────────────────
        const sizeOrder  = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL'];
        const sizesHtml  = (variants) => {
            if (!variants?.length) return '<p class="text-muted small">Sem tamanhos</p>';
            return [...variants]
                .sort((a,b) => sizeOrder.indexOf(a.size||'') - sizeOrder.indexOf(b.size||''))
                .map(v => {
                    const avail = this.isVariantAvailable(v);
                    const basePrice = parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0);
                    const totalPrice = basePrice + freight;
                    return `<button class="size-chip ${avail?'':'size-chip--disabled'}"
                                data-variant-id="${v.id}"
                                data-variant-full='${JSON.stringify(v).replace(/'/g,"&#39;")}'
                                data-color="${v.color}" data-size="${v.size}" 
                                data-base-price="${basePrice}" data-total-price="${totalPrice}"
                                ${!avail?'disabled':''}>
                                ${v.size||'Único'}
                            </button>`;
                }).join('');
        };

        document.body.insertAdjacentHTML('beforeend', `
            <style>
                /* ── Modal sizing ── */
                #productModal .modal-dialog {
                    margin: 0.5rem auto;
                }

                /* ── Product title bar ── */
                #productModal .pm-title {
                    padding: 14px 48px 0 16px;
                    font-size: 1rem;
                    font-weight: 600;
                    line-height: 1.3;
                    color: #212529;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* ── Two-col layout on desktop ── */
                #productModal .pm-wrap {
                    display: flex;
                    gap: 0;
                    min-height: 420px;
                }

                /* ── LEFT: big product image ── */
                #productModal .pm-left {
                    flex: 1 1 55%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: #f8f9fa;
                    border-radius: 8px 0 0 8px;
                    padding: 16px;
                    position: relative;
                }
                #productModal .pm-left img.pm-main-img {
                    max-width: 100%;
                    max-height: 340px;
                    object-fit: contain;
                }
                #productModal .pm-left .pm-product-label {
                    font-size: 0.8rem;
                    color: #888;
                    margin-top: 8px;
                }

                /* ── RIGHT: controls ── */
                #productModal .pm-right {
                    flex: 1 1 45%;
                    display: flex;
                    flex-direction: column;
                    padding: 16px;
                    gap: 12px;
                    position: relative;
                    overflow: hidden;
                }

                /* art strip below product image */
                #productModal .pm-art-strip {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 10px;
                    padding: 6px 8px;
                    background: #fff;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    width: 100%;
                    cursor: pointer;
                    transition: background 0.15s;
                    text-decoration: none;
                    color: inherit;
                }
                #productModal .pm-art-strip:hover {
                    background: #f0f4ff;
                    border-color: #0d6efd;
                }
                #productModal .pm-art-strip img {
                    width: 44px;
                    height: 44px;
                    object-fit: contain;
                    border-radius: 5px;
                    border: 1px solid #eee;
                    background: #fafafa;
                    flex-shrink: 0;
                }
                #productModal .pm-art-strip .pm-art-info {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    flex: 1;
                }
                #productModal .pm-art-strip .pm-art-label {
                    font-size: 0.65rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #888;
                    font-weight: 600;
                }
                #productModal .pm-art-strip .pm-art-name {
                    font-size: 0.8rem;
                    font-weight: 600;
                    color: #222;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                #productModal .pm-art-strip .pm-art-price {
                    font-size: 0.75rem;
                    color: #0d6efd;
                    font-weight: 500;
                }

                /* Full art card in modal (when expanded) */
                #vinculatedArtModalContainer {
                    margin-top: 12px;
                    padding: 12px;
                    background: #f8f9fa;
                    border-radius: 12px;
                    border: 1px solid #e0e0e0;
                    display: none;
                }
                #vinculatedArtModalContainer.show {
                    display: block;
                }
                #vinculatedArtModalContainer .art-card {
                    box-shadow: none;
                    border: 1px solid #e0e0e0;
                }

                #productModal .pm-price {
                    margin-top: 8px;
                    font-size: 1.2rem;
                    font-weight: 700;
                    color: #0d6efd;
                }
                #productModal .pm-price .pm-freight-row {
                    font-size: 0.85rem;
                    font-weight: normal;
                    color: #6c757d;
                    margin-top: 4px;
                }
                #productModal .pm-price .pm-total-row {
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: #198754;
                    margin-top: 4px;
                }

                /* color dots */
                #productModal .pm-colors {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    align-items: center;
                }
                #productModal .color-option-btn {
                    min-width: 32px;
                    min-height: 32px;
                    -webkit-tap-highlight-color: transparent;
                }

                /* action buttons */
                #productModal .pm-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: auto;
                }
                #productModal .pm-actions .btn {
                    flex: 1;
                    font-size: 0.85rem;
                    padding: 10px 4px;
                    min-height: 44px;
                }

                /* ── SIZE PANEL (overlay inside pm-right) ── */
                #productModal .pm-size-panel {
                    position: absolute;
                    inset: 0;
                    background: #fff;
                    border-radius: 0 0 8px 0;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    transform: translateX(105%);
                    transition: transform 0.25s ease;
                    z-index: 10;
                    overflow-y: auto;
                }
                #productModal .pm-size-panel.open {
                    transform: translateX(0);
                }
                #productModal .pm-size-panel h6 {
                    font-size: 0.9rem;
                    font-weight: 600;
                    margin: 0;
                }

                /* size chips grid */
                #productModal .size-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                }
                #productModal .size-chip {
                    border: 1px solid #ccc;
                    border-radius: 6px;
                    background: #fff;
                    padding: 10px 4px;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: all 0.15s;
                    text-align: center;
                    min-height: 44px;
                    -webkit-tap-highlight-color: transparent;
                }
                #productModal .size-chip:hover:not(:disabled) {
                    border-color: #0d6efd;
                    color: #0d6efd;
                }
                #productModal .size-chip.selected {
                    background: #0d6efd;
                    color: #fff;
                    border-color: #0d6efd;
                }
                #productModal .size-chip--disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                #productModal .pm-size-confirm {
                    margin-top: auto;
                    min-height: 48px;
                }

                /* ══════════════════════════════════════════
                   MOBILE  (≤ 576 px) — bottom sheet
                ══════════════════════════════════════════ */
                @media (max-width: 576px) {
                    #productModal {
                        align-items: flex-end !important;
                        padding: 0 !important;
                    }
                    #productModal .modal-dialog {
                        margin: 0 !important;
                        max-width: 100% !important;
                        width: 100% !important;
                        transform: none !important;
                    }
                    #productModal .modal-content {
                        border-radius: 20px 20px 0 0 !important;
                        border: none;
                        max-height: 95vh;
                        overflow-y: auto;
                        -webkit-overflow-scrolling: touch;
                        box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
                    }
                    #productModal .modal-content::before {
                        content: '';
                        display: block;
                        width: 40px;
                        height: 4px;
                        background: #ddd;
                        border-radius: 2px;
                        margin: 12px auto 0;
                    }
                    #productModal .pm-wrap {
                        flex-direction: column;
                        min-height: unset;
                    }
                    #productModal .pm-title {
                        padding: 4px 48px 0 20px;
                        font-size: 0.95rem;
                    }
                    #productModal .pm-left {
                        flex: none;
                        width: 100%;
                        border-radius: 0;
                        min-height: 220px;
                        max-height: 280px;
                        padding: 16px 24px 8px;
                        align-items: center;
                        justify-content: center;
                    }
                    #productModal .pm-left img.pm-main-img {
                        max-height: 220px;
                        display: block;
                        margin: 0 auto;
                    }
                    #productModal .pm-left .pm-product-label {
                        text-align: center;
                    }
                    #productModal .pm-right {
                        flex: none;
                        width: 100%;
                        padding: 16px 20px 32px;
                        overflow: visible;
                        position: relative;
                    }
                    #productModal .pm-price {
                        font-size: 1.15rem;
                        text-align: left;
                        margin-top: 0;
                    }
                    #productModal .pm-colors {
                        justify-content: flex-start;
                    }
                    #productModal #selected-color-name {
                        text-align: left;
                        display: block;
                    }
                    #productModal .color-option-btn {
                        width: 36px !important;
                        height: 36px !important;
                        min-width: 36px;
                        min-height: 36px;
                    }
                    #productModal .pm-actions {
                        flex-direction: column;
                        gap: 8px;
                        margin-top: 12px;
                    }
                    #productModal .pm-actions .btn {
                        width: 100%;
                        padding: 14px;
                        font-size: 1rem;
                    }
                    #productModal .pm-size-panel {
                        position: fixed;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        top: auto;
                        border-radius: 20px 20px 0 0;
                        z-index: 1060;
                        padding: 20px 20px 32px;
                        transform: translateY(105%);
                        transition: transform 0.25s ease;
                        max-height: 80vh;
                        overflow-y: auto;
                        box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
                    }
                    #productModal .pm-size-panel::before {
                        content: '';
                        display: block;
                        width: 40px;
                        height: 4px;
                        background: #ddd;
                        border-radius: 2px;
                        margin: 0 auto 16px;
                    }
                    #productModal .pm-size-panel.open {
                        transform: translateY(0);
                    }
                    #productModal .size-grid {
                        grid-template-columns: repeat(3, 1fr);
                        gap: 8px;
                    }
                    #productModal .pm-size-confirm {
                        width: 100%;
                        font-size: 1rem;
                        padding: 14px;
                        margin-top: 16px;
                    }
                    #productModal .pm-art-strip {
                        margin-top: 8px;
                        padding: 8px;
                    }
                    #productModal .pm-art-strip img {
                        width: 40px;
                        height: 40px;
                    }
                    #vinculatedArtModalContainer {
                        margin-top: 8px;
                        padding: 8px;
                    }
                }
            </style>

            <div class="modal fade" id="productModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content border-0 shadow">
                        <button type="button" class="btn-close position-absolute top-0 end-0 m-2"
                                data-bs-dismiss="modal" style="z-index:20;"></button>

                        <div class="modal-body p-0">
                            <div class="pm-title">
                                ${this.escapeHtml(productData.productTitle || '')}
                            </div>
                            <div class="pm-wrap">

                                <!-- ── LEFT: product image and vinculated art ── -->
                                <div class="pm-left">
                                    <div id="thumbnail-container">
                                        ${this.createThumbnailDisplay(productData, colorGroups[0])}
                                    </div>
                                    <span class="pm-product-label">produto</span>
                                    
                                    ${hasVinculatedArt ? `
                                        <div class="pm-art-strip" id="toggleVinculatedArtBtn">
                                            <div class="pm-art-info">
                                                <span class="pm-art-label">Arte vinculada</span>
                                                <span class="pm-art-name">${this.escapeHtml(artName || 'Arte')}</span>
                                                ${artPrice ? `<span class="pm-art-price">${artPrice}</span>` : ''}
                                            </div>
                                            <i class="fas fa-chevron-down" id="vinculatedArtChevron" style="color:#bbb;font-size:0.7rem;flex-shrink:0;"></i>
                                        </div>
                                        
                                        <div id="vinculatedArtModalContainer">
                                            <div id="vinculatedArtModalInner"></div>
                                        </div>
                                    ` : ''}
                                </div>

                                <!-- ── RIGHT: controls ── -->
                                <div class="pm-right">
                                    <div class="pm-price">
                                        <div>${this.getPriceDisplay(productData)}</div>
                                        ${freight > 0 ? `
                                            <div class="pm-freight-row">
                                                <i class="fas fa-truck"></i> Frete: R$ ${freight.toFixed(2).replace('.',',')}
                                            </div>
                                            <div class="pm-total-row">
                                                Total com frete: ${this.getTotalPriceRangeWithFreight(productData, freight)}
                                            </div>
                                        ` : ''}
                                    </div>

                                    <div class="pm-colors" id="color-options-container">
                                        ${colorDotsHtml}
                                    </div>
                                    <small class="text-muted" id="selected-color-name">
                                        ${this.escapeHtml(this.getColorName(firstVariant?.color_code, firstVariant?.color || colorGroups[0]))}
                                    </small>

                                    <div class="pm-actions">
                                        <button class="btn btn-success open-size-panel-btn">
                                            Adicionar ao carrinho
                                        </button>
                                        <button class="btn btn-outline-primary ver-produto-btn">
                                            Ver produto
                                        </button>
                                    </div>

                                    <div class="pm-size-panel" id="sizePanelInner">
                                        <div class="d-flex align-items-center gap-2">
                                            <button class="btn btn-sm btn-link p-0 back-from-size-btn">
                                                <i class="fas fa-arrow-left"></i>
                                            </button>
                                            <h6>Selecionar tamanho</h6>
                                        </div>
                                        <div class="size-grid" id="size-options-container">
                                            ${sizesHtml(variantsByColor[colorGroups[0]])}
                                        </div>
                                        <button class="btn btn-success pm-size-confirm" disabled>
                                            <i class="fas fa-shopping-cart me-1"></i> Confirmar
                                        </button>
                                    </div>

                                </div><!-- /pm-right -->
                            </div><!-- /pm-wrap -->
                        </div>
                    </div>
                </div>
            </div>`);

        const modalEl       = document.getElementById('productModal');
        const sizePanel     = modalEl.querySelector('#sizePanelInner');
        const confirmBtn    = modalEl.querySelector('.pm-size-confirm');
        let selectedVariant = null;
        let currentColor    = colorGroups[0];
        
        let vinculatedArtManager = null;

        const stripImg = modalEl.querySelector('#vinculatedArtStripImg');

        // ── Setup vinculated art if exists ──
        if (hasVinculatedArt && artId) {
            const toggleBtn = modalEl.querySelector('#toggleVinculatedArtBtn');
            const artContainer = modalEl.querySelector('#vinculatedArtModalContainer');
            const artInnerContainer = modalEl.querySelector('#vinculatedArtModalInner');
            const chevron = modalEl.querySelector('#vinculatedArtChevron');
            let isExpanded = false;
            let artLoaded = false;
            
            const loadVinculatedArt = async () => {
                if (artLoaded) return;
                
                try {
                    const artDoc = await this.db.collection('arts').doc(artId).get();
                    if (!artDoc.exists) return;
                    
                    const artData = artDoc.data();
                    
                    let userData = {};
                    try {
                        const uDoc = await this.db.collection('users').doc(artData.userId).get();
                        if (uDoc.exists) userData = uDoc.data();
                    } catch (e) {
                        console.warn('[ProductModal] artist fetch:', e);
                    }
                    
                    if (vinculatedArtManager) {
                        vinculatedArtManager.destroy();
                    }
                    
                    vinculatedArtManager = new window.ArtManager(this.db, this.auth, 'vinculatedArtModalInner');
                    
                    const artEl = vinculatedArtManager.createArtElement(
                        artId,
                        artData,
                        userData,
                        this.currentUserId
                    );
                    
                    artEl.style.cssText = `
                        width: 100%;
                        min-width: 0;
                        flex: none;
                        border-radius: 8px;
                        overflow: hidden;
                        box-shadow: none;
                        margin-bottom: 0;
                    `;
                    
                    artInnerContainer.innerHTML = '';
                    artInnerContainer.appendChild(artEl);
                    artLoaded = true;
                    
                } catch (error) {
                    console.error('[ProductModal] Error loading vinculated art:', error);
                    artInnerContainer.innerHTML = '<p class="text-muted small text-center">Erro ao carregar arte</p>';
                }
            };
            
            if (toggleBtn) {
                toggleBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    
                    if (!isExpanded) {
                        await loadVinculatedArt();
                        artContainer.classList.add('show');
                        if (chevron) {
                            chevron.className = 'fas fa-chevron-up';
                        }
                        isExpanded = true;
                    } else {
                        artContainer.classList.remove('show');
                        if (chevron) {
                            chevron.className = 'fas fa-chevron-down';
                        }
                        isExpanded = false;
                    }
                });
            }
        }

        // ── Attach size chip listeners ────────────────────────────────────────
        const attachSizeListeners = () => {
            modalEl.querySelectorAll('.size-chip:not([disabled])').forEach(btn => {
                btn.removeEventListener('click', btn._clickHandler);
                btn._clickHandler = function() {
                    modalEl.querySelectorAll('.size-chip').forEach(b => b.classList.remove('selected'));
                    this.classList.add('selected');

                    const variantData = JSON.parse(this.dataset.variantFull || '{}');
                    const basePrice   = parseFloat(this.dataset.basePrice);
                    const totalPrice  = parseFloat(this.dataset.totalPrice);
                    selectedVariant   = {
                        id:         variantData.sku || variantData.id,
                        sku:        variantData.sku || variantData.id,
                        dimona_sku: variantData.dimona_sku || variantData.sku || variantData.id,
                        variant_id: variantData.sku || variantData.id,
                        color:      this.dataset.color,
                        size:       this.dataset.size,
                        price:      totalPrice,
                        base_price: basePrice,
                        color_code: variantData.color_code,
                        colorCode:  variantData.colorCode,
                        pricing:    variantData.pricing || null,
                    };
                    confirmBtn.disabled  = false;
                    confirmBtn.innerHTML = `<i class="fas fa-shopping-cart me-1"></i> Confirmar — R$ ${totalPrice.toFixed(2).replace('.',',')}`;
                };
                btn.addEventListener('click', btn._clickHandler);
            });
        };

        // ── Color dots ────────────────────────────────────────────────────────
        modalEl.querySelectorAll('.color-option-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                modalEl.querySelectorAll('.color-option-btn').forEach(b => b.style.borderColor = '#ccc');
                this.style.borderColor = '#007bff';
                currentColor = this.dataset.color;

                const nameEl = modalEl.querySelector('#selected-color-name');
                if (nameEl) nameEl.textContent = self.getColorName(this.dataset.colorCode, variantsByColor[currentColor][0]?.color || currentColor);

                const tc = document.getElementById('thumbnail-container');
                if (tc) tc.innerHTML = self.createThumbnailDisplay(productData, currentColor);

                const sc = document.getElementById('size-options-container');
                if (sc) sc.innerHTML = sizesHtml(variantsByColor[currentColor]);

                selectedVariant = null;
                confirmBtn.disabled  = true;
                confirmBtn.innerHTML = `<i class="fas fa-shopping-cart me-1"></i> Confirmar`;
                attachSizeListeners();
            });
        });

        // ── Open size panel ───────────────────────────────────────────────────
        const openSizeBtn = modalEl.querySelector('.open-size-panel-btn');
        if (openSizeBtn) {
            openSizeBtn.addEventListener('click', () => {
                sizePanel.classList.add('open');
            });
        }

        // ── Back from size panel ──────────────────────────────────────────────
        const backBtn = modalEl.querySelector('.back-from-size-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                sizePanel.classList.remove('open');
            });
        }

        // ── Confirm size → add to cart ────────────────────────────────────────
        confirmBtn.addEventListener('click', () => {
            if (selectedVariant) {
                sizePanel.classList.remove('open');
                bootstrap.Modal.getInstance(modalEl)?.hide();
                this._handleBuyFromModal(productData, selectedVariant, designerInfo);
            }
        });

        // ── Ver produto ───────────────────────────────────────────────────────
        const verProdutoBtn = modalEl.querySelector('.ver-produto-btn');
        if (verProdutoBtn) {
            verProdutoBtn.addEventListener('click', () => {
                bootstrap.Modal.getInstance(modalEl)?.hide();
                window.location.href = `/produto.html?id=${productId || productData.id}`;
            });
        }

        // ── Frente/costas buttons ─────────────────────────────────────────────
        modalEl.addEventListener('click', e => {
            const btn = e.target.closest('.thumb-side-btn');
            if (!btn) return;
            modalEl.querySelectorAll('.thumb-side-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const img = document.getElementById('modal-thumb-img');
            if (img) img.src = btn.dataset.src;
        });

        attachSizeListeners();

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('hidden.bs.modal', function() { 
            if (vinculatedArtManager) {
                vinculatedArtManager.destroy();
                vinculatedArtManager = null;
            }
            this.remove(); 
        });
    }

    showShareModal(productId, productTitle) {
        const productUrl = `${window.location.origin}/produto.html?id=${productId}`;

        const existing = document.getElementById('shareProductModal');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="shareProductModal" tabindex="-1">
                <div class="modal-dialog modal-sm modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header border-0 pb-0">
                            <h6 class="modal-title">Compartilhar produto</h6>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted small mb-2">${this.escapeHtml(productTitle)}</p>
                            <div class="input-group">
                                <input type="text" class="form-control form-control-sm share-link-input"
                                       value="${productUrl}" readonly>
                                <button class="btn btn-outline-primary btn-sm copy-link-btn" type="button">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                            <div class="copy-feedback text-success small mt-1" style="display:none;">
                                <i class="fas fa-check me-1"></i>Link copiado!
                            </div>
                        </div>
                    </div>
                </div>
            </div>`);

        const modalEl  = document.getElementById('shareProductModal');
        const input    = modalEl.querySelector('.share-link-input');
        const copyBtn  = modalEl.querySelector('.copy-link-btn');
        const feedback = modalEl.querySelector('.copy-feedback');

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(input.value).then(() => {
                feedback.style.display = 'block';
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    feedback.style.display = 'none';
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                }, 2000);
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                feedback.style.display = 'block';
                setTimeout(() => { feedback.style.display = 'none'; }, 2000);
            });
        });

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('hidden.bs.modal', function() { this.remove(); });
    }

    // ─── Vinculate Art to Product ───────────────────────────────────────────

    async showVinculateArtModal(productId, productData, modalElementToClose = null) {
        if (this.currentUserId !== productData.designerUserId) {
            console.warn("[ProductManager] Usuário não é o dono do produto");
            alert("Apenas o criador do produto pode vincular uma arte.");
            return;
        }

        const existingModal = document.getElementById('vinculateArtGlobalModal');
        if (existingModal) existingModal.remove();

        let userArts = [];
        let selectedArtId = productData.artId || null;

        try {
            const artsSnapshot = await this.db.collection('arts')
                .where('userId', '==', this.currentUserId)
                .orderBy('createdAt', 'desc')
                .get();

            if (artsSnapshot.empty) {
                userArts = [];
            } else {
                userArts = artsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
        } catch (error) {
            console.error("[ProductManager] Erro ao carregar artes:", error);
        }

        const artsHtml = userArts.length === 0 
            ? '<div class="text-center text-muted py-4"><i class="fas fa-paintbrush fa-2x mb-2 d-block"></i>Você ainda não tem nenhuma arte criada.<br><a href="/canvas-arte.html" class="btn btn-sm btn-primary mt-2">Criar arte</a></div>'
            : userArts.map(art => {
                const isSelected = selectedArtId === art.id;
                const thumbnail = art.thumbnail || art.image || '';
                const title = art.title || art.name || 'Sem título';
                return `
                    <div class="art-card ${isSelected ? 'selected' : ''}" data-art-id="${art.id}" data-art-title="${this.escapeHtml(title)}" data-art-thumb="${this.escapeHtml(thumbnail)}">
                        <div class="art-card-img-wrapper">
                            ${thumbnail ? `<img src="${thumbnail}" alt="${this.escapeHtml(title)}">` : `<div class="art-card-placeholder"><i class="fas fa-image"></i></div>`}
                        </div>
                        <div class="art-card-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</div>
                        ${isSelected ? '<div class="art-card-badge"><i class="fas fa-check-circle"></i> Vinculada</div>' : ''}
                    </div>
                `;
            }).join('');

        const modalHtml = `
            <style>
                #vinculateArtGlobalModal .modal-content {
                    border-radius: 20px;
                    overflow: hidden;
                }
                #vinculateArtGlobalModal .modal-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-bottom: none;
                    padding: 1rem 1.5rem;
                }
                #vinculateArtGlobalModal .modal-header .btn-close {
                    filter: brightness(0) invert(1);
                }
                #vinculateArtGlobalModal .modal-title {
                    font-weight: 600;
                }
                #vinculateArtGlobalModal .arts-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 16px;
                    max-height: 60vh;
                    overflow-y: auto;
                    padding: 8px 4px;
                }
                #vinculateArtGlobalModal .art-card {
                    background: #fff;
                    border-radius: 16px;
                    overflow: hidden;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: 2px solid #e0e0e0;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                    position: relative;
                }
                #vinculateArtGlobalModal .art-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 8px 20px rgba(0,0,0,0.12);
                    border-color: #667eea;
                }
                #vinculateArtGlobalModal .art-card.selected {
                    border-color: #28a745;
                    background: #f0fff4;
                    box-shadow: 0 4px 12px rgba(40,167,69,0.2);
                }
                #vinculateArtGlobalModal .art-card-img-wrapper {
                    aspect-ratio: 1;
                    background: #f5f5f5;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                }
                #vinculateArtGlobalModal .art-card-img-wrapper img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: transform 0.3s ease;
                }
                #vinculateArtGlobalModal .art-card:hover .art-card-img-wrapper img {
                    transform: scale(1.05);
                }
                #vinculateArtGlobalModal .art-card-placeholder {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f0f0f0;
                    color: #aaa;
                    font-size: 2rem;
                }
                #vinculateArtGlobalModal .art-card-title {
                    padding: 8px 10px;
                    font-size: 0.75rem;
                    font-weight: 500;
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    background: #fff;
                    border-top: 1px solid #eee;
                }
                #vinculateArtGlobalModal .art-card-badge {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: #28a745;
                    color: white;
                    border-radius: 20px;
                    padding: 2px 8px;
                    font-size: 0.65rem;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                }
                #vinculateArtGlobalModal .art-card-badge i {
                    font-size: 0.7rem;
                }
                #vinculateArtGlobalModal .modal-footer {
                    padding: 1rem 1.5rem;
                    background: #f8f9fa;
                    border-top: 1px solid #eee;
                }
                @media (max-width: 576px) {
                    #vinculateArtGlobalModal .arts-grid {
                        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                        gap: 12px;
                    }
                    #vinculateArtGlobalModal .modal-dialog {
                        margin: 0.5rem;
                    }
                }
            </style>
            <div class="modal fade" id="vinculateArtGlobalModal" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-link me-2"></i>Vincular arte ao produto
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted small mb-3">
                                <i class="fas fa-info-circle me-1"></i>
                                Selecione uma das suas artes para vincular a <strong>"${this.escapeHtml(productData.productTitle || 'este produto')}"</strong>
                            </p>
                            <div class="arts-grid" id="vinculateArtsGrid">
                                ${artsHtml}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">
                                <i class="fas fa-times me-1"></i>Cancelar
                            </button>
                            <button type="button" class="btn btn-outline-danger" id="removeVinculateArtBtn" style="${!productData.artId ? 'display:none;' : ''}">
                                <i class="fas fa-trash-alt me-1"></i>Remover vínculo
                            </button>
                            <button type="button" class="btn btn-primary" id="confirmVinculateArtBtn" ${!selectedArtId ? 'disabled' : ''}>
                                <i class="fas fa-check me-1"></i>Confirmar vinculação
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalElement = document.getElementById('vinculateArtGlobalModal');
        const confirmBtn = document.getElementById('confirmVinculateArtBtn');
        const removeBtn = document.getElementById('removeVinculateArtBtn');
        
        let currentSelectedArtId = selectedArtId;

        const attachCardEvents = () => {
            document.querySelectorAll('#vinculateArtGlobalModal .art-card').forEach(card => {
                card.removeEventListener('click', card._clickHandler);
                card._clickHandler = () => {
                    const artId = card.dataset.artId;
                    const artTitle = card.dataset.artTitle;
                    const artThumb = card.dataset.artThumb;
                    
                    document.querySelectorAll('#vinculateArtGlobalModal .art-card').forEach(c => {
                        c.classList.remove('selected');
                        const badge = c.querySelector('.art-card-badge');
                        if (badge) badge.remove();
                    });
                    
                    card.classList.add('selected');
                    if (!card.querySelector('.art-card-badge')) {
                        const badge = document.createElement('div');
                        badge.className = 'art-card-badge';
                        badge.innerHTML = '<i class="fas fa-check-circle"></i> Vinculada';
                        card.appendChild(badge);
                    }
                    
                    currentSelectedArtId = artId;
                    confirmBtn.disabled = false;
                };
                card.addEventListener('click', card._clickHandler);
            });
        };

        attachCardEvents();

        confirmBtn.addEventListener('click', async () => {
            if (!currentSelectedArtId) {
                alert('Por favor, selecione uma arte.');
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Vinculando...';

            try {
                const artDoc = await this.db.collection('arts').doc(currentSelectedArtId).get();
                if (!artDoc.exists) {
                    throw new Error('Arte não encontrada');
                }

                const artData = artDoc.data();
                
                await this.db.collection('products').doc(productId).update({
                    artId: currentSelectedArtId,
                    artThumbnailUrl: artData.thumbnail || artData.image || '',
                    artTitle: artData.title || artData.name || 'Sem título',
                    updatedAt: new Date()
                });

                const modal = bootstrap.Modal.getInstance(modalElement);
                modal.hide();

                this._showToast('Arte vinculada com sucesso!', 'success');
                
                if (modalElementToClose) {
                    setTimeout(() => location.reload(), 500);
                } else {
                    this.refreshProducts();
                }

            } catch (error) {
                console.error('[ProductManager] Erro ao vincular arte:', error);
                alert('Erro ao vincular arte. Tente novamente.');
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fas fa-check me-1"></i>Confirmar vinculação';
            }
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                if (!confirm('Deseja remover o vínculo com a arte?')) return;

                removeBtn.disabled = true;
                removeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Removendo...';

                try {
                    await this.db.collection('products').doc(productId).update({
                        artId: firebase.firestore.FieldValue.delete(),
                        artThumbnailUrl: firebase.firestore.FieldValue.delete(),
                        artTitle: firebase.firestore.FieldValue.delete(),
                        updatedAt: new Date()
                    });

                    const modal = bootstrap.Modal.getInstance(modalElement);
                    modal.hide();

                    this._showToast('Vínculo removido com sucesso!', 'success');
                    
                    if (modalElementToClose) {
                        setTimeout(() => location.reload(), 500);
                    } else {
                        this.refreshProducts();
                    }

                } catch (error) {
                    console.error('[ProductManager] Erro ao remover vínculo:', error);
                    alert('Erro ao remover vínculo. Tente novamente.');
                    removeBtn.disabled = false;
                    removeBtn.innerHTML = '<i class="fas fa-trash-alt me-1"></i>Remover vínculo';
                }
            });
        }

        modalElement.addEventListener('hidden.bs.modal', () => {
            modalElement.remove();
        });

        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }

    _showToast(message, type = 'success') {
        const existing = document.querySelector('.global-toast-wrapper');
        if (existing) existing.remove();
        
        const bgColor = type === 'success' ? 'bg-success' : 'bg-danger';
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
        
        document.body.insertAdjacentHTML('beforeend', `
            <div class="position-fixed bottom-0 end-0 p-3 global-toast-wrapper" style="z-index: 9999;">
                <div class="toast show ${bgColor} text-white" role="alert" style="min-width: 200px;">
                    <div class="toast-header ${bgColor} text-white border-0">
                        <i class="fas ${icon} me-2"></i>
                        <strong class="me-auto">Kauara</strong>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
                    </div>
                    <div class="toast-body">
                        ${message}
                    </div>
                </div>
            </div>
        `);
        
        setTimeout(() => document.querySelector('.global-toast-wrapper')?.remove(), 3000);
    }

    _handleBuyFromModal(productData, selectedVariant, designerInfo) {
        try {
            const freight = window.ShippingManager?.getFreight() || 0;
            
            const productWithVariant = {
                ...productData,
                firestoreProductId: productData.id,
                provider:           'dimona',
                selectedVariant: {
                    ...selectedVariant,
                },
                freight: freight,
                pricing: selectedVariant.pricing || {
                    product_price: (selectedVariant.base_price || selectedVariant.price - freight) * 0.7,
                    artist_cut:    (selectedVariant.base_price || selectedVariant.price - freight) * 0.25,
                    platform_fee:  8.00,
                    total_price:   selectedVariant.price,
                    currency:      'BRL'
                },
                dimona_sku:        selectedVariant.dimona_sku || selectedVariant.sku || selectedVariant.id,
                designUrls:        productData.designUrls || {},
                designUrl:         productData.designUrls?.front || productData.designUrl,
                designerName:      designerInfo?.name || productData.designerName || 'Unknown Designer',
                designerUserId:    productData.designerUserId,
                thumbnailUrl:      productData.thumbnailUrls?.front || productData.thumbnailUrl || productData.thumbnail,
                pix_key:           designerInfo?.pix_key || null,
                pix_keyType:       designerInfo?.pix_keyType || null,
                designerEmail:     designerInfo?.email || null,
                purchaseTimestamp: new Date().toISOString(),
                cartItemId:        Date.now() + Math.random().toString(36).substr(2, 9)
            };

            bootstrap.Modal.getInstance(document.getElementById('productModal'))?.hide();
            this._addToCart(productWithVariant);
        } catch (e) {
            console.error('[ProductManagerDimona] _handleBuyFromModal error:', e);
            alert('Erro ao adicionar produto ao carrinho. Tente novamente.');
        }
    }

    async _addToCart(productData) {
        try {
            let cart = JSON.parse(localStorage.getItem('cart') || '[]');
            const exists = cart.findIndex(item =>
                item.firestoreProductId === productData.firestoreProductId &&
                (item.selectedVariant?.dimona_sku || item.selectedVariant?.sku || item.selectedVariant?.id) ===
                (productData.selectedVariant?.dimona_sku || productData.selectedVariant?.sku || productData.selectedVariant?.id)
            );
            if (exists !== -1) {
                alert('Este produto já está no seu carrinho!');
                return;
            }
            cart.push(productData);
            localStorage.setItem('cart', JSON.stringify(cart));

            await this._syncCartItemToFirestore(productData);

            this._showCartToast();
        } catch (e) {
            console.error('[ProductManager] _addToCart error:', e);
            alert('Erro ao adicionar produto ao carrinho. Por favor, tente novamente.');
        }
    }

    async _syncCartItemToFirestore(productData) {
        try {
            const firestoreUserId = this.currentUserId;
            if (!firestoreUserId) {
                console.warn('Cart nao salvo no Firestore: usuario nao logado');
                return;
            }

            const cartKey = item => {
                if (item.cartItemId) return item.cartItemId;
                if (item.firestoreProductId) return item.firestoreProductId;
                if (item.product_id) {
                    const size  = (item.selectedVariant && item.selectedVariant.size)  || '';
                    const color = (item.selectedVariant && item.selectedVariant.color) || '';
                    return (item.product_id + '_' + size + '_' + color).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
                }
                return JSON.stringify({ t: item.productTitle, v: item.selectedVariant })
                    .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
            };
            const key = cartKey(productData);

            const {
                variants,
                availableColors,
                availableSizes,
                totalVariants,
                ...cartItem
            } = productData;

            const sanitize = obj => {
                if (obj === undefined) return null;
                if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
                return Object.fromEntries(
                    Object.entries(obj).map(([k, v]) => [k, sanitize(v)])
                );
            };

            await this.db.collection('users').doc(firestoreUserId)
                .collection('cart').doc(key)
                .set({ ...sanitize(cartItem), _synced_at: new Date().toISOString() }, { merge: true });

            console.log('Cart salvo no Firestore: users/' + firestoreUserId + '/cart/' + key);
        } catch (err) {
            console.error('Erro ao salvar cart no Firestore:', err);
        }
    }

    _showCartToast() {
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
        setTimeout(() => document.querySelector('.cart-toast-wrapper')?.remove(), 3000);
    }

    // ─── Delete product ───────────────────────────────────────────────────────

    async _deleteProduct(productId, filterUserId) {
        try {
            const productRef = this.db.collection("products").doc(productId);
            const productDoc = await productRef.get();
            if (!productDoc.exists) throw new Error("Product doesn't exist");

            const currentUser = await this.getCurrentUser();
            if (!currentUser || currentUser.firestoreUserId !== productDoc.data().designerUserId) {
                throw new Error("You can only delete your own products");
            }

            const batch1 = this.db.batch();
            batch1.delete(productRef);

            const [likesSnap, commentsSnap] = await Promise.all([
                this.db.collection("product_likes").where("productId", "==", productId).get(),
                this.db.collection("product_comments").where("productId", "==", productId).get()
            ]);

            likesSnap.forEach(doc => batch1.delete(doc.ref));
            const commentIds = commentsSnap.docs.map(doc => doc.id);
            commentsSnap.forEach(doc => batch1.delete(doc.ref));
            await batch1.commit();

            if (commentIds.length > 0) {
                const batch2 = this.db.batch();
                for (const commentId of commentIds) {
                    const clSnap = await this.db.collection("product_comment_likes")
                        .where("commentId", "==", commentId).get();
                    clSnap.forEach(doc => batch2.delete(doc.ref));
                }
                await batch2.commit();
            }

            alert("Product deleted successfully.");
            this.displayProducts(filterUserId);
        } catch (error) {
            console.error("[ProductManager] _deleteProduct error:", error);
            alert(`Failed to delete product: ${error.message}`);
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    /** Call when unmounting to prevent memory leaks. */
    destroy() {
        if (this.freightUnsubscribe) {
            this.freightUnsubscribe();
        }
        this.commentsManager.cleanupAllListeners();
    }
};

window.initializeProductManagerDimona = function(containerId) {
    return new window.ProductManagerDimona(db, auth, containerId);
};