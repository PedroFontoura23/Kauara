document.addEventListener("DOMContentLoaded", function() {
    // Initialize Firebase
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S",
    };
    
    // Check if Firebase is already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.firestore();
    
    // Constants
    const MERCADO_PAGO_CLIENT_ID = "8000562204726523"; // Use your actual client ID
    const PRINTFUL_CLIENT_ID = "app-5311675"; // Use your actual client ID
    const REDIRECT_URI = "https://kauara1.web.app/pages/artist-callback.html";
    const ENCRYPTION_SECRET = "your-encryption-secret"; // This should be stored securely

    // Initialize the Mercado Pago SDK
    let mp;
    try {
        mp = new MercadoPago('APP_USR-66e8e79a-0f3e-46d6-9e97-b15bb1320890', {
            locale: 'es-AR' // The locale of your preference
        });
        console.log("MercadoPago SDK initialized successfully");


    } catch (error) {
        console.error("Error initializing MercadoPago:", error);
    }
    
    // Elements
    const step1El = document.getElementById("step1");
    const step2El = document.getElementById("step2");
    const step3El = document.getElementById("step3");
    const step4El = document.getElementById("step4");
    const continueToStep2Btn = document.getElementById("continueToStep2");
    const backToStep1Btn = document.getElementById("backToStep1");
    const connectMercadoPagoBtn = document.getElementById("connectMercadoPago");
    const connectPrintfulBtn = document.getElementById("connectPrintful");
    const goToProfileBtn = document.getElementById("goToProfile");
    const cpfCnpjInput = document.getElementById("cpfCnpj");
    
    // Form validation for CPF/CNPJ (unchanged)
    cpfCnpjInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        
        // Apply mask based on length (CPF or CNPJ)
        if (value.length <= 11) {
            value = value.replace(/(\d{3})(\d)/, "$1.$2");
            value = value.replace(/(\d{3})(\d)/, "$1.$2");
            value = value.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        } else {
            value = value.replace(/^(\d{2})(\d)/, "$1.$2");
            value = value.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
            value = value.replace(/\.(\d{3})(\d)/, ".$1/$2");
            value = value.replace(/(\d{4})(\d)/, "$1-$2");
        }
        
        e.target.value = value;
    });
    
    // Ensure user is logged in (unchanged)
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "kauara.html"; // Redirect if not logged in
            return;
        }
        
        // Check if user is already an artist (unchanged)
        const firestoreUserId = await getUserIdFromUid(user.uid);
        const userDoc = await db.collection("users").doc(firestoreUserId).get();
        
        if (userDoc.exists && userDoc.data().artista) {
            alert("Você já é um artista registrado na plataforma!");
            window.location.href = "profile.html";
        }
        
        // Attempt to pre-fill the form with existing user data (unchanged)
        if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.user_Name) {
                document.getElementById("fullName").value = userData.user_Name;
            }
            
            if (userData.phone) {
                document.getElementById("phone").value = userData.phone;
            }
            
            if (userData.address) {
                document.getElementById("address").value = userData.address;
            }
        }
    });
    
    // Helper function to get user ID format from Firebase UID (unchanged)
    function getUserIdFromUid(uid) {
        return db
            .collection("users")
            .where("firebaseUID", "==", uid)
            .get()
            .then((querySnapshot) => {
                if (!querySnapshot.empty) {
                    return querySnapshot.docs[0].id; // Return the user_(number)
                } else {
                    throw new Error(`No user found for UID: ${uid}`);
                }
            });
    }
    
    // Navigation between steps (unchanged)
    continueToStep2Btn.addEventListener("click", async function() {
        const form = document.getElementById("artistInfoForm");
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }
        
        const user = auth.currentUser;
        if (!user) {
            alert("Você precisa estar logado para continuar.");
            return;
        }
        
        // Validate CPF/CNPJ format and digits (unchanged)
        const cpfCnpj = cpfCnpjInput.value.replace(/\D/g, '');
        if (!validateCpfCnpj(cpfCnpj)) {
            alert("CPF/CNPJ inválido. Por favor verifique os dados.");
            return;
        }
        
        try {
            // Save initial artist information (unchanged)
            const firestoreUserId = await getUserIdFromUid(user.uid);
            await db.collection("users").doc(firestoreUserId).update({
                artistRegistrationStatus: "in_progress",
                fullLegalName: document.getElementById("fullName").value,
                cpfCnpj: cpfCnpj,
                address: document.getElementById("address").value,
                termsAccepted: true,
                registrationStartedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await db.collection("contact").doc(`contact_${firestoreUserId}`).set({
                contactTelephone: document.getElementById("phone").value,
                foreignUserId: firestoreUserId,
                firebaseUID: auth.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            await db.collection("users").doc(firestoreUserId).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
            });
            // Move to Mercado Pago step
            step1El.style.display = "none";
            step2El.style.display = "block";
        } catch (error) {
            console.error("Error saving artist information:", error);
            alert("Ocorreu um erro ao salvar suas informações. Por favor tente novamente.");
        }
    });
    
    backToStep1Btn.addEventListener("click", function() {
        step2El.style.display = "none";
        step1El.style.display = "block";
    });

    async function generateCodeChallenge() {
        const codeVerifier = [...Array(64)]
            .map(() => Math.random().toString(36)[2])
            .join("");

        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const base64Hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        localStorage.setItem("mp_code_verifier", codeVerifier); // Store it for later use

        return { codeVerifier, codeChallenge: base64Hash };
    }
    
    // Mercado Pago Connection (updated to handle token exchange client-side for testing)
    connectMercadoPagoBtn.addEventListener("click", async function() {
        const user = auth.currentUser;  // Check if user is logged in
        if (!user) {
            alert("Você precisa estar logado para continuar.");
            return;
        }
        
        try {
            const firestoreUserId = await getUserIdFromUid(user.uid);
            
            // Generate a secure state parameter with user ID for callback verification
            const state = encodeURIComponent(btoa(firestoreUserId));
            
            // Store the state in localStorage for verification on callback
            localStorage.setItem('mpAuthState', state);
            
            // Build Mercado Pago OAuth URL - note the changed response_type
            const authUrl = `https://auth.mercadopago.com/authorization?client_id=${MERCADO_PAGO_CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
            console.log("Auth URL:", authUrl);
            
            // Update the user's registration status
            await db.collection("users").doc(firestoreUserId).update({
                mercadoPagoConnectionAttempt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Redirect to Mercado Pago for authorization
            window.location.href = authUrl;
        } catch (error) {
            console.error("Error connecting to Mercado Pago:", error);
            alert("Ocorreu um erro ao conectar com o Mercado Pago. Por favor tente novamente.");
        }
    });

    async function connectMercadoPago() {
        try {
            console.log("Generating PKCE Code Challenge...");
            const { codeVerifier, codeChallenge } = await generateCodeChallenge();

            console.log("Code Verifier (stored):", codeVerifier);
            console.log("Code Challenge (sent to Mercado Pago):", codeChallenge);

            const state = encodeURIComponent(btoa("user_1"));
            const authUrl = `https://auth.mercadopago.com/authorization?client_id=${MERCADO_PAGO_CLIENT_ID}
                &response_type=code
                &platform_id=mp
                &redirect_uri=${encodeURIComponent(REDIRECT_URI)}
                &state=${state}
                &code_challenge=${codeChallenge}
                &code_challenge_method=S256`;

            console.log("Auth URL:", authUrl);
            window.location.href = authUrl;
        } catch (error) {
            console.error("Error generating PKCE parameters:", error);
            alert("Failed to initiate Mercado Pago connection. Please try again.");
        }
    }

    // Check for callback parameters from OAuth redirects (updated)
    const urlParams = new URLSearchParams(window.location.search);
    console.log("URL Params in artist-registration.html:", urlParams.toString());

    const mpCode = urlParams.get('code');
    const state = urlParams.get('state');
    const source = urlParams.get('source');

    console.log("Received Mercado Pago Code:", mpCode);
    console.log("Received State:", state);
    console.log("Received Source:", source);


    if (mpCode && state && source === 'mp') {
        const savedState = localStorage.getItem('mpAuthState');
        if (savedState === state) {
            // Show loading indicator
            step1El.style.display = "none";
            step2El.style.display = "none";
            document.getElementById("loadingIndicator").style.display = "block"; // Add this element to your HTML
            
            exchangeMercadoPagoToken(mpCode, state);
        } else {
            console.error("State parameter mismatch. Possible CSRF attack.");
            alert("Erro de segurança. Por favor tente novamente.");
            window.location.href = "artist-registration.html";
        }
    }

    // Function to exchange Mercado Pago token (client-side for testing)
    async function exchangeMercadoPagoToken(code, state) {
        try {
            console.log("Starting token exchange with code:", code.substring(0, 5) + "...");
            const firestoreUserId = atob(decodeURIComponent(state));
            console.log("User ID from state:", firestoreUserId);

            // Retrieve the code_verifier from localStorage
            const codeVerifier = localStorage.getItem("mp_code_verifier");
            if (!codeVerifier) {
                console.error("🚨 ERROR: code_verifier is missing from localStorage!");
                console.log("localStorage contents:", JSON.stringify(localStorage));
                throw new Error("Missing code_verifier. Cannot exchange token.");
            }
            console.log("Using code_verifier:", codeVerifier);

            // Make the token exchange request
            console.log("Making request to Mercado Pago API...");
            const response = await fetch('https://api.mercadopago.com/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    'client_id': MERCADO_PAGO_CLIENT_ID,
                    'client_secret': 'EQhcpoRF4HIg8wvwE3udiQgK0f8kfAsR',
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': REDIRECT_URI,
                    'code_verifier': codeVerifier // REQUIRED for PKCE flow
                })
            });

            console.log("MP API Response Status:", response.status);
            const responseText = await response.text();
            console.log("MP API Response Text:", responseText);

            // Parse the JSON response (if possible)
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                console.error("Failed to parse response as JSON:", e);
                throw new Error("Invalid response format from Mercado Pago");
            }

            if (!response.ok) {
                throw new Error(`Mercado Pago API error: ${result.message || response.statusText}`);
            }

            if (result.access_token) {
                console.log("Access token received successfully!");

                // Try updating Firestore
                console.log("Updating Firestore for user:", firestoreUserId);
                try {
                    await db.collection("users").doc(firestoreUserId).update({
                        mercadoPagoConnected: true,
                        mercadoPagoUserId: result.user_id,
                        mercadoPagoTokenRef: result.access_token,
                        mercadoPagoConnectedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        artistRegistrationStatus: "mp_connected" // Add this to track progress
                    });
                    console.log("Firestore update successful!");
                } catch (firestoreError) {
                    console.error("Firestore update failed:", firestoreError);
                    // Check if document exists
                    const docRef = db.collection("users").doc(firestoreUserId);
                    const docSnapshot = await docRef.get();
                    console.log("Document exists:", docSnapshot.exists);
                    if (docSnapshot.exists) {
                        console.log("Current document data:", docSnapshot.data());
                    }
                    throw firestoreError;
                }

                // Move to next step after successful connection
                alert("Mercado Pago connected successfully!");
                document.getElementById("loadingIndicator").style.display = "none"; 
                step2El.style.display = "none";
                step3El.style.display = "block";
            } else {
                throw new Error('OAuth response missing access token');
            }
        } catch (error) {
            console.error("Error exchanging Mercado Pago token:", error);
            alert("Erro ao conectar com o Mercado Pago: " + error.message);
            
            document.getElementById("loadingIndicator").style.display = "none";
            step1El.style.display = "none";
            step2El.style.display = "block";
            step3El.style.display = "none";
        }
    }


    // Validation functions (unchanged)
    function validateCpfCnpj(value) {
        const valueClean = value.replace(/[^\d]+/g, '');
        
        if (valueClean.length === 11) {
            return validateCpf(valueClean);
        }
        
        if (valueClean.length === 14) {
            return validateCnpj(valueClean);
        }
        
        return false;
    }
    
    // Basic CPF validation
    function validateCpf(cpf) {
        // Check for known invalid patterns
        if (
            cpf === "00000000000" ||
            cpf === "11111111111" ||
            cpf === "22222222222" ||
            cpf === "33333333333" ||
            cpf === "44444444444" ||
            cpf === "55555555555" ||
            cpf === "66666666666" ||
            cpf === "77777777777" ||
            cpf === "88888888888" ||
            cpf === "99999999999"
        ) {
            return false;
        }
        
        // Validation using check digits
        let sum = 0;
        let remainder;
        
        for (let i = 1; i <= 9; i++) {
            sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
        }
        
        remainder = (sum * 10) % 11;
        if (remainder === 10 || remainder === 11) remainder = 0;
        if (remainder !== parseInt(cpf.substring(9, 10))) return false;
        
        sum = 0;
        for (let i = 1; i <= 10; i++) {
            sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
        }
        
        remainder = (sum * 10) % 11;
        if (remainder === 10 || remainder === 11) remainder = 0;
        if (remainder !== parseInt(cpf.substring(10, 11))) return false;
        
        return true;
    }
    
    // Basic CNPJ validation
    function validateCnpj(cnpj) {
        // Check for known invalid patterns
        if (
            cnpj === "00000000000000" ||
            cnpj === "11111111111111" ||
            cnpj === "22222222222222" ||
            cnpj === "33333333333333" ||
            cnpj === "44444444444444" ||
            cnpj === "55555555555555" ||
            cnpj === "66666666666666" ||
            cnpj === "77777777777777" ||
            cnpj === "88888888888888" ||
            cnpj === "99999999999999"
        ) {
            return false;
        }
        
        // Validation using check digits
        let size = cnpj.length - 2;
        let numbers = cnpj.substring(0, size);
        let digits = cnpj.substring(size);
        let sum = 0;
        let pos = size - 7;
        
        for (let i = size; i >= 1; i--) {
            sum += numbers.charAt(size - i) * pos--;
            if (pos < 2) pos = 9;
        }
        
        let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        if (result !== parseInt(digits.charAt(0))) return false;
        
        size += 1;
        numbers = cnpj.substring(0, size);
        sum = 0;
        pos = size - 7;
        
        for (let i = size; i >= 1; i--) {
            sum += numbers.charAt(size - i) * pos--;
            if (pos < 2) pos = 9;
        }
        
        result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        if (result !== parseInt(digits.charAt(1))) return false;
        
        return true;
    }
});