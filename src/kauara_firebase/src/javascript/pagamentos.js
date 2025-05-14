// Firebase Configuração
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
const db = firebase.firestore();

// Obtendo o userId do URL
const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get("userId");

document.addEventListener("DOMContentLoaded", async function () {
    if (!userId) {
        document.getElementById("recipientName").textContent = "Usuário não encontrado.";
        return;
    }

    // Buscar nome do usuário no Firestore
    const userDoc = await db.collection("users").doc(userId).get();
    if (userDoc.exists) {
        document.getElementById("recipientName").textContent = userDoc.data().user_Name || "Usuário";
    } else {
        document.getElementById("recipientName").textContent = "Usuário não encontrado.";
    }
});

// Função para iniciar a doação
async function donate() {
    const amount = document.getElementById("donationAmount").value;
    if (!amount || amount <= 0) {
        alert("Digite um valor válido.");
        return;
    }

    document.getElementById("loadingMessage").style.display = "block";

    try {
        const response = await fetch("http://localhost:3000/create-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount, userId })
        });

        const data = await response.json();
        document.getElementById("loadingMessage").style.display = "none";

        if (data.init_point) {
            window.location.href = data.init_point; // Redireciona para o Mercado Pago
        } else if (data.qr_code_base64) {
            document.getElementById("paymentContainer").innerHTML = `
                <p>Escaneie o QR Code para pagar:</p>
                <img src="data:image/png;base64,${data.qr_code_base64}" alt="QR Code PIX">
                <p>Ou copie e cole este código:</p>
                <p><strong>${data.qr_code}</strong></p>
            `;
        }
    } catch (error) {
        console.error("Erro ao processar pagamento:", error);
        alert("Erro ao processar pagamento.");
    }
}
