const functions = require('firebase-functions');
const fetch = require('node-fetch');
const admin = require('firebase-admin');



// Initialize Firebase Admin with explicit configuration
if (!admin.apps.length) {
  admin.initializeApp();
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}


const cors = require('cors')({
  origin: [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
    'http://localhost:5000', // Add localhost for development
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// === Config ===
const PRINTFUL_API_BASE = 'https://api.printful.com';
const PRINTFUL_API_KEY = functions.config().printful.apikey;

const bucket = admin.storage().bucket();

const ALLOWED_PRODUCT_IDS = [
  1,    // Poster
  71,   // Classic T-Shirt
  146,  // Unisex Hoodie
  682,  // Hardcover notebook
  474,  // Spiral Notebook
  358,  // Sticker
  
];

// Fallback pricing for products (base cost + minimal margin)
const PRODUCT_BASE_PRICING = {
  71: 24.99,   // T-Shirt base price
  146: 39.99,  // Hoodie base price
  679: 15.99    // Sticker base price (if added later)
};

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
let cachedProducts = null;
let cacheTimestamp = 0;

exports.getAllProducts = functions.runWith({
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
              headers: {
                Authorization: `Bearer ${PRINTFUL_API_KEY}`,
                // 'X-PF-Region': 'BR', // Remove temporarily for debugging
              },
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
          let url = `${PRINTFUL_API_BASE}/store/products?limit=${limit}&offset=${offset}`;
          
          console.log(`Request #${requestCount}: ${url}`);
          
          const catalogResponse = await fetchWithRetry(url);
          const catalogData = await catalogResponse.json();
          
          // Handle different possible response structures
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
          
          // Process variants safely
          const processedProducts = products.map(product => {
            let variantsArray = [];
            
            // Handle different variants structures
            if (Array.isArray(product.variants)) {
              variantsArray = product.variants;
            } else if (product.variants && typeof product.variants === 'object') {
              // If variants is an object, convert it to array
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
          
          // Check if we've reached the end
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
// === Updated Get Product Pricing Function ===
exports.getProductPricing = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const { productId, variantId } = req.body;

      if (!productId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Product ID is required' 
        });
      }

      console.log('Fetching pricing for product:', productId, 'variant:', variantId);

      let basePrice = PRODUCT_BASE_PRICING[productId];

      // Try to fetch live pricing from Printful API
      try {
        const printfulResponse = await fetch(`${PRINTFUL_API_BASE}/products/${productId}`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
        });

        if (printfulResponse.ok) {
          const printfulData = await printfulResponse.json();
          
          if (variantId && printfulData.result?.variants) {
            // Find specific variant pricing
            const variant = printfulData.result.variants.find(v => v.id === variantId);
            if (variant && variant.price) {
              basePrice = parseFloat(variant.price);
              console.log('Found variant-specific pricing:', basePrice);
            }
          }
          
          // If no variant-specific pricing found, use the first variant or product price
          if (!basePrice && printfulData.result?.variants?.length > 0) {
            basePrice = parseFloat(printfulData.result.variants[0].price || basePrice);
          }
        }
      } catch (apiError) {
        console.warn('Failed to fetch live pricing from Printful, using fallback:', apiError.message);
      }

      // Ensure we have a valid price
      if (!basePrice || basePrice <= 0) {
        basePrice = PRODUCT_BASE_PRICING[productId] || 29.99;
      }

      res.json({
        success: true,
        basePrice,
        productId,
        variantId: variantId || null,
        source: 'live_or_fallback'
      });

    } catch (error) {
      console.error('Error getting product pricing:', error);
      
      // Return fallback pricing in case of any error
      const fallbackPrice = PRODUCT_BASE_PRICING[req.body.productId] || 29.99;
      
      res.json({
        success: true,
        basePrice: fallbackPrice,
        productId: req.body.productId,
        variantId: req.body.variantId || null,
        source: 'fallback',
        warning: 'Using fallback pricing due to API error'
      });
    }
  });
});

