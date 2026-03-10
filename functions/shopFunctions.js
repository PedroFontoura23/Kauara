const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { createPrintfulOrder } = require('./printfunctions');
const cors = require('cors')({ 
  origin: [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:8080',
    'https://mercadopago.com.br',
    'https://www.mercadopago.com.br',
  ],
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
});

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// =============================================
// MERCADO PAGO CONFIGURATION
// =============================================

const MP_ACCESS_TOKEN = functions.config().mercadopago?.token || '';
const MP_PUBLIC_KEY = functions.config().mercadopago?.public_key || '';
const MP_API_BASE = 'https://api.mercadopago.com';
const MP_CONFIGURED = !!MP_ACCESS_TOKEN;

const STORE_OWNER = {
  name: 'Kauara Store',
  email: 'kauara@kauava.com',
  redirectUrls: {
    success: 'https://kauava.com/success.html',
    failure: 'https://kauava.com/failure.html',
    pending: 'https://kauava.com/pending.html'
  }
};

// =============================================
// HELPER FUNCTIONS
// =============================================

function formatMercadoPagoError(error) {
  if (!error.response) {
    return error.message || 'Unknown error';
  }
  
  const { data, status } = error.response;
  
  if (data && data.message) {
    if (Array.isArray(data.cause)) {
      const details = data.cause.map(c => `${c.code}: ${c.description}`).join('; ');
      return `${data.message} (${details})`;
    }
    return data.message;
  }
  
  return `HTTP ${status}: ${error.response.statusText}`;
}

function validatePaymentData(data) {
  const errors = [];
  
  console.log('🔍 Validating payment data:', {
    hasCartProducts: !!data.cart_products,
    isArray: Array.isArray(data.cart_products),
    length: data.cart_products?.length || 0,
    title: data.title,
    quantity: data.quantity,
    unit_price: data.unit_price,
    email: data.email
  });
  
  if (!data.cart_products || !Array.isArray(data.cart_products)) {
    errors.push('Cart products data is invalid or missing');
  } else if (data.cart_products.length === 0) {
    errors.push('No products in cart');
  }
  
  if (data.cart_products && Array.isArray(data.cart_products)) {
    data.cart_products.forEach((product, index) => {
      if (!product.product_id) {
        errors.push(`Product ${index + 1} missing product_id`);
      }
      if (!product.title || product.title.trim().length < 2) {
        errors.push(`Product ${index + 1} has invalid title`);
      }
      if (!product.designer_id) {
        errors.push(`Product ${index + 1} missing designer_id`);
      }
      if (!product.designer_email) {
        errors.push(`Product ${index + 1} missing designer_email`);
      }
      if (!product.variant_id) {
        errors.push(`Product ${index + 1} missing variant_id (required for Printful)`);
      }
    });
  }
  
  if (!data.title || data.title.trim().length < 3) {
    errors.push('Product title must be at least 3 characters');
  }
  
  if (!data.quantity || data.quantity < 1) {
    errors.push('Quantity must be at least 1');
  }
  
  const price = parseFloat(data.unit_price);
  if (isNaN(price) || price < 0.5) {
    errors.push('Unit price must be at least R$ 0.50');
  }
  
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Valid email is required');
  }
  
  console.log('📊 Validation result:', { isValid: errors.length === 0, errors });
  
  return {
    isValid: errors.length === 0,
    errors,
    validatedData: {
      title: data.title ? data.title.trim() : '',
      quantity: parseInt(data.quantity) || 1,
      unit_price: price || 0,
      email: data.email ? data.email.trim() : '',
      cart_products: data.cart_products || []
    }
  };
}

// =============================================
// PROCESS PURCHASED PRODUCTS (WHEN PAYMENT IS APPROVED)
// =============================================

