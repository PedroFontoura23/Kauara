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

if (userIdFromUrl) {
    // Fetch user data from the "users" collection
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

                // Fetch contact data from the "contact" collection where foreignUserId equals userId
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

                // Initialize rating system and assign it to the global variable
                ratingSystem = new RatingSystem(userIdFromUrl, ratingContainer);

                // Fetch and display the posts made by the user
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

let lastVisible = null;

function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) return;

    postsContainer.innerHTML = "<p>Loading posts...</p>"; // Show loading text initially

    console.log("Fetching posts for userId:", userIdFromUrl); // Log the userId from URL for debugging

    // Set up the query to fetch posts for this user, ordered by timestamp (descending)
    let query = db.collection("posts")
        .where("foreignUserId", "==", userIdFromUrl)  // Filter posts by foreignUserId field
        .orderBy("timestamp", "desc")  // Sort posts by timestamp in descending order
        .limit(10);  // Limit to 10 posts per page for pagination

    // Add pagination support if we already have a "lastVisible" document
    if (lastVisible) {
        query = query.startAfter(lastVisible);
    }

    query.get()
        .then((querySnapshot) => {
            console.log("Query snapshot size:", querySnapshot.size); // Log the number of posts retrieved

            // Show message about how many posts were fetched
            const numberOfPostsFetched = querySnapshot.size;
            postsContainer.innerHTML = `<p>${numberOfPostsFetched} posts fetched.</p>`;

            // If no posts are found, display a message
            if (querySnapshot.empty) {
                postsContainer.innerHTML = "<p>No posts available for this user.</p>";
                return;
            }

            // Process each post
            querySnapshot.forEach((doc) => {
                const postData = doc.data();
                console.log("Fetched post data:", postData); // Log the post data to check

                const postElement = document.createElement("div");
                postElement.classList.add("card", "mb-3");

                let postContent = `
                    <div class="card-body">
                        <p class="card-text">${postData.postText}</p>
                `;

                if (postData.postImage) {
                    postContent += `
                        <img src="data:image/jpeg;base64,${postData.postImage}" 
                             class="img-fluid mt-2" 
                             alt="Post image">
                    `;
                }

                postContent += `
                    <p class="text-muted mt-2 mb-0">
                        Posted on ${postData.timestamp ? postData.timestamp.toDate().toLocaleString() : "Just now"}
                    </p>
                    <!-- Remove the Delete button from this page -->
                    </div>
                `;

                postElement.innerHTML = postContent;
                postsContainer.appendChild(postElement);
            });

            // Update the last visible post for pagination
            lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        })
        .catch((error) => {
            console.error("Error fetching posts:", error);
            postsContainer.innerHTML = "<p>There was an error fetching the posts.</p>";
        });
}
