// 🔹 Replace with your Printful App credentials
const PRINTFUL_CLIENT_ID = "app-5311675";
const PRINTFUL_CLIENT_SECRET = "6riaqbe9kVMbLAC41rprAghUAql6TgWbBoGp4ycL3CA9yDjkcv4fI8w6XHpDmiOg";
const REDIRECT_URI = "https://kauara1.web.app/oauth/callback";

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
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();


// Get the status element
const statusElement = document.getElementById("authStatus");

// Ensure the element exists before trying to modify it
if (statusElement) {
    statusElement.innerHTML = "Aguardando autenticação...";
} else {
    console.error("❌ Element 'authStatus' not found in HTML.");
}
console.log("🔍 Full URL received:", window.location.href);

// Extract authorization code from URL
const urlParams = new URLSearchParams(window.location.search);
const authCode = urlParams.get("code");

if (authCode) {
    console.log("✅ Authorization code received:", authCode);
    getAccessToken(authCode);
} else {
    console.error("❌ Nenhum código de autorização encontrado.");
    document.body.innerHTML = `<h2>Erro: Nenhum código de autorização encontrado.</h2>`;
}

// Function to exchange authorization code for access token
async function getAccessToken(authCode) {
    try {
        const response = await fetch("https://api.printful.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: PRINTFUL_CLIENT_ID,
                client_secret: PRINTFUL_CLIENT_SECRET,
                code: authCode,
                grant_type: "authorization_code",
                redirect_uri: REDIRECT_URI
            })
        });

        const data = await response.json();
        if (data.access_token) {
            console.log("✅ Printful Access Token received:", data.access_token);

            if (statusElement) {
                statusElement.innerHTML = "Autenticação bem-sucedida! Salvando dados...";
            }

            // Save it to Firestore under the logged-in Firebase user
            auth.onAuthStateChanged(async (user) => {
                if (user) {
                    const userRef = db.collection("users").doc(user.uid);
                    await userRef.update({
                        printfulAccessToken: data.access_token,
                        printfulStoreId: data.store_id,
                        artistRequested: true
                    });

                    // 🔹 Send an admin alert that this user wants to become an artist
                    await db.collection("admin_notifications").add({
                        userId: user.uid,
                        email: user.email,
                        type: "artist_request",
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    console.log("✅ Printful access token saved & admin notified!");

                    if (statusElement) {
                        statusElement.innerHTML = "Seu pedido para se tornar artista foi enviado! Aguarde aprovação.";
                    }
                    
                    setTimeout(() => {
                        window.location.href = "profile.html"; // Redirect back to profile
                    }, 2000);
                } else {
                    console.error("❌ No Firebase user logged in.");
                }
            });
        } else {
            console.error("❌ Erro na autenticação com Printful:", data);

            if (statusElement) {
                statusElement.innerHTML = "<h2>Erro na autenticação com Printful.</h2>";
            }
        }
    } catch (error) {
        console.error("❌ Falha ao conectar com Printful:", error);

        if (statusElement) {
            statusElement.innerHTML = "<h2>Erro ao conectar com Printful.</h2>";
        }
    }
}

// 🔹 Extract authorization code from URL and exchange for an access token
const urlParams = new URLSearchParams(window.location.search);
const authCode = urlParams.get("code");

if (authCode) {
    getAccessToken(authCode);
} else {
    console.error("❌ Nenhum código de autorização encontrado.");

    if (statusElement) {
        statusElement.innerHTML = "<h2>Erro: Nenhum código de autorização encontrado.</h2>";
    }
}