async function processPurchasedProducts(orderId, paymentData) {
  try {
    console.log(`📦 Processing purchased products for order: ${orderId}`);
    
    const orderRef = db.collection('checkout_payments').doc(orderId);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      console.error('❌ Order not found:', orderId);
      return;
    }
    
    const order = orderDoc.data();
    
    if (order.printful_order_id) {
      console.log(`ℹ️ Printful order already exists for ${orderId} (${order.printful_order_id}), skipping`);
      return;
    }

    if (!order.cart_products || order.cart_products.length === 0) {
      console.log('ℹ️ No products found in order');
      return;
    }
    
    console.log(`🛍️ Processing ${order.cart_products.length} purchased products`);
    
    const batch = db.batch();
    const purchasedProducts = [];
    
    for (const product of order.cart_products) {
      const purchasedProductId = `PURCHASED_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const purchasedData = {
        purchased_id: purchasedProductId,
        order_id: orderId,
        preference_id: order.preference_id,
        
        product_id: product.product_id,
        title: product.title,
        designer_id: product.designer_id,
        designer_name: product.designer_name,
        designer_email: product.designer_email,
        variant_id: product.variant_id || null,
        printful_variant_id: product.variant_id ? parseInt(product.variant_id) : null,
        firestoreCollection: product.firestoreCollection || 'products',
        
        payment_id: paymentData.id,
        payment_method: paymentData.payment_method_id,
        payment_status: paymentData.status,
        payment_date: paymentData.date_approved || new Date().toISOString(),
        
        price: product.pricing?.total_price || 0,         // customer-facing total (artist cut + platform fee + product)
        retail_price: product.pricing?.product_price || 0, // base product cost sent to Printful
        
        order_status: 'processing',
        shipping_status: 'pending',
        
        customer_email: order.customer_email,
        customer_name: order.buyer_info?.name || 'Customer',
        customer_phone: order.buyer_info?.phone || null,
        
        shipping_address: order.shipping_address || null,
        shipping_method: order.shipping_method || 'PAC',
        shipping_cost: order.shipping_cost || 0,
        
        purchased_at: admin.firestore.FieldValue.serverTimestamp(),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        
        tracking_code: null,
        tracking_url: null,
        estimated_delivery: null,
        
        status_history: [{
          status: 'processing',
          date: new Date().toISOString(),
          note: 'Payment approved, order processing started'
        }]
      };
      
      const purchasedRef = db.collection('purchased_products').doc(purchasedProductId);
      batch.set(purchasedRef, purchasedData);
      
      purchasedProducts.push({
        id: purchasedProductId,
        product_id: product.product_id,
        title: product.title,
        variant_id: product.variant_id
      });
      
      if (order.customer_email) {
        const userPurchasedRef = db.collection('users')
          .doc(order.customer_email.replace(/[^a-zA-Z0-9]/g, '_'))
          .collection('purchases')
          .doc(purchasedProductId);
        
        batch.set(userPurchasedRef, {
          purchased_id: purchasedProductId,
          product_id: product.product_id,
          title: product.title,
          designer_name: product.designer_name,
          price: product.pricing?.total_price || 0,
          order_status: 'processing',
          purchased_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    
    batch.update(orderRef, {
      purchased_products_processed: true,
      purchased_products_count: purchasedProducts.length,
      purchased_products_ids: purchasedProducts.map(p => p.id),
      purchased_processed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const purchaseSummaryRef = db.collection('purchases_summary').doc(orderId);
    batch.set(purchaseSummaryRef, {
      order_id: orderId,
      customer_email: order.customer_email,
      customer_name: order.buyer_info?.name || 'Customer',
      total_amount: order.total_amount,
      product_count: purchasedProducts.length,
      products: purchasedProducts,
      payment_id: paymentData.id,
      payment_method: paymentData.payment_method_id,
      status: 'processing',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await batch.commit();
    
    console.log(`✅ Successfully processed ${purchasedProducts.length} purchased products for order ${orderId}`);
    
    await recordOrderEvent(orderId, 'purchased_products_processed', {
      count: purchasedProducts.length,
      products: purchasedProducts
    });
    
    // ========== TRIGGER PRINTFUL ORDER CREATION ==========
    console.log('🔄 Triggering Printful order creation...');

    // Mark printful as queued BEFORE calling, so concurrent webhooks don't also try
    const orderRef2 = db.collection('checkout_payments').doc(orderId);
    await orderRef2.set({ printful_queued: true }, { merge: true });

    // Small delay to ensure all Firestore writes above are committed before
    // createPrintfulOrder reads the document via a separate HTTP call
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const printfulOrder = await createPrintfulOrder(orderId);
      console.log('✅ Printful order created successfully:', printfulOrder.id);
      await recordOrderEvent(orderId, 'printful_order_created', {
        printful_order_id: printfulOrder.id,
        status: printfulOrder.status,
      });
      
    } catch (printfulError) {
      console.error('❌ Failed to create Printful order:', printfulError.message);

      // Use set with merge so we update the same doc if it already exists (no duplicates)
      await db.collection('checkout_payments').doc(orderId).set({
        printful_failed: true,
        printful_last_error: printfulError.message,
        printful_failed_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Only write ONE retry queue doc per order (merge on order_id)
      await db.collection('printful_retry_queue').doc(orderId).set({
        order_id: orderId,
        attempts: admin.firestore.FieldValue.increment(1),
        last_error: printfulError.message,
        last_failed_at: admin.firestore.FieldValue.serverTimestamp(),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        // next_retry is required by retryFailedPrintfulOrders — retry in 5 min
        next_retry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
      }, { merge: true });

      await recordOrderEvent(orderId, 'printful_order_failed', {
        error: printfulError.message
      });
    }
    
    return purchasedProducts;
    
  } catch (error) {
    console.error('❌ Error processing purchased products:', error);
    
    await db.collection('purchase_errors').add({
      order_id: orderId,
      error: error.message,
      stack: error.stack,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    throw error;
  }
}

// =============================================
// CREATE CHECKOUT PRO PAYMENT
// =============================================

exports.createCheckoutProPayment = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔄 Creating Checkout Pro payment for cart');
      
      if (!MP_CONFIGURED) {
        console.error('❌ Mercado Pago not configured');
        return res.status(500).json({
          success: false,
          error: 'Payment system not configured',
          message: 'Please contact the store administrator'
        });
      }
      
      const paymentData = req.body;
      
      console.log('📦 Cart payment data received:', {
        title: paymentData.title,
        amount: paymentData.unit_price,
        quantity: paymentData.quantity,
        product_count: paymentData.cart_products?.length || 0,
        picture_url: paymentData.picture_url ? 'Provided' : 'Missing'
      });
      
      const validation = validatePaymentData(paymentData);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }
      
      const { title, quantity, unit_price, email, cart_products } = validation.validatedData;
      
      const externalReference = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const firstProduct = cart_products[0];
      const pictureUrl = paymentData.picture_url || 
                        firstProduct?.thumbnailUrl || 
                        firstProduct?.thumbnail || 
                        'https://via.placeholder.com/300x300.png?text=Product';
      
      const successUrl = paymentData.return_url || `${STORE_OWNER.redirectUrls.success}`;
      const failureUrl = paymentData.cancel_url || `${STORE_OWNER.redirectUrls.failure}`;
      
      console.log('🔗 Return URLs:', {
        success: successUrl,
        failure: failureUrl,
        pending: STORE_OWNER.redirectUrls.pending
      });
      
      const preferenceData = {
        items: [
          {
            id: 'cart-' + Date.now(),
            title: title,
            description: paymentData.description || `Purchase of ${cart_products.length} products from ${STORE_OWNER.name}`,
            picture_url: pictureUrl,
            category_id: 'art',
            quantity: quantity,
            currency_id: 'BRL',
            unit_price: unit_price
          }
        ],
        payer: {
          name: paymentData.payer_name || 'Customer',
          email: email,
          phone: {
            number: paymentData.phone || '11999999999',
            area_code: '55'
          }
        },
        payment_methods: {
          excluded_payment_methods: [],
          excluded_payment_types: [],
          installments: 12,
          default_installments: 1
        },
        back_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: STORE_OWNER.redirectUrls.pending
        },
        auto_return: 'approved',
        statement_descriptor: 'KAUAVA',
        external_reference: externalReference,
        notification_url: 'https://us-central1-kauara1.cloudfunctions.net/paymentWebhook',
        metadata: {
          source: 'kauara_shop',
          type: 'multi_product_cart',
          product_count: cart_products.length,
          customer_email: email,
          timestamp: new Date().toISOString()
        }
      };
      
      if (paymentData.shipping_address) {
        preferenceData.shipments = {
          receiver_address: {
            zip_code: paymentData.shipping_address.zip_code || '',
            street_name: paymentData.shipping_address.street_name || '',
            street_number: paymentData.shipping_address.street_number || '',
            city_name: paymentData.shipping_address.city_name || '',
            state_name: paymentData.shipping_address.state_name || ''
          }
        };
      }
      
      console.log('💰 Creating preference for cart with external_reference:', externalReference);
      
      const response = await axios.post(
        `${MP_API_BASE}/checkout/preferences`,
        preferenceData,
        {
          headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      const preference = response.data;
      
      console.log('✅ Preference created:', {
        id: preference.id,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
        back_urls: preference.back_urls
      });
      
      const paymentRecord = {
        preference_id: preference.id,
        external_reference: externalReference,
        title: title,
        quantity: quantity,
        unit_price: unit_price,
        total_amount: unit_price * quantity,
        customer_email: email,
        status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        metadata: preferenceData.metadata,
        cart_products: cart_products,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
        
        return_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: STORE_OWNER.redirectUrls.pending
        },
        
        buyer_info: {
          name: paymentData.payer_name,
          email: email,
          phone: paymentData.phone,
          cpf: paymentData.cpf
        },
        
        shipping_address: paymentData.shipping_address || null,
        shipping_method: paymentData.shipping_method || 'PAC',
        shipping_cost: paymentData.shipping_cost || 0
      };
      
      await db.collection('checkout_payments').doc(externalReference).set(paymentRecord);
      
      const orderRecord = {
        order_id: externalReference,
        preference_id: preference.id,
        customer_email: email,
        total_amount: unit_price * quantity,
        product_count: cart_products.length,
        status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        products: cart_products.map(product => ({
          product_id: product.product_id,
          title: product.title,
          designer_id: product.designer_id,
          designer_name: product.designer_name,
          variant_id: product.variant_id,
          pricing: product.pricing || {}
        }))
      };
      
      await db.collection('orders').doc(externalReference).set(orderRecord);
      
      console.log('📝 Cart payment record saved:', externalReference, 'with', cart_products.length, 'products');
      
      return res.json({
        success: true,
        preference_id: preference.id,
        external_reference: externalReference,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
        cart_summary: {
          product_count: cart_products.length,
          total_amount: unit_price
        }
      });
      
    } catch (error) {
      console.error('❌ Error creating cart payment:', error);
      
      let errorMessage = 'Failed to create payment preference';
      if (error.response) {
        errorMessage = formatMercadoPagoError(error);
        console.error('Mercado Pago Error Details:', error.response.data);
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  });
});

// =============================================
// GET ORDER DETAILS
// =============================================

exports.getOrderDetails = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { order_id } = req.query;
      
      if (!order_id) {
        return res.status(400).json({
          success: false,
          error: 'Order ID is required'
        });
      }
      
      console.log('🔍 Getting order details for:', order_id);
      
      const paymentDoc = await db.collection('checkout_payments').doc(order_id).get();
      
      if (!paymentDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }
      
      const paymentData = paymentDoc.data();
      
      const orderDoc = await db.collection('orders').doc(order_id).get();
      const orderData = orderDoc.exists ? orderDoc.data() : null;
      
      const eventsSnapshot = await db.collection('order_events')
        .where('order_id', '==', order_id)
        .orderBy('created_at', 'desc')
        .get();
      
      const events = [];
      eventsSnapshot.forEach(doc => {
        const event = doc.data();
        events.push({
          ...event,
          created_at: event.created_at?.toDate?.() || event.created_at
        });
      });
      
      return res.json({
        success: true,
        order: {
          id: order_id,
          ...paymentData,
          created_at: paymentData.created_at?.toDate?.() || paymentData.created_at,
          updated_at: paymentData.updated_at?.toDate?.() || paymentData.updated_at
        },
        order_details: orderData,
        events: events
      });
      
    } catch (error) {
      console.error('❌ Error getting order details:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// GET USER ORDERS
// =============================================

exports.getUserOrders = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { customer_email, limit = 20, offset = 0 } = req.query;
      
      if (!customer_email) {
        return res.status(400).json({
          success: false,
          error: 'Customer email is required'
        });
      }
      
      console.log('📋 Getting orders for customer:', customer_email);
      
      const snapshot = await db.collection('checkout_payments')
        .where('customer_email', '==', customer_email)
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit))
        .offset(parseInt(offset))
        .get();
      
      const orders = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        orders.push({
          id: doc.id,
          external_reference: data.external_reference,
          total_amount: data.total_amount,
          product_count: data.cart_products?.length || 0,
          status: data.status,
          order_status: data.order_status,
          printful_order_status: data.printful_order_status,
          created_at: data.created_at?.toDate?.() || data.created_at,
          products: data.cart_products?.map(p => ({
            title: p.title,
            designer_name: p.designer_name,
            price: p.pricing?.total_price || 0
          })) || []
        });
      });
      
      const totalQuery = await db.collection('checkout_payments')
        .where('customer_email', '==', customer_email)
        .count()
        .get();
      
      const totalCount = totalQuery.data().count;
      
      return res.json({
        success: true,
        count: orders.length,
        total_count: totalCount,
        orders: orders
      });
      
    } catch (error) {
      console.error('❌ Error getting user orders:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// GET PAYMENT STATUS
// =============================================

exports.getPaymentStatus = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { external_reference } = req.query;

      if (!external_reference) {
        return res.status(400).json({ success: false, error: 'External reference is required' });
      }

      const paymentDoc = await db.collection('checkout_payments').doc(external_reference).get();

      if (!paymentDoc.exists) {
        return res.status(404).json({ success: false, error: 'Payment not found' });
      }

      const d = paymentDoc.data();

      // ─── DETECT REAL STATUS ──────────────────────────────────────────
      // d.status alone is unreliable — the webhook sometimes returns early
      // without updating it. So we check multiple signals from Firestore
      // to determine if the payment is truly approved.
      const isApproved =
        d.status === 'approved' ||
        d.order_status_mp === 'paid' ||
        d.order_status === 'processing' ||
        !!d.printful_order_id ||        // Printful order created = definitely paid
        !!d.approved_at ||              // approved_at timestamp set by webhook
        !!d.paid_amount;                // paid_amount recorded = money arrived

      const isFailed =
        d.status === 'rejected' ||
        d.status === 'cancelled' ||
        d.status === 'refunded' ||
        d.order_status === 'payment_failed';

      const resolvedStatus = isApproved ? 'approved' : isFailed ? 'rejected' : d.status || 'pending';

      console.log(`📊 Status for ${external_reference}:`, {
        raw_status: d.status,
        resolved: resolvedStatus,
        signals: { order_status_mp: d.order_status_mp, printful_order_id: d.printful_order_id, approved_at: !!d.approved_at, paid_amount: d.paid_amount }
      });

      return res.json({
        success: true,
        payment: {
          external_reference: paymentDoc.id,
          status: resolvedStatus,       // ← the pending page reads this field
          order_status: d.order_status || 'pending',
          total_amount: d.total_amount,
          customer_email: d.customer_email,
          payment_details: d.payment_details || null,
          products: d.cart_products?.map(p => ({
            title: p.title,
            designer_name: p.designer_name
          })) || []
        }
      });

    } catch (error) {
      console.error('❌ Error getting payment status:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
});

// =============================================
// PAYMENT WEBHOOK HANDLER
// =============================================

exports.paymentWebhook = functions.runWith({ timeoutSeconds: 300, memory: '1GB' }).https.onRequest((req, res) => {
  cors(req, res, async () => {
    // Return 200 IMMEDIATELY — MercadoPago retries if we take too long
    res.status(200).send('OK');

    try {
      const { type, data, action, topic, id } = req.body;
      const webhookType = type || topic || action;
      const webhookId = String(data?.id || id || '');

      console.log(`📥 Webhook — type: ${webhookType}, id: ${webhookId}`);

      if (!webhookType || !webhookId) {
        console.error('❌ Invalid webhook payload');
        return;
      }

      switch (webhookType) {
        case 'payment':
        case 'payment.create':
        case 'payment.updated':
        case 'payment.update':
        case 'payment.refund':
        case 'payment.cancel':
          await handlePaymentEvent(webhookId);
          break;
        case 'merchant_order':
        case 'order':
          await handleMerchantOrderEvent(webhookId);
          break;
        default:
          console.log(`⚠️ Unhandled webhook type: ${webhookType}`);
          if (webhookId.length > 5) await handlePaymentEvent(webhookId);
      }
    } catch (error) {
      console.error('❌ Webhook processing error:', error.message);
      await db.collection('webhook_failures').add({
        body: req.body,
        error: error.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });
});

// =============================================
// HANDLE PAYMENT EVENT
// =============================================

async function handlePaymentEvent(paymentId) {
  try {
    console.log(`💰 Handling payment event for ID: ${paymentId}`);
    
    const mpResponse = await axios.get(
      `${MP_API_BASE}/v1/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        },
        timeout: 10000
      }
    );
    
    const payment = mpResponse.data;
    const externalReference = payment.external_reference;
    
    if (!externalReference) {
      console.error('❌ No external reference found in payment:', paymentId);
      
      const orderByPaymentId = await findOrderByPaymentId(paymentId);
      if (orderByPaymentId) {
        console.log('✅ Found order by payment_id:', orderByPaymentId);
        await processPaymentUpdate(orderByPaymentId, payment);
      } else {
        console.log('ℹ️ Creating orphan payment record');
        await createOrphanPaymentRecord(payment);
      }
      return;
    }
    
    console.log(`💳 Payment ${paymentId} status: ${payment.status} (${payment.status_detail}) for order: ${externalReference}`);
    
    await processPaymentUpdate(externalReference, payment);
    
    if (payment.order && payment.order.id) {
      await handleMerchantOrderEvent(payment.order.id);
    }
    
  } catch (error) {
    console.error(`❌ Error handling payment event ${paymentId}:`, error);
    
    await db.collection('webhook_failures').add({
      payment_id: paymentId,
      error: error.message,
      stack: error.stack,
      response_data: error.response?.data,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      retry_count: 0
    });
  }
}

