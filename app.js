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
        const email = loginEmail.value.trim();
        const password = loginPassword.value.trim();

        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;

                // Verificar se o e-mail foi verificado
                if (!user.emailVerified) {
                    alert("Seu e-mail ainda não foi verificado. Por favor, verifique sua caixa de entrada.");
                    auth.signOut();
                    return;
                }

                // Check users collection first
                db.collection("users").doc(user.uid).get().then((doc) => {
                    if (doc.exists) {
                        // User exists in users collection, redirect to profile
                        window.location.href = "profile.html";
                    } else {
                        // Check pendingUsers collection
                        db.collection("pendingUsers").doc(user.uid).get().then((pendingDoc) => {
                            if (pendingDoc.exists) {
                                const data = pendingDoc.data();
                                // Transfer data to users collection
                                db.collection("users").doc(user.uid).set({
                                    fullName: data.fullName,
                                    email: data.email,
                                    userId: data.userId,
                                    profilePicture: "default-profile.png",
                                    bio: "---",
                                }).then(() => {
                                    console.log("User data transferred to final collection");
                                    db.collection("pendingUsers").doc(user.uid).delete();
                                    window.location.href = "profile.html";
                                });
                            } else {
                                console.error("No user data found");
                                displayErrorMessage("Error accessing user data");
                            }
                        });
                    }
                });
            })
            .catch((error) => {
                console.error("Login error:", error.message);
                displayErrorMessage("Error logging in. Please check your credentials.");
            });
    });

    // Register logic
    registerSubmitButton.addEventListener("click", () => {
        const email = registerEmail.value.trim();
        const password = registerPassword.value.trim();
        const name = registerName.value.trim();

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
                const userId = generateRandomString(10);

                db.collection("pendingUsers").doc(user.uid).set({
                    fullName: name,
                    email: email,
                    userId: userId,
                })
                    .then(() => {
                        console.log("Registration data saved successfully!");

                        user.sendEmailVerification()
                            .then(() => {
                                alert(`Verification email sent to ${email}. Please check your inbox before logging in.`);
                                auth.signOut();
                                window.location.href = "kauara.html";
                            })
                            .catch((error) => {
                                console.error("Error sending verification email:", error);
                                alert("Error sending verification email. Please try again later.");
                            });
                    })
                    .catch((error) => {
                        console.error("Error saving registration data:", error);
                        alert("Error saving registration data. Please try again.");
                    });
            })
            .catch((error) => {
                console.error("Account creation error:", error.message);
                if (error.code === "auth/email-already-in-use") {
                    displayErrorMessage("This email is already in use.");
                } else {
                    displayErrorMessage(error.message);
                }
            });
    });

    // Generate random string for user ID
    function generateRandomString(length) {
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    // Display error messages
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
    }

    // Check authentication state
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

    // Handle live search input
    searchInput.addEventListener("input", function () {
        const query = searchInput.value.trim();
        const lowercaseQuery = query.toLowerCase();

        // Clear both dropdown and search results if query is empty
        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = "";
            searchResultsContainer.innerHTML = "";
            return;
        }

        // Query Firestore for matching users
        db.collection("users")
            .orderBy("fullName")
            .get()
            .then((snapshot) => {
                searchResults.innerHTML = ""; // Clear previous results

                // Filter results client-side for case-insensitive matching
                const matchingDocs = snapshot.docs.filter(doc =>
                    doc.data().fullName.toLowerCase().includes(lowercaseQuery)
                );

                if (matchingDocs.length > 0) {
                    matchingDocs.forEach((doc) => {
                        const userData = doc.data();
                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.fullName || "No Name";

                        listItem.addEventListener("click", () => {
                            searchInput.value = userData.fullName;
                            searchResults.style.display = "none";
                            performSearch(userData.fullName); // Perform search with selected name
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

    // Perform search function
    function performSearch(query) {
        searchResultsContainer.innerHTML = "";
        
        const lowercaseQuery = query.toLowerCase();
        const usersRef = db.collection("users");
        
        Promise.all([
            usersRef
                .orderBy("fullName")
                .get()
                .then(snapshot => snapshot.docs.filter(doc =>
                    doc.data().fullName.toLowerCase().includes(lowercaseQuery)
                )),
            usersRef
                .orderBy("email")
                .get()
                .then(snapshot => snapshot.docs.filter(doc =>
                    doc.data().email.toLowerCase().includes(lowercaseQuery)
                )),
            usersRef
                .where("userId", "==", query)
                .get()
        ]).then((results) => {
            let foundResults = false;
            
            const processedIds = new Set();
            const combinedResults = results.flat().filter(doc => {
                if (doc.exists && !processedIds.has(doc.data().userId)) {
                    processedIds.add(doc.data().userId);
                    return true;
                }
                return false;
            });

            if (combinedResults.length > 0) {
                foundResults = true;
                combinedResults.forEach((doc) => {
                    const userData = doc.data();
                    const preview = document.createElement("div");
                    preview.className = "card mb-3";
                    preview.style.cursor = "pointer";

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

                    preview.addEventListener("click", () => {
                        window.location.href = `public-profile.html?userId=${encodeURIComponent(userData.userId)}`;
                    });

                    searchResultsContainer.appendChild(preview);
                });
            }

            if (!foundResults) {
                searchResultsContainer.innerHTML = "<p>No results found.</p>";
            }
        }).catch((error) => {
            console.error("Error searching users:", error);
            searchResultsContainer.innerHTML = "<p>An error occurred. Please try again later.</p>";
        });
    }

    // Handle Enter key press
    searchInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            const query = searchInput.value.trim();
            if (query) {
                performSearch(query);
            } else {
                searchResultsContainer.innerHTML = "";
            }
        }
    });

    // Handle search form submission
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            performSearch(query);
        } else {
            searchResultsContainer.innerHTML = "";
        }
    });

    // Hide dropdown when clicking outside
    document.addEventListener("click", (event) => {
        if (!searchInput.contains(event.target) && !searchResults.contains(event.target)) {
            searchResults.style.display = "none";
        }
    });
});