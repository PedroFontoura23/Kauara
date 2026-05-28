const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { createDimonaOrder } = require('./dimona-functions');
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

if (!MP_CONFIGURED) {
  console.error('❌ MERCADO PAGO NOT CONFIGURED - Set mercadopago.token using: firebase functions:config:set mercadopago.token="YOUR_TOKEN"');
}

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
      // Dimona requires dimona_sku - NO FALLBACK
      if (!product.dimona_sku) {
        errors.push(`Product ${index + 1} missing dimona_sku (required for Dimona)`);
      }
      // Dimona requires design_url - NO FALLBACK
      if (!product.design_url && !product.designUrls?.front) {
        errors.push(`Product ${index + 1} missing design_url (required for Dimona)`);
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
// GET USER ORDERS BY USER ID
// =============================================
exports.getUserOrdersByUserId = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        try {
            const { user_id, limit = 50 } = req.query;

            if (!user_id) {
                return res.status(400).json({ success: false, error: 'user_id is required' });
            }

            console.log('🔍 Getting orders for user_id:', user_id);

            const userDoc = await db.collection('users').doc(user_id).get();
            
            if (!userDoc.exists) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            const userData = userDoc.data();
            
            // Try multiple ways to find orders for this user
            let ordersQuery = null;
            let foundBy = null;
            
            // Method 1: Try by firebaseUID in checkout_payments metadata
            const firebaseUID = userData.firebaseUID;
            if (firebaseUID) {
                console.log('🔍 Looking for orders by firebaseUID:', firebaseUID);
                const snapshot = await db.collection('checkout_payments')
                    .where('user_uid', '==', firebaseUID)
                    .limit(parseInt(limit))
                    .get();
                
                if (!snapshot.empty) {
                    ordersQuery = snapshot;
                    foundBy = 'firebaseUID';
                }
            }
            
            // Method 2: Try by userId in metadata
            if (!ordersQuery) {
                const userId = userData.userId;
                if (userId) {
                    console.log('🔍 Looking for orders by userId:', userId);
                    const snapshot = await db.collection('checkout_payments')
                        .where('metadata.user_id', '==', userId)
                        .limit(parseInt(limit))
                        .get();
                    
                    if (!snapshot.empty) {
                        ordersQuery = snapshot;
                        foundBy = 'userId';
                    }
                }
            }
            
            // Method 3: Try by customer name (fallback)
            if (!ordersQuery) {
                const userName = userData.user_Name || userData.displayName;
                if (userName) {
                    console.log('🔍 Looking for orders by customer name:', userName);
                    const snapshot = await db.collection('checkout_payments')
                        .where('buyer_info.name', '==', userName)
                        .limit(parseInt(limit))
                        .get();
                    
                    if (!snapshot.empty) {
                        ordersQuery = snapshot;
                        foundBy = 'customer_name';
                    }
                }
            }
            
            if (!ordersQuery) {
                console.log('ℹ️ No orders found for user:', user_id);
                return res.json({ success: true, count: 0, orders: [], user_id });
            }
            
            const orders = [];
            ordersQuery.forEach(doc => {
                const data = doc.data();
                orders.push({
                    id: doc.id,
                    external_reference: data.external_reference,
                    total_amount: data.total_amount,
                    product_count: data.cart_products?.length || 0,
                    status: data.payment_status || data.status,
                    order_status: data.dimona_order_status || data.order_status,
                    payment_status: data.payment_status || data.status,
                    created_at: data.created_at?.toDate?.() || data.created_at,
                    products: (data.cart_products || []).map(p => ({
                        product_id: p.product_id || null,
                        title: p.title || p.productTitle || null,
                        designer_name: p.designer_name || p.designerName || null,
                        designer_id: p.designerUserId || p.designer_id || null,
                        price: p.pricing?.total_price || p.price || 0,
                        selectedVariant: p.selectedVariant || null,
                        thumbnail: p.thumbnail || p.thumbnailUrl || null,
                        pricing: p.pricing || null
                    })),
                });
            });

            orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

            return res.json({ 
                success: true, 
                count: orders.length, 
                orders, 
                user_id,
                found_by: foundBy 
            });

        } catch (error) {
            console.error('❌ Error getting user orders:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    });
});

// =============================================
// PROCESS PURCHASED PRODUCTS (WHEN PAYMENT IS APPROVED)
// =============================================

async function processPurchasedProducts(orderId, paymentData) {
    console.log(`📦 [processPurchasedProducts] Starting for order: ${orderId}`);
    
    try {
        const orderRef = db.collection('checkout_payments').doc(orderId);
        const orderDoc = await orderRef.get();
        
        if (!orderDoc.exists) {
            console.error(`❌ Order not found: ${orderId}`);
            throw new Error(`Order ${orderId} not found`);
        }
        
        const order = orderDoc.data();

        // 🔍 DEBUG: Log exactly what identity fields are present in the order
        console.log(`🔍 [processPurchasedProducts] Order identity fields:`, {
            firestore_user_id: order.firestore_user_id || null,
            user_uid: order.user_uid || null,
            'metadata.user_uid': order.metadata?.user_uid || null,
            customer_email: order.customer_email || null,
            'buyer_info.email': order.buyer_info?.email || null,
            cart_products_count: (order.cart_products || []).length,
            cart_cleaned_up: order.cart_cleaned_up || false
        });
        
        // Verifica se já processado para evitar duplicidade
        if (order.cart_cleaned_up === true) {
            console.log(`⏭️ Order ${orderId} already processed, skipping`);
            return { success: true, alreadyProcessed: true };
        }

        // 1. LOCALIZAÇÃO DO USUÁRIO (Melhorada)
        let userId = order.firestore_user_id; 
        let usersSnapshot = null;

        if (!userId) {
            const userUid = order.user_uid || order.metadata?.user_uid;
            if (userUid) {
                console.log(`🔍 Trying lookup by firebaseUID: ${userUid}`);
                usersSnapshot = await db.collection('users').where('firebaseUID', '==', userUid).limit(1).get();
                if (!usersSnapshot.empty) userId = usersSnapshot.docs[0].id;
            }
        }

        if (!userId) {
            const customerEmail = order.customer_email || order.buyer_info?.email;
            if (customerEmail) {
                console.log(`🔍 Trying lookup by email: ${customerEmail}`);
                // Try all known email field names used in the users collection
                const emailFields = [
                    'email', 'user_email', 'userEmail', 'user_Email', 'Email',
                    'emailAddress', 'mail', 'correo'
                ];
                for (const field of emailFields) {
                    usersSnapshot = await db.collection('users').where(field, '==', customerEmail).limit(1).get();
                    if (!usersSnapshot.empty) {
                        console.log(`✅ Found user by field "${field}"`);
                        userId = usersSnapshot.docs[0].id;
                        break;
                    }
                }

                // Last-resort: case-insensitive full scan (safe for collections up to ~500 users)
                if (!userId) {
                    console.warn(`⚠️ [processPurchasedProducts] Exact email match failed for "${customerEmail}" — falling back to case-insensitive scan`);
                    try {
                        const allUsersSnap = await db.collection('users').limit(500).get();
                        allUsersSnap.forEach(doc => {
                            if (userId) return;
                            const d = doc.data();
                            const match = Object.values(d).some(
                                v => typeof v === 'string' && v.toLowerCase() === customerEmail.toLowerCase()
                            );
                            if (match) {
                                console.log(`✅ Found user by case-insensitive scan: ${doc.id}`);
                                userId = doc.id;
                            }
                        });
                    } catch (scanErr) {
                        console.error(`❌ Case-insensitive scan failed:`, scanErr.message);
                    }
                }
            }
        }

        if (!userId) {
            const tried = `firestore_user_id: ${order.firestore_user_id} | user_uid: ${order.user_uid} | email: ${order.customer_email}`;
            console.error(`❌ [processPurchasedProducts] User not found — tried: ${tried}`);
            // 🔥 DO NOT set cart_cleaned_up=true here — leave it so a retry can succeed
            await orderRef.update({
                cart_cleanup_failed: true,
                cart_cleanup_error: `User not found (tried ${tried})`,
                cart_cleanup_retry_at: admin.firestore.FieldValue.serverTimestamp()
            });
            return { success: false, error: 'User not found', tried };
        }

        console.log(`✅ User found: ${userId}`);

        // 2. PREPARAÇÃO DO BATCH
        const userRef = db.collection('users').doc(userId);
        const cartRef = userRef.collection('cart');
        const purchasedRef = userRef.collection('purchasedItems');
        const cartSnapshot = await cartRef.get();
        const cartProducts = order.cart_products || [];

        console.log(`🛒 Cart subcollection has ${cartSnapshot.size} items. Order has ${cartProducts.length} cart_products.`);
        
        if (cartProducts.length === 0) {
            console.error(`❌ [processPurchasedProducts] order.cart_products is empty for order ${orderId}`);
            return { success: false, error: 'No cart_products on order' };
        }

        const batch = db.batch();
        let movedCount = 0;
        let removedCount = 0;

        // Criar identificadores para o match
        const orderProductIds = new Set(cartProducts.map(p => p.product_id || p.id).filter(Boolean));
        const orderSkus = new Set(cartProducts.map(p => p.dimona_sku || p.sku).filter(Boolean));
        console.log(`🔍 Matching against product_ids:`, [...orderProductIds], `skus:`, [...orderSkus]);

        // 3. LIMPEZA DO CARRINHO
        cartSnapshot.forEach(doc => {
            const item = doc.data();
            const itemId = item.product_id || item.firestoreProductId || doc.id;
            const itemSku = item.dimona_sku || item.selectedVariant?.dimona_sku;
            console.log(`  🛒 Cart item: doc.id=${doc.id} itemId=${itemId} sku=${itemSku}`);

            if (orderProductIds.has(itemId) || (itemSku && orderSkus.has(itemSku))) {
                console.log(`  ✅ Matched — deleting from cart`);
                batch.delete(doc.ref);
                removedCount++;
            } else {
                console.log(`  ⚠️ No match — keeping in cart`);
            }
        });

        // 4. MOVIMENTAÇÃO PARA PURCHASEDITEMS
        for (const product of cartProducts) {
            const productId = product.product_id || product.id;
            const purchasedItemKey = `${orderId}_${productId}`;
            
            const purchasedItemData = {
                product_id: productId,
                productTitle: product.title || product.productTitle || 'Produto',
                designerName: product.designer_name || product.designerName || 'Designer',
                designer_id: product.designer_id || product.designerUserId || null,
                order_id: orderId,
                payment_id: paymentData.id || order.payment_id || 'N/A',
                purchased_at: admin.firestore.FieldValue.serverTimestamp(),
                purchase_status: 'completed',
                delivery_status: order.dimona_order_status || 'processing',
                selectedVariant: product.selectedVariant || {},
                thumbnail: product.thumbnail || product.thumbnailUrl || null,
                pricing: product.pricing || {},
                dimona_sku: product.dimona_sku || product.selectedVariant?.dimona_sku || null,
                moved_from_cart: true,
                _synced_at: admin.firestore.FieldValue.serverTimestamp()
            };

            console.log(`  📦 Writing purchasedItem: ${purchasedItemKey}`);
            batch.set(purchasedRef.doc(purchasedItemKey), purchasedItemData);
            movedCount++;
        }

        // 5. ATUALIZAÇÃO DO PEDIDO PRINCIPAL
        batch.update(orderRef, {
            cart_cleaned_up: true,
            items_moved_to_purchased: movedCount,
            items_removed_from_cart: removedCount,
            cart_cleanup_completed_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            order_status: 'paid'
        });

        await batch.commit();
        console.log(`✅ [processPurchasedProducts] Done — moved: ${movedCount}, removed from cart: ${removedCount}`);

        // 6. INTEGRAÇÃO DIMONA
        try {
            const dimonaResult = await createDimonaOrder(orderId);
            console.log(`✅ Dimona order created:`, dimonaResult);
        } catch (dimonaError) {
            console.error(`❌ Dimona order creation failed:`, dimonaError.message);
            await orderRef.update({ dimona_creation_failed: true, dimona_error: dimonaError.message });
        }

        // 7. NOTIFICAÇÃO
        await queueNotification('purchase_confirmed', {
            order_id: orderId,
            user_uid: order.user_uid,
            total_amount: order.total_amount
        });

        return { success: true, movedCount, removedCount };

    } catch (error) {
        console.error(`❌ [processPurchasedProducts] Critical Error:`, error);
        await db.collection('payment_processing_errors').add({
            order_id: orderId,
            error: error.message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        throw error;
    }
}

// =============================================
// CREATE CHECKOUT PRO PAYMENT
// =============================================

exports.createCheckoutProPayment = functions.https.onRequest((req, res) => {
  if (req.method === 'OPTIONS') {
    cors(req, res, () => {
      res.status(204).send('');
    });
    return;
  }
  cors(req, res, async () => {
    try {
      console.log('🔄 [createCheckoutProPayment] Creating Checkout Pro payment');
      
      if (!MP_CONFIGURED) {
        console.error('❌ [createCheckoutProPayment] Mercado Pago not configured');
        return res.status(500).json({
          success: false,
          error: 'Payment system not configured',
          message: 'Please contact the store administrator'
        });
      }
      
      const paymentData = req.body; 
      
      console.log('📦 [createCheckoutProPayment] Payment data received:', {
        title: paymentData.title,
        amount: paymentData.unit_price,
        quantity: paymentData.quantity,
        product_count: paymentData.cart_products?.length || 0,
        external_reference: paymentData.external_reference,
        picture_url: paymentData.picture_url ? 'Provided' : 'Missing'
      });
      
      const validation = validatePaymentData(paymentData);
      if (!validation.isValid) {
        console.error('❌ [createCheckoutProPayment] Validation failed:', validation.errors);
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }
      
      const { title, quantity, unit_price, email, cart_products } = validation.validatedData;
      
      // Use external_reference from client if provided, otherwise generate
      const externalReference = paymentData.external_reference || `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const firstProduct = cart_products[0];
      const pictureUrl = paymentData.picture_url || 
                        firstProduct?.thumbnailUrl || 
                        firstProduct?.thumbnail || 
                        'https://http2.mlstatic.com/frontend-assets/ui-nav/5.19.1/mercadolibre/180x180.png';
      
      const successUrl = paymentData.return_url || `${STORE_OWNER.redirectUrls.success}`;
      const failureUrl = paymentData.cancel_url || `${STORE_OWNER.redirectUrls.failure}`;
      
      console.log('🔗 [createCheckoutProPayment] Return URLs:', {
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
          external_reference: externalReference,
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
            state_name: paymentData.shipping_address.state_name || '',
            apartment: paymentData.shipping_address.complement || '',
          }
        };
      }
      
      console.log('💰 [createCheckoutProPayment] Creating preference with external_reference:', externalReference);
      
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
      
      console.log('✅ [createCheckoutProPayment] Preference created:', {
        id: preference.id,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point
      });
      
      // Store in checkout_payments collection (UNIFIED COLLECTION)
      const paymentRecord = {
        preference_id: preference.id,
        external_reference: externalReference,
        title: title,
        quantity: quantity,
        unit_price: unit_price,
        total_amount: unit_price * quantity,
        customer_email: email,
        status: 'pending',
        payment_status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        metadata: preferenceData.metadata,
        cart_products: cart_products,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
        
        // 🔥 CRITICAL ADDITIONS - These lines are missing!
        user_uid: paymentData.user_uid || null,
        firestore_user_id: paymentData.firestore_user_id || null,
        
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
        
        shipping_address: paymentData.shipping_address ? {
            ...paymentData.shipping_address,
            neighborhood: paymentData.shipping_address.neighborhood || paymentData.neighborhood || '',
            phone: paymentData.phone || paymentData.buyer_info?.phone || '',
        } : null,
        shipping_method: paymentData.shipping_method || 'PAC',
        shipping_cost: paymentData.shipping_cost || 0,
        shipping_delivery_method_id: paymentData.shipping_delivery_method_id || null,
        shipping_speed: paymentData.shipping_speed || 'pac',
      };
      
      await db.collection('checkout_payments').doc(externalReference).set(paymentRecord);
      
      console.log('📝 [createCheckoutProPayment] Payment record saved:', externalReference, 'with', cart_products.length, 'products');
      
      return res.json({
        success: true,
        preference_id: preference.id,
        external_reference: externalReference,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
        checkout_url: preference.init_point,
        cart_summary: {
          product_count: cart_products.length,
          total_amount: unit_price
        }
      });
      
    } catch (error) {
      console.error('❌ [createCheckoutProPayment] Error:', error);
      
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
      
      console.log('🔍 [getOrderDetails] Getting order details for:', order_id);
      
      const paymentDoc = await db.collection('checkout_payments').doc(order_id).get();
      
      if (!paymentDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }
      
      const paymentData = paymentDoc.data();
      
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
        events: events
      });
      
    } catch (error) {
      console.error('❌ [getOrderDetails] Error:', error);
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
      const { customer_email, limit = 20 } = req.query;

      if (!customer_email) {
        return res.status(400).json({ success: false, error: 'Customer email is required' });
      }

      console.log('🔍 [getUserOrders] Getting orders for customer:', customer_email);

      let query = db.collection('checkout_payments')
        .where('customer_email', '==', customer_email)
        .limit(parseInt(limit));

      try {
        query = query.orderBy('created_at', 'desc');
      } catch (e) {
        console.warn('⚠️ [getUserOrders] Could not order by created_at:', e.message);
      }

      const snapshot = await query.get();

      const orders = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        orders.push({
          id: doc.id,
          external_reference: data.external_reference,
          total_amount: data.total_amount,
          product_count: data.cart_products?.length || 0,
          status: data.payment_status || data.status,
          order_status: data.dimona_order_status || data.order_status,
          created_at: data.created_at?.toDate?.() || data.created_at,
          products: (data.cart_products || []).map(p => ({
            product_id: p.product_id || null,
            title: p.title || p.productTitle || null,
            designer_name: p.designer_name || p.designerName || null,
            price: p.pricing?.total_price || p.price || 0,
          })),
        });
      });

      orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      return res.json({ success: true, count: orders.length, orders });

    } catch (error) {
      console.error('❌ [getUserOrders] Error:', error);
      return res.status(500).json({ success: false, error: error.message });
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

      // VERIFICAÇÃO ESTRITA: 
      // Só é aprovado se o Mercado Pago confirmou 'approved' explicitamente.
      const isApproved = d.payment_status === 'approved' || d.status === 'approved';

      // Verificação de falha explícita
      const isFailed = ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(d.payment_status || d.status);

      let resolvedStatus = 'pending';
      if (isApproved) {
        resolvedStatus = 'approved';
      } else if (isFailed) {
        resolvedStatus = 'rejected';
      }

      console.log(`📊 [getPaymentStatus] Verificação Realizada: ${external_reference} -> ${resolvedStatus}`);

      return res.json({
        success: true,
        payment: {
          external_reference: paymentDoc.id,
          status: resolvedStatus, // Retorna 'pending' se não houver aprovação real
          order_status: d.order_status || 'pending',
          total_amount: d.total_amount,
          customer_email: d.customer_email
        }
      });

    } catch (error) {
      console.error('❌ [getPaymentStatus] Error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
});
// =============================================
// PAYMENT WEBHOOK HANDLER
// =============================================

exports.paymentWebhook = functions.runWith({ timeoutSeconds: 300, memory: '1GB' }).https.onRequest((req, res) => {
    // Log the FULL webhook immediately for debugging
    console.log('🔔🔔🔔 [paymentWebhook] WEBHOOK RECEIVED 🔔🔔🔔');
    console.log('[paymentWebhook] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[paymentWebhook] Body:', JSON.stringify(req.body, null, 2));
    
    // Respond immediately to prevent Mercado Pago retries
    res.status(200).send('OK');
    console.log('[paymentWebhook] Sent immediate 200 OK response');

    // Process webhook asynchronously
    (async () => {
        try {
            const { type, data, action, topic, id } = req.body;
            
            // Handle different webhook structures from Mercado Pago
            // Old format: { topic: "merchant_order", resource: "https://api.mercadolibre.com/merchant_orders/123" }
            // New format: { type: "payment", data: { id: "123" } }
            let webhookType = type || topic || action;
            let webhookId = null;

            // Extract ID — try all known locations
            if (data?.id) {
                webhookId = String(data.id);
            } else if (id) {
                webhookId = String(id);
            } else if (req.body.resource) {
                // Old-style resource URL: extract numeric ID from the path
                const match = req.body.resource.match(/\/(\d+)(?:\?.*)?$/);
                if (match) webhookId = match[1];
            } else if (req.body.id) {
                webhookId = String(req.body.id);
            }
            if (req.body.data && req.body.data.id) {
                webhookId = String(req.body.data.id);
            } else if (req.body.id) {
                webhookId = String(req.body.id);
            } else if (req.query.id) { // Às vezes vem na query string
                webhookId = String(req.query.id);
            }

            // Normalise type
            if (webhookType === 'merchant_order' || topic === 'merchant_order') {
                webhookType = 'merchant_order';
            }

            console.log(`📥 [paymentWebhook] Processing — type: ${webhookType}, id: ${webhookId}`);

            if (!webhookType || !webhookId) {
                // merchant_order notifications from MP sometimes arrive without an extractable ID
                // (e.g. test pings). They are not errors — just ignore them silently.
                if (webhookType === 'merchant_order') {
                    console.log('ℹ️ [paymentWebhook] Ignoring merchant_order notification without extractable ID (test ping or unsupported format)');
                    return;
                }

                console.error('❌ [paymentWebhook] Invalid webhook payload — missing type or id:', {
                    hasType: !!webhookType,
                    hasId: !!webhookId,
                    bodyKeys: Object.keys(req.body),
                });

                await db.collection('webhook_failures').add({
                    body: req.body,
                    error: 'Missing type or id',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                return;
            }
            
            // Handle different webhook types
            if (webhookType === 'payment' || webhookType === 'payment.create' || 
                webhookType === 'payment.updated' || webhookType === 'payment.update' ||
                webhookType === 'payment.refund' || webhookType === 'payment.cancel') {
                await handlePaymentEvent(webhookId);
            } 
            else if (webhookType === 'merchant_order' || webhookType === 'order') {
                await handleMerchantOrderEvent(webhookId);
            } 
            else {
                console.log(`⚠️ [paymentWebhook] Unhandled webhook type: ${webhookType}`);
                // Try as payment anyway if it looks like a payment ID
                if (webhookId.length > 5 && /^\d+$/.test(webhookId)) {
                    console.log(`[paymentWebhook] Attempting to handle as payment ID: ${webhookId}`);
                    await handlePaymentEvent(webhookId);
                }
            }
        } catch (error) {
            console.error('❌ [paymentWebhook] Processing error:', error.message);
            await db.collection('webhook_failures').add({
                body: req.body,
                error: error.message,
                stack: error.stack,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    })();
});

// =============================================
// HANDLE PAYMENT EVENT
// =============================================

async function handlePaymentEvent(paymentId) {
  console.log(`💰 [handlePaymentEvent] Starting for payment ID: ${paymentId}`);
  
  try {
    console.log(`[handlePaymentEvent] Fetching payment ${paymentId} from Mercado Pago API...`);
    
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
    
    console.log(`💳 [handlePaymentEvent] Payment ${paymentId} data:`, {
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: externalReference,
      transaction_amount: payment.transaction_amount
    });
    
    if (!externalReference) {
      console.error(`❌ [handlePaymentEvent] No external reference found in payment ${paymentId}`);
      
      // Try to find order by payment_id
      const orderByPaymentId = await findOrderByPaymentId(paymentId);
      if (orderByPaymentId) {
        console.log(`✅ [handlePaymentEvent] Found order by payment_id: ${orderByPaymentId}`);
        await processPaymentUpdate(orderByPaymentId, payment);
      } else {
        console.log(`ℹ️ [handlePaymentEvent] Creating orphan payment record for ${paymentId}`);
        await createOrphanPaymentRecord(payment);
      }
      return;
    }
    
    console.log(`💳 [handlePaymentEvent] Payment ${paymentId} status: ${payment.status} for order: ${externalReference}`);
    
    await processPaymentUpdate(externalReference, payment);
    
    if (payment.order && payment.order.id) {
      await handleMerchantOrderEvent(payment.order.id);
    }
    
  } catch (error) {
    console.error(`❌ [handlePaymentEvent] Error for payment ${paymentId}:`, error);
    
    await db.collection('webhook_failures').add({
      payment_id: paymentId,
      error: error.message,
      stack: error.stack,
      response_data: error.response?.data,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

// =============================================
// PROCESS PAYMENT UPDATE
// =============================================

async function processPaymentUpdate(externalReference, payment) {
  console.log(`🔄 [processPaymentUpdate] Processing update for ${externalReference} with status: ${payment.status}`);
  
  try {
    const paymentRef = db.collection('checkout_payments').doc(externalReference);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      console.log(`ℹ️ [processPaymentUpdate] Payment record not found for ${externalReference}, creating...`);
      await paymentRef.set({
        external_reference: externalReference,
        payment_id: payment.id,
        status: payment.status,
        payment_status: payment.status,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        from_webhook: true,
        payment_data: payment
      });
    } else {
      const existing = paymentDoc.data();
      console.log(`[processPaymentUpdate] Existing order status:`, {
        dimona_order_id: existing.dimona_order_id,
        dimona_queued: existing.dimona_queued,
        dimona_failed: existing.dimona_failed,
        payment_status: existing.payment_status
      });
      
      // Prevent duplicate processing for approved payments
      if (payment.status === 'approved') {
        if (existing.dimona_order_id) {
          console.log(`⏭️ [processPaymentUpdate] Order ${externalReference} already has Dimona order: ${existing.dimona_order_id}, skipping`);
          return;
        }
        if (existing.dimona_queued && !existing.dimona_failed) {
          console.log(`⏭️ [processPaymentUpdate] Order ${externalReference} fulfillment already in progress, skipping`);
          return;
        }
      }
    }
    
    // Handle different payment statuses
    if (payment.status === 'approved') {
      console.log(`🎉🎉🎉 [processPaymentUpdate] PAYMENT APPROVED for ${externalReference} 🎉🎉🎉`);
      
      await paymentRef.set({
        status: payment.status,
        payment_status: payment.status,
        payment_id: payment.id,
        payment_method: payment.payment_method_id,
        payment_type: payment.payment_type_id,
        date_approved: payment.date_approved || new Date().toISOString(),
        order_status: 'processing',
        approved_at: admin.firestore.FieldValue.serverTimestamp(),
        paid_amount: payment.transaction_amount,
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
      
      await recordOrderEvent(externalReference, 'payment_approved', {
        payment_id: payment.id,
        amount: payment.transaction_amount,
        method: payment.payment_method_id,
        status_detail: payment.status_detail
      });
      
      console.log(`🚀 [processPaymentUpdate] Calling processPurchasedProducts for ${externalReference}`);
      
      try {
        const result = await processPurchasedProducts(externalReference, payment);
        console.log(`✅ [processPaymentUpdate] processPurchasedProducts completed:`, result);
      } catch (procError) {
        console.error(`❌ [processPaymentUpdate] processPurchasedProducts failed:`, procError.message);
        // Re-throw to be caught by outer try-catch
        throw procError;
      }
      
      await queueNotification('customer_payment_success', {
        external_reference: externalReference,
        email: payment.payer?.email,
        amount: payment.transaction_amount
      });
    }
    
    else if (payment.status === 'rejected') {
      console.log(`❌ [processPaymentUpdate] PAYMENT REJECTED for ${externalReference}`);
      
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
        payment_status: payment.status,
        payment_id: payment.id,
        order_status: 'payment_failed',
        failure_reason: payment.status_detail,
        failure_message: rejectionMessage,
        failure_time: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_rejected', {
        payment_id: payment.id,
        reason: payment.status_detail,
        message: rejectionMessage
      });
      
      await updatePaymentAnalytics('rejected', payment);
    }
    
    else if (payment.status === 'pending') {
      console.log(`⏳ [processPaymentUpdate] PAYMENT PENDING for ${externalReference}`);
      
      await paymentRef.update({
        status: payment.status,
        payment_status: payment.status,
        payment_id: payment.id,
        order_status: 'awaiting_payment',
        pending_reason: payment.status_detail,
        pending_since: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await recordOrderEvent(externalReference, 'payment_pending', {
        payment_id: payment.id,
        method: payment.payment_method_id
      });
    }
    
    else {
      console.log(`ℹ️ [processPaymentUpdate] Unknown payment status: ${payment.status} for ${externalReference}`);
      
      await paymentRef.update({
        status: payment.status,
        payment_status: payment.status,
        payment_id: payment.id,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
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
    
    console.log(`✅ [processPaymentUpdate] Payment update processed for ${externalReference}`);
    
  } catch (error) {
    console.error(`❌ [processPaymentUpdate] Error for ${externalReference}:`, error);
    throw error;
  }
}

// =============================================
// HANDLE MERCHANT ORDER
// =============================================

async function handleMerchantOrderEvent(merchantOrderId) {
  try {
    console.log(`📦 [handleMerchantOrderEvent] Handling merchant order: ${merchantOrderId}`);
    
    const mpResponse = await axios.get(
      `${MP_API_BASE}/merchant_orders/${merchantOrderId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );
    
    const order = mpResponse.data;
    console.log(`📊 [handleMerchantOrderEvent] Merchant order ${merchantOrderId}:`, {
      status: order.order_status,
      total_amount: order.total_amount,
      paid_amount: order.paid_amount,
      payments: order.payments?.length || 0,
      external_reference: order.external_reference
    });
    
    const externalReference = order.external_reference;
    if (!externalReference) {
      console.log('ℹ️ [handleMerchantOrderEvent] No external reference in merchant order');
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
    
    await recordOrderEvent(externalReference, 'merchant_order_updated', {
      merchant_order_id: merchantOrderId,
      order_status: order.order_status,
      payment_count: order.payments?.length
    });
    
    console.log(`✅ [handleMerchantOrderEvent] Merchant order ${merchantOrderId} processed`);
    
  } catch (error) {
    console.error(`❌ [handleMerchantOrderEvent] Error for ${merchantOrderId}:`, error);
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
    console.error('❌ [findOrderByPaymentId] Error:', error);
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
    console.log(`📝 [createOrphanPaymentRecord] Orphan payment recorded: ${orphanId}`);
  } catch (error) {
    console.error('❌ [createOrphanPaymentRecord] Error:', error);
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
    console.log(`📝 [recordOrderEvent] Recorded ${eventType} for ${orderId}`);
  } catch (error) {
    console.error('❌ [recordOrderEvent] Error:', error);
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
    console.log(`📧 [queueNotification] Queued ${type} for ${data.email}`);
  } catch (error) {
    console.error('❌ [queueNotification] Error:', error);
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
    console.error('❌ [updatePaymentAnalytics] Error:', error);
  }
}

// =============================================
// SAVE USER CART (multi-device sync)
// =============================================

exports.saveUserCart = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

      const { uid, cart } = req.body;
      if (!uid) return res.status(400).json({ success: false, error: 'uid required' });
      if (!Array.isArray(cart)) return res.status(400).json({ success: false, error: 'cart must be an array' });

      const cartRef = db.collection('users').doc(uid).collection('cart');
      const existing = await cartRef.get();
      const batch = db.batch();

      existing.forEach(doc => batch.delete(doc.ref));

      cart.forEach((item, i) => {
        const key = String(item.product_id || item.firestoreProductId || item.cartItemId || i);
        batch.set(cartRef.doc(key), {
          ...item,
          _synced_at: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      await batch.commit();
      console.log(`🛒 saveUserCart: uid=${uid}, items=${cart.length}`);
      return res.json({ success: true, count: cart.length });
    } catch (err) {
      console.error('❌ saveUserCart error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
});

// =============================================
// GET USER CART (multi-device sync)
// =============================================

exports.getUserCart = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

      const { uid } = req.query;
      if (!uid) return res.status(400).json({ success: false, error: 'uid required' });

      const cartSnap = await db.collection('users').doc(uid).collection('cart').get();
      const cart = cartSnap.docs.map(doc => {
        const data = doc.data();
        if (data._synced_at && data._synced_at.toDate) {
          data._synced_at = data._synced_at.toDate().toISOString();
        }
        return data;
      });

      const purchasedSnap = await db.collection('users').doc(uid).collection('purchasedItems').get();
      const purchasedItems = purchasedSnap.docs.map(doc => {
        const data = doc.data();
        if (data._synced_at && data._synced_at.toDate) {
          data._synced_at = data._synced_at.toDate().toISOString();
        }
        return data;
      });

      console.log(`🛒 getUserCart: uid=${uid}, cart=${cart.length}, purchased=${purchasedItems.length}`);
      return res.json({ success: true, cart, purchasedItems });
    } catch (err) {
      console.error('❌ getUserCart error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
});

// =============================================
// GET USER ORDERS V2
// =============================================
exports.getUserOrdersV2 = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      
      const token = authHeader.split('Bearer ')[1];
      
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const requestingUid = decodedToken.uid;
        
        const { uid, limit = 50 } = req.query;
        
        if (!uid) {
          return res.status(400).json({ success: false, error: 'User ID required' });
        }
        
        const userDoc = await db.collection('users').doc(uid).get();
        
        if (!userDoc.exists) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const userData = userDoc.data();
        const firebaseUID = userData.firebaseUID;
        
        if (firebaseUID !== requestingUid) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        
        const customer_email = userData.email;
        
        if (!customer_email) {
          return res.status(400).json({ success: false, error: 'User has no email' });
        }
        
        const snapshot = await db.collection('checkout_payments')
          .where('customer_email', '==', customer_email)
          .limit(parseInt(limit))
          .get();
        
        const orders = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            status: data.payment_status || data.status || null,
            order_status: data.dimona_order_status || data.order_status || 'processing',
            created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
            products: (data.cart_products || []).map(p => ({
              product_id: p.product_id || null,
              title: p.title || p.productTitle || null,
              designer_name: p.designer_name || p.designerName || null,
              price: p.pricing?.total_price || p.price || 0,
            })),
          };
        });
        
        orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        
        return res.json({ success: true, count: orders.length, orders });
        
      } catch (authError) {
        console.error('❌ [getUserOrdersV2] Auth verification failed:', authError);
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }
      
    } catch (error) {
      console.error('❌ [getUserOrdersV2] Error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
});
// =============================================
// MOVE ORDER TO PURCHASED (Frontend-triggered)
// =============================================

exports.moveOrderToPurchased = functions.https.onRequest((req, res) => {
  // 🔥 CONFIGURAÇÃO CORS MANUAL - MAIS CONFIÁVEL
  const allowedOrigins = [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '3600');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  // Aceitar apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }
  
  (async () => {
    try {
      const { order_id, external_reference } = req.body;
      const orderId = order_id || external_reference;
      
      console.log('🚚 [moveOrderToPurchased] Chamado para:', orderId);
      console.log('🌐 Origin:', origin);
      
      if (!orderId) {
        return res.status(400).json({
          success: false,
          error: 'order_id or external_reference is required'
        });
      }
      
      const orderRef = db.collection('checkout_payments').doc(orderId);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }
      
      const order = orderDoc.data();
      const paymentStatus = order.payment_status || order.status;
      
      if (paymentStatus !== 'approved') {
        return res.status(400).json({
          success: false,
          error: `Payment not approved. Current status: ${paymentStatus}`,
          current_status: paymentStatus
        });
      }
      
      if (order.cart_cleaned_up === true) {
        return res.json({
          success: true,
          already_processed: true,
          message: 'Products already moved to purchased'
        });
      }
      
      const paymentData = {
        id: order.payment_id || 'manual_' + Date.now(),
        status: order.payment_status,
        transaction_amount: order.total_amount,
        payment_method_id: order.payment_method,
        status_detail: 'approved_by_manual_check'
      };
      
      const result = await processPurchasedProducts(orderId, paymentData);

      // 🔥 If user was not found or cart_products was empty, surface the error
      if (!result.success) {
        return res.status(422).json({
          success: false,
          error: result.error || 'Processing failed',
          detail: result.tried || null
        });
      }
      
      return res.json({
        success: true,
        moved: result.movedCount || 0,
        removed: result.removedCount || 0,
        already_processed: result.alreadyProcessed || false,
        message: 'Products moved to purchased successfully'
      });
      
    } catch (error) {
      console.error('❌ [moveOrderToPurchased] Error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  })();
});
// =============================================
// INITIALIZATION LOG
// =============================================

console.log('🔄 ENHANCED WEBHOOK HANDLER INITIALIZED');
console.log('📋 Handling all Mercado Pago webhook types');
console.log(`💰 Mercado Pago: ${MP_CONFIGURED ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
if (MP_CONFIGURED) {
  console.log(`🔑 Environment: ${MP_ACCESS_TOKEN.startsWith('TEST-') ? 'SANDBOX' : 'PRODUCTION'}`);
}
console.log('📡 Webhook URL: https://us-central1-kauara1.cloudfunctions.net/paymentWebhook');
console.log('🗃️ Using collection: checkout_payments');