console.log("shared-products.js loaded!");

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

window.ProductManager = class ProductManager {
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

    // ─── Display products ─────────────────────────────────────────────────────

    async displayProducts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container || this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) currentUserId = this.currentUserId;

        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML   = "<p>Loading products...</p>";
            this.lastVisibleProduct    = null;
            this.currentFilterUserId   = filterUserId;
        }

        try {
            let query = this.db.collection("products").orderBy("createdAt", "desc");
            if (this.currentFilterUserId) query = query.where("designerUserId", "==", this.currentFilterUserId);
            query = query.limit(this.batchSize);
            if (loadMore && this.lastVisibleProduct) query = query.startAfter(this.lastVisibleProduct);

            const snapshot = await query.get();
            if (snapshot.empty) {
                if (!loadMore) this.container.innerHTML = "<p>No products available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().designerUserId);
            await this.cacheUsers([...new Set(userIds)]);

            if (!loadMore) this.container.innerHTML = "";

            // Pre-warm likes cache for this batch
            const productIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                productIds, PRODUCT_CONFIG.likesCollection, "productId", "userId", currentUserId
            );

            snapshot.docs.forEach(doc => {
                const productData      = doc.data();
                const userData         = this.usersCache[productData.designerUserId] || {};
                const isCurrentUser    = currentUserId === productData.designerUserId;
                const productEl        = this.createProductElement(doc.id, productData, userData, currentUserId, isCurrentUser);
                this.container.appendChild(productEl);
            });

            this.lastVisibleProduct = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                this._observeLastElement(this.container.lastElementChild, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("[ProductManager] displayProducts error:", error);
            if (!loadMore) this.container.innerHTML = "<p>Error loading products.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    _observeLastElement(el, filterUserId) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading) {
                    observer.disconnect();
                    this.displayProducts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });
        observer.observe(el);
    }

    // ─── Create product element ───────────────────────────────────────────────

    createProductElement(productId, productData, userData, currentUserId, isCurrentUserProduct) {
        const timestamp     = productData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const thumbnailSrc       = productData.thumbnailUrl || productData.thumbnail;
        const priceDisplay       = this.getPriceDisplay(productData);
        const firstVariant       = productData.variants?.find(v => this.isVariantAvailable(v)) || productData.variants?.[0];
        const backgroundColor    = firstVariant?.color_code || firstVariant?.colorCode || '#f8f9fa';

        const productEl = document.createElement("div");
        productEl.className = "card mb-4 product-card";
        productEl.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../public/images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     style="width:40px;height:40px;object-fit:cover;cursor:pointer;"
                     data-user-id="${productData.designerUserId}"
                     onerror="this.src='../public/images/default-profile.png'">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor:pointer;" data-user-id="${productData.designerUserId}">
                        ${userData.user_Name || "Unknown Designer"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <h5 class="card-title">${productData.productTitle}</h5>
                <div class="product-price-section mb-3">${priceDisplay}</div>
                <div class="product-image-container d-inline-block"
                     style="background-color:${backgroundColor};border-radius:8px;line-height:0;">
                    ${thumbnailSrc ? `
                        <img src="${thumbnailSrc}"
                             class="img-fluid rounded product-image lazy-load"
                             alt="${productData.productTitle}"
                             style="max-width:100%;max-height:500px;width:auto;height:auto;object-fit:contain;cursor:pointer;display:block;"
                             loading="lazy"
                             onerror="this.src='../public/images/default-product.png'"
                             data-product-id="${productId}">
                    ` : `<div class="text-muted p-4 text-center" style="width:300px;height:300px;">
                            <i class="fas fa-image fa-3x mb-2"></i><p>No image available</p>
                         </div>`}
                </div>
                ${productData.description ? `<p class="card-text mt-3">${productData.description}</p>` : ''}
                <div class="product-variants mt-3">
                    <h6>Available Options:</h6>
                    <div class="d-flex flex-wrap gap-2">${this.getVariantPreview(productData.variants)}</div>
                </div>
            </div>
            <div class="card-footer">
                <button class="btn btn-outline-primary like-button" data-product-id="${productId}">
                    <span class="like-count">${productData.likes_count || 0}</span> Likes
                </button>
                <button class="btn btn-success buy-button" data-product-id="${productId}">
                    <i class="fas fa-shopping-cart me-1"></i> Buy Now
                </button>
                <button class="btn btn-outline-secondary comments-toggle-button" data-product-id="${productId}">
                    Show Comments
                </button>
                <div class="comments-container mt-3" id="comments-${productId}" style="display:none;"></div>
                <div class="comment-input-container mt-2" id="commentInputContainer-${productId}" style="display:none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input"
                               placeholder="Write a comment..." id="commentInput-${productId}">
                        <button class="btn btn-outline-primary comment-submit" data-product-id="${productId}">Post</button>
                    </div>
                </div>
                ${isCurrentUserProduct ? `<button class="btn btn-danger mt-2 delete-product-button" data-product-id="${productId}">Delete Product</button>` : ''}
            </div>
        `;

        this._setupProductEventListeners(productEl, productId, productData, currentUserId, isCurrentUserProduct);
        return productEl;
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
            await this.likesManager.toggleLike(
                productId,
                PRODUCT_CONFIG,
                likeBtn,
                () => this.getCurrentUser()
            );
        });

        // Buy button
        productEl.querySelector('.buy-button')?.addEventListener('click', async () => {
            const designerInfo = await this.getDesignerWithPixKey(productData.designerUserId);
            this.showProductModal(productData, designerInfo);
        });

        // Image click
        productEl.querySelector('.product-image')?.addEventListener('click', () => {
            this.showImageLightboxModal(productData);
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
                    commentsLoaded = true;
                }
                commentsContainer.style.display     = "block";
                commentInputContainer.style.display  = "block";
                toggleBtn.textContent = "Hide Comments";
            } else {
                commentsContainer.style.display     = "none";
                commentInputContainer.style.display  = "none";
                toggleBtn.textContent = "Show Comments";
            }
        });

        // Comment submit — delegate to SharedCommentsManager
        const commentInput = productEl.querySelector('.comment-input');
        const submitBtn    = productEl.querySelector('.comment-submit');
        const doSubmit     = () => this.commentsManager.submitComment(
            productId, commentInput, commentsContainer, PRODUCT_CONFIG, () => this.getCurrentUser()
        );
        submitBtn?.addEventListener('click', doSubmit);
        commentInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });

        // Delete product (owner only)
        productEl.querySelector('.delete-product-button')?.addEventListener('click', () => {
            if (confirm("Are you sure you want to delete this product and all its comments and likes?")) {
                this._deleteProduct(productId, this.currentFilterUserId);
            }
        });
    }

    // ─── Variant / price helpers (unchanged from original) ───────────────────

    getVariantPreview(variants) {
        if (!variants || variants.length === 0) return '<span class="text-muted">No variants available</span>';
        const colorGroups = {};
        variants.forEach(variant => {
            if (this.isVariantAvailable(variant)) {
                const color = variant.color || 'Default';
                if (!colorGroups[color]) colorGroups[color] = { color, color_code: variant.color_code, sizes: new Set() };
                if (variant.size) colorGroups[color].sizes.add(variant.size);
            }
        });
        return Object.values(colorGroups).map(group => {
            const sizeText  = Array.from(group.sizes).slice(0, 2).join(', ');
            const moreSizes = group.sizes.size > 2 ? ` +${group.sizes.size - 2} more` : '';
            const colorDot  = group.color_code
                ? `<span style="background:${group.color_code};width:12px;height:12px;display:inline-block;margin-right:5px;border-radius:50%;border:1px solid #ddd;vertical-align:middle;"></span>`
                : '';
            return `<span class="badge bg-secondary me-1 mb-1">${colorDot}${group.color}: ${sizeText}${moreSizes}</span>`;
        }).join('');
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
        if (!productData.variants?.length) return '<strong class="text-muted">Price not available</strong>';
        const prices = productData.variants
            .filter(v => this.isVariantAvailable(v))
            .map(v => parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0))
            .filter(p => p > 0);
        if (!prices.length) return '<strong class="text-muted">Price not available</strong>';
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
        if (s.product_price_range) html += `<small class="text-muted d-block">Base cost: R$ ${s.product_price_range.min.toFixed(2)} - R$ ${s.product_price_range.max.toFixed(2)}</small>`;
        if (s.artist_cut)          html += `<small class="text-muted d-block">Artist markup: R$ ${s.artist_cut.toFixed(2)}</small>`;
        if (s.platform_fee_percentage) html += `<small class="text-muted d-block">Platform fee: ${s.platform_fee_percentage * 100}%</small>`;
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
        if (!variants?.length) return '<p class="text-muted">No sizes available</p>';
        const order = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL'];
        return [...variants]
            .sort((a,b) => order.indexOf(a.size||'') - order.indexOf(b.size||''))
            .map(v => {
                const available = this.isVariantAvailable(v);
                const price     = parseFloat(v.pricing?.total_price || v.retail_price || v.price || 0);
                const priceStr  = price > 0 ? `R$ ${price.toFixed(2)}` : 'Price N/A';
                return `<button class="btn btn-outline-secondary size-option ${available ? '' : 'disabled'}"
                            data-variant-id="${v.id}"
                            data-variant-full='${JSON.stringify(v).replace(/'/g, "\\'")}'
                            data-color="${v.color}"
                            data-size="${v.size}"
                            data-price="${price}"
                            ${!available ? 'disabled' : ''}>
                            ${v.size || 'One Size'} ${!available ? '(Unavailable)' : `- ${priceStr}`}
                        </button>`;
            }).join('');
    }

    createThumbnailDisplay(productData, selectedColor) {
        const src         = productData.thumbnailUrl || productData.thumbnail;
        const colorVars   = this.groupVariantsByColor(productData.variants)[selectedColor] || [];
        const colorCode   = colorVars[0]?.color_code || colorVars[0]?.colorCode || '#ffffff';
        return src
            ? `<div style="background-color:${colorCode};border-radius:8px;line-height:0;">
                   <img src="${src}" class="img-fluid rounded" alt="${productData.productTitle}"
                        style="max-width:300px;max-height:300px;width:auto;height:auto;object-fit:contain;display:block;">
               </div>`
            : `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-3x mb-2"></i><p>No image available</p></div>`;
    }

    createLightboxThumbnailDisplay(productData, selectedColor) {
        const src       = productData.thumbnailUrl || productData.thumbnail;
        const colorVars = this.groupVariantsByColor(productData.variants)[selectedColor] || [];
        const colorCode = colorVars[0]?.color_code || colorVars[0]?.colorCode || '#ffffff';
        return src
            ? `<div style="background-color:${colorCode};border-radius:8px;padding:20px;text-align:center;">
                   <img src="${src}" class="img-fluid rounded" alt="${productData.productTitle}"
                        style="max-width:100%;max-height:70vh;width:auto;height:auto;object-fit:contain;">
               </div>`
            : `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-5x mb-3"></i><p>No image available</p></div>`;
    }

    // ─── Product modals (unchanged from original) ─────────────────────────────

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

    showImageLightboxModal(productData) {
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups     = Object.keys(variantsByColor);
        const self            = this;

        const existing = document.getElementById('imageLightboxModal');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="imageLightboxModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${productData.productTitle}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-8 text-center">
                                    <div id="lightbox-thumbnail-container" class="mb-4">
                                        ${this.createLightboxThumbnailDisplay(productData, colorGroups[0])}
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    ${productData.description ? `<p class="mb-3">${productData.description}</p>` : ''}
                                    <div class="color-selection mb-4">
                                        <h6>Select Color:</h6>
                                        <div class="color-options d-flex flex-wrap gap-2" id="lightbox-color-options">
                                            ${colorGroups.map((color, i) => {
                                                const fv = variantsByColor[color][0];
                                                const cc = fv?.color_code || fv?.colorCode || '#ffffff';
                                                return `<button class="btn color-option-btn ${i===0?'active':''}"
                                                            data-color="${color}" data-color-code="${cc}"
                                                            style="background-color:${cc};color:${this.getContrastColor(cc)};border:2px solid ${i===0?'#007bff':'transparent'};width:40px;height:40px;border-radius:50%;"
                                                            title="${this.getColorName(cc, fv?.color||color)}"></button>`;
                                            }).join('')}
                                        </div>
                                        <small class="text-muted" id="lightbox-selected-color-name">
                                            ${this.getColorName(variantsByColor[colorGroups[0]][0]?.color_code, variantsByColor[colorGroups[0]][0]?.color||colorGroups[0])}
                                        </small>
                                    </div>
                                    <button class="btn btn-success w-100 mt-3 lightbox-buy-button">
                                        <i class="fas fa-shopping-cart me-1"></i> Buy Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`);

        const modalEl = document.getElementById('imageLightboxModal');
        let currentColor = colorGroups[0];

        modalEl.querySelectorAll('.color-option-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                modalEl.querySelectorAll('.color-option-btn').forEach(b => b.style.borderColor = 'transparent');
                this.style.borderColor = '#007bff';
                currentColor = this.dataset.color;
                const name = modalEl.querySelector('#lightbox-selected-color-name');
                if (name) name.textContent = self.getColorName(this.dataset.colorCode, variantsByColor[currentColor][0]?.color || currentColor);
                const c = document.getElementById('lightbox-thumbnail-container');
                if (c) c.innerHTML = self.createLightboxThumbnailDisplay(productData, currentColor);
            });
        });

        modalEl.querySelector('.lightbox-buy-button')?.addEventListener('click', async () => {
            bootstrap.Modal.getInstance(modalEl)?.hide();
            const designerInfo = await this.getDesignerWithPixKey(productData.designerUserId);
            this.showProductModal(productData, designerInfo);
        });

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('hidden.bs.modal', function() { this.remove(); });
    }

    showProductModal(productData, designerInfo = null) {
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups     = Object.keys(variantsByColor);
        const self            = this;

        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="productModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${productData.productTitle}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6 text-center">
                                    <div id="thumbnail-container" class="mb-4">
                                        ${this.createThumbnailDisplay(productData, colorGroups[0])}
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    ${productData.description ? `<p class="mb-3">${productData.description}</p>` : ''}
                                    <div class="price-section mb-4">${this.getModalPriceDisplay(productData)}</div>
                                    <div class="color-selection mb-4">
                                        <h6>Select Color:</h6>
                                        <div class="color-options d-flex flex-wrap gap-2" id="color-options-container">
                                            ${colorGroups.map((color, i) => {
                                                const fv = variantsByColor[color][0];
                                                const cc = fv?.color_code || fv?.colorCode || '#ffffff';
                                                return `<button class="btn color-option-btn ${i===0?'active':''}"
                                                            data-color="${color}" data-color-code="${cc}"
                                                            style="background-color:${cc};color:${this.getContrastColor(cc)};border:2px solid ${i===0?'#007bff':'transparent'};width:40px;height:40px;border-radius:50%;"
                                                            title="${this.getColorName(cc, fv?.color||color)}"></button>`;
                                            }).join('')}
                                        </div>
                                        <small class="text-muted" id="selected-color-name">
                                            ${this.getColorName(variantsByColor[colorGroups[0]][0]?.color_code, variantsByColor[colorGroups[0]][0]?.color||colorGroups[0])}
                                        </small>
                                    </div>
                                    <div class="size-selection mb-4">
                                        <h6>Select Size:</h6>
                                        <div id="size-options-container">${this.createSizeOptions(variantsByColor[colorGroups[0]])}</div>
                                    </div>
                                    <div class="selected-variant mt-3 p-3 border rounded" style="display:none;">
                                        <h6>Selected Option:</h6>
                                        <div class="variant-info">
                                            <span class="selected-color-size"></span>
                                            <span class="selected-price text-primary fw-bold"></span>
                                        </div>
                                        <small class="text-muted mt-1 d-block" id="selected-variant-details"></small>
                                    </div>
                                    <button class="btn btn-success w-100 mt-3 buy-from-modal" disabled>
                                        <i class="fas fa-shopping-cart me-1"></i> Proceed to Checkout
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`);

        const modalEl = document.getElementById('productModal');
        let selectedVariant = null;
        let currentColor    = colorGroups[0];

        const attachSizeListeners = () => {
            modalEl.querySelectorAll('.size-option:not(.disabled)').forEach(btn => {
                btn.addEventListener('click', function() {
                    modalEl.querySelectorAll('.size-option').forEach(b => {
                        b.classList.replace('btn-primary', 'btn-outline-secondary');
                    });
                    this.classList.replace('btn-outline-secondary', 'btn-primary');

                    const variantData = JSON.parse(this.dataset.variantFull || '{}');
                    const price       = parseFloat(this.dataset.price);
                    selectedVariant   = {
                        id: parseInt(this.dataset.variantId),
                        variant_id: variantData.variant_id || variantData.id,
                        color: this.dataset.color, size: this.dataset.size,
                        price, color_code: variantData.color_code,
                        colorCode: variantData.colorCode, pricing: variantData.pricing || null
                    };

                    const selectedDiv = modalEl.querySelector('.selected-variant');
                    selectedDiv.querySelector('.selected-color-size').textContent = `${currentColor} - ${selectedVariant.size}`;
                    selectedDiv.querySelector('.selected-price').textContent      = `R$ ${price.toFixed(2)}`;

                    const detailsEl = selectedDiv.querySelector('#selected-variant-details');
                    if (selectedVariant.pricing && detailsEl) {
                        detailsEl.textContent = `Base: R$ ${selectedVariant.pricing.product_price?.toFixed(2)||'0.00'} | Artist: R$ ${selectedVariant.pricing.artist_cut?.toFixed(2)||'0.00'} | Platform: R$ ${selectedVariant.pricing.platform_fee?.toFixed(2)||'0.00'}`;
                    }
                    selectedDiv.style.display = 'block';

                    const buyBtn = modalEl.querySelector('.buy-from-modal');
                    buyBtn.disabled   = false;
                    buyBtn.innerHTML  = `<i class="fas fa-shopping-cart me-1"></i> Proceed to Checkout - R$ ${price.toFixed(2)}`;
                });
            });
        };

        modalEl.querySelectorAll('.color-option-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                modalEl.querySelectorAll('.color-option-btn').forEach(b => b.style.borderColor = 'transparent');
                this.style.borderColor = '#007bff';
                currentColor           = this.dataset.color;
                const name = modalEl.querySelector('#selected-color-name');
                if (name) name.textContent = self.getColorName(this.dataset.colorCode, variantsByColor[currentColor][0]?.color || currentColor);
                const tc = document.getElementById('thumbnail-container');
                if (tc) tc.innerHTML = self.createThumbnailDisplay(productData, currentColor);
                const sc = document.getElementById('size-options-container');
                if (sc) sc.innerHTML = self.createSizeOptions(variantsByColor[currentColor]);
                selectedVariant = null;
                modalEl.querySelector('.selected-variant').style.display = 'none';
                modalEl.querySelector('.buy-from-modal').disabled         = true;
                attachSizeListeners();
            });
        });

        attachSizeListeners();

        modalEl.querySelector('.buy-from-modal').addEventListener('click', () => {
            if (selectedVariant) this._handleBuyFromModal(productData, selectedVariant, designerInfo);
        });

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('hidden.bs.modal', function() { this.remove(); });
    }

    _handleBuyFromModal(productData, selectedVariant, designerInfo) {
        try {
            const productWithVariant = {
                ...productData,
                firestoreProductId: productData.id,
                selectedVariant,
                pricing: selectedVariant.pricing || {
                    product_price: selectedVariant.price * 0.7,
                    artist_cut:    selectedVariant.price * 0.25,
                    platform_fee:  selectedVariant.price * 0.05,
                    total_price:   selectedVariant.price,
                    currency:      'BRL'
                },
                designerName:      designerInfo?.name || productData.designerName || 'Unknown Designer',
                designerUserId:    productData.designerUserId,
                thumbnailUrl:      productData.thumbnailUrl || productData.thumbnail,
                designUrl:         productData.designUrl,
                pix_key:           designerInfo?.pix_key || null,
                pix_keyType:       designerInfo?.pix_keyType || null,
                designerEmail:     designerInfo?.email || null,
                purchaseTimestamp: new Date().toISOString(),
                cartItemId:        Date.now() + Math.random().toString(36).substr(2, 9)
            };

            bootstrap.Modal.getInstance(document.getElementById('productModal'))?.hide();
            this._addToCart(productWithVariant);
        } catch (e) {
            console.error('[ProductManager] _handleBuyFromModal error:', e);
            alert('Error adding product to cart. Please try again.');
        }
    }

    _addToCart(productData) {
        try {
            let cart = JSON.parse(localStorage.getItem('cart') || '[]');
            const exists = cart.findIndex(item =>
                item.firestoreProductId === productData.firestoreProductId &&
                item.selectedVariant?.variant_id === productData.selectedVariant?.variant_id
            );
            if (exists !== -1) {
                alert('Este produto já está no seu carrinho!');
                window.location.href = 'carrinho.html';
                return;
            }
            cart.push(productData);
            localStorage.setItem('cart', JSON.stringify(cart));
            this._showCartToast();
            if (confirm('Produto adicionado ao carrinho!\n\nClique em "OK" para ver o carrinho ou "Cancelar" para continuar comprando.')) {
                window.location.href = 'carrinho.html';
            }
        } catch (e) {
            console.error('[ProductManager] _addToCart error:', e);
            alert('Erro ao adicionar produto ao carrinho. Por favor, tente novamente.');
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
        this.commentsManager.cleanupAllListeners();
    }
};

window.initializeProductManager = function(containerId) {
    return new window.ProductManager(db, auth, containerId);
};