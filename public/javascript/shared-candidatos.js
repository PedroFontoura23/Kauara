console.log("shared-candidatos.js loaded!");

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
const CANDIDATO_CONFIG = {
    collection:      "users",
    artsCollection:  "candidate_arts",
    // ── likes ────────────────────────────────────────────────────────────────
    likesCollection: "candidate_art_likes",   // Firestore collection for like docs
    contentIdField:  "candidateArtId",        // field name stored inside each like doc
    userIdField:     "userId",
    // ── candidato status ─────────────────────────────────────────────────────
    statusField:     "candidatoStatus",
    statusPending:   "pending",
    statusApproved:  "approved",
    statusRejected:  "rejected",
    minImages: 3,
    maxImages: 10,
};

window.initializeCandidatoManager = function(containerId) {
    return new CandidatoManager(db, auth, storage, containerId);
};

class CandidatoManager {
    constructor(db, auth, storage, containerId = null) {
        this.db = db;
        this.auth = auth;
        this.storage = storage;
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.currentUser = null;
        this.currentUserId = null;
        this.usersCache = {};
        this.isLoading = false;
        this.lastVisibleArt = null;
        this.batchSize = 6;
        this.currentFilterUserId = null;

        // ── Shared likes manager ─────────────────────────────────────────────
        this.likesManager = new window.SharedLikesManager(db, auth);

        // Set up auth listener
        this._unsubscribeAuth = this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    this.currentUser = user;
                    this.currentUserId = await this._getUserIdFromUid(user.uid);
                    console.log("[CandidatoManager] User resolved:", this.currentUserId);
                    
                    // If container exists and we have a filter, load arts
                    if (this.container && this.currentFilterUserId) {
                        this.displayArts(this.currentFilterUserId);
                    }
                } catch (e) {
                    console.error("[CandidatoManager] auth error", e);
                    this.currentUserId = null;
                }
            } else {
                this.currentUser = null;
                this.currentUserId = null;
            }
        });
        
        // Add CSS animations if not already present
        this._addStyles();
    }

    // ─── Styles ───────────────────────────────────────────────────────────────
    
    _addStyles() {
        if (document.getElementById("candidato-styles")) return;
        const style = document.createElement("style");
        style.id = "candidato-styles";
        style.textContent = `
            @keyframes _slideIn { 
                from { transform: translateX(60px); opacity: 0; } 
                to { transform: translateX(0); opacity: 1; } 
            }
            .candidato-art-card {
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .candidato-art-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Auth helpers ─────────────────────────────────────────────────────────

    async _getUserIdFromUid(uid) {
        const q = await this.db.collection("users").where("firebaseUID", "==", uid).limit(1).get();
        if (!q.empty) {
            return q.docs[0].id;
        }
        
        // Try to find by email if available
        const user = this.auth.currentUser;
        if (user?.email) {
            const eq = await this.db.collection("users").where("email", "==", user.email).limit(1).get();
            if (!eq.empty) {
                const userId = eq.docs[0].id;
                await eq.docs[0].ref.update({ firebaseUID: uid });
                return userId;
            }
        }
        
        throw new Error("Usuário não encontrado no sistema. Por favor, faça logout e login novamente.");
    }

    /**
     * Returns the current Firebase user enriched with .firestoreUserId.
     * Used as a getCurrentUser callback for SharedLikesManager.
     */
    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        user.firestoreUserId = await this._getUserIdFromUid(user.uid);
                    } catch (e) {
                        console.error("[CandidatoManager] getCurrentUser error:", e);
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
        
        // Get users by userId field
        for (const userId of missing) {
            const doc = await this.db.collection("users").doc(userId).get();
            if (doc.exists) {
                this.usersCache[userId] = { userId: doc.id, ...doc.data() };
            }
        }
    }

    async ensureUsernameInCache(userId) {
        if (!this.usersCache[userId]) {
            try {
                const doc = await this.db.collection("users").doc(userId).get();
                if (doc.exists) {
                    this.usersCache[userId] = { userId: doc.id, ...doc.data() };
                }
            } catch (e) { 
                console.warn("[CandidatoManager] ensureUsernameInCache:", e); 
            }
        }
        return this.usersCache[userId]?.fullLegalName || this.usersCache[userId]?.user_Name || "Artista";
    }

    // ─── Display arts ─────────────────────────────────────────────────────────

    async displayArts(filterUserId = null) {
        if (!this.container) { 
            console.error("[CandidatoManager] Arts container not found"); 
            return; 
        }
        if (this.isLoading) return;
        this.isLoading = true;

        this.currentFilterUserId = filterUserId;
        this.container.innerHTML = "<p>Loading artwork...</p>";

        try {
            let query = this.db.collection(CANDIDATO_CONFIG.artsCollection);
            if (this.currentFilterUserId) {
                query = query.where(CANDIDATO_CONFIG.userIdField, "==", this.currentFilterUserId);
            }

            const snapshot = await query.get();

            if (snapshot.empty) {
                this.container.innerHTML = "<p>No artwork available.</p>";
                this.isLoading = false;
                return;
            }

            // Cache all user data up-front in a single pass
            const userIds = [...new Set(snapshot.docs.map(doc => doc.data().userId))];
            await this.cacheUsers(userIds);

            // Pre-warm likes cache so every card knows instantly if the user liked it
            const artIds = snapshot.docs.map(d => d.id);
            await this.likesManager.prewarmLikesCache(
                artIds,
                CANDIDATO_CONFIG.likesCollection,
                CANDIDATO_CONFIG.contentIdField,
                CANDIDATO_CONFIG.userIdField,
                this.currentUserId
            );

            // Build horizontal scroll strip
            this.container.innerHTML = "";
            this.container.style.cssText = `
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

            snapshot.docs.forEach(doc => {
                const artData = doc.data();
                const userData = this.usersCache[artData.userId] || {};
                const artEl = this.createArtElement(doc.id, artData, userData);
                this.container.appendChild(artEl);
            });
        } catch (error) {
            console.error("[CandidatoManager] displayArts error:", error);
            this.container.innerHTML = "<p>Error loading artwork.</p>";
        } finally {
            this.isLoading = false;
        }
    }

    // ─── Create art element ───────────────────────────────────────────────────

    createArtElement(artId, artData, userData) {
        const artEl = document.createElement("div");
        artEl.className = "card candidato-art-card";
        artEl.style.cssText = `
            flex: 0 0 200px;
            width: 200px;
            min-width: 200px;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        `;

        const artistName = userData.fullLegalName || userData.user_Name || "Artista";
        const profilePic = userData.profilePicture ? `data:image/jpeg;base64,${userData.profilePicture}` : (userData.profilePictureUrl || '../images/default-profile.png');

        // Determine initial liked state from pre-warmed cache
        const alreadyLiked = this.likesManager.hasUserLikedContent(artId, this.currentUserId);

        artEl.innerHTML = `
            <div style="position:relative;width:100%;height:200px;overflow:hidden;cursor:pointer;">
                <img src="${artData.imageUrl}"
                     alt="Artwork"
                     style="width:100%;height:100%;object-fit:cover;"
                     loading="lazy"
                     data-art-id="${artId}"
                     data-fullscreen="true">
            </div>
            <div class="p-2" style="flex:1;display:flex;align-items:center;gap:8px;overflow:hidden;">
                <img src="${profilePic}"
                     class="rounded-circle user-profile-link flex-shrink-0"
                     alt="Profile"
                     style="width:24px;height:24px;object-fit:cover;cursor:pointer;"
                     data-user-id="${artData.userId}">
                <span class="text-truncate user-profile-link" style="font-size:0.78rem;cursor:pointer;" data-user-id="${artData.userId}">
                    ${this._escape(artistName)}
                </span>
            </div>
            <div class="card-footer p-2 d-flex gap-1">
                <button class="btn btn-sm like-button px-2 py-1 ${alreadyLiked ? 'btn-primary' : 'btn-outline-primary'}"
                        data-art-id="${artId}"
                        style="font-size:0.75rem;">
                    ♥ <span class="like-count">${artData.likes_count || 0}</span>
                </button>
            </div>
        `;
        
        this._setupArtEventListeners(artEl, artId, artData);
        return artEl;
    }

    _setupArtEventListeners(artEl, artId, artData) {
        // Profile links
        artEl.querySelectorAll('.user-profile-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `public-profile.html?userId=${encodeURIComponent(link.dataset.userId)}`;
            });
        });
        
        // Fullscreen image on click
        const img = artEl.querySelector('img[data-fullscreen="true"]');
        if (img) {
            img.addEventListener('click', () => {
                this._showFullscreenImage(artData.imageUrl, artData.caption);
            });
        }

        // Like button — delegate to SharedLikesManager
        const likeBtn = artEl.querySelector('.like-button');
        likeBtn.addEventListener('click', async () => {
            const user = await this.getCurrentUser();
            const notifyConfig = user
                ? await this._buildLikeNotifyConfig(artId, artData, user.firestoreUserId)
                : null;

            await this.likesManager.toggleLike(
                artId,
                {
                    collection:      CANDIDATO_CONFIG.artsCollection,
                    likesCollection: CANDIDATO_CONFIG.likesCollection,
                    userIdField:     CANDIDATO_CONFIG.userIdField,
                    notifyConfig,
                },
                likeBtn,
                () => this.getCurrentUser()
            );

            // Sync active visual state after toggle
            const nowLiked = this.likesManager.hasUserLikedContent(artId, this.currentUserId);
            likeBtn.classList.toggle('btn-primary',         nowLiked);
            likeBtn.classList.toggle('btn-outline-primary', !nowLiked);
        });
    }
    
    // ─── Like notification helper ─────────────────────────────────────────────

    async _buildLikeNotifyConfig(artId, artData, fromUserId) {
        if (!fromUserId || artData.userId === fromUserId) return null;
        const fromUsername = await this.ensureUsernameInCache(fromUserId);
        return {
            toUserId:    artData.userId,
            fromUsername,
            type:        "candidate_art_like",
            message:     `${fromUsername} liked your artwork`,
            profilePic:  this.usersCache[fromUserId]?.profilePicture || null,
        };
    }

    // ─── Fullscreen image ─────────────────────────────────────────────────────
    
    _showFullscreenImage(imageUrl, caption) {
        const modal = document.createElement("div");
        modal.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.9); 
            z-index: 10000; display: flex; align-items: center; 
            justify-content: center; cursor: pointer;
        `;
        modal.innerHTML = `
            <div style="max-width: 90vw; max-height: 90vh; position: relative;">
                <img src="${imageUrl}" style="max-width: 100%; max-height: 90vh; object-fit: contain;">
                ${caption ? `<p style="color: white; text-align: center; margin-top: 16px;">${this._escape(caption)}</p>` : ''}
                <button style="position: absolute; top: -40px; right: 0; background: none; border: none; color: white; font-size: 32px; cursor: pointer;">&times;</button>
            </div>
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.tagName === 'BUTTON') {
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    }

    // ─── Helper methods ───────────────────────────────────────────────────────
    
    _showNotification(message, type = "info") {
        const notif = document.createElement("div");
        notif.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 14px 20px; border-radius: 40px;
            color: #fff; font-weight: 500; z-index: 99999; font-size: 14px;
            background: ${type === "success" ? "#4CAF50" : type === "error" ? "#F44336" : "#2196F3"};
            box-shadow: 0 8px 20px rgba(0,0,0,.18); animation: _slideIn .2s ease;
        `;
        notif.textContent = message;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = "0";
            notif.style.transition = "opacity .3s";
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }
    
    _escape(s) {
        if (!s) return "";
        return s.replace(/[&<>"]/g, m =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    /** Call when unmounting to prevent memory leaks. */
    destroy() {
        this._unsubscribeAuth?.();
    }
}

// Explicitly expose to window so other scripts can reliably detect it
// (bare class declarations are NOT guaranteed to land on window in all environments)
window.CandidatoManager = CandidatoManager;

// ─── Page-level initialization helper ────────────────────────────────────────
async function displayArts(userIdFromUrl) {
    const artsContainer = document.getElementById("artsContainer");
    if (!artsContainer) { 
        console.error("Arts container not found."); 
        return; 
    }
    const candidatoManager = new CandidatoManager(db, auth, storage, 'artsContainer');
    candidatoManager.displayArts(userIdFromUrl);
}