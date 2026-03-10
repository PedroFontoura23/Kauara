document.addEventListener("DOMContentLoaded", function () {
  // Initialize Firebase
  const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S",
  };
  
  // Check if Firebase is already initialized
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Elements - defined after DOM is loaded
  const userNameElement = document.getElementById("userName");
  const userEmailElement = document.getElementById("userEmail");
  const userBioElement = document.getElementById("userBio");
  const profilePictureElement = document.getElementById("profilePicture");
  const uploadPictureButton = document.getElementById("uploadPictureButton");
  const artistaBadge = document.getElementById("artistaBadge");
  const addPostButton = document.getElementById("addPostButton");
  const createProductButton = document.getElementById("createProductButton");
  
  // Modal elements - initialized safely after DOM is loaded
  let cropModal, postModal, postCropModal;
  
  // Initialize modals safely
  setTimeout(() => {
    try {
      const cropModalEl = document.getElementById("cropModal");
      const postModalEl = document.getElementById("postModal");
      const postCropModalEl = document.getElementById("cropPostModal");

      if (cropModalEl && typeof bootstrap !== 'undefined') cropModal = new bootstrap.Modal(cropModalEl);
      if (postModalEl && typeof bootstrap !== 'undefined') postModal = new bootstrap.Modal(postModalEl);
      if (postCropModalEl && typeof bootstrap !== 'undefined') postCropModal = new bootstrap.Modal(postCropModalEl);
      
    } catch (modalError) {
      console.error("Error initializing modals:", modalError);
    }
  }, 100);

  // Post elements
  const postText = document.getElementById("postText");
  const postImageInput = document.getElementById("postImageInput");
  const postImagePreview = document.getElementById("postImagePreview");
  const submitPostButton = document.getElementById("submitPostButton");

  // Post image cropping elements
  const postCropImage = document.getElementById("cropPostImage");
  const postCropButton = document.getElementById("cropPostButton");
  const MAX_IMAGE_SIZE_MB = 5; // Maximum file size in MB
  const MAX_DIMENSION = 1200; // Maximum width/height in pixels
  const JPEG_QUALITY = 0.7; // JPEG compression quality (0.0 to 1.0)

  let selectedImageFile = null;
  let cropper;
  let postCropper = null;

  // Create Product button functionality
  if (createProductButton) {
    createProductButton.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          const firestoreUserId = await getUserIdFromUid(user.uid);
          sessionStorage.setItem('currentUserId', user.uid);
          sessionStorage.setItem('currentFirestoreUserId', firestoreUserId);
          sessionStorage.setItem('designerFirestoreUserId', firestoreUserId);
          window.location.href = 'select-product.html';
        } catch (error) {
          console.error("Error getting user ID:", error);
          alert("Error retrieving user information. Please try again.");
        }
      } else {
        alert("Please log in to create products");
      }
    });
  }

  // Become Artist button functionality
  const becomeArtistButton = document.getElementById("becomeArtistButton");
  if (becomeArtistButton) {
    becomeArtistButton.addEventListener("click", async () => {
      const user = firebase.auth().currentUser;
      if (!user) {
        alert("Você precisa estar logado para se tornar um artista.");
        return;
      }

      const CLIENT_ID = "8000562204726523";
      const authUrl = `/artistRegistration.html`;
      window.location.href = authUrl;
    });
  }

  // NOTE: API keys must never be fetched or decrypted client-side.
  // Use a Cloud Function to proxy any Printful API calls instead.

  // Add this event listener for the "Create Post" button
  if (addPostButton) {
    addPostButton.addEventListener("click", () => {
      if (postModal) postModal.show();
    });
  }

  document.querySelectorAll('.dropdown-item[data-bs-toggle="collapse"]').forEach((button) => {
      button.addEventListener('click', (event) => {
          event.stopPropagation();
      });
  });

  function initializePostManager(containerId) {
    if (typeof PostManager !== 'undefined') {
      return new PostManager(db, auth, containerId);
    } else {
      console.error("PostManager is not defined. Make sure to include the PostManager script.");
      return null;
    }
  }

  function initializeProductManager(containerId) {
    if (typeof ProductManager !== 'undefined') {
      return new ProductManager(db, auth, containerId);
    } else {
      console.error("ProductManager is not defined. Make sure to include the ProductManager script.");
      return null;
    }
  }

  // ✅ Initialize ArtManager
  function initializeArtManager(containerId) {
    if (typeof ArtManager !== 'undefined') {
      return new ArtManager(db, auth, containerId);
    } else {
      console.error("ArtManager is not defined. Make sure to include the ArtManager script.");
      return null;
    }
  }

  // displayArt function (only user's art)
  function displayArt(firestoreUserId) {
    if (!firestoreUserId) return;
    const artManager = initializeArtManager('artContainer');
    if (artManager) {
        artManager.displayArts(firestoreUserId, firestoreUserId);
    }
  }

  // Handle image upload and cropping
  if (postImageInput) {
    postImageInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (file) {
        try {
          const compressedImage = await compressImage(file);
          selectedImageFile = file;
          if (postCropImage) postCropImage.src = compressedImage;

          if (postCropper) {
            postCropper.destroy();
          }

          if (postCropModal) postCropModal.show();
          
          // Check if Cropper is available
          if (typeof Cropper !== 'undefined' && postCropImage) {
            postCropper = new Cropper(postCropImage, {
              aspectRatio: NaN,
              viewMode: 1
            });
          } else {
            console.error("Cropper library is not loaded or postCropImage element not found");
          }
        } catch (error) {
          alert(error.message);
          postImageInput.value = '';
          selectedImageFile = null;
        }
      }
    });
  }

  // Handle image cropping
  if (postCropButton) {
    postCropButton.addEventListener("click", () => {
      if (!postCropper) {
        alert("Please select an image first");
        return;
      }

      const canvas = postCropper.getCroppedCanvas();
      if (postImagePreview) {
        postImagePreview.src = canvas.toDataURL("image/jpeg");
        postImagePreview.classList.remove("d-none");
      }
      if (postCropModal) postCropModal.hide();
    });
  }

  // Handle post submission
  if (submitPostButton) {
    submitPostButton.addEventListener("click", async () => {
      const postContent = postText ? postText.value.trim() : "";
      if (!postContent && !selectedImageFile) {
        alert("Please add text or an image.");
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        alert("User is not logged in.");
        return;
      }

      try {
        const firestoreUserId = await getUserIdFromUid(user.uid);
        let base64Image = null;

        if (selectedImageFile && postCropper) {
          const canvas = postCropper.getCroppedCanvas();
          base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
        }

        await savePostToFirestore(postContent, base64Image, firestoreUserId);
      } catch (error) {
        console.error("Error handling post submission:", error);
        alert("Something went wrong.");
      }
    });
  }

  // Function to save the post to Firestore
  async function savePostToFirestore(text, base64Image, userId) {
    if (!userId) {
      alert("User ID is missing.");
      return;
    }

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || !userDoc.data().artista) {
      alert("Achei o espertinho. Só artistas podem fazer posts.");
      return;
    }

    if (!text && !base64Image) {
      alert("Please add some text or an image.");
      return;
    }

    const postTextContent = text.trim() || "No content provided";

    try {
      await db.collection("posts").add({
        foreignUserId: userId,
        Firebase_UID: firebase.auth().currentUser.uid, 
        postText: postTextContent,
        postImage: base64Image,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (postModal) postModal.hide();
      if (postText) postText.value = "";
      if (postImageInput) postImageInput.value = "";
      if (postImagePreview) postImagePreview.classList.add("d-none");
      selectedImageFile = null;

      if (postCropper) {
        postCropper.destroy();
        postCropper = null;
      }

      alert("Post successfully created!");
      displayPosts(userId);
    } catch (error) {
      console.error("Error adding post:", error);
      alert("Failed to create post.");
    }
  }

  // Helper function to get Firestore user_<id> from Firebase UID
  async function getUserIdFromUid(uid) {
    const querySnapshot = await db.collection("users").where("firebaseUID", "==", uid).limit(1).get();
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].id;
    } else {
      throw new Error("User not found.");
    }
  }

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
      if (user) {
          getUserIdFromUid(user.uid).then(async (firestoreUserId) => {
              // Fetch user document first
              const userDocRef = db.collection("users").doc(firestoreUserId);
              const userDoc = await userDocRef.get();

              if (userDoc.exists) {
                  const userData = userDoc.data();

                  // ✅ Display user data immediately
                  if (userNameElement) userNameElement.textContent = userData.user_Name || "Unknown User";
                  if (userEmailElement) userEmailElement.textContent = user.email || "No Email";
                  if (userBioElement) userBioElement.textContent = userData.user_Bio || "No bio available.";
                  
                  // ✅ Show profile picture ASAP
                  if (profilePictureElement) {
                    profilePictureElement.src = userData.profilePicture 
                        ? `data:image/jpeg;base64,${userData.profilePicture}`
                        : "../images/default-profile.png";
                  }

                  // ✅ Show/hide artist elements
                  if (userData.artista) {
                      if (addPostButton) addPostButton.style.display = "block";
                      if (createProductButton) createProductButton.style.display = "block";
                      if (artistaBadge) artistaBadge.style.display = "inline";
                  } else {
                      if (addPostButton) addPostButton.style.display = "none";
                      if (createProductButton) createProductButton.style.display = "none";
                      if (artistaBadge) artistaBadge.style.display = "none";
                  }

                  // Explicitly fetch ratings
                  fetchUserRatings(firestoreUserId);
                  
                  // ✅ Start loading posts, art & products without waiting for ratings
                  displayPosts(firestoreUserId);
                  displayArt(firestoreUserId); // ✅ Show user's art
                  displayProducts(firestoreUserId);
              }
          }).catch((error) => {
              console.error("Error getting user ID:", error);
              console.error("Error loading user data");
          });
      }
  });

  async function fetchUserRatings(userId) {
      try {
          // Fetch the user document from Firestore
          const userDoc = await db.collection("users").doc(userId).get();

          if (userDoc.exists) {
              const userData = userDoc.data();

              // Get the averageRating and totalRatings fields
              const averageRating = userData.averageRating || 0;
              const totalRatings = userData.totalRatings || 0;

              // Update the DOM with the fetched values
              const averageRatingEl = document.getElementById("averageRating");
              const numberOfRatingsEl = document.getElementById("numberOfRatings");
              
              if (averageRatingEl) averageRatingEl.textContent = `${averageRating} ⭐`;
              if (numberOfRatingsEl) numberOfRatingsEl.textContent = `(${totalRatings} ${totalRatings === 1 ? 'rating' : 'ratings'})`;
          } else {
              const averageRatingEl = document.getElementById("averageRating");
              const numberOfRatingsEl = document.getElementById("numberOfRatings");
              
              if (averageRatingEl) averageRatingEl.textContent = "No ratings yet";
              if (numberOfRatingsEl) numberOfRatingsEl.textContent = "(0 ratings)";
          }
      } catch (error) {
          console.error("Error fetching ratings:", error);
          const averageRatingEl = document.getElementById("averageRating");
          const numberOfRatingsEl = document.getElementById("numberOfRatings");
          
          if (averageRatingEl) averageRatingEl.textContent = "Error loading ratings";
          if (numberOfRatingsEl) numberOfRatingsEl.textContent = "";
      }
  }

  function displayProducts(firestoreUserId) {
    if (!firestoreUserId) return;
    const productManager = initializeProductManager('productsContainer');
    if (productManager) {
        productManager.displayProducts(firestoreUserId, firestoreUserId);
    }
  }

  // Image compression function
  async function compressImage(imageFile) {
    // Check file size first
    const fileSizeMB = imageFile.size / (1024 * 1024);
    if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
      throw new Error(`Image size must be less than ${MAX_IMAGE_SIZE_MB}MB`);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Calculate new dimensions while maintaining aspect ratio
          let width = img.width;
          let height = img.height;
          
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width > height) {
              height = (height / width) * MAX_DIMENSION;
              width = MAX_DIMENSION;
            } else {
              width = (width / height) * MAX_DIMENSION;
              height = MAX_DIMENSION;
            }
          }

          // Create canvas for compression
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          // Draw and compress
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with quality setting
          const compressedBase64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          
          // Check final size
          const finalSize = (compressedBase64.length * 3) / 4 / (1024 * 1024);
          if (finalSize > MAX_IMAGE_SIZE_MB) {
            reject(new Error(`Compressed image is still too large (${finalSize.toFixed(2)}MB)`));
          } else {
            resolve(compressedBase64);
          }
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }

  // Edit Name Functionality
  const editNameButton = document.getElementById("editNameButton");
  if (editNameButton) {
    editNameButton.addEventListener("click", () => {
      const nameEditSection = document.getElementById("nameEditSection");
      if (nameEditSection) nameEditSection.style.display = "block";
      const nameInput = document.getElementById("nameInput");
      if (nameInput && userNameElement) nameInput.value = userNameElement.textContent;
    });
  }

  const saveNameButton = document.getElementById("saveNameButton");
  if (saveNameButton) {
    saveNameButton.addEventListener("click", () => {
      const nameInput = document.getElementById("nameInput");
      const newName = nameInput ? nameInput.value.trim() : "";
      const user = auth.currentUser;

      if (user && newName) {
        getUserIdFromUid(user.uid).then((firestoreUserId) => {
          db.collection("users")
            .doc(firestoreUserId)
            .update({ user_Name: newName })
            .then(() => {
              if (userNameElement) userNameElement.textContent = newName;
              const nameEditSection = document.getElementById("nameEditSection");
              if (nameEditSection) nameEditSection.style.display = "none";
            })
            .catch((error) => {
              console.error("Error updating name:", error);
              alert("Failed to update name.");
            });
        });
      }
    });
  }

  const cancelNameButton = document.getElementById("cancelNameButton");
  if (cancelNameButton) {
    cancelNameButton.addEventListener("click", () => {
      const nameEditSection = document.getElementById("nameEditSection");
      if (nameEditSection) nameEditSection.style.display = "none";
    });
  }

  // Edit Bio Functionality
  const editBioButton = document.getElementById("editBioButton");
  if (editBioButton) {
    editBioButton.addEventListener("click", () => {
      const bioEditSection = document.getElementById("bioEditSection");
      if (bioEditSection) bioEditSection.style.display = "block";
      const bioInput = document.getElementById("bioInput");
      if (bioInput && userBioElement) bioInput.value = userBioElement.textContent;
    });
  }

  const saveBioButton = document.getElementById("saveBioButton");
  if (saveBioButton) {
    saveBioButton.addEventListener("click", () => {
      const bioInput = document.getElementById("bioInput");
      const newBio = bioInput ? bioInput.value.trim() : "";
      const user = auth.currentUser;

      if (user) {
        getUserIdFromUid(user.uid).then((firestoreUserId) => {
          db.collection("users")
            .doc(firestoreUserId)
            .update({ user_Bio: newBio })
            .then(() => {
              if (userBioElement) userBioElement.textContent = newBio;
              const bioEditSection = document.getElementById("bioEditSection");
              if (bioEditSection) bioEditSection.style.display = "none";
            })
            .catch((error) => {
              console.error("Error updating bio:", error);
              alert("Failed to update bio.");
            });
        });
      }
    });
  }

  const cancelBioButton = document.getElementById("cancelBioButton");
  if (cancelBioButton) {
    cancelBioButton.addEventListener("click", () => {
      const bioEditSection = document.getElementById("bioEditSection");
      if (bioEditSection) bioEditSection.style.display = "none";
    });
  }

  // File upload and cropping
  if (uploadPictureButton) {
    uploadPictureButton.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (file) {
          try {
            const compressedImage = await compressImage(file);
            const cropImage = document.getElementById("cropImage");
            if (cropImage) cropImage.src = compressedImage;
            if (cropModal) cropModal.show();
            
            // Check if Cropper is available
            if (typeof Cropper !== 'undefined') {
              cropper = new Cropper(cropImage, {
                aspectRatio: 1,
                viewMode: 1,
              });
            } else {
              console.error("Cropper library is not loaded");
            }
          } catch (error) {
            alert(error.message);
          }
        }
      });
      fileInput.click();
    });
  }

  // Save cropped image to Firestore as Base64
  const cropButton = document.getElementById("cropButton");
  if (cropButton) {
    cropButton.addEventListener("click", () => {
      if (!cropper) {
        console.error("Cropper is not initialized.");
        alert("Please select and crop an image first.");
        return;
      }

      const canvas = cropper.getCroppedCanvas({
        width: 300,
        height: 300,
      });

      canvas.toBlob((blob) => {
        const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
        const user = auth.currentUser;

        if (user) {
          getUserIdFromUid(user.uid).then((firestoreUserId) => {
            db.collection("users")
              .doc(firestoreUserId)
              .update({ profilePicture: base64Image })
              .then(() => {
                if (profilePictureElement) profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`;
                if (cropModal) cropModal.hide();
                cropper.destroy();
              })
              .catch((error) => {
                console.error("Error updating profile picture:", error);
                alert("Error updating profile picture.");
              });
          });
        }
      }, "image/jpeg");
    });
  }

  // Log Out Functionality
  const logoutButton = document.getElementById('logoutButton');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            // Clear session storage
            sessionStorage.removeItem('currentUserId');
            sessionStorage.removeItem('currentFirestoreUserId');
            sessionStorage.removeItem('designerFirestoreUserId');
            sessionStorage.removeItem('selectedProduct');
            sessionStorage.removeItem('selectedVariants');
            
            // Sign out from Firebase
            await auth.signOut();
            window.location.href = "inicio.html";
        } catch (error) {
            console.error("Error during logout:", error);
            alert("Erro ao fazer logout. Tente novamente.");
        }
    });
  }

  // Delete account functionality
  const deleteAccountButton = document.getElementById("deleteAccountButton");
  if (deleteAccountButton) {
    deleteAccountButton.addEventListener("click", () => {
      const user = auth.currentUser;

      if (!user) {
        alert("No user is logged in.");
        return;
      }

      // Confirm the deletion with the user before proceeding
      if (confirm("Are you sure you want to delete your account and all associated data? This action is irreversible.")) {
        deleteUserAccountAndPosts(user);
      }
    });
  }

  // Function to delete the user account and all their posts, comments
  async function deleteUserAccountAndPosts(user) {
    try {
      await reauthenticateUser(user);

      const firestoreUserId = await getUserIdFromUid(user.uid);

      // Helper: batch-delete all docs matching a field value
      async function safeDeleteCollection(collectionName, fieldName, fieldValue) {
        const snapshot = await db.collection(collectionName).where(fieldName, "==", fieldValue).get();
        if (snapshot.empty) return;
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }

      // Step 2: Delete user's comments and likes
      await safeDeleteCollection("comment_likes", "foreignUserId", firestoreUserId);
      await safeDeleteCollection("comments", "foreignUserId", firestoreUserId);
      await safeDeleteCollection("likes", "foreignUserId", firestoreUserId);

      // Step 3: Delete products and ratings
      await safeDeleteCollection("product_ratings", "RaterForeignUserId", firestoreUserId);
      await safeDeleteCollection("ratings", "raterUid", user.uid);
      await safeDeleteCollection("products", "userId", firestoreUserId);

      // Step 4: Handle posts and their dependent objects
      const postsSnapshot = await db.collection("posts").where("foreignUserId", "==", firestoreUserId).get();
      if (!postsSnapshot.empty) {
        for (const postDoc of postsSnapshot.docs) {
          const postId = postDoc.id;
          await safeDeleteCollection("comments", "foreignPostId", postId);
          await safeDeleteCollection("likes", "postId", postId);
          await postDoc.ref.delete();
        }
      }

      // Step 5: Delete contact document
      const contactId = `contact_${firestoreUserId.split('_')[1]}`;
      const contactDoc = await db.collection("contact").doc(contactId).get();
      if (contactDoc.exists) {
        await db.collection("contact").doc(contactId).delete();
      }

      // Step 6: Delete user document
      await db.collection("users").doc(firestoreUserId).delete();

      // Step 7: Delete Firebase Auth record and sign out
      await user.delete();
      await auth.signOut();
      alert("Your account and all associated data have been deleted.");
      window.location.href = "inicio.html";

    } catch (error) {
      console.error("Account deletion error:", error.code || error.message);
      alert("Failed to delete account. Please try again.");
      throw error;
    }
  }

  // Reauthentication helper
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

  // Helper function to format timestamp as a readable date (e.g., "January 21, 2025, 5:00 PM")
  function formatTimestamp(date) {
      const options = { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
      };
      return date.toLocaleString('en-US', options);
  }

  function displayPosts(firestoreUserId) {
      if (!firestoreUserId) return;
      const postManager = initializePostManager('allPostsContainer');
      if (postManager) {
          postManager.displayPosts(firestoreUserId, firestoreUserId);
      }
  }

  // Show the "Create Product" button if the user is an artist
  auth.onAuthStateChanged(async (user) => {
      if (user) {
          try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            const userDoc = await db.collection("users").doc(firestoreUserId).get();
            const userData = userDoc.data();
            
            if (userData?.artista) {
                if (artistaBadge) artistaBadge.style.display = "inline";
                if (createProductButton) createProductButton.style.display = "block";
            }
          } catch (error) {
            console.error("Error in auth state change handler:", error);
          }
      }
  });

  // Content is loaded via onAuthStateChanged below, which always passes
  // the verified firestoreUserId so only that user's content is shown.

  // Handle page visibility changes to refresh data when returning to the page
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      // Page became visible again, refresh data
      const user = auth.currentUser;
      if (user) {
        getUserIdFromUid(user.uid).then((firestoreUserId) => {
          displayPosts(firestoreUserId);
          displayArt(firestoreUserId);
          displayProducts(firestoreUserId);
        });
      }
    }
  });
});