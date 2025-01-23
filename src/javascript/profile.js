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
  

  let selectedImageFile = null;
  let cropper;
  let postCropper = null;

  // Add this event listener for the "Create Post" button
  addPostButton.addEventListener("click", () => {
    console.log("Create Post button clicked!"); // Debugging: Log to console
    postModal.show(); // Open the post creation modal
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

    if (!text && !base64Image) {
      alert("Please add some text or an image.");
      return;
    }

    const postText = text.trim() || "No content provided";

    try {
      await db.collection("posts").add({
        foreignUserId: userId,
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
  function getUserIdFromUid(uid) {
    return db
      .collection("users")
      .where("firebaseUID", "==", uid)
      .get()
      .then((querySnapshot) => {
        if (!querySnapshot.empty) {
          return querySnapshot.docs[0].id; // Return the user_(number)
        } else {
          throw new Error(`No user found for UID: ${uid}`);
        }
      });
  }

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
    if (user) {
      getUserIdFromUid(user.uid).then((firestoreUserId) => {
        console.log(`Logging in as: ${firestoreUserId}`);
        
        // Get user document
        const userDocRef = db.collection("users").doc(firestoreUserId);
        
        // Get ratings for the user
        const ratingsQuery = db.collection("ratings").where("foreignUserId", "==", firestoreUserId);
        displayPosts();
        // Execute both queries in parallel
        Promise.all([
          userDocRef.get(),
          ratingsQuery.get()
        ])
        .then(([userDoc, ratingsSnapshot]) => {
          // Handle user data
          if (userDoc.exists) {
            const userData = userDoc.data();
            userNameElement.textContent = userData.user_Name || "No Name Available";
            userEmailElement.textContent = user.email;
            userBioElement.textContent = userData.user_Bio || "No Bio Available";

            if (userData.profilePicture) {
              profilePictureElement.src = `data:image/jpeg;base64,${userData.profilePicture}`;
            }
            
            // Handle ratings data
            const ratings = ratingsSnapshot.docs.map(doc => doc.data().ratingValue);
            const totalRatings = ratings.length;
            
            if (totalRatings > 0) {
              const averageRating = ratings.reduce((a, b) => a + b, 0) / totalRatings;
              document.getElementById("userRating").textContent = 
                `${averageRating.toFixed(1)} ⭐ (${totalRatings} ratings)`;
            } else {
              document.getElementById("userRating").textContent = "No ratings yet";
            }
          } else {
            console.error(`No user data found for UID: ${firestoreUserId}`);
            document.getElementById("userRating").textContent = "Error loading ratings";
          }
        })
        .catch((error) => {
          console.error("Error fetching user data:", error);
          if (error.code === 'permission-denied') {
            alert("You don't have permission to access this profile.");
            window.location.href = "kauara.html";
          } else {
            alert("An error occurred while loading the profile.");
          }
        });
      })
      .catch((error) => {
        console.error("Error getting user ID:", error);
        alert("Error loading user data");
        window.location.href = "kauara.html";
      });
    } else {
      // User is not logged in, redirect to main page
      window.location.href = "kauara.html";
    }
  });
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
  document.getElementById('logoutButton').addEventListener('click', () => {
    auth.signOut().then(() => {
      window.location.href = "kauara.html"; // Redirect to login page
    }).catch((error) => {
      console.error("Error during sign out: ", error);
      alert("Failed to log out.");
    });
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

  // Function to delete the user account and all their posts, comments, and comments on their posts
  async function deleteUserAccountAndPosts(user) {
    try {
      // Get the user's Firestore ID
      const firestoreUserId = await getUserIdFromUid(user.uid);

      // Step 1: Fetch all posts made by the user
      const postsQuery = db.collection("posts").where("foreignUserId", "==", firestoreUserId);
      const postsSnapshot = await postsQuery.get();

      // Step 2: Delete all comments on the user's posts
      const deleteCommentPromises = [];
      postsSnapshot.forEach((postDoc) => {
        const postId = postDoc.id;

        // Fetch all comments on this post
        const commentsQuery = db.collection("comments").where("foreignPostId", "==", postId);
        deleteCommentPromises.push(
          commentsQuery.get().then((commentsSnapshot) => {
            const deleteComments = commentsSnapshot.docs.map((commentDoc) => commentDoc.ref.delete());
            return Promise.all(deleteComments);
          })
        );
      });

      // Step 3: Delete all comments made by the user
      const userCommentsQuery = db.collection("comments").where("foreignUserId", "==", firestoreUserId);
      deleteCommentPromises.push(
        userCommentsQuery.get().then((commentsSnapshot) => {
          const deleteUserComments = commentsSnapshot.docs.map((commentDoc) => commentDoc.ref.delete());
          return Promise.all(deleteUserComments);
        })
      );

      // Step 4: Delete all posts made by the user
      const deletePostPromises = postsSnapshot.docs.map((doc) => doc.ref.delete());

      // Wait for all deletions to complete
      await Promise.all([...deleteCommentPromises, ...deletePostPromises]);

      // Step 5: Delete the user's profile and contact documents
      const userDocRef = db.collection("users").doc(firestoreUserId);
      const contactDocRef = db.collection("contact").doc(firestoreUserId.replace('user', 'contact'));

      await Promise.all([
        userDocRef.delete(),
        contactDocRef.delete()
      ]);

      // Step 6: Delete the user's authentication
      await user.delete();

      // Notify the user and redirect
      alert("Your account and all associated data have been deleted.");
      window.location.href = "kauara.html"; // Redirect to login page
    } catch (error) {
      console.error("Error during account deletion:", error);
      alert("Failed to delete account and associated data.");
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
          postManager.displayPosts(firestoreUserId, firestoreUserId); // Pass the logged-in user's ID as both filterUserId and currentUserId
      }).catch((error) => {
          console.error("Error fetching user ID:", error);
      });
  }
});