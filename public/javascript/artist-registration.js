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
    
    // Constants
    const MERCADO_PAGO_CLIENT_ID = "8000562204726523";
    const PRINTFUL_CLIENT_ID = "app-5311675";
    const REDIRECT_URI = "https://kauara1.web.app/artist-callback.html";

    // Initialize Mercado Pago SDK
    let mp;
    try {
        mp = new MercadoPago('APP_USR-66e8e79a-0f3e-46d6-9e97-b15bb1320890', { locale: 'es-AR' });
        console.log("MercadoPago SDK initialized successfully");
    } catch (error) {
        console.error("Error initializing MercadoPago:", error);
    }
    
    // Elements
    const fullNameInput = document.getElementById("fullName");
    const cpfCnpjInput = document.getElementById("cpfCnpj");
    const addressInput = document.getElementById("address");
    const phoneInput = document.getElementById("phone");
    const editInfoBtn = document.getElementById("editInfoBtn");
    const saveInfoBtn = document.getElementById("saveInfoBtn");
    const connectMercadoPagoBtn = document.getElementById("connectMercadoPago");
    const mpConnectionStatus = document.getElementById("mpConnectionStatus");
    const printfulConnectionStatus = document.getElementById("printfulConnectionStatus");

    // Check if all required fields are filled
    function checkFormCompletion() {
        return fullNameInput.value.trim() !== '' && 
               cpfCnpjInput.value.trim() !== '' && 
               addressInput.value.trim() !== '' && 
               phoneInput.value.trim() !== '';
    }

    // Update Mercado Pago button state
    function updateMercadoPagoButtonState() {
        const isFormComplete = checkFormCompletion();
        connectMercadoPagoBtn.disabled = !isFormComplete;
        const requirementsAlert = document.getElementById("mpRequirements");
        
        if (!isFormComplete) {
            connectMercadoPagoBtn.title = "Please complete all your information first";
            connectMercadoPagoBtn.classList.add("disabled");
            requirementsAlert.style.display = "block";
        } else {
            connectMercadoPagoBtn.title = "";
            connectMercadoPagoBtn.classList.remove("disabled");
            requirementsAlert.style.display = "none";
        }
    }

    // CPF/CNPJ Input Masking
    cpfCnpjInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length <= 11) {
            value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        } else {
            value = value.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
        }
        e.target.value = value;
        updateMercadoPagoButtonState();
    });

    // Connect Mercado Pago Button
    connectMercadoPagoBtn.addEventListener("click", async () => {
        try {
            // Generate and store code verifier
            const codeVerifier = generateRandomString(32);
            localStorage.setItem('mp_code_verifier', codeVerifier);
            
            // Generate code challenge
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            
            // Clear any previous errors from URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Build authorization URL with PKCE parameters
            const authUrl = `https://auth.mercadopago.com/authorization?` +
                `client_id=${MERCADO_PAGO_CLIENT_ID}&` +
                `response_type=code&` +
                `platform_id=mp&` +
                `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
                `scope=offline_access payments&` +
                `code_challenge=${codeChallenge}&` +
                `code_challenge_method=S256`;
                
            window.location.href = authUrl;
        } catch (error) {
            console.error("Error initiating Mercado Pago connection:", error);
            alert("Error connecting to Mercado Pago. Please try again.");
        }
    });

    // Helper function to generate random string
    function generateRandomString(length = 32) {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return btoa(String.fromCharCode.apply(null, array))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    // Helper function to generate code challenge
    async function generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        
        return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    // Check Mercado Pago connection status
    async function checkMercadoPagoConnection(userId) {
        try {
            // Get the user document
            const userDoc = await db.collection("users").doc(userId).get();
            
            if (!userDoc.exists) {
                updateMercadoPagoUI(false, false);
                return false;
            }

            const userData = userDoc.data();
            
            // Check if mercadopago_info exists in the user document
            if (userData.mercadopago_info) {
                // Check if we have all required payment information
                const hasPaymentInfo = userData.mercadopago_info.bank_accounts && 
                                     userData.mercadopago_info.bank_accounts.length > 0 &&
                                     userData.mercadopago_info.payment_methods;
                
                updateMercadoPagoUI(true, hasPaymentInfo);
                return true;
            }
            
            // Fallback to check the subcollection (for backward compatibility)
            const mpSubcollection = await db.collection("users")
                .doc(userId)
                .collection("mercadopago_info")
                .get();
            
            if (!mpSubcollection.empty) {
                const mpData = mpSubcollection.docs[0].data();
                
                // Check if we have all required payment information
                const hasPaymentInfo = mpData.bank_accounts && 
                                     mpData.bank_accounts.length > 0 &&
                                     mpData.payment_methods;
                
                updateMercadoPagoUI(true, hasPaymentInfo);
                return true;
            }
            
            // If neither exists, not connected
            updateMercadoPagoUI(false, false);
            return false;
        } catch (error) {
            console.error("Error checking MP connection:", error);
            updateMercadoPagoUI(false, false);
            return false;
        }
    }

    // Update UI based on MP connection status
    function updateMercadoPagoUI(isConnected, hasPaymentInfo) {
        if (isConnected) {
            mpConnectionStatus.textContent = hasPaymentInfo ? "Connected (Payments Ready)" : "Conectado (Setup completo)";
            mpConnectionStatus.setAttribute("data-status", "connected");
            connectMercadoPagoBtn.textContent = "Mudar conta Mercado Pago";
        } else {
            mpConnectionStatus.textContent = "Desconectado";
            mpConnectionStatus.setAttribute("data-status", "disconnected");
            connectMercadoPagoBtn.textContent = "Conectar Mercado Pago";
        }
    }
    
    // Check Authentication and Load Data
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "inicio.html";
            return;
        }

        try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            const userDoc = await db.collection("users").doc(firestoreUserId).get();

            if (!userDoc.exists) {
                alert("User data not found.");
                return;
            }

            // Load basic user data
            const userData = userDoc.data();
            fullNameInput.value = userData.fullLegalName || userData.user_Name || '';
            cpfCnpjInput.value = userData.cpfCnpj || '';
            addressInput.value = userData.address || '';
            
            // Load contact info
            const contactId = `contact_${firestoreUserId.split("_")[1]}`;
            const contactDoc = await db.collection("contact").doc(contactId).get();
            if (contactDoc.exists) {
                phoneInput.value = contactDoc.data().contactTelephone || '';
            }

            // Check URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('success')) {
                // Clear the success parameter from URL
                window.history.replaceState({}, document.title, window.location.pathname);
                alert("Successfully connected to Mercado Pago!");
            } else if (urlParams.get('error')) {
                // Display error message
                const error = urlParams.get('error');
                const errorDesc = urlParams.get('error_description') || '';
                alert(`Error: ${error}${errorDesc ? '\n' + errorDesc : ''}`);
                // Clear the error parameters from URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            // Check Mercado Pago connection
            await checkMercadoPagoConnection(firestoreUserId);
            
            // Update button state after loading data
            updateMercadoPagoButtonState();

        } catch (error) {
            console.error("Error loading user data:", error);
            alert("Error loading user data. Please try again.");
        }
    });

    // Helper Function to Get User ID
    async function getUserIdFromUid(uid) {
        const querySnapshot = await db.collection("users").where("firebaseUID", "==", uid).get();
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].id;
        }
        throw new Error(`No user found for UID: ${uid}`);
    }

    // Edit/Save Information
    editInfoBtn.addEventListener("click", () => {
        fullNameInput.removeAttribute("readonly");
        cpfCnpjInput.removeAttribute("readonly");
        addressInput.removeAttribute("readonly");
        phoneInput.removeAttribute("readonly");
        editInfoBtn.style.display = "none";
        saveInfoBtn.style.display = "inline-block";
    });

    saveInfoBtn.addEventListener("click", async () => {
        const user = auth.currentUser;
        if (!user) return;

        const cpfCnpj = cpfCnpjInput.value.replace(/\D/g, '');
        if (!validateCpfCnpj(cpfCnpj)) {
            alert("Invalid CPF/CNPJ.");
            return;
        }

        const firestoreUserId = await getUserIdFromUid(user.uid);
        await db.collection("users").doc(firestoreUserId).update({
            fullLegalName: fullNameInput.value,
            cpfCnpj: cpfCnpj,
            address: addressInput.value,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        const contactId = `contact_${firestoreUserId.split("_")[1]}`;
        await db.collection("contact").doc(contactId).set({
            contactTelephone: phoneInput.value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        fullNameInput.setAttribute("readonly", true);
        cpfCnpjInput.setAttribute("readonly", true);
        addressInput.setAttribute("readonly", true);
        phoneInput.setAttribute("readonly", true);
        editInfoBtn.style.display = "inline-block";
        saveInfoBtn.style.display = "none";
        alert("Information updated successfully!");
        updateMercadoPagoButtonState();
    });

    // Add event listeners to all form fields
    [fullNameInput, addressInput, phoneInput].forEach(input => {
        input.addEventListener('input', updateMercadoPagoButtonState);
    });

    // Validation Functions
    function validateCpfCnpj(value) {
        const valueClean = value.replace(/\D/g, '');
        return valueClean.length === 11 ? validateCpf(valueClean) : valueClean.length === 14 ? validateCnpj(valueClean) : false;
    }

    function validateCpf(cpf) {
        if (/^(\d)\1{10}$/.test(cpf)) return false;
        let sum = 0, remainder;
        for (let i = 1; i <= 9; i++) sum += parseInt(cpf[i-1]) * (11 - i);
        remainder = (sum * 10) % 11; if (remainder > 9) remainder = 0;
        if (remainder !== parseInt(cpf[9])) return false;
        sum = 0;
        for (let i = 1; i <= 10; i++) sum += parseInt(cpf[i-1]) * (12 - i);
        remainder = (sum * 10) % 11; if (remainder > 9) remainder = 0;
        return remainder === parseInt(cpf[10]);
    }

    function validateCnpj(cnpj) {
        if (/^(\d)\1{13}$/.test(cnpj)) return false;
        let size = 12, numbers = cnpj.substring(0, size), digits = cnpj.substring(size), sum = 0, pos = 5;
        for (let i = 0; i < size; i++) {
            sum += numbers[i] * (pos + (i < 4 ? 1 : 0)); pos = pos === 2 ? 9 : pos - 1;
        }
        let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        if (result !== parseInt(digits[0])) return false;
        size++; numbers = cnpj.substring(0, size); sum = 0; pos = 6;
        for (let i = 0; i < size; i++) {
            sum += numbers[i] * (pos + (i < 5 ? 1 : 0)); pos = pos === 2 ? 9 : pos - 1;
        }
        result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        return result === parseInt(digits[1]);
    }
});