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
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Elements
  const userNameElement = document.getElementById("userName");
  const userEmailElement = document.getElementById("userEmail");
  const userBioElement = document.getElementById("userBio");
  const profilePictureElement = document.getElementById("profilePicture");
  const cropModal = new bootstrap.Modal(document.getElementById("cropModal"));
  const cropImage = document.getElementById("cropImage");
  const cropButton = document.getElementById("cropButton");
  const uploadPictureButton = document.getElementById("uploadPictureButton");
  // Post elements
  const addPostButton = document.getElementById("addPostButton");
  const postModal = new bootstrap.Modal(document.getElementById("postModal"));
  const postText = document.getElementById("postText");
  const postImageInput = document.getElementById("postImageInput");
  const postImagePreview = document.getElementById("postImagePreview");
  const submitPostButton = document.getElementById("submitPostButton");

  // Post image cropping elements
  const postCropModal = new bootstrap.Modal(document.getElementById("cropPostModal"));
  const postCropImage = document.getElementById("cropPostImage");
  const postCropButton = document.getElementById("cropPostButton")
  const MAX_IMAGE_SIZE_MB = 5; // Maximum file size in MB
  const MAX_DIMENSION = 1200; // Maximum width/height in pixels
  const JPEG_QUALITY = 0.7; // JPEG compression quality (0.0 to 1.0)
    // Elements for product creation
  const addProductButton = document.getElementById("addProductButton");
  const productModal = new bootstrap.Modal(document.getElementById("productModal"));
  const productName = document.getElementById("productName");
  const productDescription = document.getElementById("productDescription");
  const productPrice = document.getElementById("productPrice");
  const productImageInput = document.getElementById("productImageInput");
  const productImagePreview = document.getElementById("productImagePreview");
  const submitProductButton = document.getElementById("submitProductButton");
  const mockupCanvas = document.getElementById("mockupCanvas");
  const ctx = mockupCanvas.getContext("2d");
  const PRINTFUL_CLIENT_ID = "app-5311675"; // Replace with your Printful Client ID
  const REDIRECT_URI = "https://kauara1.web.app"; // Must match Printful settings
  let selectedProductImageFile = null;
  let productCropper = null;

  let selectedImageFile = null;
  let cropper;
  let postCropper = null;

  document.getElementById("becomeArtistButton").addEventListener("click", async () => {
    const user = firebase.auth().currentUser;
    if (!user) {
      alert("Você precisa estar logado para se tornar um artista.");
      return;
    }

    const CLIENT_ID = "8000562204726523";

    // Gera a URL para o usuário autenticar no Mercado Pago
    const authUrl = `/artistRegistration.html`;

    window.location.href = authUrl; // Redireciona o usuário
  });

  async function getPrintfulKey() {
      const db = firebase.firestore();
      try {
          const doc = await db.collection("config").doc("api_keys").get();
          if (doc.exists) {
              const encryptedKey = doc.data().printful_api_encrypted;
              const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_SECRET);
              const decryptedKey = bytes.toString(CryptoJS.enc.Utf8);
              return decryptedKey; 
          } else {
              console.error("Nenhuma chave encontrada no Firestore.");
              return null;
          }
      } catch (error) {
          console.error("Erro ao buscar chave:", error);
          return null;
      }
  }

  // Add this event listener for the "Create Post" button
  addPostButton.addEventListener("click", () => {
    console.log("Create Post button clicked!"); // Debugging: Log to console
    postModal.show(); // Open the post creation modal
  });

  // Impedir que o dropdown feche ao clicar em "Conta" ou "Segurança"
  document.querySelectorAll('.dropdown-item[data-bs-toggle="collapse"]').forEach((button) => {
      button.addEventListener('click', (event) => {
          event.stopPropagation(); // Impede que o evento de clique se propague e feche o dropdown
      });
  });

  function initializePostManager(containerId) {
    return new PostManager(db, auth, containerId);
  }

  // Handle image upload and cropping
  postImageInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const compressedImage = await compressImage(file);
        selectedImageFile = file;
        postCropImage.src = compressedImage;

        if (postCropper) {
          postCropper.destroy();
        }

        postCropModal.show();
        postCropper = new Cropper(postCropImage, {
          aspectRatio: NaN,
          viewMode: 1
        });
      } catch (error) {
        alert(error.message);
        postImageInput.value = ''; // Clear the input
        selectedImageFile = null;
      }
    }
  });

  // Handle image cropping
  postCropButton.addEventListener("click", () => {
    if (!postCropper) {
      alert("Please select an image first");
      return;
    }

    const canvas = postCropper.getCroppedCanvas();
    postImagePreview.src = canvas.toDataURL("image/jpeg");
    postImagePreview.classList.remove("d-none");
    postCropModal.hide();
  });

  // Handle post submission
  submitPostButton.addEventListener("click", async () => {
    const postContent = postText.value.trim();
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

  // Function to save the post to Firestore
  async function savePostToFirestore(text, base64Image, userId) {
    console.log("UserID:", userId);
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

    const postText = text.trim() || "No content provided";

    try {
      await db.collection("posts").add({
        foreignUserId: userId,
        Firebase_UID: firebase.auth().currentUser.uid, 
        postText: postText,
        postImage: base64Image,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      postModal.hide();
      postText.value = "";
      postImageInput.value = "";
      postImagePreview.classList.add("d-none");
      selectedImageFile = null;

      if (postCropper) {
        postCropper.destroy();
        postCropper = null;
      }

      alert("Post successfully created!");
      displayPosts();
    } catch (error) {
      console.error("Error adding post:", error);
      alert("Failed to create post.");
    }
  }
  // Helper function to get user ID format (e.g., "user_1", "user_2")
  async function getUserIdFromUid(uid) {
    console.log("Fetching Firestore user ID for UID:", uid);
    const querySnapshot = await db.collection("users").where("firebaseUID", "==", uid).get();
    console.log(`Query result: ${querySnapshot.size} documents found`);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      console.log("User document found:", {
        id: doc.id,
        data: doc.data()
      });
      return doc.id;
    } else {
      console.error("No user document found for UID:", uid);
      throw new Error(`No user found for UID: ${uid}`);
    }
  }

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
      if (user) {
          getUserIdFromUid(user.uid).then(async (firestoreUserId) => {
              console.log(`Logging in as: ${firestoreUserId}`);

              // Fetch user document first
              const userDocRef = db.collection("users").doc(firestoreUserId);
              const userDoc = await userDocRef.get();

              if (userDoc.exists) {
                  const userData = userDoc.data();

                  // ✅ Display user data immediately
                  userNameElement.textContent = userData.user_Name || "Unknown User";
                  userEmailElement.textContent = user.email || "No Email";
                  userBioElement.textContent = userData.user_Bio || "No bio available.";
                  
                  // ✅ Show profile picture ASAP
                  profilePictureElement.src = userData.profilePicture 
                      ? `data:image/jpeg;base64,${userData.profilePicture}`
                      : "../images/default-profile.png";

                  // ✅ Show/hide artist elements
                  if (userData.artista) {
                      addPostButton.style.display = "block";
                      if (addProductButton) addProductButton.style.display = "block";
                      artistaBadge.style.display = "inline";
                  } else {
                      addPostButton.style.display = "none";
                      if (addProductButton) addProductButton.style.display = "none";
                      artistaBadge.style.display = "none";
                  }

                  // Explicitly fetch ratings
                  console.log("Calling fetchUserRatings for ID:", firestoreUserId);
                  fetchUserRatings(firestoreUserId);
                  
                  // ✅ Start loading posts & products **without waiting for ratings**
                  displayPosts(firestoreUserId);
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
              const averageRating = userData.averageRating || 0; // Default to 0 if not available
              const totalRatings = userData.totalRatings || 0; // Default to 0 if not available

              console.log("Average Rating from Firestore:", averageRating); // Debugging
              console.log("Total Ratings from Firestore:", totalRatings); // Debugging

              // Update the DOM with the fetched values
              document.getElementById("averageRating").textContent = `${averageRating} ★`;
              document.getElementById("numberOfRatings").textContent = `(${totalRatings} ${totalRatings === 1 ? 'rating' : 'ratings'})`;
          } else {
              console.error("User document not found for ID:", userId);
              document.getElementById("averageRating").textContent = "No ratings yet";
              document.getElementById("numberOfRatings").textContent = "(0 ratings)";
          }
      } catch (error) {
          console.error("Error fetching ratings:", error);
          document.getElementById("averageRating").textContent = "Error loading ratings";
          document.getElementById("numberOfRatings").textContent = "";
      }
  }

  // Update the displayProducts function to use the firestoreUserId
  function displayProducts() {
    const user = auth.currentUser;

    if (!user) {
      console.error("No user is logged in.");
      return;
    }

    getUserIdFromUid(user.uid).then((firestoreUserId) => {
      const productsManager = new ProductsManager(db, auth, 'productsContainer');
      // Always filter by the current user's ID on the profile page
      productsManager.displayProducts(firestoreUserId, firestoreUserId);
    }).catch((error) => {
      console.error("Error fetching user ID:", error);
    });
  }
  //Limitador de tamanho da imagem
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
  document.getElementById("editNameButton").addEventListener("click", () => {
    const nameEditSection = document.getElementById("nameEditSection");
    nameEditSection.style.display = "block";
    const nameInput = document.getElementById("nameInput");
    nameInput.value = userNameElement.textContent; // Set the current name in the input
  });

  document.getElementById("saveNameButton").addEventListener("click", () => {
    const newName = document.getElementById("nameInput").value.trim();
    const user = auth.currentUser;

    getUserIdFromUid(user.uid).then((firestoreUserId) => {
      db.collection("users")
        .doc(firestoreUserId)
        .update({ user_Name: newName })
        .then(() => {
          userNameElement.textContent = newName; // Update the displayed name
          document.getElementById("nameEditSection").style.display = "none"; // Hide the edit section
        })
        .catch((error) => {
          console.error("Error updating name:", error);
          alert("Failed to update name.");
        });
    });
  });

  document.getElementById("cancelNameButton").addEventListener("click", () => {
  document.getElementById("nameEditSection").style.display = "none"; // Hide the edit section
  });

  // Edit Bio Functionality
  document.getElementById("editBioButton").addEventListener("click", () => {
    const bioEditSection = document.getElementById("bioEditSection");
    bioEditSection.style.display = "block";
    const bioInput = document.getElementById("bioInput");
    bioInput.value = userBioElement.textContent; // Set the current bio in the input
  });

  document.getElementById("saveBioButton").addEventListener("click", () => {
    const newBio = document.getElementById("bioInput").value.trim();
    const user = auth.currentUser;

    getUserIdFromUid(user.uid).then((firestoreUserId) => {
      db.collection("users")
        .doc(firestoreUserId)
        .update({ user_Bio: newBio })
        .then(() => {
          userBioElement.textContent = newBio; // Update the displayed bio
          document.getElementById("bioEditSection").style.display = "none"; // Hide the edit section
        })
        .catch((error) => {
          console.error("Error updating bio:", error);
          alert("Failed to update bio.");
        });
    });
  });

  document.getElementById("cancelBioButton").addEventListener("click", () => {
    document.getElementById("bioEditSection").style.display = "none"; // Hide the edit section
  });

  // File upload and cropping
  uploadPictureButton.addEventListener("click", () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (file) {
        try {
          const compressedImage = await compressImage(file);
          cropImage.src = compressedImage;
          cropModal.show();
          cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
          });
        } catch (error) {
          alert(error.message);
        }
      }
    });
    fileInput.click();
  });

  // Save cropped image to Firestore as Base64
  cropButton.addEventListener("click", () => {
    const canvas = cropper.getCroppedCanvas({
      width: 300,
      height: 300,
    });

    if (!cropper) {
      console.error("Cropper is not initialized.");
      alert("Please select and crop an image first.");
      return;
    }

    canvas.toBlob((blob) => {
      const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
      const user = auth.currentUser;

      getUserIdFromUid(user.uid).then((firestoreUserId) => {
        db.collection("users")
          .doc(firestoreUserId)
          .update({ profilePicture: base64Image })
          .then(() => {
            profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`;
            cropModal.hide();
            cropper.destroy();
          })
          .catch((error) => {
            console.error("Error updating profile picture:", error);
            alert("Error updating profile picture.");
          });
      });
    }, "image/jpeg");
  });

  // Log Out Functionality
  document.getElementById('logoutButton').addEventListener('click', async () => {
      try {
          // Sign out from Firebaslog out
          await auth.signOut();
          console.log("User signed out from Firebase");
          window.location.href = "inicio.html";
      } catch (error) {
          console.error("Error during logout:", error);
          alert("Erro ao fazer logout. Tente novamente.");
      }
  });


  //delete account
  document.getElementById("deleteAccountButton").addEventListener("click", () => {
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
  // Function to delete the user account and all their posts, comments
  async function deleteUserAccountAndPosts(user) {
    try {
      console.log("=== Starting Account Deletion Process ===");
      console.log("Current User:", {
        uid: user.uid,
        email: user.email,
        providerData: user.providerData,
        lastSignInTime: user.metadata.lastSignInTime
      });

      // Step 0: Reauthenticate the user
      console.log("Step 0: Initiating reauthentication...");
      await reauthenticateUser(user);
      console.log("Reauthentication successful!");

      // Step 1: Get Firestore user ID
      console.log("Step 1: Fetching Firestore user ID for UID:", user.uid);
      const firestoreUserId = await getUserIdFromUid(user.uid);
      console.log("Firestore User ID retrieved:", firestoreUserId);
      console.log("User object after reauthentication:", {
        uid: user.uid,
        email: user.email
      });

      // Helper function to safely delete collection documents with detailed logging
      async function safeDeleteCollection(collectionName, fieldName, fieldValue) {
        console.log(`Attempting to delete from collection '${collectionName}' where ${fieldName} = ${fieldValue}`);
        const snapshot = await db.collection(collectionName).where(fieldName, "==", fieldValue).get();
        console.log(`Query result for '${collectionName}': ${snapshot.size} documents found`);
        
        if (snapshot.empty) {
          console.log(`No documents to delete in '${collectionName}'`);
          return 0;
        }

        console.log(`Documents to delete from '${collectionName}':`, snapshot.docs.map(doc => ({
          id: doc.id,
          data: doc.data()
        })));

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
          console.log(`Adding delete operation for document ${doc.id} in '${collectionName}'`);
          batch.delete(doc.ref);
        });

        console.log(`Committing batch delete for ${snapshot.size} documents in '${collectionName}'`);
        await batch.commit();
        console.log(`Successfully deleted ${snapshot.size} documents from '${collectionName}'`);
        return snapshot.size;
      }

      // Step 2: Delete user's comments and likes
      console.log("Step 2: Deleting user's comments and likes...");
      const commentLikesDeleted = await safeDeleteCollection("comment_likes", "foreignUserId", firestoreUserId);
      const commentsDeleted = await safeDeleteCollection("comments", "foreignUserId", firestoreUserId);
      const likesDeleted = await safeDeleteCollection("likes", "foreignUserId", firestoreUserId);
      console.log("Summary of Step 2:", {
        commentLikesDeleted,
        commentsDeleted,
        likesDeleted
      });

      // Step 3: Delete products and ratings
      console.log("Step 3: Deleting products and ratings...");
      const productRatingsDeleted = await safeDeleteCollection("product_ratings", "RaterForeignUserId", firestoreUserId);
      const ratingsDeleted = await safeDeleteCollection("ratings", "raterUid", user.uid);
      const productsDeleted = await safeDeleteCollection("products", "userId", firestoreUserId);
      console.log("Summary of Step 3:", {
        productRatingsDeleted,
        ratingsDeleted,
        productsDeleted
      });

      // Step 4: Handle posts and their dependent objects
      console.log("Step 4: Fetching and deleting user's posts...");
      const postsSnapshot = await db.collection("posts").where("foreignUserId", "==", firestoreUserId).get();
      console.log(`Found ${postsSnapshot.size} posts to delete`);
      
      if (!postsSnapshot.empty) {
        for (const postDoc of postsSnapshot.docs) {
          const postId = postDoc.id;
          console.log(`Processing post ${postId}:`, postDoc.data());

          console.log(`Deleting comments for post ${postId}`);
          const postCommentsDeleted = await safeDeleteCollection("comments", "foreignPostId", postId);
          console.log(`Deleted ${postCommentsDeleted} comments for post ${postId}`);

          console.log(`Deleting likes for post ${postId}`);
          const postLikesDeleted = await safeDeleteCollection("likes", "postId", postId);
          console.log(`Deleted ${postLikesDeleted} likes for post ${postId}`);

          console.log(`Deleting post ${postId} itself`);
          await postDoc.ref.delete();
          console.log(`Post ${postId} deleted successfully`);
        }
      } else {
        console.log("No posts found to delete");
      }

      // Step 5: Delete contact
      console.log("Step 5: Deleting contact document...");
      const contactId = `contact_${firestoreUserId.split('_')[1]}`;
      console.log("Generated contact ID:", contactId);
      const contactDoc = await db.collection("contact").doc(contactId).get();
      if (contactDoc.exists) {
        console.log("Contact document found:", contactDoc.data());
        await db.collection("contact").doc(contactId).delete();
        console.log(`Contact document ${contactId} deleted successfully`);
      } else {
        console.log(`Contact document ${contactId} not found`);
      }

      // Step 6: Delete user document
      console.log("Step 6: Deleting user document...");
      const userDoc = await db.collection("users").doc(firestoreUserId).get();
      if (userDoc.exists) {
        console.log("User document found:", userDoc.data());
        await db.collection("users").doc(firestoreUserId).delete();
        console.log(`User document ${firestoreUserId} deleted successfully`);
      } else {
        console.log(`User document ${firestoreUserId} not found`);
      }

      // Step 7: Delete authentication
      console.log("Step 7: Deleting Firebase Authentication record...");
      console.log("User object before deletion:", {
        uid: user.uid,
        email: user.email
      });
      await user.delete();
      console.log("Firebase Authentication record deleted successfully");

      // Step 8: Log out and redirect
      console.log("Step 8: Signing out and redirecting...");
      await auth.signOut();
      console.log("User signed out successfully");
      alert("Your account and all associated data have been deleted.");
      console.log("Redirecting to inicio.html");
      window.location.href = "inicio.html";

      console.log("=== Account Deletion Process Completed Successfully ===");
    } catch (error) {
      console.error("=== Error During Account Deletion ===");
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      console.error("User state at error:", {
        uid: user?.uid,
        email: user?.email
      });
      alert("Failed to delete account and associated data: " + error.message);
      throw error; // Re-throw to allow further debugging if needed
    }
  }

  // Reauthentication helper with logging
  async function reauthenticateUser(user) {
    console.log("Reauthentication started for user:", {
      uid: user.uid,
      email: user.email
    });
    const providerId = user.providerData[0]?.providerId;
    console.log("Detected provider ID:", providerId);

    if (providerId === "password") {
      const email = user.email;
      console.log("Prompting user to re-enter password for email:", email);
      const password = prompt("Please re-enter your password to confirm account deletion:");
      if (!password) {
        console.log("User canceled reauthentication by not providing a password");
        throw new Error("Reauthentication canceled by user.");
      }
      console.log("Password provided; creating credential...");
      const credential = firebase.auth.EmailAuthProvider.credential(email, password);
      console.log("Reauthenticating with credential...");
      await user.reauthenticateWithCredential(credential);
      console.log("Reauthentication completed successfully");
    } else {
      console.log("Unsupported provider detected:", providerId);
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
      return date.toLocaleString('en-US', options); // Format using the user's local settings
  }

  function displayPosts() {
      const user = auth.currentUser;

      if (!user) {
          console.error("No user is logged in.");
          return;
      }

      getUserIdFromUid(user.uid).then((firestoreUserId) => {
          const postManager = initializePostManager('allPostsContainer');
          // Always filter by the current user's ID on the profile page
          postManager.displayPosts(firestoreUserId, firestoreUserId);
      }).catch((error) => {
          console.error("Error fetching user ID:", error);
      });
  }

  // Show the "Create Product" button if the user is an artist
  auth.onAuthStateChanged(async (user) => {
      if (user) {
          const userDoc = await db.collection("users").doc(user.uid).get();
          const userData = userDoc.data();
          
          if (userData?.artista) {
              document.getElementById("artistaBadge").style.display = "inline";
              console.log("✅ User is an artist!");
          }
      }
  });

  document.getElementById("donateButton").addEventListener("click", async () => {
      const amount = prompt("Enter donation amount (e.g. 5.00):");
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
          alert("Invalid amount.");
          return;
      }

      const donorName = prompt("Enter your name (optional):");

      try {
          const result = await firebase.functions().httpsCallable("createDonationPreference")({
              artistUserId: userIdFromUrl,
              amount: parseFloat(amount),
              donorName: donorName || null
          });

          // Redirect to Mercado Pago Checkout
          window.location.href = result.data.init_point;
      } catch (error) {
          console.error("Donation error:", error);
          alert("Failed to create donation. Please try again.");
      }
  });
  
  // Handle "Create Product" button click
  addProductButton.addEventListener("click", () => {
      productModal.show(); // Open the product creation modal
  });

  async function getPrintfulProducts() {
      const apiKey = await getPrintfulKey();
      if (!apiKey) {
          console.error("Não foi possível obter a chave da API.");
          return;
      }

      try {
          const response = await fetch("https://api.printful.com/products", {
              method: "GET",
              headers: {
                  "Authorization": `Basic ${btoa(apiKey + ":")}`,
                  "Content-Type": "application/json"
              }
          });

          const data = await response.json();
          return data.result; 
      } catch (error) {
          console.error("Erro ao buscar produtos da Printful:", error);
          return [];
      }
  }


  // Handle product image upload and cropping
  productImageInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
          const img = new Image();
          img.onload = function () {
              mockupCanvas.width = img.width;
              mockupCanvas.height = img.height;
              ctx.drawImage(img, 0, 0, img.width, img.height);
          };
          img.src = e.target.result;
      };
      reader.readAsDataURL(file);
  });

  // Handle product submission
  submitProductButton.addEventListener("click", async () => {
      const productData = {
          name: productName.value,
          price: parseFloat(productPrice.value) * 1.10, // Add 10% commission
          printfulProductId: selectedPrintfulProductId,
          artistId: auth.currentUser.uid
      };

      // Call secure endpoint
      const response = await fetch('https://your-cloud-function-url/createProduct', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
          },
          body: JSON.stringify(productData)
      });
      
      alert("Produto criado com sucesso!");
  });

  // Function to display products
  async function displayProducts() {
      const db = firebase.firestore();
      const productsContainer = document.getElementById("productsContainer");

      const snapshot = await db.collection("products").orderBy("timestamp", "desc").get();
      productsContainer.innerHTML = "";

      snapshot.forEach((doc) => {
          const product = doc.data();
          const productElement = document.createElement("div");
          productElement.innerHTML = `
              <div class="card">
                  <img src="${product.image}" class="card-img-top">
                  <div class="card-body">
                      <h5>${product.name}</h5>
                      <p>${product.description}</p>
                      <p><strong>Preço:</strong> $${product.price}</p>
                      <button class="btn btn-primary" onclick="comprarProduto('${doc.id}')">Comprar</button>
                  </div>
              </div>
          `;
          productsContainer.appendChild(productElement);
      });
  }

  // Function to save the product to Firestore
  async function saveProductToFirestore(name, description, price, base64Image, userId) {
      console.log("UserID:", userId);
      if (!userId) {
        alert("User ID is missing.");
        return;
      }

      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || !userDoc.data().artista) {
        alert("Achei o espertinho. Só artistas podem fazer produtos.");
        return;
      }
      try {
          await db.collection("products").add({
              foreignUserId: userId,
              Firebase_UID: firebase.auth().currentUser.uid, 
              name: name,
              description: description,
              price: price,
              image: base64Image,
              timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          });

          productModal.hide();
          productName.value = "";
          productDescription.value = "";
          productPrice.value = "";
          productImageInput.value = "";
          productImagePreview.classList.add("d-none");
          selectedProductImageFile = null;

          if (productCropper) {
              productCropper.destroy();
              productCropper = null;
          }

          alert("Product successfully created!");
          displayProducts(); // Refresh the product list
      } catch (error) {
          console.error("Error adding product:", error);
          alert("Failed to create product.");
      }
  }

  // Initialize ProductsManager
  const productsManager = new ProductsManager(db, auth, 'productsContainer');

  // Display products when the page loads
  document.addEventListener('DOMContentLoaded', () => {
      productsManager.displayProducts();
  });
});