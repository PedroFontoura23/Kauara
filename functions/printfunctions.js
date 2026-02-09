const functions = require('firebase-functions');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase Admin
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
    'http://localhost:5000',
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
  // Try to get pricing from the new nested structure first
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
  
  // Fallback to old structure or pricing summary
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

// === Function 1: Get All Products ===
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
              headers: {
                Authorization: `Bearer ${PRINTFUL_API_KEY}`,
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
          let url = `${PRINTFUL_API_BASE}/products?limit=${limit}&offset=${offset}`;
          
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

// === Function 2: Get Product Pricing ===
const getProductPricing = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    // Support both GET and POST methods
    let productId, variantId;
    
    if (req.method === 'GET') {
      productId = req.query.productId;
      variantId = req.query.variantId;
    } else if (req.method === 'POST') {
      productId = req.body.productId;
      variantId = req.body.variantId;
    } else {
      return res.status(405).json({ success: false, error: 'Method not allowed. Use GET or POST.' });
    }

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
        console.log('Printful API response for product:', printfulData);
        
        if (printfulData.result && printfulData.result.variants) {
          // If we have a specific variant ID, find that variant
          if (variantId) {
            const variant = printfulData.result.variants.find(v => v.id === parseInt(variantId));
            if (variant) {
              // Try different possible price fields
              basePrice = variant.retail_price || variant.price || basePrice;
              console.log('Found variant-specific pricing:', basePrice, 'for variant:', variantId);
            }
          }
          
          // If no variant-specific pricing found or no variantId provided, 
          // use the first available variant's price
          if (!basePrice && printfulData.result.variants.length > 0) {
            const firstVariant = printfulData.result.variants[0];
            basePrice = firstVariant.retail_price || firstVariant.price || basePrice;
            console.log('Using first variant pricing:', basePrice);
          }
        }
      } else {
        console.warn('Printful API returned non-OK status:', printfulResponse.status);
      }
    } catch (apiError) {
      console.warn('Failed to fetch live pricing from Printful, using fallback:', apiError.message);
    }

    // Ensure we have a valid price
    if (!basePrice || basePrice <= 0) {
      basePrice = PRODUCT_BASE_PRICING[productId] || 29.99;
      console.log('Using fallback pricing:', basePrice);
    }

    // Convert to number and ensure it's positive
    basePrice = Math.abs(parseFloat(basePrice) || 29.99);

    res.json({
      success: true,
      basePrice,
      productId,
      variantId: variantId || null,
      source: 'live_or_fallback',
      method: req.method // For debugging
    });
  });
});

