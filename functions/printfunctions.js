const functions = require('firebase-functions');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const cors = require('cors')({
  origin: [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
    'http://localhost:5000',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// === Config ===
const PRINTFUL_API_BASE = 'https://api.printful.com';
const PRINTFUL_API_KEY = functions.config().printful.apikey;
const PRINTFUL_STORE_ID = functions.config().printful.storeid || '';

// Standard headers for all Printful API requests
// X-PF-Store-Id is REQUIRED for account-level tokens
const PRINTFUL_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
  'X-PF-Store-Id': PRINTFUL_STORE_ID,
};

const bucket = admin.storage().bucket();

const ALLOWED_PRODUCT_IDS = [
  // 1,    // Poster
  71,   // Classic T-Shirt
  146,  // Unisex Hoodie
  509,  // Men's Fitted straight cut
  12,  // soft style Tshirt
  145,  // Sweatshirt
  162, // triblend
  

];
// =============================================
// PRINTFUL FULFILLMENT COSTS (BRL)
// Source: Printful Dashboard — update if Printful changes pricing
// Last updated: February 2026
// =============================================

const FULFILLMENT_COSTS = {
  // Product 1 — Poster
  1: {
    default: 24.00,  // posters don't vary by size much, one price
  },

  // Product 71 — Bella+Canvas Classic T-Shirt
  71: {
    'XS':  79.95,
    'S':   79.95,
    'M':   79.95,
    'L':   79.95,
    'XL':  79.95,  // ← confirmed from your real order
    '2XL': 79.95,
    '3XL': 81.45,  // estimate — verify in dashboard
    '4XL': 97.95,
    '5XL': 108.95,  // estimate — verify in dashboard
  },

  // Product 146 — Unisex Hoodie
  146: {
    'S':   122.95,  // fill these in from dashboard
    'M':   122.95,
    'L':   122.95,
    'XL':  122.95,
    '2XL': 133.95,
    '3XL': 144.95,
    '4XL': 155.95,
    '5XL': 166.95,
  },
  509: {
    'P':   53.95,
    'M':   53.95,
    'G':   53.95,
    'GG':  53.95,
    'XGG': 53.95,
  },
}
// TEST MODE - Always use sandbox/test environment
const TEST_MODE = false;
console.log(`🧪 PRINTFUL TEST MODE: ${TEST_MODE ? 'ENABLED' : 'DISABLED'}`);

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
let cachedProducts = null;
let cacheTimestamp = 0;

// === Helpers ===
async function fetchWithConcurrency(urls, concurrency = 10) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: PRINTFUL_HEADERS,
          });
          return res.ok ? await res.json() : null;
        } catch (err) {
          console.error(`Error fetching ${url}:`, err);
          return null;
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

async function getFlatLayTemplates(productId) {
  const BASE_URL = 'https://kauara1.web.app/images/flatlays';
  return [
    {
      url: `${BASE_URL}/${productId}.png`,
      variant_ids: [],
      type: 'flat_lay',
      title: 'Product Flat Lay',
    },
  ];
}

function fallbackImage(title = 'No Image') {
  return `https://kauara1.web.app/images/placeholder.png?text=${encodeURIComponent(
    title
  )}`;
}

// Helper function to upload base64 images
async function uploadBase64Image(base64Data, folder = 'uploads') {
  try {
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 string');
    
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const extension = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `${folder}/${uniqueId}.${extension}`;
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: { 
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: uniqueId
        }
      },
      public: true,
    });

    return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Helper to extract pricing from new structure
function extractPricingFromNewStructure(variant, pricingSummary) {
  if (variant.pricing) {
    console.log('Using new pricing structure for variant:', variant.id);
    return {
      product_price: Number(variant.pricing.product_price) || 0,
      artist_cut: Number(variant.pricing.artist_cut) || 0,
      platform_fee: Number(variant.pricing.platform_fee) || 0,
      total_price: Number(variant.pricing.total_price) || 0,
      currency: variant.pricing.currency || 'BRL'
    };
  }
  
  console.log('Using fallback pricing for variant:', variant.id);
  const basePrice = variant.price || variant.basePrice || variant.retail_price || 0;
  const artistCut = pricingSummary?.artist_cut || variant.artist_cut || 0;
  const platformFeePercentage = pricingSummary?.platform_fee_percentage || 0.05;
  
  const productPrice = Number(basePrice);
  const platformFee = productPrice * platformFeePercentage;
  const totalPrice = productPrice + artistCut + platformFee;
  
  return {
    product_price: productPrice,
    artist_cut: artistCut,
    platform_fee: platformFee,
    total_price: totalPrice,
    currency: pricingSummary?.currency || 'BRL'
  };
}

// =============================================
// SHIPPING METHOD MAP — Brazilian → Printful
// =============================================

const SHIPPING_METHOD_MAP = {
  'PAC':     'STANDARD',
  'SEDEX':   'EXPRESS',
  'SEDEX10': 'EXPRESS',
  'SEDEX12': 'EXPRESS',
  'CARTA':   'STANDARD',
};

// =============================================
// CREATE PRINTFUL ORDER
// =============================================

// Format CPF (000.000.000-00) or CNPJ (00.000.000/0000-00) for Printful
function formatTaxNumber(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    // CPF
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  } else if (digits.length === 14) {
    // CNPJ
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return raw; // Return as-is if unrecognized
}

