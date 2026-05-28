const db   = firebase.firestore();
const auth = firebase.auth();
const likesManager = new SharedLikesManager(db, auth);

const urlParams     = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

// DOM Elements
const userNameElement       = document.getElementById("userName");
const userEmailElement      = document.getElementById("userEmail");
const userBioElement        = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer       = document.getElementById("ratingContainer");

let currentUserId   = null;
let _postManager       = null;
let _artManager        = null;
let _productManager    = null;
let _candidatoManager  = null;

// ─── Auth (paralelo, não bloqueia o load) ─────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const q = await db.collection("users").where("firebaseUID", "==", user.uid).limit(1).get();
            currentUserId = !q.empty ? q.docs[0].id : null;
        } catch (e) {
            console.error('Error resolving current user ID:', e);
            currentUserId = null;
        }
    } else {
        currentUserId = null;
    }
});

async function resolveCurrentFirestoreUserId() {
    if (currentUserId) return currentUserId;
    const user = auth.currentUser;
    if (!user) return null;
    try {
        const q = await db.collection("users").where("firebaseUID", "==", user.uid).limit(1).get();
        if (q.empty) return null;
        currentUserId = q.docs[0].id;
        return currentUserId;
    } catch (error) {
        console.error('Error resolving firestore user id:', error);
        return null;
    }
}

function updateSharedLikeButton(button, liked) {
    if (!button) return;
    button.classList.toggle('btn-primary', liked);
    button.classList.toggle('btn-outline-primary', !liked);
    const label = button.querySelector('.profile-like-text');
    if (label) label.textContent = liked ? '♥ Liked' : '♥ Like';
}

async function setupProfileLikeButton(profileUserId, button) {
    if (!button) return;

    const baseConfig = {
        collection: 'users',
        likesCollection: 'user_likes',
        userIdField: 'userId',
        contentIdField: 'profileUserId',
    };

    const liked = await likesManager.loadLikeState(profileUserId, baseConfig, async () => {
        const resolvedId = await resolveCurrentFirestoreUserId();
        return resolvedId ? { firestoreUserId: resolvedId } : null;
    });

    updateSharedLikeButton(button, liked);

    button.addEventListener('click', async () => {
        const firestoreUserId = await resolveCurrentFirestoreUserId();
        if (!firestoreUserId) {
            alert('Please log in to like this profile.');
            return;
        }

        // Fetch current user's name and pic at click time for the notification
        const currentUserDoc = await db.collection("users").doc(firestoreUserId).get();
        const currentUserData = currentUserDoc.exists ? currentUserDoc.data() : {};
        const fromUsername = currentUserData.user_Name || "Someone";
        const profilePic = currentUserData.profilePicture || null;

        const config = {
            ...baseConfig,
            notifyConfig: {
                toUserId: profileUserId,
                fromUsername,
                profilePic,
                type: 'profile_like',
                message: 'liked your profile'
            }
        };

        await likesManager.toggleLike(profileUserId, config, button, async () => ({ firestoreUserId }));
        const nowLiked = likesManager.hasUserLikedContent(profileUserId, firestoreUserId);
        updateSharedLikeButton(button, nowLiked);
    });
}

function renderSharedRating(profileUserId, userData) {
    const likes = Number(userData.likes_count || 0);
    const isOwnProfile = profileUserId === currentUserId;
    ratingContainer.innerHTML = `
        <div class="shared-rating-card text-center p-3 border rounded">
            <h4>Shared Rating</h4>
            <p class="mb-2">♥ <strong>${likes}</strong> Likes</p>
            ${isOwnProfile ? '<p class="text-muted mb-0">This is your shared rating.</p>' : '<button id="profileLikeButton" class="btn btn-outline-primary btn-sm"><span class="profile-like-text">♥ Like</span> <span class="like-count">' + likes + '</span></button>'}
        </div>
    `;

    if (!isOwnProfile) {
        const likeButton = document.getElementById('profileLikeButton');
        setupProfileLikeButton(profileUserId, likeButton);
    }
}

// ─── Managers (instanciados uma vez) ─────────────────────────────────────────
function getPostManager() {
    if (!_postManager && typeof PostManager !== 'undefined')
        _postManager = new PostManager(db, auth, "postsContainer");
    return _postManager;
}
function getArtManager() {
    if (!_artManager && typeof ArtManager !== 'undefined')
        _artManager = new ArtManager(db, auth, "artsContainer");
    return _artManager;
}
function getProductManager() {
    if (!_productManager && typeof ProductManagerDimona !== 'undefined')
        _productManager = new ProductManagerDimona(db, auth, "productsContainer");
    return _productManager;
}
function getCandidatoManager() {
    if (!_candidatoManager && typeof window.CandidatoManager !== 'undefined')
        _candidatoManager = new window.CandidatoManager(db, auth, firebase.storage(), "candidatoArtsContainer");
    return _candidatoManager;
}

// ─── Load profile ─────────────────────────────────────────────────────────────
async function loadProfileData() {
    if (!userIdFromUrl) { showError("No user specified"); return; }

    try {
        // 1. Busca user + contact em paralelo (era sequencial antes)
        const [userDoc, contactSnap] = await Promise.all([
            db.collection("users").doc(userIdFromUrl).get(),
            db.collection("contact").where("foreignUserId", "==", userIdFromUrl).get()
        ]);

        if (!userDoc.exists) { showError("User not found"); return; }

        const userData = userDoc.data();

        // 2. Pinta UI imediatamente
        userNameElement.textContent = userData.user_Name || "No Name Available";
        userBioElement.textContent  = userData.user_Bio  || "No bio available";
        profilePictureElement.src   = userData.profilePicture
            ? `data:image/jpeg;base64,${userData.profilePicture}`
            : "../images/default-profile.png";

        if (!contactSnap.empty) {
            userEmailElement.textContent = contactSnap.docs[0].data().contactEmail || "No Email Available";
        }

        // 3. Shared Rating
        renderSharedRating(userIdFromUrl, userData);

        // 5. Todo o conteúdo em paralelo
        const pm = getPostManager();
        const am = getArtManager();
        const dm = getProductManager();

        const cm = getCandidatoManager();
        Promise.allSettled([
            pm ? pm.displayPosts(userIdFromUrl, currentUserId)    : Promise.resolve(),
            am ? am.displayArts(userIdFromUrl, currentUserId)     : Promise.resolve(),
            dm ? dm.displayProducts(userIdFromUrl, currentUserId) : Promise.resolve(),
            cm ? cm.displayArts(userIdFromUrl)                    : Promise.resolve(),
        ]);

    } catch (error) {
        console.error("Error loading profile:", error);
        showError("Error loading profile");
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Aguarda o evento load para garantir que shared-firebase-init.js e outros scripts estejam prontos.
if (document.readyState === 'complete') {
    loadProfileData();
} else {
    window.addEventListener('load', loadProfileData, { once: true });
}

// visibilitychange só recarrega se a página ainda não tinha carregado
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && userIdFromUrl) loadProfileData();
});