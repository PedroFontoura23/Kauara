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
    const registerConfirmPassword = document.getElementById("registerConfirmPassword");

    // Add password visibility toggle functionality
    togglePasswordVisibility("loginPassword", "toggleLoginPassword");
    togglePasswordVisibility("registerPassword", "toggleRegisterPassword");
    togglePasswordVisibility("registerConfirmPassword", "toggleRegisterConfirmPassword");



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
        const profileButton = document.getElementById("profileButton");

        // Check if the click is outside the modal and not on the profile button
        if (!modal.contains(event.target) && !profileButton.contains(event.target)) {
            closeModal();
        }
    });

    // Select the close button inside the modal
    const modalCloseButton = document.querySelector(".btn-close");

    // Attach the same close logic to the close button
    modalCloseButton.addEventListener("click", function() {
        closeModal();
    });

    // Function to close the modal and remove the backdrop
    function closeModal() {
        const modal = document.getElementById("authModal");
        const modalInstance = bootstrap.Modal.getInstance(modal);
        
        if (modalInstance) {
            modalInstance.hide();  // Close the modal
        }

        // Remove the modal backdrop manually
        const backdrop = document.querySelector(".modal-backdrop");
        if (backdrop) {
            backdrop.remove();  // Remove the lingering backdrop
        }

        // Reset body styles to ensure scrolling is enabled
        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
    }

    // Helper function to toggle password visibility
    function togglePasswordVisibility(inputId, toggleIconId) {
        const passwordInput = document.getElementById(inputId);
        const toggleIcon = document.getElementById(toggleIconId);

        if (passwordInput && toggleIcon) {
            toggleIcon.addEventListener("click", () => {
                // Toggle the input type between "password" and "text"
                if (passwordInput.type === "password") {
                    passwordInput.type = "text";
                    toggleIcon.innerHTML = '<i class="fas fa-eye-slash"></i>'; // Change icon to "eye-slash"
                } else {
                    passwordInput.type = "password";
                    toggleIcon.innerHTML = '<i class="fas fa-eye"></i>'; // Change icon back to "eye"
                }
            });
        }
    }


    // Function to handle error messages without blocking
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";

        setTimeout(() => {
            errorMessage.style.display = "none";
        }, 5000); // Hide error after 5 seconds
    }

    function clearErrorMessage() {
        errorMessage.textContent = "";
        errorMessage.style.display = "none";
    }



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

    // Function to update the profile button behavior
    function updateProfileButtonBehavior(user) {
        if (user && user.emailVerified) {
            // User is logged in and email is verified
            profileButton.textContent = "Profile";
            profileButton.href = "profile.html"; // Set href to profile page
        } else {
            // User is not logged in or email is not verified
            profileButton.textContent = "Log In / Register";
            profileButton.removeAttribute("href"); // Remove href to prevent redirect
        }
    }

    // Check authentication state on page load
    auth.onAuthStateChanged(user => {
        updateProfileButtonBehavior(user);
    });

    // Handle profile button click
    profileButton.addEventListener("click", function (event) {
        const user = auth.currentUser;

        if (user && user.emailVerified) {
            // User is logged in, redirect to profile page
            // Close the modal if it's open
            const modalInstance = bootstrap.Modal.getInstance(authModal);
            if (modalInstance) {
                modalInstance.hide(); // Close the modal
            }
            window.location.href = "profile.html"; // Redirect to profile page
        } else {
            // User is not logged in, show login/register modal
            event.preventDefault(); // Prevent default behavior (e.g., href redirect)
            new bootstrap.Modal(authModal).show(); // Show the modal
        }
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

    auth.onAuthStateChanged(async (user) => {
        if (user && user.emailVerified) {
            console.log("User is logged in and email verified. Checking pending users...");

            try {
                const pendingUserSnapshot = await db.collection("pendingUsers")
                    .where("firebaseUID", "==", user.uid)
                    .get();

                if (!pendingUserSnapshot.empty) {
                    const pendingUserData = pendingUserSnapshot.docs[0].data();
                    const userId = pendingUserData.userId;
                    const contactId = `contact_${userId.split("_")[1]}`;

                    // Move user data to the "users" collection
                    await db.collection("users").doc(userId).set({
                        user_Name: pendingUserData.user_Name,
                        user_Password: pendingUserData.user_Password,
                        user_FullName: pendingUserData.user_FullName,
                        user_Bio: pendingUserData.user_Bio,
                        firebaseUID: pendingUserData.firebaseUID,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        userId: userId
                    });

                    // Create contact document in "contact" collection
                    await db.collection("contact").doc(contactId).set({
                        contactEmail: pendingUserData.contactEmail,
                        contactTelephone: pendingUserData.contactTelephone,
                        foreignUserId: userId,
                        firebaseUID: pendingUserData.firebaseUID,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    // Remove from pendingUsers collection
                    await db.collection("pendingUsers").doc(userId).delete();

                    console.log("User data successfully transferred!");
                    window.location.href = "profile.html"

                    // Remove loading message
                    removeLoadingMessage();
                } else {
                    // Check for user in 'users' collection if not found in pendingUsers
                    const userDoc = await db.collection("users").where("firebaseUID", "==", user.uid).get();

                    if (!userDoc.empty) {
                        console.log("User data found.");
                        removeLoadingMessage();
;
                    } else {
                        removeLoadingMessage();
                        displayErrorMessage("No user data found. Please contact support.");
                    }
                }
            } catch (error) {
                console.error("Error during user verification process:", error);
                removeLoadingMessage();
                displayErrorMessage("An error occurred. Please try again later.");
            }
        } else {
            console.log("No verified user logged in.");
        }
    });

    // Helper function to show a loading message
    function displayLoadingMessage(message) {
        const loadingDiv = document.createElement("div");
        loadingDiv.id = "loadingMessage";
        loadingDiv.style.position = "fixed";
        loadingDiv.style.top = "0";
        loadingDiv.style.left = "0";
        loadingDiv.style.width = "100%";
        loadingDiv.style.height = "100%";
        loadingDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        loadingDiv.style.color = "white";
        loadingDiv.style.display = "flex";
        loadingDiv.style.alignItems = "center";
        loadingDiv.style.justifyContent = "center";
        loadingDiv.style.fontSize = "24px";
        loadingDiv.innerHTML = message;
        document.body.appendChild(loadingDiv);
    }

    // Helper function to remove the loading message
    function removeLoadingMessage() {
        const loadingDiv = document.getElementById("loadingMessage");
        if (loadingDiv) {
            document.body.removeChild(loadingDiv);
        }
    }




    //register function
    registerSubmitButton.addEventListener("click", async () => {
        const email = registerEmail.value.trim();
        const password = registerPassword.value.trim();
        const confirmPassword = registerConfirmPassword.value.trim();
        const name = registerName.value.trim();

        clearErrorMessage();

        if (!email || !password || !confirmPassword || !name) {
            displayErrorMessage("All fields are required.");
            return;
        }

        if (password !== confirmPassword) {
            displayErrorMessage("Passwords do not match.");
            return;
        }

        if (password.length < 6) {
            displayErrorMessage("Password must be at least 6 characters.");
            return;
        }

        try {
            // Check if the user already exists in pending users collection
            const existingUser = await db.collection("pendingUsers").where("contactEmail", "==", email).get();

            if (!existingUser.empty) {
                const pendingUserData = existingUser.docs[0].data();
                const firebaseUID = pendingUserData.firebaseUID;

                // Get the Firebase user object
                const user = await auth.signInWithEmailAndPassword(email, password)
                    .then((userCredential) => userCredential.user)
                    .catch((error) => {
                        console.error("Error signing in:", error);
                        throw error;
                    });

                // Resend the verification email
                await user.sendEmailVerification();
                displayErrorMessage("A verification email has been resent. Please check your inbox.");
                await auth.signOut(); // Sign out the user after resending the email
                return;
            }

            // If the email is not in pendingUsers, proceed with registration
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Fetch current user count for unique ID generation
            const countDoc = await db.collection("usersCount").doc("count").get();
            if (!countDoc.exists) {
                throw new Error("Could not fetch user count.");
            }

            let count = countDoc.data().count;
            const userId = `user_${count + 1}`;
            const contactId = `contact_${count + 1}`;

            // Send verification email
            await user.sendEmailVerification();
            alert(`Verification email sent to ${email}. Please verify your email before logging in.`);

            // Store user data in the temporary pendingUsers collection
            await db.collection("pendingUsers").doc(userId).set({
                user_Name: name,
                user_Password: password,
                user_FullName: name,
                user_Bio: "---",
                firebaseUID: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userId: userId,
                contactEmail: email,
                contactTelephone: "N/A"
            });

            // Increment the users count
            await db.collection("usersCount").doc("count").update({
                count: count + 1
            });

            // Sign the user out after registration to force email verification first
            await auth.signOut();
            window.location.href = "kauara.html";

        } catch (error) {
            console.error("Account creation error:", error);
            switch (error.code) {
                case "auth/email-already-in-use":
                    displayErrorMessage("This email is already registered. Please check your inbox to verify.");
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
        }
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
                            : "../images/default-profile.png";

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

    auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            const postManager = initializePostManager('allPostsContainer');
            postManager.displayPosts(null, firestoreUserId); // Pass the current user's ID
        } catch (error) {
            console.error("Error fetching current user ID:", error);
        }
    }

    async function getUserIdFromUid(uid) {
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", uid)
            .get();

        if (!userQuery.empty) {
            return userQuery.docs[0].id; // Return the Firestore user ID
        } else {
            throw new Error(`No user found for UID: ${uid}`);
        }
    }


});
    function initializePosts() {
        console.log("Initializing posts display");

        // Initialize Firebase if not already initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        const auth = firebase.auth();
        const db = firebase.firestore();

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const firestoreUserId = await getUserIdFromUid(user.uid);
                    const postManager = initializePostManager('allPostsContainer');
                    postManager.displayPosts(null, firestoreUserId); // Pass the current user's ID
                } catch (error) {
                    console.error("Error fetching current user ID:", error);
                }
            }
        });
    }
});