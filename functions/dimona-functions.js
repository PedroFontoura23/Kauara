const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// === Config ===
const DIMONA_API_BASE = 'https://admin.camisadimona.com.br/api/v2';
const DIMONA_API_KEY = functions.config().dimona?.apikey || '';

if (!DIMONA_API_KEY) {
  console.error('❌ DIMONA NOT CONFIGURED - Set dimona.apikey using: firebase functions:config:set dimona.apikey="YOUR_KEY"');
}

const DIMONA_HEADERS = {
  'Content-Type': 'application/json',
  'api-key': DIMONA_API_KEY,
  'Accept': 'application/json',
};

const RAW_CATALOG = require('./catalogo_dropsimples.json');
const { buildProductsFromCatalog } = require('./dimona-product-catalog');

const ALLOWED_ORIGINS = [
  'https://kauara1.web.app',
  'https://kauava.com',
  'https://www.kauava.com',
  'http://localhost:5000',
  'http://localhost:3000',
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.set('Access-Control-Allow-Origin', allowedOrigin);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
}

function buildProductList() {
  return buildProductsFromCatalog(RAW_CATALOG);
}

// =============================================
// GET DIMONA PRODUCTS
// =============================================
const getDimonaProducts = functions.https.onRequest((req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const products = buildProductList();
    console.log(`📦 [getDimonaProducts] Returning ${products.length} products`);
    return res.status(200).json({ success: true, count: products.length, products });
  } catch (err) {
    console.error('❌ [getDimonaProducts] error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// UPLOAD BASE64 → Firebase Storage
// =============================================
async function uploadBase64Image(base64Data, folder) {
  const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid base64 string');
  const mimeType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const fileName = `${folder}/${uniqueId}.${ext}`;
  const file = bucket.file(fileName);
  await file.save(buffer, {
    metadata: { contentType: mimeType, metadata: { firebaseStorageDownloadTokens: uniqueId } },
    public: true,
  });
  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}

// =============================================
// SAVE PRODUCT DIMONA
// =============================================
const saveProductDimona = functions.runWith({
  timeoutSeconds: 120,
  memory: '1GB',
}).https.onRequest((req, res) => {
  setCorsHeaders(req, res);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept');
  res.set('Access-Control-Max-Age', '3600');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  return (async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'POST only' });
    }
    try {
      const {
        name, productTitle, productId,
        designerUserId, firebaseUserId, userEmail,
        designs = {}, thumbnails = {}, thumbnail,
        variants = [], availableSizes = [], availableColors = [],
        totalVariants = 0, pricing_summary = {},
        firestoreCollection = 'products',
      } = req.body;

      if (!designerUserId) return res.status(401).json({ success: false, error: 'designerUserId obrigatorio' });
      if (!name) return res.status(400).json({ success: false, error: 'name obrigatorio' });
      if (!productId) return res.status(400).json({ success: false, error: 'productId obrigatorio' });
      if (!variants.length) return res.status(400).json({ success: false, error: 'Pelo menos uma variante obrigatoria' });
      if (!designs.front && !designs.back) return res.status(400).json({ success: false, error: 'Pelo menos uma arte obrigatoria' });

      const designUrls = {};
      const thumbnailUrls = {};

      if (designs.front) {
        designUrls.front = await uploadBase64Image(designs.front, 'designs/dimona');
        thumbnailUrls.front = thumbnails.front
          ? await uploadBase64Image(thumbnails.front, 'thumbnails/dimona')
          : designUrls.front;
      }
      if (designs.back) {
        designUrls.back = await uploadBase64Image(designs.back, 'designs/dimona');
        thumbnailUrls.back = thumbnails.back
          ? await uploadBase64Image(thumbnails.back, 'thumbnails/dimona')
          : designUrls.back;
      }

      const mainThumbnailUrl = thumbnailUrls.front || thumbnailUrls.back ||
        (thumbnail ? await uploadBase64Image(thumbnail, 'thumbnails/dimona') : null);

      const safeVariants = variants.map(v => {
        const sku = v.dimona_sku || v.sku || v.id;
        if (!sku) throw new Error(`Variante sem SKU: ${JSON.stringify(v)}`);
        const pricing = v.pricing || {};
        const totalPrice = parseFloat(pricing.total_price || v.retail_price || v.price || 0);
        if (totalPrice <= 0) throw new Error(`Preco invalido para variante ${sku}`);
        return {
          id: sku,
          sku,
          dimona_sku: sku,
          name: v.name || `${productId} - ${v.color} - ${v.size}`,
          size: v.size || 'Unico',
          color: v.color || 'N/A',
          color_code: v.color_code || '#cccccc',
          retail_price: totalPrice.toFixed(2),
          pricing: {
            product_price: parseFloat(pricing.product_price || 0),
            artist_cut: parseFloat(pricing.artist_cut || 0),
            platform_fee: parseFloat(pricing.platform_fee || 0),
            platform_fee_fixed: 8.00,
            total_price: totalPrice,
            currency: 'BRL',
          },
        };
      });

      const productData = {
        id: null,
        provider: 'dimona',
        designerUserId: designerUserId || null,
        firebaseUserId: firebaseUserId || null,
        userEmail: userEmail || null,
        name,
        productTitle: productTitle || name,
        productId,
        designUrls,
        thumbnailUrls,
        thumbnailUrl: mainThumbnailUrl,
        designUrl: designUrls.front || designUrls.back,
        variants: safeVariants,
        availableSizes: availableSizes.length > 0 ? availableSizes : [...new Set(safeVariants.map(v => v.size))],
        availableColors: availableColors.length > 0 ? availableColors : [...new Set(safeVariants.map(v => v.color))],
        totalVariants: totalVariants > 0 ? totalVariants : safeVariants.length,
        pricing_summary: {
          artist_cut: pricing_summary.artist_cut || 0,
          platform_fee_fixed: 8.00,
          currency: 'BRL',
        },
        status: 'active',
        printfulStatus: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await admin.firestore().collection(firestoreCollection).add(productData);
      await docRef.update({ id: docRef.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log('✅ [saveProductDimona] Produto Dimona salvo:', docRef.id);

      return res.json({
        success: true,
        firestoreProductId: docRef.id,
        provider: 'dimona',
        designUrls,
        thumbnailUrl: mainThumbnailUrl,
        variantsCount: safeVariants.length,
      });
    } catch (err) {
      console.error('❌ [saveProductDimona] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  })();
});

// =============================================
// GET DIMONA SHIPPING
// =============================================
const getDimonaShipping = functions.https.onRequest((req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');

  return (async () => {
    try {
      const params = req.method === 'POST' ? req.body : req.query;
      const zipcode = (params.zipcode || params.cep || '').replace(/\D/g, '');
      const quantity = parseInt(params.quantity || params.qty || 1, 10);
      
      console.log(`🚚 [getDimonaShipping] Calculating shipping for CEP: ${zipcode}, quantity: ${quantity}`);
      
      if (!zipcode || zipcode.length !== 8) {
        return res.status(400).json({ success: false, error: 'CEP inválido (8 dígitos)' });
      }
      
      const dimonaRes = await fetch(`${DIMONA_API_BASE}/shipping`, {
        method: 'POST',
        headers: DIMONA_HEADERS,
        body: JSON.stringify({ zipcode, quantity: String(quantity) }),
      });
      
      if (!dimonaRes.ok) {
        throw new Error(`Dimona API error: ${dimonaRes.status}`);
      }
      
      const options = await dimonaRes.json();
      if (!Array.isArray(options) || options.length === 0) {
        throw new Error('Nenhuma opção de frete retornada pela Dimona');
      }
      
      const normalized = options
        .map(o => ({
          name: o.name,
          value: parseFloat(o.value),
          business_days: o.business_days + 3,
          delivery_method_id: o.delivery_method_id,
          formatted: `R$ ${parseFloat(o.value).toFixed(2).replace('.', ',')}`,
        }))
        .sort((a, b) => a.value - b.value);
      
      console.log(`✅ [getDimonaShipping] Found ${normalized.length} shipping options`);
      return res.json({ success: true, options: normalized });
    } catch (err) {
      console.error('❌ [getDimonaShipping] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  })();
});

// =============================================
// CREATE DIMONA ORDER
// Reads from "checkout_payments" collection
// =============================================
async function createDimonaOrder(orderId, testMode = true) {

  // TESTE: Switch rápido para simular pedido Dimona
  if (testMode || process.env.TEST_DIMONA === 'true' || (typeof global.testDimonaFlag !== 'undefined' && global.testDimonaFlag)) {
    console.log('⚡ [createDimonaOrder] TEST MODE ATIVADO — Simulando pedido Dimona para', orderId);
    const fakeOrderId = 'TEST_DIMONA_' + orderId;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const fakeData = {
      order: fakeOrderId,
      id: fakeOrderId,
      order_id: fakeOrderId,
      status: 'processing',
      simulated: true
    };
    const orderRef = db.collection('checkout_payments').doc(orderId);
    await orderRef.set({
      dimona_order_id: fakeOrderId,
      dimona_order_status: 'processing',
      dimona_order_data: fakeData,
      dimona_order_created_at: now,
      order_status: 'dimona_processing',
      updated_at: now,
      test_dimona: true
    }, { merge: true });
    return fakeData;
  }
  console.log(`📦 [createDimonaOrder] Starting for order: ${orderId}`);

  const orderRef = db.collection('checkout_payments').doc(orderId);
  const orderDoc = await orderRef.get();
  
  if (!orderDoc.exists) {
    throw new Error(`Pedido ${orderId} não encontrado em 'checkout_payments'`);
  }
  
  const order = orderDoc.data();

  if (!order.shipping_address) {
    throw new Error(`Endereço de entrega obrigatório para pedido ${orderId}`);
  }
  
  const shipping = order.shipping_address;

  const cartProducts = order.cart_products || [];
  const dimonaProducts = cartProducts.filter(p => p.provider === 'dimona' || !!p.dimona_sku);

  if (dimonaProducts.length === 0) {
    throw new Error(`Nenhum produto Dimona encontrado para o pedido ${orderId}`);
  }

  console.log(`[createDimonaOrder] Found ${dimonaProducts.length} Dimona products for order ${orderId}`);

  const items = dimonaProducts.map(p => {
    // NO FALLBACKS - require these fields
    if (!p.dimona_sku) {
      throw new Error(`Produto ${p.product_id} sem dimona_sku`);
    }
    if (!p.design_url && !p.designUrls?.front) {
      throw new Error(`Produto ${p.product_id} sem design_url`);
    }

    const designs = [p.design_url || p.designUrls?.front];
    if (p.design_url_back || p.designUrls?.back) {
      designs.push(p.design_url_back || p.designUrls?.back);
    }

    const mocks = [];
    if (p.mock_url) mocks.push(p.mock_url);
    if (p.mock_url_back) mocks.push(p.mock_url_back);

    return {
      name: p.title || p.product_id,
      sku: p.product_id,
      qty: p.quantity || 1,
      dimona_sku_id: p.dimona_sku,
      designs,
      mocks,
    };
  });

  const recipientName = order.buyer_info?.name ||
    `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim();

  const dimonaPayload = {
    order_id: orderId,
    ...(order.shipping_delivery_method_id
      ? { delivery_method_id: String(order.shipping_delivery_method_id) }
      : { shipping_speed: order.shipping_speed || 'pac' }
    ),
    customer_name: recipientName,
    customer_document: order.buyer_info?.cpf || '',
    customer_email: order.customer_email || '',
    items,
    address: {
      name: recipientName,
      street: shipping.street_name || '',
      number: shipping.street_number || 'S/N',
      complement: shipping.complement || '',
      neighborhood: shipping.neighborhood || '',
      city: shipping.city_name || '',
      state: shipping.state_name || '',
      zipcode: (shipping.zip_code || '').replace(/\D/g, ''),
      phone: order.buyer_info?.phone || shipping.phone || '',
      country: 'BR',
    },
  };

  console.log(`📤 [createDimonaOrder] Payload for order ${orderId}:`, JSON.stringify(dimonaPayload, null, 2));

  const response = await fetch(`${DIMONA_API_BASE}/order`, {
    method: 'POST',
    headers: DIMONA_HEADERS,
    body: JSON.stringify(dimonaPayload),
  });

  const data = await response.json();
  
  if (!response.ok) {
    console.error(`❌ [createDimonaOrder] Dimona API error response:`, data);
    throw new Error(`Dimona API error (${response.status}): ${JSON.stringify(data)}`);
  }

  const dimonaOrderId = data.order || data.id || data.order_id;
  console.log(`✅ [createDimonaOrder] Pedido Dimona criado: ${dimonaOrderId} for order ${orderId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();
  await orderRef.set({
    dimona_order_id: dimonaOrderId,
    dimona_order_status: data.status || 'processing',
    dimona_order_data: data,
    dimona_order_created_at: now,
    order_status: 'dimona_processing',
    updated_at: now,
  }, { merge: true });

  // Update purchasedItems in users subcollection
  const orderData = (await orderRef.get()).data() || {};
  const userUid = orderData.user_uid;
  if (userUid) {
    const usersSnap = await db.collection('users').where('firebaseUID', '==', userUid).limit(1).get();
    if (!usersSnap.empty) {
      const userId = usersSnap.docs[0].id;
      const purchasedSnap = await db.collection('users').doc(userId).collection('purchasedItems')
        .where('order_id', '==', orderId)
        .get();
      if (!purchasedSnap.empty) {
        const batch = db.batch();
        purchasedSnap.forEach(doc => {
          batch.update(doc.ref, {
            dimona_order_id: dimonaOrderId,
            dimona_order_status: data.status || 'processing',
            order_status: 'dimona_processing',
            updated_at: now,
          });
        });
        await batch.commit();
        console.log(`[createDimonaOrder] Updated ${purchasedSnap.size} purchasedItems records for user ${userId}`);
      }
    }
  }

  return data;
}

// HTTP wrapper — create Dimona order manually (admin use)
const createDimonaOrderManually = functions.runWith({
  timeoutSeconds: 120,
  memory: '256MB',
}).https.onRequest((req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  return (async () => {
    try {
      const { order_id, testDimona } = req.body;
      const testFlag = testDimona === true || testDimona === 'true' || req.query.testDimona === 'true';
      if (!order_id) return res.status(400).json({ error: 'order_id required' });
      console.log(`🔧 [createDimonaOrderManually] Manual creation for order: ${order_id} (testDimona=${testFlag})`);
      const result = await createDimonaOrder(order_id, testFlag);
      return res.json({ success: true, dimona_order: result });
    } catch (err) {
      console.error('❌ [createDimonaOrderManually] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  })();
});

// =============================================
// DIMONA WEBHOOK (shipping status updates)
// =============================================
const dimonaWebhook = functions.https.onRequest((req, res) => {
  console.log('🔔🔔🔔 [dimonaWebhook] WEBHOOK RECEIVED 🔔🔔🔔');
  console.log('[dimonaWebhook] Body:', JSON.stringify(req.body, null, 2));
  
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  return (async () => {
    try {
      const { api_key, dimona_id, status_id, name, seller_id, tracking_url } = req.body;
      console.log(`📬 [dimonaWebhook] dimona_id: ${dimona_id}, status_id: ${status_id}, name: ${name}`);

      if (api_key !== DIMONA_API_KEY) {
        console.warn('⚠️ [dimonaWebhook] Webhook com api_key inválida:', api_key);
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!dimona_id) return res.status(400).json({ error: 'dimona_id obrigatório' });

      const STATUS_MAP = {
        1: 'processing', 2: 'processing', 3: 'processing',
        4: 'failed', 5: 'cancelled',
        6: 'in_production', 7: 'in_production', 8: 'in_production',
        9: 'in_production', 10: 'in_production',
        11: 'shipped', 12: 'shipped', 13: 'in_production',
        14: 'delivered', 15: 'returned',
      };
      const normalizedStatus = STATUS_MAP[status_id] || 'processing';
      const now = admin.firestore.FieldValue.serverTimestamp();

      const dimonaIdClean = String(dimona_id).replace(/-/g, '');
      const dimonaIdRaw = String(dimona_id);

      // Search in "checkout_payments" collection
      const ordersSnap = await db.collection('checkout_payments')
        .where('dimona_order_id', 'in', [dimonaIdRaw, dimonaIdClean])
        .limit(1)
        .get();

      if (ordersSnap.empty) {
        const bySellerSnap = await db.collection('checkout_payments').doc(String(seller_id || '')).get();
        if (!bySellerSnap.exists) {
          console.warn(`⚠️ [dimonaWebhook] Pedido não encontrado para dimona_id: ${dimona_id}`);
          return res.json({ success: true, warning: 'order not found, ignored' });
        }
        await applyDimonaStatusUpdate(bySellerSnap.ref, bySellerSnap.id, {
          normalizedStatus, status_id, name, tracking_url, dimona_id, now,
        });
        return res.json({ success: true, order_id: bySellerSnap.id });
      }

      const orderDoc = ordersSnap.docs[0];
      await applyDimonaStatusUpdate(orderDoc.ref, orderDoc.id, {
        normalizedStatus, status_id, name, tracking_url, dimona_id, now,
      });
      return res.json({ success: true, order_id: orderDoc.id, status: normalizedStatus });
    } catch (err) {
      console.error('❌ [dimonaWebhook] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  })();
});

async function applyDimonaStatusUpdate(orderRef, orderId, { normalizedStatus, status_id, name, tracking_url, dimona_id, now }) {
  console.log(`📝 [applyDimonaStatusUpdate] Updating order ${orderId} to status: ${normalizedStatus}`);
  
  await orderRef.set({
    dimona_order_status: normalizedStatus,
    dimona_raw_status: name,
    dimona_status_id: status_id,
    tracking_url: tracking_url || null,
    dimona_last_webhook: now,
    order_status: normalizedStatus,
    updated_at: now,
  }, { merge: true });

  // Also update purchasedItems in users subcollection
  const orderSnap = await orderRef.get();
  const orderData = orderSnap.data() || {};
  const userUid = orderData.user_uid;
  if (userUid) {
    const usersSnap = await db.collection('users').where('firebaseUID', '==', userUid).limit(1).get();
    if (!usersSnap.empty) {
      const userId = usersSnap.docs[0].id;
      const purchasedSnap = await db.collection('users').doc(userId).collection('purchasedItems')
        .where('order_id', '==', orderId)
        .get();
      if (!purchasedSnap.empty) {
        const batch = db.batch();
        purchasedSnap.forEach(doc => {
          batch.update(doc.ref, {
            dimona_order_status: normalizedStatus,
            order_status: normalizedStatus,
            shipping_status: normalizedStatus,
            tracking_url: tracking_url || null,
            updated_at: now,
          });
        });
        await batch.commit();
        console.log(`[applyDimonaStatusUpdate] Updated ${purchasedSnap.size} purchasedItems records for user ${userId}`);
      }
    }
  }
  
  console.log(`✅ [applyDimonaStatusUpdate] Pedido ${orderId} atualizado → ${name} (${normalizedStatus})`);
}

// =============================================
// GET DIMONA ORDER STATUS (fulfillment only)
// =============================================
const getDimonaOrderStatus = functions.https.onRequest((req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  return (async () => {
    try {
      const orderId = req.query.order_id;
      if (!orderId) return res.status(400).json({ success: false, error: 'order_id obrigatorio' });

      console.log(`🔍 [getDimonaOrderStatus] Getting status for order: ${orderId}`);

      const orderDoc = await db.collection('checkout_payments').doc(orderId).get();
      if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Pedido nao encontrado' });
      
      const order = orderDoc.data();
      const dimonaOrderId = order.dimona_order_id;

      if (!dimonaOrderId) {
        return res.json({
          success: true, order_id: orderId,
          local_status: order.dimona_order_status || 'processing',
          dimona_status: null, tracking_code: null, tracking_url: null,
        });
      }

      const dimonaRes = await fetch(`${DIMONA_API_BASE}/order/${dimonaOrderId}`, {
        method: 'GET', headers: DIMONA_HEADERS,
      });
      if (!dimonaRes.ok) throw new Error(`Dimona API error (${dimonaRes.status})`);
      
      const dimonaData = await dimonaRes.json();

      const STATUS_MAP = {
        1: 'processing', 2: 'processing', 3: 'processing',
        4: 'failed', 5: 'cancelled',
        6: 'in_production', 7: 'in_production', 8: 'in_production',
        9: 'in_production', 10: 'in_production', 13: 'in_production',
        11: 'shipped', 12: 'shipped',
        14: 'delivered', 15: 'returned',
      };
      const normalized = STATUS_MAP[dimonaData.status_id] || 'processing';
      const trackingCode = dimonaData.tracking_code || null;
      const trackingUrl = dimonaData.tracking_url || null;
      const carrier = dimonaData.carrier || null;
      const estimatedDelivery = dimonaData.estimated_delivery || null;
      const now = admin.firestore.FieldValue.serverTimestamp();

      await applyDimonaStatusUpdate(
        db.collection('checkout_payments').doc(orderId), orderId,
        { normalizedStatus: normalized, status_id: dimonaData.status_id,
          name: dimonaData.status || dimonaData.name || normalized,
          tracking_url: trackingUrl, dimona_id: dimonaOrderId, now }
      );

      if (trackingCode || carrier || estimatedDelivery) {
        await db.collection('checkout_payments').doc(orderId).set({
          ...(trackingCode ? { tracking_code: trackingCode } : {}),
          ...(carrier ? { carrier } : {}),
          ...(estimatedDelivery ? { estimated_delivery: estimatedDelivery } : {}),
        }, { merge: true });
      }

      return res.json({
        success: true, order_id: orderId, dimona_order_id: dimonaOrderId,
        local_status: normalized, dimona_status: dimonaData.status || dimonaData.name,
        tracking_code: trackingCode, tracking_url: trackingUrl,
        carrier, estimated_delivery: estimatedDelivery,
      });
    } catch (err) {
      console.error('❌ [getDimonaOrderStatus] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  })();
});

module.exports = {
  getDimonaProducts,
  getDimonaShipping,
  createDimonaOrder,
  createDimonaOrderManually,
  saveProductDimona,
  getDimonaOrderStatus,
  dimonaWebhook,
};