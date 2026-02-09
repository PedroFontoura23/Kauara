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

    // Main Application Class
    class KauaraApp {
        constructor() {
            this.currentUserId = null;
            this.usersCache = {};
            this.notificationListener = null;
            this.isInitialized = false;
            
            this.initializeApp();
        }

        async initializeApp() {
            if (this.isInitialized) return;
            
            try {
                await this.initializeModules();
                this.setupAuthStateListener();
                this.isInitialized = true;
                console.log("Kauara App initialized successfully");
            } catch (error) {
                console.error("Failed to initialize app:", error);
            }
        }

        async initializeModules() {
            // Initialize all UI components
            this.initializeAuthModal();
            this.initializeSearch();
            this.initializeNotifications();
            this.initializeProfileButton();
            this.initializeFooterMenu();
            
            // Initialize content managers
            this.initializeContentManagers();
        }

        setupAuthStateListener() {
            auth.onAuthStateChanged(async (user) => {
                await this.handleAuthStateChange(user);
            });
        }

        async handleAuthStateChange(user) {
            try {
                if (user && user.emailVerified) {
                    this.currentUserId = await this.getUserIdFromUid(user.uid);
                    sessionStorage.setItem('currentFirestoreUserId', this.currentUserId);
                    console.log("User authenticated:", this.currentUserId);
                    
                    // Handle pending user registration if needed
                    await this.handlePendingUser(user);
                } else {
                    this.currentUserId = null;
                    sessionStorage.removeItem('currentFirestoreUserId');
                    console.log("User not authenticated");
                }

                // Update UI based on auth state
                this.updateProfileButtonBehavior(user);
                await this.updateNotificationBadge();
                this.setupNotificationListener(user);
                
                // Load content based on auth state
                this.loadContent(user);

            } catch (error) {
                console.error("Error handling auth state change:", error);
            }
        }

        // Authentication Methods
        initializeAuthModal() {
            const profileButton = document.getElementById("profileButton");
            const authModal = document.getElementById("authModal");
            
            if (!profileButton || !authModal) return;

            profileButton.addEventListener("click", (event) => {
                this.handleProfileButtonClick(event);
            });

            this.setupAuthModalEvents();
            this.setupPasswordToggles();
        }

        handleProfileButtonClick(event) {
            const user = auth.currentUser;

            if (user && user.emailVerified) {
                window.location.href = "profile.html";
            } else {
                event.preventDefault();
                this.showAuthModal();
            }
        }

        showAuthModal() {
            const modal = new bootstrap.Modal(document.getElementById('authModal'), { 
                backdrop: false 
            });
            
            setTimeout(() => {
                modal.show();
                document.addEventListener("click", this.closeModalOnClickOutside.bind(this));
            }, 10);
        }

        closeModalOnClickOutside(event) {
            const modalContent = document.querySelector(".modal-content");
            const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
            
            if (modal && !modalContent.contains(event.target)) {
                modal.hide();
                document.removeEventListener("click", this.closeModalOnClickOutside);
            }
        }

        setupAuthModalEvents() {
            const showLoginButton = document.getElementById("showLogin");
            const showRegisterButton = document.getElementById("showRegister");
            const loginSubmitButton = document.getElementById("loginSubmitButton");
            const registerSubmitButton = document.getElementById("registerSubmitButton");
            const authModal = document.getElementById("authModal");

            // Form toggling
            showLoginButton?.addEventListener("click", () => this.showLoginForm());
            showRegisterButton?.addEventListener("click", () => this.showRegisterForm());

            // Form submissions
            loginSubmitButton?.addEventListener("click", () => this.handleLogin());
            registerSubmitButton?.addEventListener("click", () => this.handleRegister());

            // Modal cleanup on close
            authModal?.addEventListener("hidden.bs.modal", () => this.cleanupAuthModal());
        }

        setupPasswordToggles() {
            this.togglePasswordVisibility("loginPassword", "toggleLoginPassword");
            this.togglePasswordVisibility("registerPassword", "toggleRegisterPassword");
            this.togglePasswordVisibility("registerConfirmPassword", "toggleRegisterConfirmPassword");
        }

        togglePasswordVisibility(inputId, toggleIconId) {
            const passwordInput = document.getElementById(inputId);
            const toggleIcon = document.getElementById(toggleIconId);

            if (passwordInput && toggleIcon) {
                toggleIcon.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    if (passwordInput.type === "password") {
                        passwordInput.type = "text";
                        toggleIcon.innerHTML = '<i class="fas fa-eye-slash"></i>';
                    } else {
                        passwordInput.type = "password";
                        toggleIcon.innerHTML = '<i class="fas fa-eye"></i>';
                    }
                });
            }
        }

        // Search Functionality
        initializeSearch() {
            const searchInput = document.getElementById("searchInput");
            const searchForm = document.getElementById("searchForm");
            const searchResults = document.getElementById("searchResults");

            if (!searchInput || !searchForm || !searchResults) return;

            searchInput.addEventListener("input", () => this.handleSearchInput());
            searchForm.addEventListener("submit", (event) => this.handleSearchSubmit(event));
            
            document.addEventListener("click", (event) => {
                if (!searchInput.contains(event.target) && !searchResults.contains(event.target)) {
                    searchResults.style.display = "none";
                }
            });
        }

        async handleSearchInput() {
            const query = document.getElementById("searchInput").value.trim();
            const searchResults = document.getElementById("searchResults");

            if (query.length === 0) {
                searchResults.style.display = "none";
                searchResults.innerHTML = "";
                return;
            }

            try {
                const snapshot = await db.collection("users").get();
                searchResults.innerHTML = "";

                const matchingDocs = snapshot.docs.filter(doc => {
                    const userData = doc.data();
                    return userData.user_Name && userData.user_Name.toLowerCase().includes(query.toLowerCase());
                });

                if (matchingDocs.length > 0) {
                    matchingDocs.forEach((doc) => {
                        const userData = doc.data();
                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.user_Name;
                        listItem.addEventListener("click", () => {
                            document.getElementById("searchInput").value = userData.user_Name;
                            searchResults.style.display = "none";
                            this.performSearch(userData.user_Name);
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
            } catch (error) {
                console.error("Error searching users:", error);
            }
        }

        handleSearchSubmit(event) {
            event.preventDefault();
            const query = document.getElementById("searchInput").value.trim();
            if (query) {
                this.performSearch(query);
            }
        }

        async performSearch(query) {
            const searchResultsContainer = document.getElementById("searchResultsContainer");
            if (!searchResultsContainer) return;

            searchResultsContainer.innerHTML = "";
            const lowercaseQuery = query.toLowerCase();

            try {
                const snapshot = await db.collection("users").get();
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
            } catch (error) {
                console.error("Error searching users:", error);
                searchResultsContainer.innerHTML = "<p>An error occurred. Please try again later.</p>";
            }
        }

        // Notifications
        initializeNotifications() {
            const notificationButton = document.getElementById("notificationButton");
            const notificationDropdown = document.getElementById("notificationDropdown");

            if (!notificationButton || !notificationDropdown) {
                console.error("Notification elements not found");
                return;
            }

            notificationButton.addEventListener("click", (event) => {
                this.handleNotificationClick(event);
            });

            document.addEventListener("click", (event) => {
                if (!notificationButton.contains(event.target) && !notificationDropdown.contains(event.target)) {
                    notificationDropdown.style.display = "none";
                }
            });
        }

        async handleNotificationClick(event) {
            event.stopPropagation();
            const dropdown = document.getElementById("notificationDropdown");
            
            if (dropdown.style.display === "none" || dropdown.style.display === "") {
                dropdown.style.display = "block";
                await this.loadNotifications();
            } else {
                dropdown.style.display = "none";
            }
        }

        async loadNotifications() {
            try {
                const user = auth.currentUser;
                if (!user) return;

                const userId = await this.getUserIdFromUid(user.uid);
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
                    
                    if (isUnread) {
                        unreadNotificationIds.push(doc.id);
                        const notificationRef = db.collection('notifications').doc(doc.id);
                        batch.update(notificationRef, { 
                            read: true,
                            readAt: firebase.firestore.FieldValue.serverTimestamp() 
                        });
                    }

                    const username = data.fromUsername || "User";
                    const actionText = this.getNotificationActionText(data);

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
                                <small class="text-muted">${this.formatTimestamp(data.timestamp)}</small>
                            </div>
                            ${isUnread ? '<span class="unread-dot bg-primary rounded-circle" style="width: 8px; height: 8px;"></span>' : ''}
                        </div>
                    `;
                    
                    notificationList.appendChild(notificationItem);
                });

                if (unreadNotificationIds.length > 0) {
                    await batch.commit();
                    this.updateNotificationBadge();
                }

                if (snapshot.empty) {
                    notificationList.innerHTML = '<li class="list-group-item text-muted">No notifications yet</li>';
                }
            } catch (error) {
                console.error("Error loading notifications:", error);
                const notificationList = document.getElementById('notificationList');
                notificationList.innerHTML = '<li class="list-group-item text-danger">Error loading notifications</li>';
            }
        }

        getNotificationActionText(data) {
            if (data.type === 'like') {
                return 'liked your ' + (data.commentId ? 'comment' : 'post');
            } else if (data.type === 'comment') {
                const commentText = data.message.includes(':') 
                                  ? data.message.split(':').slice(1).join(':').trim()
                                  : data.message;
                return 'commented: ' + commentText;
            }
            return data.message || 'interacted with your content';
        }

        async updateNotificationBadge() {
            const notificationButton = document.getElementById("notificationButton");
            if (!notificationButton) return;

            const user = auth.currentUser;
            if (!user) {
                this.removeNotificationBadge();
                return;
            }

            try {
                const userId = await this.getUserIdFromUid(user.uid);
                const snapshot = await db.collection('notifications')
                    .where('toUserId', '==', userId)
                    .where('read', '==', false)
                    .get();
                    
                this.removeNotificationBadge();
                
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
                this.removeNotificationBadge();
            }
        }

        removeNotificationBadge() {
            const notificationButton = document.getElementById("notificationButton");
            if (!notificationButton) return;

            const existingBadge = notificationButton.querySelector('.badge');
            if (existingBadge) {
                notificationButton.removeChild(existingBadge);
            }
        }

        setupNotificationListener(user) {
            // Clean up previous listener
            if (this.notificationListener) {
                this.notificationListener();
            }
            
            if (user) {
                this.getUserIdFromUid(user.uid).then(userId => {
                    this.notificationListener = db.collection('notifications')
                        .where('toUserId', '==', userId)
                        .where('read', '==', false)
                        .onSnapshot(
                            snapshot => {
                                const notificationDropdown = document.getElementById("notificationDropdown");
                                if (notificationDropdown && notificationDropdown.style.display === 'none') {
                                    this.updateNotificationBadge();
                                }
                            },
                            error => {
                                console.error("Notification listener error:", error);
                            }
                        );
                });
            }
        }

        // Profile Button
        initializeProfileButton() {
            this.updateProfileButtonBehavior(auth.currentUser);
        }

        updateProfileButtonBehavior(user) {
            const profileButton = document.getElementById('profileButton');
            if (!profileButton) return;

            if (user && user.emailVerified) {
                profileButton.textContent = "Profile";
                profileButton.href = "profile.html";
            } else {
                profileButton.textContent = "Log In / Register";
                profileButton.removeAttribute("href");
            }
        }

        // Footer Menu
        initializeFooterMenu() {
            const footerMenuButton = document.getElementById('footerMenuButton');
            const footerDropdownMenu = document.getElementById('footerDropdownMenu');

            if (footerMenuButton && footerDropdownMenu) {
                footerMenuButton.addEventListener('click', () => {
                    const isVisible = footerDropdownMenu.style.display === 'block';
                    footerDropdownMenu.style.display = isVisible ? 'none' : 'block';
                });
            }
        }

        // Content Management
        initializeContentManagers() {
            // Initialize all content types
            this.initializePosts();
            this.initializeArts();
            this.initializeProducts();
        }

        initializePosts() {
            console.log("Initializing posts display");
            const postManager = this.initializePostManager('allPostsContainer');
            postManager.displayPosts();
        }

        initializeArts() {
            console.log("Initializing arts display");
            const artManager = this.initializeArtManager('artsContainer');
            artManager.displayArts();
        }

        initializeProducts() {
            console.log("Initializing products display");
            const productManager = this.initializeProductManager('productsContainer');
            productManager.displayProducts();
        }

        loadContent(user) {
            if (user) {
                // User is logged in - load personalized content
                this.initializePosts();
                this.initializeArts();
                this.initializeProducts();
            } else {
                // User is not logged in - load public content
                this.initializePosts();
                this.initializeArts();
                this.initializeProducts();
            }
        }

        // Manager Initializers
        initializePostManager(containerId) {
            return new PostManager(db, auth, containerId);
        }

        initializeArtManager(containerId) {
            return new ArtManager(db, auth, containerId);
        }

        initializeProductManager(containerId) {
            return new ProductManager(db, auth, containerId);
        }

        // Authentication Form Methods
        showLoginForm() {
            document.getElementById("loginForm").style.display = "block";
            document.getElementById("registerForm").style.display = "none";
            document.getElementById("modalTitle").textContent = "Login";
            this.clearErrorMessage();
        }

        showRegisterForm() {
            document.getElementById("registerForm").style.display = "block";
            document.getElementById("loginForm").style.display = "none";
            document.getElementById("modalTitle").textContent = "Register";
            this.clearErrorMessage();
        }

        async handleLogin() {
            const email = document.getElementById("loginEmail").value.trim();
            const password = document.getElementById("loginPassword").value.trim();

            this.clearErrorMessage();

            if (!email || !password) {
                this.displayErrorMessage("Please enter both email and password.");
                return;
            }

            try {
                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                const user = userCredential.user;

                if (!user.emailVerified) {
                    await auth.signOut();
                    this.displayErrorMessage("Please verify your email before logging in.");
                    return;
                }

                // Close modal and redirect
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                modalInstance.hide();
                
                document.getElementById("loginEmail").value = "";
                document.getElementById("loginPassword").value = "";

                // Verify user exists in contact collection
                const querySnapshot = await db.collection("contact")
                    .where("firebaseUID", "==", user.uid)
                    .get();

                if (!querySnapshot.empty) {
                    window.location.href = "profile.html";
                } else {
                    this.displayErrorMessage("Error accessing user data.");
                }
            } catch (error) {
                console.error("Login error:", error);
                this.displayErrorMessage("Invalid email or password.");
            }
        }

        async handleRegister() {
            const email = document.getElementById("registerEmail").value.trim();
            const password = document.getElementById("registerPassword").value.trim();
            const confirmPassword = document.getElementById("registerConfirmPassword").value.trim();
            const name = document.getElementById("registerName").value.trim();

            this.clearErrorMessage();

            if (!email || !password || !confirmPassword || !name) {
                this.displayErrorMessage("All fields are required.");
                return;
            }

            if (password !== confirmPassword) {
                this.displayErrorMessage("Passwords do not match.");
                return;
            }

            if (password.length < 6) {
                this.displayErrorMessage("Password must be at least 6 characters.");
                return;
            }

            try {
                // Check for existing pending user
                const existingUser = await db.collection("pendingUsers")
                    .where("contactEmail", "==", email)
                    .get();

                if (!existingUser.empty) {
                    const user = await auth.signInWithEmailAndPassword(email, password).then(cred => cred.user);
                    await user.sendEmailVerification();
                    this.displayErrorMessage("A verification email has been resent. Please check your inbox.");
                    await auth.signOut();
                    return;
                }

                // Create new user
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;
                await user.sendEmailVerification();
                
                alert(`Verification email sent to ${email}. Please verify your email before logging in.`);

                // Create user record
                const countDoc = await db.collection("usersCount").doc("count").get();
                if (!countDoc.exists) {
                    throw new Error("Could not fetch user count.");
                }
                
                let count = countDoc.data().count;
                const userId = `user_${count + 1}`;

                await db.collection("pendingUsers").doc(userId).set({
                    user_Name: name,
                    user_Password: password,
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
                        this.displayErrorMessage("This email is already registered. Please check your inbox to verify.");
                        break;
                    case "auth/invalid-email":
                        this.displayErrorMessage("Please enter a valid email address.");
                        break;
                    case "auth/weak-password":
                        this.displayErrorMessage("Please choose a stronger password.");
                        break;
                    default:
                        this.displayErrorMessage("Registration failed. Please try again.");
                }
            }
        }

        async handlePendingUser(user) {
            try {
                const pendingUserSnapshot = await db.collection("pendingUsers")
                    .where("firebaseUID", "==", user.uid)
                    .get();

                if (!pendingUserSnapshot.empty) {
                    const pendingUserData = pendingUserSnapshot.docs[0].data();
                    const userId = pendingUserData.userId;
                    const contactId = `contact_${userId.split("_")[1]}`;

                    // Move to users collection
                    await db.collection("users").doc(userId).set({
                        user_Name: pendingUserData.user_Name,
                        user_Password: pendingUserData.user_Password,
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
                }
            } catch (error) {
                console.error("Error during user verification process:", error);
                this.displayErrorMessage("An error occurred. Please try again later.");
            }
        }

        cleanupAuthModal() {
            document.getElementById("loginForm").style.display = "block";
            document.getElementById("registerForm").style.display = "none";
            document.getElementById("modalTitle").textContent = "Login";

            // Clear form fields
            document.getElementById("loginEmail").value = "";
            document.getElementById("loginPassword").value = "";
            document.getElementById("registerEmail").value = "";
            document.getElementById("registerPassword").value = "";
            document.getElementById("registerName").value = "";

            this.clearErrorMessage();
        }

        // Utility Methods
        async getUserIdFromUid(uid) {
            const userQuery = await db.collection("users")
                .where("firebaseUID", "==", uid)
                .get();

            if (!userQuery.empty) {
                return userQuery.docs[0].id;
            } else {
                throw new Error(`No user found for UID: ${uid}`);
            }
        }

        displayErrorMessage(message) {
            const errorMessage = document.getElementById("errorMessage");
            if (!errorMessage) return;

            errorMessage.textContent = message;
            errorMessage.style.display = "block";

            setTimeout(() => {
                errorMessage.style.display = "none";
            }, 5000);
        }

        clearErrorMessage() {
            const errorMessage = document.getElementById("errorMessage");
            if (errorMessage) {
                errorMessage.textContent = "";
                errorMessage.style.display = "none";
            }
        }

        formatTimestamp(timestamp) {
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
    }

    // Initialize the application
    window.kauaraApp = new KauaraApp();
});