async function createPrintfulOrder(orderId) {
  console.log(`📦 Creating Printful order for: ${orderId}`);

  // Fetch order
  const orderRef = db.collection('checkout_payments').doc(orderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) throw new Error(`Order ${orderId} not found`);
  const order = orderDoc.data();

  // Validate required fields
  if (!order.shipping_address) throw new Error('Shipping address is required');
  if (!order.customer_email)   throw new Error('Customer email is required');

  const shipping = order.shipping_address;

  const recipientName = order.buyer_info?.name ||
    `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim();
  if (!recipientName) throw new Error('Recipient name is required');

  // Validate address fields
  if (!shipping.street_name)   throw new Error('Shipping street name is required');
  if (!shipping.street_number) throw new Error('Shipping street number is required');
  if (!shipping.city_name)     throw new Error('Shipping city is required');
  if (!shipping.state_name)    throw new Error('Shipping state is required');
  if (!shipping.zip_code)      throw new Error('Shipping zip code is required');

  // Fetch purchased products
  const purchasedSnapshot = await db.collection('purchased_products')
    .where('order_id', '==', orderId)
    .get();
  if (purchasedSnapshot.empty) throw new Error(`No purchased products found for order ${orderId}`);

  // Build items array — resolve sync_variant_id from printfulSyncVariants on the product doc
  const items = await Promise.all(purchasedSnapshot.docs.map(async doc => {
    const product = doc.data();

    // The catalog variant ID stored at purchase time (e.g. 4020)
    const catalogVariantId = parseInt(product.printful_variant_id || product.variant_id);
    if (!catalogVariantId || isNaN(catalogVariantId)) {
      throw new Error(`Missing or invalid catalog variant_id for product ${product.product_id}. Got: ${product.printful_variant_id || product.variant_id}`);
    }

    // Look up the Printful sync variant ID from the product document in Firestore.
    // printfulSyncVariants is saved by saveProduct after a successful Printful product creation.
    // Each entry has: { id: <sync_variant_id>, variant_id: <catalog_variant_id>, ... }
    let syncVariantId = null;

    if (product.product_id) {
      const productDoc = await db.collection(product.firestoreCollection || 'products').doc(product.product_id).get();
      if (productDoc.exists) {
        const productData = productDoc.data();
        const syncVariants = productData.printfulSyncVariants || [];

        if (syncVariants.length === 0) {
          throw new Error(
            `Product ${product.product_id} has no printfulSyncVariants in Firestore. ` +
            `This means saveProduct never successfully registered it with Printful. ` +
            `Re-run saveProduct for this product with a valid Printful API key first.`
          );
        }

        // Match the catalog variant ID to find the corresponding sync variant ID
        const matched = syncVariants.find(sv => parseInt(sv.variant_id) === catalogVariantId);
        if (matched) {
          syncVariantId = parseInt(matched.id);
          console.log(`✅ Resolved sync_variant_id ${syncVariantId} for catalog variant ${catalogVariantId}`);
        } else {
          // Fallback: if only one sync variant exists and we can't match, use it
          if (syncVariants.length === 1) {
            syncVariantId = parseInt(syncVariants[0].id);
            console.warn(`⚠️ Could not match catalog variant ${catalogVariantId} — using only available sync variant ${syncVariantId}`);
          } else {
            throw new Error(
              `Could not find sync variant for catalog variant_id ${catalogVariantId} ` +
              `in product ${product.product_id}. Available catalog variant_ids: ` +
              syncVariants.map(sv => sv.variant_id).join(', ')
            );
          }
        }
      } else {
        throw new Error(`Product document ${product.product_id} not found in Firestore`);
      }
    } else {
      throw new Error(`purchased_product ${doc.id} is missing product_id — cannot resolve sync variant`);
    }

    if (!syncVariantId || isNaN(syncVariantId)) {
      throw new Error(`Failed to resolve a valid sync_variant_id for product ${product.product_id}`);
    }

    const retailPrice = parseFloat(product.retail_price);
    if (!retailPrice || retailPrice <= 0) {
      throw new Error(`Invalid retail price for product ${product.product_id}: ${product.retail_price}`);
    }

    return {
      sync_variant_id: syncVariantId,
      quantity: 1,
      retail_price: retailPrice.toFixed(2)
    };
  }));

  // Map shipping method
  const shippingMethod = SHIPPING_METHOD_MAP[order.shipping_method];
  if (!shippingMethod) {
    throw new Error(`Unknown shipping method: "${order.shipping_method}". Add it to SHIPPING_METHOD_MAP.`);
  }

  // Build Printful payload
  const printfulPayload = {
    recipient: {
      name:         recipientName,
      email:        order.customer_email,
      phone:        order.buyer_info?.phone || '',
      address1:     `${shipping.street_name}, ${shipping.street_number}`,
      address2:     shipping.complement || '',
      city:         shipping.city_name,
      state_code:   shipping.state_name,
      country_code: 'BR',
      zip:          shipping.zip_code,
      tax_number:   formatTaxNumber(order.buyer_info?.cpf || ''),  // Required for Brazil (CPF/CNPJ)
    },
    items,
    shipping: shippingMethod,
    retail_costs: {
      currency: 'BRL',
      subtotal: order.total_amount?.toFixed(2) || '0',
      shipping: order.shipping_cost?.toFixed(2)  || '0',
      tax: '0'
    },
    external_id: orderId,
  };

  // Create draft order
  const createRes = await fetch(`${PRINTFUL_API_BASE}/orders`, {
    method: 'POST',
    headers: PRINTFUL_HEADERS,
    body: JSON.stringify(printfulPayload)
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    if (createRes.status === 403) {
      throw new Error(
        `Printful create failed (403 Forbidden): Your API token is missing the "orders" scope. ` +
        `Go to Printful Dashboard → Settings → API → edit your token and enable the Orders permission. ` +
        `Printful error: ${createData.error?.message || 'Forbidden'}`
      );
    }
    throw new Error(`Printful create failed (${createRes.status}): ${createData.error?.message || createRes.statusText}`);
  }

  const printfulOrderId = createData.result.id;
  console.log(`✅ Printful draft created: ${printfulOrderId}`);

  // Confirm order → moves to fulfillment queue
  const confirmRes = await fetch(`${PRINTFUL_API_BASE}/orders/${printfulOrderId}/confirm`, {
    method: 'POST',
    headers: PRINTFUL_HEADERS
  });

  const confirmData = await confirmRes.json();
  if (!confirmRes.ok) {
    throw new Error(`Printful confirm failed (${confirmRes.status}): ${confirmData.error?.message || confirmRes.statusText}`);
  }

  const printfulStatus = confirmData.result.status;
  console.log(`🚀 Printful order confirmed: ${printfulOrderId} (status: ${printfulStatus})`);

  // Persist to Firestore
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Use set+merge instead of update to avoid NOT_FOUND if the doc was just created
  await orderRef.set({
    printful_order_id:         printfulOrderId,
    printful_order_status:     printfulStatus,
    printful_order_data:       confirmData.result,
    printful_order_created_at: now,
    updated_at:                now,
  }, { merge: true });

  const batch = db.batch();
  purchasedSnapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      printful_order_id:     printfulOrderId,
      printful_order_status: printfulStatus,
      order_status:          'printful_processing',
      shipping_status:       'processing',
      updated_at:            now,
    });
  });
  await batch.commit();

  return confirmData.result;
}

// =============================================
// CHECK PRINTFUL ORDER STATUS
// =============================================

async function checkPrintfulOrderStatus(printfulOrderId, orderId) {
  try {
    console.log(`🔍 Checking Printful order status: ${printfulOrderId} (TEST MODE: ${TEST_MODE})`);
    
    const response = await fetch(`${PRINTFUL_API_BASE}/orders/${printfulOrderId}`, {
      headers: PRINTFUL_HEADERS
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Failed to get order status: ${data.error?.message}`);
    }
    
    const status = data.result?.status;
    console.log(`📊 Printful order ${printfulOrderId} status: ${status}`);
    
    // Update Firestore
    const orderRef = db.collection('checkout_payments').doc(orderId);
    await orderRef.update({
      printful_order_status: status,
      printful_order_last_check: admin.firestore.FieldValue.serverTimestamp(),
      printful_order_details: data.result,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update purchased products
    const purchasedSnapshot = await db.collection('purchased_products')
      .where('order_id', '==', orderId)
      .get();
    
    const batch = db.batch();
    purchasedSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        printful_order_status: status,
        shipping_status: mapPrintfulStatusToShipping(status),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    
    // If tracking info available, update
    if (data.result?.tracking) {
      await updateOrderTracking(orderId, data.result.tracking);
    }
    
    return data.result;
    
  } catch (error) {
    console.error(`❌ Error checking Printful order ${printfulOrderId}:`, error);
    return null;
  }
}

function mapPrintfulStatusToShipping(printfulStatus) {
  const statusMap = {
    'draft': 'processing',
    'pending': 'processing',
    'failed': 'failed',
    'cancelled': 'cancelled',
    'onhold': 'processing',
    'inprocess': 'processing',
    'partial': 'processing',
    'fulfilled': 'shipped'
  };
  
  return statusMap[printfulStatus] || 'processing';
}

async function updateOrderTracking(orderId, trackingInfo) {
  try {
    console.log(`📦 Updating tracking for order ${orderId}:`, trackingInfo);
    
    const purchasedSnapshot = await db.collection('purchased_products')
      .where('order_id', '==', orderId)
      .get();
    
    const batch = db.batch();
    purchasedSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        tracking_code: trackingInfo.tracking_number,
        tracking_url: trackingInfo.tracking_url,
        carrier: trackingInfo.carrier,
        shipping_status: 'shipped',
        estimated_delivery: trackingInfo.estimated_delivery ? 
          admin.firestore.Timestamp.fromDate(new Date(trackingInfo.estimated_delivery)) : null,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    
    console.log(`✅ Tracking updated for order ${orderId}`);
    
  } catch (error) {
    console.error('Error updating tracking:', error);
  }
}

// =============================================
// RETRY FAILED PRINTFUL ORDERS (SCHEDULED)
// =============================================

const retryFailedPrintfulOrders = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async (context) => {
    console.log('🔄 Running retry for failed Printful orders...');
    
    const now = admin.firestore.Timestamp.now();
    
    const snapshot = await db.collection('printful_retry_queue')
      .where('attempts', '<', 5)
      .where('next_retry', '<=', now)
      .get();
    
    if (snapshot.empty) {
      console.log('✅ No orders to retry');
      return null;
    }
    
    console.log(`📦 Found ${snapshot.size} orders to retry`);
    
    const batch = db.batch();
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const attempts = data.attempts + 1;
      
      try {
        console.log(`🔄 Retry attempt ${attempts} for order: ${data.order_id}`);
        
        const orderDoc = await db.collection('checkout_payments').doc(data.order_id).get();
        
        if (!orderDoc.exists) {
          batch.delete(doc.ref);
          continue;
        }
        
        const printfulOrder = await createPrintfulOrder(data.order_id, data.payment_data);
        
        console.log(`✅ Printful order created on retry: ${printfulOrder.id}`);
        batch.delete(doc.ref);
        
        await db.collection('printful_retry_success').add({
          order_id: data.order_id,
          attempts: attempts,
          printful_order_id: printfulOrder.id,
          test_mode: TEST_MODE,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
      } catch (error) {
        console.error(`❌ Retry failed for order ${data.order_id}:`, error.message);
        
        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + Math.pow(2, attempts) * 5);
        
        batch.update(doc.ref, {
          attempts: attempts,
          last_error: error.message,
          last_attempt: admin.firestore.FieldValue.serverTimestamp(),
          next_retry: admin.firestore.Timestamp.fromDate(nextRetry)
        });
      }
    }
    
    await batch.commit();
    console.log('✅ Retry processing complete');
    
    return null;
  });

