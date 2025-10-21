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

    function clearErrorMessage() {
        errorMessage.textContent = "";
        errorMessage.style.display = "none";
    }

    // Select the close button inside the modal
    const modalCloseButton = document.querySelector(".btn-close");

    // Attach the same close logic to the close button
    modalCloseButton.addEventListener("click", function() {
    });


    // Helper function to toggle password visibility
    function togglePasswordVisibility(inputId, toggleIconId) {
        const passwordInput = document.getElementById(inputId);
        const toggleIcon = document.getElementById(toggleIconId);

        if (passwordInput && toggleIcon) {
            toggleIcon.addEventListener("click", (event) => {
                event.preventDefault(); // Prevent default behavior (e.g., form submission)
                event.stopPropagation(); // Stop event from bubbling up

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
        const profileButton = document.getElementById('profileButton'); // Adiciona a referência ao botão

        if (profileButton) {
            if (user && user.emailVerified) {
                // Usuário logado e email verificado
                profileButton.textContent = "Profile";
                profileButton.href = "profile.html";
            } else {
                // Usuário não logado ou email não verificado
                profileButton.textContent = "Log In / Register";
                profileButton.removeAttribute("href");
            }
        } else {
            console.error("Botão de perfil não encontrado!");
        }
    }

    const notificationButton = document.getElementById("notificationButton");
    const notificationDropdown = document.getElementById("notificationDropdown");

    if (!notificationButton || !notificationDropdown) {
        console.error("Notification button or dropdown not found in DOM.");
        return;
    }

    // Replace the notificationButton click handler in app.js with this:
    notificationButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const dropdown = notificationDropdown;
        
        if (dropdown.style.display === "none" || dropdown.style.display === "") {
            dropdown.style.display = "block";
            
            try {
                const user = auth.currentUser;
                if (user) {
                    const userId = await getUserIdFromUid(user.uid);
                    const notificationsRef = db.collection('notifications')
                        .where('toUserId', '==', userId)
                        .orderBy('timestamp', 'desc')
                        .limit(50);

                    const snapshot = await notificationsRef.get();
                    const notificationList = document.getElementById('notificationList');
                    notificationList.innerHTML = '';
                    
                    const unreadNotificationIds = [];
                    const batch = db.batch();

                    // Debugging: Log notification count
                    console.log(`Found ${snapshot.size} notifications`);

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const isUnread = !data.read;
                        
                        // Debugging: Log individual notification data
                        console.log("Processing notification:", {
                            id: doc.id,
                            type: data.type,
                            hasUsername: !!data.fromUsername,
                            hasImage: !!data.fromUserProfilePic,
                            message: data.message
                        });

                        // Track unread notifications
                        if (isUnread) {
                            unreadNotificationIds.push(doc.id);
                            const notificationRef = db.collection('notifications').doc(doc.id);
                            batch.update(notificationRef, { 
                                read: true,
                                readAt: firebase.firestore.FieldValue.serverTimestamp() 
                            });
                        }

                        // Safely get username with fallback
                        const username = data.fromUsername || "User";
                        
                        // Determine notification action text
                        let actionText;
                        if (data.type === 'like') {
                            actionText = 'liked your ' + (data.commentId ? 'comment' : 'post');
                        } else if (data.type === 'comment') {
                            const commentText = data.message.includes(':') 
                                              ? data.message.split(':').slice(1).join(':').trim()
                                              : data.message;
                            actionText = 'commented: ' + commentText;
                        } else {
                            actionText = data.message || 'interacted with your content';
                        }

                        // Create notification element
                        const notificationItem = document.createElement('a');
                        notificationItem.href = data.postId ? `post.html?postId=${data.postId}` : '#';
                        notificationItem.className = `list-group-item list-group-item-action ${isUnread ? 'unread-notification' : ''}`;
                        
                        notificationItem.innerHTML = `
                            <div class="d-flex align-items-center">
                                <img src="${data.fromUserProfilePic 
                                          ? `data:image/jpeg;base64,${data.fromUserProfilePic}` 
                                          : '../images/default-profile.png'}"
                                     class="rounded-circle me-2"
                                     width="32" height="32"
                                     style="object-fit: cover;"
                                     onerror="this.onerror=null; this.src='../images/default-profile.png'"
                                     alt="${username}'s profile">
                                <div class="flex-grow-1">
                                    <div class="notification-message">
                                        <strong>${username}</strong> ${actionText}
                                    </div>
                                    <small class="text-muted">${formatTimestamp(data.timestamp)}</small>
                                </div>
                                ${isUnread ? '<span class="unread-dot bg-primary rounded-circle" style="width: 8px; height: 8px;"></span>' : ''}
                            </div>
                        `;
                        
                        notificationList.appendChild(notificationItem);
                    });

                    // Mark notifications as read if needed
                    if (unreadNotificationIds.length > 0) {
                        try {
                            await batch.commit();
                            console.log(`Marked ${unreadNotificationIds.length} notifications as read`);
                            
                            // Update UI to reflect read status
                            document.querySelectorAll('.unread-notification').forEach(el => {
                                el.classList.remove('unread-notification');
                            });
                            document.querySelectorAll('.unread-dot').forEach(el => {
                                el.remove();
                            });
                            
                            updateNotificationBadge();
                        } catch (batchError) {
                            console.error("Error marking notifications as read:", batchError);
                        }
                    }

                    // Handle empty state
                    if (snapshot.empty) {
                        notificationList.innerHTML = '<li class="list-group-item text-muted">No notifications yet</li>';
                    }
                }
            } catch (error) {
                console.error("Error loading notifications:", error);
                const notificationList = document.getElementById('notificationList');
                notificationList.innerHTML = '<li class="list-group-item text-danger">Error loading notifications</li>';
            }
        } else {
            dropdown.style.display = "none";
        }
    });
    
    function getNotificationAction(data) {
        if (data.type === 'like') {
            return 'liked your ' + (data.commentId ? 'comment' : 'post');
        } else if (data.type === 'comment') {
            return 'commented: ' + data.message.split(':').slice(1).join(':').trim();
        }
        return data.message;
    }
    // Add this function to update the notification badge
    async function updateNotificationBadge() {
        const user = auth.currentUser;
        if (!user) {
            removeNotificationBadge();
            return;
        }

        try {
            const userId = await getUserIdFromUid(user.uid);
            const snapshot = await db.collection('notifications')
                .where('toUserId', '==', userId)
                .where('read', '==', false)
                .get();
                
            removeNotificationBadge();
            
            if (snapshot.size > 0) {
                const badge = document.createElement('span');
                badge.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger';
                badge.style.fontSize = '0.6rem';
                badge.style.padding = '3px 6px';
                badge.textContent = snapshot.size;
                notificationButton.appendChild(badge);
                notificationButton.style.position = 'relative';
            }
        } catch (error) {
            console.error("Error updating notification badge:", error);
            // Don't show badge if there was an error checking
            removeNotificationBadge();
        }
    }

    function removeNotificationBadge() {
        const existingBadge = notificationButton.querySelector('.badge');
        if (existingBadge) {
            notificationButton.removeChild(existingBadge);
        }
    }

    let notificationListener = null;

    auth.onAuthStateChanged(user => {
        updateProfileButtonBehavior(user);
        // Clean up previous listener if it exists
        if (notificationListener) {
            notificationListener();
        }
        
        if (user) {
            updateNotificationBadge();
            
            try {
                getUserIdFromUid(user.uid).then(userId => {
                    notificationListener = db.collection('notifications')
                        .where('toUserId', '==', userId)
                        .where('read', '==', false)
                        .onSnapshot(
                            snapshot => {
                                if (notificationDropdown.style.display === 'none') {
                                    updateNotificationBadge();
                                }
                            },
                            error => {
                                console.error("Notification listener error:", error);
                            }
                        );
                });
            } catch (error) {
                console.error("Error setting up notification listener:", error);
            }
        } else {
            removeNotificationBadge();
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (event) => {
        if (!notificationButton.contains(event.target) && !notificationDropdown.contains(event.target)) {
            notificationDropdown.style.display = "none";
        }
    });

    // Helper function to format timestamp
    function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        
        const date = timestamp.toDate();
        const now = new Date();
        const diffInHours = Math.abs(now - date) / 36e5;
        
        if (diffInHours < 24) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    // Improved markAsRead function
    async function markAsRead(notificationId) {
        try {
            await db.collection('notifications').doc(notificationId).update({ 
                read: true,
                readAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
            console.log(`Notification ${notificationId} marked as read`);
            return true;
        } catch (error) {
            console.error("Error marking notification as read:", error);
            return false;
        }
    }

    // Handle profile button click
    profileButton.addEventListener("click", function (event) {
        const user = auth.currentUser;

        if (user && user.emailVerified) {
            // User is logged in, redirect to profile page
            window.location.href = "profile.html";
        } else {
            // User is not logged in, show login/register modal
            event.preventDefault(); // Prevent default behavior (e.g., href redirect)

            // Show the modal without a backdrop
            const modal = new bootstrap.Modal(authModal, { backdrop: false });

            // Add a slight delay to ensure the modal is fully initialized
            setTimeout(() => {
                modal.show();

                // Add a click event listener to close the modal when clicking outside
                document.addEventListener("click", closeModalOnClickOutside);
            }, 10); // Small delay to ensure modal is ready
        }
    });

    // Function to close the modal when clicking outside
    function closeModalOnClickOutside(event) {
        const modalContent = document.querySelector(".modal-content");

        // Check if the click is outside the modal content
        if (!modalContent.contains(event.target)) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(authModal);
            if (modal) {
                modal.hide();

                // Remove the event listener after closing the modal
                document.removeEventListener("click", closeModalOnClickOutside);
            }
        }
    }

    authModal.addEventListener("hidden.bs.modal", function () {
        // Reset to the login form
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";

        // Clear form fields
        loginEmail.value = "";
        loginPassword.value = "";
        registerEmail.value = "";
        registerPassword.value = "";
        registerName.value = "";

        // Clear error messages
        clearErrorMessage();
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
                console.log("User signed in:", user);

                if (!user.emailVerified) {
                    auth.signOut();
                    displayErrorMessage("Please verify your email before logging in.");
                    return;
                }

                // Close the modal after successful login or registration
                const modalInstance = bootstrap.Modal.getInstance(authModal);
                modalInstance.hide(); // Close the modal

                // Clear the login form fields
                loginEmail.value = "";
                loginPassword.value = "";

                // Continue with the rest of the code (e.g., redirect to profile page)
                db.collection("contact")
                    .where("firebaseUID", "==", user.uid)
                    .get()
                    .then((querySnapshot) => {
                        if (!querySnapshot.empty) {
                            console.log("User found in contact collection");
                            window.location.href = "profile.html"; // Redirect to profile page
                        } else {
                            console.error("No matching user found in contact collection");
                            displayErrorMessage("Error accessing user data.");
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

            // Move user data to "users" collection
            await db.collection("users").doc(userId).set({
              user_Name: pendingUserData.user_Name,
              user_Password: pendingUserData.user_Password, // Avoid storing if possible
              user_FullName: pendingUserData.user_FullName,
              user_Bio: pendingUserData.user_Bio,
              firebaseUID: pendingUserData.firebaseUID,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              userId: userId,
              artista: pendingUserData.artista
            });

            // Create contact document
            await db.collection("contact").doc(contactId).set({
              contactEmail: pendingUserData.contactEmail,
              contactTelephone: pendingUserData.contactTelephone,
              foreignUserId: userId,
              firebaseUID: pendingUserData.firebaseUID,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Delete from pendingUsers
            await db.collection("pendingUsers").doc(userId).delete();

            console.log("User data successfully transferred!");
            window.location.href = "profile.html";
          } else {
            // User might already exist in "users"
            const userDoc = await db.collection("users").where("firebaseUID", "==", user.uid).get();
            if (userDoc.empty) {
              displayErrorMessage("No user data found. Please contact support.");
            }
          }
        } catch (error) {
          console.error("Error during user verification process:", error);
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

      console.log("Registration started with:", { email, name });

      clearErrorMessage();

      if (!email || !password || !confirmPassword || !name) {
        displayErrorMessage("All fields are required.");
        console.log("Validation failed: Missing fields");
        return;
      }

      if (password !== confirmPassword) {
        displayErrorMessage("Passwords do not match.");
        console.log("Validation failed: Passwords do not match");
        return;
      }

      if (password.length < 6) {
        displayErrorMessage("Password must be at least 6 characters.");
        console.log("Validation failed: Password too short");
        return;
      }

      try {
        // Check if user already exists in pendingUsers
        console.log("Checking for existing pendingUsers with email:", email);
        const existingUser = await db.collection("pendingUsers")
          .where("contactEmail", "==", email)
          .get();

        if (!existingUser.empty) {
          console.log("Existing pending user found:", existingUser.docs[0].data());
          const user = await auth.signInWithEmailAndPassword(email, password).then(cred => cred.user);
          await user.sendEmailVerification();
          displayErrorMessage("A verification email has been resent. Please check your inbox.");
          console.log("Verification email resent for existing user");
          await auth.signOut();
          return;
        }

        // Create new user
        console.log("Creating new user with email:", email);
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        console.log("User created successfully. UID:", user.uid);

        // Send verification email
        console.log("Sending verification email to:", email);
        await user.sendEmailVerification();
        alert(`Verification email sent to ${email}. Please verify your email before logging in.`);
        console.log("Verification email sent");

        // Fetch user count for unique ID
        console.log("Fetching usersCount...");
        const countDoc = await db.collection("usersCount").doc("count").get();
        if (!countDoc.exists) {
          throw new Error("Could not fetch user count.");
        }
        let count = countDoc.data().count;
        const userId = `user_${count + 1}`;
        const contactId = `contact_${count + 1}`;
        console.log("Generated userId:", userId, "and contactId:", contactId);

        // Store user data in pendingUsers
        console.log("Writing to pendingUsers with userId:", userId);
        await db.collection("pendingUsers").doc(userId).set({
          user_Name: name,
          user_Password: password, // Consider removing this for security
          user_FullName: name,
          user_Bio: "---",
          firebaseUID: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          userId: userId,
          contactEmail: email,
          contactTelephone: "N/A",
          artista: false
        });
        console.log("Successfully wrote to pendingUsers");

        // Increment usersCount
        console.log("Incrementing usersCount from:", count);
        await db.collection("usersCount").doc("count").update({
          count: count + 1
        });
        console.log("usersCount incremented to:", count + 1);

        // Sign out and redirect
        console.log("Signing out user...");
        await auth.signOut();
        console.log("User signed out. Redirecting to inicio.html");
        window.location.href = "inicio.html";

      } catch (error) {
        console.error("Registration error:", error);
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


});
function initializePostManager(containerId) {
    // Create a new PostManager instance
    return new PostManager(db, auth, containerId);
}
function initializeArtManager(containerId) {
    // Create a new ArtManager instance
    return new ArtManager(db, auth, containerId);
}

function initializeArts() {
    console.log("Initializing arts display");

    // Initialize Firebase if not already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    // Initialize ArtManager and display arts
    const artManager = initializeArtManager('artsContainer');
    artManager.displayArts(); // Load arts without requiring a logged-in user
}

// Update the auth.onAuthStateChanged handler to include arts
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            const postManager = initializePostManager('allPostsContainer');
            postManager.displayPosts(null, firestoreUserId);
            
            // Add art initialization for logged-in users
            const artManager = initializeArtManager('artsContainer');
            artManager.displayArts(null, firestoreUserId);
        } catch (error) {
            console.error("Error fetching current user ID:", error);
        }
    } else {
        // Initialize posts and arts for non-logged-in users
        const postManager = initializePostManager('allPostsContainer');
        postManager.displayPosts();
        
        const artManager = initializeArtManager('artsContainer');
        artManager.displayArts();
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

    // Initialize PostManager and display posts
    const postManager = initializePostManager('allPostsContainer');
    postManager.displayPosts(); // Load posts without requiring a logged-in user
}
initializePosts();
initializeArts();
});