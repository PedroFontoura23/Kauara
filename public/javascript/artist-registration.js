document.addEventListener("DOMContentLoaded", function() {
    // Firebase Configuration
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S",
    };
    
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();
    
    // Global variables
    let currentUser = null;
    let currentUserId = null;
    let userDataLoaded = false;
    
    // Helper function to show notifications
    function showNotification(message, type = "info") {
        const notif = document.createElement("div");
        notif.className = `notification ${type}`;
        notif.textContent = message;
        notif.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 40px;
            color: white; font-weight: 500; z-index: 9999; background: ${type === 'success' ? '#4CAF50' : (type === 'error' ? '#F44336' : '#2196F3')};
            box-shadow: 0 10px 20px rgba(0,0,0,0.2); animation: slideIn 0.2s;
        `;
        document.body.appendChild(notif);
        setTimeout(() => { 
            notif.style.opacity = '0'; 
            setTimeout(() => notif.remove(), 300); 
        }, 2800);
    }
    
    // Get/resolve user ID
    async function resolveUserId(uid, userObj) {
        // Search by firebaseUID
        const q = await db.collection("users").where("firebaseUID", "==", uid).limit(1).get();
        if (!q.empty) {
            return q.docs[0].id;
        }
        // Try by email
        if (userObj && userObj.email) {
            const emailQuery = await db.collection("users").where("email", "==", userObj.email).limit(1).get();
            if (!emailQuery.empty) {
                const doc = emailQuery.docs[0];
                await doc.ref.update({ firebaseUID: uid });
                return doc.id;
            }
        }
        // Create new minimal document
        const newRef = db.collection("users").doc();
        await newRef.set({
            firebaseUID: uid,
            email: userObj?.email || '',
            displayName: userObj?.displayName || '',
            artista: false,           // Default artista is false
            aspirante: false,         // Default aspirante is false
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return newRef.id;
    }
    
    // Authentication state observer
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            console.warn("No user logged in");
            // In production, redirect to login
            // window.location.href = "/login.html";
            return;
        }
        
        try {
            currentUser = user;
            currentUserId = await resolveUserId(user.uid, user);
            
            // Load user profile
            const userDoc = await db.collection("users").doc(currentUserId).get();
            if (userDoc.exists) {
                window._cachedUserData = userDoc.data() || {};
            } else {
                window._cachedUserData = {};
            }
            
            // Load contact data
            const contactId = `contact_${currentUserId.split('_')[1] || ''}`;
            const contactDoc = await db.collection("contact").doc(contactId).get();
            window._cachedContactData = contactDoc.exists ? contactDoc.data() : {};
            
            userDataLoaded = true;
            console.log("User data loaded for", currentUserId);
        } catch (e) {
            console.error("Error loading user profile", e);
            userDataLoaded = true;
        }
    });
    
    // Open artist registration modal
    async function openArtistModal() {
        // Wait for data if not loaded
        if (!userDataLoaded) {
            showNotification("Loading your profile...", "info");
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 100));
                if (userDataLoaded) break;
            }
        }
        
        const userDocData = window._cachedUserData || {};
        const contactData = window._cachedContactData || {};
        
        // Extract fields
        const fullName = userDocData.displayName || userDocData.user_Name || userDocData.user_FullName || userDocData.fullLegalName || '';
        const email = userDocData.email || (currentUser ? currentUser.email : '');
        const cpfCnpj = userDocData.cpfCnpj || '';
        const address = userDocData.address || contactData.address || '';
        const phone = contactData.contactTelephone || '';
        const bio = userDocData.bio || userDocData.user_Bio || '';
        const website = userDocData.website || '';
        const pixKeyType = userDocData.pix_keyType || 'phone';
        const pixKey = userDocData.pix_key || '';
        const profilePicture = userDocData.profilePicture || '';
        
        // Build modal
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'dynamicArtistOverlay';
        
        overlay.innerHTML = `
            <div class="artist-modal">
                <button class="modal-close" id="closeModalBtn">&times;</button>
                <h2 class="modal-title">🎨 complete artist registration</h2>
                
                <div class="form-section">
                    <div class="d-flex align-items-center mb-3">
                        <img id="modalProfilePreview" src="https://via.placeholder.com/70?text=pic" alt="preview">
                        <div>
                            <label for="modalProfileUpload" class="btn btn-outline-secondary btn-sm">📸 change profile picture</label>
                            <input type="file" id="modalProfileUpload" accept="image/*" class="hidden-input">
                            <p class="text-muted small mb-0 mt-1">will be saved as Base64</p>
                        </div>
                    </div>
                    
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label">Full name</label>
                            <input type="text" id="modalFullName" class="form-control" value="${escapeHtml(fullName)}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Email</label>
                            <input type="email" id="modalEmail" class="form-control" value="${escapeHtml(email)}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">CPF/CNPJ</label>
                            <input type="text" id="modalCpfCnpj" class="form-control" value="${escapeHtml(cpfCnpj)}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Phone</label>
                            <input type="tel" id="modalPhone" class="form-control" value="${escapeHtml(phone)}">
                        </div>
                        <div class="col-12">
                            <label class="form-label">Full address</label>
                            <textarea id="modalAddress" class="form-control" rows="2">${escapeHtml(address)}</textarea>
                        </div>
                        <div class="col-12">
                            <label class="form-label">Bio / artist statement</label>
                            <textarea id="modalBio" class="form-control" rows="3">${escapeHtml(bio)}</textarea>
                        </div>
                        <div class="col-12">
                            <label class="form-label">Website / portfolio</label>
                            <input type="url" id="modalWebsite" class="form-control" value="${escapeHtml(website)}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">PIX Key Type</label>
                            <select id="modalPixType" class="form-control">
                                <option value="phone" ${pixKeyType === 'phone' ? 'selected' : ''}>Telefone</option>
                                <option value="email" ${pixKeyType === 'email' ? 'selected' : ''}>E-mail</option>
                                <option value="cpf" ${pixKeyType === 'cpf' ? 'selected' : ''}>CPF</option>
                                <option value="cnpj" ${pixKeyType === 'cnpj' ? 'selected' : ''}>CNPJ</option>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">PIX Key</label>
                            <input type="text" id="modalPixKey" class="form-control" value="${escapeHtml(pixKey)}">
                        </div>
                    </div>
                </div>
                
                <!-- Registration Art: 5 to 10 images -->
                <div class="form-section">
                    <h5 class="mb-3"><i class="bi bi-images me-2"></i>Portfolio samples (5‑10 images)</h5>
                    <div class="image-upload-grid" id="artworkGrid"></div>
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="counter-hint" id="imageCounter">0 / 10 uploaded (min 5)</span>
                        <button type="button" id="addArtworkBtn" class="btn btn-sm btn-outline-dark">
                            <i class="bi bi-plus-lg"></i> add image
                        </button>
                    </div>
                    <input type="file" id="artworkFileInput" accept="image/*" multiple class="hidden-input">
                </div>
                
                <button id="finalRegisterBtn" class="btn-register-submit mt-4">save & become artist</button>
                <p class="text-muted small text-center mt-3">by registering you agree to platform terms</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Set existing profile picture
        const profilePreview = document.getElementById('modalProfilePreview');
        const profileUpload = document.getElementById('modalProfileUpload');
        let profileBase64 = profilePicture || null;
        
        if (profilePicture) {
            if (profilePicture.startsWith('data:image')) {
                profilePreview.src = profilePicture;
            } else if (profilePicture.startsWith('http')) {
                profilePreview.src = profilePicture;
            } else {
                profilePreview.src = `data:image/jpeg;base64,${profilePicture}`;
            }
        }
        
        profileUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    profileBase64 = ev.target.result;
                    profilePreview.src = profileBase64;
                };
                reader.readAsDataURL(file);
            }
        });
        
        // Artwork grid logic
        const grid = document.getElementById('artworkGrid');
        const fileInput = document.getElementById('artworkFileInput');
        const addBtn = document.getElementById('addArtworkBtn');
        const counterSpan = document.getElementById('imageCounter');
        const maxImages = 10, minImages = 5;
        let artworkFiles = [];
        
        function renderArtworkGrid() {
            grid.innerHTML = '';
            artworkFiles.forEach((file, index) => {
                const card = document.createElement('div');
                card.className = 'upload-card';
                const url = URL.createObjectURL(file);
                card.innerHTML = `<img class="preview-img" src="${url}"><button class="remove-btn" data-index="${index}"><i class="bi bi-x"></i></button>`;
                card.querySelector('.remove-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    artworkFiles.splice(index, 1);
                    renderArtworkGrid();
                });
                grid.appendChild(card);
            });
            for (let i = artworkFiles.length; i < maxImages; i++) {
                const empty = document.createElement('div');
                empty.className = 'upload-card empty-placeholder';
                empty.innerHTML = `<span class="placeholder-icon"><i class="bi bi-plus-circle"></i></span>`;
                empty.addEventListener('click', () => fileInput.click());
                grid.appendChild(empty);
            }
            counterSpan.innerText = `${artworkFiles.length} / ${maxImages} (min ${minImages})`;
        }
        
        fileInput.addEventListener('change', (e) => {
            const newFiles = Array.from(e.target.files);
            const slots = maxImages - artworkFiles.length;
            if (newFiles.length > slots) {
                showNotification(`You can only add ${slots} more image(s)`, 'error');
                artworkFiles.push(...newFiles.slice(0, slots));
            } else {
                artworkFiles.push(...newFiles);
            }
            renderArtworkGrid();
            fileInput.value = '';
        });
        
        addBtn.addEventListener('click', () => fileInput.click());
        renderArtworkGrid();
        
        // Close modal
        document.getElementById('closeModalBtn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        
        // Final submit
        document.getElementById('finalRegisterBtn').addEventListener('click', async () => {
            if (artworkFiles.length < minImages) {
                showNotification(`Upload at least ${minImages} artwork images.`, 'error');
                return;
            }
            
            const fullName = document.getElementById('modalFullName').value.trim();
            const email = document.getElementById('modalEmail').value.trim();
            const cpfCnpj = document.getElementById('modalCpfCnpj').value.trim();
            const phone = document.getElementById('modalPhone').value.trim();
            const address = document.getElementById('modalAddress').value.trim();
            const bio = document.getElementById('modalBio').value.trim();
            const website = document.getElementById('modalWebsite').value.trim();
            const pixType = document.getElementById('modalPixType').value;
            const pixKey = document.getElementById('modalPixKey').value.trim();
            
            if (!fullName || !email || !cpfCnpj || !phone || !address) {
                showNotification('Fill required fields: name, email, CPF, phone, address', 'error');
                return;
            }
            
            const btn = document.getElementById('finalRegisterBtn');
            btn.disabled = true; 
            btn.innerHTML = '<span class="loading-spinner"></span> saving...';
            
            try {
                // Upload artwork to storage
                const artworkUrls = [];
                for (let i = 0; i < artworkFiles.length; i++) {
                    const file = artworkFiles[i];
                    const ext = file.name.split('.').pop();
                    const path = `registration_art/${currentUserId}/${Date.now()}_${i}.${ext}`;
                    const ref = storage.ref().child(path);
                    await ref.put(file);
                    const url = await ref.getDownloadURL();
                    artworkUrls.push(url);
                }
                
                // Prepare update - CHANGES MADE HERE
                const userUpdate = {
                    displayName: fullName,
                    user_FullName: fullName,
                    fullLegalName: fullName,
                    email,
                    cpfCnpj,
                    address,
                    bio,
                    user_Bio: bio,
                    website,
                    pix_keyType: pixType,
                    pix_key: pixKey,
                    artista: false,           // Explicitly set artista to false
                    aspirante: true,           // Set aspirante to true
                    registrationArtwork: artworkUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                if (profileBase64) userUpdate.profilePicture = profileBase64;
                
                await db.collection("users").doc(currentUserId).set(userUpdate, { merge: true });
                
                // Contact update
                const contactId = `contact_${currentUserId.split('_')[1] || 'demo'}`;
                await db.collection("contact").doc(contactId).set({
                    contactTelephone: phone,
                    address,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                showNotification('Artist registration complete! 🎉', 'success');
                overlay.remove();
            } catch (err) {
                console.error(err);
                showNotification('Error: ' + err.message, 'error');
                btn.disabled = false; 
                btn.textContent = 'save & become artist';
            }
        });
    }
    
    // Escape helper
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.replace(/[&<>"]/g, function(m) {
            if (m === '&') return '&amp;'; 
            if (m === '<') return '&lt;'; 
            if (m === '>') return '&gt;'; 
            if (m === '"') return '&quot;';
            return m;
        });
    }
    
    // Add CSS animations
    const style = document.createElement("style");
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        .hidden-input { display: none; }
    `;
    document.head.appendChild(style);
    
    // Open modal on button click
    const showModalBtn = document.getElementById('showArtistModalBtn');
    if (showModalBtn) {
        showModalBtn.addEventListener('click', () => {
            openArtistModal();
        });
    }
});