// === Function 3: Get Products (Allowed Products Only) ===
const getProducts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    // === DEBUG: Force cache reset ===
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
      
      // CORRECTED: Using catalog endpoint
      const urls = ALLOWED_PRODUCT_IDS.map(
        (id) => `${PRINTFUL_API_BASE}/products/${id}`
      );
      
      console.log('📡 URLs to fetch:', urls);
      
      // Test ONE URL first
      console.log('🧪 Testing single API call...');
      const testUrl = urls[0]; // First URL (T-Shirt)
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
          throw new Error(`API returned ${testResponse.status}: ${response.statusText}`);
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
        // Don't throw yet, continue with full fetch for debugging
      }
      
      // Now try the concurrency approach
      console.log('🚀 Starting concurrent fetch of all URLs...');
      const detailResults = await fetchWithConcurrency(urls, 3); // Reduced for debugging
      
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
        // Cache an empty array to avoid repeated failures
        cachedProducts = [];
        cacheTimestamp = now;
        
        return res.status(200).json({
          success: true,
          count: 0,
          products: [],
          cached: false,
          error: 'All API calls failed',
          debug: { validCount: 0 }
        });
      }
      
      const productsWithDetails = await Promise.all(
        detailResults
          .filter((d) => d?.result)
          .map(async (details, index) => {
            try {
              const { product, variants: variantData } = details.result;
              
              console.log(`Processing product ${product.id}: ${product.title}`);
              
              const flatLayTemplates = await getFlatLayTemplates(product.id);
              
              const variants = (variantData || []).map((variant) => {
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
            } catch (err) {
              console.error(`Error processing product ${index}:`, err);
              return null;
            }
          })
      );
      
      const validProducts = productsWithDetails.filter(p => p !== null);
      console.log(`✅ Successfully processed: ${validProducts.length} products`);
      
      // Update cache
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
      
      // Even on error, update cache to empty to prevent retry storms
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

// === Function 4: Proxy Image ===
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

// === Function 5: Save Product (UPDATED for new canvas.js structure) ===
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
      
      // Extract data from new canvas.js structure
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
        
        // New pricing structure from canvas.js
        pricing_summary = {},
        
        // Variants array with new structure
        variants = [],
        
        // Other fields that might be present
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

      // Basic validation
      if (!designerUserId) {
        return res.status(401).json({ success: false, error: 'User authentication required' });
      }

      // Validate side parameter
      if (!side || (side !== 'front' && side !== 'back')) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid side parameter. Must be "front" or "back"' 
        });
      }

      // Check required fields
      const requiredFields = ['name', 'thumbnail', 'designImage'];
      const missing = requiredFields.filter(f => !req.body[f]);
      if (missing.length > 0) {
        return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
      }

      // Upload images first
      console.log('Uploading images...');
      const thumbnailUrl = await uploadBase64Image(thumbnail, 'thumbnails');
      const designUrl = await uploadBase64Image(designImage, 'designs');
      console.log('Images uploaded:', { thumbnailUrl, designUrl });

      // Process variants with new structure
      console.log('Processing variants with new structure...');
      const safeVariants = variants.map(v => {
        try {
          // VALIDATE VARIANT ID - CRITICAL FOR PRINTFUL
          const variantId = v.id || v.variant_id;
          
          if (!variantId) {
            throw new Error(`Variant ID is required. Variant: ${JSON.stringify(v)}`);
          }
          
          // Ensure variant_id is a number for Printful
          const printfulVariantId = parseInt(variantId);
          if (isNaN(printfulVariantId)) {
            throw new Error(`Invalid Printful variant ID: ${variantId}. Must be a number.`);
          }
          
          // Extract pricing from new structure
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
          
          // VALIDATE PRICE
          if (pricing.total_price <= 0) {
            throw new Error(`Total price must be greater than zero for variant ${variantId}`);
          }
          
          // ✅ FIELDS FOR FIRESTORE
          const cleanVariant = {
            // For Firestore
            id: variantId.toString(), // Keep as string for Firestore
            variant_id: printfulVariantId, // Number for Printful API
            
            name: v.name || `Variant ${variantId}`,
            
            // Physical attributes
            size: v.size || 'One Size',
            color: v.color || 'N/A',
            color_code: v.color_code || v.colorCode || '#cccccc',
            
            // ✅ Price for Printful (as string with 2 decimals)
            retail_price: pricing.total_price.toFixed(2),
            
            // ✅ NEW: Store the full pricing structure for reference
            pricing: {
              product_price: pricing.product_price,
              artist_cut: pricing.artist_cut,
              platform_fee: pricing.platform_fee,
              total_price: pricing.total_price,
              currency: pricing.currency || 'BRL'
            },
            
            // Compatibility fields
            ...(v.external_id && { external_id: v.external_id }),
            ...(v.sku && { sku: v.sku }),
            
            // Availability
            availability_status: v.availability_status || 'active'
          };
          
          return cleanVariant;
          
        } catch (variantError) {
          console.error(`Error processing variant:`, variantError);
          throw variantError;
        }
      });

      console.log('✅ Processed variants for Firestore:', safeVariants.length);

      // Base product data for Firestore with new structure
      const productData = {
        // IDs and ownership
        id: null, // will fill after .add()
        designerUserId: designerUserId ?? null,
        firebaseUserId: firebaseUserId ?? null,
        userEmail: userEmail ?? null,
        
        // Product info
        name: name ?? null,
        productTitle: productTitle ?? null,
        productId: productId ? parseInt(productId) : null,
        side: side ?? null,
        
        // Variants
        variants: safeVariants,
        
        // Images
        thumbnailUrl,
        designUrl,
        
        // Design info
        placement: placement ?? null,
        designScale: Number(designScale) || 1.0,
        
        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        
        // Status
        status: 'creating',
        printfulStatus: 'pending',
        
        // Summary information for easy querying
        availableSizes: availableSizes.length > 0 ? availableSizes : [...new Set(safeVariants.map(v => v.size))],
        availableColors: availableColors.length > 0 ? availableColors : [...new Set(safeVariants.map(v => v.color))],
        totalVariants: totalVariants > 0 ? totalVariants : safeVariants.length,
        
        // ✅ NEW: Store pricing summary from canvas.js
        pricing_summary: {
          product_price_range: pricing_summary.product_price_range || { min: 0, max: 0 },
          artist_cut: pricing_summary.artist_cut || 0,
          platform_fee_percentage: pricing_summary.platform_fee_percentage || 0.05,
          total_price_range: pricing_summary.total_price_range || { min: 0, max: 0 },
          currency: pricing_summary.currency || 'BRL'
        },
        
        // Debug info
        _debug: {
          timestamp: new Date().toISOString(),
          apiVersion: '2.1', // Updated version for new structure
          variantCount: safeVariants.length,
          hasPricingSummary: !!pricing_summary,
          side: side
        }
      };

      // Add artist attribution for client products
      if (firestoreCollection === 'products-client') {
        productData.artistUserId = req.body.artistUserId || null;
        productData.originalArtId = req.body.originalArtId || null;
        productData.artPrice = req.body.artPrice || 0;
      }

      // Save to Firestore first
      let productDocRef;
      try {
        console.log('Saving to Firestore collection:', firestoreCollection);
        productDocRef = await admin.firestore().collection(firestoreCollection).add(productData);
        
        // Save the generated id back into the doc
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

      // === Create product on Printful with proper side handling ===
      try {
        console.log('=== CREATING PRINTFUL PRODUCT ===');
        
        // Prepare variants for Printful API
        const syncVariants = safeVariants.map(v => {
          const retailPrice = parseFloat(v.retail_price);
          
          if (isNaN(retailPrice) || retailPrice <= 0) {
            throw new Error(`Invalid price for variant ${v.id}: ${v.retail_price}`);
          }
          
          // ✅ CRITICAL: Use the numeric variant_id for Printful
          const variantIdForPrintful = v.variant_id;
          
          if (!variantIdForPrintful || isNaN(variantIdForPrintful)) {
            throw new Error(`Invalid Printful variant ID for variant ${v.id}: ${variantIdForPrintful}`);
          }
          
          console.log(`Creating Printful variant ${variantIdForPrintful} with price: ${retailPrice}`);
          
          // ✅ FIXED: Create proper Printful file configuration with side support
          const fileConfig = {
            url: designUrl,
            type: 'default', // Always use 'default' type
            position: "center",
            // Add placement dimensions if available
            ...(placement && {
              area_width: placement.area_width || 6000,
              area_height: placement.area_height || 7200,
              width: placement.width || 6000,
              height: placement.height || 7200,
              top: placement.top || 0,
              left: placement.left || 0
            })
          };
          
          // If it's a back side product, add side parameter
          if (side === 'back') {
            fileConfig.options = [
              {
                id: 'placement',
                value: 'back'
              }
            ];
          }
          
          // Return Printful sync variant format
          return {
            variant_id: variantIdForPrintful, // Must be numeric
            retail_price: retailPrice.toFixed(2), // String with 2 decimals
            files: [fileConfig]
          };
        });

        console.log('Creating Printful product for side:', side);
        console.log('Number of Printful variants:', syncVariants.length);
        console.log('First Printful variant:', JSON.stringify(syncVariants[0], null, 2));

        // ✅ FIXED: Use the CORRECT Printful API endpoint for sync products
        const payload = {
          sync_product: { 
            name: `${productTitle || name} - ${side}`,
            thumbnail: thumbnailUrl,
            external_id: `kauara_${productDocRef.id}_${side}` // Unique external ID
          },
          sync_variants: syncVariants
        };

        console.log('Printful API Payload:', JSON.stringify(payload, null, 2));

        // ✅ CRITICAL FIX: Use the CORRECT endpoint
        console.log('Making Printful API request to:', `${PRINTFUL_API_BASE}/store/products`);
        
        const response = await fetch(`${PRINTFUL_API_BASE}/store/products`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        console.log('Printful API Response:', JSON.stringify(data, null, 2));

        if (!response.ok) {
          console.error('❌ Printful API error response:', {
            status: response.status,
            statusText: response.statusText,
            data: data
          });
          
          // Mark as failed in Firestore
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

        // ✅ SUCCESS: Update Firestore with Printful result
        const printfulUpdate = {
          printfulSyncProductId: data.result?.sync_product?.id || null,
          printfulSyncProduct: data.result?.sync_product || null,
          printfulSyncVariants: data.result?.sync_variants || [],
          status: 'created',
          printfulStatus: 'success',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Remove undefined fields
        Object.keys(printfulUpdate).forEach(key => {
          if (printfulUpdate[key] === undefined) {
            delete printfulUpdate[key];
          }
        });

        await productDocRef.update(printfulUpdate);

        console.log('✅ Successfully created Printful sync product!');
        console.log('Printful Sync Product ID:', data.result?.sync_product?.id);
        console.log('Number of sync variants:', data.result?.sync_variants?.length);

        // Return success response
        res.json({ 
          success: true, 
          product: data.result,
          message: `Product created successfully for ${side} side`,
          firestoreProductId: productDocRef.id,
          printfulSyncProductId: data.result?.sync_product?.id || null,
          side: side,
          variantsCount: safeVariants.length,
          collection: firestoreCollection,
          pricing_summary_saved: true
        });

      } catch (printfulError) {
        console.error('❌ Printful creation error:', printfulError);
        console.error('Error stack:', printfulError.stack);
        
        // Mark as failed in Firestore
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

// === Function 6: Save Art ===
const saveArt = functions.runWith({
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

// === Function 7: Get Printful Store Products (for debugging) ===
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

// Export all functions
module.exports = {
  getAllProducts,
  getProductPricing,
  getProducts,
  proxyImage,
  saveProduct,
  saveArt,
  getPrintfulStoreProducts
};