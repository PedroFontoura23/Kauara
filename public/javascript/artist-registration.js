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
    
    // Elements
    const fullNameInput = document.getElementById("fullName");
    const emailInput = document.getElementById("email");
    const phoneInput = document.getElementById("phone");
    const addressInput = document.getElementById("address");
    const bioInput = document.getElementById("bio");
    const websiteInput = document.getElementById("website");
    const cpfCnpjInput = document.getElementById("cpfCnpj");
    const editInfoBtn = document.getElementById("editInfoBtn");
    const saveInfoBtn = document.getElementById("saveInfoBtn");
    const profilePictureInput = document.getElementById("profilePicture");
    const profilePicturePreview = document.getElementById("profilePicturePreview");
    const uploadPictureBtn = document.getElementById("uploadPictureBtn");
    
    // New PIX elements
    const pixKeySection = document.getElementById("pixKeySection");
    const pixStatus = document.getElementById("pixStatus");
    const connectPixBtn = document.getElementById("connectPixBtn");
    
    // Initialize page
    function initializePage() {
        // Check if user is logged in
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.href = "/login.html";
                return;
            }
            
            try {
                const userId = await getUserIdFromUid(user.uid);
                await loadUserProfile(userId);
                
                // Setup event listeners
                setupEventListeners(userId);
                
                // Check PIX key status
                await checkPixKeyStatus(userId);
                
            } catch (error) {
                console.error("Error initializing page:", error);
                alert("Error loading profile. Please refresh the page.");
            }
        });
    }
    
    // Load user profile data
    async function loadUserProfile(userId) {
        try {
            const userDoc = await db.collection("users").doc(userId).get();
            
            if (!userDoc.exists) {
                console.warn("User document not found, creating basic profile...");
                await createBasicProfile(userId);
                return;
            }
            
            const userData = userDoc.data();
            
            // Populate form fields with null checks
            if (fullNameInput) {
                fullNameInput.value = userData.displayName || userData.user_Name || userData.user_FullName || userData.fullLegalName || '';
            }
            
            if (emailInput) {
                emailInput.value = userData.email || '';
            }
            
            if (bioInput) {
                bioInput.value = userData.bio || userData.user_Bio || '';
            }
            
            if (websiteInput) {
                websiteInput.value = userData.website || '';
            }
            
            if (cpfCnpjInput) {
                cpfCnpjInput.value = userData.cpfCnpj || '';
            }
            
            // Load profile picture - handle Base64 string directly
            if (profilePicturePreview && userData.profilePicture) {
                // Check if it's a Base64 string (starts with data:image)
                if (userData.profilePicture.startsWith('data:image')) {
                    profilePicturePreview.src = userData.profilePicture;
                } else if (userData.profilePicture.startsWith('/9j/')) {
                    // It's a Base64 string without the data URI prefix
                    profilePicturePreview.src = `data:image/jpeg;base64,${userData.profilePicture}`;
                } else if (userData.profilePicture.startsWith('http')) {
                    // It's a URL (from previous Firebase Storage implementation)
                    profilePicturePreview.src = userData.profilePicture;
                } else {
                    // Assume it's a Base64 string
                    profilePicturePreview.src = `data:image/jpeg;base64,${userData.profilePicture}`;
                }
                profilePicturePreview.style.display = 'block';
            }
            
            // Load contact info
            const contactId = `contact_${userId.split("_")[1]}`;
            const contactDoc = await db.collection("contact").doc(contactId).get();
            if (contactDoc.exists) {
                const contactData = contactDoc.data();
                if (phoneInput) {
                    phoneInput.value = contactData.contactTelephone || '';
                }
                if (addressInput) {
                    addressInput.value = contactData.address || userData.address || '';
                }
            }
            
            console.log("Profile loaded successfully");
            
        } catch (error) {
            console.error("Error loading user profile:", error);
            throw error;
        }
    }
    
    // Check PIX key status
    async function checkPixKeyStatus(userId) {
        try {
            const userDoc = await db.collection("users").doc(userId).get();
            
            if (!userDoc.exists) {
                updatePixUI(false);
                return;
            }
            
            const userData = userDoc.data();
            const hasPixKey = userData.pix_key && userData.pix_keyType;
            
            updatePixUI(hasPixKey, userData.pix_keyType, userData.pix_key);
            
        } catch (error) {
            console.error("Error checking PIX key status:", error);
            updatePixUI(false);
        }
    }
    
    // Update PIX UI based on status
    function updatePixUI(hasPixKey, keyType = null, keyValue = null) {
        if (pixStatus && connectPixBtn) {
            if (hasPixKey) {
                // Format the key for display
                let displayKey = keyValue;
                if (keyType === 'phone') {
                    // Format phone: (11) 99999-9999
                    displayKey = formatPhoneNumber(keyValue);
                } else if (keyType === 'email') {
                    // Email already good
                    displayKey = keyValue;
                } else if (keyType === 'cpf') {
                    // Format CPF: 123.456.789-10
                    displayKey = formatCPF(keyValue);
                } else if (keyType === 'cnpj') {
                    // Format CNPJ: 12.345.678/0001-90
                    displayKey = formatCNPJ(keyValue);
                }
                
                pixStatus.innerHTML = `Status: <span class="text-success">Conectado</span><br>
                                      Chave PIX: <strong>${displayKey}</strong><br>
                                      Tipo: <strong>${getKeyTypeLabel(keyType)}</strong>`;
                connectPixBtn.textContent = "Editar Chave PIX";
                connectPixBtn.classList.remove("btn-success");
                connectPixBtn.classList.add("btn-warning");
            } else {
                pixStatus.innerHTML = 'Status: <span class="text-danger">Não Conectado</span>';
                connectPixBtn.textContent = "Conectar Chave PIX";
                connectPixBtn.classList.remove("btn-warning");
                connectPixBtn.classList.add("btn-success");
            }
        }
    }
    
    // Format phone number (Brazilian format)
    function formatPhoneNumber(phone) {
        // Remove all non-digits
        const cleaned = phone.replace(/\D/g, '');
        
        // Check if it's a valid Brazilian phone number
        if (cleaned.length === 11) {
            return `(${cleaned.substring(0,2)}) ${cleaned.substring(2,7)}-${cleaned.substring(7)}`;
        } else if (cleaned.length === 10) {
            return `(${cleaned.substring(0,2)}) ${cleaned.substring(2,6)}-${cleaned.substring(6)}`;
        }
        return phone;
    }
    
    // Format CPF
    function formatCPF(cpf) {
        const cleaned = cpf.replace(/\D/g, '');
        if (cleaned.length === 11) {
            return `${cleaned.substring(0,3)}.${cleaned.substring(3,6)}.${cleaned.substring(6,9)}-${cleaned.substring(9)}`;
        }
        return cpf;
    }
    
    // Format CNPJ
    function formatCNPJ(cnpj) {
        const cleaned = cnpj.replace(/\D/g, '');
        if (cleaned.length === 14) {
            return `${cleaned.substring(0,2)}.${cleaned.substring(2,5)}.${cleaned.substring(5,8)}/${cleaned.substring(8,12)}-${cleaned.substring(12)}`;
        }
        return cnpj;
    }
    
    // Get Portuguese label for key type
    function getKeyTypeLabel(keyType) {
        const labels = {
            'phone': 'Telefone',
            'email': 'E-mail',
            'cpf': 'CPF',
            'cnpj': 'CNPJ'
        };
        return labels[keyType] || keyType;
    }
    
    // Show PIX key modal/popup
    function showPixKeyModal(userId, existingKeyType = null, existingKey = null) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        // Create modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        `;
        
        // Modal title
        const title = document.createElement('h3');
        title.textContent = existingKeyType ? 'Editar Chave PIX' : 'Conectar Chave PIX';
        title.style.marginBottom = '20px';
        
        // Key type selection
        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Tipo de Chave:';
        typeLabel.style.display = 'block';
        typeLabel.style.marginBottom = '5px';
        typeLabel.style.fontWeight = 'bold';
        
        const typeSelect = document.createElement('select');
        typeSelect.id = 'pixKeyType';
        typeSelect.style.cssText = `
            width: 100%;
            padding: 10px;
            margin-bottom: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
        `;
        
        // Add options
        const options = [
            { value: 'phone', text: 'Telefone' },
            { value: 'email', text: 'E-mail' },
            { value: 'cpf', text: 'CPF' },
            { value: 'cnpj', text: 'CNPJ' }
        ];
        
        options.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.text;
            if (existingKeyType === option.value) {
                opt.selected = true;
            }
            typeSelect.appendChild(opt);
        });
        
        // Key input (initially hidden)
        const keyLabel = document.createElement('label');
        keyLabel.textContent = 'Chave PIX:';
        keyLabel.style.display = 'block';
        keyLabel.style.marginBottom = '5px';
        keyLabel.style.fontWeight = 'bold';
        keyLabel.style.display = 'none';
        
        const keyInput = document.createElement('input');
        keyInput.id = 'pixKeyValue';
        keyInput.type = 'text';
        keyInput.style.cssText = `
            width: 100%;
            padding: 10px;
            margin-bottom: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
            display: none;
        `;
        
        if (existingKey) {
            keyInput.value = existingKey;
        }
        
        // Placeholder and validation based on type
        function updateKeyInput() {
            const type = typeSelect.value;
            keyLabel.style.display = 'block';
            keyInput.style.display = 'block';
            
            switch(type) {
                case 'phone':
                    keyInput.placeholder = 'Digite o telefone (ex: 11999998888)';
                    keyInput.type = 'tel';
                    keyInput.pattern = '[0-9]{10,11}';
                    keyInput.title = 'Digite 10 ou 11 dígitos (DDD + número)';
                    break;
                case 'email':
                    keyInput.placeholder = 'Digite o e-mail';
                    keyInput.type = 'email';
                    break;
                case 'cpf':
                    keyInput.placeholder = 'Digite o CPF (apenas números)';
                    keyInput.type = 'text';
                    keyInput.pattern = '[0-9]{11}';
                    keyInput.title = 'Digite 11 dígitos';
                    break;
                case 'cnpj':
                    keyInput.placeholder = 'Digite o CNPJ (apenas números)';
                    keyInput.type = 'text';
                    keyInput.pattern = '[0-9]{14}';
                    keyInput.title = 'Digite 14 dígitos';
                    break;
            }
            
            // Auto-fill based on existing data
            if (type === 'email' && !existingKey) {
                keyInput.value = emailInput?.value || '';
            } else if ((type === 'cpf' || type === 'cnpj') && !existingKey) {
                keyInput.value = cpfCnpjInput?.value || '';
            } else if (type === 'phone' && !existingKey) {
                keyInput.value = phoneInput?.value?.replace(/\D/g, '') || '';
            }
        }
        
        // Initial update
        updateKeyInput();
        typeSelect.addEventListener('change', updateKeyInput);
        
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        `;
        
        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = existingKeyType ? 'Atualizar' : 'Salvar';
        saveBtn.className = 'btn btn-primary';
        saveBtn.addEventListener('click', async () => {
            const keyType = typeSelect.value;
            let keyValue = keyInput.value.trim();
            
            // Validation
            if (!keyValue) {
                alert('Por favor, digite a chave PIX');
                return;
            }
            
            // Clean input based on type
            if (keyType === 'phone') {
                keyValue = keyValue.replace(/\D/g, '');
                if (keyValue.length < 10 || keyValue.length > 11) {
                    alert('Telefone inválido. Digite 10 ou 11 dígitos (DDD + número)');
                    return;
                }
            } else if (keyType === 'cpf') {
                keyValue = keyValue.replace(/\D/g, '');
                if (keyValue.length !== 11) {
                    alert('CPF inválido. Digite 11 dígitos');
                    return;
                }
            } else if (keyType === 'cnpj') {
                keyValue = keyValue.replace(/\D/g, '');
                if (keyValue.length !== 14) {
                    alert('CNPJ inválido. Digite 14 dígitos');
                    return;
                }
            } else if (keyType === 'email') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(keyValue)) {
                    alert('E-mail inválido');
                    return;
                }
            }
            
            try {
                // Prepare update data
                const updateData = {
                    pix_keyType: keyType,
                    pix_key: keyValue,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                // If this is a new PIX key (not editing existing), set artista to true
                if (!existingKeyType) {
                    updateData.artista = true;
                }
                
                // Save to Firestore
                await db.collection("users").doc(userId).update(updateData);
                
                showNotification('Chave PIX salva com sucesso!', 'success');
                document.body.removeChild(overlay);
                
                // Refresh UI
                await checkPixKeyStatus(userId);
                
            } catch (error) {
                console.error('Error saving PIX key:', error);
                showNotification('Erro ao salvar chave PIX. Tente novamente.', 'error');
            }
        });
        
        // Assemble modal
        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(saveBtn);
        
        modal.appendChild(title);
        modal.appendChild(typeLabel);
        modal.appendChild(typeSelect);
        modal.appendChild(keyLabel);
        modal.appendChild(keyInput);
        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);
        
        // Close modal when clicking outside
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        // Add to page
        document.body.appendChild(overlay);
        
        // Focus on key input
        setTimeout(() => keyInput.focus(), 100);
    }
    
    // Create basic profile if doesn't exist
    async function createBasicProfile(userId) {
        const user = auth.currentUser;
        
        const basicProfile = {
            displayName: user.displayName || '',
            email: user.email || '',
            profilePicture: '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection("users").doc(userId).set(basicProfile, { merge: true });
        console.log("Basic profile created");
    }
    
    // Setup event listeners
    function setupEventListeners(userId) {
        // Edit/Save buttons
        if (editInfoBtn) {
            editInfoBtn.addEventListener("click", () => {
                enableFormEditing();
            });
        }
        
        if (saveInfoBtn) {
            saveInfoBtn.addEventListener("click", async () => {
                await saveProfile(userId);
            });
        }
        
        // Profile picture upload
        if (uploadPictureBtn && profilePictureInput) {
            uploadPictureBtn.addEventListener("click", () => {
                profilePictureInput.click();
            });
            
            profilePictureInput.addEventListener("change", async (event) => {
                await uploadProfilePicture(event.target.files[0], userId);
            });
        }
        
        // PIX key button
        if (connectPixBtn) {
            connectPixBtn.addEventListener("click", async () => {
                const userDoc = await db.collection("users").doc(userId).get();
                const userData = userDoc.data();
                
                showPixKeyModal(
                    userId, 
                    userData.pix_keyType, 
                    userData.pix_key
                );
            });
        }
        
        // Enter key to save
        document.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && saveInfoBtn && saveInfoBtn.style.display !== "none") {
                saveProfile(userId);
            }
        });
    }
    
    // Enable form editing
    function enableFormEditing() {
        const fields = [fullNameInput, cpfCnpjInput, addressInput, phoneInput, bioInput, websiteInput].filter(field => field !== null);
        
        fields.forEach(field => {
            field.removeAttribute("readonly");
            field.classList.add("editable");
        });
        
        if (editInfoBtn) {
            editInfoBtn.style.display = "none";
        }
        
        if (saveInfoBtn) {
            saveInfoBtn.style.display = "inline-block";
        }
        
        // Focus on first editable field
        if (fullNameInput) {
            fullNameInput.focus();
        }
    }
    
    // Disable form editing
    function disableFormEditing() {
        const fields = [fullNameInput, cpfCnpjInput, addressInput, phoneInput, bioInput, websiteInput].filter(field => field !== null);
        
        fields.forEach(field => {
            field.setAttribute("readonly", true);
            field.classList.remove("editable");
        });
        
        if (editInfoBtn) {
            editInfoBtn.style.display = "inline-block";
        }
        
        if (saveInfoBtn) {
            saveInfoBtn.style.display = "none";
        }
    }
    
    // Save profile data
    async function saveProfile(userId) {
        try {
            // Basic validation
            if (fullNameInput && !fullNameInput.value.trim()) {
                alert("Please enter your name");
                fullNameInput.focus();
                return;
            }
            
            if (cpfCnpjInput && !cpfCnpjInput.value.trim()) {
                alert("Please enter your CPF/CNPJ");
                cpfCnpjInput.focus();
                return;
            }
            
            if (addressInput && !addressInput.value.trim()) {
                alert("Please enter your address");
                addressInput.focus();
                return;
            }
            
            const userUpdateData = {
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            // Update user document with all available fields
            if (fullNameInput) {
                userUpdateData.displayName = fullNameInput.value.trim();
                userUpdateData.user_FullName = fullNameInput.value.trim();
                userUpdateData.fullLegalName = fullNameInput.value.trim();
            }
            
            if (cpfCnpjInput) {
                userUpdateData.cpfCnpj = cpfCnpjInput.value.trim();
            }
            
            if (addressInput) {
                userUpdateData.address = addressInput.value.trim();
            }
            
            if (bioInput) {
                userUpdateData.bio = bioInput.value.trim();
                userUpdateData.user_Bio = bioInput.value.trim();
            }
            
            if (websiteInput) {
                userUpdateData.website = websiteInput.value.trim();
            }
            
            await db.collection("users").doc(userId).update(userUpdateData);
            
            // Update contact document
            const contactId = `contact_${userId.split("_")[1]}`;
            const contactUpdateData = {
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            if (phoneInput) {
                contactUpdateData.contactTelephone = phoneInput.value.trim();
            }
            
            if (addressInput) {
                contactUpdateData.address = addressInput.value.trim();
            }
            
            await db.collection("contact").doc(contactId).set(contactUpdateData, { merge: true });
            
            // Disable editing
            disableFormEditing();
            
            // Show success message
            showNotification("Profile saved successfully!", "success");
            
            console.log("Profile saved successfully");
            
        } catch (error) {
            console.error("Error saving profile:", error);
            showNotification("Error saving profile. Please try again.", "error");
        }
    }
    
    // Upload new profile picture (converted to Base64)
    async function uploadProfilePicture(file, userId) {
        if (!file || !uploadPictureBtn || !profilePicturePreview) return;
        
        try {
            // Check file size (max 2MB for Base64 - Base64 increases size by ~33%)
            if (file.size > 2 * 1024 * 1024) {
                alert("File size must be less than 2MB");
                return;
            }
            
            // Check file type
            if (!file.type.match('image.*')) {
                alert("Please select an image file");
                return;
            }
            
            // Show loading state
            uploadPictureBtn.disabled = true;
            uploadPictureBtn.textContent = "Uploading...";
            
            // Convert image to Base64
            const reader = new FileReader();
            
            reader.onload = async function(event) {
                try {
                    const base64String = event.target.result;
                    
                    // Update user document with Base64 image string
                    await db.collection("users").doc(userId).update({
                        profilePicture: base64String,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    // Update preview
                    profilePicturePreview.src = base64String;
                    profilePicturePreview.style.display = 'block';
                    
                    // Reset button
                    uploadPictureBtn.disabled = false;
                    uploadPictureBtn.textContent = "Change Picture";
                    
                    // Show success message
                    showNotification("Profile picture updated!", "success");
                    
                    console.log("Profile picture uploaded successfully as Base64");
                    
                } catch (error) {
                    console.error("Error saving Base64 image:", error);
                    
                    // Reset button
                    uploadPictureBtn.disabled = false;
                    uploadPictureBtn.textContent = "Change Picture";
                    
                    showNotification("Error uploading picture. Please try again.", "error");
                }
            };
            
            reader.onerror = function(error) {
                console.error("Error reading file:", error);
                
                // Reset button
                uploadPictureBtn.disabled = false;
                uploadPictureBtn.textContent = "Change Picture";
                
                showNotification("Error reading image file. Please try again.", "error");
            };
            
            // Read the file as Base64
            reader.readAsDataURL(file);
            
        } catch (error) {
            console.error("Error uploading profile picture:", error);
            
            // Reset button
            if (uploadPictureBtn) {
                uploadPictureBtn.disabled = false;
                uploadPictureBtn.textContent = "Change Picture";
            }
            
            showNotification("Error uploading picture. Please try again.", "error");
        }
    }
    
    // Helper function to show notifications
    function showNotification(message, type = "info") {
        // Create notification element
        const notification = document.createElement("div");
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        if (type === "success") {
            notification.style.backgroundColor = "#4CAF50";
        } else if (type === "error") {
            notification.style.backgroundColor = "#F44336";
        } else {
            notification.style.backgroundColor = "#2196F3";
        }
        
        // Add to page
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = "slideOut 0.3s ease";
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    // Helper function to get Firestore user ID from Firebase UID
    async function getUserIdFromUid(uid) {
        const querySnapshot = await db.collection("users")
            .where("firebaseUID", "==", uid)
            .limit(1)
            .get();
            
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].id;
        }
        
        // If no user found with firebaseUID, try to find by email
        const user = auth.currentUser;
        if (user && user.email) {
            const emailQuery = await db.collection("users")
                .where("email", "==", user.email)
                .limit(1)
                .get();
                
            if (!emailQuery.empty) {
                const userDoc = emailQuery.docs[0];
                // Update the document with firebaseUID
                await userDoc.ref.update({
                    firebaseUID: uid
                });
                return userDoc.id;
            }
        }
        
        // Create new user document
        const newUserRef = db.collection("users").doc();
        await newUserRef.set({
            firebaseUID: uid,
            email: user.email || '',
            displayName: user.displayName || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        return newUserRef.id;
    }
    
    // Add CSS for animations
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
        input.editable, textarea.editable {
            background-color: #f9f9f9;
            border-color: #4CAF50;
        }
        #profilePicturePreview {
            max-width: 150px;
            max-height: 150px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #f0f0f0;
            margin-bottom: 15px;
        }
        .pix-connected {
            color: #28a745;
            font-weight: bold;
        }
        .pix-disconnected {
            color: #dc3545;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);
    
    // Initialize the page
    initializePage();
});