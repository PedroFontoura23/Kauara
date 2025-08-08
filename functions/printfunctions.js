const functions = require('firebase-functions');
const fetch = require('node-fetch');
const cors = require('cors')({ 
  origin: [
    'https://kauara1.web.app', 
    'https://www.kauara1.web.app', 
    'https://kauava.com',
    'https://www.kauava.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// *** PRODUCT WHITELIST - Only these products will be shown to users ***
const ALLOWED_PRODUCT_IDS = [
  71,   // Classic T-Shirt
  146,  // Unisex Hoodie
  19,   // Mug
  1,
  2,
  // Add more product IDs here as needed
  // You can find product IDs by temporarily enabling all products and checking the console logs
];

// Cache products for 10 minutes to reduce API calls
let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

const PRINTFUL_API_BASE = 'https://api.printful.com';
const PRINTFUL_API_KEY = functions.config().printful.apikey;

// Batch API requests with concurrency limit
async function fetchWithConcurrency(urls, concurrency = 10) {
  const results = [];
  
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(async (url, index) => {
      try {
        const response = await fetch(url, {
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PRINTFUL_API_KEY}`
          }
        });
        return response.ok ? await response.json() : null;
      } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}

// Fetch flat lay templates for a product
async function getFlatLayTemplates(productId) {

  const FIREBASE_STORAGE_BASE = 'https://kauara1.web.app/images/flatlays';
  
  // Return a mock template object that points to your local image
  return [{
    url: `${FIREBASE_STORAGE_BASE}/${productId}.png`,
    variant_ids: [], // Empty array since we're using one image per product
    type: 'flat_lay',
    title: 'Product Flat Lay'
  }];
}

// Generate a data URL for placeholder images
function generatePlaceholderImage(text = 'No Image', width = 200, height = 200) {
  const canvas = require('canvas').createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, width, height);
  
  // Text
  ctx.fillStyle = '#666';
  ctx.font = '16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, width/2, height/2);
  
  return canvas.toDataURL();
}

exports.getProducts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB'
}).https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Check cache first
      const now = Date.now();
      if (cachedProducts && (now - cacheTimestamp) < CACHE_DURATION) {
        console.log('Returning cached products');
        return res.status(200).json({
          success: true,
          count: cachedProducts.length,
          products: cachedProducts,
          cached: true
        });
      }

      console.log('Fetching fresh products from Printful API');
      console.log(`Allowed product IDs: ${ALLOWED_PRODUCT_IDS.join(', ')}`);
      
      // Fetch only the allowed products directly instead of fetching all products first
      const detailUrls = ALLOWED_PRODUCT_IDS.map(productId => 
        `${PRINTFUL_API_BASE}/products/${productId}`
      );

      // Fetch all allowed product details in batches
      const detailResults = await fetchWithConcurrency(detailUrls, 15);
      
      console.log(`Fetched details for ${detailResults.filter(r => r !== null).length} products`);

      // Process only the successfully fetched products
      const productsWithDetails = await Promise.all(
        detailResults
          .filter(details => details && details.result) // Filter out failed requests
          .map(async (details) => {
            const product = details.result.product;
            
            let variants = [];
            let mockups = [];
            let flatLayTemplates = [];
            
            // Get flat lay templates for this product
            flatLayTemplates = await getFlatLayTemplates(product.id);
            
            if (details.result.variants) {
              variants = details.result.variants.map(variant => {
                const template = flatLayTemplates.find(t => 
                  t.variant_ids && t.variant_ids.includes(variant.id)
                );
                
                // If no specific template, use the first available one
                const fallbackTemplate = flatLayTemplates.length > 0 ? flatLayTemplates[0] : null;
                
                return {
                  id: variant.id,
                  name: variant.name,
                  size: variant.size,
                  color: variant.color,
                  color_code: variant.color_code,
                  availability_status: variant.availability_status,
                  preview_urls: variant.files?.filter(f => f.type === 'preview').map(f => f.preview_url) || [],
                  flat_lay_url: template?.url || fallbackTemplate?.url || null
                };
              });
              
              // Extract mockups more efficiently
              const mockupSet = new Set();
              details.result.variants.forEach(variant => {
                if (variant.files) {
                  variant.files.forEach(file => {
                    if (file.type === 'preview' && file.preview_url) {
                      mockupSet.add(file.preview_url);
                    }
                  });
                }
              });
              mockups = Array.from(mockupSet).slice(0, 5);
            }
            
            // Generate data URL for placeholder if no image
            const productImage = product.image 
              ? product.image 
              : generatePlaceholderImage(product.title);
            
            return {
              id: product.id,
              type: product.type,
              type_name: product.type_name,
              title: product.title,
              brand: product.brand,
              model: product.model,
              image: productImage,
              variant_count: variants.length,
              variants: variants,
              mockups: mockups,
              flat_lay_templates: flatLayTemplates.map(t => t.url)
            };
          })
      );

      // Cache the results
      cachedProducts = productsWithDetails;
      cacheTimestamp = now;

      console.log(`Successfully processed ${productsWithDetails.length} allowed products`);

      res.status(200).json({
        success: true,
        count: productsWithDetails.length,
        products: productsWithDetails,
        cached: false
      });

    } catch (error) {
      console.error('Error fetching Printful products:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch products',
        message: error.message
      });
    }
  });
});

// Image proxy endpoint (unchanged)
exports.proxyImage = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const imageUrl = req.query.url;
      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: 'Missing image URL'
        });
      }

      // Check if this is a flatlay image request
      if (imageUrl.includes('kauara1.web.app/images/flatlays')) {
        const fetch = require('node-fetch');
        const imageResponse = await fetch(imageUrl);
        
        if (!imageResponse.ok) {
          throw new Error('Failed to fetch image');
        }

        res.set('Content-Type', imageResponse.headers.get('content-type'));
        res.set('Cache-Control', 'public, max-age=86400');
        imageResponse.body.pipe(res);
        return;
      }

      // Original Printful image proxy logic
      const imageResponse = await fetch(imageUrl, {
        headers: {
          'Authorization': `Bearer ${PRINTFUL_API_KEY}`
        }
      });
      
      if (!imageResponse.ok) {
        const placeholder = generatePlaceholderImage('Image not available');
        res.set('Content-Type', 'image/png');
        return res.send(Buffer.from(placeholder.split(',')[1], 'base64'));
      }

      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Type', imageResponse.headers.get('content-type'));
      imageResponse.body.pipe(res);
    } catch (error) {
      console.error('Error proxying image:', error);
      const placeholder = generatePlaceholderImage('Error loading image');
      res.set('Content-Type', 'image/png');
      res.send(Buffer.from(placeholder.split(',')[1], 'base64'));
    }
  });
});