// public-profile.js
const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

console.log("User Id from URL:", userIdFromUrl);

const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer = document.getElementById("ratingContainer");

if (userIdFromUrl) {
    // Fetch user data from the "users" collection
    db.collection("users")
        .doc(userIdFromUrl) // Assuming the userId is the document ID
        .get()
        .then(userDoc => {
            if (userDoc.exists) {
                const userData = userDoc.data();
                userNameElement.textContent = userData.user_Name || "No Name Available";
                userBioElement.textContent = userData.user_Bio || "No bio available";

                const profilePic = userData.profilePicture;
                if (profilePic) {
                    profilePictureElement.src = `data:image/jpeg;base64,${profilePic}`;
                } else {
                    profilePictureElement.src = "default-profile.png";
                }

                // Fetch contact data from the "contact" collection where foreignUserId equals userId
                db.collection("contact")
                    .where("foreignUserId", "==", userIdFromUrl) // Match foreignUserId to userId
                    .get()
                    .then(contactSnapshot => {
                        if (!contactSnapshot.empty) {
                            // Assuming there's only one contact document per user
                            const contactData = contactSnapshot.docs[0].data();
                            userEmailElement.textContent = contactData.contactEmail || "No Email Available";
                        } else {
                            userEmailElement.textContent = "No Contact Info Available";
                        }
                    })
                    .catch(error => {
                        console.error("Error fetching contact data:", error);
                        userEmailElement.textContent = "Error fetching contact info";
                    });

                // Initialize rating system
                new RatingSystem(userDoc.id, ratingContainer);
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
