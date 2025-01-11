document.addEventListener("DOMContentLoaded", function () {
    // Firebase initialization
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
                console.log("Registered:", user);

                db.collection("users").doc(user.uid).set({
                    fullName: name,
                    profilePicture: "default-profile.png",
                    message: "Hello! Welcome to my profile!"
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

    // Dynamic search bar functionality
    searchInput.addEventListener("input", function () {
        const query = searchInput.value.trim();

        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = ""; // Clear results
            return;
        }

        db.collection("users")
            .where("fullName", ">=", query)
            .where("fullName", "<=", query + "\uf8ff")
            .get()
            .then(snapshot => {
                searchResults.innerHTML = ""; // Clear previous results

                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        const userData = doc.data();

                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.fullName || "No Name";

                        listItem.addEventListener("click", () => {
                            window.location.href = `public-profile.html?query=${encodeURIComponent(userData.email)}`;
                        });

                        searchResults.appendChild(listItem);
                    });

                    searchResults.style.display = "block"; // Show dropdown
                } else {
                    const noResultsItem = document.createElement("li");
                    noResultsItem.className = "dropdown-item text-muted";
                    noResultsItem.textContent = "No results found";
                    searchResults.appendChild(noResultsItem);
                    searchResults.style.display = "block";
                }
            })
            .catch(error => {
                console.error("Error searching users:", error);
            });
    });

    // Hide dropdown if user clicks outside
    document.addEventListener("click", event => {
        if (!searchInput.contains(event.target)) {
            searchResults.style.display = "none";
        }
    });
});
