const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

const urlParams = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

// DOM Elements
const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer = document.getElementById("ratingContainer");
const donationSection = document.getElementById("donationSection");
const pixPayBtn = document.getElementById("pixPayBtn");
const pixQrCode = document.getElementById("pixQrCode");

let ratingSystem;

async function getCurrentUserId() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", user.uid)
            .get();
        return userQuery.empty ? null : userQuery.docs[0].id;
    } catch (error) {
        console.error("Error fetching current user ID:", error);
        return null;
    }
}

function setupPixButton() {
    pixPayBtn.addEventListener('click', async () => {
        const currentUserId = await getCurrentUserId();
        if (!currentUserId || !userIdFromUrl) {
            alert("Você precisa estar logado para doar.");
            return;
        }

        const amount = parseFloat(document.getElementById('pixAmount').value);
        if (!amount || amount < 1) {
            alert("Informe um valor válido (mínimo R$1,00)");
            return;
        }

        // Show loading state
        const loadingSpinner = document.querySelector('#pixLoading .loading-spinner');
        const loadingText = document.querySelector('#pixLoading p');
        pixPayBtn.disabled = true;
        loadingSpinner.style.display = 'block';
        loadingText.textContent = 'Generating QR Code...';
        pixQrCode.innerHTML = '';
        document.getElementById('pixLoading').style.display = 'block';

        try {
            const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/createPixPayment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payerId: currentUserId,
                    receiverId: userIdFromUrl,
                    amount: amount
                })
            });

            const data = await response.json();
            if (data.success) {
                pixQrCode.innerHTML = `
                    <p><strong>Escaneie o QR Code com seu app de banco:</strong></p>
                    <img src="data:image/png;base64,${data.qr_code_base64}" alt="PIX QR Code" style="max-width: 300px; margin: 10px 0;" />
                    <p><strong>Código copia e cola:</strong></p>
                    <code style="word-wrap: break-word; white-space: normal;">${data.qr_code}</code>
                `;
            } else {
                alert("Erro: " + data.error);
            }
        } catch (err) {
            console.error(err);
            alert("Erro ao iniciar pagamento PIX.");
        } finally {
            // Hide loading state regardless of outcome
            loadingSpinner.style.display = 'none';
            document.getElementById('pixLoading').style.display = 'none';
            pixPayBtn.disabled = false;
        }
    });
}

async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) return;

    const currentUserId = await getCurrentUserId();
    const postManager = initializePostManager('postsContainer', userIdFromUrl);
    postManager.displayPosts(userIdFromUrl, currentUserId);
}

async function displayProducts(userIdFromUrl) {
    if (!userIdFromUrl) return;

    const currentUserId = await getCurrentUserId();
    const productsManager = new ProductsManager(db, auth, "productsContainer", userIdFromUrl);
    productsManager.displayProducts(userIdFromUrl, currentUserId);
}

async function loadProfileData() {
    if (!userIdFromUrl) {
        showError("No user specified");
        return;
    }

    try {
        const userDoc = await db.collection("users").doc(userIdFromUrl).get();
        if (!userDoc.exists) {
            showError("User not found");
            return;
        }

        const userData = userDoc.data();
        userNameElement.textContent = userData.user_Name || "No Name Available";
        userBioElement.textContent = userData.user_Bio || "No bio available";

        // Show donation section only if user has mercadopago_info
        if (userData.mercadopago_info) {
            donationSection.style.display = "block";
        }

        // Load profile picture
        if (userData.profilePicture) {
            profilePictureElement.src = `data:image/jpeg;base64,${userData.profilePicture}`;
        }

        // Load contact data
        const contactSnapshot = await db.collection("contact")
            .where("foreignUserId", "==", userIdFromUrl)
            .get();
        if (!contactSnapshot.empty) {
            userEmailElement.textContent = contactSnapshot.docs[0].data().contactEmail || "No Email Available";
        }

        // Initialize components
        ratingSystem = new RatingSystem(userIdFromUrl, ratingContainer);
        displayPosts(userIdFromUrl);
        displayProducts(userIdFromUrl);

    } catch (error) {
        console.error("Error loading profile:", error);
        showError("Error loading profile");
    }
}

function showError(message) {
    userNameElement.textContent = message;
    userEmailElement.textContent = "";
    userBioElement.textContent = "";
    donationSection.style.display = "none";
}

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    setupPixButton();
    loadProfileData();
});