// =============================================
// GET PRINTFUL ORDER STATUS (HTTP ENDPOINT)
// =============================================

const getPrintfulOrderStatus = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { order_id } = req.query;
      
      if (!order_id) {
        return res.status(400).json({
          success: false,
          error: 'Order ID is required'
        });
      }
      
      console.log(`🔍 Getting Printful order status for Kauara order: ${order_id}`);
      
      const orderDoc = await db.collection('checkout_payments').doc(order_id).get();
      
      if (!orderDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }
      
      const orderData = orderDoc.data();
      const printfulOrderId = orderData.printful_order_id;
      
      if (!printfulOrderId) {
        return res.json({
          success: true,
          has_printful_order: false,
          message: 'No Printful order created yet',
          order: {
            id: order_id,
            status: orderData.status,
            order_status: orderData.order_status
          }
        });
      }
      
      const response = await fetch(`${PRINTFUL_API_BASE}/orders/${printfulOrderId}`, {
        headers: PRINTFUL_HEADERS
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Printful API error: ${data.error?.message}`);
      }
      
      return res.json({
        success: true,
        order_id: order_id,
        printful_order_id: printfulOrderId,
        printful_status: data.result?.status,
        printful_data: data.result,
        local_status: orderData.order_status,
        test_mode: TEST_MODE
      });
      
    } catch (error) {
      console.error('❌ Error getting Printful order:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// MANUALLY CREATE PRINTFUL ORDER (FOR TESTING)
// =============================================

const createPrintfulOrderManually = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    try {
      const { order_id } = req.body;
      
      if (!order_id) {
        return res.status(400).json({
          success: false,
          error: 'order_id is required'
        });
      }
      
      console.log(`🛠️ Manually creating Printful order for: ${order_id}`);
      
      const printfulOrder = await createPrintfulOrder(order_id, { manual: true });
      
      return res.json({
        success: true,
        message: 'Printful order created successfully',
        printful_order: printfulOrder,
        test_mode: TEST_MODE
      });
      
    } catch (error) {
      console.error('❌ Manual Printful order creation failed:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// GET ALL PRODUCTS
// =============================================

const getAllProducts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      let allProducts = [];
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let requestCount = 0;
      let totalFetched = 0;

      const fetchWithRetry = async (url, retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const response = await fetch(url, {
              headers: PRINTFUL_HEADERS,
            });
            
            if (response.ok) return response;
            
            if (response.status === 429) {
              console.log(`Rate limited, waiting 2 seconds before retry ${i + 1}`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
            
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            
          } catch (err) {
            if (i === retries - 1) throw err;
            console.log(`Retry ${i + 1} after error:`, err.message);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      };

      while (hasMore && requestCount < 30) {
        requestCount++;
        
        try {
          let url = `${PRINTFUL_API_BASE}/products?limit=${limit}&offset=${offset}`;
          
          console.log(`Request #${requestCount}: ${url}`);
          
          const catalogResponse = await fetchWithRetry(url);
          const catalogData = await catalogResponse.json();
          
          let products = [];
          let pagination = {};
          
          if (Array.isArray(catalogData.result)) {
            products = catalogData.result;
          } else if (catalogData.result && Array.isArray(catalogData.result.data)) {
            products = catalogData.result.data;
            pagination = catalogData.result.pagination || {};
          } else if (Array.isArray(catalogData)) {
            products = catalogData;
          } else {
            console.log('Unexpected response structure:', JSON.stringify(catalogData, null, 2));
            throw new Error('Unexpected API response structure');
          }
          
          console.log(`Batch ${requestCount}: ${products.length} products, offset: ${offset}`);
          
          const processedProducts = products.map(product => {
            let variantsArray = [];
            
            if (Array.isArray(product.variants)) {
              variantsArray = product.variants;
            } else if (product.variants && typeof product.variants === 'object') {
              variantsArray = Object.values(product.variants);
            }
            
            return {
              id: product.id,
              name: product.name || product.title || product.model || `Product ${product.id}`,
              variants: variantsArray.map(v => ({
                variant_id: v.id || v.variant_id,
                name: v.name || `${product.name} - ${v.size} ${v.color}`.trim(),
                size: v.size,
                color: v.color
              }))
            };
          });
          
          allProducts = allProducts.concat(processedProducts);
          totalFetched += products.length;
          
          if (products.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (err) {
          console.error(`Failed request #${requestCount}:`, err);
          break;
        }
      }

      console.log(`Total products fetched: ${totalFetched}`);
      
      res.status(200).json({
        success: true,
        count: allProducts.length,
        total_requests: requestCount,
        products: allProducts,
        debug: {
          total_fetched: totalFetched,
          last_offset: offset
        }
      });
      
    } catch (err) {
      console.error('Error fetching all products:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch all products',
        message: err.message,
      });
    }
  });
});

// =============================================
// GET PRODUCT PRICING
// =============================================

const getProductPricing = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');

    let productId, variantId, size;

    if (req.method === 'GET') {
      productId = req.query.productId;
      variantId = req.query.variantId;
      size      = req.query.size;
    } else if (req.method === 'POST') {
      productId = req.body.productId;
      variantId = req.body.variantId;
      size      = req.body.size;
    } else {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!productId) {
      return res.status(400).json({ success: false, error: 'productId is required' });
    }

    const productCosts = FULFILLMENT_COSTS[parseInt(productId)];

    if (!productCosts) {
      return res.status(404).json({
        success: false,
        error: `No pricing data for product ${productId}. Add it to FULFILLMENT_COSTS.`
      });
    }

    // Look up by size first, fall back to 'default' if product doesn't vary by size
    const fulfillmentCost = (size && productCosts[size])
      ? productCosts[size]
      : productCosts['default'] || Math.max(...Object.values(productCosts));

    // If size was requested but not found, warn but don't fail
    if (size && !productCosts[size] && !productCosts['default']) {
      console.warn(`⚠️ Size "${size}" not found for product ${productId}, using highest cost as safety fallback`);
    }

    console.log(`✅ Fulfillment cost for product ${productId} size ${size || 'default'}: R$${fulfillmentCost}`);

    return res.json({
      success: true,
      basePrice:   fulfillmentCost,
      productId,
      variantId:   variantId || null,
      size:        size || null,
      source:      'hardcoded_fulfillment_costs',
      currency:    'BRL'
    });
  });
});

// =============================================
// GET PRODUCTS (ALLOWED PRODUCTS ONLY)
// =============================================

