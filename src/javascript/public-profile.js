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
                    <!-- Comment Section -->
                    <div class="comments-container mt-3" id="comments-${doc.id}"></div>
                    <div class="input-group mt-2">
                        <input type="text" class="form-control comment-input" placeholder="Write a comment..." id="commentInput-${doc.id}">
                        <button class="btn btn-outline-primary comment-submit" data-post-id="${doc.id}">Post</button>
                    </div>
                    </div>
                `;

                postElement.innerHTML = postContent;
                postsContainer.appendChild(postElement);

                // Load comments for this post
                loadComments(doc.id, postElement.querySelector(`#comments-${doc.id}`));

                // Add event listener for comment submission
                const commentSubmitButton = postElement.querySelector(".comment-submit");
                const commentInput = postElement.querySelector(".comment-input");

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
                            foreignPostId: doc.id,       // ID of the post being commented on
                            content: commentText,        // The comment text
                            timestamp: firebase.firestore.FieldValue.serverTimestamp() // Timestamp
                        });

                        // Clear the input
                        commentInput.value = "";

                        // Reload comments for this post
                        loadComments(doc.id, postElement.querySelector(`#comments-${doc.id}`));
                    } catch (error) {
                        console.error("Error submitting comment:", error);
                        alert("Failed to submit comment. Please try again.");
                    }
                });
            });

            // Update the last visible post for pagination
            lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
        })
        .catch((error) => {
            console.error("Error fetching posts:", error);
            postsContainer.innerHTML = "<p>There was an error fetching the posts.</p>";
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