// =============================================
// PROCESS PAYMENT UPDATE
// =============================================

async function processPaymentUpdate(externalReference, payment) {
  try {
    console.log(`🔄 Processing payment update for ${externalReference} with status: ${payment.status}`);
    
    const paymentRef = db.collection('checkout_payments').doc(externalReference);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      console.log(`ℹ️ Payment record not found for ${externalReference}, creating...`);
      await paymentRef.set({
        external_reference: externalReference,
        payment_id: payment.id,
        status: payment.status,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        from_webhook: true,
        payment_data: payment
      });
    } else {
      const existing = paymentDoc.data();
      if (payment.status === 'approved') {
        // Already has a Printful order — fully done
        if (existing.printful_order_id) {
          console.log(`⏭️ Order ${externalReference} already fulfilled (Printful: ${existing.printful_order_id}), skipping`);
          return;
        }
        // Printful call is in-flight right now on another webhook — don't double-trigger
        if (existing.printful_queued && !existing.printful_failed) {
          console.log(`⏭️ Order ${externalReference} Printful call already in progress, skipping`);
          return;
        }
      }
    }
    
    if (payment.status === 'approved') {
      console.log('🎉 PAYMENT APPROVED');
      
      await paymentRef.set({
        status: payment.status,
        payment_id: payment.id,
        payment_method: payment.payment_method_id,
        payment_type: payment.payment_type_id,
        date_approved: payment.date_approved || new Date().toISOString(),
        order_status: 'processing',
        approved_at: admin.firestore.FieldValue.serverTimestamp(),
        payment_details: {
          id: payment.id,
          method: payment.payment_method_id,
          type: payment.payment_type_id,
          installments: payment.installments,
          transaction_amount: payment.transaction_amount,
          net_received_amount: payment.transaction_amount - (payment.fee_details?.reduce((sum, fee) => sum + (fee.amount || 0), 0) || 0),
          card_last_four: payment.card?.last_four_digits,
          card_brand: payment.card?.cardholder?.name,
          payer_document: payment.payer?.identification?.number,
          payer_document_type: payment.payer?.identification?.type,
          fee_details: payment.fee_details,
          coupon_amount: payment.coupon_amount,
          shipping_amount: payment.shipping_amount
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      await db.collection('orders').doc(externalReference).set({
        status: 'processing',
        payment_approved_at: admin.firestore.FieldValue.serverTimestamp(),
        payment_details: {
          id: payment.id,
          method: payment.payment_method_id,
          installments: payment.installments,
          amount: payment.transaction_amount
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      await processPurchasedProducts(externalReference, payment);
      
      await recordOrderEvent(externalReference, 'payment_approved', {
        payment_id: payment.id,
        amount: payment.transaction_amount,
        method: payment.payment_method_id,
        status_detail: payment.status_detail
      });
      
      await queueNotification('customer_payment_success', {
        external_reference: externalReference,
        email: payment.payer?.email,
        amount: payment.transaction_amount
      });
    }
    
    else if (payment.status === 'rejected') {
      console.log('❌ PAYMENT REJECTED');
      
      const rejectionReasons = {
        'cc_rejected_bad_filled_card_number': 'Invalid card number',
        'cc_rejected_bad_filled_date': 'Invalid expiration date',
        'cc_rejected_bad_filled_security_code': 'Invalid security code',
        'cc_rejected_insufficient_amount': 'Insufficient funds',
        'cc_rejected_other_reason': 'General error',
        'cc_rejected_card_disabled': 'Card disabled',
        'cc_rejected_duplicated_payment': 'Duplicate payment',
        'cc_rejected_max_attempts': 'Maximum attempts exceeded',
        'cc_rejected_high_risk': 'High risk transaction',
        'cc_rejected_blacklist': 'Card in blacklist',
        'rejected_by_bank': 'Rejected by bank',
        'rejected_insufficient_funds': 'Insufficient funds'
      };
      
      const rejectionMessage = rejectionReasons[payment.status_detail] || payment.status_detail || 'Unknown reason';
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'payment_failed',
        failure_reason: payment.status_detail,
        failure_message: rejectionMessage,
        failure_time: admin.firestore.FieldValue.serverTimestamp(),
        retry_available: payment.status_detail?.includes('bad_filled') || payment.status_detail?.includes('insufficient'),
        payment_details: {
          id: payment.id,
          method: payment.payment_method_id,
          error: rejectionMessage,
          status_detail: payment.status_detail
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'payment_failed',
        failure_reason: payment.status_detail,
        failure_message: rejectionMessage,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_rejected', {
        payment_id: payment.id,
        reason: payment.status_detail,
        message: rejectionMessage
      });
      
      if (!payment.status_detail?.includes('bad_filled')) {
        await queueNotification('customer_payment_failed', {
          external_reference: externalReference,
          email: payment.payer?.email,
          reason: rejectionMessage
        });
      }
      
      await updatePaymentAnalytics('rejected', payment);
    }
    
    else if (payment.status === 'cancelled') {
      console.log('🚫 PAYMENT CANCELLED');
      
      const cancelReason = payment.status_detail || 'cancelled_by_user';
      const isTimeout = cancelReason.includes('expired') || cancelReason.includes('timeout');
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'cancelled',
        cancellation_reason: cancelReason,
        cancellation_type: isTimeout ? 'timeout' : 'user_cancelled',
        cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
        payment_details: {
          id: payment.id,
          method: payment.payment_method_id,
          reason: cancelReason
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'cancelled',
        cancellation_reason: cancelReason,
        cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_cancelled', {
        payment_id: payment.id,
        reason: cancelReason,
        is_timeout: isTimeout
      });
      
      await releaseReservedInventory(externalReference);
      
      if (!isTimeout) {
        await queueNotification('customer_payment_cancelled', {
          external_reference: externalReference,
          email: payment.payer?.email
        });
      }
    }
    
    else if (payment.status === 'refunded') {
      console.log('↩️ PAYMENT REFUNDED');
      
      const refundData = payment.refunds?.data?.[0] || {};
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'refunded',
        refund_status: 'completed',
        refund_amount: payment.transaction_amount_refunded || payment.transaction_amount,
        refund_details: {
          id: refundData.id,
          amount: refundData.amount,
          date: refundData.date_created,
          source: refundData.source?.name,
          reason: refundData.reason
        },
        refunded_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'refunded',
        refunded_amount: payment.transaction_amount_refunded,
        refunded_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_refunded', {
        payment_id: payment.id,
        amount: payment.transaction_amount_refunded,
        refund_id: refundData.id
      });
      
      await queueNotification('customer_refund_confirmed', {
        external_reference: externalReference,
        email: payment.payer?.email,
        amount: payment.transaction_amount_refunded
      });
    }
    
    else if (payment.status === 'partially_refunded') {
      console.log('↩️ PAYMENT PARTIALLY REFUNDED');
      
      const refundData = payment.refunds?.data || [];
      const totalRefunded = refundData.reduce((sum, r) => sum + (r.amount || 0), 0);
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'partially_refunded',
        refund_status: 'partial',
        total_refunded: totalRefunded,
        remaining_amount: payment.transaction_amount - totalRefunded,
        refund_details: refundData,
        partially_refunded_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'partially_refunded',
        total_refunded: totalRefunded,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_partially_refunded', {
        payment_id: payment.id,
        refunded_amount: totalRefunded,
        refund_count: refundData.length
      });
      
      await queueNotification('customer_partial_refund', {
        external_reference: externalReference,
        email: payment.payer?.email,
        amount: totalRefunded
      });
    }
    
    else if (payment.status === 'charged_back') {
      console.log('💸 PAYMENT CHARGED BACK - FRAUD ALERT!');
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'fraud_dispute',
        fraud_alert: true,
        chargeback_status: 'initiated',
        chargeback_details: {
          reason: payment.status_detail,
          amount: payment.transaction_amount,
          date: admin.firestore.FieldValue.serverTimestamp(),
          chargeback_id: payment.chargeback?.id
        },
        chargeback_time: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'fraud_dispute',
        fraud_alert: true,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('fraud_alerts').add({
        order_reference: externalReference,
        payment_id: payment.id,
        amount: payment.transaction_amount,
        customer_email: payment.payer?.email,
        products: (await getOrderProducts(externalReference)),
        reason: 'chargeback',
        chargeback_data: payment.chargeback,
        status: 'urgent_review',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        assigned_to: null,
        priority: 'high'
      });
      
      await recordOrderEvent(externalReference, 'payment_charged_back', {
        payment_id: payment.id,
        amount: payment.transaction_amount,
        chargeback_id: payment.chargeback?.id
      });
      
      await sendAdminAlert('CHARGEBACK_DETECTED', {
        order_id: externalReference,
        amount: payment.transaction_amount,
        customer: payment.payer?.email
      });
    }
    
    else if (payment.status === 'in_mediation') {
      console.log('⚖️ PAYMENT IN MEDIATION');
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'dispute',
        mediation_status: 'active',
        mediation_started: admin.firestore.FieldValue.serverTimestamp(),
        mediation_details: {
          reason: payment.status_detail,
          days_remaining: 15,
          last_updated: admin.firestore.FieldValue.serverTimestamp()
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'dispute',
        mediation_active: true,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('disputes').add({
        order_reference: externalReference,
        payment_id: payment.id,
        amount: payment.transaction_amount,
        customer_email: payment.payer?.email,
        status: 'in_mediation',
        started_at: admin.firestore.FieldValue.serverTimestamp(),
        required_action: 'gather_evidence'
      });
      
      await recordOrderEvent(externalReference, 'payment_in_mediation', {
        payment_id: payment.id
      });
      
      await sendAdminAlert('DISPUTE_STARTED', {
        order_id: externalReference,
        payment_id: payment.id
      });
    }
    
    else if (payment.status === 'pending') {
      console.log('⏳ PAYMENT PENDING');
      
      const pendingReasons = {
        'pending_waiting_payment': 'Awaiting payment (boleto/bank transfer)',
        'pending_waiting_transfer': 'Awaiting bank transfer',
        'pending_review_manual': 'Under manual review',
        'pending_contingency': 'Under contingency review',
        'pending_waiting_mp': 'Waiting for Mercado Pago processing'
      };
      
      const pendingMessage = pendingReasons[payment.status_detail] || 'Payment pending confirmation';
      
      let expiresAt = null;
      if (payment.payment_method_id === 'bolbradesco') {
        expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      } else if (payment.payment_method_id === 'pec') {
        expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      }
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'awaiting_payment',
        pending_reason: payment.status_detail,
        pending_message: pendingMessage,
        pending_since: admin.firestore.FieldValue.serverTimestamp(),
        expires_at: expiresAt,
        boleto_url: payment.transaction_details?.external_resource_url,
        boleto_barcode: payment.barcode?.content,
        payment_details: {
          id: payment.id,
          method: payment.payment_method_id,
          boleto_url: payment.transaction_details?.external_resource_url,
          expires_at: expiresAt,
          qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
          qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
          ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'awaiting_payment',
        pending_details: {
          method: payment.payment_method_id,
          boleto_url: payment.transaction_details?.external_resource_url,
          expires_at: expiresAt
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_pending', {
        payment_id: payment.id,
        method: payment.payment_method_id,
        expires_at: expiresAt,
        boleto_url: payment.transaction_details?.external_resource_url
      });
      
      await queueNotification('customer_payment_instructions', {
        external_reference: externalReference,
        email: payment.payer?.email,
        method: payment.payment_method_id,
        boleto_url: payment.transaction_details?.external_resource_url,
        qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
        expires_at: expiresAt
      });
      
      if (expiresAt) {
        await scheduleExpirationCheck(externalReference, expiresAt);
      }
    }
    
    else if (payment.status === 'in_process') {
      console.log('🔄 PAYMENT IN PROCESS');
      
      const processReasons = {
        'pending_contingency': 'Anti-fraud analysis',
        'pending_review_manual': 'Manual review required',
        'pending_waiting_mp': 'Processing with Mercado Pago'
      };
      
      const processMessage = processReasons[payment.status_detail] || 'Payment under review';
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'under_review',
        review_reason: payment.status_detail,
        review_message: processMessage,
        in_process_since: admin.firestore.FieldValue.serverTimestamp(),
        estimated_completion: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await db.collection('orders').doc(externalReference).update({
        status: 'under_review',
        review_details: {
          reason: payment.status_detail,
          started_at: admin.firestore.FieldValue.serverTimestamp()
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_in_process', {
        payment_id: payment.id,
        reason: payment.status_detail
      });
      
      if (payment.status_detail === 'pending_review_manual') {
        await queueNotification('customer_payment_review', {
          external_reference: externalReference,
          email: payment.payer?.email
        });
      }
    }
    
    else if (payment.status === 'authorized') {
      console.log('✅ PAYMENT AUTHORIZED');
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        order_status: 'authorized',
        authorized_at: admin.firestore.FieldValue.serverTimestamp(),
        capture_available_until: payment.authorization_data?.capture_available_until,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_authorized', {
        payment_id: payment.id,
        capture_deadline: payment.authorization_data?.capture_available_until
      });
      
      if (process.env.AUTO_CAPTURE === 'false') {
        await queueManualCapture(externalReference, payment.id);
      }
    }
    
    else {
      console.log(`ℹ️ Unknown payment status: ${payment.status}`);
      
      await paymentRef.update({
        status: payment.status,
        payment_id: payment.id,
        raw_status: payment.status,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        payment_details: payment
      });
      
      await recordOrderEvent(externalReference, 'payment_status_unknown', {
        payment_id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail
      });
    }
    
    await paymentRef.set({
      last_webhook_at: admin.firestore.FieldValue.serverTimestamp(),
      last_webhook_type: 'payment',
      last_webhook_status: payment.status
    }, { merge: true });
    
    console.log(`✅ Payment update processed for ${externalReference}`);
    
  } catch (error) {
    console.error(`❌ Error processing payment update:`, error);
    throw error;
  }
}

