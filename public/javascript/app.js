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

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const isUnread = !data.read;

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

                        // Create notification element safely (no innerHTML with user data)
                        const notificationItem = document.createElement('a');
                        notificationItem.href = data.postId ? `post.html?postId=${encodeURIComponent(data.postId)}` : '#';
                        notificationItem.className = `list-group-item list-group-item-action ${isUnread ? 'unread-notification' : ''}`;

                        const flex = document.createElement('div');
                        flex.className = 'd-flex align-items-center';

                        const img = document.createElement('img');
                        img.src = data.fromUserProfilePic
                            ? `data:image/jpeg;base64,${data.fromUserProfilePic}`
                            : '../images/default-profile.png';
                        img.className = 'rounded-circle me-2';
                        img.width = 32;
                        img.height = 32;
                        img.style.objectFit = 'cover';
                        img.alt = `${sanitizeText(username)}'s profile`;
                        img.onerror = function() { this.onerror = null; this.src = '../images/default-profile.png'; };

                        const textDiv = document.createElement('div');
                        textDiv.className = 'flex-grow-1';

                        const msgDiv = document.createElement('div');
                        msgDiv.className = 'notification-message';
                        const strong = document.createElement('strong');
                        strong.textContent = username;
                        msgDiv.appendChild(strong);
                        msgDiv.appendChild(document.createTextNode(' ' + actionText));

                        const timeSmall = document.createElement('small');
                        timeSmall.className = 'text-muted';
                        timeSmall.textContent = formatTimestamp(data.timestamp);

                        textDiv.appendChild(msgDiv);
                        textDiv.appendChild(timeSmall);
                        flex.appendChild(img);
                        flex.appendChild(textDiv);

                        if (isUnread) {
                            const dot = document.createElement('span');
                            dot.className = 'unread-dot bg-primary rounded-circle';
                            dot.style.width = '8px';
                            dot.style.height = '8px';
                            flex.appendChild(dot);
                        }

                        notificationItem.appendChild(flex);
                        
                        notificationList.appendChild(notificationItem);
                    });

                    // Mark notifications as read if needed
                    if (unreadNotificationIds.length > 0) {
                        try {
                            await batch.commit();
                            
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
                            window.location.href = "profile.html";
                        } else {
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
        // No verified user — nothing to do
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
        loadingDiv.textContent = message;
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
        const existingUser = await db.collection("pendingUsers")
          .where("contactEmail", "==", email)
          .get();

        if (!existingUser.empty) {
          const user = await auth.signInWithEmailAndPassword(email, password).then(cred => cred.user);
          await user.sendEmailVerification();
          displayErrorMessage("A verification email has been resent. Please check your inbox.");
          await auth.signOut();
          return;
        }

        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        await user.sendEmailVerification();
        alert(`Verification email sent to your address. Please verify before logging in.`);

        const countDoc = await db.collection("usersCount").doc("count").get();
        if (!countDoc.exists) {
          throw new Error("Could not fetch user count.");
        }
        let count = countDoc.data().count;
        const userId = `user_${count + 1}`;
        const contactId = `contact_${count + 1}`;

        await db.collection("pendingUsers").doc(userId).set({
          user_Name: name,
          user_FullName: name,
          user_Bio: "---",
          firebaseUID: user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          userId: userId,
          contactEmail: email,
          contactTelephone: "N/A",
          artista: false
        });

        await db.collection("usersCount").doc("count").update({
          count: count + 1
        });

        await auth.signOut();
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



    // ─── Shared helper ───────────────────────────────────────────────────────
    // Sanitize a string for safe use in text nodes (XSS-safe)
    function sanitizeText(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
    }

    // Firestore range query: matches docs where `field` starts with `prefix` (case-sensitive)
    // We keep the query light — always paginate with .limit()
    function firestoreStartsWith(collection, field, prefix, limitCount) {
        const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
        return db.collection(collection)
            .where(field, '>=', prefix)
            .where(field, '<', end)
            .limit(limitCount);
    }

    // ─── Autocomplete (dropdown suggestions — users only, max 5) ─────────────
    let autocompleteTimer = null;

    searchInput.addEventListener("input", function () {
        clearTimeout(autocompleteTimer);
        const query = searchInput.value.trim();

        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = "";
            searchResultsContainer.innerHTML = "";
            return;
        }

        // Debounce: wait 250 ms before firing
        autocompleteTimer = setTimeout(async () => {
            try {
                const snapshot = await firestoreStartsWith('users', 'user_Name', query, 5).get();
                searchResults.innerHTML = "";

                if (snapshot.empty) {
                    const li = document.createElement("li");
                    li.className = "dropdown-item text-muted";
                    li.textContent = "No users found";
                    searchResults.appendChild(li);
                } else {
                    snapshot.forEach(doc => {
                        const name = doc.data().user_Name || '';
                        const li = document.createElement("li");
                        li.className = "dropdown-item";
                        li.textContent = name; // textContent = safe, no XSS
                        li.addEventListener("click", () => {
                            searchInput.value = name;
                            searchResults.style.display = "none";
                            performSearch(name);
                        });
                        searchResults.appendChild(li);
                    });
                }
                searchResults.style.display = "block";
            } catch (err) {
                console.error("Autocomplete error:", err);
            }
        }, 250);
    });

    // ─── Full multi-collection search ────────────────────────────────────────
    async function performSearch(query) {
        if (!query || query.length < 2) return;
        searchResultsContainer.innerHTML = "";

        // Show a loading indicator
        const loading = document.createElement('p');
        loading.textContent = 'Searching…';
        searchResultsContainer.appendChild(loading);

        try {
            // Run all four collection queries in parallel, each bounded to 10 results
            const [usersSnap, postsSnap, artsSnap, productsSnap] = await Promise.all([
                firestoreStartsWith('users',    'user_Name', query, 10).get(),
                firestoreStartsWith('posts',    'title',     query, 10).get(),
                firestoreStartsWith('arts',     'title',     query, 10).get(),
                firestoreStartsWith('products', 'name',      query, 10).get(),
            ]);

            loading.remove();

            let hasAny = false;

            // ── Users ──
            if (!usersSnap.empty) {
                hasAny = true;
                const section = createSearchSection('Users');
                usersSnap.forEach(doc => {
                    const d = doc.data();
                    const card = document.createElement('div');
                    card.className = 'card mb-2';
                    card.style.cursor = 'pointer';

                    const row = document.createElement('div');
                    row.className = 'row g-0 align-items-center p-2';

                    const imgCol = document.createElement('div');
                    imgCol.className = 'col-auto me-2';
                    const img = document.createElement('img');
                    img.src = d.profilePicture
                        ? `data:image/jpeg;base64,${d.profilePicture}`
                        : '../images/default-profile.png';
                    img.className = 'rounded-circle';
                    img.style.cssText = 'width:40px;height:40px;object-fit:cover';
                    img.alt = 'Profile';
                    img.onerror = function () { this.onerror = null; this.src = '../images/default-profile.png'; };
                    imgCol.appendChild(img);

                    const textCol = document.createElement('div');
                    textCol.className = 'col';
                    const name = document.createElement('strong');
                    name.textContent = d.user_Name || '';
                    textCol.appendChild(name);

                    row.appendChild(imgCol);
                    row.appendChild(textCol);
                    card.appendChild(row);

                    card.addEventListener('click', () => {
                        window.location.href = `public-profile.html?userId=${encodeURIComponent(d.userId)}`;
                    });
                    section.container.appendChild(card);
                });
                searchResultsContainer.appendChild(section.wrapper);
            }

            // ── Posts ──
            if (!postsSnap.empty) {
                hasAny = true;
                const section = createSearchSection('Posts');
                postsSnap.forEach(doc => {
                    const d = doc.data();
                    const item = createTextResultItem(d.title || 'Untitled', d.description || '');
                    item.addEventListener('click', () => {
                        window.location.href = `post.html?postId=${encodeURIComponent(doc.id)}`;
                    });
                    section.container.appendChild(item);
                });
                searchResultsContainer.appendChild(section.wrapper);
            }

            // ── Arts ──
            if (!artsSnap.empty) {
                hasAny = true;
                const section = createSearchSection('Arts');
                artsSnap.forEach(doc => {
                    const d = doc.data();
                    const item = createTextResultItem(d.title || 'Untitled', d.description || '');
                    item.addEventListener('click', () => {
                        window.location.href = `art.html?artId=${encodeURIComponent(doc.id)}`;
                    });
                    section.container.appendChild(item);
                });
                searchResultsContainer.appendChild(section.wrapper);
            }

            // ── Products ──
            if (!productsSnap.empty) {
                hasAny = true;
                const section = createSearchSection('Products');
                productsSnap.forEach(doc => {
                    const d = doc.data();
                    const item = createTextResultItem(d.name || 'Unnamed product', d.description || '');
                    item.addEventListener('click', () => {
                        window.location.href = `product.html?productId=${encodeURIComponent(doc.id)}`;
                    });
                    section.container.appendChild(item);
                });
                searchResultsContainer.appendChild(section.wrapper);
            }

            if (!hasAny) {
                const p = document.createElement('p');
                p.textContent = 'No results found.';
                searchResultsContainer.appendChild(p);
            }

        } catch (err) {
            console.error("Search error:", err);
            loading.remove();
            const p = document.createElement('p');
            p.textContent = 'An error occurred. Please try again.';
            searchResultsContainer.appendChild(p);
        }
    }

    // Helper: create a labelled section wrapper
    function createSearchSection(label) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        const heading = document.createElement('h6');
        heading.className = 'text-muted text-uppercase small px-1 mt-2';
        heading.textContent = label;
        const container = document.createElement('div');
        wrapper.appendChild(heading);
        wrapper.appendChild(container);
        return { wrapper, container };
    }

    // Helper: generic text result card (title + snippet) — no innerHTML, fully safe
    function createTextResultItem(title, snippet) {
        const card = document.createElement('div');
        card.className = 'card mb-2 p-2';
        card.style.cursor = 'pointer';

        const t = document.createElement('strong');
        t.textContent = title;

        const s = document.createElement('p');
        s.className = 'mb-0 small text-muted';
        s.textContent = snippet.length > 80 ? snippet.slice(0, 80) + '…' : snippet;

        card.appendChild(t);
        card.appendChild(s);
        return card;
    }

    // ─── Search form submit ───────────────────────────────────────────────────
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            searchResults.style.display = "none";
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
    return new PostManager(db, auth, containerId);
}
function initializeArtManager(containerId) {
    return new ArtManager(db, auth, containerId);
}
function initializeProductManager(containerId) {
    return new ProductManager(db, auth, containerId);
}