const getProducts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.query.resetCache === 'true') {
      console.log('🚨 MANUAL CACHE RESET TRIGGERED');
      cachedProducts = null;
      cacheTimestamp = 0;
    }

    try {
      const now = Date.now();
      console.log('=== getProducts STARTED ===');
      console.log('Timestamp:', new Date().toISOString());
      console.log('Cache exists:', !!cachedProducts);
      console.log('Cache age (ms):', cachedProducts ? now - cacheTimestamp : 'N/A');
      console.log('API Key present:', !!PRINTFUL_API_KEY);

      if (cachedProducts && now - cacheTimestamp < CACHE_DURATION) {
        console.log('📦 Returning CACHED data');
        console.log('Cached products count:', cachedProducts.length);
        return res.status(200).json({
          success: true,
          count: cachedProducts.length,
          products: cachedProducts,
          cached: true,
          debug: { cacheHit: true }
        });
      }

      console.log('🔄 Cache expired or missing, fetching fresh data...');

      const urls = ALLOWED_PRODUCT_IDS.map(
        (id) => `${PRINTFUL_API_BASE}/products/${id}`
      );

      console.log('📡 URLs to fetch:', urls);

      console.log('🧪 Testing single API call...');
      const testUrl = urls[0];
      console.log('Test URL:', testUrl);

      try {
        const testResponse = await fetch(testUrl, {
          headers: {
            'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        console.log('Test Response Status:', testResponse.status);

        if (!testResponse.ok) {
          const errorText = await testResponse.text();
          console.error('❌ API Error Response:', errorText);
          throw new Error(`API returned ${testResponse.status}: ${testResponse.statusText}`);
        }

        const testData = await testResponse.json();
        console.log('✅ Test API call SUCCESS!');
        console.log('Test data keys:', Object.keys(testData));
        console.log('Has result property:', !!testData.result);

        if (testData.result) {
          console.log('Result has product?', !!testData.result.product);
          console.log('Result has variants?', !!testData.result.variants);
          console.log('Product ID from test:', testData.result.product?.id);
        }
      } catch (testError) {
        console.error('❌ Single API test FAILED:', testError.message);
      }

      console.log('🚀 Starting concurrent fetch of all URLs...');
      const detailResults = await fetchWithConcurrency(urls, 3);

      console.log('📊 Fetch results summary:');
      console.log('Total results:', detailResults.length);

      let validCount = 0;
      detailResults.forEach((result, index) => {
        const isValid = result && result.result;
        console.log(`Result ${index} (ID ${ALLOWED_PRODUCT_IDS[index]}):`, {
          isValid,
          status: result ? 'OK' : 'NULL',
          hasResult: !!result?.result,
          productId: result?.result?.product?.id
        });
        if (isValid) validCount++;
      });

      console.log(`Valid results: ${validCount}/${urls.length}`);

      if (validCount === 0) {
        console.error('❌ ALL API CALLS FAILED!');
        cachedProducts = [];
        cacheTimestamp = now;

        return res.status(500).json({
          success: false,
          error: 'All Printful API calls failed',
          debug: { validCount: 0 }
        });
      }

      const productsWithDetails = await Promise.all(
        detailResults
          .filter((d) => d?.result)
          .map(async (details, index) => {
            try {
              const { product, variants: variantData } = details.result;
              const uniqueColors = [...new Set((variantData || []).map(v => v.color))];
              console.log(`🎨 Product ${product.id} unique colors (${uniqueColors.length}):`, uniqueColors);
              console.log(`Processing product ${product.id}: ${product.title}`);

              const [flatLayTemplates, brazilVariantIds] = await Promise.all([
                getFlatLayTemplates(product.id),
                getBrazilAvailableVariantIds(product.id, variantData),
              ]);

              console.log(
                `🇧🇷 Brazil-available variant IDs for product ${product.id}:`,
                brazilVariantIds ? [...brazilVariantIds] : 'unavailable (fail open)'
              );

              const variants = (variantData || [])
                .filter((variant) => {
                  if (brazilVariantIds === null) return true; // fail open if availability API errored
                  const available = brazilVariantIds.has(variant.id);
                  if (!available) {
                    console.log(`🚫 Filtered out variant ${variant.id} (${variant.name}) — not available in BR`);
                  }
                  return available;
                })
                .map((variant) => {
                  const template = flatLayTemplates.find((t) =>
                    t.variant_ids.includes(variant.id)
                  );
                  const fallback = flatLayTemplates[0] || null;

                  return {
                    id: variant.id,
                    product_id: variant.product_id,
                    name: variant.name,
                    size: variant.size,
                    color: variant.color,
                    color_code: variant.color_code,
                    retail_price: variant.retail_price,
                    price: variant.retail_price,
                    preview_urls: variant.files
                      ?.filter((f) => f.type === 'preview' && f.preview_url)
                      .map((f) => f.preview_url) || [],
                    flat_lay_url: template?.url || fallback?.url || null,
                  };
                });

              console.log(
                `✅ Product ${product.id}: ${variants.length}/${(variantData || []).length} variants kept after BR filter`
              );

              const mockups = Array.from(
                new Set(
                  variants
                    .flatMap((variant) =>
                      (variant.preview_urls || [])
                    )
                )
              ).slice(0, 5);

              return {
                id: product.id,
                type: product.type,
                type_name: product.type_name,
                title: product.title,
                brand: product.brand,
                model: product.model,
                image: product.image || fallbackImage(product.title),
                variant_count: variants.length,
                variants,
                mockups,
                flat_lay_templates: flatLayTemplates.map((t) => t.url),
              };
            } catch (err) {
              console.error(`Error processing product ${index}:`, err);
              return null;
            }
          })
      );

      const validProducts = productsWithDetails.filter(p => p !== null);
      console.log(`✅ Successfully processed: ${validProducts.length} products`);

      cachedProducts = validProducts;
      cacheTimestamp = now;

      console.log('=== getProducts COMPLETED ===');

      res.status(200).json({
        success: true,
        count: validProducts.length,
        products: validProducts,
        cached: false,
        debug: {
          timestamp: new Date().toISOString(),
          cacheUpdated: true,
          validProductsCount: validProducts.length
        }
      });

    } catch (err) {
      console.error('❌ FATAL ERROR in getProducts:', err);
      console.error('Stack trace:', err.stack);

      cachedProducts = [];
      cacheTimestamp = Date.now();

      res.status(500).json({
        success: false,
        error: 'Failed to fetch products',
        message: err.message,
        cached: false
      });
    }
  });
});

// ─── Helper: fetch Brazil-available variant IDs for a product ───────────────
async function getBrazilAvailableVariantIds(productId, variantData) {
  try {
    // Get one representative variant ID per unique color
    const colorMap = new Map();
    (variantData || []).forEach(v => {
      if (!colorMap.has(v.color)) {
        colorMap.set(v.color, v.id);
      }
    });

    console.log(`🎨 Product ${productId}: checking ${colorMap.size} unique colors for BR availability`);

    // Fetch availability for one variant per color (with concurrency limit)
    const colorEntries = [...colorMap.entries()];
    const results = await fetchWithConcurrency(
      colorEntries.map(([color, variantId]) => 
        `${PRINTFUL_API_BASE}/products/variant/${variantId}`
      ),
      5
    );

    // Build set of BR-available colors
    const brAvailableColors = new Set();
    results.forEach((data, index) => {
      const [color] = colorEntries[index];
      const regions = data?.result?.variant?.availability_regions || {};
      if ('BR' in regions) {
        brAvailableColors.add(color);
      } else {
        console.log(`🚫 Color "${color}" not available in BR`);
      }
    });

    console.log(`🇧🇷 Product ${productId}: ${brAvailableColors.size}/${colorMap.size} colors available in BR`);

    // Return Set of variant IDs whose color is BR-available
    return new Set(
      (variantData || [])
        .filter(v => brAvailableColors.has(v.color))
        .map(v => v.id)
    );

  } catch (err) {
    console.warn(`⚠️ BR availability check failed for product ${productId}:`, err.message, '— failing open');
    return null;
  }
}

// =============================================
// PROXY IMAGE
// =============================================

const proxyImage = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const imageUrl = req.query.url;
      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: 'Missing image URL',
        });
      }

      const isFlatLay = imageUrl.includes('kauara1.web.app/images/flatlays');
      const imageResponse = await fetch(imageUrl, {
        headers: isFlatLay ? {} : PRINTFUL_HEADERS,
      });

      if (!imageResponse.ok) {
        return res.redirect(fallbackImage('Image not available'));
      }

      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Type', imageResponse.headers.get('content-type'));
      imageResponse.body.pipe(res);
    } catch (err) {
      console.error('Error proxying image:', err);
      res.redirect(fallbackImage('Error loading image'));
    }
  });
});

// =============================================
// SAVE PRODUCT
// =============================================

