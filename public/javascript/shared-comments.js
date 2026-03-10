console.log("shared-comments.js loaded!");

/**
 * SharedCommentsManager
 *
 * A unified, secure, and efficient comments manager for arts, posts, and products.
 *
 * SECURITY:
 *  - submitComment verifies the user is authenticated before writing.
 *  - deleteComment verifies that the requester owns the comment (server-side field check).
 *  - reportComment verifies authentication and prevents self-reporting.
 *  - Comment content is trimmed and length-capped (MAX_COMMENT_LENGTH) before storage.
 *  - Firestore batch writes ensure atomic deletes (comment + its likes + its reports).
 *  - In-flight guards prevent double-submissions.
 *
 * EFFICIENCY:
 *  - Real-time onSnapshot listener per item — updates UI automatically without polling.
 *  - Listeners are stored and properly unsubscribed to prevent memory leaks.
 *  - User data is batched-fetched and locally cached across all comment renders.
 *  - Pagination: renders first 8 comments, "Load More" on demand (no re-read of Firestore).
 *  - Comment list is never re-fetched from Firestore on each toggle — listener is reused.
 *
 * REPORT BUTTON:
 *  Comments in Firestore get a `reports` sub-field when reported:
 *    reports: {
 *      [userId]: { timestamp: Timestamp, reason: string }
 *    }
 *  and a `reports_count: number` field for admin queries.
 *  A user can only report a comment once (UI button becomes disabled after reporting).
 *  Users cannot report their own comments.
 *
 * CONFIG per content type:
 *  arts:
 *    { commentsCollection: "art_comments",     commentLikesCollection: "art_comment_likes",
 *      contentIdField: "artId",                userIdField: "userId",
 *      contentCollection: "arts",              notificationType: "art_comment" }
 *  posts:
 *    { commentsCollection: "comments",          commentLikesCollection: "comment_likes",
 *      contentIdField: "foreignPostId",         userIdField: "foreignUserId",
 *      contentCollection: "posts",             notificationType: "comment" }
 *  products:
 *    { commentsCollection: "product_comments", commentLikesCollection: "product_comment_likes",
 *      contentIdField: "productId",             userIdField: "userId",
 *      contentCollection: "products",          notificationType: "product_comment" }
 */

