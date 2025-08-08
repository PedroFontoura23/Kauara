const functions = require('firebase-functions');
const axios = require('axios');
const cors = require('cors')({ 
  origin: [
    'https://kauara1.web.app', 
    'https://www.kauara1.web.app', 
    'https://kauava.com',
    'https://www.kauava.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const printfunctions = require('./printfunctions');
exports.getProducts = printfunctions.getProducts;
exports.getFlatLay = printfunctions.getFlatLay;
exports.checkMockupStatus = printfunctions.checkMockupStatus;

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

exports.authMercadoPago = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // 1. Extract and validate parameters
      const { code, code_verifier, uid } = req.method === 'POST' ? req.body : req.query;
      if (!code || !code_verifier || !uid) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required parameters' 
        });
      }

      // 2. Get Mercado Pago config
      const config = functions.config().mercadopago;
      if (!config?.client_id || !config?.client_secret) {
        return res.status(500).json({ 
          success: false, 
          error: 'Mercado Pago configuration missing' 
        });
      }

      // 3. Exchange code for tokens
      const params = new URLSearchParams();
      params.append('client_id', config.client_id);
      params.append('client_secret', config.client_secret);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', 'https://kauara1.web.app/pages/artist-callback.html');
      params.append('code_verifier', code_verifier);

      const tokenResponse = await axios.post(
        'https://api.mercadopago.com/oauth/token',
        params,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );

      const { access_token, refresh_token, expires_in, user_id } = tokenResponse.data;
      const expires_at = admin.firestore.Timestamp.fromMillis(Date.now() + (expires_in * 1000));

      // 4. Get payment information
      const [bankAccounts, sellerInfo] = await Promise.all([
        axios.get(`https://api.mercadopago.com/v1/users/${user_id}/bank_accounts`, {
          headers: { 'Authorization': `Bearer ${access_token}` },
          timeout: 5000
        }).catch(() => ({ data: [] })),

        axios.get(`https://api.mercadopago.com/v1/users/${user_id}`, {
          headers: { 'Authorization': `Bearer ${access_token}` },
          timeout: 5000
        }).catch(() => ({ data: {} }))
      ]);

      // 5. Prepare payment data
      const mercadopagoInfo = {
        // Authentication
        access_token,
        refresh_token,
        expires_at,
        
        // Recipient info
        mp_user_id: user_id.toString(),
        seller_email: sellerInfo.data.email || null,
        
        // Bank accounts
        bank_accounts: bankAccounts.data,
        default_bank_account: bankAccounts.data[0] || null,
        
        // Status
        payout_ready: bankAccounts.data.length > 0,
        last_updated: admin.firestore.FieldValue.serverTimestamp()
      };

      // 6. Update user document with mercadopago_info
      const userQuery = await db.collection("users")
        .where("firebaseUID", "==", uid)
        .limit(1)
        .get();

      if (userQuery.empty) {
        throw new Error('User not found');
      }

      await userQuery.docs[0].ref.update({
        mercadopago_info: mercadopagoInfo
      });

      // 7. Return success
      return res.json({
        success: true,
        has_bank_account: bankAccounts.data.length > 0,
        user_id: user_id
      });

    } catch (error) {
      console.error('Error:', error.message, error.response?.data);
      return res.status(500).json({
        success: false,
        error: error.response?.data?.message || error.message
      });
    }
  });
});

async function getValidAccessToken(userDoc) {
  const config = functions.config().mercadopago;
  const info = userDoc.data().mercadopago_info;

  if (!info || !info.refresh_token || !info.expires_at) {
    throw new Error("Missing Mercado Pago token info.");
  }

  const expiresAt = info.expires_at.toMillis();
  if (Date.now() < expiresAt - 2 * 60 * 1000) {
    // Token is still valid
    return info.access_token;
  }

  try {
    // Token expired — attempt refresh
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', config.client_id);
    params.append('client_secret', config.client_secret);
    params.append('refresh_token', info.refresh_token);

    const response = await axios.post(
      'https://api.mercadopago.com/oauth/token',
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const newExpiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + expires_in * 1000);

    await userDoc.ref.update({
      "mercadopago_info.access_token": access_token,
      "mercadopago_info.refresh_token": refresh_token,
      "mercadopago_info.expires_at": newExpiresAt,
      "mercadopago_info.last_updated": admin.firestore.FieldValue.serverTimestamp()
    });

    return access_token;
  } catch (err) {
    console.error("❌ Failed to refresh Mercado Pago token:", err.message);

    // Optional: clear the Mercado Pago info to force re-auth
    await userDoc.ref.update({
      mercadopago_info: admin.firestore.FieldValue.delete(),
      "mp_disconnected_at": admin.firestore.FieldValue.serverTimestamp()
    });

    throw new Error("Mercado Pago disconnected. User must reconnect.");
  }
}

exports.createPixPayment = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { payerId, receiverId, amount } = req.body;
      if (!payerId || !receiverId || !amount) {
        return res.status(400).json({ success: false, error: "Missing parameters." });
      }

      const receiverDoc = await db.collection("users").doc(receiverId).get();
      if (!receiverDoc.exists) throw new Error("Receiver not found");

      const access_token = await getValidAccessToken(receiverDoc);

      const preference = {
        transaction_amount: amount,
        description: `Doação para usuário ${receiverId}`,
        payment_method_id: "pix",
        payer: {
          email: "pagador@mail.com" // opcional: usar email real se quiser
        }
      };

      const { v4: uuidv4 } = require('uuid'); // add at top if not already

      const idempotencyKey = uuidv4(); // generate a unique key for this payment

      const response = await axios.post(
        'https://api.mercadopago.com/v1/payments',
        preference,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey
          }
        }
      );


      const { qr_code_base64, qr_code } = response.data.point_of_interaction.transaction_data;

      res.json({
        success: true,
        qr_code_base64,
        qr_code
      });
    } catch (error) {
      console.error("Erro ao criar pagamento PIX:", error.message, error.response?.data);
      res.status(500).json({
        success: false,
        error: error.response?.data?.message || error.message
      });
    }
  });
});