const saveProduct = functions.runWith({
  timeoutSeconds: 120,
  memory: '1GB'
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      console.log('=== SAVE PRODUCT REQUEST STARTED ===');
      console.log('Request body keys:', Object.keys(req.body));
      
      const { 
        name, 
        productTitle,
        productId,
        designerUserId,
        firebaseUserId,
        userEmail,
        side,
        thumbnail,
        designImage,
        designScale = 1.0,
        placement,
        firestoreCollection = 'products',
        pricing_summary = {},
        variants = [],
        availableSizes = [],
        availableColors = [],
        totalVariants = 0
      } = req.body;

      console.log('Saving to collection:', firestoreCollection);
      console.log('Designer User ID:', designerUserId);
      console.log('Firebase User ID:', firebaseUserId);
      console.log('Saving for side:', side);
      console.log('Product ID:', productId);
      console.log('Variants count:', variants.length);
      console.log('Pricing summary present:', !!pricing_summary);

      if (!designerUserId) {
        return res.status(401).json({ success: false, error: 'User authentication required' });
      }

      if (!side || (side !== 'front' && side !== 'back')) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid side parameter. Must be "front" or "back"' 
        });
      }

      const requiredFields = ['name', 'thumbnail', 'designImage'];
      const missing = requiredFields.filter(f => !req.body[f]);
      if (missing.length > 0) {
        return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
      }

      console.log('Uploading images...');
      const thumbnailUrl = await uploadBase64Image(thumbnail, 'thumbnails');
      const designUrl = await uploadBase64Image(designImage, 'designs');
      console.log('Images uploaded:', { thumbnailUrl, designUrl });

      console.log('Processing variants with new structure...');
      const safeVariants = variants.map(v => {
        try {
          const variantId = v.id || v.variant_id;
          
          if (!variantId) {
            throw new Error(`Variant ID is required. Variant: ${JSON.stringify(v)}`);
          }
          
          const printfulVariantId = parseInt(variantId);
          if (isNaN(printfulVariantId)) {
            throw new Error(`Invalid Printful variant ID: ${variantId}. Must be a number.`);
          }
          
          const pricing = extractPricingFromNewStructure(v, pricing_summary);
          
          console.log(`Processing variant ${variantId}:`, {
            printfulVariantId,
            size: v.size,
            color: v.color,
            product_price: pricing.product_price,
            artist_cut: pricing.artist_cut,
            platform_fee: pricing.platform_fee,
            total_price: pricing.total_price
          });
          
          if (pricing.total_price <= 0) {
            throw new Error(`Total price must be greater than zero for variant ${variantId}`);
          }
          
          const cleanVariant = {
            id: variantId.toString(),
            variant_id: printfulVariantId,
            
            name: v.name || `Variant ${variantId}`,
            
            size: v.size || 'One Size',
            color: v.color || 'N/A',
            color_code: v.color_code || v.colorCode || '#cccccc',
            
            retail_price: pricing.total_price.toFixed(2),
            
            pricing: {
              product_price: pricing.product_price,
              artist_cut: pricing.artist_cut,
              platform_fee: pricing.platform_fee,
              total_price: pricing.total_price,
              currency: pricing.currency || 'BRL'
            },
            
            ...(v.external_id && { external_id: v.external_id }),
            ...(v.sku && { sku: v.sku }),
            
            availability_status: v.availability_status || 'active'
          };
          
          return cleanVariant;
          
        } catch (variantError) {
          console.error(`Error processing variant:`, variantError);
          throw variantError;
        }
      });

      console.log('✅ Processed variants for Firestore:', safeVariants.length);

      const productData = {
        id: null,
        designerUserId: designerUserId ?? null,
        firebaseUserId: firebaseUserId ?? null,
        userEmail: userEmail ?? null,
        
        name: name ?? null,
        productTitle: productTitle ?? null,
        productId: productId ? parseInt(productId) : null,
        side: side ?? null,
        
        variants: safeVariants,
        
        thumbnailUrl,
        designUrl,
        
        placement: placement ?? null,
        designScale: Number(designScale) || 1.0,
        
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        
        status: 'creating',
        printfulStatus: 'pending',
        
        availableSizes: availableSizes.length > 0 ? availableSizes : [...new Set(safeVariants.map(v => v.size))],
        availableColors: availableColors.length > 0 ? availableColors : [...new Set(safeVariants.map(v => v.color))],
        totalVariants: totalVariants > 0 ? totalVariants : safeVariants.length,
        
        pricing_summary: {
          product_price_range: pricing_summary.product_price_range || { min: 0, max: 0 },
          artist_cut: pricing_summary.artist_cut || 0,
          platform_fee_percentage: pricing_summary.platform_fee_percentage || 0.05,
          total_price_range: pricing_summary.total_price_range || { min: 0, max: 0 },
          currency: pricing_summary.currency || 'BRL'
        },
        
        _debug: {
          timestamp: new Date().toISOString(),
          apiVersion: '2.1',
          variantCount: safeVariants.length,
          hasPricingSummary: !!pricing_summary,
          side: side
        }
      };

      if (firestoreCollection === 'products-client') {
        productData.artistUserId = req.body.artistUserId || null;
        productData.originalArtId = req.body.originalArtId || null;
        productData.artPrice = req.body.artPrice || 0;
      }

      let productDocRef;
      try {
        console.log('Saving to Firestore collection:', firestoreCollection);
        productDocRef = await admin.firestore().collection(firestoreCollection).add(productData);
        
        await productDocRef.update({
          id: productDocRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Saved product to Firestore with ID:', productDocRef.id);
        console.log('✅ Side saved:', side);
        console.log('✅ Total variants saved:', safeVariants.length);
        console.log('✅ Pricing summary saved:', !!productData.pricing_summary);
      } catch (firestoreError) {
        console.error('❌ Firestore .add() error:', firestoreError);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to save product to Firestore', 
          details: firestoreError.message,
          stack: firestoreError.stack 
        });
      }

      try {
        console.log('=== CREATING PRINTFUL PRODUCT ===');
        
        const syncVariants = safeVariants.map(v => {
          const retailPrice = parseFloat(v.retail_price);
          
          if (isNaN(retailPrice) || retailPrice <= 0) {
            throw new Error(`Invalid price for variant ${v.id}: ${v.retail_price}`);
          }
          
          const variantIdForPrintful = v.variant_id;
          
          if (!variantIdForPrintful || isNaN(variantIdForPrintful)) {
            throw new Error(`Invalid Printful variant ID for variant ${v.id}: ${variantIdForPrintful}`);
          }
          
          console.log(`Creating Printful variant ${variantIdForPrintful} with price: ${retailPrice}`);
          
          const fileConfig = {
            url: designUrl,
            type: side === 'back' ? 'back' : 'front',
            position: "center",
            ...(placement && {
              area_width: placement.area_width || 6000,
              area_height: placement.area_height || 7200,
              width: placement.width || 6000,
              height: placement.height || 7200,
              top: placement.top || 0,
              left: placement.left || 0
            })
          };
          
          return {
            variant_id: variantIdForPrintful,
            retail_price: retailPrice.toFixed(2),
            files: [fileConfig]
          };
        });

        console.log('Creating Printful product for side:', side);
        console.log('Number of Printful variants:', syncVariants.length);
        console.log('First Printful variant:', JSON.stringify(syncVariants[0], null, 2));

        const payload = {
          sync_product: { 
            name: `${productTitle || name} - ${side}`,
            thumbnail: thumbnailUrl,
            external_id: `kauara_${productDocRef.id}_${side}`
          },
          sync_variants: syncVariants
        };

        if (TEST_MODE) {
          payload.sync_product.name = `[TEST] ${payload.sync_product.name}`;
          console.log('🧪 TEST MODE: Adding [TEST] prefix to product name');
        }

        console.log('Printful API Payload:', JSON.stringify(payload, null, 2));
        
        console.log('Making Printful API request to:', `${PRINTFUL_API_BASE}/store/products`);

        // Check if a product with this external_id already exists in Printful.
        // This happens when saveProduct is called multiple times for the same product doc.
        const externalId = `kauara_${productDocRef.id}_${side}`;
        let existingSyncProductId = null;
        try {
          const checkRes = await fetch(
            `${PRINTFUL_API_BASE}/store/products?external_id=${encodeURIComponent(externalId)}`,
            { headers: PRINTFUL_HEADERS }
          );
          const checkData = await checkRes.json();
          const existing = (checkData.result || []).find(p => p.external_id === externalId);
          if (existing) {
            existingSyncProductId = existing.id;
            console.log(`⚠️ Printful product already exists for external_id ${externalId}: sync_product_id=${existingSyncProductId}. Will fetch and reuse.`);
          }
        } catch (checkErr) {
          console.warn('Could not check for existing Printful product:', checkErr.message);
        }

        let data;
        let response;

        if (existingSyncProductId) {
          // Product already exists — fetch its full details instead of re-creating
          response = await fetch(`${PRINTFUL_API_BASE}/store/products/${existingSyncProductId}`, {
            headers: PRINTFUL_HEADERS
          });
          const rawData = await response.json();
          // Normalize to same shape as a POST response
          data = {
            result: {
              sync_product: rawData.result?.sync_product || null,
              sync_variants: rawData.result?.sync_variants || []
            }
          };
          console.log('✅ Reused existing Printful product:', existingSyncProductId);
        } else {
          response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
            method: 'POST',
            headers: PRINTFUL_HEADERS,
            body: JSON.stringify(payload),
          });
          data = await response.json();
        }

        console.log('Printful API Response:', JSON.stringify(data, null, 2));

        if (response && !response.ok) {
          console.error('❌ Printful API error response:', {
            status: response.status,
            statusText: response.statusText,
            data: data
          });
          
          await productDocRef.update({
            status: 'failed',
            printfulStatus: 'error',
            printfulError: data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          return res.status(400).json({ 
            success: false, 
            error: 'Failed to create product on Printful',
            details: data,
            message: data.error?.message || 'Printful API error',
            printfulCode: data.code
          });
        }

        // Printful returns null sync_product when external_id already exists.
        // In that case, fetch the existing product by external_id as fallback.
        let savedSyncProduct = data.result?.sync_product;
        let savedSyncVariants = data.result?.sync_variants || [];

        if (!savedSyncProduct || !savedSyncProduct.id || savedSyncVariants.length === 0) {
          console.warn('⚠️ Printful returned null/empty sync_product — fetching existing product by external_id...');
          const externalId = `kauara_${productDocRef.id}_${side}`;
          try {
            const existingRes = await fetch(
              `${PRINTFUL_API_BASE}/store/products?external_id=${encodeURIComponent(externalId)}`,
              { headers: PRINTFUL_HEADERS }
            );
            const existingData = await existingRes.json();
            console.log('Existing product lookup response:', JSON.stringify(existingData, null, 2));

            // Find the matching product in the list
            const match = (existingData.result || []).find(p => p.external_id === externalId);
            if (match) {
              console.log(`✅ Found existing Printful product: ${match.id}`);
              // Fetch full product details including sync_variants
              const detailRes = await fetch(
                `${PRINTFUL_API_BASE}/store/products/${match.id}`,
                { headers: PRINTFUL_HEADERS }
              );
              const detailData = await detailRes.json();
              savedSyncProduct = detailData.result?.sync_product || match;
              savedSyncVariants = detailData.result?.sync_variants || [];
              console.log(`✅ Fetched ${savedSyncVariants.length} sync variants from existing product`);
            } else {
              console.error('❌ Could not find existing Printful product by external_id:', externalId);
            }
          } catch (lookupErr) {
            console.error('❌ Failed to look up existing Printful product:', lookupErr.message);
          }
        }

        if (!savedSyncProduct || !savedSyncProduct.id || savedSyncVariants.length === 0) {
          throw new Error(
            `Printful did not return sync_product/sync_variants and fallback lookup failed. ` +
            `The product may not have been created correctly in Printful.`
          );
        }

        const printfulUpdate = {
          printfulSyncProductId: savedSyncProduct.id,
          printfulSyncProduct: savedSyncProduct,
          printfulSyncVariants: savedSyncVariants,
          status: 'created',
          printfulStatus: 'success',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        Object.keys(printfulUpdate).forEach(key => {
          if (printfulUpdate[key] === undefined) {
            delete printfulUpdate[key];
          }
        });

        await productDocRef.update(printfulUpdate);

        console.log('✅ Successfully created Printful sync product!');
        console.log('Printful Sync Product ID:', savedSyncProduct.id);
        console.log('Number of sync variants:', savedSyncVariants.length);

        res.json({ 
          success: true, 
          product: data.result,
          message: `Product created successfully for ${side} side`,
          firestoreProductId: productDocRef.id,
          printfulSyncProductId: data.result?.sync_product?.id || null,
          side: side,
          variantsCount: safeVariants.length,
          collection: firestoreCollection,
          pricing_summary_saved: true,
          test_mode: TEST_MODE
        });

      } catch (printfulError) {
        console.error('❌ Printful creation error:', printfulError);
        console.error('Error stack:', printfulError.stack);
        
        await productDocRef.update({
          status: 'failed',
          printfulStatus: 'error',
          printfulError: printfulError?.message ?? String(printfulError),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(500).json({ 
          success: false, 
          error: 'Failed to create product on Printful',
          message: printfulError?.message ?? String(printfulError),
          stack: printfulError?.stack
        });
      }

    } catch (err) {
      console.error('❌ Overall error in saveProduct:', err);
      console.error('Error stack:', err.stack);
      
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        message: err.message,
        stack: err.stack
      });
    }
  });
});

