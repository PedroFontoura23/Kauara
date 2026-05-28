// shared-notifications.js
// Centralized notification system for Kauara
// Usage: import and instantiate SharedNotifications in your page

class SharedNotifications {
  constructor({ auth, db, notificationButton, notificationDropdown, notificationList }) {
    this.auth = auth;
    this.db = db;
    this.notificationButton = notificationButton;
    this.notificationDropdown = notificationDropdown;
    this.notificationList = notificationList;
    this.listener = null;
    this._init();
  }

  _init() {
    if (!this.notificationButton || !this.notificationDropdown) return;
    if (this.notificationButton._sharedNotificationsAttached) {
      console.warn("[Notifications] Duplicate instantiation blocked. Call stack:", new Error().stack);
      return;
    }
    this.notificationButton._sharedNotificationsAttached = true;
    this.notificationButton.addEventListener("click", (event) => this._onButtonClick(event));
    document.addEventListener("click", (event) => {
      if (!this.notificationButton.contains(event.target) && !this.notificationDropdown.contains(event.target)) {
        this.notificationDropdown.style.display = "none";
      }
    });
    if (this.auth) {
      this.auth.onAuthStateChanged((user) => this._onAuthStateChanged(user));
    }
  }

  async _onButtonClick(event) {
    event.stopPropagation();
    console.log("[Notifications] Button clicked", new Date().toISOString());
    const isHidden = this.notificationDropdown.style.display === "none" || this.notificationDropdown.style.display === "";
    if (isHidden) {
      this.notificationDropdown.style.display = "block";
      await this._renderNotifications();
    } else {
      this.notificationDropdown.style.display = "none";
    }
  }

