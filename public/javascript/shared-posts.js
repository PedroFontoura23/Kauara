console.log("shared-posts.js loaded!");
window.initializePostManager = function(containerId) {
    return new PostManager(db, auth, containerId);
};

class PostManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {};
        this.postsCache = {};
        this.commentListeners = {};
        this.likesCache = new Map();
        this.commentLikesCache = new Map();
        this.isLiking = new Set();
        this.isCommentLiking = new Set();
        this.lastVisiblePost = null; // Track the last visible post
        this.batchSize = 2; // Number of posts to load per batch
        this.isLoading = false; // Prevent multiple simultaneous loads
        this.currentFilterUserId = filterUserId; // Store the filterUserId
        this.currentUserId = null; // Track the current user's Firestore ID

        // Listen for authentication state changes
        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                // Fetch the Firestore user ID for the logged-in user
                try {
                    this.currentUserId = await this.getUserIdFromUid(user.uid);
                    console.log("Current user ID set:", this.currentUserId);
                } catch (error) {
                    console.error("Error fetching current user ID:", error);
                    this.currentUserId = null;
                }
            } else {
                // No user is logged in
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
            return userQuery.docs[0].id; // Return the Firestore user ID (e.g., "user_1")
        } else {
            throw new Error(`No user found for UID: ${uid}`);
        }
    }

    cleanupCommentListeners() {
    for (const postId in this.commentListeners) {
        if (this.commentListeners[postId]) {
            this.commentListeners[postId](); // Unsubscribe the listener
        }
    }
    this.commentListeners = {}; // Reset the object

}

    async cacheUsers(userIds) {
        if (userIds.length === 0) return;

        // Fetch user data for the given user IDs
        const usersQuery = await this.db.collection("users")
            .where("userId", "in", userIds)
            .get();

        // Cache the user data
        usersQuery.forEach(doc => {
            const userData = doc.data();
            this.usersCache[userData.userId] = userData;
        });
    }



    // Helper function to get the Firestore user ID from Firebase UID
    async getUserIdFromUid(uid) {
        const userQuery = await this.db.collection("users")
            .where("firebaseUID", "==", uid)
            .get();

        if (!userQuery.empty) {
            return userQuery.docs[0].id; // Return the Firestore user ID (e.g., "user_1")
        } else {
            throw new Error(`No user found for UID: ${uid}`);
        }
    }

    // Get the current logged-in user's Firestore user ID
    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        const firestoreUserId = await this.getUserIdFromUid(user.uid);
                        user.firestoreUserId = firestoreUserId; // Attach Firestore user ID to the user object
                    } catch (error) {
                        console.error("Error getting Firestore user ID:", error);
                    }
                }
                resolve(user);
            });
        });
    }

    // Display posts with proper user ID verification
    async displayPosts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) {
            console.error("Posts container not found");
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
            this.container.innerHTML = "<p>Loading posts...</p>";
            this.lastVisiblePost = null;
            this.currentFilterUserId = filterUserId;
        }

        try {
            if (filterUserId) {
                console.log(`Fetching posts for user: ${filterUserId}`);
            } else {
                console.log("Fetching posts for no specific user (all posts)");
            }

            // Start with base query
            let query = this.db.collection("posts")
                .orderBy("timestamp", "desc");

            // If filterUserId is provided, add the where clause
            if (this.currentFilterUserId) {
                query = query.where("foreignUserId", "==", this.currentFilterUserId);
            }

            // Add limit
            query = query.limit(this.batchSize);

            // Add startAfter if loading more
            if (loadMore && this.lastVisiblePost) {
                query = query.startAfter(this.lastVisiblePost);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                if (!loadMore) {
                    this.container.innerHTML = "<p>No posts available.</p>";
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
                const postData = doc.data();
                const userData = this.usersCache[postData.foreignUserId] || {};
                const postElement = this.createPostElement(doc.id, postData, userData, currentUserId, filterUserId);
                this.container.appendChild(postElement);
        
                const commentsContainer = postElement.querySelector(`#comments-${doc.id}`);
                if (commentsContainer) {
                    // Pass currentUserId to loadComments
                    this.loadComments(doc.id, commentsContainer, currentUserId);
                }
            });

            this.lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                const lastPostElement = this.container.lastElementChild;
                this.observeLastPost(lastPostElement, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("Error fetching posts:", error);
            if (!loadMore) {
                this.container.innerHTML = "<p>Error loading posts.</p>";
            }
        } finally {
            this.isLoading = false;
        }
    }

    observeLastPost(lastPostElement, filterUserId) {
        let isDebounced = false; // Debounce flag

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading && !isDebounced) {
                    isDebounced = true; // Activate debounce
                    observer.disconnect(); // Disconnect the observer immediately

                    setTimeout(() => {
                        isDebounced = false; // Reset debounce after a delay
                    }, 1000); // 1-second debounce

                    this.displayPosts(filterUserId, null, true); // Pass filterUserId here
                }
            });
        }, { threshold: 1.0 });

        observer.observe(lastPostElement);
    }

    // Create a post element with proper user ID verification
    createPostElement(postId, postData, userData, currentUserId) {
        const isCurrentUserPost = postData.foreignUserId === currentUserId; // Check if the post belongs to the current user
        const postElement = document.createElement("div");
        postElement.className = "card mb-4";
    
        const timestamp = postData.timestamp?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    
        postElement.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width: 40px; height: 40px; object-fit: cover; cursor: pointer;"
                     data-user-id="${postData.foreignUserId}">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor: pointer;" data-user-id="${postData.foreignUserId}">
                        ${userData.user_Name || "Unknown User"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <p class="card-text">${postData.postText}</p>
                ${postData.postImage ? `
                    <img src="data:image/jpeg;base64,${postData.postImage}" 
                         class="img-fluid rounded lazy-load" 
                         alt="Post Image"
                         style="max-height: 500px; width: auto;"
                         loading="lazy">
                ` : ''}
            </div>
            <div class="card-footer">
                <!-- Like Button -->
                <button class="btn btn-outline-primary like-button" data-post-id="${postId}">
                    <span class="like-count">${postData.likes_count || 0}</span> Likes
                </button>
    
                <!-- Comments Button -->
                <button class="btn btn-outline-secondary comments-toggle-button" data-post-id="${postId}">
                    Show Comments
                </button>
    
                <!-- Comments Container (Hidden by Default) -->
                <div class="comments-container mt-3" id="comments-${postId}" style="display: none;"></div>
    
                <!-- Comment Input Section (Hidden by Default) -->
                <div class="comment-input-container mt-2" id="commentInputContainer-${postId}" style="display: none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${postId}">
                        <button class="btn btn-outline-primary comment-submit" data-post-id="${postId}">Post</button>
                    </div>
                </div>
    
                <!-- Delete Post Button (if applicable) -->
                ${isCurrentUserPost ? `<button class="btn btn-danger mt-2 delete-post-button" data-post-id="${postId}">Delete Post</button>` : ''}
            </div>
        `;
    
        // Add event listeners for profile links, comment submission, and post deletion
        const profileLinks = postElement.querySelectorAll('.user-profile-link');
        profileLinks.forEach(link => {
            link.addEventListener('click', () => {
                const userId = link.getAttribute('data-user-id');
                window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
            });
        });
    
        const likeButton = postElement.querySelector('.like-button');
        likeButton.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) {
                await this.likePost(postId, user.firestoreUserId);
                const likesCount = await this.getLikesCount(postId);
                likeButton.querySelector('.like-count').textContent = likesCount;
            } else {
                alert("You must be logged in to like a post.");
            }
        });
    
        const commentsContainer = postElement.querySelector('.comments-container');
        const commentInputContainer = postElement.querySelector('.comment-input-container');
        const commentsToggleButton = postElement.querySelector('.comments-toggle-button');
    
        // Toggle comments and comment input visibility
        commentsToggleButton.addEventListener('click', async () => {
            const isCommentsVisible = commentsContainer.style.display === "block";
            if (!isCommentsVisible) {
                // Load comments if they haven't been loaded yet
                if (commentsContainer.innerHTML === "") {
                    await this.loadComments(postId, commentsContainer, currentUserId); // Pass currentUserId here
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
        const commentInput = postElement.querySelector('.comment-input');
        const commentSubmitButton = postElement.querySelector('.comment-submit');
        commentSubmitButton.addEventListener('click', () => this.submitComment(postId, commentInput, commentsContainer));
    
        // Handle "Enter" key for comment submission
        commentInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent default behavior (e.g., adding a new line)
                this.submitComment(postId, commentInput, commentsContainer);
            }
        });
    
        // Add event listener for the delete post button (if applicable)
        if (isCurrentUserPost) {
            const deletePostButton = postElement.querySelector('.delete-post-button');
            deletePostButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to delete this post and all its comments and likes?")) {
                    this.deletePost(postId, this.currentFilterUserId); // Call the deletePost method
                }
            });
        }
    
        return postElement;
    }

    createCommentElement(commentData, userData, currentUserId, postId, commentsContainer) {
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
                this.deleteComment(commentData.id, postId, commentsContainer, currentUserId);
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
    async likePost(postId, userId) {
        if (this.isLiking.has(postId)) {
            console.log("Like operation already in progress for post:", postId);
            return;
        }
        this.isLiking.add(postId);

        const likeButton = document.querySelector(`.like-button[data-post-id="${postId}"]`);
        const likeCountElement = likeButton?.querySelector('.like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        const likeRef = this.db.collection("likes").doc(`${postId}_${userId}`);
        const likeDocSnapshot = await likeRef.get();
        const hasLiked = likeDocSnapshot.exists;

        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            const batch = this.db.batch();
            const postRef = this.db.collection("posts").doc(postId);

            if (hasLiked) {
                console.log("Unliking post:", postId, "by user:", userId);
                batch.delete(likeRef);
                batch.update(postRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.likesCache.get(postId)?.delete(userId);
            } else {
                console.log("Liking post:", postId, "by user:", userId);
                batch.set(likeRef, {
                    foreignUserId: userId,
                    foreignPostId: postId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                batch.update(postRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });
                if (!this.likesCache.has(postId)) {
                    this.likesCache.set(postId, new Set());
                }
                this.likesCache.get(postId).add(userId);

                // 🔥 Add a notification for the post owner (NEW)
                const postDoc = await postRef.get();
                if (postDoc.exists) {
                    const postOwner = postDoc.data().foreignUserId;
                    if (postOwner !== userId) { // Prevent self-notifications
                    const likerUsername = this.usersCache[userId]?.user_Name || await this.ensureUsernameInCache(userId);
                    const profilePic = this.usersCache[userId]?.profilePicture? `data:image/jpeg;base64,${this.usersCache[userId].profilePicture}`: '../images/default-profile.png';
                        await this.db.collection("notifications").add({
                            toUserId: postOwner,
                            fromUserId: userId,                  // Add who triggered the notification
                            fromUsername: likerUsername,         // Add their username
                            type: "like",
                            message: `${likerUsername} liked your post`, // Now includes username
                            postId: postId,
                            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                            read: false,
                            // Optional: Add profile picture if available
                            fromUserProfilePic: this.usersCache[userId]?.profilePicture || null
                        });
                    }
                }
            }

            // Commit the batch
            console.log("Committing batch for post:", postId);
            await batch.commit();
            console.log("Like updated successfully for post:", postId);
        } catch (error) {
            console.error("Error updating like:", error);
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }
            alert("Failed to update like. Please try again.");
        } finally {
            this.isLiking.delete(postId);
        }
    }


    // Load likes for a post and cache them locally
    async loadLikes(postId) {
        const likesSnapshot = await this.db.collection("likes")
            .where("foreignPostId", "==", postId)
            .get();

        const userIds = new Set();
        likesSnapshot.forEach(doc => {
            userIds.add(doc.data().foreignUserId);
        });

        this.likesCache.set(postId, userIds); // Cache the likes
    }

    // Check if the current user has liked a post
    hasUserLikedPost(postId, userId) {
        return this.likesCache.get(postId)?.has(userId) || false;
    }


    async getLikesCount(postId) {
        const postDoc = await this.db.collection("posts").doc(postId).get();
        return postDoc.data().likes_count || 0;
    }

        // Like a comment
    async likeComment(commentId, userId) {
        // Debounce: Prevent multiple rapid clicks
        if (this.isCommentLiking.has(commentId)) return;
        this.isCommentLiking.add(commentId);

        // Optimistic UI update
        const likeButton = document.querySelector(`.comment-like-button[data-comment-id="${commentId}"]`);
        const likeCountElement = likeButton?.querySelector('.comment-like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        // Check if the user has already liked the comment locally
        const hasLiked = this.commentLikesCache.get(commentId)?.has(userId) || false;

        // Update the UI optimistically
        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            // Use a batch write for atomic operations
            const batch = this.db.batch();

            const likeRef = this.db.collection("comment_likes").doc(`${commentId}_${userId}`);
            const commentRef = this.db.collection("comments").doc(commentId);

            if (hasLiked) {
                // Unlike: Remove the like and decrement the count
                batch.delete(likeRef);
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.commentLikesCache.get(commentId)?.delete(userId); // Update local cache
            } else {
                // Like: Add the like and increment the count
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
                this.commentLikesCache.get(commentId).add(userId); // Update local cache
            }

            // Commit the batch
            await batch.commit();
        } catch (error) {
            console.error("Error updating comment like:", error);

            // Revert the UI if the operation fails
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }

            alert("Failed to update comment like. Please try again.");
        } finally {
            // Re-enable the like button
            this.isCommentLiking.delete(commentId);
        }
    }

    // Load likes for a comment and cache them locally
    async loadCommentLikes(commentId) {
        const likesSnapshot = await this.db.collection("comment_likes")
            .where("foreignCommentId", "==", commentId)
            .get();

        const userIds = new Set();
        likesSnapshot.forEach(doc => {
            userIds.add(doc.data().foreignUserId);
        });

        this.commentLikesCache.set(commentId, userIds); // Cache the likes
    }

    // Check if the current user has liked a comment
    hasUserLikedComment(commentId, userId) {
        return this.commentLikesCache.get(commentId)?.has(userId) || false;
    }


    //deletes comments and its associated likes
    async deleteComment(commentId, postId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        if (!confirm("Are you sure you want to delete this comment and all its likes?")) {
            return;
        }

        try {
            // Create a Firestore batch for atomic operations
            const batch = this.db.batch();

            // 1. Delete the comment
            const commentRef = this.db.collection("comments").doc(commentId);
            batch.delete(commentRef);

            // 2. Delete all likes associated with the comment
            const likesQuery = this.db.collection("comment_likes")
                .where("foreignCommentId", "==", commentId);
            const likesSnapshot = await likesQuery.get();
            likesSnapshot.forEach(doc => {
                const likeRef = this.db.collection("comment_likes").doc(doc.id);
                batch.delete(likeRef);
            });

            // Commit the batch
            await batch.commit();

            // Remove the deleted comment from the DOM
            const deletedCommentElement = commentsContainer.querySelector(`[data-comment-id="${commentId}"]`);
            if (deletedCommentElement) {
                deletedCommentElement.remove();
            }

            // Optional: Notify the user that the comment was deleted
            console.log("Comment and associated likes deleted successfully.");
        } catch (error) {
            console.error("Error deleting comment:", error);
            alert("Failed to delete comment. Please try again.");
        }
    }
    // Submit a comment
    async submitComment(postId, commentInput, commentsContainer) {
        console.log("Starting comment submission...");

        // Prevent multiple submissions
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

        // Disable input and button to prevent multiple clicks
        commentInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Posting...";

        try {
            // Save the comment to Firestore with a default likes_count of 0
            const commentRef = await this.db.collection("comments").add({
                foreignUserId: user.firestoreUserId,
                foreignPostId: postId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0 // Ensure likes_count is always set
            });

            console.log("Comment submitted successfully.");

            // 🔥 Add a notification for the post owner (NEW)
            const postDoc = await this.db.collection("posts").doc(postId).get();
            const postOwner = postDoc.data().foreignUserId;
            if (postOwner !== user.firestoreUserId) { // Prevent self-notifications
                // Get the commenter's username from cache or fetch it
                const commenterUsername = this.usersCache[user.firestoreUserId]?.user_Name || await this.ensureUsernameInCache(user.firestoreUserId);
                const profilePic = this.usersCache[user.firestoreUserId]?.profilePicture? `data:image/jpeg;base64,${this.usersCache[user.firestoreUserId].profilePicture}`: '../images/default-profile.png';

                await this.db.collection("notifications").add({
                    toUserId: postOwner,
                    fromUserId: user.firestoreUserId,     // Add commenter's user ID
                    fromUsername: commenterUsername,     // Add their username
                    type: "comment",
                    message: `${commenterUsername} commented: \"${commentText}\"`, // Now includes username
                    postId: postId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    read: false,
                    // Optional: Add profile picture if available
                    fromUserProfilePic: this.usersCache[user.firestoreUserId]?.profilePicture || null // ✅ Use user.firestoreUserId
                });
            }

            // Clear input field after successful submission
            commentInput.value = "";

            // Display a success message
            const successMessage = document.createElement("div");
            successMessage.className = "alert alert-success mt-2";
            successMessage.textContent = "Comment added!";
            commentsContainer.appendChild(successMessage);

            // Remove the success message after 3 seconds
            setTimeout(() => {
                successMessage.remove();
            }, 3000);

            // The new comment will be automatically loaded by Firestore's real-time listener
        } catch (error) {
            console.error("Error submitting comment:", error);
            alert("Failed to submit comment. Please try again.");
        } finally {
            // Re-enable input and button
            commentInput.disabled = false;
            submitButton.disabled = false;
            submitButton.textContent = "Post";

            this.isSubmitting = false;
        }
    }

    // Add this method to the PostManager class
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

    // Helper function to fetch user data
    async fetchUserData(userId) {
        if (this.usersCache[userId]) {
            return this.usersCache[userId];
        }

        const userQuery = await this.db.collection("users")
            .where("userId", "==", userId)
            .get();

        if (!userQuery.empty) {
            const userData = userQuery.docs[0].data();
            this.usersCache[userId] = userData; // Cache the user data
            return userData;
        } else {
            console.error("User not found:", userId);
            return { user_Name: "Unknown User" };
        }
    }

    // Load comments for a post
    async loadComments(postId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        // Modify the container to be scrollable
        commentsContainer.style.maxHeight = "300px"; // Set a fixed max height
        commentsContainer.style.overflowY = "auto"; // Enable vertical scrolling

        // Ensure existing listener is unsubscribed to prevent duplication
        if (this.commentListeners[postId]) {
            this.commentListeners[postId]();  // Unsubscribe the previous listener
            delete this.commentListeners[postId];
        }

        // Track rendered comment IDs and their current order
        const renderedCommentIds = new Set();
        let commentsArray = []; // Array to hold comments for sorting

        // Set up a real-time listener for comments
        const unsubscribe = this.db.collection("comments")
            .where("foreignPostId", "==", postId)
            .orderBy("likes_count", "desc") // Sort by likes_count in descending order
            .orderBy("timestamp", "asc") // Secondary sort by timestamp for comments with the same likes
            .onSnapshot(async (snapshot) => {
                if (snapshot.empty) {
                    commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
                    return;
                }

                // Fetch user data for all unique user IDs
                const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
                const uniqueUserIds = [...new Set(userIds)];
                await this.cacheUsers(uniqueUserIds);

                // Update the comments array with the latest data
                commentsArray = snapshot.docs.map(doc => {
                    const commentData = { id: doc.id, ...doc.data() };
                    if (commentData.likes_count === undefined || commentData.likes_count === null) {
                        commentData.likes_count = 0; // Ensure likes_count is defined
                    }
                    return commentData;
                });

                // Clear the container
                commentsContainer.innerHTML = ""; 

                // Limit to first 8 comments
                const displayComments = commentsArray.slice(0, 8);

                // Rebuild the comments container
                displayComments.forEach(commentData => {
                    const userData = this.usersCache[commentData.foreignUserId] || {};
                    const commentElement = this.createCommentElement(commentData, userData, currentUserId, postId, commentsContainer);
                    commentsContainer.appendChild(commentElement);
                });

                // Add "Load More" button if there are more than 8 comments
                if (commentsArray.length > 8) {
                    const loadMoreButton = document.createElement("button");
                    loadMoreButton.textContent = `Load More Comments (${commentsArray.length - 8} more)`;
                    loadMoreButton.className = "btn btn-outline-secondary w-100 mt-2";
                    
                    // Track the number of comments currently displayed
                    let displayedCommentCount = 8;

                    loadMoreButton.addEventListener('click', () => {
                        // Load next batch of comments
                        const nextComments = commentsArray.slice(displayedCommentCount, displayedCommentCount + 8);
                        
                        nextComments.forEach(commentData => {
                            const userData = this.usersCache[commentData.foreignUserId] || {};
                            const commentElement = this.createCommentElement(commentData, userData, currentUserId, postId, commentsContainer);
                            commentsContainer.appendChild(commentElement);
                        });

                        // Update displayed count
                        displayedCommentCount += 8;

                        // Remove or update "Load More" button if no more comments
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

        // Store the unsubscribe function for cleanup
        this.commentListeners[postId] = unsubscribe;
    }


        // Delete a post and its associated comments and likes
    async deletePost(postId, filterUserId) {
        console.log("[deletePost] Confirming deletion...");
        if (!confirm("Are you sure you want to delete this post and all its comments and likes?")) {
            console.log("[deletePost] Deletion canceled by user.");
            return;
        }

        try {
            console.log(`[deletePost] Fetching post: ${postId}`);
            const postRef = this.db.collection("posts").doc(postId);
            const postDoc = await postRef.get();

            if (!postDoc.exists) {
                console.error("[deletePost] Post does not exist.");
                throw new Error("Post doesn't exist");
            }

            const currentUser = await this.getCurrentUser();
            console.log("[deletePost] Current user:", currentUser);

            const postOwnerUserId = postDoc.data().foreignUserId;
            console.log("[deletePost] Post owner (foreignUserId):", postOwnerUserId);

            if (!currentUser || currentUser.firestoreUserId !== postOwnerUserId) {
                console.error("[deletePost] Unauthorized: user is not the owner of the post.");
                throw new Error("You can only delete your own posts");
            }

            console.log("[deletePost] Starting batch1 (post + post likes + comments)...");
            const batch1 = this.db.batch();

            // Delete post
            console.log("[deletePost] Adding post to batch delete");
            batch1.delete(postRef);

            // Delete likes on the post
            console.log("[deletePost] Fetching post likes...");
            const postLikesSnapshot = await this.db.collection("likes")
                .where("foreignPostId", "==", postId)
                .get();
            console.log(`[deletePost] Found ${postLikesSnapshot.size} post likes.`);

            postLikesSnapshot.forEach(doc => {
                console.log(`[deletePost] Deleting post like: ${doc.id}`);
                batch1.delete(doc.ref);
            });

            // Delete comments
            console.log("[deletePost] Fetching comments...");
            const commentsSnapshot = await this.db.collection("comments")
                .where("foreignPostId", "==", postId)
                .get();
            console.log(`[deletePost] Found ${commentsSnapshot.size} comments.`);

            const commentIds = commentsSnapshot.docs.map(doc => doc.id);
            commentsSnapshot.forEach(doc => {
                console.log(`[deletePost] Deleting comment: ${doc.id}`);
                batch1.delete(doc.ref);
            });

            // Commit first batch
            console.log("[deletePost] Committing batch1...");
            await batch1.commit();
            console.log("[deletePost] Batch1 committed successfully.");

            // Now delete comment likes in a second batch
            if (commentIds.length > 0) {
                console.log("[deletePost] Starting batch2 (comment likes)...");
                const batch2 = this.db.batch();

                for (const commentId of commentIds) {
                    console.log(`[deletePost] Fetching likes for comment: ${commentId}`);
                    const commentLikesSnapshot = await this.db.collection("comment_likes")
                        .where("foreignCommentId", "==", commentId)
                        .get();

                    console.log(`[deletePost] Found ${commentLikesSnapshot.size} likes for comment ${commentId}`);

                    commentLikesSnapshot.forEach(doc => {
                        console.log(`[deletePost] Deleting comment like: ${doc.id}`);
                        batch2.delete(doc.ref);
                    });
                }

                console.log("[deletePost] Committing batch2...");
                await batch2.commit();
                console.log("[deletePost] Batch2 committed successfully.");
            }

            console.log("[deletePost] All deletions completed. Refreshing posts...");
            alert("Post and all associated content deleted successfully.");
            this.displayPosts(filterUserId);

        } catch (error) {
            console.error("[deletePost] Error during deletion:", error);
            alert(`Failed to delete post: ${error.message}`);
        }
    }

    
}

// Initialization function
async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) {
        console.error("Posts container not found.");
        return;
    }

    // Fetch the current user's ID
    const currentUserId = await getCurrentUserId();
    
    // Initialize PostManager
    const postManager = new PostManager(db, auth, 'postsContainer', userIdFromUrl);
    
    // Pass both userIdFromUrl and currentUserId to displayPosts
    postManager.displayPosts(userIdFromUrl, currentUserId);
}