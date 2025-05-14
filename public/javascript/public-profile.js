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

console.log("User Id from URL:", userIdFromUrl);

const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer = document.getElementById("ratingContainer");

let ratingSystem;

// Function to fetch the current user's Firestore ID
async function getCurrentUserId() {
    const user = auth.currentUser;
    if (!user) {
        return null; // No user is logged in
    }

    try {
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", user.uid)
            .get();

        if (!userQuery.empty) {
            return userQuery.docs[0].id; // Return the Firestore user ID
        } else {
            throw new Error("No user found for the logged-in UID.");
        }
    } catch (error) {
        console.error("Error fetching current user ID:", error);
        return null;
    }
}

document.getElementById('pixPayBtn').addEventListener('click', async () => {
    const currentUserId = await getCurrentUserId();
    if (!currentUserId || !userIdFromUrl) {
        alert("Você precisa estar logado para doar.");
        return;
    }

    const amountInput = document.getElementById('pixAmount');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount < 1) {
        alert("Informe um valor válido (mínimo R$1,00)");
        return;
    }

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
            document.getElementById('pixQrCode').innerHTML = `
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
    }
});



// Function to display posts
async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) {
        console.error("Posts container not found.");
        return;
    }

    // Fetch the current user's ID
    const currentUserId = await getCurrentUserId();

    // Initialize PostManager with userIdFromUrl and currentUserId
    const postManager = initializePostManager('postsContainer', userIdFromUrl);
    postManager.displayPosts(userIdFromUrl, currentUserId); // Pass currentUserId here
}

// Initialize ProductsManager
const productsContainer = document.getElementById("productsContainer");
const productsManager = new ProductsManager(db, auth, "productsContainer", userIdFromUrl);

// Function to display products
async function displayProducts(userIdFromUrl) {
    if (!userIdFromUrl) {
        console.error("No user ID found in URL");
        return;
    }

    // Fetch the current user's ID
    const currentUserId = await getCurrentUserId();

    // Display products for the user
    productsManager.displayProducts(userIdFromUrl, currentUserId);
}

if (userIdFromUrl) {
    db.collection("users")
        .doc(userIdFromUrl)
        .get()
        .then(userDoc => {
            if (userDoc.exists) {
                const userData = userDoc.data();
                userNameElement.textContent = userData.user_Name || "No Name Available";
                userBioElement.textContent = userData.user_Bio || "No bio available";

                const profilePic = userData.profilePicture;
                if (profilePic) {
                    profilePictureElement.src = `data:image/jpeg;base64,${profilePic}`;
                } else {
                    profilePictureElement.src = "default-profile.png";
                }

                // Fetch contact data
                db.collection("contact")
                    .where("foreignUserId", "==", userIdFromUrl)
                    .get()
                    .then(contactSnapshot => {
                        if (!contactSnapshot.empty) {
                            const contactData = contactSnapshot.docs[0].data();
                            userEmailElement.textContent = contactData.contactEmail || "No Email Available";
                        } else {
                            userEmailElement.textContent = "No Contact Info Available";
                        }
                    })
                    .catch(error => {
                        console.error("Error fetching contact data:", error);
                        userEmailElement.textContent = "Error fetching contact info";
                    });

                // Initialize rating system
                ratingSystem = new RatingSystem(userIdFromUrl, ratingContainer);

                // Fetch and display posts
                displayPosts(userIdFromUrl);  // Pass userIdFromUrl to display only their posts

                // Fetch and display products
                displayProducts(userIdFromUrl);  // Pass userIdFromUrl to display only their products
            } else {
                userNameElement.textContent = "User not found";
                userEmailElement.textContent = "";
                userBioElement.textContent = "";
                profilePictureElement.src = "default-profile.png";
            }
        })
        .catch(error => {
            console.error("Error fetching user data:", error);
        });
} else {
    console.error("No user ID found in URL");
}