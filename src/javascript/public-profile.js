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
const auth = firebase.auth();

const urlParams = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

console.log("User Id from URL:", userIdFromUrl);

const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer = document.getElementById("ratingContainer");

let ratingSystem;

// Function to fetch the current user's Firestore ID
async function getCurrentUserId() {
    const user = auth.currentUser;
    if (!user) {
        return null; // No user is logged in
    }

    try {
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", user.uid)
            .get();

        if (!userQuery.empty) {
            return userQuery.docs[0].id; // Return the Firestore user ID
        } else {
            throw new Error("No user found for the logged-in UID.");
        }
    } catch (error) {
        console.error("Error fetching current user ID:", error);
        return null;
    }
}

// Function to display posts
async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) {
        console.error("Posts container not found.");
        return;
    }

    // Initialize PostManager with userIdFromUrl
    const postManager = initializePostManager('postsContainer', userIdFromUrl);

    // Current user's ID might be used for other operations, but we're filtering by userIdFromUrl
    const currentUserId = await getCurrentUserId();

    // Pass userIdFromUrl as the filterUserId
    postManager.displayPosts(userIdFromUrl, currentUserId);
}


if (userIdFromUrl) {
    db.collection("users")
        .doc(userIdFromUrl)
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

                // Fetch contact data
                db.collection("contact")
                    .where("foreignUserId", "==", userIdFromUrl)
                    .get()
                    .then(contactSnapshot => {
                        if (!contactSnapshot.empty) {
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
                ratingSystem = new RatingSystem(userIdFromUrl, ratingContainer);

                // Fetch and display posts
                displayPosts(userIdFromUrl);  // Pass userIdFromUrl to display only their posts
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
} else {
    console.error("No user ID found in URL");
}
// Make sure to call this function with userIdFromUrl when you initialize your page
if (userIdFromUrl) {
    displayPosts(userIdFromUrl);
} else {
    console.error("No user ID found in URL");
}