// === Helpers ===
async function fetchWithConcurrency(urls, concurrency = 10) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${PRINTFUL_API_KEY}`,
            },
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

// === Existing Functions (Updated) ===
exports.getProducts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const now = Date.now();

      if (cachedProducts && now - cacheTimestamp < CACHE_DURATION) {
        return res.status(200).json({
          success: true,
          count: cachedProducts.length,
          products: cachedProducts,
          cached: true,
        });
      }

      const urls = ALLOWED_PRODUCT_IDS.map(
        (id) => `${PRINTFUL_API_BASE}/products/${id}`
      );
      const detailResults = await fetchWithConcurrency(urls, 15);

      const productsWithDetails = await Promise.all(
        detailResults
          .filter((d) => d?.result)
          .map(async (details) => {
            const { product, variants: variantData } = details.result;

            const flatLayTemplates = await getFlatLayTemplates(product.id);

            const variants = (variantData || []).map((variant) => {
              const template = flatLayTemplates.find((t) =>
                t.variant_ids.includes(variant.id)
              );
              const fallback = flatLayTemplates[0] || null;

              return {
                id: variant.id,
                name: variant.name,
                size: variant.size,
                color: variant.color,
                color_code: variant.color_code,
                availability_status: variant.availability_status,
                retail_price: variant.retail_price || PRODUCT_BASE_PRICING[product.id] || 29.99,
                preview_urls:
                  variant.files
                    ?.filter((f) => f.type === 'preview')
                    .map((f) => f.preview_url) || [],
                flat_lay_url: template?.url || fallback?.url || null,
              };
            });

            const mockups = Array.from(
              new Set(
                (variantData || [])
                  .flatMap((variant) =>
                    (variant.files || [])
                      .filter((f) => f.type === 'preview' && f.preview_url)
                      .map((f) => f.preview_url)
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
          })
      );

      cachedProducts = productsWithDetails;
      cacheTimestamp = now;

      res.status(200).json({
        success: true,
        count: productsWithDetails.length,
        products: productsWithDetails,
        cached: false,
      });
    } catch (err) {
      console.error('Error fetching products:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch products',
        message: err.message,
      });
    }
  });
});

exports.proxyImage = functions.https.onRequest((req, res) => {
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
        headers: isFlatLay ? {} : { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
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

// === FIXED saveProduct function with better Firestore handling ===
exports.saveProduct = functions.runWith({
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
      const { 
        name, 
        thumbnail, 
        side, 
        variants = [], 
        designImage, 
        placement, 
        designerUserId,
        productId,
        productTitle,
        pricing
      } = req.body;

      console.log('Received saveProduct request for user:', designerUserId);

      // Basic validation
      if (!designerUserId) {
        return res.status(401).json({ success: false, error: 'User authentication required' });
      }

      const requiredFields = ['name', 'thumbnail', 'variants', 'designImage'];
      const missing = requiredFields.filter(f => !req.body[f]);
      if (missing.length > 0) {
        return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
      }

      // Upload images first
      const thumbnailUrl = await uploadBase64Image(thumbnail, 'thumbnails');
      const designUrl = await uploadBase64Image(designImage, 'designs');

      // Build Firestore-ready payload (no 'undefined' allowed)
      const safeVariants = variants.map(v => ({
        id: v?.id ?? null,
        color: v?.color ?? null,
        color_code: v?.color_code ?? null,
        size: v?.size ?? null,
        price: (v?.price != null ? Number(v.price) : (pricing?.totalPrice ?? 29.99))
      }));

      const productData = {
        id: null, // will fill after .add()
        designerUserId: designerUserId ?? null,
        name: name ?? null,
        productId: productId ?? null,
        productTitle: productTitle ?? null,
        side: side ?? null,
        variants: safeVariants,
        thumbnailUrl,
        designUrl,
        placement: placement ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'creating',
        printfulStatus: 'pending',
      };

      // Optional pricing block
      if (pricing) {
        productData.pricing = {
          basePrice: Number(pricing.basePrice ?? 0),
          userCut: Number(pricing.userMarkup ?? 0),
          totalPrice: Number(pricing.totalPrice ?? 0),
          platformFee: Number(
            pricing.platformFee ??
            (Number(pricing.totalPrice ?? 0) - Number(pricing.basePrice ?? 0) - Number(pricing.userMarkup ?? 0))
          ),
          currency: 'BRL'
        };
      }

      // === Firestore: use .add(...) as requested ===
      let productDocRef;
      try {
        productDocRef = await admin.firestore().collection('products').add(productData);
        // Save the generated id back into the doc (optional but handy)
        await productDocRef.update({
          id: productDocRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ Saved product to Firestore with ID:', productDocRef.id);
      } catch (firestoreError) {
        console.error('❌ Firestore .add() error:', firestoreError);
        return res.status(500).json({ success: false, error: 'Failed to save product to Firestore', details: firestoreError.message });
      }

      // === Create product on Printful ===
      try {
        const syncVariants = safeVariants.map(v => ({
          variant_id: v.id,
          retail_price: Number(
            pricing?.totalPrice != null ? pricing.totalPrice : (v.price != null ? v.price : 29.99)
          ).toFixed(2),
          files: [
            {
              url: designUrl,
              type: side === 'back' ? 'back' : 'default',
              position: placement ? {
                area_width: placement.area_width,
                area_height: placement.area_height,
                width: placement.width,
                height: placement.height,
                top: placement.top,
                left: placement.left
              } : {
                area_width: 6000,
                area_height: 7200,
                width: 6000,
                height: 7200,
                top: 0,
                left: 0
              }
            }
          ]
        }));

        const payload = {
          sync_product: { 
            name: `${name}`,
            thumbnail: thumbnailUrl 
          },
          sync_variants: syncVariants
        };

        const response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('Printful error:', data);
          // mark as failed
          await productDocRef.update({
            status: 'failed',
            printfulStatus: 'error',
            printfulError: data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          return res.status(400).json({ 
            success: false, 
            error: 'Failed to create product on Printful',
            details: data 
          });
        }

        // Update Firestore with Printful result
        await productDocRef.update({
          printfulProductId: data.result.id,
          printfulSyncProductId: data.result.sync_product_id,
          printfulData: {
            sync_product: data.result.sync_product,
            sync_variants: data.result.sync_variants
          },
          status: 'created',
          printfulStatus: 'success',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ 
          success: true, 
          product: data.result,
          message: 'Product created successfully',
          firestoreProductId: productDocRef.id,
          printfulProductId: data.result.id
        });

      } catch (printfulError) {
        console.error('Printful creation error:', printfulError);

        await productDocRef.update({
          status: 'failed',
          printfulStatus: 'error',
          printfulError: printfulError?.message ?? String(printfulError),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(500).json({ 
          success: false, 
          error: 'Failed to create product',
          message: printfulError?.message ?? String(printfulError)
        });
      }

    } catch (err) {
      console.error('Overall error in saveProduct (add version):', err);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error',
        message: err.message
      });
    }
  });
});


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

// === Art saving function ===
exports.saveArt = functions.runWith({
  timeoutSeconds: 120,
  memory: '2GB'
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const { artData, filename, artName, userId, price, platformFee, totalPrice } = req.body;

      if (!artData || !filename || !artName || !userId || price === undefined) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields' 
        });
      }

      // Save to Firebase Storage
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

      // Save metadata to Firestore arts collection with price
      await admin.firestore().collection('arts').add({
        name: artName,
        filename: filename,
        storagePath: filePath,
        downloadURL: downloadURL,
        userId: userId,
        price: parseFloat(price) || 0,
        platformFee: parseFloat(platformFee) || 0,
        totalPrice: parseFloat(totalPrice) || 0,
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