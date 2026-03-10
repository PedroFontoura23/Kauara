console.log("shared-posts.js loaded!");

// ─── Config ───────────────────────────────────────────────────────────────────
const POST_CONFIG = {
    collection:             "posts",
    likesCollection:        "likes",
    userIdField:            "foreignUserId",
    commentsCollection:     "comments",
    commentLikesCollection: "comment_likes",
    contentIdField:         "foreignPostId",
    contentCollection:      "posts",
    notificationType:       "comment",
};

window.initializePostManager = function(containerId) {
    return new PostManager(db, auth, containerId);
};

class PostManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db                  = db;
        this.auth                = auth;
        this.containerId         = containerId;
        this.container           = document.getElementById(containerId);
        this.usersCache          = {};
        this.lastVisiblePost     = null;
        this.batchSize           = 2;
        this.isLoading           = false;
        this.currentFilterUserId = filterUserId;
        this.currentUserId       = null;

        // ── Shared managers ──────────────────────────────────────────────────
        this.likesManager    = new window.SharedLikesManager(db, auth);
        this.commentsManager = new window.SharedCommentsManager(db, auth, this.usersCache, this.likesManager);

        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    this.currentUserId = await this._getUserIdFromUid(user.uid);
                } catch (e) {
                    console.error("[PostManager] Auth error:", e);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
            }
        });
    }

    // ─── Auth helpers ─────────────────────────────────────────────────────────

    async _getUserIdFromUid(uid) {
        const q = await this.db.collection("users").where("firebaseUID", "==", uid).get();
        if (q.empty) throw new Error(`No user found for UID: ${uid}`);
        return q.docs[0].id;
    }

    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        user.firestoreUserId = await this._getUserIdFromUid(user.uid);
                    } catch (e) {
                        console.error("[PostManager] getCurrentUser error:", e);
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

    async ensureUsernameInCache(userId) {
        if (!this.usersCache[userId]) {
            try {
                const q = await this.db.collection("users").where("userId", "==", userId).get();
                if (!q.empty) this.usersCache[userId] = q.docs[0].data();
            } catch (e) { console.warn("[PostManager] ensureUsernameInCache:", e); }
        }
        return this.usersCache[userId]?.user_Name || "Someone";
    }

    // ─── Display posts ────────────────────────────────────────────────────────

    async displayPosts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) { console.error("Posts container not found"); return; }
        if (this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) currentUserId = user.firestoreUserId;
        }

        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML     = "<p>Loading posts...</p>";
            this.lastVisiblePost         = null;
            this.currentFilterUserId     = filterUserId;
        }

        try {
            let query = this.db.collection("posts").orderBy("timestamp", "desc");
            if (this.currentFilterUserId) query = query.where("foreignUserId", "==", this.currentFilterUserId);
            query = query.limit(this.batchSize);
            if (loadMore && this.lastVisiblePost) query = query.startAfter(this.lastVisiblePost);

            const snapshot = await query.get();
            if (snapshot.empty) {
                if (!loadMore) this.container.innerHTML = "<p>No posts available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
            await this.cacheUsers([...new Set(userIds)]);

            if (!loadMore) this.container.innerHTML = "";

            // Pre-warm likes cache for this batch
            const postIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                postIds, POST_CONFIG.likesCollection, "foreignPostId", "foreignUserId", currentUserId
            );

            snapshot.docs.forEach(doc => {
                const postData = doc.data();
                const userData = this.usersCache[postData.foreignUserId] || {};
                const postEl   = this.createPostElement(doc.id, postData, userData, currentUserId);
                this.container.appendChild(postEl);
            });

            this.lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                this._observeLastElement(this.container.lastElementChild, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("[PostManager] displayPosts error:", error);
            if (!loadMore) this.container.innerHTML = "<p>Error loading posts.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    _observeLastElement(el, filterUserId) {
        let debounced = false;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !this.isLoading && !debounced) {
                    debounced = true;
                    observer.disconnect();
                    setTimeout(() => { debounced = false; }, 1000);
                    this.displayPosts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });
        observer.observe(el);
    }

    // ─── Create post element ──────────────────────────────────────────────────

    createPostElement(postId, postData, userData, currentUserId) {
        const isOwner   = postData.foreignUserId === currentUserId;
        const postEl    = document.createElement("div");
        postEl.className = "card mb-4";

        const timestamp     = postData.timestamp?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        postEl.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width:40px;height:40px;object-fit:cover;cursor:pointer;"
                     data-user-id="${postData.foreignUserId}">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor:pointer;" data-user-id="${postData.foreignUserId}">
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
                         style="max-height:500px;width:auto;"
                         loading="lazy">
                ` : ''}
            </div>
            <div class="card-footer">
                <button class="btn btn-outline-primary like-button" data-post-id="${postId}">
                    <span class="like-count">${postData.likes_count || 0}</span> Likes
                </button>
                <button class="btn btn-outline-secondary comments-toggle-button" data-post-id="${postId}">
                    Show Comments
                </button>
                <div class="comments-container mt-3" id="comments-${postId}" style="display:none;"></div>
                <div class="comment-input-container mt-2" id="commentInputContainer-${postId}" style="display:none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input"
                               placeholder="Write a comment..." id="commentInput-${postId}">
                        <button class="btn btn-outline-primary comment-submit" data-post-id="${postId}">Post</button>
                    </div>
                </div>
                ${isOwner ? `<button class="btn btn-danger mt-2 delete-post-button" data-post-id="${postId}">Delete Post</button>` : ''}
            </div>
        `;

        this._setupPostEventListeners(postEl, postId, postData, currentUserId, isOwner);
        return postEl;
    }

    _setupPostEventListeners(postEl, postId, postData, currentUserId, isOwner) {
        // Profile links
        postEl.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', () => {
                window.location.href = `public-profile.html?userId=${encodeURIComponent(link.dataset.userId)}`;
            });
        });

        // Like button — delegate to SharedLikesManager
        const likeBtn = postEl.querySelector('.like-button');
        likeBtn.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            const notifyConfig = user ? await this._buildLikeNotifyConfig(postId, postData, user.firestoreUserId) : null;
            await this.likesManager.toggleLike(
                postId,
                { ...POST_CONFIG, notifyConfig },
                likeBtn,
                () => this.getCurrentUser()
            );
        });

        // Comments toggle
        const commentsContainer     = postEl.querySelector('.comments-container');
        const commentInputContainer = postEl.querySelector('.comment-input-container');
        const toggleBtn             = postEl.querySelector('.comments-toggle-button');
        let   commentsLoaded        = false;

        toggleBtn.addEventListener('click', () => {
            const visible = commentsContainer.style.display === "block";
            if (!visible) {
                if (!commentsLoaded) {
                    this.commentsManager.loadComments(postId, commentsContainer, currentUserId, POST_CONFIG);
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
        const commentInput = postEl.querySelector('.comment-input');
        const submitBtn    = postEl.querySelector('.comment-submit');
        const doSubmit     = () => this.commentsManager.submitComment(
            postId, commentInput, commentsContainer, POST_CONFIG, () => this.getCurrentUser()
        );
        submitBtn.addEventListener('click', doSubmit);
        commentInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });

        // Delete post (owner only)
        if (isOwner) {
            postEl.querySelector('.delete-post-button').addEventListener('click', () => {
                if (confirm("Are you sure you want to delete this post and all its comments and likes?")) {
                    this._deletePost(postId, this.currentFilterUserId);
                }
            });
        }
    }

    // ─── Like notification helper ─────────────────────────────────────────────

    async _buildLikeNotifyConfig(postId, postData, fromUserId) {
        if (postData.foreignUserId === fromUserId) return null;
        const fromUsername = await this.ensureUsernameInCache(fromUserId);
        return {
            toUserId:    postData.foreignUserId,
            fromUsername,
            type:        "like",
            message:     `${fromUsername} liked your post`,
            profilePic:  this.usersCache[fromUserId]?.profilePicture || null
        };
    }

    // ─── Delete post ──────────────────────────────────────────────────────────

    async _deletePost(postId, filterUserId) {
        try {
            const postRef = this.db.collection("posts").doc(postId);
            const postDoc = await postRef.get();
            if (!postDoc.exists) throw new Error("Post doesn't exist");

            const currentUser = await this.getCurrentUser();
            if (!currentUser || currentUser.firestoreUserId !== postDoc.data().foreignUserId) {
                throw new Error("You can only delete your own posts");
            }

            const batch1 = this.db.batch();
            batch1.delete(postRef);

            const [likesSnap, commentsSnap] = await Promise.all([
                this.db.collection("likes").where("foreignPostId", "==", postId).get(),
                this.db.collection("comments").where("foreignPostId", "==", postId).get()
            ]);

            likesSnap.forEach(doc => batch1.delete(doc.ref));
            const commentIds = commentsSnap.docs.map(doc => doc.id);
            commentsSnap.forEach(doc => batch1.delete(doc.ref));
            await batch1.commit();

            // Delete comment likes in a second batch
            if (commentIds.length > 0) {
                const batch2 = this.db.batch();
                for (const commentId of commentIds) {
                    const clSnap = await this.db.collection("comment_likes")
                        .where("foreignCommentId", "==", commentId).get();
                    clSnap.forEach(doc => batch2.delete(doc.ref));
                }
                await batch2.commit();
            }

            alert("Post and all associated content deleted successfully.");
            this.displayPosts(filterUserId);
        } catch (error) {
            console.error("[PostManager] _deletePost error:", error);
            alert(`Failed to delete post: ${error.message}`);
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    /** Call when unmounting to prevent memory leaks. */
    destroy() {
        this.commentsManager.cleanupAllListeners();
    }
}

// ─── Page-level initialization helper ────────────────────────────────────────
async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) { console.error("Posts container not found."); return; }
    const postManager = new PostManager(db, auth, 'postsContainer', userIdFromUrl);
    postManager.displayPosts(userIdFromUrl);
}