// =============================================
// SAVE ART
// =============================================

const saveArt = functions.runWith({
  timeoutSeconds: 120,
  memory: '2GB'
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const { artData, filename, artName, userId, price, platformFee, totalPrice, bgColor } = req.body;

      if (!artData || !filename || !artName || !userId || price === undefined) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields' 
        });
      }

      const matches = artData.match(/^data:(.+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid image data' 
        });
      }

      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      
      const filePath = `arts/${filename}.png`;
      const file = bucket.file(filePath);

      await file.save(buffer, {
        metadata: { 
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: filename,
            userId: userId,
            artName: artName
          }
        },
        public: true,
      });

      const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

      await admin.firestore().collection('arts').add({
        name: artName,
        filename: filename,
        storagePath: filePath,
        downloadURL: downloadURL,
        userId: userId,
        price: parseFloat(price) || 0,
        platformFee: parseFloat(platformFee) || 0,
        totalPrice: parseFloat(totalPrice) || 0,
        bgColor: bgColor || '#ffffff',
        currency: 'BRL',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        size: buffer.length,
        type: mimeType,
        resolution: 'high'
      });

      res.json({ 
        success: true, 
        message: 'Art saved successfully',
        downloadURL: downloadURL
      });

    } catch (err) {
      console.error('saveArt error:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        message: err.message 
      });
    }
  });
});

// =============================================
// PRINTFUL WEBHOOK HANDLER — FIXED
// =============================================
//
// Deployed URL:
//   https://us-central1-kauara1.cloudfunctions.net/printfulWebhook
//
// Register this URL at:
//   Printful Dashboard → Settings → Webhooks
//
// Events handled:
//   package_shipped, package_returned,
//   order_created, order_updated, order_failed,
//   order_canceled, order_put_hold, order_remove_hold,
//   product_synced, product_deleted, stock_updated

const printfulWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const event = req.body;
    const eventType = event.type;
    const eventData = event.data;

    console.log(`📡 Printful webhook received: ${eventType}`, JSON.stringify(event, null, 2));

    if (!eventType || !eventData) {
      console.error('❌ Invalid Printful webhook payload');
      return res.status(400).send('Invalid payload');
    }

    // Always acknowledge immediately so Printful does not retry
    res.status(200).send('OK');

    // ── Helper: resolve our internal order_id from a Printful order object ──
    async function resolveOrderId(printfulOrderObj) {
      if (printfulOrderObj?.external_id) {
        return printfulOrderObj.external_id;
      }
      if (printfulOrderObj?.id) {
        const snap = await db.collection('checkout_payments')
          .where('printful_order_id', '==', printfulOrderObj.id)
          .limit(1)
          .get();
        if (!snap.empty) return snap.docs[0].id;
      }
      return null;
    }

    // ── Helper: get user_id from order (needed for notifications) ──
    async function resolveUserId(orderId) {
      try {
        const orderDoc = await db.collection('checkout_payments').doc(orderId).get();
        return orderDoc.exists ? (orderDoc.data().user_id || orderDoc.data().buyer_id || null) : null;
      } catch {
        return null;
      }
    }

    // ── Map Printful event/status → user-facing delivery_status ──
    function mapEventToDeliveryStatus(type, printfulStatus) {
      const map = {
        'order_created':     'processing',
        'order_updated':     'processing',
        'order_put_hold':    'on_hold',
        'order_remove_hold': 'processing',
        'order_failed':      'failed',
        'order_canceled':    'cancelled',
        'package_shipped':   'shipped',
        'package_returned':  'returned',
      };
      if (map[type]) return map[type];
      const statusMap = {
        'draft':     'processing',
        'pending':   'processing',
        'onhold':    'on_hold',
        'inprocess': 'in_production',
        'partial':   'in_production',
        'fulfilled': 'shipped',
        'cancelled': 'cancelled',
        'failed':    'failed',
      };
      return statusMap[printfulStatus] || 'processing';
    }

    // ── Update Firestore for all purchased_products of an order ──
    async function updatePurchasedProducts(orderId, fields) {
      const snap = await db.collection('purchased_products')
        .where('order_id', '==', orderId)
        .get();
      if (snap.empty) {
        console.warn(`⚠️ No purchased_products found for order ${orderId}`);
        return;
      }
      const batch = db.batch();
      snap.forEach(doc => batch.update(doc.ref, {
        ...fields,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }));
      await batch.commit();
      console.log(`✅ Updated ${snap.size} purchased_products for order ${orderId}`);
    }

    // ── Record to order_events ──
    async function recordEvent(orderId, type, data) {
      await db.collection('order_events').add({
        order_id: orderId,
        event_type: `printful_${type}`,
        event_data: data,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // ══════════════════════════════════════════
    // Handle each event type
    // ══════════════════════════════════════════

    switch (eventType) {

      // ── Order created / updated ──
      case 'order_created':
      case 'order_updated': {
        const pOrder = eventData.order || eventData;
        const orderId = await resolveOrderId(pOrder);
        if (!orderId) { console.warn('⚠️ Could not resolve order_id for event', eventType); break; }

        const deliveryStatus = mapEventToDeliveryStatus(eventType, pOrder.status);
        const printfulStatus = pOrder.status;

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: printfulStatus,
          printful_order_data: pOrder,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: printfulStatus,
          delivery_status: deliveryStatus,
          order_status: eventType === 'order_created' ? 'printful_received' : 'printful_processing',
          shipping_status: 'processing'
        });

        await recordEvent(orderId, eventType, { printful_status: printfulStatus });
        break;
      }

      // ── Order put on hold ──
      case 'order_put_hold': {
        const pOrder = eventData.order || eventData;
        const orderId = await resolveOrderId(pOrder);
        if (!orderId) break;

        const reason = eventData.reason || pOrder.hold_reason || 'Pedido em espera';

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'onhold',
          printful_hold_reason: reason,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'onhold',
          delivery_status: 'on_hold',
          hold_reason: reason,
          shipping_status: 'on_hold'
        });

        await recordEvent(orderId, eventType, { reason });
        break;
      }

      // ── Hold removed ──
      case 'order_remove_hold': {
        const pOrder = eventData.order || eventData;
        const orderId = await resolveOrderId(pOrder);
        if (!orderId) break;

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'inprocess',
          printful_hold_reason: null,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'inprocess',
          delivery_status: 'in_production',
          hold_reason: null,
          shipping_status: 'processing'
        });

        await recordEvent(orderId, eventType, {});
        break;
      }

      // ── Package shipped ──
      // FIX: added estimated_delivery fallback chain, added user_id to notification_queue
      case 'package_shipped': {
        const shipment = eventData.shipment || eventData;
        const pOrder   = eventData.order || {};
        const orderId  = await resolveOrderId(pOrder);
        if (!orderId) { console.warn('⚠️ Could not resolve order_id for package_shipped'); break; }

        // FIX: fallback chain for estimated delivery date
        const estimatedDeliveryRaw =
          shipment.estimated_delivery_max ||
          shipment.estimated_delivery_min ||
          shipment.estimated_delivery ||
          null;

        const tracking = {
          tracking_number:    shipment.tracking_number || null,
          tracking_url:       shipment.tracking_url    || null,
          carrier:            shipment.carrier         || null,
          service:            shipment.service         || null,
          ship_date:          shipment.ship_date        || new Date().toISOString(),
          estimated_delivery: estimatedDeliveryRaw
        };

        console.log(`🚚 Order ${orderId} shipped via ${tracking.carrier}. Tracking: ${tracking.tracking_number}`);

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'fulfilled',
          delivery_status: 'shipped',         // FIX: also set on parent order
          shipment_info: tracking,
          shipped_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'fulfilled',
          delivery_status: 'shipped',
          shipping_status: 'shipped',
          order_status: 'shipped',
          tracking_code: tracking.tracking_number,
          tracking_url: tracking.tracking_url,
          carrier: tracking.carrier,
          ship_date: tracking.ship_date,
          estimated_delivery: estimatedDeliveryRaw
            ? admin.firestore.Timestamp.fromDate(new Date(estimatedDeliveryRaw))
            : null,
          shipped_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await recordEvent(orderId, eventType, tracking);

        // FIX: include user_id so notification sender knows who to email
        const userId = await resolveUserId(orderId);
        await db.collection('notification_queue').add({
          type: 'order_shipped',
          order_id: orderId,
          user_id: userId,             // ← ADDED
          tracking: tracking,
          status: 'pending',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          retry_count: 0
        });

        console.log(`📬 Notification queued for order ${orderId} (user: ${userId})`);
        break;
      }

      // ── Package returned ──
      case 'package_returned': {
        const shipment = eventData.shipment || eventData;
        const pOrder   = eventData.order   || {};
        const orderId  = await resolveOrderId(pOrder);
        if (!orderId) break;

        const reason = shipment.reason || eventData.reason || 'Encomenda devolvida';

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'returned',
          delivery_status: 'returned',        // FIX: also set on parent order
          return_reason: reason,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'returned',
          delivery_status: 'returned',
          shipping_status: 'returned',
          order_status: 'returned',
          return_reason: reason
        });

        await recordEvent(orderId, eventType, { reason });
        break;
      }

      // ── Order failed ──
      case 'order_failed': {
        const pOrder  = eventData.order || eventData;
        const orderId = await resolveOrderId(pOrder);
        if (!orderId) break;

        const reason = eventData.reason || pOrder.error || 'Falha no pedido Printful';

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'failed',
          delivery_status: 'failed',          // FIX: also set on parent order
          printful_failure_reason: reason,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'failed',
          delivery_status: 'failed',
          shipping_status: 'failed',
          order_status: 'printful_failed',
          failure_reason: reason
        });

        await db.collection('printful_retry_queue').add({
          order_id: orderId,
          payment_data: {},
          attempts: 0,
          last_error: reason,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          next_retry: admin.firestore.FieldValue.serverTimestamp()
        });

        await recordEvent(orderId, eventType, { reason });

        await db.collection('admin_alerts').add({
          type: 'printful_order_failed',
          order_id: orderId,
          reason: reason,
          severity: 'high',
          status: 'new',
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        break;
      }

      // ── Order cancelled ──
      case 'order_canceled': {
        const pOrder  = eventData.order || eventData;
        const orderId = await resolveOrderId(pOrder);
        if (!orderId) break;

        await db.collection('checkout_payments').doc(orderId).update({
          printful_order_status: 'cancelled',
          delivery_status: 'cancelled',       // FIX: also set on parent order
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await updatePurchasedProducts(orderId, {
          printful_order_status: 'cancelled',
          delivery_status: 'cancelled',
          shipping_status: 'cancelled',
          order_status: 'cancelled'
        });

        await recordEvent(orderId, eventType, {});
        break;
      }

      // ── Product / stock events ──
      case 'product_synced':
      case 'product_deleted':
      case 'stock_updated': {
        console.log(`ℹ️ Printful product/stock event: ${eventType}`, eventData);
        await db.collection('printful_product_events').add({
          type: eventType,
          data: eventData,
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        break;
      }

      default:
        console.log(`⚠️ Unhandled Printful event type: ${eventType}`);
    }

  } catch (error) {
    console.error('❌ Fatal error in Printful webhook:', error);
  }
});

// =============================================
// GET PRINTFUL STORE PRODUCTS
// =============================================

const getPrintfulStoreProducts = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
        headers: {
          'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
        },
      });
      
      const data = await response.json();
      
      res.json({
        success: response.ok,
        data: data,
        endpoint: '/store/products',
        method: 'GET'
      });
      
    } catch (error) {
      console.error('Error fetching store products:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// CALCULATE CART SHIPPING
// =============================================

const calculateCartShipping = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    try {
      console.log('📦 CALCULATE CART SHIPPING STARTED');
      
      const SHIPPING_RATES = {
        71: { base: 24.69, additional: 13.75, name: 'T-Shirt' },
        146: { base: 32.99, additional: 16.50, name: 'Hoodie' },
        263: { base: 61.99, additional: 35.00, name: 'Caneca' },
        679: { base: 61.99, additional: 35.00, name: 'Caneca' },
        1: { base: 24.69, additional: 13.75, name: 'Poster' },
        682: { base: 32.99, additional: 16.50, name: 'Caderno' },
        474: { base: 32.99, additional: 16.50, name: 'Caderno Espiral' },
        358: { base: 13.75, additional: 6.90, name: 'Sticker' },
        'default': { base: 29.90, additional: 14.95, name: 'Produto' }
      };

      let products = [];
      
      if (req.method === 'POST') {
        products = req.body.products || [];
      } else if (req.method === 'GET') {
        if (req.query.products) {
          const productIds = req.query.products.split(',').map(id => parseInt(id.trim()));
          const quantities = req.query.quantities 
            ? req.query.quantities.split(',').map(q => parseInt(q.trim()))
            : productIds.map(() => 1);
          
          products = productIds.map((id, index) => ({
            productId: id,
            quantity: quantities[index] || 1,
            productTitle: SHIPPING_RATES[id]?.name || `Product ${id}`
          }));
        } else {
          let i = 1;
          while (req.query[`product${i}`]) {
            products.push({
              productId: parseInt(req.query[`product${i}`]),
              quantity: parseInt(req.query[`qty${i}`] || 1),
              productTitle: SHIPPING_RATES[parseInt(req.query[`product${i}`])]?.name || `Product ${i}`
            });
            i++;
          }
        }
      }

      if (!products || products.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No products provided'
        });
      }

      const groupedProducts = {};

      products.forEach(product => {
        const productId = product.productId || product.id;
        const quantity = product.quantity || 1;
        
        if (groupedProducts[productId]) {
          groupedProducts[productId].quantity += quantity;
        } else {
          groupedProducts[productId] = {
            productId: productId,
            quantity: quantity,
            productTitle: product.productTitle || product.name || `Product ${productId}`
          };
        }
      });

      const shippingItems = Object.values(groupedProducts).map(product => {
        const productId = product.productId;
        let rate = SHIPPING_RATES[productId];
        
        if (!rate) {
          if ([71, 72, 73, 74, 75].includes(productId)) rate = SHIPPING_RATES[71];
          else if ([146, 147, 148, 149, 150].includes(productId)) rate = SHIPPING_RATES[146];
          else if ([263, 679, 680, 681].includes(productId)) rate = SHIPPING_RATES[263];
          else if ([474, 682, 683, 684].includes(productId)) rate = SHIPPING_RATES[682];
          else if ([358, 359, 360].includes(productId)) rate = SHIPPING_RATES[358];
          else rate = SHIPPING_RATES.default;
        }

        return {
          productId: productId,
          name: product.productTitle || rate.name,
          baseRate: rate.base,
          additionalRate: rate.additional,
          quantity: product.quantity
        };
      });

      console.log('📊 Produtos agrupados:', shippingItems.map(p => `${p.productId}: ${p.quantity}x`));

      let highestBaseValue = 0;
      let highestBaseItem = null;
      
      shippingItems.forEach(item => {
        if (item.baseRate > highestBaseValue) {
          highestBaseValue = item.baseRate;
          highestBaseItem = item;
        }
      });

      let shippingCost = highestBaseValue;

      shippingItems.forEach(item => {
        if (item.productId === highestBaseItem?.productId) {
          if (item.quantity > 1) {
            shippingCost += item.additionalRate * (item.quantity - 1);
          }
        } else {
          shippingCost += item.additionalRate * item.quantity;
        }
      });

      const breakdown = {
        highestBaseItem: {
          productId: highestBaseItem?.productId,
          name: highestBaseItem?.name,
          baseRate: highestBaseItem?.baseRate,
          quantity: highestBaseItem?.quantity
        },
        items: shippingItems.map(item => ({
          productId: item.productId,
          name: item.name,
          baseRate: item.baseRate,
          additionalRate: item.additionalRate,
          quantity: item.quantity,
          additionalTotal: parseFloat((item.additionalRate * item.quantity).toFixed(2))
        })),
        calculation: {
          highestBase: highestBaseValue,
          totalAdditionals: parseFloat((shippingCost - highestBaseValue).toFixed(2)),
          formula: `${highestBaseValue.toFixed(2)} + ${(shippingCost - highestBaseValue).toFixed(2)} = ${shippingCost.toFixed(2)}`
        }
      };

      res.json({
        success: true,
        shipping: parseFloat(shippingCost.toFixed(2)),
        currency: 'BRL',
        formatted: `R$ ${shippingCost.toFixed(2).replace('.', ',')}`,
        breakdown: breakdown,
        items_count: products.length,
        grouped_items_count: shippingItems.length,
        method_used: req.method
      });

    } catch (error) {
      console.error('❌ Shipping calculation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to calculate shipping',
        message: error.message
      });
    }
  });
});

