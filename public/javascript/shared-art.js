console.log("shared-arts.js loaded!");

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

    async displayArts(filterUserId = null, currentUserId = null, loadMore = false) {
        if (!this.container) { console.error("Arts container not found"); return; }
        if (this.isLoading) return;
        this.isLoading = true;

        if (!currentUserId) {
            const user = await this.getCurrentUser();
            if (user) currentUserId = user.firestoreUserId;
        }

        if (!loadMore || this.currentFilterUserId !== filterUserId) {
            this.container.innerHTML = "<p>Loading arts...</p>";
            this.lastVisibleArt      = null;
            this.currentFilterUserId = filterUserId;
        }

        try {
            let query = this.db.collection("arts").orderBy("createdAt", "desc");
            if (this.currentFilterUserId) query = query.where("userId", "==", this.currentFilterUserId);
            query = query.limit(this.batchSize);
            if (loadMore && this.lastVisibleArt) query = query.startAfter(this.lastVisibleArt);

            const snapshot = await query.get();
            if (snapshot.empty) {
                if (!loadMore) this.container.innerHTML = "<p>No arts available.</p>";
                return;
            }

            const userIds = snapshot.docs.map(doc => doc.data().userId);
            await this.cacheUsers([...new Set(userIds)]);

            if (!loadMore) this.container.innerHTML = "";

            // Pre-warm likes cache for this batch
            const artIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                artIds, ART_CONFIG.likesCollection, "artId", "userId", currentUserId
            );

            snapshot.docs.forEach(doc => {
                const artData  = doc.data();
                const userData = this.usersCache[artData.userId] || {};
                const artEl    = this.createArtElement(doc.id, artData, userData, currentUserId);
                this.container.appendChild(artEl);
            });

            this.lastVisibleArt = snapshot.docs[snapshot.docs.length - 1];

            if (snapshot.docs.length === this.batchSize) {
                this._observeLastElement(this.container.lastElementChild, this.currentFilterUserId);
            }
        } catch (error) {
            console.error("[ArtManager] displayArts error:", error);
            if (!loadMore) this.container.innerHTML = "<p>Error loading arts.</p>";
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
                    this.displayArts(filterUserId, null, true);
                }
            });
        }, { threshold: 1.0 });
        observer.observe(el);
    }

    // ─── Create art element ───────────────────────────────────────────────────

    createArtElement(artId, artData, userData, currentUserId) {
        const isOwner  = artData.userId === currentUserId;
        const artEl    = document.createElement("div");
        artEl.className = "card mb-4 art-card";

        const timestamp     = artData.createdAt?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        artEl.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : '../images/default-profile.png'}"
                     class="rounded-circle me-2 user-profile-link"
                     alt="Profile Picture"
                     style="width:40px;height:40px;object-fit:cover;cursor:pointer;"
                     data-user-id="${artData.userId}">
                <div>
                    <h6 class="mb-0 user-profile-link" style="cursor:pointer;" data-user-id="${artData.userId}">
                        ${userData.user_Name || "Unknown Artist"}
                    </h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <h5 class="card-title">${artData.name}</h5>
                <div class="art-price-section mb-3">
                    <strong class="text-primary">R$ ${artData.totalPrice?.toFixed(2) || '0.00'}</strong>
                    <small class="text-muted">
                        (Art: R$ ${artData.price?.toFixed(2) || '0.00'} + Platform: R$ ${artData.platformFee?.toFixed(2) || '0.00'})
                    </small>
                </div>
                <div class="art-image-container"
                     style="width:100%;height:400px;overflow:hidden;display:flex;justify-content:center;align-items:center;background-color:${artData.bgColor || '#f8f9fa'};">
                    <img src="${artData.downloadURL}"
                         class="img-fluid rounded art-image lazy-load"
                         alt="${artData.name}"
                         style="width:100%;height:100%;object-fit:contain;cursor:pointer;"
                         loading="lazy"
                         data-art-id="${artId}">
                </div>
                ${artData.description ? `<p class="card-text mt-3">${artData.description}</p>` : ''}
            </div>
            <div class="card-footer">
                <button class="btn btn-outline-primary like-button" data-art-id="${artId}">
                    <span class="like-count">${artData.likes_count || 0}</span> Likes
                </button>
                <button class="btn btn-success buy-button" data-art-id="${artId}" data-price="${artData.totalPrice}">
                    Buy Art - R$ ${artData.totalPrice?.toFixed(2) || '0.00'}
                </button>
                <button class="btn btn-outline-secondary comments-toggle-button" data-art-id="${artId}">
                    Show Comments
                </button>
                <div class="comments-container mt-3" id="comments-${artId}" style="display:none;"></div>
                <div class="comment-input-container mt-2" id="commentInputContainer-${artId}" style="display:none;">
                    <div class="input-group">
                        <input type="text" class="form-control comment-input"
                               placeholder="Write a comment..." id="commentInput-${artId}">
                        <button class="btn btn-outline-primary comment-submit" data-art-id="${artId}">Post</button>
                    </div>
                </div>
                ${isOwner ? `<button class="btn btn-danger mt-2 delete-art-button" data-art-id="${artId}">Delete Art</button>` : ''}
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

        toggleBtn.addEventListener('click', () => {
            const visible = commentsContainer.style.display === "block";
            if (!visible) {
                if (!commentsLoaded) {
                    this.commentsManager.loadComments(artId, commentsContainer, currentUserId, ART_CONFIG);
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

        // Comment submit — delegate to SharedCommentsManager
        const commentInput = artEl.querySelector('.comment-input');
        const submitBtn    = artEl.querySelector('.comment-submit');
        const doSubmit     = () => this.commentsManager.submitComment(
            artId, commentInput, commentsContainer, ART_CONFIG, () => this.getCurrentUser()
        );
        submitBtn.addEventListener('click', doSubmit);
        commentInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });

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