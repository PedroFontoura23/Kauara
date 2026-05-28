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

    static MAX_COMMENT_LENGTH    = 500;
    static PAGE_SIZE             = 8;
    static MAX_IMAGE_BYTES       = 1.5 * 1024 * 1024; // 1.5 MB cap after compression
    static COMMENT_IMAGE_WIDTH   = 800;               // max output width (px)
    static COMMENT_IMAGE_HEIGHT  = 600;               // max output height (px)
    static COMMENT_IMAGE_DISPLAY = 240;               // fixed display height (px)

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

        // ID of the comment we just posted — used to scroll-to after onSnapshot fires
        this._pendingScrollId   = null;

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
     * Submit a new comment, optionally with an image.
     *
     * @param {string}          contentId
     * @param {HTMLInputElement} commentInput
     * @param {HTMLElement}     commentsContainer
     * @param {object}          config
     * @param {Function}        [getCurrentUser]
     * @param {File|null}       [imageFile]       - Optional image file to attach.
     */
    async submitComment(contentId, commentInput, commentsContainer, config, getCurrentUser = null, imageFile = null) {
        if (this._submitting) return;
        this._submitting = true;

        const rawText = commentInput?.value?.trim() ?? "";

        if (!rawText && !imageFile) {
            alert("Please enter a comment or attach an image.");
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
            let imageData = null;
            if (imageFile) {
                try {
                    imageData = await this._compressImage(imageFile);
                } catch (imgErr) {
                    alert(imgErr.message || "Failed to process image. Please try a different file.");
                    this._submitting = false;
                    if (submitButton) {
                        commentInput.disabled    = false;
                        submitButton.disabled    = false;
                        submitButton.textContent = "Post";
                    }
                    return;
                }
            }

            const commentData = {
                [config.userIdField]:    userId,
                [config.contentIdField]: contentId,
                content:                 rawText,
                timestamp:               firebase.firestore.FieldValue.serverTimestamp(),
                likes_count:             0,
                reports_count:           0,
                reports:                 {}
            };
            if (imageData) commentData.imageData = imageData;

            const docRef = await this.db.collection(config.commentsCollection).add(commentData);
            this._pendingScrollId = docRef.id;

            await this._sendCommentNotification(contentId, userId, rawText || "📷 Image", config);

            commentInput.value = "";
            // Reset image preview without destroying the element
            const inputContainer = commentsContainer?.parentElement;
            if (inputContainer) {
                const preview   = inputContainer.querySelector('.comment-img-preview');
                const fileInput = inputContainer.querySelector('.comment-img-input');
                const thumb     = inputContainer.querySelector('.comment-img-preview-thumb');
                if (preview)   { preview.style.display = 'none'; }
                if (thumb)     { thumb.src = ''; }
                if (fileInput) { fileInput.value = ''; }
            }
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
    //  RENDER COMMENT INPUT
    // ─────────────────────────────────────────────

    /**
     * Build and inject a comment input row (text + image attach + post button)
     * into `container`, then wire up all events.
     *
     * Replaces any hand-rolled .input-group inside `container`.
     *
     * @param {HTMLElement} container     - The .comment-input-container element.
     * @param {string}      contentId
     * @param {HTMLElement} commentsContainer
     * @param {object}      config
     * @param {Function}    [getCurrentUser]
     */
    renderCommentInput(container, contentId, commentsContainer, config, getCurrentUser = null) {
        container.innerHTML = `
            <div class="input-group">
                <input type="text" class="form-control comment-input"
                       placeholder="Write a comment..."
                       style="font-size:16px;min-height:44px;">
                <label class="btn btn-outline-secondary comment-img-btn" title="Attach image"
                       style="min-height:44px;padding:8px 12px;cursor:pointer;display:flex;align-items:center;">
                    <i class="fas fa-image"></i>
                    <input type="file" class="comment-img-input" accept="image/*"
                           style="display:none;" aria-label="Attach image">
                </label>
                <button class="btn btn-outline-primary comment-submit"
                        style="min-height:44px;padding:8px 14px;">Post</button>
            </div>
            <div class="comment-img-preview" style="display:none;margin-top:8px;">
                <div style="
                    position:relative;
                    display:inline-block;
                    border-radius:10px;
                    overflow:hidden;
                    border:1.5px solid #dee2e6;
                    background:#f8f9fa;
                    max-width:220px;
                ">
                    <img class="comment-img-preview-thumb"
                         style="display:block;width:220px;height:140px;object-fit:cover;">
                    <div style="
                        padding:6px 10px;
                        display:flex;
                        align-items:center;
                        justify-content:space-between;
                        gap:8px;
                        background:#fff;
                        border-top:1px solid #dee2e6;
                    ">
                        <div style="min-width:0;">
                            <div class="comment-img-preview-name"
                                 style="font-size:0.78rem;font-weight:500;color:#212529;
                                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                                        max-width:150px;"></div>
                            <div class="comment-img-preview-size"
                                 style="font-size:0.72rem;color:#6c757d;"></div>
                        </div>
                        <button class="comment-img-clear"
                                title="Remove image"
                                style="background:none;border:none;padding:2px;cursor:pointer;
                                       color:#adb5bd;line-height:1;flex-shrink:0;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                                 fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>`;

        const commentInput = container.querySelector('.comment-input');
        const submitBtn    = container.querySelector('.comment-submit');
        const imgInput     = container.querySelector('.comment-img-input');
        const imgPreview   = container.querySelector('.comment-img-preview');
        const imgThumb     = container.querySelector('.comment-img-preview-thumb');
        const imgName      = container.querySelector('.comment-img-preview-name');
        const imgSize      = container.querySelector('.comment-img-preview-size');
        const imgClear     = container.querySelector('.comment-img-clear');

        const showPreview = (file) => {
            imgName.textContent = file.name;
            imgSize.textContent = file.size > 1024 * 1024
                ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.round(file.size / 1024)} KB`;
            const reader = new FileReader();
            reader.onload = e => {
                imgThumb.src = e.target.result;
                imgPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        };

        const clearPreview = () => {
            imgInput.value   = '';
            imgThumb.src     = '';
            imgPreview.style.display = 'none';
        };

        imgInput.addEventListener('change', () => {
            const file = imgInput.files?.[0];
            if (file) showPreview(file);
        });

        imgClear.addEventListener('click', clearPreview);

        const doSubmit = () => {
            const imageFile = imgInput.files?.[0] || null;
            this.submitComment(contentId, commentInput, commentsContainer, config, getCurrentUser, imageFile);
        };
        submitBtn.addEventListener('click', doSubmit);
        commentInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
        });
    }

    // ─────────────────────────────────────────────
    //  COMPRESS IMAGE
    // ─────────────────────────────────────────────

    /**
     * Resize and compress an image File to a safe base64 JPEG string.
     * - Scales down to fit within COMMENT_IMAGE_WIDTH × COMMENT_IMAGE_HEIGHT.
     * - Small images are scaled UP to fill that box.
     * - Output is capped at MAX_IMAGE_BYTES; quality is reduced iteratively if needed.
     * - Rejects non-image files and files that cannot be compressed small enough.
     *
     * @param {File} file
     * @returns {Promise<string>} base64 JPEG data URL string (without the data: prefix)
     */
    _compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) {
                return reject(new Error("Only image files are allowed."));
            }

            // Hard-reject files larger than 50 MB before even reading them
            if (file.size > 50 * 1024 * 1024) {
                return reject(new Error("Image is too large (max 50 MB input)."));
            }

            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Failed to read image file."));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error("Invalid or corrupt image."));
                img.onload = () => {
                    const maxW = SharedCommentsManager.COMMENT_IMAGE_WIDTH;
                    const maxH = SharedCommentsManager.COMMENT_IMAGE_HEIGHT;

                    // Scale to fit/fill the box (both up and down)
                    const ratio = Math.min(maxW / img.width, maxH / img.height);
                    const outW  = Math.round(img.width  * ratio);
                    const outH  = Math.round(img.height * ratio);

                    const canvas = document.createElement('canvas');
                    canvas.width  = outW;
                    canvas.height = outH;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, outW, outH);

                    // Iteratively reduce quality until under the byte cap
                    let quality   = 0.85;
                    let dataUrl   = canvas.toDataURL('image/jpeg', quality);
                    const cap     = SharedCommentsManager.MAX_IMAGE_BYTES;

                    while (quality > 0.1) {
                        // base64 string length * 0.75 ≈ byte size
                        const approxBytes = (dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75;
                        if (approxBytes <= cap) break;
                        quality  -= 0.1;
                        dataUrl   = canvas.toDataURL('image/jpeg', quality);
                    }

                    const finalBytes = (dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75;
                    if (finalBytes > cap) {
                        return reject(new Error("Image could not be compressed small enough. Please use a smaller image."));
                    }

                    // Return only the base64 payload (after the comma)
                    resolve(dataUrl.split(',')[1]);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
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

        const imageHtml = commentData.imageData
            ? `<div class="comment-img-wrap mt-1">
                   <img src="data:image/jpeg;base64,${commentData.imageData}"
                        alt="Comment image"
                        class="comment-img"
                        style="height:${SharedCommentsManager.COMMENT_IMAGE_DISPLAY}px;
                               width:auto;max-width:100%;
                               object-fit:cover;border-radius:8px;
                               cursor:pointer;display:block;"
                        onerror="this.style.display='none'">
               </div>`
            : '';

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
                ${commentData.content ? `<span class="text-break">${this._escapeHtml(commentData.content)}</span>` : ''}
                ${imageHtml}
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

        const pageSize  = SharedCommentsManager.PAGE_SIZE;
        const firstPage = allComments.slice(0, pageSize);

        firstPage.forEach(commentData => {
            const userData = this.usersCache[commentData[config.userIdField]] || {};
            const el = this.createCommentElement(commentData, userData, currentUserId, contentId, commentsContainer, config);
            commentsContainer.appendChild(el);
        });

        // Scroll to and flash-highlight the comment we just posted
        if (this._pendingScrollId) {
            const target = commentsContainer.querySelector(`[data-comment-id="${this._pendingScrollId}"]`);
            if (target) {
                this._pendingScrollId = null;
                requestAnimationFrame(() => {
                    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    target.style.transition = 'background-color 0.2s ease';
                    target.style.backgroundColor = '#e8f4ff';
                    target.style.borderRadius = '6px';
                    setTimeout(() => {
                        target.style.backgroundColor = '';
                        setTimeout(() => { target.style.transition = ''; target.style.borderRadius = ''; }, 300);
                    }, 1400);
                });
            } else {
                // Comment not in first page — find and render it directly
                const pendingId = this._pendingScrollId;
                const pendingComment = allComments.find(c => c.id === pendingId);
                if (pendingComment) {
                    this._pendingScrollId = null;
                    const userData = this.usersCache[pendingComment[config.userIdField]] || {};
                    const el = this.createCommentElement(pendingComment, userData, currentUserId, contentId, commentsContainer, config);
                    // Insert before load-more button if present, else append
                    const loadMoreBtn = commentsContainer.querySelector('.btn-outline-secondary');
                    if (loadMoreBtn) commentsContainer.insertBefore(el, loadMoreBtn);
                    else commentsContainer.appendChild(el);
                    requestAnimationFrame(() => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        el.style.transition = 'background-color 0.2s ease';
                        el.style.backgroundColor = '#e8f4ff';
                        el.style.borderRadius = '6px';
                        setTimeout(() => {
                            el.style.backgroundColor = '';
                            setTimeout(() => { el.style.transition = ''; el.style.borderRadius = ''; }, 300);
                        }, 1400);
                    });
                }
            }
        }

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

        // Comment image — click to open fullscreen
        const commentImg = commentEl.querySelector(".comment-img");
        commentImg?.addEventListener("click", () => {
            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position:fixed;inset:0;background:rgba(0,0,0,0.88);
                display:flex;align-items:center;justify-content:center;
                z-index:2000;cursor:zoom-out;padding:16px;`;
            const full = document.createElement("img");
            full.src = commentImg.src;
            full.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;";
            overlay.appendChild(full);
            overlay.addEventListener("click", () => overlay.remove());
            document.body.appendChild(overlay);
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