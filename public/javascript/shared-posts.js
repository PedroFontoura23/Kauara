console.log("shared-posts.js loaded!");

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
const POST_CONFIG = {
    collection:             "posts",
    likesCollection:        "likes",
    userIdField:            "foreignUserId",
    commentsCollection:     "comments",
    commentLikesCollection: "comment_likes",
    contentIdField:         "foreignPostId",
    contentCollection:      "posts",
    notificationType:       "post_comment",
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

    async displayPosts(filterUserId = null, currentUserId = null) {
        if (!this.container) { console.error("Posts container not found"); return; }
        if (this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) currentUserId = user.firestoreUserId;
        }

        this.currentFilterUserId = filterUserId;
        this.container.innerHTML = "<p>Loading posts...</p>";

        try {
            let query = this.db.collection("posts").orderBy("timestamp", "desc");
            if (this.currentFilterUserId) query = query.where("foreignUserId", "==", this.currentFilterUserId);

            const snapshot = await query.get();
            if (snapshot.empty) {
                this.container.innerHTML = "<p>No posts available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().foreignUserId);
            await this.cacheUsers([...new Set(userIds)]);

            // Pre-warm likes cache for all items at once
            const postIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                postIds, POST_CONFIG.likesCollection, "foreignPostId", "foreignUserId", currentUserId
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
                const postData = doc.data();
                const userData = this.usersCache[postData.foreignUserId] || {};
                const postEl   = this.createPostElement(doc.id, postData, userData, currentUserId);
                this.container.appendChild(postEl);
            });
        } catch (error) {
            console.error("[PostManager] displayPosts error:", error);
            this.container.innerHTML = "<p>Error loading posts.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Create post element ──────────────────────────────────────────────────

    createPostElement(postId, postData, userData, currentUserId) {
        const isOwner   = postData.foreignUserId === currentUserId;
        const postEl    = document.createElement("div");
        postEl.className = "card post-card";
        postEl.style.cssText = `
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            min-width: 0;
        `;

        const timestamp     = postData.timestamp?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        postEl.innerHTML = `
            ${postData.postImage ? `
                <div style="width:100%;aspect-ratio:1;overflow:hidden;background:#f0f0f0;">
                    <img src="data:image/jpeg;base64,${postData.postImage}"
                         class="lazy-load"
                         alt="Post Image"
                         style="width:100%;height:100%;object-fit:cover;"
                         loading="lazy">
                </div>
            ` : ''}
            <div class="p-2" style="flex:1;min-width:0;">
                <div class="d-flex align-items-center gap-1 mb-1">
                    <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                         class="rounded-circle user-profile-link flex-shrink-0"
                         style="width:20px;height:20px;object-fit:cover;cursor:pointer;"
                         data-user-id="${postData.foreignUserId}">
                    <small class="text-muted text-truncate user-profile-link" style="font-size:0.72rem;cursor:pointer;" data-user-id="${postData.foreignUserId}">
                        ${userData.user_Name || "Unknown User"}
                    </small>
                </div>
                <p class="mb-0" style="font-size:0.8rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${postData.postText}</p>
                <small class="text-muted" style="font-size:0.68rem;">${formattedDate}</small>
            </div>
            <div class="px-2 pb-2 d-flex gap-1">
                <button class="btn btn-outline-primary btn-sm like-button px-2 py-1" data-post-id="${postId}" style="font-size:0.72rem;">
                    ♥ <span class="like-count">${postData.likes_count || 0}</span>
                </button>
                <button class="btn btn-outline-secondary btn-sm comments-toggle-button px-2 py-1" data-post-id="${postId}" style="font-size:0.72rem;">
                    💬
                </button>
                ${isOwner ? `<button class="btn btn-outline-danger btn-sm delete-post-button px-2 py-1 ms-auto" data-post-id="${postId}" style="font-size:0.72rem;">✕</button>` : ''}
            </div>
            <div class="px-2 pb-2">
                <div class="comments-container" id="comments-${postId}" style="display:none;"></div>
                <div class="comment-input-container" id="commentInputContainer-${postId}" style="display:none;"></div>
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
                    this.commentsManager.renderCommentInput(
                        commentInputContainer, postId, commentsContainer, POST_CONFIG, () => this.getCurrentUser()
                    );
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
            type:        "post_like",
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

window.PostManager = PostManager;

// ─── Page-level initialization helper ────────────────────────────────────────
async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) { console.error("Posts container not found."); return; }
    const postManager = new PostManager(db, auth, 'postsContainer', userIdFromUrl);
    postManager.displayPosts(userIdFromUrl);
}