const functions = require('firebase-functions');
const fetch = require('node-fetch');
const admin = require('firebase-admin'); // Add this
admin.initializeApp(); // Add this

const cors = require('cors')({
  origin: [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// === Config ===
const PRINTFUL_API_BASE = 'https://api.printful.com';
const PRINTFUL_API_KEY = functions.config().printful.apikey;

// Add Firebase Storage bucket initialization
const bucket = admin.storage().bucket(); // Add this line

const ALLOWED_PRODUCT_IDS = [
  71,   // Classic T-Shirt
  146,  // Unisex Hoodie
];
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
  // Use a static placeholder hosted in your project instead of generating with canvas
  return `https://kauara1.web.app/images/placeholder.png?text=${encodeURIComponent(
    title
  )}`;
}

// === Cloud Functions ===
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
        variants, 
        designImage, 
        placement, 
        designerUserId,
        productId,
        productTitle 
      } = req.body;

      // Authentication check
      if (!designerUserId) {
        return res.status(401).json({ 
          success: false, 
          error: 'User not authenticated. designerUserId is required.' 
        });
      }

      // Validate required fields
      const requiredFields = ['name', 'thumbnail', 'variants', 'designImage'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Missing required fields: ${missingFields.join(', ')}` 
        });
      }

      if (!['front', 'back'].includes(side)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid side value. Must be "front" or "back".' 
        });
      }

      // Upload thumbnail
      const thumbnailUrl = await uploadBase64Image(thumbnail, 'thumbnails');
      
      // Upload design image
      const designUrl = await uploadBase64Image(designImage, 'designs');

      // Create sync variants with proper positioning
      const syncVariants = variants.map(v => ({
        variant_id: v.id,
        retail_price: v.price.toFixed(2),
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
              area_width: placement?.area_width || 1800,
              area_height: placement?.area_height || 2400,
              width: placement?.width || 1800,
              height: placement?.height || 2400,
              top: placement?.top || 0,
              left: placement?.left || 0
            }
          }
        ]
      }));

      const payload = {
        sync_product: { 
          name: `${name}`, // Use the provided name with user ID
          thumbnail: thumbnailUrl 
        },
        sync_variants: syncVariants
      };

      console.log('Creating product for user:', designerUserId);
      console.log('Product details:', {
        name,
        variant_count: syncVariants.length,
        product_id: productId,
        product_title: productTitle
      });

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
        console.error('Printful API error:', {
          status: response.status,
          data: data,
          user: designerUserId
        });
        
        const errorMessage = JSON.stringify(data).toLowerCase();
        let userFriendlyError = 'Failed to create product on Printful';
        
        if (errorMessage.includes('scale down') || errorMessage.includes('minimum requirements')) {
          userFriendlyError = 'Image resolution is too low. Please use a higher quality image.';
        } else if (errorMessage.includes('invalid file') || errorMessage.includes('file format')) {
          userFriendlyError = 'Invalid image format. Please use PNG or JPG format.';
        } else if (errorMessage.includes('variant') || errorMessage.includes('not available')) {
          userFriendlyError = 'Selected product variant is not available.';
        }
        
        return res.status(400).json({ 
          success: false, 
          error: userFriendlyError,
          details: data 
        });
      }

      // Store product reference in Firestore for user tracking
      try {
        await admin.firestore().collection('userProducts').add({
          designerUserId,
          printfulProductId: data.result.id,
          printfulSyncProductId: data.result.sync_product_id,
          productName: name,
          productId,
          productTitle,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          variants: variants.map(v => v.id),
          status: 'created'
        });
      } catch (firestoreError) {
        console.error('Error saving to Firestore:', firestoreError);
        // Continue even if Firestore save fails - the main product creation succeeded
      }

      res.json({ 
        success: true, 
        product: data.result,
        message: 'Product created successfully'
      });

    } catch (err) {
      console.error('saveProduct error:', err);
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

    console.log(`Uploading image: ${(buffer.length / 1024 / 1024).toFixed(2)}MB, type: ${mimeType}`);

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
      validation: 'md5',
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log(`Image uploaded successfully: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Add to printfunctions.js
// Update the saveArt function in printfunctions.js
exports.saveArt = functions.runWith({
  timeoutSeconds: 120,
  memory: '2GB' // Increase memory for higher resolution images
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const { artData, filename, artName, userId } = req.body;

      if (!artData || !filename || !artName || !userId) {
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
      
      console.log(`Art image size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
      
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

      // Save metadata to Firestore
      await admin.firestore().collection('arts').add({
        name: artName,
        filename: filename,
        storagePath: filePath,
        downloadURL: downloadURL,
        userId: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        size: buffer.length,
        type: mimeType,
        resolution: 'high' // Mark as high resolution
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