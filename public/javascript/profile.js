document.addEventListener("DOMContentLoaded", function () {
  // ================================
  // 1. FIREBASE INITIALIZATION
  // ================================
  const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S",
  };
  
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // ================================
  // 2. GLOBAL VARIABLES & STATE
  // ================================
  // Managers (instantiated once, reused across functions)
  let _postManager = null;
  let _artManager = null;
  let _productManager = null;
  let _candidatoManager = null;

  // State variables
  let selectedImageFile = null;
  let cropper = null;
  let postCropper = null;

  // Modal references
  let cropModal, postModal, postCropModal;

  // UID cache
  const _uidCache = new Map();

  // Constants
  const MAX_IMAGE_SIZE_MB = 5;
  const MAX_DIMENSION = 1200;
  const JPEG_QUALITY = 0.7;

  // ================================
  // 3. HELPER FUNCTIONS
  // ================================
  
  // Skeleton shimmer (shown immediately during Firebase cold-start)
  (function showSkeleton() {
    const style = document.createElement("style");
    style.textContent = `
      .skeleton { background: linear-gradient(90deg,#e0e0e0 25%,#f5f5f5 50%,#e0e0e0 75%);
                  background-size: 200% 100%; animation: shimmer 1.2s infinite;
                  border-radius: 4px; color: transparent !important; }
      @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    `;
    document.head.appendChild(style);
    ["userName", "userEmail", "userBio", "averageRating"].forEach(id => {
      document.getElementById(id)?.classList.add("skeleton");
    });
    const pic = document.getElementById("profilePicture");
    if (pic) pic.style.opacity = "0.3";
  })();

  function removeSkeleton() {
    document.querySelectorAll(".skeleton").forEach(el => el.classList.remove("skeleton"));
    const pic = document.getElementById("profilePicture");
    if (pic) pic.style.opacity = "";
  }

  // Firestore persistence (enabled once per session)
  if (!sessionStorage.getItem('_firestorePersistenceEnabled')) {
    db.enablePersistence({ synchronizeTabs: true })
      .then(() => {
        sessionStorage.setItem('_firestorePersistenceEnabled', '1');
      })
      .catch((err) => {
        if (err.message && err.message.includes('newer version')) {
          try { indexedDB.deleteDatabase('firestore/[DEFAULT]/kauara1/main'); } catch (_) { }
        }
        sessionStorage.setItem('_firestorePersistenceEnabled', '1');
      });
  }

  // UID to Firestore ID resolver with caching
  async function getUserIdFromUid(uid) {
    if (_uidCache.has(uid)) return _uidCache.get(uid);
    const snap = await db.collection("users").where("firebaseUID", "==", uid).limit(1).get();
    if (snap.empty) throw new Error("User not found.");
    const id = snap.docs[0].id;
    _uidCache.set(uid, id);
    return id;
  }

  // Script readiness gate (prevents race conditions with shared scripts)
  const scriptsReady = new Promise(resolve => {
    if (document.readyState === "complete") { resolve(); return; }
    window.addEventListener("load", resolve, { once: true });
  });

  // Image compression utility
  async function compressImage(imageFile) {
    const fileSizeMB = imageFile.size / (1024 * 1024);
    if (fileSizeMB > MAX_IMAGE_SIZE_MB) throw new Error(`Image must be < ${MAX_IMAGE_SIZE_MB} MB`);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width > height) {
              height = (height / width) * MAX_DIMENSION;
              width = MAX_DIMENSION;
            } else {
              width = (width / height) * MAX_DIMENSION;
              height = MAX_DIMENSION;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          const b64 = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          const finalMB = (b64.length * 3) / 4 / (1024 * 1024);
          if (finalMB > MAX_IMAGE_SIZE_MB) reject(new Error(`Compressed image still too large (${finalMB.toFixed(2)} MB)`));
          else resolve(b64);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }

  // Apply user shared rating to UI
  function applyUserRatings(userData) {
    const likes = userData?.likes_count ?? 0;
    const avgEl = document.getElementById("averageRating");
    const cntEl = document.getElementById("numberOfRatings");
    if (avgEl) avgEl.textContent = `♥ ${likes}`;
    if (cntEl) cntEl.textContent = `(${likes} ${likes === 1 ? "like" : "likes"})`;
  }

  // Account deletion helpers
  async function reauthenticateUser(user) {
    const providerId = user.providerData[0]?.providerId;
    if (providerId === "password") {
      const password = prompt("Please re-enter your password to confirm account deletion:");
      if (!password) throw new Error("Reauthentication canceled.");
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
      await user.reauthenticateWithCredential(credential);
    } else {
      throw new Error("Reauthentication for this provider is not implemented.");
    }
  }

  async function deleteUserAccountAndPosts(user) {
    try {
      await reauthenticateUser(user);
      const firestoreUserId = await getUserIdFromUid(user.uid);

      async function safeDeleteCollection(col, field, val) {
        const snap = await db.collection(col).where(field, "==", val).get();
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      await safeDeleteCollection("comment_likes", "foreignUserId", firestoreUserId);
      await safeDeleteCollection("comments", "foreignUserId", firestoreUserId);
      await safeDeleteCollection("likes", "foreignUserId", firestoreUserId);
      await safeDeleteCollection("product_ratings", "RaterForeignUserId", firestoreUserId);
      await safeDeleteCollection("ratings", "raterUid", user.uid);
      await safeDeleteCollection("products", "userId", firestoreUserId);

      const postsSnap = await db.collection("posts").where("foreignUserId", "==", firestoreUserId).get();
      if (!postsSnap.empty) {
        for (const postDoc of postsSnap.docs) {
          await safeDeleteCollection("comments", "foreignPostId", postDoc.id);
          await safeDeleteCollection("likes", "postId", postDoc.id);
          await postDoc.ref.delete();
        }
      }

      const contactId = `contact_${firestoreUserId.split("_")[1]}`;
      const contactDoc = await db.collection("contact").doc(contactId).get();
      if (contactDoc.exists) await db.collection("contact").doc(contactId).delete();

      await db.collection("users").doc(firestoreUserId).delete();
      await user.delete();
      await auth.signOut();
      alert("Your account and all associated data have been deleted.");
      window.location.href = "inicio.html";
    } catch (err) {
      console.error("Account deletion error:", err.code || err.message);
      alert("Failed to delete account. Please try again.");
      throw err;
    }
  }

  // ================================
  // 4. MANAGER INITIALIZATION
  // ================================
  async function initCandidatoManager() {
    await scriptsReady;
    if (!_candidatoManager && typeof window.CandidatoManager !== "undefined") {
      _candidatoManager = new window.CandidatoManager(db, auth, firebase.storage(), "candidatoArtsContainer");
    }
    return _candidatoManager;
  }

  // ================================
  // 5. DISPLAY FUNCTIONS
  // ================================
  async function displayPosts(firestoreUserId) {
    if (!firestoreUserId) return;
    await scriptsReady;
    if (typeof PostManager === "undefined") { console.error("PostManager not available"); return; }
    if (!_postManager) _postManager = new PostManager(db, auth, "allPostsContainer");
    _postManager.displayPosts(firestoreUserId, firestoreUserId);
  }

  async function displayArt(firestoreUserId) {
    if (!firestoreUserId) return;
    await scriptsReady;
    if (typeof ArtManager === "undefined") { console.error("ArtManager not available"); return; }
    if (!_artManager) _artManager = new ArtManager(db, auth, "artContainer");
    _artManager.displayArts(firestoreUserId, firestoreUserId);
  }

  async function displayProducts(firestoreUserId) {
    if (!firestoreUserId) return;
    await scriptsReady;
    if (typeof ProductManagerDimona === "undefined") { console.error("ProductManager not available"); return; }
    if (!_productManager) _productManager = new ProductManagerDimona(db, auth, "productsContainer");
    _productManager.displayProducts(firestoreUserId, firestoreUserId);
  }

  async function displayCandidatoArts(firestoreUserId) {
    if (!firestoreUserId) return;
    const manager = await initCandidatoManager();
    if (!manager) { console.error("CandidatoManager not available"); return; }
    manager.displayArts(firestoreUserId);
  }

  function displayAllContent(firestoreUserId) {
    Promise.allSettled([
      displayPosts(firestoreUserId),
      displayArt(firestoreUserId),
      displayProducts(firestoreUserId),
      displayCandidatoArts(firestoreUserId),
    ]);
  }

  // ================================
  // 6. POST CREATION FUNCTIONS
  // ================================
  async function savePostToFirestore(text, base64Image, userId) {
    if (!userId) { alert("User ID is missing."); return; }
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || !userDoc.data().artista) {
      alert("Achei o espertinho. Só artistas podem fazer posts.");
      return;
    }
    if (!text && !base64Image) { alert("Please add some text or an image."); return; }
    try {
      await db.collection("posts").add({
        foreignUserId: userId,
        Firebase_UID: firebase.auth().currentUser.uid,
        postText: text.trim() || "No content provided",
        postImage: base64Image,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (postModal) postModal.hide();
      if (postText) postText.value = "";
      if (postImageInput) postImageInput.value = "";
      if (postImagePreview) postImagePreview.classList.add("d-none");
      selectedImageFile = null;
      if (postCropper) { postCropper.destroy(); postCropper = null; }
      alert("Post successfully created!");
      displayPosts(userId);
    } catch (err) {
      console.error("Error adding post:", err);
      alert("Failed to create post.");
    }
  }

  // ================================
  // 7. DOM ELEMENT REFERENCES
  // ================================
  const userNameElement = document.getElementById("userName");
  const userEmailElement = document.getElementById("userEmail");
  const userBioElement = document.getElementById("userBio");
  const profilePictureElement = document.getElementById("profilePicture");
  const uploadPictureButton = document.getElementById("uploadPictureButton");
  const artistaBadge = document.getElementById("artistaBadge");
  const addPostButton = document.getElementById("addPostButton");
  const createProductButton = document.getElementById("createProductButton");
  const postText = document.getElementById("postText");
  const postImageInput = document.getElementById("postImageInput");
  const postImagePreview = document.getElementById("postImagePreview");
  const submitPostButton = document.getElementById("submitPostButton");
  const postCropImage = document.getElementById("cropPostImage");
  const postCropButton = document.getElementById("cropPostButton");

  // ================================
  // 8. MODAL INITIALIZATION
  // ================================
  try {
    const cropModalEl = document.getElementById("cropModal");
    const postModalEl = document.getElementById("postModal");
    const postCropModalEl = document.getElementById("cropPostModal");
    if (cropModalEl) cropModal = new bootstrap.Modal(cropModalEl);
    if (postModalEl) postModal = new bootstrap.Modal(postModalEl);
    if (postCropModalEl) postCropModal = new bootstrap.Modal(postCropModalEl);
  } catch (e) { console.error("Error initializing modals:", e); }

  // ================================
  // 9. EVENT LISTENERS
  // ================================
  
  // Auth state listener (single source of truth)
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;
    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      const userDoc = await db.collection("users").doc(firestoreUserId).get();
      if (!userDoc.exists) return;
      const userData = userDoc.data();

      // Paint text immediately
      if (userNameElement) userNameElement.textContent = userData.user_Name || "Unknown User";
      if (userEmailElement) userEmailElement.textContent = user.email || "No Email";
      if (userBioElement) userBioElement.textContent = userData.user_Bio || "No bio available.";

      // Defer profile picture loading
      if (profilePictureElement) {
        requestAnimationFrame(() => {
          profilePictureElement.src = userData.profilePicture
            ? `data:image/jpeg;base64,${userData.profilePicture}`
            : "../images/default-profile.png";
        });
      }

      const isArtist = !!userData.artista;
      if (addPostButton) addPostButton.style.display = isArtist ? "block" : "none";
      if (createProductButton) createProductButton.style.display = isArtist ? "block" : "none";
      if (artistaBadge) artistaBadge.style.display = isArtist ? "inline" : "none";

      applyUserRatings(userData);
      removeSkeleton();
      displayAllContent(firestoreUserId);
    } catch (err) {
      console.error("Error loading user data:", err);
      removeSkeleton();
    }
  });

  // Visibility change handler
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const user = auth.currentUser;
    if (!user) return;
    getUserIdFromUid(user.uid).then(displayAllContent);
  });

  // Dropdown collapse stopPropagation
  document.querySelectorAll('.dropdown-item[data-bs-toggle="collapse"]').forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
  });

  // Post image selection & crop
  if (postImageInput) {
    postImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const compressed = await compressImage(file);
        selectedImageFile = file;
        if (postCropImage) postCropImage.src = compressed;
        if (postCropper) { postCropper.destroy(); postCropper = null; }
        if (postCropModal) postCropModal.show();
        if (typeof Cropper !== "undefined" && postCropImage) {
          postCropper = new Cropper(postCropImage, { aspectRatio: NaN, viewMode: 1 });
        }
      } catch (err) {
        alert(err.message);
        postImageInput.value = "";
        selectedImageFile = null;
      }
    });
  }

  postCropButton?.addEventListener("click", () => {
    if (!postCropper) { alert("Please select an image first"); return; }
    const canvas = postCropper.getCroppedCanvas();
    if (postImagePreview) {
      postImagePreview.src = canvas.toDataURL("image/jpeg");
      postImagePreview.classList.remove("d-none");
    }
    if (postCropModal) postCropModal.hide();
  });

  // Submit post
  submitPostButton?.addEventListener("click", async () => {
    const postContent = postText?.value.trim() ?? "";
    if (!postContent && !selectedImageFile) { alert("Please add text or an image."); return; }
    const user = auth.currentUser;
    if (!user) { alert("User is not logged in."); return; }
    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      let base64Image = null;
      if (selectedImageFile && postCropper) {
        base64Image = postCropper.getCroppedCanvas().toDataURL("image/jpeg").split(",")[1];
      }
      await savePostToFirestore(postContent, base64Image, firestoreUserId);
    } catch (err) {
      console.error("Error handling post submission:", err);
      alert("Something went wrong.");
    }
  });

  // Create product
  createProductButton?.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) { alert("Please log in to create products"); return; }
    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      sessionStorage.setItem("currentUserId", user.uid);
      sessionStorage.setItem("currentFirestoreUserId", firestoreUserId);
      sessionStorage.setItem("designerFirestoreUserId", firestoreUserId);
      window.location.href = "select-products-dimona.html";
    } catch (err) {
      console.error("Error getting user ID:", err);
      alert("Error retrieving user information. Please try again.");
    }
  });

  // Become artist
  document.getElementById("becomeArtistButton")?.addEventListener("click", async () => {
    if (!firebase.auth().currentUser) {
      alert("Você precisa estar logado para se tornar um artista.");
      return;
    }

    window.location.href = "/artistRegistration.html";
  });

  // Add post button
  addPostButton?.addEventListener("click", () => { if (postModal) postModal.show(); });

  // Edit name
  const nameEditSection = document.getElementById("nameEditSection");
  const nameInput = document.getElementById("nameInput");

  document.getElementById("editNameButton")?.addEventListener("click", () => {
    if (nameEditSection) nameEditSection.style.display = "block";
    if (nameInput && userNameElement) nameInput.value = userNameElement.textContent;
  });

  document.getElementById("saveNameButton")?.addEventListener("click", () => {
    const newName = nameInput?.value.trim();
    const user = auth.currentUser;
    if (user && newName) {
      getUserIdFromUid(user.uid).then((id) =>
        db.collection("users").doc(id).update({ user_Name: newName })
          .then(() => {
            if (userNameElement) userNameElement.textContent = newName;
            if (nameEditSection) nameEditSection.style.display = "none";
          })
          .catch((err) => { console.error(err); alert("Failed to update name."); })
      );
    }
  });

  document.getElementById("cancelNameButton")?.addEventListener("click", () => {
    if (nameEditSection) nameEditSection.style.display = "none";
  });

  // Edit bio
  const bioEditSection = document.getElementById("bioEditSection");
  const bioInput = document.getElementById("bioInput");

  document.getElementById("editBioButton")?.addEventListener("click", () => {
    if (bioEditSection) bioEditSection.style.display = "block";
    if (bioInput && userBioElement) bioInput.value = userBioElement.textContent;
  });

  document.getElementById("saveBioButton")?.addEventListener("click", () => {
    const newBio = bioInput?.value.trim() ?? "";
    const user = auth.currentUser;
    if (user) {
      getUserIdFromUid(user.uid).then((id) =>
        db.collection("users").doc(id).update({ user_Bio: newBio })
          .then(() => {
            if (userBioElement) userBioElement.textContent = newBio;
            if (bioEditSection) bioEditSection.style.display = "none";
          })
          .catch((err) => { console.error(err); alert("Failed to update bio."); })
      );
    }
  });

  document.getElementById("cancelBioButton")?.addEventListener("click", () => {
    if (bioEditSection) bioEditSection.style.display = "none";
  });

  // Profile picture upload & crop
  uploadPictureButton?.addEventListener("click", () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const compressed = await compressImage(file);
        const cropImage = document.getElementById("cropImage");
        if (cropImage) cropImage.src = compressed;
        if (cropModal) cropModal.show();
        if (typeof Cropper !== "undefined" && cropImage) {
          if (cropper) cropper.destroy();
          cropper = new Cropper(cropImage, { aspectRatio: 1, viewMode: 1 });
        }
      } catch (err) { alert(err.message); }
    });
    fileInput.click();
  });

  document.getElementById("cropButton")?.addEventListener("click", () => {
    if (!cropper) { alert("Please select and crop an image first."); return; }
    const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });
    canvas.toBlob(() => {
      const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
      const user = auth.currentUser;
      if (user) {
        getUserIdFromUid(user.uid).then((id) =>
          db.collection("users").doc(id).update({ profilePicture: base64Image })
            .then(() => {
              if (profilePictureElement) profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`;
              if (cropModal) cropModal.hide();
              cropper.destroy(); cropper = null;
            })
            .catch((err) => { console.error(err); alert("Error updating profile picture."); })
        );
      }
    }, "image/jpeg");
  });

  // Logout
  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    try {
      ["currentUserId", "currentFirestoreUserId", "designerFirestoreUserId", "selectedProduct", "selectedVariants"]
        .forEach(k => sessionStorage.removeItem(k));
      await auth.signOut();
      window.location.href = "inicio.html";
    } catch (err) {
      console.error("Error during logout:", err);
      alert("Erro ao fazer logout. Tente novamente.");
    }
  });

  // Delete account
  document.getElementById("deleteAccountButton")?.addEventListener("click", () => {
    const user = auth.currentUser;
    if (!user) { alert("No user is logged in."); return; }
    if (confirm("Are you sure you want to delete your account and all associated data? This action is irreversible.")) {
      deleteUserAccountAndPosts(user);
    }
  });
  // Cart button navigation
  const cartButton = document.getElementById("cartButton");
  if (cartButton) {
      cartButton.addEventListener("click", () => {
          window.location.href = "carrinho.html";
      });
  }
  // Back button navigation
  const backButton = document.getElementById("backButton");
  if (backButton) {
      backButton.addEventListener("click", () => {
          window.history.back();
      });
  }
});