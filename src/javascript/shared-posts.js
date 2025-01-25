class PostManager {
    constructor(db, auth, containerId) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {}; // Cache for user data
        this.postsCache = {}; // Cache for posts
        this.commentListeners = {}; // Store real-time comment listeners
        this.likesCache = new Map(); // Cache for post likes (postId -> Set of userIds)
        this.commentLikesCache = new Map(); // Cache for comment likes (commentId -> Set of userIds)
        this.isLiking = new Set(); // Track posts being liked/unliked to debounce clicks
        this.isCommentLiking = new Set(); // Track comments being liked/unliked to debounce clicks
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
    async displayPosts(filterUserId = null, currentUserId = null, limit = 10) {
        if (!this.container) {
            console.error("Posts container not found");
            return;
        }

        this.container.innerHTML = "<p>Loading posts...</p>";

        try {
            // Fetch posts
            let query = this.db.collection("posts")
                .orderBy("timestamp", "desc")
                .limit(limit);

            if (filterUserId) {
                query = query.where("foreignUserId", "==", filterUserId);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                this.container.innerHTML = "<p>No posts available.</p>";
                return;
            }

            // Fetch user data for all posts in parallel
            const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
            const uniqueUserIds = [...new Set(userIds)]; // Remove duplicates
            await this.cacheUsers(uniqueUserIds); // Cache user data

            // Render posts
            this.container.innerHTML = ""; // Clear loading message
            for (const doc of snapshot.docs) {
                const postData = doc.data();
                const userData = this.usersCache[postData.foreignUserId] || {};
                const postElement = this.createPostElement(doc.id, postData, userData, currentUserId, filterUserId);
                this.container.appendChild(postElement);

                // Load comments for the post
                const commentsContainer = postElement.querySelector(`#comments-${doc.id}`);
                if (commentsContainer) {
                    this.loadComments(doc.id, commentsContainer, currentUserId);
                }
            }
        } catch (error) {
            console.error("Error fetching posts:", error);
            this.container.innerHTML = "<p>Error loading posts.</p>";
        }
    }

    // Create a post element with proper user ID verification
    createPostElement(postId, postData, userData) {
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
                    await this.loadComments(postId, commentsContainer);
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

        return postElement;
    }

    // Create a comment element with proper user ID verification
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
        // Debounce: Prevent multiple rapid clicks
        if (this.isLiking.has(postId)) return;
        this.isLiking.add(postId);

        // Optimistic UI update
        const likeButton = document.querySelector(`.like-button[data-post-id="${postId}"]`);
        const likeCountElement = likeButton?.querySelector('.like-count');
        const currentLikes = parseInt(likeCountElement?.textContent || 0);

        // Check if the user has already liked the post locally
        const hasLiked = this.likesCache.get(postId)?.has(userId) || false;

        // Update the UI optimistically
        if (likeCountElement) {
            likeCountElement.textContent = hasLiked ? currentLikes - 1 : currentLikes + 1;
        }

        try {
            // Use a batch write for atomic operations
            const batch = this.db.batch();

            const likeRef = this.db.collection("likes").doc(`${postId}_${userId}`);
            const postRef = this.db.collection("posts").doc(postId);

            if (hasLiked) {
                // Unlike: Remove the like and decrement the count
                batch.delete(likeRef);
                batch.update(postRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this.likesCache.get(postId)?.delete(userId); // Update local cache
            } else {
                // Like: Add the like and increment the count
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
                this.likesCache.get(postId).add(userId); // Update local cache
            }

            // Commit the batch
            await batch.commit();
        } catch (error) {
            console.error("Error updating like:", error);

            // Revert the UI if the operation fails
            if (likeCountElement) {
                likeCountElement.textContent = currentLikes;
            }

            alert("Failed to update like. Please try again.");
        } finally {
            // Re-enable the like button
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
            await this.db.collection("comments").add({
                foreignUserId: user.firestoreUserId,
                foreignPostId: postId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                likes_count: 0 // Ensure likes_count is always set
            });

            console.log("Comment submitted successfully.");

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
        if (!confirm("Are you sure you want to delete this post and all its comments and likes?")) {
            return;
        }

        try {
            // Create a Firestore batch for atomic operations
            const batch = this.db.batch();

            // 1. Delete the post
            const postRef = this.db.collection("posts").doc(postId);
            batch.delete(postRef);

            // 2. Delete all comments associated with the post
            const commentsSnapshot = await this.db.collection("comments")
                .where("foreignPostId", "==", postId)
                .get();

            commentsSnapshot.forEach(doc => {
                const commentRef = this.db.collection("comments").doc(doc.id);
                batch.delete(commentRef);

                // 3. Delete all likes associated with each comment
                const commentLikesQuery = this.db.collection("comment_likes")
                    .where("foreignCommentId", "==", doc.id);
                commentLikesQuery.get().then(likesSnapshot => {
                    likesSnapshot.forEach(likeDoc => {
                        const likeRef = this.db.collection("comment_likes").doc(likeDoc.id);
                        batch.delete(likeRef);
                    });
                });
            });

            // 4. Delete all likes associated with the post
            const postLikesQuery = this.db.collection("likes")
                .where("foreignPostId", "==", postId);
            const postLikesSnapshot = await postLikesQuery.get();
            postLikesSnapshot.forEach(doc => {
                const likeRef = this.db.collection("likes").doc(doc.id);
                batch.delete(likeRef);
            });

            // Commit the batch
            await batch.commit();

            // Refresh the posts after deletion
            this.displayPosts(filterUserId);

            alert("Post, comments, and associated likes deleted successfully.");
        } catch (error) {
            console.error("Error deleting post:", error);
            alert("Failed to delete post. Please try again.");
        }
    }
}

// Initialization function
function initializePostManager(containerId) {
    const db = firebase.firestore();
    const auth = firebase.auth();
    const postManager = new PostManager(db, auth, containerId);

    // Add the beforeunload event listener
    window.addEventListener('beforeunload', () => {
        postManager.cleanupCommentListeners();
    });

    return postManager;
}