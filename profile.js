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

  let cropper;

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
    fileInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          cropImage.src = reader.result;
          cropModal.show();
          cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
          });
        };
        reader.readAsDataURL(file); // Convert the image file to base64
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

    // Function to delete the user account
    function deleteUserAccount() {
      // Get the user ID from Firestore
      getUserIdFromUid(user.uid).then((firestoreUserId) => {
        const userDocRef = db.collection("users").doc(firestoreUserId);
        const contactDocRef = db.collection("contact").doc(firestoreUserId.replace('user', 'contact'));

        // Delete the user and contact documents
        Promise.all([
          userDocRef.delete(),
          contactDocRef.delete()
        ])
          .then(() => {
            console.log("User and contact documents deleted successfully.");

            // Now delete the user's authentication
            user.delete()
              .then(() => {
                console.log("User authentication deleted successfully.");
                alert("Your account has been deleted.");
                window.location.href = "kauara.html"; // Redirect to login page
              })
              .catch((error) => {
                console.error("Error deleting authentication:", error);
                alert("Failed to delete user authentication.");
              });
          })
          .catch((error) => {
            console.error("Error deleting documents:", error);
            alert("Failed to delete user or contact document.");
          });
      })
      .catch((error) => {
        console.error("Error fetching user ID:", error);
        alert("Failed to retrieve user data.");
      });
    }

    // Confirm the deletion with the user before proceeding
    if (confirm("Are you sure you want to delete your account? This action is irreversible.")) {
      deleteUserAccount();
    }
  });


});