// =============================================
// HANDLE MERCHANT ORDER
// =============================================

async function handleMerchantOrderEvent(merchantOrderId) {
  try {
    console.log(`📦 Handling merchant order event for ID: ${merchantOrderId}`);
    
    const mpResponse = await axios.get(
      `${MP_API_BASE}/merchant_orders/${merchantOrderId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );
    
    const order = mpResponse.data;
    console.log(`📊 Merchant order ${merchantOrderId}:`, {
      status: order.order_status,
      total_amount: order.total_amount,
      paid_amount: order.paid_amount,
      payments: order.payments?.length || 0,
      external_reference: order.external_reference
    });
    
    const externalReference = order.external_reference;
    if (!externalReference) {
      console.log('ℹ️ No external reference in merchant order');
      return;
    }
    
    const orderRef = db.collection('checkout_payments').doc(externalReference);
    
    await orderRef.update({
      merchant_order_id: merchantOrderId,
      order_status_mp: order.order_status,
      total_amount_mp: order.total_amount,
      paid_amount: order.paid_amount,
      refunded_amount: order.refunded_amount,
      shipping_cost: order.shipping_cost,
      payments: order.payments,
      order_items: order.items,
      order_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // NOTE: Do NOT call handlePaymentEvent here — it creates a recursive loop
    // (handlePaymentEvent → handleMerchantOrderEvent → handlePaymentEvent).
    // Payment processing is handled entirely by the payment webhook.
    if (order.payments && order.payments.length > 0) {
      console.log(`ℹ️ Merchant order has ${order.payments.length} payment(s) — handled by payment webhook`);
    }
    
    await recordOrderEvent(externalReference, 'merchant_order_updated', {
      merchant_order_id: merchantOrderId,
      order_status: order.order_status,
      payment_count: order.payments?.length
    });
    
    console.log(`✅ Merchant order ${merchantOrderId} processed`);
    
  } catch (error) {
    console.error(`❌ Error handling merchant order ${merchantOrderId}:`, error);
  }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

async function findOrderByPaymentId(paymentId) {
  try {
    const snapshot = await db.collection('checkout_payments')
      .where('payment_id', '==', paymentId)
      .limit(1)
      .get();
    
    if (!snapshot.empty) {
      return snapshot.docs[0].id;
    }
    return null;
  } catch (error) {
    console.error('Error finding order by payment ID:', error);
    return null;
  }
}

async function createOrphanPaymentRecord(payment) {
  try {
    const orphanId = `orphan_${payment.id}_${Date.now()}`;
    await db.collection('orphan_payments').doc(orphanId).set({
      payment_id: payment.id,
      payment_data: payment,
      received_at: admin.firestore.FieldValue.serverTimestamp(),
      status: 'unlinked'
    });
    console.log(`📝 Orphan payment recorded: ${orphanId}`);
  } catch (error) {
    console.error('Error creating orphan payment:', error);
  }
}

async function recordOrderEvent(orderId, eventType, eventData) {
  try {
    await db.collection('order_events').add({
      order_id: orderId,
      event_type: eventType,
      event_data: eventData,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error recording order event:', error);
  }
}

async function queueNotification(type, data) {
  try {
    await db.collection('notification_queue').add({
      type: type,
      data: data,
      status: 'pending',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      retry_count: 0
    });
  } catch (error) {
    console.error('Error queueing notification:', error);
  }
}

async function updatePaymentAnalytics(status, payment) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const analyticsRef = db.collection('payment_analytics').doc(date);
    
    await analyticsRef.set({
      [`counts.${status}`]: admin.firestore.FieldValue.increment(1),
      [`amounts.${status}`]: admin.firestore.FieldValue.increment(payment.transaction_amount || 0),
      last_updated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error updating analytics:', error);
  }
}

async function releaseReservedInventory(orderId) {
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return;
    
    console.log(`📦 Releasing inventory for cancelled order: ${orderId}`);
  } catch (error) {
    console.error('Error releasing inventory:', error);
  }
}

async function getOrderProducts(orderId) {
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return [];
    return orderDoc.data().products || [];
  } catch (error) {
    console.error('Error getting order products:', error);
    return [];
  }
}

async function sendAdminAlert(type, data) {
  try {
    await db.collection('admin_alerts').add({
      type: type,
      data: data,
      severity: 'high',
      status: 'new',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error sending admin alert:', error);
  }
}

async function scheduleExpirationCheck(orderId, expiresAt) {
  try {
    await db.collection('expiration_tasks').add({
      order_id: orderId,
      expires_at: expiresAt,
      check_at: expiresAt,
      status: 'scheduled',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error scheduling expiration check:', error);
  }
}

async function queueManualCapture(orderId, paymentId) {
  try {
    await db.collection('capture_queue').add({
      order_id: orderId,
      payment_id: paymentId,
      status: 'pending',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error queueing manual capture:', error);
  }
}

// =============================================
// INITIALIZATION LOG
// =============================================

console.log('🔄 ENHANCED WEBHOOK HANDLER INITIALIZED');
console.log('📋 Handling all Mercado Pago webhook types:');
console.log('  - payment (ALL statuses: approved, rejected, cancelled, refunded, charged_back, in_mediation, pending, in_process, authorized)');
console.log('  - merchant_order (complete order context)');
console.log('');
console.log('📊 Payment Status Categories:');
console.log('  FINAL STATES: approved, rejected, cancelled, refunded, partially_refunded, charged_back, in_mediation');
console.log('  TRANSIENT: pending, in_process, authorized');
console.log('');
console.log('🎯 Enhanced features:');
console.log('  - Orphan payment detection');
console.log('  - Fraud alert system');
console.log('  - Payment analytics');
console.log('  - Expiration monitoring');
console.log('  - Manual capture queue');
console.log('🛒 ENHANCED CHECKOUT PRO FUNCTIONS INITIALIZED WITH CART SUPPORT');
console.log(`💰 Mercado Pago: ${MP_CONFIGURED ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
if (MP_CONFIGURED) {
  console.log(`🔑 Environment: ${MP_ACCESS_TOKEN.startsWith('TEST-') ? 'SANDBOX' : 'PRODUCTION'}`);
}
console.log('🏪 Store Owner:', STORE_OWNER.name);
console.log('🛍️ Cart Features:');
console.log('  - Multi-product cart support');
console.log('  - Order management system');
console.log('📡 Webhooks Available:');
console.log('  - paymentWebhook (handles: payment.created, payment.updated, etc.)');
console.log('  - createCheckoutProPayment (cart checkout)');
console.log('  - getOrderDetails (order lookup)');
console.log('  - getUserOrders (customer order history)');