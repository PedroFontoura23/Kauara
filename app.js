document.addEventListener("DOMContentLoaded", function () {
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

    // Firebase Authentication and Firestore
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Get references to the elements
    const profileButton = document.getElementById("profileButton");
    const authModal = document.getElementById("authModal");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const registerEmail = document.getElementById("registerEmail");
    const registerPassword = document.getElementById("registerPassword");
    const registerName = document.getElementById("registerName");
    const loginSubmitButton = document.getElementById("loginSubmitButton");
    const registerSubmitButton = document.getElementById("registerSubmitButton");
    const showLoginButton = document.getElementById("showLogin");
    const showRegisterButton = document.getElementById("showRegister");
    const errorMessage = document.getElementById("errorMessage");
    const searchInput = document.getElementById("searchInput");
    const searchResultsContainer = document.getElementById("searchResultsContainer");
    const searchForm = document.getElementById("searchForm");
    const searchResults = document.getElementById("searchResults");

    // Helper Functions
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
    }

    function clearErrorMessage() {
        errorMessage.textContent = "";
        errorMessage.style.display = "none";
    }

    // Handle clicks outside the modal to close it
    document.addEventListener("click", function(event) {
        const modal = document.getElementById("authModal");

        // Check if the click is outside the modal and its content
        if (!modal.contains(event.target) && !profileButton.contains(event.target)) {
            // Close the modal without reloading the page
            const modalInstance = bootstrap.Modal.getInstance(modal);
            modalInstance.hide();  // Close the modal
        }
    });



    // Show/Hide Form Functions
    showLoginButton.addEventListener("click", () => {
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";
        clearErrorMessage();
    });

    showRegisterButton.addEventListener("click", () => {
        registerForm.style.display = "block";
        loginForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Register";
        clearErrorMessage();
    });

    // Show the modal when clicking the profile button
    profileButton.addEventListener("click", () => {
        new bootstrap.Modal(authModal).show();
    });

    // Login Logic
    loginSubmitButton.addEventListener("click", () => {
        const email = loginEmail.value.trim();
        const password = loginPassword.value.trim();

        clearErrorMessage();

        if (!email || !password) {
            displayErrorMessage("Please enter both email and password.");
            return;
        }

        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;

                if (!user.emailVerified) {
                    auth.signOut();
                    displayErrorMessage("Please verify your email before logging in.");
                    return;
                }

                // Find user in contact collection
                db.collection("contact")
                    .where("firebaseUID", "==", user.uid)
                    .get()
                    .then((querySnapshot) => {
                        if (!querySnapshot.empty) {
                            window.location.href = "profile.html";
                        } else {
                            displayErrorMessage("User profile not found.");
                        }
                    })
                    .catch((error) => {
                        console.error("Error fetching contact data:", error);
                        displayErrorMessage("Error accessing user data.");
                    });
            })
            .catch((error) => {
                console.error("Login error:", error);
                displayErrorMessage("Invalid email or password.");
            });
    });

    // Registration Logic
    registerSubmitButton.addEventListener("click", () => {
        const email = registerEmail.value.trim();
        const password = registerPassword.value.trim();
        const name = registerName.value.trim();

        clearErrorMessage();

        if (!email || !password || !name) {
            displayErrorMessage("All fields are required.");
            return;
        }

        if (password.length < 6) {
            displayErrorMessage("Password must be at least 6 characters.");
            return;
        }

        auth.createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;

                // Fetch current user count
                db.collection("usersCount").doc("count").get()
                    .then((doc) => {
                        if (doc.exists) {
                            let count = doc.data().count;
                            const userId = `user_${count + 1}`;
                            const contactId = `contact_${count + 1}`;

                            // Create user document
                            return db.collection("users").doc(userId).set({
                                user_Name: name,
                                user_Password: password,
                                user_FullName: name,
                                user_Bio: "---",
                                firebaseUID: user.uid,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                userId: userId
                            })
                            .then(() => {
                                // Create contact document
                                return db.collection("contact").doc(contactId).set({
                                    contactEmail: email,
                                    contactTelephone: "N/A",
                                    foreignUserId: userId,
                                    firebaseUID: user.uid,
                                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                                });
                            })
                            .then(() => {
                                // Update users count
                                return db.collection("usersCount").doc("count").update({
                                    count: count + 1
                                });
                            })
                            .then(() => {
                                // Send verification email
                                return user.sendEmailVerification();
                            })
                            .then(() => {
                                alert(`Verification email sent to ${email}. Please verify your email before logging in.`);
                                return auth.signOut();
                            })
                            .then(() => {
                                window.location.href = "kauara.html";
                            });
                        } else {
                            throw new Error("Could not fetch user count.");
                        }
                    })
                    .catch((error) => {
                        console.error("Error during registration:", error);
                        user.delete();
                        displayErrorMessage("Registration failed. Please try again.");
                    });
            })
            .catch((error) => {
                console.error("Account creation error:", error);
                switch (error.code) {
                    case "auth/email-already-in-use":
                        displayErrorMessage("This email is already registered.");
                        break;
                    case "auth/invalid-email":
                        displayErrorMessage("Please enter a valid email address.");
                        break;
                    case "auth/weak-password":
                        displayErrorMessage("Please choose a stronger password.");
                        break;
                    default:
                        displayErrorMessage("Registration failed. Please try again.");
                }
            });
    });

    // Search Functionality
    searchInput.addEventListener("input", function() {
        const query = searchInput.value.trim();
        const lowercaseQuery = query.toLowerCase();

        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = "";
            searchResultsContainer.innerHTML = "";
            return;
        }

        db.collection("users")
            .get()
            .then((snapshot) => {
                searchResults.innerHTML = "";

                const matchingDocs = snapshot.docs.filter(doc => {
                    const userData = doc.data();
                    return userData.user_Name && userData.user_Name.toLowerCase().includes(lowercaseQuery);
                });

                if (matchingDocs.length > 0) {
                    matchingDocs.forEach((doc) => {
                        const userData = doc.data();
                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.user_Name;

                        listItem.addEventListener("click", () => {
                            searchInput.value = userData.user_Name;
                            searchResults.style.display = "none";
                            performSearch(userData.user_Name);
                        });

                        searchResults.appendChild(listItem);
                    });
                    searchResults.style.display = "block";
                } else {
                    const noResultsItem = document.createElement("li");
                    noResultsItem.className = "dropdown-item text-muted";
                    noResultsItem.textContent = "No results found";
                    searchResults.appendChild(noResultsItem);
                    searchResults.style.display = "block";
                }
            })
            .catch((error) => {
                console.error("Error searching users:", error);
            });
    });

    // Perform Search Function
    function performSearch(query) {
        searchResultsContainer.innerHTML = "";
        const lowercaseQuery = query.toLowerCase();

        db.collection("users")
            .get()
            .then((snapshot) => {
                let foundResults = false;
                const processedIds = new Set();

                snapshot.docs.forEach((doc) => {
                    const userData = doc.data();
                    if (userData.user_Name && 
                        userData.user_Name.toLowerCase().includes(lowercaseQuery) && 
                        !processedIds.has(userData.userId)) {
                        
                        foundResults = true;
                        processedIds.add(userData.userId);

                        const preview = document.createElement("div");
                        preview.className = "card mb-3";
                        preview.style.cursor = "pointer";

                        const profilePictureUrl = userData.profilePicture
                            ? `data:image/jpeg;base64,${userData.profilePicture}`
                            : "default-profile.png";

                        preview.innerHTML = `
                            <div class="row g-0 align-items-center">
                                <div class="col-2">
                                    <img src="${profilePictureUrl}" class="img-fluid rounded-circle" 
                                         alt="Profile Picture" style="width: 50px; height: 50px;">
                                </div>
                                <div class="col-10">
                                    <div class="card-body">
                                        <h5 class="card-title">${userData.user_Name}</h5>
                                    </div>
                                </div>
                            </div>
                        `;

                        preview.addEventListener("click", () => {
                            window.location.href = `public-profile.html?userId=${encodeURIComponent(userData.userId)}`;
                        });

                        searchResultsContainer.appendChild(preview);
                    }
                });

                if (!foundResults) {
                    searchResultsContainer.innerHTML = "<p>No results found.</p>";
                }
            })
            .catch((error) => {
                console.error("Error searching users:", error);
                searchResultsContainer.innerHTML = "<p>An error occurred. Please try again later.</p>";
            });
    }

    // Handle search form submission
    searchForm.addEventListener("submit", function(event) {
        event.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            performSearch(query);
        }
    });
    

    // Handle clicks outside search results
    document.addEventListener("click", (event) => {
        if (!searchInput.contains(event.target) && !searchResults.contains(event.target)) {
            searchResults.style.display = "none";
        }
    });

    // Check authentication state
    auth.onAuthStateChanged(user => {
        if (user && user.emailVerified) {
            profileButton.textContent = "Profile";
            profileButton.onclick = () => {
                window.location.href = "profile.html";
            };
        } else {
            profileButton.textContent = "Log In / Register";
            profileButton.onclick = () => {
                new bootstrap.Modal(authModal).show();
            };
        }
    });
});
function initializePosts() {
    console.log("Initializing posts display");
    const allPostsContainer = document.getElementById("allPostsContainer");
    const db = firebase.firestore();

    if (!allPostsContainer) {
        console.error("Posts container not found");
        return;
    }

    function displayAllPosts() {
        console.log("Starting to fetch posts");
        allPostsContainer.innerHTML = "";

        db.collection("posts")
            .orderBy("timestamp", "desc")
            .get()
            .then((querySnapshot) => {
                console.log(`Found ${querySnapshot.size} posts`);
                const postPromises = querySnapshot.docs.map(async (doc) => {
                    const postData = doc.data();
                    console.log("Post data:", postData);
                    
                    try {
                        const userDoc = await db.collection("users")
                            .doc(postData.foreignUserId)  // Changed from userId to foreignUserId
                            .get();
                        
                        if (!userDoc.exists) {
                            console.error(`No user found for ID: ${postData.foreignUserId}`);
                            return null;
                        }

                        const userData = userDoc.data();
                        console.log("User data found:", userData.user_Name);
                        
                        return {
                            postId: doc.id,
                            ...postData,
                            userName: userData.user_Name || "Unknown User",
                            userProfilePic: userData.profilePicture || null
                        };
                    } catch (error) {
                        console.error("Error fetching user data:", error);
                        return null;
                    }
                });

                return Promise.all(postPromises);
            })
            .then((posts) => {
                const validPosts = posts.filter(post => post !== null);
                console.log(`Displaying ${validPosts.length} valid posts`);
                
                if (validPosts.length === 0) {
                    allPostsContainer.innerHTML = '<p class="text-muted">No posts available</p>';
                    return;
                }

                validPosts.forEach(post => {
                    const postElement = createPostElement(post);
                    allPostsContainer.appendChild(postElement);
                });
            })
            .catch((error) => {
                console.error("Error fetching posts:", error);
                allPostsContainer.innerHTML = `
                    <div class="alert alert-danger">
                        Error loading posts. Please try again later.
                        <br>
                        Error details: ${error.message}
                    </div>
                `;
            });
    }

    function createPostElement(post) {
        const postDiv = document.createElement("div");
        postDiv.className = "card mb-4";
        
        // Format timestamp
        const timestamp = post.timestamp?.toDate() || new Date();
        const formattedDate = timestamp.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Create post HTML structure
        postDiv.innerHTML = `
            <div class="card-header d-flex align-items-center">
                <img src="${post.userProfilePic ? `data:image/jpeg;base64,${post.userProfilePic}` : '/default-profile.jpg'}"
                     class="rounded-circle me-2"
                     alt="Profile Picture"
                     style="width: 40px; height: 40px; object-fit: cover;">
                <div>
                    <h6 class="mb-0">${post.userName}</h6>
                    <small class="text-muted">${formattedDate}</small>
                </div>
            </div>
            <div class="card-body">
                <p class="card-text">${post.postText}</p>
                ${post.postImage ? `
                    <img src="data:image/jpeg;base64,${post.postImage}"
                         class="img-fluid rounded"
                         alt="Post Image"
                         style="max-height: 500px; width: auto;">
                ` : ''}
            </div>
        `;

        return postDiv;
    }

    // Initial load of posts
    console.log("Starting initial posts load");
    displayAllPosts();

    db.collection("posts")
      .orderBy("timestamp", "desc")
      .onSnapshot((snapshot) => {
        // Update only when changes occur
      });
}

// In your main DOMContentLoaded listener, add:
document.addEventListener("DOMContentLoaded", function () {
    // ... your existing initialization code ...
    
    // Initialize posts at the end of your main initialization
    initializePosts();
});
