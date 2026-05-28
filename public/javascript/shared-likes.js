console.log("shared-likes.js loaded!");

/**
 * SharedLikesManager
 *
 * A unified, secure, and efficient likes manager for arts, posts, and products.
 *
 * SECURITY:
 *  - All write operations verify the user is authenticated before touching Firestore.
 *  - Compound document IDs (contentId_userId) prevent a user from liking the same item twice,
 *    enforced at the Firestore document level (no duplicates possible).
 *  - Optimistic UI is always rolled back on failure — the UI never stays in an inconsistent state.
 *  - Like operations are guarded by an in-flight Set to prevent race conditions from rapid clicks.
 *
 * EFFICIENCY:
 *  - Every like/unlike is a single atomic batch write (like-doc + count increment/decrement).
 *  - Local cache (Map<contentId, Set<userId>>) avoids re-reading Firestore for known state.
 *  - Cache is written before the Firestore commit (optimistic) and corrected on error.
 *  - No polling or snapshots — likes are read once per item on first interaction.
 *
 * CONFIG per content type:
 *  arts     → collection: "arts",     likesCollection: "art_likes",             userIdField: "userId"
 *  posts    → collection: "posts",    likesCollection: "likes",                 userIdField: "foreignUserId"
 *  products → collection: "products", likesCollection: "product_likes",         userIdField: "userId"
 *  comments (arts)     → collection: "art_comments",     likesCollection: "art_comment_likes"
 *  comments (posts)    → collection: "comments",          likesCollection: "comment_likes",     userIdField: "foreignUserId"
 *  comments (products) → collection: "product_comments", likesCollection: "product_comment_likes"
 */

