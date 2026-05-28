document.addEventListener("DOMContentLoaded", function () {

    // ─── Firebase Initialization ──────────────────────────────────────────────
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S"
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db   = firebase.firestore();

    // ─── Element References ───────────────────────────────────────────────────
    const profileButton          = document.getElementById("profileButton");
    const authModal              = document.getElementById("authModal");
    const loginForm              = document.getElementById("loginForm");
    const registerForm           = document.getElementById("registerForm");
    const loginEmail             = document.getElementById("loginEmail");
    const loginPassword          = document.getElementById("loginPassword");
    const registerEmail          = document.getElementById("registerEmail");
    const registerPassword       = document.getElementById("registerPassword");
    const registerName           = document.getElementById("registerName");
    const loginSubmitButton      = document.getElementById("loginSubmitButton");
    const registerSubmitButton   = document.getElementById("registerSubmitButton");
    const showLoginButton        = document.getElementById("showLogin");
    const showRegisterButton     = document.getElementById("showRegister");
    const errorMessage           = document.getElementById("errorMessage");
    const registerConfirmPassword = document.getElementById("registerConfirmPassword");
    const notificationButton     = document.getElementById("notificationButton");
    const notificationDropdown   = document.getElementById("notificationDropdown");
    const notificationList       = document.getElementById("notificationList");
    const modalCloseButton       = document.querySelector(".btn-close");
    // ─── Notifications ────────────────────────────────────────────────────────
    if (notificationButton && notificationDropdown && notificationList) {
        new SharedNotifications({ auth, db, notificationButton, notificationDropdown, notificationList });
    }
    // ─── Profile Button State ─────────────────────────────────────────────────
    window.setProfileButtonState = function (isLoggedIn, photoUrl) {
        const btn = document.getElementById("profileButton");
        if (!btn) return;

        if (isLoggedIn) {
            btn.classList.add("logged-in");
            btn.innerHTML = `<img src="${photoUrl || '/images/profile_icon.png'}" alt="Perfil">`;
            btn.onclick = () => { window.location.href = "/profile.html"; };
        } else {
            btn.classList.remove("logged-in");
            btn.innerHTML = `<img src="/images/profile_icon.png" alt="Perfil">`;
            btn.onclick = () => {
                const modal = new bootstrap.Modal(document.getElementById("authModal"));
                modal.show();
            };
        }
    };

    // ─── Helper Functions ─────────────────────────────────────────────────────

    // Sanitize a string for safe use in text nodes (XSS-safe)
    function sanitizeText(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
    }

    // FIX: was defined twice — kept the version with auto-hide timeout
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
        setTimeout(() => {
            errorMessage.style.display = "none";
        }, 5000);
    }

    function clearErrorMessage() {
        errorMessage.textContent = "";
        errorMessage.style.display = "none";
    }

    async function getUserIdFromUid(uid) {
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", uid)
            .get();
        if (!userQuery.empty) {
            return userQuery.docs[0].id;
        } else {
            throw new Error(`No user found for UID: ${uid}`);
        }
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        const date = timestamp.toDate();
        const now  = new Date();
        const diffInHours = Math.abs(now - date) / 36e5;
        if (diffInHours < 24) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    function togglePasswordVisibility(inputId, toggleIconId) {
        const passwordInput = document.getElementById(inputId);
        const toggleIcon    = document.getElementById(toggleIconId);
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

    // ─── Password Visibility ──────────────────────────────────────────────────
    togglePasswordVisibility("loginPassword",          "toggleLoginPassword");
    togglePasswordVisibility("registerPassword",       "toggleRegisterPassword");
    togglePasswordVisibility("registerConfirmPassword","toggleRegisterConfirmPassword");

    // ─── Modal Close Button ───────────────────────────────────────────────────
    if (modalCloseButton) {
        modalCloseButton.addEventListener("click", function () {});
    }

    // ─── Show/Hide Auth Forms ─────────────────────────────────────────────────
    showLoginButton.addEventListener("click", () => {
        loginForm.style.display    = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";
        clearErrorMessage();
    });

    showRegisterButton.addEventListener("click", () => {
        registerForm.style.display = "block";
        loginForm.style.display    = "none";
        document.getElementById("modalTitle").textContent = "Register";
        clearErrorMessage();
    });

    // ─── Profile Button ───────────────────────────────────────────────────────
    function updateProfileButtonBehavior(user) {
        if (typeof window.setProfileButtonState !== 'function') return;
        if (user && user.emailVerified) {
            getUserIdFromUid(user.uid).then(userId => {
                db.collection("users").doc(userId).get().then(doc => {
                    const photoUrl = doc.exists && doc.data().profilePicture
                        ? 'data:image/jpeg;base64,' + doc.data().profilePicture
                        : null;
                    window.setProfileButtonState(true, photoUrl);
                }).catch(() => window.setProfileButtonState(true, null));
            }).catch(() => window.setProfileButtonState(true, null));
        } else {
            window.setProfileButtonState(false);
        }
    }

    // Profile button click is handled by setProfileButtonState() in inicio.js via btn.onclick

    function closeModalOnClickOutside(event) {
        const modalContent = document.querySelector(".modal-content");
        if (!modalContent.contains(event.target)) {
            const modal = bootstrap.Modal.getInstance(authModal);
            if (modal) {
                modal.hide();
                document.removeEventListener("click", closeModalOnClickOutside);
            }
        }
    }

    authModal.addEventListener("hidden.bs.modal", function () {
        loginForm.style.display    = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";
        loginEmail.value          = "";
        loginPassword.value       = "";
        registerEmail.value       = "";
        registerPassword.value    = "";
        registerName.value        = "";
        clearErrorMessage();
    });

    // ─── Cart Button ──────────────────────────────────────────────────────────
    const cartButton = document.getElementById("cartButton");
    if (cartButton) {
        cartButton.addEventListener("click", function (e) {
            e.preventDefault();
            window.location.href = "/carrinho.html";
        });
    }

    // ─── Notifications (Centralized) ─────────────────────────────────────────
    // Import and initialize the shared notification system
    // Assumes shared-notifications.js is loaded before this script
    if (window.SharedNotifications && notificationButton && notificationDropdown && notificationList) {
        window.kauaraNotifications = new window.SharedNotifications({
            auth,
            db,
            notificationButton,
            notificationDropdown,
            notificationList
        });
    }
    // Always update profile button on auth state change
    auth.onAuthStateChanged(user => {
        updateProfileButtonBehavior(user);
    });

    // ─── Login ────────────────────────────────────────────────────────────────
    loginSubmitButton.addEventListener("click", () => {
        const email    = loginEmail.value.trim();
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
                const modalInstance = bootstrap.Modal.getInstance(authModal);
                modalInstance.hide();
                loginEmail.value    = "";
                loginPassword.value = "";

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
                    .catch(() => displayErrorMessage("Error accessing user data."));
            })
            .catch(() => displayErrorMessage("Invalid email or password."));
    });

    // ─── Pending User Verification ────────────────────────────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (user && user.emailVerified) {
            try {
                const pendingUserSnapshot = await db.collection("pendingUsers")
                    .where("firebaseUID", "==", user.uid)
                    .get();

                if (!pendingUserSnapshot.empty) {
                    const pendingUserData = pendingUserSnapshot.docs[0].data();
                    const userId          = pendingUserData.userId;
                    const contactId       = `contact_${userId.split("_")[1]}`;

                    await db.collection("users").doc(userId).set({
                        user_Name:     pendingUserData.user_Name,
                        user_FullName: pendingUserData.user_FullName,
                        user_Bio:      pendingUserData.user_Bio,
                        firebaseUID:   pendingUserData.firebaseUID,
                        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                        userId:        userId,
                        artista:       pendingUserData.artista
                    });

                    await db.collection("contact").doc(contactId).set({
                        contactEmail:     pendingUserData.contactEmail,
                        contactTelephone: pendingUserData.contactTelephone,
                        foreignUserId:    userId,
                        firebaseUID:      pendingUserData.firebaseUID,
                        createdAt:        firebase.firestore.FieldValue.serverTimestamp()
                    });

                    await db.collection("pendingUsers").doc(userId).delete();
                    window.location.href = "profile.html";
                } else {
                    const userDoc = await db.collection("users").where("firebaseUID", "==", user.uid).get();
                    if (userDoc.empty) {
                        displayErrorMessage("No user data found. Please contact support.");
                    }
                }
            } catch (error) {
                console.error("Error during user verification process:", error);
                displayErrorMessage("An error occurred. Please try again later.");
            }
        }
    });

    // ─── Register ─────────────────────────────────────────────────────────────
    registerSubmitButton.addEventListener("click", async () => {
        const email           = registerEmail.value.trim();
        const password        = registerPassword.value.trim();
        const confirmPassword = registerConfirmPassword.value.trim();
        const name            = registerName.value.trim();
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
            const user           = userCredential.user;
            await user.sendEmailVerification();
            alert("Verification email sent to your address. Please verify before logging in.");

            const countDoc = await db.collection("usersCount").doc("count").get();
            if (!countDoc.exists) throw new Error("Could not fetch user count.");
            const count     = countDoc.data().count;
            const userId    = `user_${count + 1}`;
            const contactId = `contact_${count + 1}`;

            await db.collection("pendingUsers").doc(userId).set({
                user_Name:        name,
                user_FullName:    name,
                user_Bio:         "---",
                firebaseUID:      user.uid,
                createdAt:        firebase.firestore.FieldValue.serverTimestamp(),
                userId:           userId,
                contactEmail:     email,
                contactTelephone: "N/A",
                artista:          false
            });

            await db.collection("usersCount").doc("count").update({ count: count + 1 });
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

    // ─── Content Managers ─────────────────────────────────────────────────────
    function initializePostManager(containerId)      { return new PostManager(db, auth, containerId); }
    function initializeArtManager(containerId)       { return new ArtManager(db, auth, containerId); }
    function initializeProductManager(containerId)   { return new ProductManagerDimona(db, auth, containerId); }
    function initializeCandidatoManager(containerId) {
        try {
            const storage = typeof firebase.storage === 'function' ? firebase.storage() : null;
            return new window.CandidatoManager(db, auth, storage, containerId);
        } catch (e) {
            console.warn("[CandidatoManager] Could not initialize storage:", e.message);
            return null;
        }
    }

    // ─── Auth State → Load Content ────────────────────────────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                const firestoreUserId = await getUserIdFromUid(user.uid);

                const postManager = initializePostManager('allPostsContainer');
                window._kauavaPostManager = postManager;
                postManager.displayPosts(null, firestoreUserId);

                const artManager = initializeArtManager('artsContainer');
                window._kauavaArtManager = artManager;
                artManager.displayArts(null, firestoreUserId);

                const productManager = initializeProductManager('productsContainer');
                window._kauavaProductManager = productManager;
                productManager.displayProducts(null, firestoreUserId);

                if (typeof window.CandidatoManager !== 'undefined') {
                    const candidatoManager = initializeCandidatoManager('candidatoArtsContainer');
                    if (candidatoManager) candidatoManager.displayArts();
                }
            } catch (error) {
                console.error("Error fetching current user ID:", error);
            }
        } else {
            const postManager = initializePostManager('allPostsContainer');
            window._kauavaPostManager = postManager;
            postManager.displayPosts();

            const artManager = initializeArtManager('artsContainer');
            window._kauavaArtManager = artManager;
            artManager.displayArts();

            const productManager = initializeProductManager('productsContainer');
            window._kauavaProductManager = productManager;
            productManager.displayProducts();

            if (typeof window.CandidatoManager !== 'undefined') {
                const candidatoManager = initializeCandidatoManager('candidatoArtsContainer');
                if (candidatoManager) candidatoManager.displayArts();
            }
        }
    });
    // ─── Carousel Functionality (Fixed) ──────────────────────────────────────────
    const track = document.getElementById('enhancedCarouselTrack');
    const prevBtn = document.getElementById('carouselPrevBtn');
    const nextBtn = document.getElementById('carouselNextBtn');
    const dotsContainer = document.getElementById('carouselDots');

    if (track && prevBtn && nextBtn) {
        const slides = track.querySelectorAll('.carousel-slide');
        const slideCount = slides.length;
        let currentIndex = 0;
        let autoInterval;
        const autoDelay = 5000;

        function updateCarousel(index) {
            if (index < 0) index = slideCount - 1;
            if (index >= slideCount) index = 0;
            currentIndex = index;
            track.style.transform = `translateX(-${currentIndex * 100}%)`;
            updateDots();
        }

        function createDots() {
            if (!dotsContainer) return;
            dotsContainer.innerHTML = '';
            for (let i = 0; i < slideCount; i++) {
                const dot = document.createElement('button');
                dot.classList.add('dot');
                dot.setAttribute('data-index', i);
                dot.addEventListener('click', () => {
                    if (autoInterval) clearInterval(autoInterval);
                    updateCarousel(i);
                    startAutoSlide();
                });
                dotsContainer.appendChild(dot);
            }
            updateDots();
        }

        function updateDots() {
            if (!dotsContainer) return;
            const dots = dotsContainer.querySelectorAll('.dot');
            dots.forEach((dot, i) => {
                if (i === currentIndex) dot.classList.add('active');
                else dot.classList.remove('active');
            });
        }

        function nextSlide() { updateCarousel(currentIndex + 1); }
        function prevSlide() { updateCarousel(currentIndex - 1); }
        function startAutoSlide() { if (autoInterval) clearInterval(autoInterval); autoInterval = setInterval(nextSlide, autoDelay); }
        function stopAutoSlide() { if (autoInterval) { clearInterval(autoInterval); autoInterval = null; } }

        prevBtn.addEventListener('click', () => { stopAutoSlide(); prevSlide(); startAutoSlide(); });
        nextBtn.addEventListener('click', () => { stopAutoSlide(); nextSlide(); startAutoSlide(); });

        createDots();
        updateCarousel(0);
        startAutoSlide();

        const carouselContainer = document.querySelector('.carousel-container');
        if (carouselContainer) {
            carouselContainer.addEventListener('mouseenter', stopAutoSlide);
            carouselContainer.addEventListener('mouseleave', startAutoSlide);
        }
    }
});