  async _renderNotifications() {
    try {
      const user = this.auth.currentUser;
      if (!user) return;
      const userId = await this._getUserIdFromUid(user.uid);
      const notificationsRef = this.db.collection('notifications')
        .where('toUserId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(50);
      const snapshot = await notificationsRef.get();
      this.notificationList.innerHTML = '';
      const batch = this.db.batch();
      const unreadIds = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const isUnread = !data.read;
        if (isUnread) {
          unreadIds.push(doc.id);
          batch.update(this.db.collection('notifications').doc(doc.id), {
            read: true,
            readAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        this.notificationList.appendChild(this._createNotificationItem(data, isUnread));
      });
      if (snapshot.empty) {
        this.notificationList.innerHTML = '<li class="list-group-item text-muted">No notifications yet</li>';
      }
      if (unreadIds.length > 0) {
        await batch.commit();
        this._updateNotificationBadge();
      }
    } catch (error) {
      console.error("Error loading notifications:", error);
      this.notificationList.innerHTML = '<li class="list-group-item text-danger">Error loading notifications</li>';
    }
  }

  _createNotificationItem(data, isUnread) {
    const username = data.fromUsername || "User";

    // ── Resolve content type ─────────────────────────────────────────────────
    // For legacy docs that only have 'like' or 'comment', sniff the correct
    // content type from whichever ID field is present. Also re-sniff explicit
    // types to catch mismatches (e.g. type='like' saved without productId, or
    // type='post_like' when a productId is actually present).
    let resolvedType = data.type;
    const isGenericOrMissing = !resolvedType || resolvedType === 'like' || resolvedType === 'comment';
    const isGenericLike = isGenericOrMissing && resolvedType !== 'comment';
    const isComment = resolvedType === 'comment' || resolvedType?.endsWith('_comment');

    // Always re-sniff from ID fields — they are the source of truth
    if (data.productId)           resolvedType = isComment ? 'product_comment'       : 'product_like';
    else if (data.artId)          resolvedType = isComment ? 'art_comment'           : 'art_like';
    else if (data.candidateArtId) resolvedType = isComment ? 'candidate_art_comment' : 'candidate_art_like';
    else if (data.postId || isGenericOrMissing) {
      // Only fall back to post_* if we have a postId OR no other ID was found
      resolvedType = isComment ? 'post_comment' : 'post_like';
    }
    // If none of the above matched, keep the original data.type (e.g. already a
    // fully-qualified type like 'art_like' with no artId — trust it as-is)

    // ── Build action text + emoji label ──────────────────────────────────────
    let actionText;
    let contentLabel;

    switch (resolvedType) {
      case 'post_like':
        actionText   = data.commentId ? 'liked your comment' : 'liked your post';
        contentLabel = '📝';
        break;
      case 'post_comment':
      case 'comment': {
        const text = data.message?.includes(':') ? data.message.split(':').slice(1).join(':').trim() : (data.message || '');
        actionText   = 'commented: ' + text;
        contentLabel = '📝';
        break;
      }
      case 'product_like':
        actionText   = data.commentId ? 'liked your comment on your product' : 'liked your product';
        contentLabel = '🛍️';
        break;
      case 'product_comment': {
        const text = data.message?.includes(':') ? data.message.split(':').slice(1).join(':').trim() : (data.message || '');
        actionText   = 'commented on your product: ' + text;
        contentLabel = '🛍️';
        break;
      }
      case 'art_like':
        actionText   = data.commentId ? 'liked your comment on your art' : 'liked your art';
        contentLabel = '🎨';
        break;
      case 'art_comment': {
        const text = data.message?.includes(':') ? data.message.split(':').slice(1).join(':').trim() : (data.message || '');
        actionText   = 'commented on your art: ' + text;
        contentLabel = '🎨';
        break;
      }
      case 'candidate_art_like':
        actionText   = data.commentId ? 'liked your comment on your artwork' : 'liked your artwork';
        contentLabel = '🏆';
        break;
      case 'candidate_art_comment': {
        const text = data.message?.includes(':') ? data.message.split(':').slice(1).join(':').trim() : (data.message || '');
        actionText   = 'commented on your artwork: ' + text;
        contentLabel = '🏆';
        break;
      }
      default:
        actionText   = data.message || 'interacted with your content';
        contentLabel = '🔔';
    }

    // ── Build destination link ───────────────────────────────────────────────
    let href = '#';
    if (data.productId)        href = `product.html?productId=${encodeURIComponent(data.productId)}`;
    else if (data.artId)       href = `art.html?artId=${encodeURIComponent(data.artId)}`;
    else if (data.postId)      href = `post.html?postId=${encodeURIComponent(data.postId)}`;
    else if (data.candidateArtId) href = `candidatos.html?artId=${encodeURIComponent(data.candidateArtId)}`;

    const item = document.createElement('a');
    item.href = href;
    item.className = `list-group-item list-group-item-action ${isUnread ? 'unread-notification' : ''}`;
    item.innerHTML = `
      <div class="d-flex align-items-center">
        <img src="${data.fromUserProfilePic ? `data:image/jpeg;base64,${data.fromUserProfilePic}` : '../images/default-profile.png'}"
             class="rounded-circle me-2" width="32" height="32" style="object-fit: cover;"
             onerror="this.onerror=null; this.src='../images/default-profile.png'" alt="${username}'s profile">
        <div class="flex-grow-1">
          <div class="notification-message">
            <strong>${username}</strong> ${actionText}
            <span class="ms-1">${contentLabel}</span>
          </div>
          <small class="text-muted">${this._formatTimestamp(data.timestamp)}</small>
        </div>
        ${isUnread ? '<span class="unread-dot bg-primary rounded-circle" style="width: 8px; height: 8px;"></span>' : ''}
      </div>
    `;
    return item;
  }

  async _getUserIdFromUid(uid) {
    const userQuery = await this.db.collection("users").where("firebaseUID", "==", uid).get();
    if (!userQuery.empty) {
      return userQuery.docs[0].id;
    } else {
      throw new Error(`No user found for UID: ${uid}`);
    }
  }

  _formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    const now = new Date();
    const diffInHours = Math.abs(now - date) / 36e5;
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  async _updateNotificationBadge() {
    const user = this.auth.currentUser;
    if (!user) {
      this._removeNotificationBadge();
      return;
    }
    try {
      const userId = await this._getUserIdFromUid(user.uid);
      const snapshot = await this.db.collection('notifications')
        .where('toUserId', '==', userId)
        .where('read', '==', false)
        .get();
      this._removeNotificationBadge();
      if (snapshot.size > 0) {
        const badge = document.createElement('span');
        badge.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger';
        badge.style.fontSize = '0.6rem';
        badge.style.padding = '3px 6px';
        badge.textContent = snapshot.size;
        this.notificationButton.appendChild(badge);
        this.notificationButton.style.position = 'relative';
      }
    } catch (error) {
      console.error("Error updating notification badge:", error);
      this._removeNotificationBadge();
    }
  }

  _removeNotificationBadge() {
    const existingBadge = this.notificationButton.querySelector('.badge');
    if (existingBadge) {
      this.notificationButton.removeChild(existingBadge);
    }
  }

  _onAuthStateChanged(user) {
    if (this.listener) this.listener();
    if (user) {
      this._updateNotificationBadge();
      this._getUserIdFromUid(user.uid).then(userId => {
        this.listener = this.db.collection('notifications')
          .where('toUserId', '==', userId)
          .where('read', '==', false)
          .onSnapshot(() => {
            if (this.notificationDropdown.style.display === 'none') this._updateNotificationBadge();
          }, error => console.error("Notification listener error:", error));
      });
    } else {
      this._removeNotificationBadge();
    }
  }
}

// Export for use in other scripts
window.SharedNotifications = SharedNotifications;