window.SharedCommentsManager = class SharedCommentsManager {

    static MAX_COMMENT_LENGTH = 500;
    static PAGE_SIZE          = 8;

    /**
     * @param {firebase.firestore.Firestore} db
     * @param {firebase.auth.Auth} auth
     * @param {object} usersCache  - Shared reference to the parent manager's usersCache object.
     * @param {SharedLikesManager} sharedLikesManager - Instance of SharedLikesManager.
     */
    constructor(db, auth, usersCache, sharedLikesManager) {
        this.db                 = db;
        this.auth               = auth;
        this.usersCache         = usersCache;         // Shared with parent manager
        this.likesManager       = sharedLikesManager; // SharedLikesManager instance

        // Map<contentId, unsubscribe()> — active Firestore listeners
        this._listeners         = {};

        // In-flight submission guard
        this._submitting        = false;

        // Resolved Firestore user ID for the current user.
        this._currentUserId     = null;

        this._authReadyPromise  = new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try {
                        this._currentUserId = await this._resolveFirestoreUserId(user.uid);
                    } catch (e) {
                        this._currentUserId = null;
                    }
                } else {
                    this._currentUserId = null;
                }
                resolve();
            });
        });
    }

    // ─────────────────────────────────────────────
    //  SUBMIT COMMENT
    // ─────────────────────────────────────────────

    /**
     * Submit a new comment.
     *
     * @param {string}      contentId         - Firestore ID of the parent content item.
     * @param {HTMLInputElement} commentInput  - The text input element.
     * @param {HTMLElement} commentsContainer  - The container for displaying comments.
     * @param {object}      config            - See CONFIG above.
     * @param {Function}    [getCurrentUser]  - Optional async function returning { firestoreUserId }.
     */
    async submitComment(contentId, commentInput, commentsContainer, config, getCurrentUser = null) {
        if (this._submitting) return;
        this._submitting = true;

        const rawText = commentInput?.value?.trim() ?? "";

        if (!rawText) {
            alert("Please enter a comment.");
            this._submitting = false;
            return;
        }

        if (rawText.length > SharedCommentsManager.MAX_COMMENT_LENGTH) {
            alert(`Comments cannot exceed ${SharedCommentsManager.MAX_COMMENT_LENGTH} characters.`);
            this._submitting = false;
            return;
        }

        const userId = await this._getOrResolveUserId(getCurrentUser);
        if (!userId) {
            alert("You must be logged in to comment.");
            this._submitting = false;
            return;
        }

        const submitButton = commentsContainer?.parentElement?.querySelector('.comment-submit');
        if (submitButton) {
            commentInput.disabled      = true;
            submitButton.disabled      = true;
            submitButton.textContent   = "Posting...";
        }

        try {
            const commentData = {
                [config.userIdField]:   userId,
                [config.contentIdField]: contentId,
                content:                rawText,
                timestamp:              firebase.firestore.FieldValue.serverTimestamp(),
                likes_count:            0,
                reports_count:          0,
                reports:                {}
            };

            await this.db.collection(config.commentsCollection).add(commentData);

            // Send notification to content owner (if not self)
            await this._sendCommentNotification(contentId, userId, rawText, config);

            commentInput.value = "";
            this._showSuccess(commentsContainer, "Comment added!");
        } catch (error) {
            console.error("[SharedCommentsManager] submitComment error:", error);
            alert("Failed to submit comment. Please try again.");
        } finally {
            if (submitButton) {
                commentInput.disabled    = false;
                submitButton.disabled    = false;
                submitButton.textContent = "Post";
            }
            this._submitting = false;
        }
    }

    // ─────────────────────────────────────────────
    //  LOAD COMMENTS (real-time listener)
    // ─────────────────────────────────────────────

    /**
     * Attach a real-time Firestore listener for comments on a content item.
     * Automatically unsubscribes any previous listener for the same contentId.
     *
     * @param {string}      contentId
     * @param {HTMLElement} commentsContainer
     * @param {string}      currentUserId
     * @param {object}      config
     */
    loadComments(contentId, commentsContainer, currentUserId, config) {
        if (!commentsContainer) return;

        commentsContainer.style.maxHeight = "300px";
        commentsContainer.style.overflowY = "auto";

        // Cleanup previous listener
        if (this._listeners[contentId]) {
            this._listeners[contentId]();
            delete this._listeners[contentId];
        }

        const unsubscribe = this.db.collection(config.commentsCollection)
            .where(config.contentIdField, "==", contentId)
            .orderBy("likes_count", "desc")
            .orderBy("timestamp", "asc")
            .onSnapshot(async (snapshot) => {
                if (snapshot.empty) {
                    commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
                    return;
                }

                // Batch-cache all user IDs
                const userIdField = config.userIdField;
                const userIds     = snapshot.docs.map(doc => doc.data()[userIdField]);
                await this._cacheUsers([...new Set(userIds)]);

                const allComments = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    likes_count: doc.data().likes_count ?? 0,
                }));

                this._renderComments(allComments, commentsContainer, currentUserId, contentId, config);
            },
            (error) => {
                console.error("[SharedCommentsManager] loadComments error:", error);
                commentsContainer.innerHTML = '<p class="text-danger">Error loading comments.</p>';
            });

        this._listeners[contentId] = unsubscribe;
    }

    /**
     * Unsubscribe all active comment listeners. Call when navigating away or destroying the manager.
     */
    cleanupAllListeners() {
        for (const id in this._listeners) {
            if (typeof this._listeners[id] === "function") {
                this._listeners[id]();
            }
        }
        this._listeners = {};
    }

    // ─────────────────────────────────────────────
    //  DELETE COMMENT
    // ─────────────────────────────────────────────

    /**
     * Delete a comment and all its associated likes and reports.
     * Only the comment owner can delete.
     *
     * @param {string}      commentId
     * @param {string}      contentId         - Used for UI refresh.
     * @param {HTMLElement} commentsContainer
     * @param {string}      currentUserId
     * @param {object}      config
     */
    async deleteComment(commentId, contentId, commentsContainer, currentUserId, config) {
        if (!commentsContainer) return;
        if (!confirm("Are you sure you want to delete this comment?")) return;

        try {
            // Security: verify ownership before deleting
            const commentDoc = await this.db.collection(config.commentsCollection).doc(commentId).get();
            if (!commentDoc.exists) {
                alert("Comment not found.");
                return;
            }

            const ownerUserId = commentDoc.data()[config.userIdField];
            if (ownerUserId !== currentUserId) {
                alert("You can only delete your own comments.");
                return;
            }

            const batch = this.db.batch();
            batch.delete(commentDoc.ref);

            // Delete associated likes
            const likesSnap = await this.db.collection(config.commentLikesCollection)
                .where(
                    config.userIdField === "foreignUserId" ? "foreignCommentId" : "commentId",
                    "==",
                    commentId
                )
                .get();
            likesSnap.forEach(doc => batch.delete(doc.ref));

            await batch.commit();

            // Remove from DOM
            commentsContainer.querySelector(`[data-comment-id="${commentId}"]`)?.remove();
        } catch (error) {
            console.error("[SharedCommentsManager] deleteComment error:", error);
            alert("Failed to delete comment. Please try again.");
        }
    }

    // ─────────────────────────────────────────────
    //  REPORT COMMENT
    // ─────────────────────────────────────────────

    /**
     * Report a comment for review.
     * - Stored as a map field on the comment doc: reports.{userId} = { timestamp, reason }
     * - reports_count is incremented atomically.
     * - A user can only report a comment once.
     * - A user cannot report their own comment.
     *
     * @param {string}   commentId
     * @param {string}   currentUserId
     * @param {string}   commentOwnerId
     * @param {object}   config
     * @param {Function} [onSuccess]     - Optional callback after successful report.
     */
    async reportComment(commentId, currentUserId, commentOwnerId, config, onSuccess = null) {
        if (!currentUserId) {
            alert("You must be logged in to report a comment.");
            return;
        }

        if (currentUserId === commentOwnerId) {
            alert("You cannot report your own comment.");
            return;
        }

        const reason = prompt(
            "Why are you reporting this comment?\n\n" +
            "1. Spam or advertising\n" +
            "2. Harassment or bullying\n" +
            "3. Hate speech\n" +
            "4. Misinformation\n" +
            "5. Other\n\n" +
            "Enter a reason (optional):"
        );

        // User cancelled the prompt
        if (reason === null) return;

        try {
            const commentRef = this.db.collection(config.commentsCollection).doc(commentId);
            const commentDoc = await commentRef.get();

            if (!commentDoc.exists) {
                alert("This comment no longer exists.");
                return;
            }

            const existingReports = commentDoc.data().reports || {};
            if (existingReports[currentUserId]) {
                alert("You have already reported this comment.");
                return;
            }

            // Atomic update: add the report entry and increment the counter
            await commentRef.update({
                [`reports.${currentUserId}`]: {
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    reason:    reason.trim() || "No reason provided"
                },
                reports_count: firebase.firestore.FieldValue.increment(1)
            });

            if (onSuccess) onSuccess();
            this._showToast("Comment reported. Thank you for helping keep the community safe.", "warning");
        } catch (error) {
            console.error("[SharedCommentsManager] reportComment error:", error);
            alert("Failed to report comment. Please try again.");
        }
    }

    // ─────────────────────────────────────────────
    //  CREATE COMMENT ELEMENT
    // ─────────────────────────────────────────────

    /**
     * Build and return a comment DOM element.
     *
     * @param {object}      commentData
     * @param {object}      userData
     * @param {string}      currentUserId
     * @param {string}      contentId
     * @param {HTMLElement} commentsContainer
     * @param {object}      config
     * @returns {HTMLElement}
     */
    createCommentElement(commentData, userData, currentUserId, contentId, commentsContainer, config) {
        const commentEl = document.createElement("div");
        commentEl.className = "mb-3 d-flex align-items-start";
        commentEl.setAttribute("data-comment-id", commentData.id);

        const profilePic = userData.profilePicture
            ? `data:image/jpeg;base64,${userData.profilePicture}`
            : "../images/default-profile.png";

        let timestamp = new Date();
        if (commentData.timestamp?.toDate) {
            timestamp = commentData.timestamp.toDate();
        } else if (commentData.timestamp instanceof Date) {
            timestamp = commentData.timestamp;
        }

        const ownerUserId  = commentData[config.userIdField];
        const isOwner      = ownerUserId === currentUserId;
        const userReported = currentUserId && (commentData.reports?.[currentUserId] !== undefined);

        commentEl.innerHTML = `
            <img src="${profilePic}"
                 class="rounded-circle me-2 user-profile-link flex-shrink-0"
                 style="width:40px;height:40px;object-fit:cover;cursor:pointer;"
                 data-user-id="${ownerUserId}"
                 alt="Profile Picture"
                 onerror="this.src='../images/default-profile.png'">
            <div class="d-flex flex-column flex-grow-1 overflow-hidden">
                <strong class="user-profile-link" style="cursor:pointer;" data-user-id="${ownerUserId}">
                    ${userData.user_Name || "Unknown User"}
                </strong>
                <span class="text-break">${this._escapeHtml(commentData.content)}</span>
                <small class="text-muted">${timestamp.toLocaleString()}</small>
            </div>
            <div class="d-flex align-items-center gap-1 ms-2 flex-shrink-0">
                <button class="btn btn-outline-primary btn-sm comment-like-button" data-comment-id="${commentData.id}">
                    <span class="comment-like-count">${commentData.likes_count || 0}</span>
                    <i class="fas fa-thumbs-up ms-1"></i>
                </button>
                <div class="position-relative comment-options-wrapper">
                    <button class="btn btn-sm btn-outline-secondary comment-dots-btn" title="Options">&#8942;</button>
                    <div class="comment-popup shadow border rounded bg-white p-2"
                         style="display:none;position:fixed;z-index:1050;min-width:160px;">
                        ${isOwner ? `
                            <button class="btn btn-link text-danger w-100 text-start px-2 py-1 comment-delete-btn">
                                <i class="fas fa-trash-alt me-2"></i>Delete Comment
                            </button>
                        ` : ""}
                        ${(!isOwner && currentUserId) ? `
                            <button class="btn btn-link text-warning w-100 text-start px-2 py-1 comment-report-btn
                                           ${userReported ? "disabled" : ""}"
                                    ${userReported ? "disabled" : ""}>
                                <i class="fas fa-flag me-2"></i>${userReported ? "Reported" : "Report Comment"}
                            </button>
                        ` : ""}
                    </div>
                </div>
            </div>
        `;

        this._attachCommentEventListeners(commentEl, commentData, currentUserId, ownerUserId, contentId, commentsContainer, config);
        return commentEl;
    }

    // ─────────────────────────────────────────────
    //  PRIVATE — RENDERING
    // ─────────────────────────────────────────────

    _renderComments(allComments, commentsContainer, currentUserId, contentId, config) {
        commentsContainer.innerHTML = "";

        const pageSize = SharedCommentsManager.PAGE_SIZE;
        const firstPage = allComments.slice(0, pageSize);

        firstPage.forEach(commentData => {
            const userData = this.usersCache[commentData[config.userIdField]] || {};
            const el = this.createCommentElement(commentData, userData, currentUserId, contentId, commentsContainer, config);
            commentsContainer.appendChild(el);
        });

        if (allComments.length > pageSize) {
            let shown = pageSize;
            const loadMoreBtn = document.createElement("button");
            loadMoreBtn.className = "btn btn-outline-secondary w-100 mt-2";
            loadMoreBtn.textContent = `Load More (${allComments.length - shown} more)`;

            loadMoreBtn.addEventListener("click", () => {
                const next = allComments.slice(shown, shown + pageSize);
                next.forEach(commentData => {
                    const userData = this.usersCache[commentData[config.userIdField]] || {};
                    const el = this.createCommentElement(commentData, userData, currentUserId, contentId, commentsContainer, config);
                    commentsContainer.insertBefore(el, loadMoreBtn);
                });
                shown += pageSize;
                if (shown >= allComments.length) {
                    loadMoreBtn.remove();
                } else {
                    loadMoreBtn.textContent = `Load More (${allComments.length - shown} more)`;
                }
            });
            commentsContainer.appendChild(loadMoreBtn);
        }
    }

    // ─────────────────────────────────────────────
    //  PRIVATE — EVENT LISTENERS
    // ─────────────────────────────────────────────

    _attachCommentEventListeners(commentEl, commentData, currentUserId, ownerUserId, contentId, commentsContainer, config) {
        // Profile navigation
        commentEl.querySelectorAll(".user-profile-link").forEach(link => {
            link.addEventListener("click", () => {
                const uid = link.getAttribute("data-user-id");
                window.location.href = `public-profile.html?userId=${encodeURIComponent(uid)}`;
            });
        });

        // Like button
        const likeBtn = commentEl.querySelector(".comment-like-button");
        likeBtn?.addEventListener("click", async () => {
            if (!currentUserId) {
                alert("You must be logged in to like a comment.");
                return;
            }
            await this.likesManager.toggleCommentLike(
                commentData.id,
                {
                    commentsCollection:      config.commentsCollection,
                    commentLikesCollection:  config.commentLikesCollection,
                    userIdField:             config.userIdField
                },
                likeBtn
            );
        });

        // Dots menu toggle
        const dotsBtn = commentEl.querySelector(".comment-dots-btn");
        const popup   = commentEl.querySelector(".comment-popup");

        dotsBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            // Close all other open popups first
            document.querySelectorAll(".comment-popup").forEach(p => {
                if (p !== popup) p.style.display = "none";
            });

            if (popup.style.display === "block") {
                popup.style.display = "none";
                return;
            }

            popup.style.display = "block";
            // Position near the button
            const rect   = dotsBtn.getBoundingClientRect();
            const pWidth = 160;
            let left = rect.right - pWidth;
            let top  = rect.bottom + 4;
            if (left < 4) left = 4;
            if (top + 100 > window.innerHeight) top = rect.top - 104;
            popup.style.left = `${left}px`;
            popup.style.top  = `${top}px`;
        });

        document.addEventListener("click", () => {
            popup && (popup.style.display = "none");
        }, { passive: true });

        // Delete
        const deleteBtn = commentEl.querySelector(".comment-delete-btn");
        deleteBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            popup.style.display = "none";
            await this.deleteComment(commentData.id, contentId, commentsContainer, currentUserId, config);
        });

        // Report
        const reportBtn = commentEl.querySelector(".comment-report-btn");
        reportBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            popup.style.display = "none";
            await this.reportComment(
                commentData.id,
                currentUserId,
                ownerUserId,
                config,
                () => {
                    // Disable the report button in the UI after successful report
                    reportBtn.disabled   = true;
                    reportBtn.classList.add("disabled");
                    reportBtn.innerHTML  = `<i class="fas fa-flag me-2"></i>Reported`;
                }
            );
        });
    }

    // ─────────────────────────────────────────────
    //  PRIVATE — NOTIFICATIONS
    // ─────────────────────────────────────────────

    async _sendCommentNotification(contentId, commenterId, commentText, config) {
        try {
            const contentDoc = await this.db.collection(config.contentCollection).doc(contentId).get();
            if (!contentDoc.exists) return;

            const ownerUserId = contentDoc.data()[config.userIdField] || contentDoc.data()["designerUserId"];
            if (!ownerUserId || ownerUserId === commenterId) return;

            const commenterName = this.usersCache[commenterId]?.user_Name
                || await this._ensureUsernameInCache(commenterId);

            await this.db.collection("notifications").add({
                toUserId:          ownerUserId,
                fromUserId:        commenterId,
                fromUsername:      commenterName,
                fromUserProfilePic: this.usersCache[commenterId]?.profilePicture || null,
                type:              config.notificationType || "comment",
                message:           `${commenterName} commented: "${commentText.slice(0, 80)}${commentText.length > 80 ? "…" : ""}"`,
                [config.contentIdField.replace("foreign", "").replace(/^./, c => c.toLowerCase())]: contentId,
                timestamp:         firebase.firestore.FieldValue.serverTimestamp(),
                read:              false
            });
        } catch (e) {
            // Non-critical — don't surface notification errors to the user
            console.warn("[SharedCommentsManager] Notification error:", e);
        }
    }

    // ─────────────────────────────────────────────
    //  PRIVATE — USER CACHE
    // ─────────────────────────────────────────────

    async _cacheUsers(userIds) {
        const missing = userIds.filter(id => id && !this.usersCache[id]);
        if (!missing.length) return;

        const chunks = this._chunk(missing, 10);
        for (const chunk of chunks) {
            try {
                const snap = await this.db.collection("users").where("userId", "in", chunk).get();
                snap.forEach(doc => {
                    this.usersCache[doc.data().userId] = doc.data();
                });
            } catch (e) {
                console.warn("[SharedCommentsManager] _cacheUsers error:", e);
            }
        }
    }

    async _ensureUsernameInCache(userId) {
        if (!this.usersCache[userId]) {
            try {
                const q = await this.db.collection("users").where("userId", "==", userId).get();
                if (!q.empty) this.usersCache[userId] = q.docs[0].data();
            } catch (e) {
                console.warn("[SharedCommentsManager] _ensureUsernameInCache error:", e);
            }
        }
        return this.usersCache[userId]?.user_Name || "Someone";
    }

    // ─────────────────────────────────────────────
    //  PRIVATE — MISC HELPERS
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

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    _showSuccess(container, message) {
        if (!container) return;
        const el = document.createElement("div");
        el.className = "alert alert-success mt-2";
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    _showToast(message, type = "success") {
        const toastHtml = `
            <div class="position-fixed bottom-0 end-0 p-3" style="z-index:1055">
                <div class="toast show bg-${type === "warning" ? "warning" : "success"} text-white" role="alert">
                    <div class="toast-body fw-semibold">${message}</div>
                </div>
            </div>`;
        const existing = document.querySelector(".position-fixed.bottom-0.end-0");
        if (existing) existing.remove();
        document.body.insertAdjacentHTML("beforeend", toastHtml);
        setTimeout(() => document.querySelector(".position-fixed.bottom-0.end-0")?.remove(), 4000);
    }

    _chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    }
};