window.SharedLikesManager = class SharedLikesManager {
    /**
     * @param {firebase.firestore.Firestore} db
     * @param {firebase.auth.Auth} auth
     */
    constructor(db, auth) {
        this.db   = db;
        this.auth = auth;

        // Map<contentId, Set<userId>> — tracks which users liked each item (locally).
        this._likesCache        = new Map();
        this._commentLikesCache = new Map();

        // Sets of IDs currently being processed — prevents double-clicks.
        this._inFlightLikes        = new Set();
        this._inFlightCommentLikes = new Set();

        // Resolved Firestore user ID for the currently logged-in user.
        this._currentUserId = null;
        this._authReady     = false;

        // Resolve once auth is initialised.
        this._authReadyPromise = new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        this._currentUserId = await this._resolveFirestoreUserId(user.uid);
                    } catch (e) {
                        console.error("[SharedLikesManager] Auth init error:", e);
                        this._currentUserId = null;
                    }
                } else {
                    this._currentUserId = null;
                }
                this._authReady = true;
                resolve();
            });
        });
    }

    // ─────────────────────────────────────────────
    //  CONTENT LIKES  (arts / posts / products)
    // ─────────────────────────────────────────────

    /**
     * Toggle a like on a content item (art / post / product).
     *
     * @param {string} contentId          - Firestore document ID of the item.
     * @param {object} config             - { collection, likesCollection, userIdField, notifyConfig? }
     *   notifyConfig: { toUserId, fromUsername, type, message, profilePic? }
     * @param {HTMLElement} likeButton    - The button element (for optimistic UI update).
     * @param {Function} [getCurrentUser] - Optional function returning a user with .firestoreUserId.
     *                                      Defaults to internal auth resolution.
     */
    async toggleLike(contentId, config, likeButton, getCurrentUser = null) {
        if (this._inFlightLikes.has(contentId)) return;
        this._inFlightLikes.add(contentId);

        const userId = await this._getOrResolveUserId(getCurrentUser);
        if (!userId) {
            alert("You must be logged in to like this.");
            this._inFlightLikes.delete(contentId);
            return;
        }

        // Optimistic UI
        const countEl      = likeButton?.querySelector('.like-count');
        const currentCount = parseInt(countEl?.textContent || "0", 10);
        const hasLiked     = this._likesCache.get(contentId)?.has(userId) || false;

        if (countEl) countEl.textContent = hasLiked ? currentCount - 1 : currentCount + 1;

        // Update local cache optimistically
        this._updateCache(this._likesCache, contentId, userId, !hasLiked);

        try {
            const batch         = this.db.batch();
            const contentIdField = config.contentIdField || this._getContentIdField(config);
            const likeDocId     = `${contentId}_${userId}`;
            const likeRef       = this.db.collection(config.likesCollection).doc(likeDocId);
            const contentRef    = this.db.collection(config.collection).doc(contentId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(contentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
            } else {
                const likeData = {
                    [config.userIdField || "userId"]: userId,
                    [contentIdField]: contentId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                };
                batch.set(likeRef, likeData);
                batch.update(contentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });

                // Notification (only on like, not unlike)
                if (config.notifyConfig) {
                    const { toUserId, fromUsername, type, message, profilePic } = config.notifyConfig;
                    if (toUserId && toUserId !== userId) {
                        const notifRef = this.db.collection("notifications").doc();
                        batch.set(notifRef, {
                            toUserId,
                            fromUserId:          userId,
                            fromUsername:        fromUsername || "Someone",
                            fromUserProfilePic:  profilePic || null,
                            type:                type || "like",
                            message:             message || `${fromUsername} liked your content`,
                            [contentIdField]:   contentId,
                            timestamp:           firebase.firestore.FieldValue.serverTimestamp(),
                            read:                false
                        });
                    }
                }
            }

            await batch.commit();

            // Sync the real count from Firestore so the DOM stays accurate
            if (countEl) {
                const doc = await this.db.collection(config.collection).doc(contentId).get();
                if (doc.exists) countEl.textContent = doc.data().likes_count ?? (hasLiked ? currentCount - 1 : currentCount + 1);
            }
        } catch (error) {
            console.error("[SharedLikesManager] toggleLike error:", error);
            // Rollback optimistic updates
            if (countEl) countEl.textContent = currentCount;
            this._updateCache(this._likesCache, contentId, userId, hasLiked);
        } finally {
            this._inFlightLikes.delete(contentId);
        }
    }

    /**
     * Read the current likes_count straight from Firestore (use sparingly).
     * Prefer relying on the optimistic UI counter instead.
     */
    async getLikesCount(contentId, collectionName) {
        const doc = await this.db.collection(collectionName).doc(contentId).get();
        return doc.exists ? (doc.data().likes_count || 0) : 0;
    }

    // ─────────────────────────────────────────────
    //  COMMENT LIKES
    // ─────────────────────────────────────────────

    /**
     * Toggle a like on a comment.
     *
     * @param {string} commentId               - Firestore comment document ID.
     * @param {object} config                  - { commentsCollection, commentLikesCollection, userIdField }
     * @param {HTMLElement} likeButton         - The like button element.
     * @param {Function} [getCurrentUser]
     */
    async toggleCommentLike(commentId, config, likeButton, getCurrentUser = null) {
        if (this._inFlightCommentLikes.has(commentId)) return;
        this._inFlightCommentLikes.add(commentId);

        const userId = await this._getOrResolveUserId(getCurrentUser);
        if (!userId) {
            alert("You must be logged in to like a comment.");
            this._inFlightCommentLikes.delete(commentId);
            return;
        }

        const countEl      = likeButton?.querySelector('.comment-like-count');
        const currentCount = parseInt(countEl?.textContent || "0", 10);
        const hasLiked     = this._commentLikesCache.get(commentId)?.has(userId) || false;

        if (countEl) countEl.textContent = hasLiked ? currentCount - 1 : currentCount + 1;
        this._updateCache(this._commentLikesCache, commentId, userId, !hasLiked);

        try {
            const batch      = this.db.batch();
            const likeDocId  = `${commentId}_${userId}`;
            const likeRef    = this.db.collection(config.commentLikesCollection).doc(likeDocId);
            const commentRef = this.db.collection(config.commentsCollection).doc(commentId);

            if (hasLiked) {
                batch.delete(likeRef);
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(-1)
                });
                this._commentLikesCache.get(commentId)?.delete(userId);
            } else {
                const likeData = {
                    [config.userIdField || "userId"]: userId,
                    [`${config.userIdField === "foreignUserId" ? "foreignCommentId" : "commentId"}`]: commentId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                };
                batch.set(likeRef, likeData);
                batch.update(commentRef, {
                    likes_count: firebase.firestore.FieldValue.increment(1)
                });
                if (!this._commentLikesCache.has(commentId)) {
                    this._commentLikesCache.set(commentId, new Set());
                }
                this._commentLikesCache.get(commentId).add(userId);
            }

            await batch.commit();
        } catch (error) {
            console.error("[SharedLikesManager] toggleCommentLike error:", error);
            if (countEl) countEl.textContent = currentCount;
            this._updateCache(this._commentLikesCache, commentId, userId, hasLiked);
        } finally {
            this._inFlightCommentLikes.delete(commentId);
        }
    }

    // ─────────────────────────────────────────────
    //  CACHE QUERY HELPERS
    // ─────────────────────────────────────────────

    hasUserLikedContent(contentId, userId) {
        return this._likesCache.get(contentId)?.has(userId) || false;
    }

    hasUserLikedComment(commentId, userId) {
        return this._commentLikesCache.get(commentId)?.has(userId) || false;
    }

    /**
     * Pre-warm the likes cache for a batch of content IDs.
     * Call once after loading a page of items to avoid per-item round-trips.
     *
     * @param {string[]} contentIds
     * @param {string}   likesCollection
     * @param {string}   contentIdField    - e.g. "artId", "foreignPostId", "productId"
     * @param {string}   userIdField       - e.g. "userId", "foreignUserId"
     * @param {string}   currentUserId
     */
    async prewarmLikesCache(contentIds, likesCollection, contentIdField, userIdField, currentUserId) {
        if (!contentIds.length || !currentUserId) return;
        try {
            // Fetch only likes belonging to the current user for these items.
            const chunks = this._chunk(contentIds, 10);
            const fieldName = contentIdField || this._getContentIdField({ collection: likesCollection, userIdField });
            for (const chunk of chunks) {
                const snap = await this.db.collection(likesCollection)
                    .where(fieldName, "in", chunk)
                    .where(userIdField, "==", currentUserId)
                    .get();
                snap.forEach(doc => {
                    const cid = doc.data()[fieldName];
                    if (!this._likesCache.has(cid)) this._likesCache.set(cid, new Set());
                    this._likesCache.get(cid).add(currentUserId);
                });
            }
        } catch (e) {
            console.warn("[SharedLikesManager] prewarmLikesCache error:", e);
        }
    }

    async loadLikeState(contentId, config, getCurrentUser = null) {
        const userId = await this._getOrResolveUserId(getCurrentUser);
        if (!userId) return false;

        const contentIdField = config.contentIdField || this._getContentIdField(config);
        const likeDocId = `${contentId}_${userId}`;
        const likeRef = this.db.collection(config.likesCollection).doc(likeDocId);
        const likeDoc = await likeRef.get();
        const liked = likeDoc.exists;

        if (!this._likesCache.has(contentId)) this._likesCache.set(contentId, new Set());
        this._updateCache(this._likesCache, contentId, userId, liked);
        return liked;
    }

    _getContentIdField(config) {
        if (config && config.contentIdField) return config.contentIdField;
        if (!config || !config.collection) return 'itemId';

        switch (config.collection) {
            case 'arts': return 'artId';
            case 'posts': return 'postId';
            case 'products': return 'productId';
            case 'users': return 'profileUserId';
            default: return `${config.collection.replace(/s$/, '')}Id`;
        }
    }

    // ─────────────────────────────────────────────
    //  PRIVATE HELPERS
    // ─────────────────────────────────────────────

    async _getOrResolveUserId(getCurrentUserFn) {
        if (getCurrentUserFn) {
            const user = await getCurrentUserFn();
            return user?.firestoreUserId || null;
        }
        await this._authReadyPromise;
        return this._currentUserId;
    }

    async _resolveFirestoreUserId(uid) {
        const q = await this.db.collection("users").where("firebaseUID", "==", uid).get();
        if (q.empty) throw new Error(`No Firestore user found for uid: ${uid}`);
        return q.docs[0].id;
    }

    _updateCache(cacheMap, id, userId, shouldAdd) {
        if (!cacheMap.has(id)) cacheMap.set(id, new Set());
        if (shouldAdd) {
            cacheMap.get(id).add(userId);
        } else {
            cacheMap.get(id).delete(userId);
        }
    }

    _chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    }
};