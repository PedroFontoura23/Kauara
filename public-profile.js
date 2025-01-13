// Firebase Initialization
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

// Firebase Firestore
const db = firebase.firestore();

// Get the email from the URL parameters
const urlParams = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

console.log("User Id from URL:", userIdFromUrl);

// Get reference to elements where we display user info
const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");

// Fetch the user data from Firestore based on email
if (userIdFromUrl) {
    db.collection("users")
        .where("userId", "==", userIdFromUrl)  // Query by email
        .get()
        .then(snapshot => {
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                userNameElement.textContent = userData.fullName || "No Name Available";
                userEmailElement.textContent = userData.email || "No Email Available";
                userBioElement.textContent = userData.bio || "No bio available";

                // Display the profile picture, checking for Base64 or default
                const profilePic = userData.profilePicture;
                if (profilePic) {
                    profilePictureElement.src = `data:image/jpeg;base64,${profilePic}`;
                } else {
                    profilePictureElement.src = "default-profile.png";
                }
            } else {
                userNameElement.textContent = "User not found";
                userEmailElement.textContent = "";
                userBioElement.textContent = "";
                profilePictureElement.src = "default-profile.png";
            }
        })
        .catch(error => {
            console.error("Error fetching user data:", error);
        });
}
