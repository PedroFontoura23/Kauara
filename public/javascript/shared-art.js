console.log("shared-arts.js loaded!");

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
const ART_CONFIG = {
    collection:             "arts",
    likesCollection:        "art_likes",
    userIdField:            "userId",
    commentsCollection:     "art_comments",
    commentLikesCollection: "art_comment_likes",
    contentIdField:         "artId",
    contentCollection:      "arts",
    notificationType:       "art_comment",
};

window.initializeArtManager = function(containerId) {
    return new ArtManager(db, auth, containerId);
};

class ArtManager {
    constructor(db, auth, containerId, filterUserId = null) {
        this.db                  = db;
        this.auth                = auth;
        this.containerId         = containerId;
        this.container           = document.getElementById(containerId);
        this.usersCache          = {};
        this.artsCache           = {};
        this.lastVisibleArt      = null;
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
                    sessionStorage.setItem('currentFirestoreUserId', this.currentUserId);
                } catch (e) {
                    console.error("[ArtManager] Auth error:", e);
                    this.currentUserId = null;
                }
            } else {
                this.currentUserId = null;
                sessionStorage.removeItem('currentFirestoreUserId');
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
                        console.error("[ArtManager] getCurrentUser error:", e);
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
            } catch (e) { console.warn("[ArtManager] ensureUsernameInCache:", e); }
        }
        return this.usersCache[userId]?.user_Name || "Someone";
    }

    // ─── Display arts ─────────────────────────────────────────────────────────

    async displayArts(filterUserId = null, currentUserId = null) {
        if (!this.container) { console.error("Arts container not found"); return; }
        if (this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) currentUserId = user.firestoreUserId;
        }

        this.currentFilterUserId = filterUserId;
        this.container.innerHTML = "<p>Loading arts...</p>";

        try {
            let query = this.db.collection("arts").orderBy("createdAt", "desc");
            if (this.currentFilterUserId) query = query.where("userId", "==", this.currentFilterUserId);

            const snapshot = await query.get();
            if (snapshot.empty) {
                this.container.innerHTML = "<p>No arts available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().userId);
            await this.cacheUsers([...new Set(userIds)]);

            // Pre-warm likes cache for all items at once
            const artIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                artIds, ART_CONFIG.likesCollection, "artId", "userId", currentUserId
            );

            // Build horizontal scroll strip
            this.container.innerHTML = "";
            this._applyHorizontalStripStyles(this.container);

            snapshot.docs.forEach(doc => {
                const artData  = doc.data();
                const userData = this.usersCache[artData.userId] || {};
                const artEl    = this.createArtElement(doc.id, artData, userData, currentUserId);
                this.container.appendChild(artEl);
            });
        } catch (error) {
            console.error("[ArtManager] displayArts error:", error);
            this.container.innerHTML = "<p>Error loading arts.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    _applyHorizontalStripStyles(container) {
        container.style.cssText = `
            display: flex;
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            overflow-y: visible;
            gap: 16px;
            padding: 8px 4px 16px;
            scrollbar-width: thin;
            -webkit-overflow-scrolling: touch;
        `;
    }

    // ─── Create art element ───────────────────────────────────────────────────

    createArtElement(artId, artData, userData, currentUserId) {
        const isOwner  = artData.userId === currentUserId;
        const artEl    = document.createElement("div");
        artEl.className = "card art-card";
        artEl.style.cssText = `
            flex: 0 0 220px;
            width: 220px;
            min-width: 220px;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        `;

        artEl.innerHTML = `
            <div style="position:relative;width:100%;height:220px;background:${artData.bgColor || '#f8f9fa'};overflow:hidden;cursor:pointer;">
                <img src="${artData.downloadURL}"
                     class="art-image lazy-load"
                     alt="${artData.name}"
                     style="width:100%;height:100%;object-fit:contain;"
                     loading="lazy"
                     data-art-id="${artId}">
            </div>
            <div class="card-body p-2" style="flex:1;">
                <p class="mb-0 fw-semibold text-truncate" style="font-size:0.85rem;" title="${artData.name}">${artData.name}</p>
                <p class="mb-0 text-primary fw-bold" style="font-size:0.8rem;">R$ ${artData.totalPrice?.toFixed(2) || '0.00'}</p>
                <div class="d-flex align-items-center gap-1 mt-1">
                    <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                         class="rounded-circle user-profile-link"
                         style="width:20px;height:20px;object-fit:cover;cursor:pointer;flex-shrink:0;"
                         data-user-id="${artData.userId}">
                    <small class="text-muted text-truncate user-profile-link" style="font-size:0.72rem;cursor:pointer;" data-user-id="${artData.userId}">
                        ${userData.user_Name || "Unknown Artist"}
                    </small>
                </div>
            </div>
            <div class="card-footer p-2 d-flex gap-1 flex-wrap">
                <button class="btn btn-outline-primary btn-sm like-button px-2 py-1" data-art-id="${artId}" style="font-size:0.75rem;">
                    ♥ <span class="like-count">${artData.likes_count || 0}</span>
                </button>
                <button class="btn btn-success btn-sm buy-button px-2 py-1" data-art-id="${artId}" data-price="${artData.totalPrice}" style="font-size:0.75rem;">
                    Buy
                </button>
                <button class="btn btn-outline-secondary btn-sm comments-toggle-button px-2 py-1" data-art-id="${artId}" style="font-size:0.75rem;">
                    💬
                </button>
                <div class="comments-container mt-2 w-100" id="comments-${artId}" style="display:none;"></div>
                <div class="comment-input-container mt-1 w-100" id="commentInputContainer-${artId}" style="display:none;"></div>
                ${isOwner ? `<button class="btn btn-danger btn-sm mt-1 delete-art-button px-2 py-1" data-art-id="${artId}" style="font-size:0.75rem;">Delete</button>` : ''}
            </div>
        `;

        this._setupArtEventListeners(artEl, artId, artData, currentUserId, isOwner);
        return artEl;
    }

    _setupArtEventListeners(artEl, artId, artData, currentUserId, isOwner) {
        // Profile links
        artEl.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', () => {
                window.location.href = `public-profile.html?userId=${encodeURIComponent(link.dataset.userId)}`;
            });
        });

        // Like button — delegate to SharedLikesManager
        const likeBtn = artEl.querySelector('.like-button');
        likeBtn.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            const notifyConfig = user ? await this._buildLikeNotifyConfig(artId, artData, user.firestoreUserId) : null;
            await this.likesManager.toggleLike(
                artId,
                { ...ART_CONFIG, notifyConfig },
                likeBtn,
                () => this.getCurrentUser()
            );
        });

        // Buy button
        artEl.querySelector('.buy-button').addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            if (user) { this._handleBuyArt(artId, artData); }
            else { alert("You must be logged in to purchase art."); }
        });

        // Image click
        artEl.querySelector('.art-image').addEventListener('click', () => this._showArtModal(artData));

        // Comments toggle
        const commentsContainer  = artEl.querySelector('.comments-container');
        const commentInputContainer = artEl.querySelector('.comment-input-container');
        const toggleBtn          = artEl.querySelector('.comments-toggle-button');
        let   commentsLoaded     = false;

        // Comment input — delegate to SharedCommentsManager (includes image support)
        toggleBtn.addEventListener('click', () => {
            const visible = commentsContainer.style.display === "block";
            if (!visible) {
                if (!commentsLoaded) {
                    this.commentsManager.loadComments(artId, commentsContainer, currentUserId, ART_CONFIG);
                    this.commentsManager.renderCommentInput(
                        commentInputContainer, artId, commentsContainer, ART_CONFIG, () => this.getCurrentUser()
                    );
                    commentsLoaded = true;
                }
                commentsContainer.style.display    = "block";
                commentInputContainer.style.display = "block";
                toggleBtn.textContent = "Hide Comments";
            } else {
                commentsContainer.style.display    = "none";
                commentInputContainer.style.display = "none";
                toggleBtn.textContent = "Show Comments";
            }
        });

        // Delete art (owner only)
        if (isOwner) {
            artEl.querySelector('.delete-art-button').addEventListener('click', () => {
                if (confirm("Are you sure you want to delete this art and all its comments and likes?")) {
                    this._deleteArt(artId, this.currentFilterUserId);
                }
            });
        }
    }

    // ─── Like notification helper ─────────────────────────────────────────────

    async _buildLikeNotifyConfig(artId, artData, fromUserId) {
        if (artData.userId === fromUserId) return null;
        const fromUsername = await this.ensureUsernameInCache(fromUserId);
        return {
            toUserId:     artData.userId,
            fromUsername,
            type:         "art_like",
            message:      `${fromUsername} liked your art`,
            profilePic:   this.usersCache[fromUserId]?.profilePicture || null
        };
    }

    // ─── Buy art ──────────────────────────────────────────────────────────────

    _handleBuyArt(artId, artData) {
        if (!this.auth.currentUser) { alert("Please log in to purchase art."); return; }
        const artDataWithId = { id: artId, ...artData };
        try {
            sessionStorage.setItem('selectedArt', JSON.stringify(artDataWithId));
            localStorage.setItem('selectedArt', JSON.stringify(artDataWithId));
        } catch (e) { console.error('Storage error:', e); }
        const recentArts = JSON.parse(localStorage.getItem('recentArts') || '[]');
        recentArts.unshift(artDataWithId);
        localStorage.setItem('recentArts', JSON.stringify(recentArts.slice(0, 10)));
        window.location.href = `select-product-client.html?artId=${artId}`;
    }

    // ─── Art modal ────────────────────────────────────────────────────────────

    _showArtModal(artData) {
        const modalHtml = `
            <div class="modal fade" id="artModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${artData.name}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body text-center">
                            <img src="${artData.downloadURL}" class="img-fluid" alt="${artData.name}" style="max-height:80vh;">
                            ${artData.description ? `<p class="mt-3">${artData.description}</p>` : ''}
                            <p class="text-primary fw-bold">R$ ${artData.totalPrice?.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = new bootstrap.Modal(document.getElementById('artModal'));
        modal.show();
        document.getElementById('artModal').addEventListener('hidden.bs.modal', function() { this.remove(); });
    }

    // ─── Delete art ───────────────────────────────────────────────────────────

    async _deleteArt(artId, filterUserId) {
        try {
            const artRef = this.db.collection("arts").doc(artId);
            const artDoc = await artRef.get();
            if (!artDoc.exists) throw new Error("Art doesn't exist");

            const currentUser = await this.getCurrentUser();
            if (!currentUser || currentUser.firestoreUserId !== artDoc.data().userId) {
                throw new Error("You can only delete your own art");
            }

            const batch1 = this.db.batch();
            batch1.delete(artRef);

            const [likesSnap, commentsSnap] = await Promise.all([
                this.db.collection("art_likes").where("artId", "==", artId).get(),
                this.db.collection("art_comments").where("artId", "==", artId).get()
            ]);

            likesSnap.forEach(doc => batch1.delete(doc.ref));
            const commentIds = commentsSnap.docs.map(doc => doc.id);
            commentsSnap.forEach(doc => batch1.delete(doc.ref));
            await batch1.commit();

            // Delete comment likes in a second batch
            if (commentIds.length > 0) {
                const batch2 = this.db.batch();
                for (const commentId of commentIds) {
                    const clSnap = await this.db.collection("art_comment_likes")
                        .where("commentId", "==", commentId).get();
                    clSnap.forEach(doc => batch2.delete(doc.ref));
                }
                await batch2.commit();
            }

            alert("Art and all associated content deleted successfully.");
            this.displayArts(filterUserId);
        } catch (error) {
            console.error("[ArtManager] _deleteArt error:", error);
            alert(`Failed to delete art: ${error.message}`);
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    /** Call when unmounting to prevent memory leaks. */
    destroy() {
        this.commentsManager.cleanupAllListeners();
    }
}

window.ArtManager = ArtManager;