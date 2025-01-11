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

const db = firebase.firestore();

// Get the query parameter from the URL
const urlParams = new URLSearchParams(window.location.search);
const query = urlParams.get("query");

// Elements to display user data
const userNameElement = document.getElementById("userName");
const profilePictureElement = document.getElementById("profilePicture");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");

// Fetch user data based on query
if (query) {
    db.collection("users")
        .where("fullName", "==", query) // Search by email; change this to "fullName" if needed
        .get()
        .then((snapshot) => {
            if (!snapshot.empty) {
                // If a user is found, retrieve their data
                const userData = snapshot.docs[0].data();
                userNameElement.textContent = userData.fullName || "No Name Available";
                profilePictureElement.src = userData.profilePicture || "default-profile.png";
                userEmailElement.textContent = userData.email || "No Email Available";
                userBioElement.textContent = userData.message || "No Bio Available";
            } else {
                // If no user is found, display a message
                userNameElement.textContent = "User Not Found";
                userEmailElement.textContent = "N/A";
                userBioElement.textContent = "N/A";
            }
        })
        .catch((error) => {
            console.error("Error fetching user data:", error);
            userNameElement.textContent = "Error Loading Profile";
            userEmailElement.textContent = "N/A";
            userBioElement.textContent = "N/A";
        });
} else {
    // If no query parameter is provided
    userNameElement.textContent = "No Query Provided";
    userEmailElement.textContent = "N/A";
    userBioElement.textContent = "N/A";
}
