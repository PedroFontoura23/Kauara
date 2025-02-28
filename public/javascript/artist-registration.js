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
    const REDIRECT_URI = "https://kauara1.web.app/pages/artist-callback.html";

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
    const logoutMercadoPagoBtn = document.getElementById("logoutMercadoPago");
    const connectPrintfulBtn = document.getElementById("connectPrintful");
    const mpConnectionStatus = document.getElementById("mpConnectionStatus");
    const printfulConnectionStatus = document.getElementById("printfulConnectionStatus");

    // CPF/CNPJ Input Masking
    cpfCnpjInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length <= 11) {
            value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        } else {
            value = value.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
        }
        e.target.value = value;
    });

    // Check Authentication and Load Data
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "kauara.html";
            return;
        }

        const firestoreUserId = await getUserIdFromUid(user.uid);
        const userDoc = await db.collection("users").doc(firestoreUserId).get();

        if (!userDoc.exists) {
            alert("User data not found.");
            return;
        }

        const userData = userDoc.data();
        fullNameInput.value = userData.fullLegalName || userData.user_Name || '';
        cpfCnpjInput.value = userData.cpfCnpj || '';
        addressInput.value = userData.address || '';
        
        const contactId = `contact_${firestoreUserId.split("_")[1]}`;
        const contactDoc = await db.collection("contact").doc(contactId).get();
        if (contactDoc.exists) {
            phoneInput.value = contactDoc.data().contactTelephone || '';
        }

        // Check Mercado Pago Connection
        if (userData.mercadoPagoConnected) {
            mpConnectionStatus.textContent = "Connected";
            connectMercadoPagoBtn.style.display = "none";
            logoutMercadoPagoBtn.style.display = "inline-block";
        }

        // Check Printful Connection (placeholder logic)
        if (userData.printfulConnected) {
            printfulConnectionStatus.textContent = "Connected";
            connectPrintfulBtn.style.display = "none";
        }
    });

    // Helper Function to Get User ID
    function getUserIdFromUid(uid) {
        return db.collection("users").where("firebaseUID", "==", uid).get()
            .then((querySnapshot) => {
                if (!querySnapshot.empty) {
                    return querySnapshot.docs[0].id;
                }
                throw new Error(`No user found for UID: ${uid}`);
            });
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
    });

    // Mercado Pago Connection
    connectMercadoPagoBtn.addEventListener("click", async () => {
        const user = auth.currentUser;
        if (!user) return;

        const firestoreUserId = await getUserIdFromUid(user.uid);
        const state = encodeURIComponent(btoa(firestoreUserId));
        localStorage.setItem('mpAuthState', state);

        const { codeVerifier, codeChallenge } = await generateCodeChallenge();
        const authUrl = `https://auth.mercadopago.com/authorization?client_id=${MERCADO_PAGO_CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

        window.location.href = authUrl;
    });

    // Disconnect from Mercado Pago
    logoutMercadoPagoBtn.addEventListener("click", async () => {
        const user = auth.currentUser;
        if (!user) {
            alert("Você precisa estar logado para desconectar.");
            return;
        }

        try {
            document.getElementById("loadingIndicator").style.display = "block";
            const firestoreUserId = await getUserIdFromUid(user.uid);

            await db.collection("users").doc(firestoreUserId).update({
                mercadoPagoConnected: false,
                mercadoPagoUserId: null,
                mercadoPagoTokenRef: null,
                mercadoPagoDisconnectedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("Mercado Pago connection cleared in Firestore.");

            mpConnectionStatus.textContent = "Not Connected";
            connectMercadoPagoBtn.style.display = "inline-block";
            logoutMercadoPagoBtn.style.display = "none";

            localStorage.removeItem("mp_code_verifier");
            localStorage.removeItem("mpAuthState");

            document.getElementById("loadingIndicator").style.display = "none";

            alert("Você será redirecionado ao site do Mercado Pago, desconecte-se lá.");
            const mercadoPagoLogoutUrl = "https://www.mercadopago.com.br";
            const returnUrl = encodeURIComponent(window.location.href);
            window.location.href = `${mercadoPagoLogoutUrl}?redirect=${returnUrl}`;
        } catch (error) {
            console.error("Error disconnecting from Mercado Pago:", error);
            document.getElementById("loadingIndicator").style.display = "none";
            alert("Erro ao desconectar: " + error.message);
        }
    });

    // Printful Connection (Placeholder)
    connectPrintfulBtn.addEventListener("click", async () => {
        alert("Printful connection not fully implemented in this example.");
        // Add Printful OAuth logic here
    });

    // PKCE Code Challenge Generation
    async function generateCodeChallenge() {
        const codeVerifier = [...Array(64)].map(() => Math.random().toString(36)[2]).join("");
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const base64Hash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        localStorage.setItem("mp_code_verifier", codeVerifier);
        return { codeVerifier, codeChallenge: base64Hash };
    }

    // Handle Mercado Pago Callback
    const urlParams = new URLSearchParams(window.location.search);
    const mpCode = urlParams.get('code');
    const state = urlParams.get('state');
    const source = urlParams.get('source');

    if (mpCode && state && source === 'mp') {
        const savedState = localStorage.getItem('mpAuthState');
        if (savedState === state) {
            document.getElementById("loadingIndicator").style.display = "block";
            exchangeMercadoPagoToken(mpCode, state);
        } else {
            alert("Security error. Please try again.");
            window.location.href = "artist-page.html";
        }
    }

    async function exchangeMercadoPagoToken(code, state) {
        try {
            const firestoreUserId = atob(decodeURIComponent(state));
            const codeVerifier = localStorage.getItem("mp_code_verifier");
            const response = await fetch('https://api.mercadopago.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                body: new URLSearchParams({
                    'client_id': MERCADO_PAGO_CLIENT_ID,
                    'client_secret': 'EQhcpoRF4HIg8wvwE3udiQgK0f8kfAsR',
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': REDIRECT_URI,
                    'code_verifier': codeVerifier
                })
            });

            const result = await response.json();
            if (result.access_token) {
                await db.collection("users").doc(firestoreUserId).update({
                    mercadoPagoConnected: true,
                    mercadoPagoUserId: result.user_id,
                    mercadoPagoTokenRef: result.access_token,
                    mercadoPagoConnectedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                mpConnectionStatus.textContent = "Connected";
                connectMercadoPagoBtn.style.display = "none";
                logoutMercadoPagoBtn.style.display = "inline-block";
                alert("Mercado Pago connected successfully!");
            }
            document.getElementById("loadingIndicator").style.display = "none";
        } catch (error) {
            console.error("Error exchanging Mercado Pago token:", error);
            alert("Error connecting Mercado Pago: " + error.message);
            document.getElementById("loadingIndicator").style.display = "none";
        }
    }

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