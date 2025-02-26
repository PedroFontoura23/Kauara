class ProductsManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {};
        this.productsCache = {};
        this.currentFilterUserId = filterUserId;
        this.currentUserId = null;
        this.batchSize = 2;
        this.isLoading = false;
        this.lastVisibleProduct = null;

        // Initialize productRatingSystems if it doesn't exist
        if (!window.productRatingSystems) {
            window.productRatingSystems = {};
        }

        // For comments and ratings
        this.commentListeners = {};
        this.ratingListeners = {};
        this.commentLikesCache = new Map();
        this.isLiking = new Set();
        this.isCommentLiking = new Set();

        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    this.currentUserId = await this.getUserIdFromUid(user.uid);
                    console.log("Current user ID set:", this.currentUserId);

                    // Reinitialize product rating systems after setting currentUserId
                    Object.keys(window.productRatingSystems).forEach(productId => {
                        const ratingSystem = window.productRatingSystems[productId];
                        if (ratingSystem) {
                            ratingSystem.currentUserId = this.currentUserId;
                            ratingSystem.init(); // Reload the rating system
                        }
                    });

                } catch (error) {
                    console.error("Error fetching current user ID:", error);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
            }
        });
    }

    // Helper function to get the Firestore user ID from Firebase UID
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

    async getCurrentUser() {
        const currentFirebaseUser = this.auth.currentUser;
        if (!currentFirebaseUser) {
            return null;
        }

        try {
            const firestoreUserId = await this.getUserIdFromUid(currentFirebaseUser.uid);
            return {
                firebaseUser: currentFirebaseUser,
                firestoreUserId: firestoreUserId
            };
        } catch (error) {
            console.error("Error getting current user:", error);
            return null;
        }
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

    async displayProducts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) {
            console.error("Products container not found");
            return;
        }

        if (this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) {
                currentUserId = user.firestoreUserId;
            }
        }

        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML = "<p>Loading products...</p>";
            this.lastVisibleProduct = null;
            this.currentFilterUserId = filterUserId;
        }

        try {
            let query = this.db.collection("products")
                .orderBy("timestamp", "desc");

            if (this.currentFilterUserId) {
                query = query.where("foreignUserId", "==", this.currentFilterUserId);
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

            const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
            const uniqueUserIds = [...new Set(userIds)];
            await this.cacheUsers(uniqueUserIds);

            if (!loadMore) {
                this.container.innerHTML = "";
            }

            snapshot.docs.forEach(doc => {
                const productData = doc.data();
                const userData = this.usersCache[productData.foreignUserId] || {};
                const productElement = this.createProductElement(doc.id, productData, userData, currentUserId);
                this.container.appendChild(productElement);

                // Load comments for the product
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

    createProductElement(productId, productData, userData, currentUserId) {
        const isCurrentUserProduct = productData.foreignUserId === currentUserId;
        const productElement = document.createElement("div");
        productElement.className = "card mb-4";

        const timestamp = productData.timestamp?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const averageRating = productData.averageRating || 0;
        const totalRatings = productData.totalRatings || 0;
        const stars = '⭐'.repeat(Math.round(averageRating));

        productElement.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width: 40px; height: 40px; object-fit: cover; cursor: pointer;"
                     data-user-id="${productData.foreignUserId}">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor: pointer;" data-user-id="${productData.foreignUserId}">
                        ${userData.user_Name || "Unknown User"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <h5 class="card-title">${productData.name}</h5>
                <p class="card-text">${productData.description}</p>
                ${productData.image ? `
                    <img src="${productData.image}" 
                         class="img-fluid rounded lazy-load" 
                         alt="Product Image"
                         style="max-height: 500px; width: auto;"
                         loading="lazy">
                ` : ''}
                <p class="card-text"><strong>Price:</strong> $${productData.price}</p>
                <p class="card-text"><strong>Printful Product ID:</strong> ${productData.productId}</p>
                <div class="rating-section mb-3">
                    <div class="current-rating">
                        ${stars}
                        (${averageRating.toFixed(1)} average from ${totalRatings} ratings)
                    </div>
                </div>
                <button class="btn btn-primary" onclick="comprarProduto('${productData.productId}')">Comprar</button>
            </div>
            <div class="card-footer">
                <!-- Comments Button -->
                <button class="btn btn-outline-secondary comments-toggle-button" data-product-id="${productId}">
                    Show Comments
                </button>

                <!-- Comments Container (Hidden by Default) -->
                <div class="comments-container mt-3" id="comments-${productId}" style="display: none;"></div>

                <!-- Comment Input Section (Hidden by Default) -->
                <div class="comment-input-container mt-2" id="commentInputContainer-${productId}" style="display: none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${productId}">
                        <button class="btn btn-outline-primary comment-submit" data-product-id="${productId}">Post</button>
                    </div>
                </div>

                <!-- Delete Product Button (if applicable) -->
                ${isCurrentUserProduct ? `<button class="btn btn-danger mt-2 delete-product-button" data-product-id="${productId}">Delete Product</button>` : ''}
            </div>
        `;

        // Add event listeners for profile links, comment submission, and product deletion
        const profileLinks = productElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        const commentsContainer = productElement.querySelector('.comments-container');
        const commentInputContainer = productElement.querySelector('.comment-input-container');
        const commentsToggleButton = productElement.querySelector('.comments-toggle-button');

        // Toggle comments and comment input visibility
        commentsToggleButton.addEventListener('click', async () => {
            const isCommentsVisible = commentsContainer.style.display === "block";
            if (!isCommentsVisible) {
                // Load comments if they haven't been loaded yet
                if (commentsContainer.innerHTML === "") {
                    await this.loadComments(productId, commentsContainer, currentUserId);
                }
                commentsContainer.style.display = "block";
                commentInputContainer.style.display = "block"; // Show the comment input bar
                commentsToggleButton.textContent = "Hide Comments";
            } else {
                commentsContainer.style.display = "none";
                commentInputContainer.style.display = "none"; // Hide the comment input bar
                commentsToggleButton.textContent = "Show Comments";
            }
        });

        // Handle comment submission
        const commentInput = productElement.querySelector('.comment-input');
        const commentSubmitButton = productElement.querySelector('.comment-submit');
        commentSubmitButton.addEventListener('click', () => this.submitComment(productId, commentInput, commentsContainer));

        // Handle "Enter" key for comment submission
        commentInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent default behavior (e.g., adding a new line)
                this.submitComment(productId, commentInput, commentsContainer);
            }
        });

        // Add event listener for the delete product button (if applicable)
        if (isCurrentUserProduct) {
            const deleteProductButton = productElement.querySelector('.delete-product-button');
            deleteProductButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to delete this product and all its comments?")) {
                    this.deleteProduct(productId, this.currentFilterUserId);
                }
            });
        }
                // Initialize the rating system
        const ratingContainer = document.createElement("div");
        ratingContainer.id = `rating-${productId}`;
        productElement.querySelector(".rating-section").appendChild(ratingContainer);

        (async () => {
            if (!currentUserId) {
                const user = await this.getCurrentUser();
                currentUserId = user ? user.firestoreUserId : null;
            }

            console.log(`Initializing ProductRatingSystem for ${productId} with userId:`, currentUserId);

            if (window.ProductRatingSystem) {
                window.productRatingSystems[productId] = new window.ProductRatingSystem(productId, ratingContainer, this.db, currentUserId);
            } else {
                console.warn(`ProductRatingSystem is not defined for product ${productId}`);
            }
        })();

            // Função para comprar o produto no Printful
        function comprarProduto(productId) {
            window.open(`https://www.printful.com/product/${productId}`, '_blank');
        }

        return productElement;
    }

    async handleRating(productId, ratingValue) {
        if (!this.currentUserId) {
            alert('Please log in to rate products.');
            return;
        }

        try {
            const productRatingSystem = window.productRatingSystems[productId];
            if (productRatingSystem && typeof productRatingSystem.submitRating === 'function') {
                await productRatingSystem.submitRating(ratingValue);

                // Fetch updated product data
                const productDoc = await this.db.collection("products").doc(productId).get();
                const productData = productDoc.data();

                // Update UI without waiting for server response
                const productContainer = document.querySelector(`[data-product-id="${productId}"]`);
                if (productContainer) {
                    const ratingSection = productContainer.querySelector('.rating-section');
                    if (ratingSection) {
                        const averageRating = productData.averageRating || 0;
                        const totalRatings = productData.totalRatings || 0;
                        const stars = '⭐'.repeat(Math.round(averageRating));

                        // Animate the update
                        ratingSection.classList.add('rating-animation');
                        ratingSection.innerHTML = `
                            ${stars}
                            (${averageRating.toFixed(1)} average from ${totalRatings} ratings)
                            ${!this.isCurrentUserProduct ? `
                                ${[1, 2, 3, 4, 5].map(rating => `
                                    <button class="rating-btn" data-rating="${rating}">${rating} ⭐</button>
                                `).join('')}
                            ` : ''}
                        `;

                        // Remove animation class after animation completes
                        setTimeout(() => {
                            ratingSection.classList.remove('rating-animation');
                        }, 500);

                        // Reattach event listeners for new buttons
                        ratingSection.querySelectorAll('.rating-btn').forEach(button => {
                            button.addEventListener('click', async () => {
                                const newRatingValue = parseInt(button.getAttribute('data-rating'));
                                await this.handleRating(productId, newRatingValue);
                            });
                        });
                    }
                }
            } else {
                console.error(`ProductRatingSystem not found or submitRating is not a function for product ${productId}`);
            }
        } catch (error) {
            console.error("Error handling rating:", error);
            alert('Failed to submit rating.');
        }
    }
    createCommentElement(commentData, userData, currentUserId, productId, commentsContainer) {
        const commentElement = document.createElement("div");
        commentElement.className = "mb-3 d-flex align-items-center";
        commentElement.setAttribute("data-comment-id", commentData.id); // Add unique identifier

        // Handle the timestamp
        let timestamp;
        if (commentData.timestamp && typeof commentData.timestamp.toDate === 'function') {
            // If it's a Firestore Timestamp object, convert it to a Date
            timestamp = commentData.timestamp.toDate();
        } else if (commentData.timestamp instanceof Date) {
            // If it's already a Date object, use it directly
            timestamp = commentData.timestamp;
        } else {
            // If no valid timestamp is provided, use the current time
            timestamp = new Date();
        }

        // Check if the current user has liked the comment
        const hasLiked = this.hasUserLikedComment(commentData.id, currentUserId);

        // Create the comment content
        commentElement.innerHTML = `
            <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : 'default-profile.png'}" 
                 class="rounded-circle me-2 user-profile-link"
                 style="width: 40px; height: 40px; cursor: pointer;"
                 data-user-id="${commentData.foreignUserId}"
                 alt="Profile Picture">
            <div class="d-flex flex-column flex-grow-1">
                <strong class="user-profile-link" style="cursor: pointer;" data-user-id="${commentData.foreignUserId}">
                    ${userData.user_Name || "Unknown User"}
                </strong>
                <span>${commentData.content}</span>
                <small class="text-muted">
                    ${timestamp.toLocaleString()} <!-- Use the timestamp directly -->
                </small>
            </div>
            <!-- Like Button for Comments -->
            <button class="btn btn-outline-primary btn-sm comment-like-button" data-comment-id="${commentData.id}">
                <span class="comment-like-count">${commentData.likes_count || 0}</span> Likes
            </button>
        `;

        // Create the three-dots menu
        const dotsMenu = document.createElement("span");
        dotsMenu.innerHTML = "&#8942;"; // Three dots icon
        dotsMenu.style.cursor = "pointer";
        dotsMenu.style.marginLeft = "auto"; // Push the menu to the right

        // Create the popup container
        const popup = document.createElement("div");
        popup.style.display = "none"; // Initially hidden
        popup.style.position = "fixed"; // Use fixed positioning for the viewport
        popup.style.backgroundColor = "white";
        popup.style.border = "1px solid #ddd";
        popup.style.borderRadius = "4px";
        popup.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
        popup.style.padding = "8px";
        popup.style.minWidth = "120px";
        popup.style.zIndex = "1000"; // Ensure it's on top of other elements

        // Add the delete button if the comment belongs to the current user
        if (commentData.foreignUserId === currentUserId) {
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
                e.stopPropagation(); // Prevent the click from bubbling up
                this.deleteComment(commentData.id, productId, commentsContainer, currentUserId);
            });
            popup.appendChild(deleteButton); // Add the button to the popup
        }

        // Add click event to the three-dots menu to toggle the popup
        dotsMenu.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent the click from bubbling up

            // Calculate the center of the screen
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const popupWidth = popup.offsetWidth;
            const popupHeight = popup.offsetHeight;

            // Position the popup in the center
            popup.style.left = `${(screenWidth - popupWidth) / 2}px`;
            popup.style.top = `${(screenHeight - popupHeight) / 2}px`;

            // Toggle the popup visibility
            popup.style.display = popup.style.display === "block" ? "none" : "block";
        });

        // Close the popup when clicking outside
        document.addEventListener("click", () => {
            popup.style.display = "none";
        });

        // Append the three-dots menu and popup to the comment element
        const optionsContainer = document.createElement("div");
        optionsContainer.style.position = "relative"; // Ensure the popup is positioned correctly
        optionsContainer.appendChild(dotsMenu);
        optionsContainer.appendChild(popup);

        // Append the options container to the comment element
        commentElement.appendChild(optionsContainer);

        // Add event listener for the comment like button
        const likeButton = commentElement.querySelector('.comment-like-button');
        likeButton.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likeComment(commentData.id, user.firestoreUserId);
            } else {
                alert("You must be logged in to like a comment.");
            }
        });

        // Add click events for profile navigation
        const profileLinks = commentElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
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

        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            const batch = this.db.batch();

            const likeRef = this.db.collection("comment_likes").doc(`${commentId}_${userId}`);
            const commentRef = this.db.collection("comments").doc(commentId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.commentLikesCache.get(commentId)?.delete(userId);
            } else {
                batch.set(likeRef, {
                    foreignUserId: userId,
                    foreignCommentId: commentId,
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
            alert("Failed to update comment like. Please try again.");
        } finally {
            this.isCommentLiking.delete(commentId);
        }
    }

    async loadCommentLikes(commentId) {
        const likesSnapshot = await this.db.collection("comment_likes")
            .where("foreignCommentId", "==", commentId)
            .get();

        const userIds = new Set();
        likesSnapshot.forEach(doc => {
            userIds.add(doc.data().foreignUserId);
        });

        this.commentLikesCache.set(commentId, userIds);
    }

    hasUserLikedComment(commentId, userId) {
        return this.commentLikesCache.get(commentId)?.has(userId) || false;
    }

    async loadComments(productId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        commentsContainer.style.maxHeight = "300px";
        commentsContainer.style.overflowY = "auto";

        if (this.commentListeners[productId]) {
            this.commentListeners[productId]();
            delete this.commentListeners[productId];
        }

        const renderedCommentIds = new Set();
        let commentsArray = [];

        const unsubscribe = this.db.collection("comments")
            .where("foreignProductId", "==", productId)
            .orderBy("likes_count", "desc")
            .orderBy("timestamp", "asc")
            .onSnapshot(async (snapshot) => {
                if (snapshot.empty) {
                    commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
                    return;
                }

                const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
                const uniqueUserIds = [...new Set(userIds)];
                await this.cacheUsers(uniqueUserIds);

                commentsArray = snapshot.docs.map(doc => {
                    const commentData = { id: doc.id, ...doc.data() };
                    if (commentData.likes_count === undefined || commentData.likes_count === null) {
                        commentData.likes_count = 0;
                    }
                    return commentData;
                });

                commentsContainer.innerHTML = "";

                const displayComments = commentsArray.slice(0, 8);

                displayComments.forEach(commentData => {
                    const userData = this.usersCache[commentData.foreignUserId] || {};
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
                            const userData = this.usersCache[commentData.foreignUserId] || {};
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

    async submitComment(productId, commentInput, commentsContainer) {
        console.log("Starting comment submission...");

        if (this.isSubmitting) {
            console.log("A submission is already in progress. Ignoring this request.");
            return;
        }

        this.isSubmitting = true;
        console.log("Submission flag set to true.");

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

        const submitButton = commentsContainer.parentElement.querySelector('.comment-submit');
        if (!submitButton) {
            console.error("Submit button not found. Aborting submission.");
            this.isSubmitting = false;
            return;
        }

        commentInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Posting...";

        try {
            await this.db.collection("comments").add({
                foreignUserId: user.firestoreUserId,
                foreignProductId: productId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0
            });

            console.log("Comment submitted successfully.");

            commentInput.value = "";

            const successMessage = document.createElement("div");
            successMessage.className = "alert alert-success mt-2";
            successMessage.textContent = "Comment added!";
            commentsContainer.appendChild(successMessage);

            setTimeout(() => {
                successMessage.remove();
            }, 3000);
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

    async deleteComment(commentId, productId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        if (!confirm("Are you sure you want to delete this comment and all its likes?")) {
            return;
        }

        try {
            const batch = this.db.batch();

            const commentRef = this.db.collection("comments").doc(commentId);
            batch.delete(commentRef);

            const likesQuery = this.db.collection("comment_likes")
                .where("foreignCommentId", "==", commentId);
            const likesSnapshot = await likesQuery.get();
            likesSnapshot.forEach(doc => {
                const likeRef = this.db.collection("comment_likes").doc(doc.id);
                batch.delete(likeRef);
            });

            await batch.commit();

            const deletedCommentElement = commentsContainer.querySelector(`[data-comment-id="${commentId}"]`);
            if (deletedCommentElement) {
                deletedCommentElement.remove();
            }

            console.log("Comment and associated likes deleted successfully.");
        } catch (error) {
            console.error("Error deleting comment:", error);
            alert("Failed to delete comment. Please try again.");
        }
    }

    async deleteProduct(productId, filterUserId) {
        if (!confirm("Are you sure you want to delete this product and all its comments and likes?")) {
            return;
        }

        try {
            const batch = this.db.batch();

            const productRef = this.db.collection("products").doc(productId);
            batch.delete(productRef);

            const commentsSnapshot = await this.db.collection("comments")
                .where("foreignProductId", "==", productId)
                .get();

            commentsSnapshot.forEach(doc => {
                const commentRef = this.db.collection("comments").doc(doc.id);
                batch.delete(commentRef);

                const commentLikesQuery = this.db.collection("comment_likes")
                    .where("foreignCommentId", "==", doc.id);
                commentLikesQuery.get().then(likesSnapshot => {
                    likesSnapshot.forEach(likeDoc => {
                        const likeRef = this.db.collection("comment_likes").doc(likeDoc.id);
                        batch.delete(likeRef);
                    });
                });
            });

            const productLikesQuery = this.db.collection("likes")
                .where("foreignProductId", "==", productId);
            const productLikesSnapshot = await productLikesQuery.get();
            productLikesSnapshot.forEach(doc => {
                const likeRef = this.db.collection("likes").doc(doc.id);
                batch.delete(likeRef);
            });

            await batch.commit();

            this.displayProducts(filterUserId);

            alert("Product, comments, and associated likes deleted successfully.");
        } catch (error) {
            console.error("Error deleting product:", error);
            alert("Failed to delete product. Please try again.");
        }
    }
}