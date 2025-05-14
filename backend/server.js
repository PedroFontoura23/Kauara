require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// Firebase setup
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Mercado Pago client with your access token
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN 
});

// Record donation in Firebase
async function recordDonation(paymentInfo) {
  try {
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S"
    };
    
    console.log("Donation recorded with ID: ", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Error recording donation: ", error);
    throw error;
  }
}

// Criando uma preferência de pagamento (cartão ou boleto)
app.post("/create-payment", async (req, res) => {
    const { amount, donorId, recipientId, payer_email } = req.body;

    try {
        const preferenceClient = new Preference(client);
        
        // Create a unique external_reference to identify this transaction
        const external_reference = `donation_${donorId}_to_${recipientId}_${Date.now()}`;
        
        const preference = {
            items: [{
                title: "Doação",
                unit_price: parseFloat(amount),
                quantity: 1,
            }],
            payer: {
                email: payer_email || "pagador@example.com"
            },
            back_urls: {
                success: `${process.env.FRONTEND_URL}/donation/success?ref=${external_reference}`,
                failure: `${process.env.FRONTEND_URL}/donation/failure?ref=${external_reference}`
            },
            auto_return: "approved",
            external_reference: external_reference,
            notification_url: `${process.env.BACKEND_URL}/webhook`
        };

        const response = await preferenceClient.create({ body: preference });
        
        // Pre-record the donation with pending status
        const donationId = await recordDonation({
            donorId: donorId,
            recipientId: recipientId,
            amount: parseFloat(amount),
            paymentMethod: "credit_card_or_ticket",
            paymentId: response.id,
            status: "pending",
            external_reference: external_reference
        });

        res.json({ 
            init_point: response.init_point,
            donation_id: donationId,
            external_reference: external_reference
        });

    } catch (error) {
        console.error("Erro ao criar pagamento:", error);
        res.status(500).json({ error: error.message });
    }
});

// Criando pagamento via PIX
app.post("/create-pix", async (req, res) => {
    const { amount, donorId, recipientId, payer_email } = req.body;

    try {
        const paymentClient = new Payment(client);
        
        // Create a unique external_reference
        const external_reference = `pix_donation_${donorId}_to_${recipientId}_${Date.now()}`;
        
        const paymentData = {
            transaction_amount: parseFloat(amount),
            payment_method_id: "pix",
            payer: { 
                email: payer_email || "pagador@example.com" 
            },
            external_reference: external_reference
        };

        const payment = await paymentClient.create({ body: paymentData });

        // Record the PIX donation
        const donationId = await recordDonation({
            donorId: donorId,
            recipientId: recipientId,
            amount: parseFloat(amount),
            paymentMethod: "pix",
            paymentId: payment.id,
            status: payment.status,
            external_reference: external_reference
        });

        res.json({
            qr_code_base64: payment.point_of_interaction.transaction_data.qr_code_base64,
            qr_code: payment.point_of_interaction.transaction_data.qr_code,
            donation_id: donationId,
            external_reference: external_reference
        });

    } catch (error) {
        console.error("Erro ao gerar PIX:", error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook to receive payment notifications from Mercado Pago
app.post("/webhook", async (req, res) => {
    try {
        const { type, data } = req.body;
        
        // We're only interested in payment notifications
        if (type === "payment") {
            const paymentId = data.id;
            
            // Get payment details from Mercado Pago
            const paymentClient = new Payment(client);
            const paymentInfo = await paymentClient.get({ id: paymentId });
            
            // Extract external_reference to identify our donation
            const { external_reference, status } = paymentInfo;
            
            // Update donation status in Firebase
            // This is a simplification - you would need to query for the document with this external_reference
            // For a complete implementation, you might want to add another collection or index
            
            console.log(`Payment ${paymentId} status updated to ${status}`);
            console.log(`External reference: ${external_reference}`);
            
            // Here you would update the donation record in Firebase with the new status
            // Implementation depends on how you query Firebase
        }
        
        res.status(200).send("OK");
    } catch (error) {
        console.error("Error processing webhook:", error);
        res.status(500).send("Error processing webhook");
    }
});

// Inicia o servidor na porta 3000
app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});