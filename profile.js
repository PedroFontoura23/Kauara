document.addEventListener("DOMContentLoaded", function() {
  // Initialize Firebase
  const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
  };
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Elements
  const userNameElement = document.getElementById("userName");
  const userEmailElement = document.getElementById("userEmail");
  const profilePictureElement = document.getElementById("profilePicture");
  const userBioElement = document.getElementById("userBio");
  const editBioButton = document.getElementById("editBioButton");
  const logoutButton = document.getElementById("logoutButton");
  const bioEditSection = document.getElementById("bioEditSection");
  const bioInput = document.getElementById("bioInput");
  const saveBioButton = document.getElementById("saveBioButton");
  const cancelBioButton = document.getElementById("cancelBioButton");
  const uploadPictureButton = document.getElementById("uploadPictureButton");
  const cropModal = new bootstrap.Modal(document.getElementById("cropModal"));
  const cropImage = document.getElementById("cropImage");
  const cropButton = document.getElementById("cropButton");
  const editNameButton = document.getElementById("editNameButton");
  const nameEditSection = document.getElementById("nameEditSection");
  const nameInput = document.getElementById("nameInput");
  const saveNameButton = document.getElementById("saveNameButton");
  const cancelNameButton = document.getElementById("cancelNameButton");

  let cropper;

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Fetch user data from Firestore
      db.collection("users").doc(user.uid).get().then((doc) => {
        if (doc.exists) {
          const data = doc.data();
          userNameElement.textContent = data.fullName || "No Name Available";
          userEmailElement.textContent = user.email;
          
          // Check if there's a Base64 string for the profile picture
          if (data.profilePicture) {
            profilePictureElement.src = `data:image/jpeg;base64,${data.profilePicture}`; // Load Base64 image
          } else {
            profilePictureElement.src = "default-profile.png"; // Default image if none exists
          }
          
          userBioElement.textContent = data.bio || "No bio available. Click edit to add one.";
        } else {
          console.error("User document not found!");
        }
      }).catch((error) => {
        console.error("Error fetching user data:", error);
      });
    } else {
      window.location.href = "kauara.html"; // Redirect to main page if not logged in
    }
  });

  // Edit Bio functionality
  editBioButton.addEventListener('click', () => {
    bioInput.value = userBioElement.textContent === 'No bio available. Click edit to add one.' ? '' : userBioElement.textContent;
    bioEditSection.style.display = 'block'; // Show the bio edit section
  });

  // Save bio to Firestore
  saveBioButton.addEventListener('click', () => {
    const newBio = bioInput.value.trim();
    if (newBio && auth.currentUser) {
      const userRef = db.collection('users').doc(auth.currentUser.uid);
      userRef.update({ bio: newBio })
        .then(() => {
          userBioElement.textContent = newBio;
          bioEditSection.style.display = 'none'; // Close the bio edit section
        })
        .catch((error) => {
          console.error('Error updating bio:', error);
          alert('Error updating bio. Please try again.');
        });
    }
  });

  // Cancel bio editing
  cancelBioButton.addEventListener('click', () => {
    bioEditSection.style.display = 'none'; // Hide the bio edit section without saving
  });

  // Logout functionality
  logoutButton.addEventListener('click', function() {
    auth.signOut().then(() => {
      window.location.href = 'kauara.html'; // Redirect to the main page after logout
    }).catch((error) => {
      console.error("Error signing out: ", error);
    });
  });

  // File upload and cropping
  uploadPictureButton.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', (event) => {
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
  cropButton.addEventListener('click', () => {
    const canvas = cropper.getCroppedCanvas({
      width: 300,
      height: 300,
    });

    canvas.toBlob((blob) => {
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1]; // Convert the canvas to Base64
      const user = auth.currentUser;
      if (user) {
        const userRef = db.collection('users').doc(user.uid);
        userRef.update({ profilePicture: base64Image })
          .then(() => {
            profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`; // Display the image
            cropModal.hide();
            cropper.destroy();
          })
          .catch((error) => {
            console.error('Error updating profile picture:', error);
            alert('Error updating profile picture.');
          });
      }
    }, 'image/jpeg');
  });
      // Edit Name functionality
    editNameButton.addEventListener("click", () => {
        nameInput.value = userNameElement.textContent.trim(); // Pre-fill input with current name
        nameEditSection.style.display = "block"; // Show name edit section
    });

    // Save Name to Firestore
    saveNameButton.addEventListener("click", () => {
        const newName = nameInput.value.trim();
        if (newName && auth.currentUser) {
            const userRef = db.collection("users").doc(auth.currentUser.uid);
            userRef.update({ fullName: newName })
                .then(() => {
                    userNameElement.textContent = newName; // Update UI with new name
                    nameEditSection.style.display = "none"; // Hide name edit section
                })
                .catch((error) => {
                    console.error("Error updating name:", error);
                    alert("Error updating name. Please try again.");
                });
        }
    });

    // Cancel name editing
    cancelNameButton.addEventListener("click", () => {
        nameEditSection.style.display = "none"; // Hide name edit section without saving
    });
});
