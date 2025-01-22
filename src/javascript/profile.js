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
    if (confirm("Are you sure you want to delete your account and all your posts? This action is irreversible.")) {
      deleteUserAccountAndPosts(user);
    }
  });

  // Function to delete the user account and all their posts
  async function deleteUserAccountAndPosts(user) {
    try {
      // Get the user's Firestore ID
      const firestoreUserId = await getUserIdFromUid(user.uid);

      // Step 1: Fetch all posts with the user's foreignUserId
      const postsQuery = db.collection("posts").where("foreignUserId", "==", firestoreUserId);
      const postsSnapshot = await postsQuery.get();

      // Step 2: Delete each post
      const deletePostPromises = [];
      postsSnapshot.forEach((doc) => {
        deletePostPromises.push(doc.ref.delete());
      });

      // Wait for all posts to be deleted
      await Promise.all(deletePostPromises);
      console.log("All posts deleted successfully.");

      // Step 3: Delete the user's profile and contact documents
      const userDocRef = db.collection("users").doc(firestoreUserId);
      const contactDocRef = db.collection("contact").doc(firestoreUserId.replace('user', 'contact'));

      await Promise.all([
        userDocRef.delete(),
        contactDocRef.delete()
      ]);
      console.log("User and contact documents deleted successfully.");

      // Step 4: Delete the user's authentication
      await user.delete();
      console.log("User authentication deleted successfully.");

      // Notify the user and redirect
      alert("Your account and all associated posts have been deleted.");
      window.location.href = "kauara.html"; // Redirect to login page
    } catch (error) {
      console.error("Error during account deletion:", error);
      alert("Failed to delete account and posts.");
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
          db.collection("posts")
              .where("foreignUserId", "==", firestoreUserId) // Only fetch posts for the logged-in user
              .orderBy("timestamp", "desc") // Order by most recent
              .get()
              .then((querySnapshot) => {
                  const postsContainer = document.getElementById("allPostsContainer");

                  if (!postsContainer) {
                      console.error("Posts container element not found.");
                      return;
                  }

                  postsContainer.innerHTML = ""; // Clear the container before adding new posts

                  if (querySnapshot.empty) {
                      // Display a message if no posts are found
                      const noPostsMessage = document.createElement("p");
                      noPostsMessage.textContent = "No posts available. Create your first post!";
                      noPostsMessage.classList.add("text-muted", "text-center");
                      postsContainer.appendChild(noPostsMessage);
                      return;
                  }

                  querySnapshot.forEach((doc) => {
                      const post = doc.data();
                      const postId = doc.id; // Get the document ID for deleting later
                      const postElement = document.createElement("div");
                      postElement.classList.add("card", "mb-4");

                      // Add the post text
                      const postText = document.createElement("p");
                      postText.textContent = post.postText;
                      postElement.appendChild(postText);

                      // If there's an image, display it
                      if (post.postImage) {
                          const postImage = document.createElement("img");
                          postImage.src = `data:image/jpeg;base64,${post.postImage}`; // Ensure proper interpolation
                          postImage.alt = "Post image";
                          postImage.classList.add("img-fluid", "mt-2");
                          postElement.appendChild(postImage);
                      }

                      // Add timestamp
                      const timestamp = post.timestamp.toDate(); // Convert Firestore timestamp to JavaScript Date
                      const formattedTimestamp = formatTimestamp(timestamp); // Use the helper function
                      const postTimestamp = document.createElement("p");
                      postTimestamp.textContent = `Posted on: ${formattedTimestamp}`;
                      postTimestamp.classList.add("text-muted", "mt-2", "mb-0");
                      postElement.appendChild(postTimestamp);

                      // Add delete button
                      const deleteButton = document.createElement("button");
                      deleteButton.textContent = "Delete";
                      deleteButton.classList.add("btn", "btn-danger", "mt-2");
                      deleteButton.addEventListener("click", () => {
                          deletePost(postId); // Call the delete function when button is clicked
                      });
                      postElement.appendChild(deleteButton);

                      // Add comment section
                      const commentsContainer = document.createElement("div");
                      commentsContainer.id = `comments-${postId}`;
                      commentsContainer.classList.add("comments-container", "mt-3");
                      postElement.appendChild(commentsContainer);

                      // Add comment input and submit button
                      const commentInputGroup = document.createElement("div");
                      commentInputGroup.classList.add("input-group", "mt-2");

                      const commentInput = document.createElement("input");
                      commentInput.type = "text";
                      commentInput.classList.add("form-control", "comment-input");
                      commentInput.placeholder = "Write a comment...";
                      commentInput.id = `commentInput-${postId}`;

                      const commentSubmitButton = document.createElement("button");
                      commentSubmitButton.textContent = "Post";
                      commentSubmitButton.classList.add("btn", "btn-outline-primary", "comment-submit");
                      commentSubmitButton.setAttribute("data-post-id", postId);

                      commentInputGroup.appendChild(commentInput);
                      commentInputGroup.appendChild(commentSubmitButton);
                      postElement.appendChild(commentInputGroup);

                      // Load comments for this post
                      loadComments(postId, commentsContainer);

                      // Add event listener for comment submission
                      commentSubmitButton.addEventListener("click", async () => {
                          const commentText = commentInput.value.trim();
                          if (!commentText) {
                              alert("Please enter a comment.");
                              return;
                          }

                          const user = auth.currentUser;
                          if (!user) {
                              alert("You must be logged in to comment.");
                              return;
                          }

                          try {
                              // Fetch the custom user_id from the users collection
                              const userQuery = await db.collection("users")
                                  .where("firebaseUID", "==", user.uid)
                                  .get();

                              if (userQuery.empty) {
                                  alert("User data not found. Please contact support.");
                                  return;
                              }

                              const customUserId = userQuery.docs[0].data().userId;

                              // Save the comment to Firestore
                              await db.collection("comments").add({
                                  foreignUserId: customUserId, // Use the custom user_id
                                  foreignPostId: postId,       // ID of the post being commented on
                                  content: commentText,        // The comment text
                                  timestamp: firebase.firestore.FieldValue.serverTimestamp() // Timestamp
                              });

                              // Clear the input
                              commentInput.value = "";

                              // Reload comments for this post
                              loadComments(postId, commentsContainer);
                          } catch (error) {
                              console.error("Error submitting comment:", error);
                              alert("Failed to submit comment. Please try again.");
                          }
                      });

                      // Add the post element to the container
                      postsContainer.appendChild(postElement);
                  });
              })
              .catch((error) => {
                  console.error("Error fetching posts:", error);
                  const postsContainer = document.getElementById("allPostsContainer");
                  if (postsContainer) {
                      postsContainer.innerHTML = `<p class="text-danger">Error loading posts. Please try again later.</p>`;
                  }
              });
      }).catch((error) => {
          console.error("Error fetching user ID:", error);
      });
  }

  // Function to load comments for a post
  async function loadComments(postId, commentsContainer) {
      commentsContainer.innerHTML = ""; // Clear existing comments

      try {
          const commentsSnapshot = await db.collection("comments")
              .where("foreignPostId", "==", postId)
              .orderBy("timestamp", "asc")
              .get();

          if (commentsSnapshot.empty) {
              commentsContainer.innerHTML = '<p class="text-muted">No comments yet.</p>';
              return;
          }

          // Display each comment
          commentsSnapshot.forEach(async (doc) => {
              const commentData = doc.data();

              // Fetch user data for the comment
              const userQuery = await db.collection("users")
                  .where("userId", "==", commentData.foreignUserId)
                  .get();

              if (userQuery.empty) {
                  console.error("User not found for comment:", commentData.foreignUserId);
                  return;
              }

              const userData = userQuery.docs[0].data();
              const userName = userData.user_Name || "Unknown User";
              const userProfilePic = userData.profilePicture || null;

              // Create comment element
              const commentElement = document.createElement("div");
              commentElement.className = "mb-3 d-flex align-items-center";

              // Add profile picture
              const profilePicElement = document.createElement("img");
              profilePicElement.src = userProfilePic ? `data:image/jpeg;base64,${userProfilePic}` : "default-profile.png";
              profilePicElement.className = "rounded-circle me-2";
              profilePicElement.style.width = "40px";
              profilePicElement.style.height = "40px";
              profilePicElement.style.cursor = "pointer";
              profilePicElement.setAttribute("data-user-id", commentData.foreignUserId);

              // Add click event to profile picture
              profilePicElement.addEventListener("click", () => {
                  const userId = profilePicElement.getAttribute("data-user-id");
                  window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
              });

              // Add comment content
              const commentContent = document.createElement("div");
              commentContent.className = "d-flex flex-column";

              // Add commenter's name (clickable)
              const commenterName = document.createElement("strong");
              commenterName.textContent = userName;
              commenterName.style.cursor = "pointer";
              commenterName.setAttribute("data-user-id", commentData.foreignUserId);

              // Add click event to commenter's name
              commenterName.addEventListener("click", () => {
                  const userId = commenterName.getAttribute("data-user-id");
                  window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
              });

              // Add comment text
              const commentText = document.createElement("span");
              commentText.textContent = commentData.content;

              // Add timestamp
              const commentTimestamp = document.createElement("small");
              commentTimestamp.className = "text-muted";
              commentTimestamp.textContent = commentData.timestamp.toDate().toLocaleString();

              // Append elements
              commentContent.appendChild(commenterName);
              commentContent.appendChild(commentText);
              commentContent.appendChild(commentTimestamp);

              commentElement.appendChild(profilePicElement);
              commentElement.appendChild(commentContent);

              commentsContainer.appendChild(commentElement);
          });
      } catch (error) {
          console.error("Error loading comments:", error);
          commentsContainer.innerHTML = '<p class="text-danger">Error loading comments.</p>';
      }
  }


});