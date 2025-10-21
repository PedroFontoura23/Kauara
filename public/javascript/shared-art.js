console.log("shared-arts.js loaded!");

window.initializeArtManager = function(containerId) {
    return new ArtManager(db, auth, containerId);
};

class ArtManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {};
        this.artsCache = {};
        this.commentListeners = {};
        this.likesCache = new Map();
        this.commentLikesCache = new Map();
        this.isLiking = new Set();
        this.isCommentLiking = new Set();
        this.lastVisibleArt = null;
        this.batchSize = 2;
        this.isLoading = false;
        this.currentFilterUserId = filterUserId;
        this.currentUserId = null;

        // Listen for authentication state changes
        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    this.currentUserId = await this.getUserIdFromUid(user.uid);
                    console.log("Current user ID set:", this.currentUserId);
                    
                    // Store user ID in sessionStorage for use in other pages
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

    cleanupCommentListeners() {
        for (const artId in this.commentListeners) {
            if (this.commentListeners[artId]) {
                this.commentListeners[artId]();
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

    // Get the current logged-in user's Firestore user ID
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

    // Display arts with proper user ID verification
    async displayArts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) {
            console.error("Arts container not found");
            return;
        }

        if (this.isLoading) return;
        this.isLoading = true;

        // If currentUserId isn't provided, try to get it
        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) {
                currentUserId = user.firestoreUserId;
            }
        }

        // If not loading more or if filter changed, reset the view
        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML = "<p>Loading arts...</p>";
            this.lastVisibleArt = null;
            this.currentFilterUserId = filterUserId;
        }

        try {
            if (filterUserId) {
                console.log(`Fetching arts for user: ${filterUserId}`);
            } else {
                console.log("Fetching arts for no specific user (all arts)");
            }

            // Start with base query for arts
            let query = this.db.collection("arts")
                .orderBy("createdAt", "desc");

            // If filterUserId is provided, add the where clause
            if (this.currentFilterUserId) {
                query = query.where("userId", "==", this.currentFilterUserId);
            }

            // Add limit
            query = query.limit(this.batchSize);

            // Add startAfter if loading more
            if (loadMore && this.lastVisibleArt) {
                query = query.startAfter(this.lastVisibleArt);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                if (!loadMore) {
                    this.container.innerHTML = "<p>No arts available.</p>";
                }
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().userId);
            const uniqueUserIds = [...new Set(userIds)];
            await this.cacheUsers(uniqueUserIds);

            if (!loadMore) {
                this.container.innerHTML = "";
            }

            snapshot.docs.forEach(doc => {
                const artData = doc.data();
                const userData = this.usersCache[artData.userId] || {};
                const artElement = this.createArtElement(doc.id, artData, userData, currentUserId);
                this.container.appendChild(artElement);

                const commentsContainer = artElement.querySelector(`#comments-${doc.id}`);
                if (commentsContainer) {
                    // Pass currentUserId to loadComments
                    this.loadComments(doc.id, commentsContainer, currentUserId);
                }
            });

            this.lastVisibleArt = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                const lastArtElement = this.container.lastElementChild;
                this.observeLastArt(lastArtElement, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("Error fetching arts:", error);
            if (!loadMore) {
                this.container.innerHTML = "<p>Error loading arts.</p>";
            }
        } finally {
            this.isLoading = false;
        }
    }

    observeLastArt(lastArtElement, filterUserId) {
        let isDebounced = false;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading && !isDebounced) {
                    isDebounced = true;
                    observer.disconnect();

                    setTimeout(() => {
                        isDebounced = false;
                    }, 1000);

                    this.displayArts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });

        observer.observe(lastArtElement);
    }

    createArtElement(artId, artData, userData, currentUserId) {
        const isCurrentUserArt = artData.userId === currentUserId;
        const artElement = document.createElement("div");
        artElement.className = "card mb-4 art-card";

        const timestamp = artData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        artElement.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width: 40px; height: 40px; object-fit: cover; cursor: pointer;"
                     data-user-id="${artData.userId}">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor: pointer;" data-user-id="${artData.userId}">
                        ${userData.user_Name || "Unknown Artist"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <h5 class="card-title">${artData.name}</h5>
                <div class="art-price-section mb-3">
                    <strong class="text-primary">R$ ${artData.totalPrice?.toFixed(2) || '0.00'}</strong>
                    <small class="text-muted">(Art: R$ ${artData.price?.toFixed(2) || '0.00'} + Platform: R$ ${artData.platformFee?.toFixed(2) || '0.00'})</small>
                </div>
                <div class="art-image-container" style="width: 50%; max-height: 500px; overflow: hidden; display: flex; justify-content: center; align-items: center; background-color: #f8f9fa;">
                    <img src="${artData.downloadURL}" 
                         class="img-fluid rounded art-image lazy-load" 
                         alt="${artData.name}"
                         style="max-width: 50%; max-height: 500px; width: auto; height: auto; object-fit: contain; cursor: pointer;"
                         loading="lazy"
                         data-art-id="${artId}">
                </div>
                ${artData.description ? `<p class="card-text mt-3">${artData.description}</p>` : ''}
            </div>
            <div class="card-footer">
                <!-- Like Button -->
                <button class="btn btn-outline-primary like-button" data-art-id="${artId}">
                    <span class="like-count">${artData.likes_count || 0}</span> Likes
                </button>

                <!-- Buy Button - ALWAYS SHOWN TO AUTHENTICATED USERS -->
                <button class="btn btn-success buy-button" data-art-id="${artId}" data-price="${artData.totalPrice}">
                    Buy Art - R$ ${artData.totalPrice?.toFixed(2) || '0.00'}
                </button>

                <!-- Comments Button -->
                <button class="btn btn-outline-secondary comments-toggle-button" data-art-id="${artId}">
                    Show Comments
                </button>

                <!-- Comments Container (Hidden by Default) -->
                <div class="comments-container mt-3" id="comments-${artId}" style="display: none;"></div>

                <!-- Comment Input Section (Hidden by Default) -->
                <div class="comment-input-container mt-2" id="commentInputContainer-${artId}" style="display: none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${artId}">
                        <button class="btn btn-outline-primary comment-submit" data-art-id="${artId}">Post</button>
                    </div>
                </div>

                <!-- Delete Art Button (only shown to art owner) -->
                ${isCurrentUserArt ? `<button class="btn btn-danger mt-2 delete-art-button" data-art-id="${artId}">Delete Art</button>` : ''}
            </div>
        `;

        // Add event listeners
        this.setupArtEventListeners(artElement, artId, artData, currentUserId, isCurrentUserArt);

        return artElement;
    }

    setupArtEventListeners(artElement, artId, artData, currentUserId, isCurrentUserArt) {
        const profileLinks = artElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        // Like button
        const likeButton = artElement.querySelector('.like-button');
        likeButton.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likeArt(artId, user.firestoreUserId);
                const likesCount = await this.getLikesCount(artId);
                likeButton.querySelector('.like-count').textContent = likesCount;
            } else {
                alert("You must be logged in to like art.");
            }
        });

        // Buy button - UPDATED: Allow any authenticated user to buy
        const buyButton = artElement.querySelector('.buy-button');
        buyButton.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                this.handleBuyArt(artId, artData);
            } else {
                alert("You must be logged in to purchase art.");
            }
        });

        // Image click (view larger)
        const artImage = artElement.querySelector('.art-image');
        artImage.addEventListener('click', () => {
            this.showArtModal(artData);
        });

        // Comments toggle
        const commentsContainer = artElement.querySelector('.comments-container');
        const commentInputContainer = artElement.querySelector('.comment-input-container');
        const commentsToggleButton = artElement.querySelector('.comments-toggle-button');

        commentsToggleButton.addEventListener('click', async () => {
            const isCommentsVisible = commentsContainer.style.display === "block";
            if (!isCommentsVisible) {
                if (commentsContainer.innerHTML === "") {
                    await this.loadComments(artId, commentsContainer, currentUserId);
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

        // Comment submission
        const commentInput = artElement.querySelector('.comment-input');
        const commentSubmitButton = artElement.querySelector('.comment-submit');
        commentSubmitButton.addEventListener('click', () => this.submitComment(artId, commentInput, commentsContainer));
        commentInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submitComment(artId, commentInput, commentsContainer);
            }
        });

        // Delete button (only for art owner)
        if (isCurrentUserArt) {
            const deleteButton = artElement.querySelector('.delete-art-button');
            deleteButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to delete this art and all its comments and likes?")) {
                    this.deleteArt(artId, this.currentFilterUserId);
                }
            });
        }
    }

    async likeArt(artId, userId) {
        if (this.isLiking.has(artId)) return;
        this.isLiking.add(artId);

        const likeButton = document.querySelector(`.like-button[data-art-id="${artId}"]`);
        const likeCountElement = likeButton?.querySelector('.like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        const likeRef = this.db.collection("art_likes").doc(`${artId}_${userId}`);
        const likeDocSnapshot = await likeRef.get();
        const hasLiked = likeDocSnapshot.exists;

        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            const batch = this.db.batch();
            const artRef = this.db.collection("arts").doc(artId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(artRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.likesCache.get(artId)?.delete(userId);
            } else {
                batch.set(likeRef, {
                    userId: userId,
                    artId: artId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                batch.update(artRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });
                if (!this.likesCache.has(artId)) {
                    this.likesCache.set(artId, new Set());
                }
                this.likesCache.get(artId).add(userId);
            }

            await batch.commit();
        } catch (error) {
            console.error("Error updating like:", error);
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }
        } finally {
            this.isLiking.delete(artId);
        }
    }

    async getLikesCount(artId) {
        const artDoc = await this.db.collection("arts").doc(artId).get();
        return artDoc.data().likes_count || 0;
    }
    
    handleBuyArt(artId, artData) {
        const user = this.auth.currentUser;
        if (!user) {
            alert("Please log in to purchase art.");
            return;
        }

        // Enhanced session storage with fallbacks
        const artDataWithId = { id: artId, ...artData };
        
        // Store in multiple locations for redundancy
        try {
            sessionStorage.setItem('selectedArt', JSON.stringify(artDataWithId));
            localStorage.setItem('selectedArt', JSON.stringify(artDataWithId)); // Fallback
        } catch (e) {
            console.error('Storage error:', e);
        }

        // Also store in recent arts cache
        const recentArts = JSON.parse(localStorage.getItem('recentArts') || '[]');
        recentArts.unshift(artDataWithId);
        localStorage.setItem('recentArts', JSON.stringify(recentArts.slice(0, 10)));
        
        // Navigate with artId in URL for reliability
        window.location.href = `select-product-client.html?artId=${artId}`;
    }

    showArtModal(artData) {
        // Create modal for larger art view
        const modalHtml = `
            <div class="modal fade" id="artModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${artData.name}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body text-center">
                            <img src="${artData.downloadURL}" class="img-fluid" alt="${artData.name}" style="max-height: 80vh;">
                            ${artData.description ? `<p class="mt-3">${artData.description}</p>` : ''}
                            <p class="text-primary fw-bold">R$ ${artData.totalPrice?.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM and show it
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = new bootstrap.Modal(document.getElementById('artModal'));
        modal.show();

        // Clean up modal after hide
        document.getElementById('artModal').addEventListener('hidden.bs.modal', function () {
            this.remove();
        });
    }

    // Submit comment for art
    async submitComment(artId, commentInput, commentsContainer) {
        if (this.isSubmitting) return;
        this.isSubmitting = true;

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
            console.error("Submit button not found.");
            this.isSubmitting = false;
            return;
        }

        commentInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Posting...";

        try {
            const commentRef = await this.db.collection("art_comments").add({
                userId: user.firestoreUserId,
                artId: artId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0
            });

            // Send notification to art owner
            const artDoc = await this.db.collection("arts").doc(artId).get();
            const artOwner = artDoc.data().userId;
            if (artOwner !== user.firestoreUserId) {
                const commenterUsername = this.usersCache[user.firestoreUserId]?.user_Name || await this.ensureUsernameInCache(user.firestoreUserId);
                await this.db.collection("notifications").add({
                    toUserId: artOwner,
                    fromUserId: user.firestoreUserId,
                    fromUsername: commenterUsername,
                    type: "art_comment",
                    message: `${commenterUsername} commented on your art: "${commentText}"`,
                    artId: artId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    read: false,
                    fromUserProfilePic: this.usersCache[user.firestoreUserId]?.profilePicture || null
                });
            }

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

    // Load comments for art
    async loadComments(artId, commentsContainer, currentUserId) {
        if (!commentsContainer) return;

        commentsContainer.style.maxHeight = "300px";
        commentsContainer.style.overflowY = "auto";

        if (this.commentListeners[artId]) {
            this.commentListeners[artId]();
            delete this.commentListeners[artId];
        }

        const unsubscribe = this.db.collection("art_comments")
            .where("artId", "==", artId)
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
                    const commentElement = this.createCommentElement(commentData, userData, currentUserId, artId, commentsContainer);
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
                            const commentElement = this.createCommentElement(commentData, userData, currentUserId, artId, commentsContainer);
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

        this.commentListeners[artId] = unsubscribe;
    }

    // Create comment element for art
    createCommentElement(commentData, userData, currentUserId, artId, commentsContainer) {
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
            <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : 'default-profile.png'}" 
                 class="rounded-circle me-2 user-profile-link"
                 style="width: 40px; height: 40px; cursor: pointer;"
                 data-user-id="${commentData.userId}"
                 alt="Profile Picture">
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

        // Three-dots menu for comment options
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
                this.deleteComment(commentData.id, artId, commentsContainer, currentUserId);
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

        // Like button event
        const likeButton = commentElement.querySelector('.comment-like-button');
        likeButton.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likeComment(commentData.id, user.firestoreUserId);
            } else {
                alert("You must be logged in to like a comment.");
            }
        });

        // Profile links
        const profileLinks = commentElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });

        return commentElement;
    }

    // Delete art and associated content
    async deleteArt(artId, filterUserId) {
        if (!confirm("Are you sure you want to delete this art and all its comments and likes?")) {
            return;
        }

        try {
            const artRef = this.db.collection("arts").doc(artId);
            const artDoc = await artRef.get();

            if (!artDoc.exists) {
                throw new Error("Art doesn't exist");
            }

            const currentUser = await this.getCurrentUser();
            const artOwnerUserId = artDoc.data().userId;

            if (!currentUser || currentUser.firestoreUserId !== artOwnerUserId) {
                throw new Error("You can only delete your own art");
            }

            const batch1 = this.db.batch();
            batch1.delete(artRef);

            // Delete art likes
            const artLikesSnapshot = await this.db.collection("art_likes")
                .where("artId", "==", artId)
                .get();
            artLikesSnapshot.forEach(doc => {
                batch1.delete(doc.ref);
            });

            // Delete art comments
            const commentsSnapshot = await this.db.collection("art_comments")
                .where("artId", "==", artId)
                .get();
            const commentIds = commentsSnapshot.docs.map(doc => doc.id);
            commentsSnapshot.forEach(doc => {
                batch1.delete(doc.ref);
            });

            await batch1.commit();

            // Delete comment likes in second batch
            if (commentIds.length > 0) {
                const batch2 = this.db.batch();
                for (const commentId of commentIds) {
                    const commentLikesSnapshot = await this.db.collection("art_comment_likes")
                        .where("commentId", "==", commentId)
                        .get();
                    commentLikesSnapshot.forEach(doc => {
                        batch2.delete(doc.ref);
                    });
                }
                await batch2.commit();
            }

            alert("Art and all associated content deleted successfully.");
            this.displayArts(filterUserId);

        } catch (error) {
            console.error("Error deleting art:", error);
            alert(`Failed to delete art: ${error.message}`);
        }
    }

    // Delete comment for art
    async deleteComment(commentId, artId, commentsContainer, currentUserId) {
        if (!commentsContainer) return;

        if (!confirm("Are you sure you want to delete this comment and all its likes?")) {
            return;
        }

        try {
            const batch = this.db.batch();
            const commentRef = this.db.collection("art_comments").doc(commentId);
            batch.delete(commentRef);

            const likesQuery = this.db.collection("art_comment_likes")
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

    // Like comment for art
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
            const likeRef = this.db.collection("art_comment_likes").doc(`${commentId}_${userId}`);
            const commentRef = this.db.collection("art_comments").doc(commentId);

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

    // Helper function to check if user liked a comment
    hasUserLikedComment(commentId, userId) {
        return this.commentLikesCache.get(commentId)?.has(userId) || false;
    }

    // Helper function to ensure username is in cache
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