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

    // Show Login form when clicking "Log In"
    showLoginButton.addEventListener("click", () => {
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";
    });

    // Show Register form when clicking "Register"
    showRegisterButton.addEventListener("click", () => {
        registerForm.style.display = "block";
        loginForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Register";
    });

    // Show the modal when clicking the profile button (Login or Register)
    profileButton.addEventListener("click", () => {
        new bootstrap.Modal(authModal).show();
    });

    // Login logic
    loginSubmitButton.addEventListener("click", () => {
        const email = loginEmail.value;
        const password = loginPassword.value;

        auth.signInWithEmailAndPassword(email, password)
            .then(userCredential => {
                const user = userCredential.user;
                console.log("Logged in:", user);
                bootstrap.Modal.getInstance(authModal).hide();
                profileButton.textContent = "Profile";
                profileButton.onclick = () => {
                    window.location.href = "profile.html";
                };
            })
            .catch(error => {
                console.error("Error logging in:", error.message);
                if (error.message.includes("INVALID_LOGIN_CREDENTIALS")) {
                    displayErrorMessage("Invalid email or password.");
                } else {
                    displayErrorMessage("An error occurred. Please try again later.");
                }
            });
    });

    // Register logic
    registerSubmitButton.addEventListener("click", () => {
        const email = registerEmail.value;
        const password = registerPassword.value;
        const name = registerName.value;

        if (password.length < 6) {
            displayErrorMessage("Password should be at least 6 characters long.");
            return;
        }

        auth.createUserWithEmailAndPassword(email, password)
            .then(userCredential => {
                const user = userCredential.user;
                const userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                console.log("Registered:", user);

                // Add the email to Firestore
                db.collection("users").doc(user.uid).set({
                    fullName: name,
                    profilePicture: "default-profile.png",
                    userId: userId,
                    email: user.email  // Storing the email in Firestore
                }).then(() => {
                    console.log("User data saved to Firestore");
                    bootstrap.Modal.getInstance(authModal).hide();
                    profileButton.textContent = "Profile";
                    profileButton.onclick = () => {
                        window.location.href = "profile.html";
                    };
                });
            })
            .catch(error => {
                console.error("Error registering:", error.message);
                if (error.code === "auth/email-already-in-use") {
                    displayErrorMessage("Email already in use.");
                } else {
                    displayErrorMessage(error.message);
                }
            });
    });

    // Function to display error messages
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
    }

    // Check if the user is logged in when the page loads
    auth.onAuthStateChanged(user => {
        if (user) {
            profileButton.textContent = "Profile";
            profileButton.onclick = () => {
                window.location.href = "profile.html";
            };
        } else {
            profileButton.textContent = "Log In / Register";
        }
    });

    // Handle live search input (dropdown suggestions)
    searchInput.addEventListener("input", function () {
        const query = searchInput.value.trim();

        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = ""; // Clear results
            return;
        }

        // Query Firestore for matching users
        db.collection("users")
            .where("fullName", ">=", query)
            .where("fullName", "<=", query + "\uf8ff")
            .get()
            .then((snapshot) => {
                searchResults.innerHTML = ""; // Clear previous results

                if (!snapshot.empty) {
                    snapshot.forEach((doc) => {
                        const userData = doc.data();

                        // Create a dropdown item
                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.fullName || "No Name";

                        // Populate input with the selected name on click
                        listItem.addEventListener("click", () => {
                            searchInput.value = userData.fullName;
                            searchResults.style.display = "none"; // Hide the dropdown
                        });

                        searchResults.appendChild(listItem);
                    });

                    searchResults.style.display = "block"; // Show the dropdown
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

    // Handle search submission (Enter or Search button click)
    function performSearch(query) {
        searchResultsContainer.innerHTML = ""; // Clear previous results

        // Perform Firestore queries for fullName, email, or userId
        const usersRef = db.collection("users");
        Promise.all([
            usersRef.where("fullName", ">=", query).where("fullName", "<=", query + "\uf8ff").get(),
            usersRef.where("email", ">=", query).where("email", "<=", query + "\uf8ff").get(),
            usersRef.where("userId", "==", query).get(),
        ]).then((snapshots) => {
            let foundResults = false;

            snapshots.forEach((snapshot) => {
                if (!snapshot.empty) {
                    foundResults = true;
                    snapshot.forEach((doc) => {
                        const userData = doc.data();

                        // Create a preview container
                        const preview = document.createElement("div");
                        preview.className = "card mb-3";
                        preview.style.cursor = "pointer";

                        // Determine the profile picture URL or default
                        const profilePictureUrl = userData.profilePicture
                            ? `data:image/jpeg;base64,${userData.profilePicture}`
                            : "default-profile.png";

                        preview.innerHTML = `
                            <div class="row g-0 align-items-center">
                                <div class="col-2">
                                    <img src="${profilePictureUrl}" class="img-fluid rounded-circle" alt="ProfilePicture" style="width: 50px; height: 50px;">
                                </div>
                                <div class="col-10">
                                    <div class="card-body">
                                        <h5 class="card-title">${userData.fullName || "No Name Available"}</h5>
                                    </div>
                                </div>
                            </div>
                        `;

                        // Redirect to the public profile page when clicked
                        preview.addEventListener("click", () => {
                            window.location.href = `public-profile.html?userId=${encodeURIComponent(userData.userId)}`;
                        });

                        searchResultsContainer.appendChild(preview);
                    });
                }
            });

            if (!foundResults) {
                searchResultsContainer.innerHTML = "<p>No results found.</p>";
            }
        }).catch((error) => {
            console.error("Error searching users:", error);
            searchResultsContainer.innerHTML = "<p>An error occurred. Please try again later.</p>";
        });
    }

    // Handle "Enter" keypress
    searchInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
            event.preventDefault(); // Prevent page reload
            const query = searchInput.value.trim();
            if (query) {
                performSearch(query); // Perform search
            }
        }
    });

    // Handle "Search" button click
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault(); // Prevent form submission reload
        const query = searchInput.value.trim();
        if (query) {
            performSearch(query); // Perform search
        }
    });

    // Hide dropdown if user clicks outside
    document.addEventListener("click", (event) => {
        if (!searchInput.contains(event.target) && !searchResults.contains(event.target)) {
            searchResults.style.display = "none";
        }
    });
});