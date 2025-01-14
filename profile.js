document.addEventListener("DOMContentLoaded", function () {
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
  const deleteAccountButton = document.getElementById("deleteAccountButton");

  let cropper;

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
    if (user) {
      db.collection("users").doc(user.uid).get().then((doc) => {
        if (doc.exists) {
          const data = doc.data();
          userNameElement.textContent = data.fullName || "No Name Available";
          userEmailElement.textContent = user.email;
          profilePictureElement.src = data.profilePicture
            ? `data:image/jpeg;base64,${data.profilePicture}`
            : "default-profile.png";
          userBioElement.textContent = data.bio || "No bio available. Click edit to add one.";
        } else {
          console.error("User document not found!");
        }
      }).catch((error) => {
        console.error("Error fetching user data:", error);
      });
    } else {
      window.location.href = "kauara.html";
    }
  });

  // Edit Bio functionality
  editBioButton.addEventListener("click", () => {
    bioInput.value = userBioElement.textContent === "No bio available. Click edit to add one." ? "" : userBioElement.textContent;
    bioEditSection.style.display = "block";
  });

  saveBioButton.addEventListener("click", () => {
    const newBio = bioInput.value.trim();
    if (newBio && auth.currentUser) {
      db.collection("users").doc(auth.currentUser.uid).update({ bio: newBio })
        .then(() => {
          userBioElement.textContent = newBio;
          bioEditSection.style.display = "none";
        })
        .catch((error) => {
          console.error("Error updating bio:", error);
          alert("Error updating bio. Please try again.");
        });
    }
  });

  cancelBioButton.addEventListener("click", () => {
    bioEditSection.style.display = "none";
  });

  logoutButton.addEventListener("click", () => {
    auth.signOut().then(() => {
      window.location.href = "kauara.html";
    }).catch((error) => {
      console.error("Error signing out:", error);
    });
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
          if (cropper) cropper.destroy();
          cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
          });
        };
        reader.onerror = () => {
          console.error("Error reading file:", reader.error);
          alert("Failed to load the image. Please try again.");
        };
        reader.readAsDataURL(file);
      } else {
        console.error("No file selected.");
        alert("Please select a valid image file.");
      }
    });

    fileInput.click();
  });

  cropButton.addEventListener("click", () => {
    if (!cropper) {
      alert("Please select and crop an image before saving.");
      return;
    }

    const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });
    canvas.toBlob((blob) => {
      const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
      if (auth.currentUser) {
        db.collection("users").doc(auth.currentUser.uid).update({ profilePicture: base64Image })
          .then(() => {
            profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`;
            cropModal.hide();
            cropper.destroy();
          })
          .catch((error) => {
            console.error("Error updating profile picture:", error);
            alert("Error updating profile picture.");
          });
      }
    }, "image/jpeg");
  });

  editNameButton.addEventListener("click", () => {
    nameInput.value = userNameElement.textContent.trim();
    nameEditSection.style.display = "block";
  });

  saveNameButton.addEventListener("click", () => {
    const newName = nameInput.value.trim();
    if (newName && auth.currentUser) {
      db.collection("users").doc(auth.currentUser.uid).update({ fullName: newName })
        .then(() => {
          userNameElement.textContent = newName;
          nameEditSection.style.display = "none";
        })
        .catch((error) => {
          console.error("Error updating name:", error);
          alert("Error updating name. Please try again.");
        });
    }
  });

  cancelNameButton.addEventListener("click", () => {
    nameEditSection.style.display = "none";
  });

  // Delete account functionality
  deleteAccountButton.addEventListener("click", () => {
    if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      const user = auth.currentUser;
      if (user) {
        db.collection("users").doc(user.uid).delete()
          .then(() => {
            user.delete()
              .then(() => {
                alert("Account successfully deleted.");
                window.location.href = "kauara.html";
              })
              .catch((error) => {
                console.error("Error deleting account:", error);
                alert("Failed to delete account. Please try again.");
              });
          })
          .catch((error) => {
            console.error("Error deleting user data:", error);
            alert("Failed to delete account data. Please try again.");
          });
      }
    }
  });
});