function initializeArts() {
    // Initialize Firebase if not already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    const artManager = initializeArtManager('artsContainer');
    artManager.displayArts();
}

function initializeProducts() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    const productManager = initializeProductManager('productsContainer');
    productManager.displayProducts();
}
initializePosts();
initializeArts();
initializeProducts();
// Update the auth.onAuthStateChanged handler to include arts
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            const postManager = initializePostManager('allPostsContainer');
            postManager.displayPosts(null, firestoreUserId);
            
            const artManager = initializeArtManager('artsContainer');
            artManager.displayArts(null, firestoreUserId);

            const productManager = initializeProductManager('productsContainer');
            productManager.displayProducts(null, firestoreUserId);
        } catch (error) {
            console.error("Error fetching current user ID:", error);
        }
    } else {
        // Initialize posts, arts, and products for non-logged-in users
        const postManager = initializePostManager('allPostsContainer');
        postManager.displayPosts();
        
        const artManager = initializeArtManager('artsContainer');
        artManager.displayArts();

        const productManager = initializeProductManager('productsContainer');
        productManager.displayProducts();
    }
});
function initializePosts() {
    // Initialize Firebase if not already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    // Initialize PostManager and display posts
    const postManager = initializePostManager('allPostsContainer');
    postManager.displayPosts();
}
initializePosts();
initializeArts();
initializeProducts();
});