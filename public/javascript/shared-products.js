console.log("shared-products.js loaded!");

// Import PRINT_AREAS from printAreas.js
let PRINT_AREAS = {};

// Dynamically import printAreas.js
async function loadPrintAreas() {
    try {
        const module = await import('./printAreas.js');
        PRINT_AREAS = module.PRINT_AREAS;
        console.log("Print areas loaded successfully:", PRINT_AREAS);
    } catch (error) {
        console.error("Failed to load print areas, using fallback:", error);
    }
}

// Load print areas immediately
loadPrintAreas();

// Constants (match canvas.js exactly)
const DPI = 300;
const cmToPx = DPI / 2.54;

// Make ProductManager available globally
window.ProductManager = class ProductManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {};
        this.productsCache = {};
        this.commentListeners = {};
        this.likesCache = new Map();
        this.commentLikesCache = new Map();
        this.isLiking = new Set();
        this.isCommentLiking = new Set();
        this.lastVisibleProduct = null;
        this.batchSize = 2;
        this.isLoading = false;
        this.currentFilterUserId = filterUserId;
        this.currentUserId = null;

        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    this.currentUserId = await this.getUserIdFromUid(user.uid);
                    console.log("Current user ID set:", this.currentUserId);
                    sessionStorage.setItem('currentFirestoreUserId', this.currentUserId);
                    
                    // Refresh products to show delete buttons if needed
                    if (this.container && this.container.innerHTML.includes("Loading")) {
                        this.displayProducts(this.currentFilterUserId, this.currentUserId);
                    }
                } catch (error) {
                    console.error("Error fetching current user ID:", error);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
                sessionStorage.removeItem('currentFirestoreUserId');
                
                // Refresh products to hide delete buttons
                if (this.container && !this.container.innerHTML.includes("Loading")) {
                    this.displayProducts(this.currentFilterUserId, null);
                }
            }
        });
    }

    async getUserIdFromUid(uid) {
        const userQuery = await this.db.collection("users")
            .where("firebaseUID", "==", uid)
            .get();

        if (!userQuery.empty) {
            return userQuery.docs[0].id;
        } else {
            throw new Error(`No user found for UID: ${uid}`);
        }
    }

    cleanupCommentListeners() {
        for (const productId in this.commentListeners) {
            if (this.commentListeners[productId]) {
                this.commentListeners[productId]();
            }
        }
        this.commentListeners = {};
    }

    async cacheUsers(userIds) {
        if (userIds.length === 0) return;

        const usersQuery = await this.db.collection("users")
            .where("userId", "in", userIds)
            .get();

        usersQuery.forEach(doc => {
            const userData = doc.data();
            this.usersCache[userData.userId] = userData;
        });
    }

    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        const firestoreUserId = await this.getUserIdFromUid(user.uid);
                        user.firestoreUserId = firestoreUserId;
                    } catch (error) {
                        console.error("Error getting Firestore user ID:", error);
                    }
                }
                resolve(user);
            });
        });
    }

    async displayProducts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) {
            console.error("Products container not found");
            return;
        }

        if (this.isLoading) return;
        this.isLoading = true;

        // If currentUserId not provided, try to get it
        if (!currentUserId) {
            currentUserId = this.currentUserId; // Use the instance property
        }
        
        // If still not available and user is authenticated, wait for it
        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user && user.firestoreUserId) {
                currentUserId = user.firestoreUserId;
            }
        }

        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML = "<p>Loading products...</p>";
            this.lastVisibleProduct = null;
            this.currentFilterUserId = filterUserId;
        }

        try {
            if (filterUserId) {
                console.log(`Fetching products for user: ${filterUserId}`);
            } else {
                console.log("Fetching products for no specific user (all products)");
            }

            let query = this.db.collection("products")
                .orderBy("createdAt", "desc");

            if (this.currentFilterUserId) {
                query = query.where("designerUserId", "==", this.currentFilterUserId);
            }

            query = query.limit(this.batchSize);

            if (loadMore && this.lastVisibleProduct) {
                query = query.startAfter(this.lastVisibleProduct);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                if (!loadMore) {
                    this.container.innerHTML = "<p>No products available.</p>";
                }
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().designerUserId);
            const uniqueUserIds = [...new Set(userIds)];
            await this.cacheUsers(uniqueUserIds);

            if (!loadMore) {
                this.container.innerHTML = "";
            }

            snapshot.docs.forEach(doc => {
                const productData = doc.data();
                
                console.log(`🖼️ Product Thumbnail Debug - Product ID: ${doc.id}`, {
                    'Product Title': productData.productTitle,
                    'thumbnail field exists': !!productData.thumbnail,
                    'thumbnail value': productData.thumbnail,
                    'thumbnailUrl field exists': !!productData.thumbnailUrl,
                    'thumbnailUrl value': productData.thumbnailUrl,
                    'thumbnailUrl type': typeof productData.thumbnailUrl,
                    'thumbnailUrl length': productData.thumbnailUrl ? productData.thumbnailUrl.length : 0,
                    'All available fields': Object.keys(productData)
                });
                
                if (productData.thumbnailUrl) {
                    console.log(`📸 thumbnailUrl string for ${doc.id}:`, `"${productData.thumbnailUrl}"`);
                    
                    try {
                        new URL(productData.thumbnailUrl);
                        console.log(`✅ thumbnailUrl is a valid URL format`);
                    } catch (e) {
                        console.log(`❌ thumbnailUrl is NOT a valid URL format:`, e.message);
                    }
                } else {
                    console.log(`❌ No thumbnailUrl found for product ${doc.id}`);
                }
                
                console.log('---');

                if (!productData.productTitle || !productData.designerUserId) {
                    console.warn('Invalid product data:', doc.id, productData);
                    return;
                }

                const userData = this.usersCache[productData.designerUserId] || {};
                
                // ADD THIS LINE: Check if the current user owns this product
                const isCurrentUserProduct = currentUserId === productData.designerUserId;
                
                // UPDATE THIS LINE: Pass the isCurrentUserProduct parameter
                const productElement = this.createProductElement(doc.id, productData, userData, currentUserId, isCurrentUserProduct);
                this.container.appendChild(productElement);

                const commentsContainer = productElement.querySelector(`#comments-${doc.id}`);
                if (commentsContainer) {
                    this.loadComments(doc.id, commentsContainer, currentUserId);
                }
            });

            this.lastVisibleProduct = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                const lastProductElement = this.container.lastElementChild;
                this.observeLastProduct(lastProductElement, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("Error fetching products:", error);
            if (!loadMore) {
                this.container.innerHTML = "<p>Error loading products.</p>";
            }
        } finally {
            this.isLoading = false;
        }
    }
    getColorName(colorCode, colorNameFromFirestore = '') {
        // If we have a color name from Firestore, use it
        if (colorNameFromFirestore && colorNameFromFirestore !== 'Default Color') {
            return colorNameFromFirestore;
        }
        
        // Check if colorCode is null or undefined, provide default
        if (!colorCode) {
            return colorNameFromFirestore || 'Unknown Color';
        }
        
        // Normalize color code - now safe because we checked for null/undefined
        const normalizedColor = colorCode.toLowerCase();
        return colorMap[normalizedColor] || colorNameFromFirestore || 'Unknown Color';
    }

    observeLastProduct(lastProductElement, filterUserId) {
        let isDebounced = false;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading && !isDebounced) {
                    isDebounced = true;
                    observer.disconnect();

                    setTimeout(() => {
                        isDebounced = false;
                    }, 1000);

                    this.displayProducts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });

        observer.observe(lastProductElement);
    }

    createProductElement(productId, productData, userData, currentUserId, isCurrentUserProduct) {
        const productElement = document.createElement("div");
        productElement.className = "card mb-4 product-card";

        const timestamp = productData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const thumbnailSrc = productData.thumbnailUrl || productData.thumbnail;

        // Calculate price range from variants
        let priceDisplay = 'Price not available';
        if (productData.variants && productData.variants.length > 0) {
            const availableVariants = productData.variants.filter(v => 
                v.availability_status && this.isVariantAvailable(v) && v.price && !isNaN(v.price) && v.price > 0
            );
            
            if (availableVariants.length > 0) {
                const prices = availableVariants.map(v => parseFloat(v.price));
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                
                if (minPrice === maxPrice) {
                    priceDisplay = `R$ ${minPrice.toFixed(2)}`;
                } else {
                    priceDisplay = `R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}`;
                }
            }
        }

        // Get the first available variant for background color
        const firstAvailableVariant = productData.variants && productData.variants.length > 0 ? 
            productData.variants.find(v => this.isVariantAvailable(v)) || productData.variants[0] : 
            null;
        
        const backgroundColor = firstAvailableVariant?.color_code || firstAvailableVariant?.colorCode || '#f8f9fa';

        productElement.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../public/images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width: 40px; height: 40px; object-fit: cover; cursor: pointer;"
                     data-user-id="${productData.designerUserId}"
                     onerror="this.src='../public/images/default-profile.png'">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor: pointer;" data-user-id="${productData.designerUserId}">
                        ${userData.user_Name || "Unknown Designer"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <h5 class="card-title">${productData.productTitle}</h5>
                <div class="product-price-section mb-3">
                    <strong class="text-primary">${priceDisplay}</strong>
                    ${productData.pricing ? `
                        <small class="text-muted">
                            (Base: R$ ${productData.pricing.basePrice?.toFixed(2) || '0.00'} + 
                            Artist: R$ ${productData.pricing.userMarkup?.toFixed(2) || '0.00'} + 
                            Platform: R$ ${productData.pricing.platformFee?.toFixed(2) || '0.00'})
                        </small>
                    ` : ''}
                </div>
                <!-- FIXED: Image container matches image size exactly -->
                <div class="product-image-container d-inline-block" style="background-color: ${backgroundColor}; border-radius: 8px; line-height: 0;">
                    ${thumbnailSrc ? `
                        <img src="${thumbnailSrc}" 
                             class="img-fluid rounded product-image lazy-load" 
                             alt="${productData.productTitle}"
                             style="max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain; cursor: pointer; display: block;"
                             loading="lazy"
                             onerror="this.src='../public/images/default-product.png'"
                             data-product-id="${productId}">
                    ` : `
                        <div class="text-muted p-4 text-center" style="width: 300px; height: 300px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                            <i class="fas fa-image fa-3x mb-2"></i>
                            <p>No image available</p>
                        </div>
                    `}
                </div>
                ${productData.description ? `<p class="card-text mt-3">${productData.description}</p>` : ''}
                
                <!-- Product Variants Preview -->
                <div class="product-variants mt-3">
                    <h6>Available Options:</h6>
                    <div class="d-flex flex-wrap gap-2">
                        ${this.getVariantPreview(productData.variants)}
                    </div>
                </div>
            </div>
            <div class="card-footer">
                <!-- Like Button -->
                <button class="btn btn-outline-primary like-button" data-product-id="${productId}">
                    <span class="like-count">${productData.likes_count || 0}</span> Likes
                </button>

                <!-- Buy Button -->
                <button class="btn btn-success buy-button" data-product-id="${productId}">
                    Buy Product - ${priceDisplay}
                </button>

                <!-- Comments Button -->
                <button class="btn btn-outline-secondary comments-toggle-button" data-product-id="${productId}">
                    Show Comments
                </button>

                <!-- Comments Container -->
                <div class="comments-container mt-3" id="comments-${productId}" style="display: none;"></div>

                <!-- Comment Input Section -->
                <div class="comment-input-container mt-2" id="commentInputContainer-${productId}" style="display: none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${productId}">
                        <button class="btn btn-outline-primary comment-submit" data-product-id="${productId}">Post</button>
                    </div>
                </div>

                <!-- Delete Product Button -->
                ${isCurrentUserProduct ? `<button class="btn btn-danger mt-2 delete-product-button" data-product-id="${productId}">Delete Product</button>` : ''}
            </div>
        `;

        this.setupProductEventListeners(productElement, productId, productData, currentUserId, isCurrentUserProduct);

        return productElement;
    }

    getVariantPreview(variants) {
        if (!variants || variants.length === 0) {
            return '<span class="text-muted">No variants available</span>';
        }

        // Group by color for preview
        const colorGroups = {};
        variants.forEach(variant => {
            if (this.isVariantAvailable(variant)) {
                const color = variant.color || 'Default';
                if (!colorGroups[color]) {
                    colorGroups[color] = {
                        color: color,
                        color_code: variant.color_code,
                        sizes: new Set()
                    };
                }
                if (variant.size) {
                    colorGroups[color].sizes.add(variant.size);
                }
            }
        });

        // Create preview badges
        const previews = [];
        Object.values(colorGroups).forEach(group => {
            const sizeText = Array.from(group.sizes).slice(0, 2).join(', ');
            const moreSizes = group.sizes.size > 2 ? ` +${group.sizes.size - 2} more` : '';
            const colorIndicator = group.color_code ? 
                `<span class="color-indicator" style="background: ${group.color_code}; width: 12px; height: 12px; display: inline-block; margin-right: 5px; border-radius: 50%; border: 1px solid #ddd; vertical-align: middle;"></span>` : '';
            
            previews.push(
                `<span class="badge bg-secondary me-1 mb-1">${colorIndicator}${group.color}: ${sizeText}${moreSizes}</span>`
            );
        });

        return previews.length > 0 ? previews.join('') : '<span class="text-muted">Standard product</span>';
    }

    setupProductEventListeners(productElement, productId, productData, currentUserId, isCurrentUserProduct) {
        const profileLinks = productElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        const likeButton = productElement.querySelector('.like-button');
        if (likeButton) {
            likeButton.addEventListener('click', async () => {
                const user = await this.getCurrentUser();
                if (user) {
                    await this.likeProduct(productId, user.firestoreUserId);
                    const likesCount = await this.getLikesCount(productId);
                    const likeCountElement = likeButton.querySelector('.like-count');
                    if (likeCountElement) {
                        likeCountElement.textContent = likesCount;
                    }
                } else {
                    alert("You must be logged in to like products.");
                }
            });
        }

        const buyButton = productElement.querySelector('.buy-button');
        if (buyButton) {
            buyButton.addEventListener('click', async () => {
                const user = await this.getCurrentUser();
                if (user) {
                    this.showProductModal(productData);
                } else {
                    alert("You must be logged in to purchase products.");
                }
            });
        }

        const productImage = productElement.querySelector('.product-image');
        if (productImage) {
            productImage.addEventListener('click', () => {
                this.showProductModal(productData);
            });
        }

        const commentsContainer = productElement.querySelector('.comments-container');
        const commentInputContainer = productElement.querySelector('.comment-input-container');
        const commentsToggleButton = productElement.querySelector('.comments-toggle-button');

        if (commentsToggleButton && commentsContainer && commentInputContainer) {
            commentsToggleButton.addEventListener('click', async () => {
                const isCommentsVisible = commentsContainer.style.display === "block";
                if (!isCommentsVisible) {
                    if (commentsContainer.innerHTML === "") {
                        await this.loadComments(productId, commentsContainer, currentUserId);
                    }
                    commentsContainer.style.display = "block";
                    commentInputContainer.style.display = "block";
                    commentsToggleButton.textContent = "Hide Comments";
                } else {
                    commentsContainer.style.display = "none";
                    commentInputContainer.style.display = "none";
                    commentsToggleButton.textContent = "Show Comments";
                }
            });
        }

        const commentInput = productElement.querySelector('.comment-input');
        const commentSubmitButton = productElement.querySelector('.comment-submit');
        
        if (commentSubmitButton) {
            commentSubmitButton.addEventListener('click', () => this.submitComment(productId, commentInput, commentsContainer));
        }
        
        if (commentInput) {
            commentInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.submitComment(productId, commentInput, commentsContainer);
                }
            });
        }

        if (isCurrentUserProduct) {
            const deleteButton = productElement.querySelector('.delete-product-button');
            if (deleteButton) {
                deleteButton.addEventListener('click', () => {
                    if (confirm("Are you sure you want to delete this product and all its comments and likes?")) {
                        this.deleteProduct(productId, this.currentFilterUserId);
                    }
                });
            }
        }
    }

    showProductModal(productData) {
        // Group variants by color and calculate price range
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups = Object.keys(variantsByColor);
        
        // Calculate overall min and max prices
        let minPrice = Infinity;
        let maxPrice = 0;
        
        if (productData.variants && productData.variants.length > 0) {
            productData.variants.forEach(variant => {
                if (variant.availability_status && this.isVariantAvailable(variant)) {
                    const price = variant.price || variant.retail_price;
                    if (price && !isNaN(price)) {
                        minPrice = Math.min(minPrice, price);
                        maxPrice = Math.max(maxPrice, price);
                    }
                }
            });
        }
        
        if (minPrice === Infinity) minPrice = 0;

        const modalHtml = `
            <div class="modal fade" id="productModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${productData.productTitle}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <!-- Left Side - Product Thumbnail -->
                                <div class="col-md-6 text-center">
                                    <div id="thumbnail-container" class="mb-4">
                                        ${this.createThumbnailDisplay(productData, colorGroups[0])}
                                    </div>
                                </div>
                                
                                <!-- Right Side - Selection Options -->
                                <div class="col-md-6">
                                    ${productData.description ? `<p class="mb-3">${productData.description}</p>` : ''}
                                    
                                    <!-- Price Display -->
                                    <div class="price-section mb-4">
                                        <h4 class="text-primary fw-bold">
                                            ${minPrice === maxPrice ? 
                                                `R$ ${minPrice.toFixed(2)}` : 
                                                `R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}`
                                            }
                                        </h4>
                                    </div>
                                    
                                    <!-- Color Selection -->
                                    <div class="color-selection mb-4">
                                        <h6>Select Color:</h6>
                                        <div class="color-options d-flex flex-wrap gap-2" id="color-options-container">
                                            ${colorGroups.map((color, index) => {
                                                const firstVariant = variantsByColor[color][0];
                                                const colorCode = firstVariant?.color_code || firstVariant?.colorCode || '#ffffff';
                                                const colorNameFromFirestore = firstVariant?.color || color;
                                                const colorName = this.getColorName(colorCode, colorNameFromFirestore);
                                                return `
                                                    <button class="btn color-option-btn ${index === 0 ? 'active' : ''}" 
                                                            data-color="${color}"
                                                            data-color-code="${colorCode}"
                                                            style="background-color: ${colorCode}; color: ${this.getContrastColor(colorCode)}; border: 2px solid ${index === 0 ? '#007bff' : 'transparent'}; width: 40px; height: 40px; border-radius: 50%;"
                                                            title="${colorName}">
                                                    </button>
                                                `;
                                            }).join('')}
                                        </div>
                                        <small class="text-muted" id="selected-color-name">${this.getColorName(variantsByColor[colorGroups[0]][0]?.color_code, variantsByColor[colorGroups[0]][0]?.color || colorGroups[0])}</small>
                                    </div>
                                    
                                    <!-- Size Selection -->
                                    <div class="size-selection mb-4">
                                        <h6>Select Size:</h6>
                                        <div id="size-options-container">
                                            ${this.createSizeOptions(variantsByColor[colorGroups[0]])}
                                        </div>
                                    </div>
                                    
                                    <!-- Selected Variant Display -->
                                    <div class="selected-variant mt-3 p-3 border rounded" style="display: none;">
                                        <h6>Selected Option:</h6>
                                        <div class="variant-info">
                                            <span class="selected-color-size"></span>
                                            <span class="selected-price text-primary fw-bold"></span>
                                        </div>
                                    </div>
                                    
                                    <!-- Buy Button -->
                                    <button class="btn btn-success w-100 mt-3 buy-from-modal" 
                                            data-product-id="${productData.id}"
                                            disabled>
                                        Add to Cart
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = new bootstrap.Modal(document.getElementById('productModal'));
        
        this.setupModalEvents(productData, variantsByColor);
        modal.show();

        document.getElementById('productModal').addEventListener('hidden.bs.modal', function () {
            this.remove();
        });
    }

    createThumbnailDisplay(productData, selectedColor) {
        const thumbnailSrc = productData.thumbnailUrl || productData.thumbnail;
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorVariants = variantsByColor[selectedColor] || [];
        const firstVariant = colorVariants[0];
        const colorCode = firstVariant?.color_code || firstVariant?.colorCode || '#ffffff';
        
        return `
            <!-- FIXED: Modal thumbnail container matches image size exactly -->
            <div class="thumbnail-wrapper d-inline-block" style="background-color: ${colorCode}; border-radius: 8px; line-height: 0;">
                ${thumbnailSrc ? `
                    <img src="${thumbnailSrc}" 
                         class="img-fluid rounded" 
                         alt="${productData.productTitle}"
                         style="max-width: 300px; max-height: 300px; width: auto; height: auto; object-fit: contain; display: block;">
                ` : `
                    <div class="text-muted p-4 text-center" style="width: 300px; height: 300px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                        <i class="fas fa-image fa-3x mb-2"></i>
                        <p>No image available</p>
                    </div>
                `}
            </div>
        `;
    }

    updateThumbnailBackground(productData, selectedColor) {
        const thumbnailContainer = document.getElementById('thumbnail-container');
        if (!thumbnailContainer) return;
        
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorVariants = variantsByColor[selectedColor] || [];
        const firstVariant = colorVariants[0];
        const colorCode = firstVariant?.color_code || firstVariant?.colorCode || '#ffffff';
        
        thumbnailContainer.innerHTML = this.createThumbnailDisplay(productData, selectedColor);
    }

    createSizeOptions(variants) {
        if (!variants || variants.length === 0) {
            return '<p class="text-muted">No sizes available</p>';
        }
        
        // Sort variants by size order for better display
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
        const sortedVariants = variants.sort((a, b) => {
            const sizeA = a.size || '';
            const sizeB = b.size || '';
            return sizeOrder.indexOf(sizeA) - sizeOrder.indexOf(sizeB);
        });
        
        return sortedVariants.map(variant => {
            const isAvailable = this.isVariantAvailable(variant);
            const price = variant.price || variant.retail_price;
            const displayPrice = price && !isNaN(price) ? `R$ ${parseFloat(price).toFixed(2)}` : 'Price N/A';
            
            return `
                <button class="btn btn-outline-secondary size-option ${isAvailable ? '' : 'disabled'}" 
                        data-variant-id="${variant.id}"
                        data-color="${variant.color}"
                        data-size="${variant.size}"
                        data-price="${price}"
                        ${!isAvailable ? 'disabled' : ''}>
                    ${variant.size || 'One Size'}
                    ${!isAvailable ? '(Unavailable)' : `- ${displayPrice}`}
                </button>
            `;
        }).join('');
    }

    isVariantAvailable(variant) {
        if (!variant.availability_status) return false;
        
        // Check if variant has any availability status that indicates it's in stock
        if (Array.isArray(variant.availability_status)) {
            return variant.availability_status.some(status => 
                status.status === 'in_stock' || status.status === 'active'
            );
        }
        
        // Handle string status
        return variant.availability_status === 'active' || 
               variant.availability_status === 'in_stock';
    }

    groupVariantsByColor(variants) {
        const grouped = {};
        if (!variants || variants.length === 0) {
            return grouped;
        }
        
        variants.forEach(variant => {
            const color = variant.color || 'Default Color';
            if (!grouped[color]) {
                grouped[color] = [];
            }
            grouped[color].push({
                id: variant.id,
                color: color,
                size: variant.size || 'One Size',
                price: variant.price || variant.retail_price,
                availability_status: variant.availability_status,
                color_code: variant.color_code,
                // Include all original data
                ...variant
            });
        });
        return grouped;
    }

    getContrastColor(hexcolor) {
        if (!hexcolor || hexcolor === '#cccccc') return '#000000';
        
        // If the color is too light, return dark text color, otherwise light text
        const r = parseInt(hexcolor.substr(1, 2), 16);
        const g = parseInt(hexcolor.substr(3, 2), 16);
        const b = parseInt(hexcolor.substr(5, 2), 16);
        const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return brightness > 128 ? '#000000' : '#FFFFFF';
    }

    setupModalEvents(productData, variantsByColor) {
        const modalElement = document.getElementById('productModal');
        const buyButton = modalElement.querySelector('.buy-from-modal');
        const selectedVariantDiv = modalElement.querySelector('.selected-variant');
        const selectedColorSize = modalElement.querySelector('.selected-color-size');
        const selectedPrice = modalElement.querySelector('.selected-price');
        const sizeOptionsContainer = modalElement.querySelector('#size-options-container');
        const selectedColorName = modalElement.querySelector('#selected-color-name');
        
        let selectedVariant = null;
        let currentColor = Object.keys(variantsByColor)[0];
        
        // Store reference to the class instance for use in event handlers
        const self = this;
        
        // Color selection event listeners
        modalElement.querySelectorAll('.color-option-btn').forEach(button => {
            button.addEventListener('click', function() {
                // Remove active class from all color buttons
                modalElement.querySelectorAll('.color-option-btn').forEach(btn => {
                    btn.style.borderColor = 'transparent';
                });
                
                // Add active class to clicked button
                this.style.borderColor = '#007bff';
                
                // Get selected color
                const newColor = this.dataset.color;
                const colorCode = this.dataset.colorCode;
                currentColor = newColor;
                
                // Update color name display - use the actual color name from Firestore
                if (selectedColorName) {
                    const firstVariant = variantsByColor[newColor][0];
                    const colorNameFromFirestore = firstVariant?.color || newColor;
                    selectedColorName.textContent = self.getColorName(colorCode, colorNameFromFirestore);
                }
                
                // Update thumbnail background with current color
                self.updateThumbnailBackground(productData, newColor);
                
                // Update size options for the selected color
                const sizeOptionsHtml = self.createSizeOptions(variantsByColor[newColor]);
                sizeOptionsContainer.innerHTML = sizeOptionsHtml;
                
                // Reset selection
                selectedVariant = null;
                selectedVariantDiv.style.display = 'none';
                buyButton.disabled = true;
                buyButton.textContent = 'Add to Cart';
                
                // Re-attach size option event listeners
                attachSizeOptionListeners();
            });
        });
        
        // Function to attach size option listeners
        const attachSizeOptionListeners = () => {
            modalElement.querySelectorAll('.size-option:not(.disabled)').forEach(button => {
                button.addEventListener('click', function() {
                    // Remove selection from all size buttons
                    modalElement.querySelectorAll('.size-option').forEach(btn => {
                        btn.classList.remove('btn-primary');
                        btn.classList.add('btn-outline-secondary');
                    });
                    
                    // Select current button
                    this.classList.remove('btn-outline-secondary');
                    this.classList.add('btn-primary');
                    
                    selectedVariant = {
                        id: parseInt(this.dataset.variantId),
                        color: this.dataset.color,
                        size: this.dataset.size,
                        price: parseFloat(this.dataset.price)
                    };
                    
                    // Calculate total price with artist markup and platform fee
                    const artistMarkup = productData.pricing?.userMarkup || 0;
                    const platformFee = (selectedVariant.price + artistMarkup) * 0.05;
                    const totalPrice = selectedVariant.price + artistMarkup + platformFee;
                    selectedVariant.totalPrice = totalPrice;
                    
                    // Use the actual color name from Firestore
                    const firstVariant = variantsByColor[currentColor][0];
                    const colorNameFromFirestore = firstVariant?.color || currentColor;
                    const displayColorName = self.getColorName(firstVariant?.color_code, colorNameFromFirestore);
                    
                    selectedColorSize.textContent = `${displayColorName} - ${selectedVariant.size}`;
                    selectedPrice.textContent = `R$ ${totalPrice.toFixed(2)}`;
                    selectedVariantDiv.style.display = 'block';
                    
                    buyButton.disabled = false;
                    buyButton.textContent = `Add to Cart - R$ ${totalPrice.toFixed(2)}`;
                });
            });
        };
        
        // Initial attachment of size option listeners
        attachSizeOptionListeners();
        
        // Buy button event listener
        buyButton.addEventListener('click', () => {
            if (selectedVariant) {
                this.handleBuyFromModal(productData, selectedVariant);
            }
        });
    }

    handleBuyFromModal(productData, selectedVariant) {
        const user = this.auth.currentUser;
        if (!user) {
            alert("Please log in to purchase products.");
            return;
        }

        // Calculate final pricing
        const artistMarkup = productData.pricing?.userMarkup || 0;
        const platformFee = (selectedVariant.price + artistMarkup) * 0.05;
        const totalPrice = selectedVariant.price + artistMarkup + platformFee;

        // Create complete product data with selected variant
        const productWithVariant = {
            ...productData,
            id: productData.id || productData.productId,
            selectedVariant: {
                ...selectedVariant,
                totalPrice: totalPrice
            },
            variants: productData.variants,
            pricing: {
                ...productData.pricing,
                basePrice: selectedVariant.price,
                totalPrice: totalPrice,
                platformFee: platformFee
            }
        };

        console.log('Product selected for purchase:', productWithVariant);

        const modal = bootstrap.Modal.getInstance(document.getElementById('productModal'));
        modal.hide();

        // Store complete product data for checkout
        sessionStorage.setItem('selectedProduct', JSON.stringify(productWithVariant));
        
        // Redirect to checkout page
        window.location.href = 'pagamentos.html';
    }

    async likeProduct(productId, userId) {
        if (this.isLiking.has(productId)) return;
        this.isLiking.add(productId);

        const likeButton = document.querySelector(`.like-button[data-product-id="${productId}"]`);
        const likeCountElement = likeButton?.querySelector('.like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        const likeRef = this.db.collection("product_likes").doc(`${productId}_${userId}`);
        const likeDocSnapshot = await likeRef.get();
        const hasLiked = likeDocSnapshot.exists;

        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            const batch = this.db.batch();
            const productRef = this.db.collection("products").doc(productId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(productRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.likesCache.get(productId)?.delete(userId);
            } else {
                batch.set(likeRef, {
                    userId: userId,
                    productId: productId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                batch.update(productRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });
                if (!this.likesCache.has(productId)) {
                    this.likesCache.set(productId, new Set());
                }
                this.likesCache.get(productId).add(userId);
            }

            await batch.commit();
        } catch (error) {
            console.error("Error updating like:", error);
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }
        } finally {
            this.isLiking.delete(productId);
        }
    }

    async getLikesCount(productId) {
        const productDoc = await this.db.collection("products").doc(productId).get();
        return productDoc.data().likes_count || 0;
    }

    handleBuyProduct(productId, productData) {
        const user = this.auth.currentUser;
        if (!user) {
            alert("Please log in to purchase products.");
            return;
        }

        this.showProductModal(productData);
    }

    async submitComment(productId, commentInput, commentsContainer) {
        if (this.isSubmitting) return;
        this.isSubmitting = true;

        if (!commentInput) {
            console.error("Comment input element not found");
            this.isSubmitting = false;
            return;
        }

        const commentText = commentInput.value.trim();
        if (!commentText) {
            alert("Please enter a comment.");
            this.isSubmitting = false;
            return;
        }

        const user = await this.getCurrentUser();
        if (!user) {
            alert("You must be logged in to comment.");
            this.isSubmitting = false;
            return;
        }

        const submitButton = commentsContainer?.parentElement?.querySelector('.comment-submit');
        if (!submitButton) {
            console.error("Submit button not found.");
            this.isSubmitting = false;
            return;
        }

        commentInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Posting...";

        try {
            const commentRef = await this.db.collection("product_comments").add({
                userId: user.firestoreUserId,
                productId: productId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0
            });

            const productDoc = await this.db.collection("products").doc(productId).get();
            const productOwner = productDoc.data().designerUserId;
            if (productOwner !== user.firestoreUserId) {
                const commenterUsername = this.usersCache[user.firestoreUserId]?.user_Name || await this.ensureUsernameInCache(user.firestoreUserId);
                await this.db.collection("notifications").add({
                    toUserId: productOwner,
                    fromUserId: user.firestoreUserId,
                    fromUsername: commenterUsername,
                    type: "product_comment",
                    message: `${commenterUsername} commented on your product: "${commentText}"`,
                    productId: productId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    read: false,
                    fromUserProfilePic: this.usersCache[user.firestoreUserId]?.profilePicture || null
                });
            }

            commentInput.value = "";

            if (commentsContainer) {
                const successMessage = document.createElement("div");
                successMessage.className = "alert alert-success mt-2";
                successMessage.textContent = "Comment added!";
                commentsContainer.appendChild(successMessage);

                setTimeout(() => {
                    successMessage.remove();
                }, 3000);
            }

        } catch (error) {
            console.error("Error submitting comment:", error);
            alert("Failed to submit comment. Please try again.");
        } finally {
            commentInput.disabled = false;
            submitButton.disabled = false;
            submitButton.textContent = "Post";
            this.isSubmitting = false;
        }
    }

    async loadComments(productId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container not found for product:", productId);
            return;
        }

        commentsContainer.style.maxHeight = "300px";
        commentsContainer.style.overflowY = "auto";

        if (this.commentListeners[productId]) {
            this.commentListeners[productId]();
            delete this.commentListeners[productId];
        }

        const unsubscribe = this.db.collection("product_comments")
            .where("productId", "==", productId)
            .orderBy("likes_count", "desc")
            .orderBy("timestamp", "asc")
            .onSnapshot(async (snapshot) => {
                if (snapshot.empty) {
                    commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
                    return;
                }

                const userIds = snapshot.docs.map(doc => doc.data().userId);
                const uniqueUserIds = [...new Set(userIds)];
                await this.cacheUsers(uniqueUserIds);

                const commentsArray = snapshot.docs.map(doc => {
                    const commentData = { id: doc.id, ...doc.data() };
                    if (commentData.likes_count === undefined) {
                        commentData.likes_count = 0;
                    }
                    return commentData;
                });

                commentsContainer.innerHTML = "";

                const displayComments = commentsArray.slice(0, 8);
                displayComments.forEach(commentData => {
                    const userData = this.usersCache[commentData.userId] || {};
                    const commentElement = this.createCommentElement(commentData, userData, currentUserId, productId, commentsContainer);
                    commentsContainer.appendChild(commentElement);
                });

                if (commentsArray.length > 8) {
                    const loadMoreButton = document.createElement("button");
                    loadMoreButton.textContent = `Load More Comments (${commentsArray.length - 8} more)`;
                    loadMoreButton.className = "btn btn-outline-secondary w-100 mt-2";
                    
                    let displayedCommentCount = 8;
                    loadMoreButton.addEventListener('click', () => {
                        const nextComments = commentsArray.slice(displayedCommentCount, displayedCommentCount + 8);
                        nextComments.forEach(commentData => {
                            const userData = this.usersCache[commentData.userId] || {};
                            const commentElement = this.createCommentElement(commentData, userData, currentUserId, productId, commentsContainer);
                            commentsContainer.appendChild(commentElement);
                        });
                        displayedCommentCount += 8;
                        if (displayedCommentCount >= commentsArray.length) {
                            loadMoreButton.remove();
                        } else {
                            loadMoreButton.textContent = `Load More Comments (${commentsArray.length - displayedCommentCount} more)`;
                        }
                    });
                    commentsContainer.appendChild(loadMoreButton);
                }
            }, (error) => {
                console.error("Error loading comments:", error);
                commentsContainer.innerHTML = '<p class="text-danger">Error loading comments.</p>';
            });

        this.commentListeners[productId] = unsubscribe;
    }

    createCommentElement(commentData, userData, currentUserId, productId, commentsContainer) {
        const commentElement = document.createElement("div");
        commentElement.className = "mb-3 d-flex align-items-center";
        commentElement.setAttribute("data-comment-id", commentData.id);

        let timestamp;
        if (commentData.timestamp && typeof commentData.timestamp.toDate === 'function') {
            timestamp = commentData.timestamp.toDate();
        } else if (commentData.timestamp instanceof Date) {
            timestamp = commentData.timestamp;
        } else {
            timestamp = new Date();
        }

        const hasLiked = this.hasUserLikedComment(commentData.id, currentUserId);

        commentElement.innerHTML = `
            <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '/images/default-profile.png'}" 
                 class="rounded-circle me-2 user-profile-link"
                 style="width: 40px; height: 40px; cursor: pointer;"
                 data-user-id="${commentData.userId}"
                 alt="Profile Picture"
                 onerror="this.src='/images/default-profile.png'">
            <div class="d-flex flex-column flex-grow-1">
                <strong class="user-profile-link" style="cursor: pointer;" data-user-id="${commentData.userId}">
                    ${userData.user_Name || "Unknown User"}
                </strong>
                <span>${commentData.content}</span>
                <small class="text-muted">
                    ${timestamp.toLocaleString()}
                </small>
            </div>
            <button class="btn btn-outline-primary btn-sm comment-like-button" data-comment-id="${commentData.id}">
                <span class="comment-like-count">${commentData.likes_count || 0}</span> Likes
            </button>
        `;

        const dotsMenu = document.createElement("span");
        dotsMenu.innerHTML = "&#8942;";
        dotsMenu.style.cursor = "pointer";
        dotsMenu.style.marginLeft = "auto";

        const popup = document.createElement("div");
        popup.style.display = "none";
        popup.style.position = "fixed";
        popup.style.backgroundColor = "white";
        popup.style.border = "1px solid #ddd";
        popup.style.borderRadius = "4px";
        popup.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
        popup.style.padding = "8px";
        popup.style.minWidth = "120px";
        popup.style.zIndex = "1000";

        if (commentData.userId === currentUserId) {
            const deleteButton = document.createElement("button");
            deleteButton.innerText = "Delete Comment";
            deleteButton.style.color = "#dc3545";
            deleteButton.style.border = "none";
            deleteButton.style.background = "none";
            deleteButton.style.cursor = "pointer";
            deleteButton.style.textAlign = "left";
            deleteButton.style.width = "100%";
            deleteButton.style.padding = "4px 8px";
            deleteButton.addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteComment(commentData.id, productId, commentsContainer, currentUserId);
            });
            popup.appendChild(deleteButton);
        }

        dotsMenu.addEventListener("click", (e) => {
            e.stopPropagation();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const popupWidth = popup.offsetWidth;
            const popupHeight = popup.offsetHeight;
            popup.style.left = `${(screenWidth - popupWidth) / 2}px`;
            popup.style.top = `${(screenHeight - popupHeight) / 2}px`;
            popup.style.display = popup.style.display === "block" ? "none" : "block";
        });

        document.addEventListener("click", () => {
            popup.style.display = "none";
        });

        const optionsContainer = document.createElement("div");
        optionsContainer.style.position = "relative";
        optionsContainer.appendChild(dotsMenu);
        optionsContainer.appendChild(popup);
        commentElement.appendChild(optionsContainer);

        const likeButton = commentElement.querySelector('.comment-like-button');
        if (likeButton) {
            likeButton.addEventListener('click', async () => {
                const user = await this.getCurrentUser();
                if (user) {
                    await this.likeComment(commentData.id, user.firestoreUserId);
                } else {
                    alert("You must be logged in to like a comment.");
                }
            });
        }

        const profileLinks = commentElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        return commentElement;
    }

    async deleteProduct(productId, filterUserId) {
        if (!confirm("Are you sure you want to delete this product and all its comments and likes?")) {
            return;
        }

        try {
            const productRef = this.db.collection("products").doc(productId);
            const productDoc = await productRef.get();

            if (!productDoc.exists) {
                throw new Error("Product doesn't exist");
            }

            const currentUser = await this.getCurrentUser();
            const productOwnerUserId = productDoc.data().designerUserId;

            if (!currentUser || currentUser.firestoreUserId !== productOwnerUserId) {
                throw new Error("You can only delete your own products");
            }

            const batch1 = this.db.batch();
            batch1.delete(productRef);

            const productLikesSnapshot = await this.db.collection("product_likes")
                .where("productId", "==", productId)
                .get();
            productLikesSnapshot.forEach(doc => {
                batch1.delete(doc.ref);
            });

            const commentsSnapshot = await this.db.collection("product_comments")
                .where("productId", "==", productId)
                .get();
            const commentIds = commentsSnapshot.docs.map(doc => doc.id);
            commentsSnapshot.forEach(doc => {
                batch1.delete(doc.ref);
            });

            await batch1.commit();

            if (commentIds.length > 0) {
                const batch2 = this.db.batch();
                for (const commentId of commentIds) {
                    const commentLikesSnapshot = await this.db.collection("product_comment_likes")
                        .where("commentId", "==", commentId)
                        .get();
                    commentLikesSnapshot.forEach(doc => {
                        batch2.delete(doc.ref);
                    });
                }
                await batch2.commit();
            }

            alert("Product and all associated content deleted successfully.");
            this.displayProducts(filterUserId);

        } catch (error) {
            console.error("Error deleting product:", error);
            alert(`Failed to delete product: ${error.message}`);
        }
    }

    async deleteComment(commentId, productId, commentsContainer, currentUserId) {
        if (!commentsContainer) return;

        if (!confirm("Are you sure you want to delete this comment and all its likes?")) {
            return;
        }

        try {
            const batch = this.db.batch();
            const commentRef = this.db.collection("product_comments").doc(commentId);
            batch.delete(commentRef);

            const likesQuery = this.db.collection("product_comment_likes")
                .where("commentId", "==", commentId);
            const likesSnapshot = await likesQuery.get();
            likesSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            const deletedCommentElement = commentsContainer.querySelector(`[data-comment-id="${commentId}"]`);
            if (deletedCommentElement) {
                deletedCommentElement.remove();
            }

        } catch (error) {
            console.error("Error deleting comment:", error);
            alert("Failed to delete comment. Please try again.");
        }
    }

    async likeComment(commentId, userId) {
        if (this.isCommentLiking.has(commentId)) return;
        this.isCommentLiking.add(commentId);

        const likeButton = document.querySelector(`.comment-like-button[data-comment-id="${commentId}"]`);
        const likeCountElement = likeButton?.querySelector('.comment-like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        const hasLiked = this.commentLikesCache.get(commentId)?.has(userId) || false;

        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            const batch = this.db.batch();
            const likeRef = this.db.collection("product_comment_likes").doc(`${commentId}_${userId}`);
            const commentRef = this.db.collection("product_comments").doc(commentId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.commentLikesCache.get(commentId)?.delete(userId);
            } else {
                batch.set(likeRef, {
                    userId: userId,
                    commentId: commentId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });
                if (!this.commentLikesCache.has(commentId)) {
                    this.commentLikesCache.set(commentId, new Set());
                }
                this.commentLikesCache.get(commentId).add(userId);
            }

            await batch.commit();
        } catch (error) {
            console.error("Error updating comment like:", error);
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }
        } finally {
            this.isCommentLiking.delete(commentId);
        }
    }

    hasUserLikedComment(commentId, userId) {
        return this.commentLikesCache.get(commentId)?.has(userId) || false;
    }

    async ensureUsernameInCache(userId) {
        if (!this.usersCache[userId]) {
            try {
                const userQuery = await this.db.collection("users")
                    .where("userId", "==", userId)
                    .get();
                if (!userQuery.empty) {
                    this.usersCache[userId] = userQuery.docs[0].data();
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
            }
        }
        return this.usersCache[userId]?.user_Name || "Someone";
    }
}

// Keep the initialize function for backward compatibility
window.initializeProductManager = function(containerId) {
    return new ProductManager(db, auth, containerId);
};