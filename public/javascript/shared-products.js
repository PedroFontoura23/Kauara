console.log("shared-products.js loaded!");

// Make ProductManager available globally
window.ProductManager = class ProductManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {};
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
                    const userQuery = await this.db.collection("users").where("firebaseUID", "==", user.uid).get();
                    this.currentUserId = !userQuery.empty ? userQuery.docs[0].id : null;
                    sessionStorage.setItem('currentFirestoreUserId', this.currentUserId);
                } catch (error) {
                    console.error("Error fetching current user ID:", error);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
                sessionStorage.removeItem('currentFirestoreUserId');
            }
        });
    }

    async displayProducts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container || this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) currentUserId = this.currentUserId;
        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML = "<p>Loading products...</p>";
            this.lastVisibleProduct = null;
            this.currentFilterUserId = filterUserId;
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
            const uniqueUserIds = [...new Set(userIds)];
            await this.cacheUsers(uniqueUserIds);

            if (!loadMore) this.container.innerHTML = "";

            snapshot.docs.forEach(doc => {
                const productData = doc.data();
                const userData = this.usersCache[productData.designerUserId] || {};
                const isCurrentUserProduct = currentUserId === productData.designerUserId;
                const productElement = this.createProductElement(doc.id, productData, userData, currentUserId, isCurrentUserProduct);
                this.container.appendChild(productElement);
            });

            this.lastVisibleProduct = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                const lastProductElement = this.container.lastElementChild;
                this.observeLastProduct(lastProductElement, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("Error fetching products:", error);
            if (!loadMore) this.container.innerHTML = "<p>Error loading products.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    async cacheUsers(userIds) {
        if (userIds.length === 0) return;
        const usersQuery = await this.db.collection("users").where("userId", "in", userIds).get();
        usersQuery.forEach(doc => this.usersCache[doc.data().userId] = doc.data());
    }

    createProductElement(productId, productData, userData, currentUserId, isCurrentUserProduct) {
        const timestamp = productData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const thumbnailSrc = productData.thumbnailUrl || productData.thumbnail;
        
        // Get pricing display with new structure
        const priceDisplay = this.getPriceDisplay(productData);
        
        // Get first variant for background color
        const firstAvailableVariant = productData.variants && productData.variants.length > 0 ? 
            productData.variants.find(v => this.isVariantAvailable(v)) || productData.variants[0] : null;
        const backgroundColor = firstAvailableVariant?.color_code || firstAvailableVariant?.colorCode || '#f8f9fa';

        const productElement = document.createElement("div");
        productElement.className = "card mb-4 product-card";
        productElement.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../public/images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
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
                    ${priceDisplay}
                </div>
                <div class="product-image-container d-inline-block" style="background-color: ${backgroundColor}; border-radius: 8px; line-height: 0;">
                    ${thumbnailSrc ? `
                        <img src="${thumbnailSrc}" 
                             class="img-fluid rounded product-image lazy-load" 
                             alt="${productData.productTitle}"
                             style="max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain; cursor: pointer; display: block;"
                             loading="lazy"
                             onerror="this.src='../public/images/default-product.png'"
                             data-product-id="${productId}">
                    ` : `<div class="text-muted p-4 text-center" style="width: 300px; height: 300px;"><i class="fas fa-image fa-3x mb-2"></i><p>No image available</p></div>`}
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

                <!-- BUY Button (changed from Inquiry) -->
                <button class="btn btn-success buy-button" data-product-id="${productId}">
                    <i class="fas fa-shopping-cart me-1"></i> Buy Now
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
            const sizeText = Array.from(group.sizes).slice(0, 2).join(', ');
            const moreSizes = group.sizes.size > 2 ? ` +${group.sizes.size - 2} more` : '';
            const colorIndicator = group.color_code ? 
                `<span class="color-indicator" style="background: ${group.color_code}; width: 12px; height: 12px; display: inline-block; margin-right: 5px; border-radius: 50%; border: 1px solid #ddd; vertical-align: middle;"></span>` : '';
            return `<span class="badge bg-secondary me-1 mb-1">${colorIndicator}${group.color}: ${sizeText}${moreSizes}</span>`;
        }).join('');
    }

    setupProductEventListeners(productElement, productId, productData, currentUserId, isCurrentUserProduct) {
        // Profile links
        productElement.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        // Like button
        const likeButton = productElement.querySelector('.like-button');
        likeButton?.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likeProduct(productId, user.firestoreUserId);
                const likesCount = await this.getLikesCount(productId);
                const likeCountElement = likeButton.querySelector('.like-count');
                if (likeCountElement) likeCountElement.textContent = likesCount;
            } else {
                alert("You must be logged in to like products.");
            }
        });

        // BUY button (changed from inquiry)
        const buyButton = productElement.querySelector('.buy-button');
        buyButton?.addEventListener('click', async () => {
            // Get designer info with PIX key
            const designerInfo = await this.getDesignerWithPixKey(productData.designerUserId);
            
            // Show product modal for purchase with designer info
            this.showProductModal(productData, designerInfo);
        });

        // Image click - opens lightbox
        const productImage = productElement.querySelector('.product-image');
        productImage?.addEventListener('click', () => {
            this.showImageLightboxModal(productData);
        });

        // Comments toggle
        const commentsToggle = productElement.querySelector('.comments-toggle-button');
        const commentsContainer = productElement.querySelector('.comments-container');
        const commentInputContainer = productElement.querySelector('.comment-input-container');
        commentsToggle?.addEventListener('click', async () => {
            const isVisible = commentsContainer.style.display === "block";
            if (!isVisible) {
                if (commentsContainer.innerHTML === "") await this.loadComments(productId, commentsContainer, currentUserId);
                commentsContainer.style.display = "block";
                commentInputContainer.style.display = "block";
                commentsToggle.textContent = "Hide Comments";
            } else {
                commentsContainer.style.display = "none";
                commentInputContainer.style.display = "none";
                commentsToggle.textContent = "Show Comments";
            }
        });

        // Comment submission
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

        // Delete button
        const deleteButton = productElement.querySelector('.delete-product-button');
        deleteButton?.addEventListener('click', () => {
            if (confirm("Are you sure you want to delete this product and all its comments and likes?")) {
                this.deleteProduct(productId, this.currentFilterUserId);
            }
        });
    }

    async getDesignerWithPixKey(designerUserId) {
        try {
            const designerDoc = await this.db.collection("users").doc(designerUserId).get();
            if (designerDoc.exists) {
                const designerData = designerDoc.data();
                return {
                    userId: designerUserId,
                    name: designerData.user_Name || designerData.displayName || "Unknown Designer",
                    pix_key: designerData.pix_key || null,
                    pix_keyType: designerData.pix_keyType || null,
                    profilePicture: designerData.profilePicture || null,
                    email: designerData.email || null
                };
            }
            return null;
        } catch (error) {
            console.error("Error fetching designer info:", error);
            return null;
        }
    }

    showImageLightboxModal(productData) {
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups = Object.keys(variantsByColor);
        
        const modalHtml = `
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
                                            ${colorGroups.map((color, index) => {
                                                const firstVariant = variantsByColor[color][0];
                                                const colorCode = firstVariant?.color_code || firstVariant?.colorCode || '#ffffff';
                                                const colorName = this.getColorName(colorCode, firstVariant?.color || color);
                                                return `<button class="btn color-option-btn ${index === 0 ? 'active' : ''}" 
                                                        data-color="${color}" data-color-code="${colorCode}"
                                                        style="background-color: ${colorCode}; color: ${this.getContrastColor(colorCode)}; border: 2px solid ${index === 0 ? '#007bff' : 'transparent'}; width: 40px; height: 40px; border-radius: 50%;"
                                                        title="${colorName}"></button>`;
                                            }).join('')}
                                        </div>
                                        <small class="text-muted" id="lightbox-selected-color-name">
                                            ${this.getColorName(variantsByColor[colorGroups[0]][0]?.color_code, variantsByColor[colorGroups[0]][0]?.color || colorGroups[0])}
                                        </small>
                                    </div>
                                    <button class="btn btn-success w-100 mt-3 lightbox-buy-button" data-product-id="${productData.id}">
                                        <i class="fas fa-shopping-cart me-1"></i> Buy Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const existingModal = document.getElementById('imageLightboxModal');
        if (existingModal) existingModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = new bootstrap.Modal(document.getElementById('imageLightboxModal'));
        this.setupLightboxModalEvents(productData, variantsByColor);
        modal.show();

        document.getElementById('imageLightboxModal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }

    showProductModal(productData, designerInfo = null) {
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorGroups = Object.keys(variantsByColor);
        
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
                                <div class="col-md-6 text-center">
                                    <div id="thumbnail-container" class="mb-4">
                                        ${this.createThumbnailDisplay(productData, colorGroups[0])}
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    ${productData.description ? `<p class="mb-3">${productData.description}</p>` : ''}
                                    <div class="price-section mb-4">
                                        ${this.getModalPriceDisplay(productData)}
                                    </div>
                                    <div class="color-selection mb-4">
                                        <h6>Select Color:</h6>
                                        <div class="color-options d-flex flex-wrap gap-2" id="color-options-container">
                                            ${colorGroups.map((color, index) => {
                                                const firstVariant = variantsByColor[color][0];
                                                const colorCode = firstVariant?.color_code || firstVariant?.colorCode || '#ffffff';
                                                const colorName = this.getColorName(colorCode, firstVariant?.color || color);
                                                return `<button class="btn color-option-btn ${index === 0 ? 'active' : ''}" 
                                                        data-color="${color}" data-color-code="${colorCode}"
                                                        style="background-color: ${colorCode}; color: ${this.getContrastColor(colorCode)}; border: 2px solid ${index === 0 ? '#007bff' : 'transparent'}; width: 40px; height: 40px; border-radius: 50%;"
                                                        title="${colorName}"></button>`;
                                            }).join('')}
                                        </div>
                                        <small class="text-muted" id="selected-color-name">
                                            ${this.getColorName(variantsByColor[colorGroups[0]][0]?.color_code, variantsByColor[colorGroups[0]][0]?.color || colorGroups[0])}
                                        </small>
                                    </div>
                                    <div class="size-selection mb-4">
                                        <h6>Select Size:</h6>
                                        <div id="size-options-container">
                                            ${this.createSizeOptions(variantsByColor[colorGroups[0]])}
                                        </div>
                                    </div>
                                    <div class="selected-variant mt-3 p-3 border rounded" style="display: none;">
                                        <h6>Selected Option:</h6>
                                        <div class="variant-info">
                                            <span class="selected-color-size"></span>
                                            <span class="selected-price text-primary fw-bold"></span>
                                        </div>
                                        <small class="text-muted mt-1 d-block" id="selected-variant-details"></small>
                                    </div>
                                    <button class="btn btn-success w-100 mt-3 buy-from-modal" data-product-id="${productData.id}" disabled>
                                        <i class="fas fa-shopping-cart me-1"></i> Proceed to Checkout
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
        this.setupModalEvents(productData, variantsByColor, designerInfo);
        modal.show();

        document.getElementById('productModal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }

    // Color helper functions
    getColorName(colorCode, colorNameFromFirestore = '') {
        if (colorNameFromFirestore && colorNameFromFirestore !== 'Default Color') return colorNameFromFirestore;
        if (!colorCode) return colorNameFromFirestore || 'Unknown Color';
        
        const normalizedColor = colorCode.toLowerCase();
        const colorMap = {
            '#000000': 'Black', '#ffffff': 'White', '#ff0000': 'Red', '#00ff00': 'Green',
            '#0000ff': 'Blue', '#ffff00': 'Yellow', '#ff00ff': 'Magenta', '#00ffff': 'Cyan',
            '#808080': 'Gray', '#c0c0c0': 'Silver', '#800000': 'Maroon', '#008000': 'Green',
            '#000080': 'Navy', '#808000': 'Olive', '#800080': 'Purple', '#008080': 'Teal'
        };
        
        return colorMap[normalizedColor] || colorNameFromFirestore || 'Unknown Color';
    }

    getContrastColor(hexcolor) {
        if (!hexcolor || hexcolor === '#cccccc') return '#000000';
        const r = parseInt(hexcolor.substr(1, 2), 16);
        const g = parseInt(hexcolor.substr(3, 2), 16);
        const b = parseInt(hexcolor.substr(5, 2), 16);
        const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return brightness > 128 ? '#000000' : '#FFFFFF';
    }

    // Comment functionality
    async submitComment(productId, commentInput, commentsContainer) {
        const commentText = commentInput.value.trim();
        if (!commentText) {
            alert("Please enter a comment.");
            return;
        }

        const user = await this.getCurrentUser();
        if (!user) {
            alert("You must be logged in to comment.");
            return;
        }

        const submitButton = commentsContainer?.parentElement?.querySelector('.comment-submit');
        if (!submitButton) return;

        commentInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Posting...";

        try {
            await this.db.collection("product_comments").add({
                userId: user.firestoreUserId,
                productId: productId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0
            });

            commentInput.value = "";
            if (commentsContainer) {
                const successMessage = document.createElement("div");
                successMessage.className = "alert alert-success mt-2";
                successMessage.textContent = "Comment added!";
                commentsContainer.appendChild(successMessage);
                setTimeout(() => successMessage.remove(), 3000);
            }
        } catch (error) {
            console.error("Error submitting comment:", error);
            alert("Failed to submit comment.");
        } finally {
            commentInput.disabled = false;
            submitButton.disabled = false;
            submitButton.textContent = "Post";
        }
    }

    async loadComments(productId, commentsContainer, currentUserId) {
        if (!commentsContainer) return;

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
                    if (commentData.likes_count === undefined) commentData.likes_count = 0;
                    return commentData;
                });

                commentsContainer.innerHTML = "";
                commentsArray.forEach(commentData => {
                    const userData = this.usersCache[commentData.userId] || {};
                    const commentElement = this.createCommentElement(commentData, userData, currentUserId, productId, commentsContainer);
                    commentsContainer.appendChild(commentElement);
                });
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

        let timestamp = new Date();
        if (commentData.timestamp && typeof commentData.timestamp.toDate === 'function') {
            timestamp = commentData.timestamp.toDate();
        } else if (commentData.timestamp instanceof Date) {
            timestamp = commentData.timestamp;
        }

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
                <small class="text-muted">${timestamp.toLocaleString()}</small>
            </div>
            <button class="btn btn-outline-primary btn-sm comment-like-button" data-comment-id="${commentData.id}">
                <span class="comment-like-count">${commentData.likes_count || 0}</span> Likes
            </button>
        `;

        // Profile links in comments
        commentElement.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        // Comment like button
        const likeButton = commentElement.querySelector('.comment-like-button');
        likeButton?.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likeComment(commentData.id, user.firestoreUserId);
            } else {
                alert("You must be logged in to like a comment.");
            }
        });

        return commentElement;
    }

    async likeComment(commentId, userId) {
        if (this.isCommentLiking.has(commentId)) return;
        this.isCommentLiking.add(commentId);

        const likeButton = document.querySelector(`.comment-like-button[data-comment-id="${commentId}"]`);
        const likeCountElement = likeButton?.querySelector('.comment-like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);
        const hasLiked = this.commentLikesCache.get(commentId)?.has(userId) || false;

        if (likeCountElement) likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;

        try {
            const batch = this.db.batch();
            const likeRef = this.db.collection("product_comment_likes").doc(`${commentId}_${userId}`);
            const commentRef = this.db.collection("product_comments").doc(commentId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(commentRef, { likes_count: firebase.firestore.FieldValue.increment(-1) });
                this.commentLikesCache.get(commentId)?.delete(userId);
            } else {
                batch.set(likeRef, { userId, commentId, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
                batch.update(commentRef, { likes_count: firebase.firestore.FieldValue.increment(1) });
                if (!this.commentLikesCache.has(commentId)) this.commentLikesCache.set(commentId, new Set());
                this.commentLikesCache.get(commentId).add(userId);
            }

            await batch.commit();
        } catch (error) {
            console.error("Error updating comment like:", error);
            if (likeCountElement) likeCountElement.textContent = currentLikes;
        } finally {
            this.isCommentLiking.delete(commentId);
        }
    }

    // Helper methods
    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        const userQuery = await this.db.collection("users").where("firebaseUID", "==", user.uid).get();
                        if (!userQuery.empty) user.firestoreUserId = userQuery.docs[0].id;
                    } catch (error) {
                        console.error("Error getting Firestore user ID:", error);
                    }
                }
                resolve(user);
            });
        });
    }

    // UPDATED: Get price display with new pricing structure
    getPriceDisplay(productData) {
        // Try to get price range from pricing_summary first
        if (productData.pricing_summary && productData.pricing_summary.total_price_range) {
            const minPrice = productData.pricing_summary.total_price_range.min;
            const maxPrice = productData.pricing_summary.total_price_range.max;
            
            if (minPrice === maxPrice) {
                return `<strong class="text-primary">R$ ${minPrice.toFixed(2)}</strong>`;
            } else {
                return `<strong class="text-primary">R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}</strong>`;
            }
        }
        
        // Fallback: calculate from variants
        if (!productData.variants || productData.variants.length === 0) {
            return '<strong class="text-muted">Price not available</strong>';
        }
        
        const availableVariants = productData.variants.filter(v => {
            if (!v.availability_status || v.availability_status !== 'active') return false;
            
            // Check if variant has pricing structure
            if (v.pricing && v.pricing.total_price) {
                return !isNaN(v.pricing.total_price) && v.pricing.total_price > 0;
            }
            
            // Check old structure
            if (v.retail_price) return !isNaN(v.retail_price) && v.retail_price > 0;
            if (v.price) return !isNaN(v.price) && v.price > 0;
            
            return false;
        });
        
        if (availableVariants.length === 0) {
            return '<strong class="text-muted">Price not available</strong>';
        }
        
        // Extract prices from new structure
        const prices = availableVariants.map(v => {
            if (v.pricing && v.pricing.total_price) {
                return parseFloat(v.pricing.total_price);
            } else if (v.retail_price) {
                return parseFloat(v.retail_price);
            } else if (v.price) {
                return parseFloat(v.price);
            }
            return 0;
        }).filter(price => price > 0);
        
        if (prices.length === 0) {
            return '<strong class="text-muted">Price not available</strong>';
        }
        
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        
        if (minPrice === maxPrice) {
            return `<strong class="text-primary">R$ ${minPrice.toFixed(2)}</strong>`;
        } else {
            return `<strong class="text-primary">R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}</strong>`;
        }
    }

    // UPDATED: Get modal price display with breakdown
    getModalPriceDisplay(productData) {
        let priceHtml = '';
        
        // Show price range from pricing_summary
        if (productData.pricing_summary) {
            const summary = productData.pricing_summary;
            const minPrice = summary.total_price_range?.min || 0;
            const maxPrice = summary.total_price_range?.max || 0;
            
            if (minPrice === maxPrice) {
                priceHtml = `<h4 class="text-primary fw-bold">R$ ${minPrice.toFixed(2)}</h4>`;
            } else {
                priceHtml = `<h4 class="text-primary fw-bold">R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}</h4>`;
            }
            
            // Add price breakdown if available
            if (summary.product_price_range) {
                priceHtml += `
                    <small class="text-muted d-block">
                        Base cost: R$ ${summary.product_price_range.min.toFixed(2)} - R$ ${summary.product_price_range.max.toFixed(2)}
                    </small>
                `;
            }
            
            if (summary.artist_cut) {
                priceHtml += `
                    <small class="text-muted d-block">
                        Artist markup: R$ ${summary.artist_cut.toFixed(2)}
                    </small>
                `;
            }
            
            if (summary.platform_fee_percentage) {
                priceHtml += `
                    <small class="text-muted d-block">
                        Platform fee: ${(summary.platform_fee_percentage * 100)}%
                    </small>
                `;
            }
        } else {
            // Fallback to simple price display
            priceHtml = `<h4 class="text-primary fw-bold">${this.getPriceDisplay(productData)}</h4>`;
        }
        
        return priceHtml;
    }

    createLightboxThumbnailDisplay(productData, selectedColor) {
        const thumbnailSrc = productData.thumbnailUrl || productData.thumbnail;
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorVariants = variantsByColor[selectedColor] || [];
        const colorCode = colorVariants[0]?.color_code || colorVariants[0]?.colorCode || '#ffffff';
        
        return thumbnailSrc ? `
            <div style="background-color: ${colorCode}; border-radius: 8px; padding: 20px; text-align: center;">
                <img src="${thumbnailSrc}" class="img-fluid rounded" alt="${productData.productTitle}"
                     style="max-width: 100%; max-height: 70vh; width: auto; height: auto; object-fit: contain;">
            </div>
        ` : `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-5x mb-3"></i><p>No image available</p></div>`;
    }

    createThumbnailDisplay(productData, selectedColor) {
        const thumbnailSrc = productData.thumbnailUrl || productData.thumbnail;
        const variantsByColor = this.groupVariantsByColor(productData.variants);
        const colorVariants = variantsByColor[selectedColor] || [];
        const colorCode = colorVariants[0]?.color_code || colorVariants[0]?.colorCode || '#ffffff';
        
        return thumbnailSrc ? `
            <div style="background-color: ${colorCode}; border-radius: 8px; line-height: 0;">
                <img src="${thumbnailSrc}" class="img-fluid rounded" alt="${productData.productTitle}"
                     style="max-width: 300px; max-height: 300px; width: auto; height: auto; object-fit: contain; display: block;">
            </div>
        ` : `<div class="text-muted p-4 text-center"><i class="fas fa-image fa-3x mb-2"></i><p>No image available</p></div>`;
    }

    // UPDATED: Create size options with new pricing structure
    createSizeOptions(variants) {
        if (!variants || variants.length === 0) return '<p class="text-muted">No sizes available</p>';
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
        const sortedVariants = variants.sort((a, b) => sizeOrder.indexOf(a.size || '') - sizeOrder.indexOf(b.size || ''));
        
        return sortedVariants.map(variant => {
            const isAvailable = this.isVariantAvailable(variant);
            
            // Get price from new structure
            let price = 0;
            let priceDisplay = 'Price N/A';
            
            if (variant.pricing && variant.pricing.total_price) {
                price = parseFloat(variant.pricing.total_price);
                priceDisplay = `R$ ${price.toFixed(2)}`;
            } else if (variant.retail_price) {
                price = parseFloat(variant.retail_price);
                priceDisplay = `R$ ${price.toFixed(2)}`;
            } else if (variant.price) {
                price = parseFloat(variant.price);
                priceDisplay = `R$ ${price.toFixed(2)}`;
            }
            
            return `<button class="btn btn-outline-secondary size-option ${isAvailable ? '' : 'disabled'}" 
                    data-variant-id="${variant.id}" 
                    data-variant-full='${JSON.stringify(variant).replace(/'/g, "\\'")}'
                    data-color="${variant.color}" 
                    data-size="${variant.size}" 
                    data-price="${price}"
                    ${!isAvailable ? 'disabled' : ''}>
                    ${variant.size || 'One Size'} ${!isAvailable ? '(Unavailable)' : `- ${priceDisplay}`}
                </button>`;
        }).join('');
    }

    setupLightboxModalEvents(productData, variantsByColor) {
        const modalElement = document.getElementById('imageLightboxModal');
        if (!modalElement) return;

        let currentColor = Object.keys(variantsByColor)[0];
        const self = this;

        modalElement.querySelectorAll('.color-option-btn').forEach(button => {
            button.addEventListener('click', function() {
                modalElement.querySelectorAll('.color-option-btn').forEach(btn => btn.style.borderColor = 'transparent');
                this.style.borderColor = '#007bff';
                currentColor = this.dataset.color;
                const colorCode = this.dataset.colorCode;
                
                const selectedColorName = modalElement.querySelector('#lightbox-selected-color-name');
                if (selectedColorName) {
                    const firstVariant = variantsByColor[currentColor][0];
                    const colorNameFromFirestore = firstVariant?.color || currentColor;
                    selectedColorName.textContent = self.getColorName(colorCode, colorNameFromFirestore);
                }
                
                self.updateLightboxThumbnailBackground(productData, currentColor);
            });
        });

        const lightboxBuyButton = modalElement.querySelector('.lightbox-buy-button');
        lightboxBuyButton?.addEventListener('click', async () => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('imageLightboxModal'));
            if (modal) modal.hide();
            
            // Get designer info with PIX key
            const designerInfo = await this.getDesignerWithPixKey(productData.designerUserId);
            this.showProductModal(productData, designerInfo);
        });
    }

    setupModalEvents(productData, variantsByColor, designerInfo = null) {
        const modalElement = document.getElementById('productModal');
        if (!modalElement) return;

        let selectedVariant = null;
        let currentColor = Object.keys(variantsByColor)[0];
        const self = this;

        modalElement.querySelectorAll('.color-option-btn').forEach(button => {
            button.addEventListener('click', function() {
                modalElement.querySelectorAll('.color-option-btn').forEach(btn => btn.style.borderColor = 'transparent');
                this.style.borderColor = '#007bff';
                currentColor = this.dataset.color;
                const colorCode = this.dataset.colorCode;
                
                const selectedColorName = modalElement.querySelector('#selected-color-name');
                if (selectedColorName) {
                    const firstVariant = variantsByColor[currentColor][0];
                    const colorNameFromFirestore = firstVariant?.color || currentColor;
                    selectedColorName.textContent = self.getColorName(colorCode, colorNameFromFirestore);
                }
                
                self.updateThumbnailBackground(productData, currentColor);
                
                const sizeOptionsContainer = document.getElementById('size-options-container');
                if (sizeOptionsContainer) {
                    sizeOptionsContainer.innerHTML = self.createSizeOptions(variantsByColor[currentColor]);
                }
                
                selectedVariant = null;
                modalElement.querySelector('.selected-variant').style.display = 'none';
                modalElement.querySelector('.buy-from-modal').disabled = true;
                modalElement.querySelector('.buy-from-modal').textContent = '<i class="fas fa-shopping-cart me-1"></i> Proceed to Checkout';
                
                // Re-attach size listeners
                attachSizeListeners();
            });
        });

        const attachSizeListeners = () => {
            modalElement.querySelectorAll('.size-option:not(.disabled)').forEach(button => {
                button.addEventListener('click', function() {
                    modalElement.querySelectorAll('.size-option').forEach(btn => {
                        btn.classList.remove('btn-primary');
                        btn.classList.add('btn-outline-secondary');
                    });
                    this.classList.remove('btn-outline-secondary');
                    this.classList.add('btn-primary');
                    
                    // Get the full variant data
                    const variantData = JSON.parse(this.dataset.variantFull || '{}');
                    const price = parseFloat(this.dataset.price);
                    
                    selectedVariant = {
                        id: parseInt(this.dataset.variantId),
                        variant_id: variantData.variant_id || variantData.id,
                        color: this.dataset.color,
                        size: this.dataset.size,
                        price: price,
                        color_code: variantData.color_code,
                        colorCode: variantData.colorCode,
                        // Include full pricing data
                        pricing: variantData.pricing || null
                    };
                    
                    const selectedDiv = modalElement.querySelector('.selected-variant');
                    selectedDiv.querySelector('.selected-color-size').textContent = `${currentColor} - ${selectedVariant.size}`;
                    selectedDiv.querySelector('.selected-price').textContent = `R$ ${selectedVariant.price.toFixed(2)}`;
                    
                    // Add pricing details if available
                    const detailsElement = selectedDiv.querySelector('#selected-variant-details');
                    if (selectedVariant.pricing) {
                        const details = `
                            Base: R$ ${selectedVariant.pricing.product_price?.toFixed(2) || '0.00'} | 
                            Artist: R$ ${selectedVariant.pricing.artist_cut?.toFixed(2) || '0.00'} | 
                            Platform: R$ ${selectedVariant.pricing.platform_fee?.toFixed(2) || '0.00'}
                        `;
                        if (detailsElement) detailsElement.textContent = details;
                    }
                    
                    selectedDiv.style.display = 'block';
                    
                    const buyButton = modalElement.querySelector('.buy-from-modal');
                    buyButton.disabled = false;
                    buyButton.innerHTML = `<i class="fas fa-shopping-cart me-1"></i> Proceed to Checkout - R$ ${selectedVariant.price.toFixed(2)}`;
                });
            });
        };
        
        attachSizeListeners();

        modalElement.querySelector('.buy-from-modal').addEventListener('click', () => {
            if (selectedVariant) this.handleBuyFromModal(productData, selectedVariant, designerInfo);
        });
    }

    // UPDATED: Handle buy from modal with complete pricing data
    handleBuyFromModal(productData, selectedVariant, designerInfo) {
        try {
            // Prepare complete product data for checkout
            const productWithVariant = {
                // Basic product info
                ...productData,
                firestoreProductId: productData.id,
                
                // Selected variant info
                selectedVariant: selectedVariant,
                
                // Complete pricing information
                pricing: selectedVariant.pricing || {
                    product_price: selectedVariant.price * 0.7, // Estimate if not available
                    artist_cut: selectedVariant.price * 0.25,  // Estimate if not available
                    platform_fee: selectedVariant.price * 0.05, // 5% estimate
                    total_price: selectedVariant.price,
                    currency: 'BRL'
                },
                
                // Designer information
                designerName: designerInfo?.name || productData.designerName || 'Unknown Designer',
                designerUserId: productData.designerUserId,
                
                // Product images
                thumbnailUrl: productData.thumbnailUrl || productData.thumbnail,
                designUrl: productData.designUrl,
                
                // PIX information for payment
                pix_key: designerInfo?.pix_key || null,
                pix_keyType: designerInfo?.pix_keyType || null,
                designerEmail: designerInfo?.email || null,
                
                // Timestamp
                purchaseTimestamp: new Date().toISOString()
            };

            console.log('🚀 Product data for purchase:', {
                productTitle: productWithVariant.productTitle,
                price: selectedVariant.price,
                variantId: selectedVariant.variant_id || selectedVariant.id,
                size: selectedVariant.size,
                color: selectedVariant.color,
                designerName: productWithVariant.designerName,
                pix_key: productWithVariant.pix_key,
                pix_keyType: productWithVariant.pix_keyType,
                pricing: productWithVariant.pricing
            });

            const modal = bootstrap.Modal.getInstance(document.getElementById('productModal'));
            if (modal) modal.hide();

            // Save to session storage and redirect to checkout page
            sessionStorage.setItem('selectedProduct', JSON.stringify(productWithVariant));
            window.location.href = 'pagamentos.html';

        } catch (error) {
            console.error('Error preparing product for purchase:', error);
            alert('Error preparing product for purchase. Please try again.');
        }
    }

    updateLightboxThumbnailBackground(productData, selectedColor) {
        const thumbnailContainer = document.getElementById('lightbox-thumbnail-container');
        if (!thumbnailContainer) return;
        thumbnailContainer.innerHTML = this.createLightboxThumbnailDisplay(productData, selectedColor);
    }

    updateThumbnailBackground(productData, selectedColor) {
        const thumbnailContainer = document.getElementById('thumbnail-container');
        if (!thumbnailContainer) return;
        thumbnailContainer.innerHTML = this.createThumbnailDisplay(productData, selectedColor);
    }

    observeLastProduct(lastProductElement, filterUserId) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading) {
                    observer.disconnect();
                    this.displayProducts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });
        observer.observe(lastProductElement);
    }

    isVariantAvailable(variant) {
        // Check if variant is available
        if (variant.availability_status && variant.availability_status !== 'active') {
            return false;
        }
        
        // Check if variant has valid pricing
        if (variant.pricing && variant.pricing.total_price) {
            return !isNaN(variant.pricing.total_price) && variant.pricing.total_price > 0;
        }
        
        if (variant.retail_price) {
            return !isNaN(variant.retail_price) && variant.retail_price > 0;
        }
        
        if (variant.price) {
            return !isNaN(variant.price) && variant.price > 0;
        }
        
        return false;
    }

    groupVariantsByColor(variants) {
        const grouped = {};
        if (!variants || variants.length === 0) return grouped;
        variants.forEach(variant => {
            const color = variant.color || 'Default Color';
            if (!grouped[color]) grouped[color] = [];
            grouped[color].push({ ...variant });
        });
        return grouped;
    }

    async likeProduct(productId, userId) {
        if (this.isLiking.has(productId)) return;
        this.isLiking.add(productId);

        const likeRef = this.db.collection("product_likes").doc(`${productId}_${userId}`);
        const likeDocSnapshot = await likeRef.get();
        const hasLiked = likeDocSnapshot.exists;

        try {
            const batch = this.db.batch();
            const productRef = this.db.collection("products").doc(productId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(productRef, { likes_count: firebase.firestore.FieldValue.increment(-1) });
            } else {
                batch.set(likeRef, { userId, productId, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
                batch.update(productRef, { likes_count: firebase.firestore.FieldValue.increment(1) });
            }

            await batch.commit();
        } finally {
            this.isLiking.delete(productId);
        }
    }

    async getLikesCount(productId) {
        const productDoc = await this.db.collection("products").doc(productId).get();
        return productDoc.data().likes_count || 0;
    }

    async deleteProduct(productId, filterUserId) {
        if (!confirm("Are you sure you want to delete this product?")) return;
        try {
            await this.db.collection("products").doc(productId).delete();
            alert("Product deleted successfully.");
            this.displayProducts(filterUserId);
        } catch (error) {
            console.error("Error deleting product:", error);
            alert("Failed to delete product.");
        }
    }
};

// Initialize function
window.initializeProductManager = function(containerId) {
    return new ProductManager(db, auth, containerId);
};