class PostManager {
    constructor(db, auth, containerId) {
        this.db = db;
        this.auth = auth;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.usersCache = {}; // Cache for user data
        this.postsCache = {}; // Cache for posts
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
    createPostElement(postId, postData, userData, currentUserId, filterUserId) {
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
                <!-- Comments Button -->
                <button class="btn btn-outline-secondary comments-toggle-button" data-post-id="${postId}">
                    Show Comments
                </button>

                <!-- Comments Container (Hidden by Default) -->
                <div class="comments-container mt-3" id="comments-${postId}" style="display: none;"></div>

                <!-- Comment Input Section -->
                <div class="input-group mt-2">
                    <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${postId}">
                    <button class="btn btn-outline-primary comment-submit" data-post-id="${postId}">Post</button>
                </div>

                <!-- Delete Post Button (if applicable) -->
                ${postData.foreignUserId === currentUserId ? `
                    <button class="btn btn-danger mt-2 delete-post-button" data-post-id="${postId}">Delete Post</button>
                ` : ''}
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

        const commentInput = postElement.querySelector('.comment-input');
        const commentSubmitButton = postElement.querySelector('.comment-submit');
        const commentsContainer = postElement.querySelector('.comments-container');
        const deletePostButton = postElement.querySelector('.delete-post-button');
        const commentsToggleButton = postElement.querySelector('.comments-toggle-button');

        // Submit comment on button click
        commentSubmitButton.addEventListener('click', () => this.submitComment(postId, commentInput, commentsContainer));

        // Submit comment on "Enter" key press
        commentInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent default behavior (e.g., adding a new line)
                this.submitComment(postId, commentInput, commentsContainer);
            }
        });

        // Toggle comments visibility
        commentsToggleButton.addEventListener('click', async () => {
            const isCommentsVisible = commentsContainer.style.display === "block";
            if (!isCommentsVisible) {
                // Load comments if they haven't been loaded yet
                if (commentsContainer.innerHTML === "") {
                    await this.loadComments(postId, commentsContainer, currentUserId);
                }
                commentsContainer.style.display = "block";
                commentsToggleButton.textContent = "Hide Comments";
            } else {
                commentsContainer.style.display = "none";
                commentsToggleButton.textContent = "Show Comments";
            }
        });

        if (deletePostButton) {
            deletePostButton.addEventListener('click', () => this.deletePost(postId, filterUserId));
        }

        return postElement;
    }

    // Create a comment element with proper user ID verification
    createCommentElement(commentData, userData, currentUserId, postId, commentsContainer) {
        const commentElement = document.createElement("div");
        commentElement.className = "mb-3 d-flex align-items-center";

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
                    ${commentData.timestamp ? commentData.timestamp.toDate().toLocaleString() : "Just now"}
                </small>
            </div>
        `;

        // Append the options container to the comment element
        commentElement.appendChild(optionsContainer);

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

    async deleteComment(commentId, postId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        if (!confirm("Are you sure you want to delete this comment?")) {
            return;
        }

        try {
            // Delete the comment from Firestore
            await this.db.collection("comments").doc(commentId).delete();

            // Refresh the comments section
            await this.loadComments(postId, commentsContainer, currentUserId);

            alert("Comment deleted successfully.");
        } catch (error) {
            console.error("Error deleting comment:", error);
            alert("Failed to delete comment. Please try again.");
        }
    }
    // Submit a comment
    async submitComment(postId, commentInput, commentsContainer) {
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

        // Disable the input and button to prevent multiple submissions
        commentInput.disabled = true;
        const submitButton = commentsContainer.parentElement.querySelector('.comment-submit');
        if (submitButton) {
            submitButton.disabled = true;
        }

        try {
            // Save the comment to Firestore
            const commentRef = await this.db.collection("comments").add({
                foreignUserId: user.firestoreUserId, // Use Firestore user ID
                foreignPostId: postId,
                content: commentText,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Fetch the newly added comment from Firestore
            const commentDoc = await commentRef.get();
            const commentData = commentDoc.data();

            // Fetch the user data for the comment author
            const userQuery = await this.db.collection("users")
                .where("userId", "==", commentData.foreignUserId)
                .get();

            if (userQuery.empty) {
                console.error("User not found for comment:", commentData.foreignUserId);
                return;
            }

            const userData = userQuery.docs[0].data();

            // Create and append the new comment element
            const commentElement = this.createCommentElement(commentData, userData, user.firestoreUserId);
            commentsContainer.appendChild(commentElement);

            // Clear the input field
            commentInput.value = "";
        } catch (error) {
            console.error("Error submitting comment:", error);
            alert("Failed to submit comment. Please try again.");
        } finally {
            // Re-enable the input and button after submission is complete
            commentInput.disabled = false;
            const submitButton = commentsContainer.parentElement.querySelector('.comment-submit');
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    }

    // Load comments for a post
    async loadComments(postId, commentsContainer, currentUserId) {
        if (!commentsContainer) {
            console.error("Comments container is undefined.");
            return;
        }

        commentsContainer.innerHTML = '<p class="text-muted">Loading comments...</p>';

        try {
            // Fetch all comments for the post
            const commentsSnapshot = await this.db.collection("comments")
                .where("foreignPostId", "==", postId)
                .orderBy("timestamp", "asc")
                .get();

            if (commentsSnapshot.empty) {
                commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
                return;
            }

            // Extract user IDs from comments
            const userIds = commentsSnapshot.docs.map(doc => doc.data().foreignUserId);
            const uniqueUserIds = [...new Set(userIds)]; // Remove duplicates

            // Fetch user data for all unique user IDs
            const usersQuery = await this.db.collection("users")
                .where("userId", "in", uniqueUserIds)
                .get();

            // Cache user data
            const usersCache = {};
            usersQuery.forEach(doc => {
                usersCache[doc.data().userId] = doc.data();
            });

            // Clear the loading message
            commentsContainer.innerHTML = "";

            // Render all comments
            commentsSnapshot.docs.forEach(doc => {
                const commentData = { id: doc.id, ...doc.data() };
                const userData = usersCache[commentData.foreignUserId] || {};
                const commentElement = this.createCommentElement(commentData, userData, currentUserId, postId, commentsContainer);
                commentsContainer.appendChild(commentElement);
            });
        } catch (error) {
            console.error("Error loading comments:", error);
            commentsContainer.innerHTML = '<p class="text-danger">Error loading comments.</p>';
        }
    }
    // Delete a post and its associated comments
    async deletePost(postId, filterUserId) {
        if (!confirm("Are you sure you want to delete this post and all its comments?")) {
            return;
        }

        try {
            // Delete all comments associated with the post
            const commentsSnapshot = await this.db.collection("comments")
                .where("foreignPostId", "==", postId)
                .get();

            const deleteCommentPromises = commentsSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(deleteCommentPromises);

            // Delete the post
            await this.db.collection("posts").doc(postId).delete();

            // Refresh the posts after deletion
            this.displayPosts(filterUserId);

            alert("Post and comments deleted successfully.");
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
    return new PostManager(db, auth, containerId);
}