// =============================================
// EXPORTS
// =============================================

module.exports = {
  getAllProducts,
  getProductPricing,
  getProducts,
  proxyImage,
  saveProduct,
  saveArt,
  getPrintfulStoreProducts,
  calculateCartShipping,
  // NEW: Printful Order Functions
  getPrintfulOrderStatus,
  createPrintfulOrderManually,
  createPrintfulOrder,         // Direct function export for internal use
  retryFailedPrintfulOrders,   // Scheduled function
  printfulWebhook,             // Printful event webhook
};
// =============================================
// REPAIR: RE-REGISTER A PRODUCT WITH PRINTFUL
// Populates printfulSyncVariants on a Firestore product doc
// that was never successfully synced to Printful.
// POST body: { product_id: "HAcKiuUlSoYjDZDZVgtq" }
// =============================================

const repairProductSyncVariants = functions.runWith({
  timeoutSeconds: 120,
  memory: '512MB',
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const { product_id } = req.body;
      if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required' });

      console.log(`🔧 Repairing sync variants for product: ${product_id}`);

      const productDoc = await db.collection('products').doc(product_id).get();
      if (!productDoc.exists) {
        return res.status(404).json({ success: false, error: `Product ${product_id} not found in Firestore` });
      }

      const productData = productDoc.data();

      // If already synced, report it
      if (productData.printfulSyncVariants && productData.printfulSyncVariants.length > 0) {
        return res.json({
          success: true,
          already_synced: true,
          message: `Product already has ${productData.printfulSyncVariants.length} sync variants. No repair needed.`,
          printfulSyncVariants: productData.printfulSyncVariants
        });
      }

      const { designUrl, thumbnailUrl, productTitle, name, variants, placement, side = 'front' } = productData;

      if (!designUrl) return res.status(400).json({ success: false, error: 'Product is missing designUrl — cannot re-create in Printful' });
      if (!variants || variants.length === 0) return res.status(400).json({ success: false, error: 'Product has no variants' });

      const syncVariants = variants.map(v => {
        const variantIdForPrintful = parseInt(v.variant_id || v.id);
        if (!variantIdForPrintful || isNaN(variantIdForPrintful)) {
          throw new Error(`Invalid variant_id for variant ${v.id}`);
        }
        const retailPrice = parseFloat(v.retail_price);
        if (!retailPrice || retailPrice <= 0) {
          throw new Error(`Invalid retail_price for variant ${v.id}: ${v.retail_price}`);
        }

        const fileConfig = {
          url: designUrl,
          type: 'default',
          position: 'center',
          ...(placement && {
            area_width: placement.area_width || 6000,
            area_height: placement.area_height || 7200,
            width: placement.width || 6000,
            height: placement.height || 7200,
            top: placement.top || 0,
            left: placement.left || 0
          })
        };

        if (side === 'back') {
          fileConfig.options = [{ id: 'placement', value: 'back' }];
        }

        return {
          variant_id: variantIdForPrintful,
          retail_price: retailPrice.toFixed(2),
          files: [fileConfig]
        };
      });

      const payload = {
        sync_product: {
          name: `${productTitle || name} - ${side}`,
          thumbnail: thumbnailUrl || '',
          external_id: `kauara_${product_id}_${side}`
        },
        sync_variants: syncVariants
      };

      console.log(`Calling Printful to re-create product ${product_id} with ${syncVariants.length} variants...`);

      const response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
        method: 'POST',
        headers: PRINTFUL_HEADERS,
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Printful API error:', data);
        return res.status(400).json({
          success: false,
          error: 'Printful API rejected the request',
          details: data,
          message: data.error?.message || 'Printful error'
        });
      }

      const printfulUpdate = {
        printfulSyncProductId: data.result?.sync_product?.id || null,
        printfulSyncProduct: data.result?.sync_product || null,
        printfulSyncVariants: data.result?.sync_variants || [],
        status: 'created',
        printfulStatus: 'success',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('products').doc(product_id).update(printfulUpdate);

      console.log(`Repair complete for product ${product_id}. Sync variants: ${printfulUpdate.printfulSyncVariants.length}`);

      return res.json({
        success: true,
        message: `Successfully re-registered product ${product_id} with Printful`,
        printfulSyncProductId: printfulUpdate.printfulSyncProductId,
        syncVariantsCount: printfulUpdate.printfulSyncVariants.length,
        syncVariants: printfulUpdate.printfulSyncVariants.map(sv => ({
          sync_variant_id: sv.id,
          catalog_variant_id: sv.variant_id,
          name: sv.name
        }))
      });

    } catch (error) {
      console.error('repairProductSyncVariants error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
});
// TEMPORARY TEST FUNCTION — remove after debugging
const testPrintfulAuth = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
        headers: PRINTFUL_HEADERS
      });
      const data = await response.json();
      res.json({
        http_status: response.status,
        printful_response: data,
        token_preview: PRINTFUL_API_KEY ? PRINTFUL_API_KEY.substring(0, 8) + '...' : 'MISSING',
        store_id_used: PRINTFUL_STORE_ID || 'MISSING'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

module.exports.testPrintfulAuth = testPrintfulAuth;
module.exports.repairProductSyncVariants = repairProductSyncVariants;