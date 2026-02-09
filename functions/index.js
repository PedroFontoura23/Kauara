const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors')({ 
  origin: [
    'https://kauara1.web.app',
    'https://www.kauara1.web.app',
    'https://kauava.com',
    'https://www.kauava.com',
    'http://localhost:5000',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// =============================================
// INITIALIZATION
// =============================================

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
  admin.firestore().settings({ 
    ignoreUndefinedProperties: true,
    timestampsInSnapshots: true
  });
}

const db = admin.firestore();

// =============================================
// CONFIGURATION & ENVIRONMENT
// =============================================

const PRINTFUL_API_KEY = functions.config().printful?.apikey || '';
const PRINTFUL_API_BASE = 'https://api.printful.com';

// Determine environment from configuration
const ENVIRONMENT_CONFIG = {
  IS_PRODUCTION: process.env.NODE_ENV === 'production' || 
                functions.config().environment?.mode === 'production',
  LOG_DETAILED: functions.config().environment?.log_detailed === 'true'
};

// Environment log
if (ENVIRONMENT_CONFIG.IS_PRODUCTION) {
  console.log('🚀 PRODUCTION MODE');
} else {
  console.log('🧪 DEVELOPMENT/TEST MODE');
}

// =============================================
// IMPORT PRINTFUNCTIONS
// =============================================

// Importar o módulo printfunctions usando require (CommonJS)
const printfunctions = require('./printfunctions.js');

// Re-exportar as funções do printfunctions
exports.getAllProducts = printfunctions.getAllProducts;
exports.getProductPricing = printfunctions.getProductPricing;
exports.getProducts = printfunctions.getProducts;
exports.proxyImage = printfunctions.proxyImage;
exports.saveProduct = printfunctions.saveProduct;
exports.saveArt = printfunctions.saveArt;

// =============================================
// IMPORT SHOP FUNCTIONS (CHECKOUT PRO)
// =============================================

const shopFunctions = require('./shopFunctions.js');

// Import all functions from shopFunctions
Object.assign(exports, shopFunctions);

// =============================================
// VALIDATION FUNCTIONS
// =============================================

/**
 * Validate email format
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate price (for future use)
 */
function validatePrice(price) {
  if (price === null || price === undefined) return false;
  
  const priceNum = typeof price === 'number' ? price : parseFloat(price);
  
  if (typeof priceNum !== 'number' || isNaN(priceNum) || !isFinite(priceNum)) {
    return false;
  }
  
  const MIN_PRICE = 0.01;
  const MAX_PRICE = 10000.00;
  
  return priceNum >= MIN_PRICE && priceNum <= MAX_PRICE;
}

// =============================================
// HEALTH CHECK ENDPOINT
// =============================================
exports.healthCheck = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        
        environment: {
          type: ENVIRONMENT_CONFIG.IS_PRODUCTION ? 'production' : 'development',
          log_detailed: ENVIRONMENT_CONFIG.LOG_DETETAILED
        },
        
        services: {
          firestore: 'connected',
          printful: {
            configured: !!PRINTFUL_API_KEY,
            enabled: true
          },
          payments: 'disabled', // Payments disabled for now
          marketplace: 'disabled' // Marketplace disabled for now
        },
        
        endpoints: {
          products: [
            '/getAllProducts',
            '/getProducts',
            '/getProductPricing',
            '/saveProduct',
            '/saveArt',
            '/proxyImage'
          ],
          health: '/healthCheck'
        },
        
        system: {
          uptime: process.uptime(),
          node_version: process.version,
          region: process.env.FUNCTION_REGION || 'unknown',
          memory_usage: process.memoryUsage()
        }
      };
      
      res.json(healthStatus);
      
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// =============================================
// SIMPLE PRODUCT CATALOG ENDPOINTS
// =============================================

/**
 * Get all products with caching
 */
exports.getCatalog = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const productsSnapshot = await db.collection('products')
        .where('status', '==', 'active')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      
      const products = [];
      productsSnapshot.forEach(doc => {
        const data = doc.data();
        products.push({
          id: doc.id,
          ...data,
          // Ensure timestamps are properly formatted
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        });
      });
      
      res.json({
        success: true,
        count: products.length,
        products: products
      });
      
    } catch (error) {
      console.error('Error getting catalog:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

/**
 * Get single product by ID
 */
exports.getProductById = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { productId } = req.query;
      
      if (!productId) {
        return res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
      }
      
      const productDoc = await db.collection('products').doc(productId).get();
      
      if (!productDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }
      
      const productData = productDoc.data();
      
      res.json({
        success: true,
        product: {
          id: productDoc.id,
          ...productData,
          createdAt: productData.createdAt?.toDate?.() || productData.createdAt,
          updatedAt: productData.updatedAt?.toDate?.() || productData.updatedAt
        }
      });
      
    } catch (error) {
      console.error('Error getting product:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

/**
 * Save product inquiry/contact form
 */
exports.saveInquiry = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { name, email, message, productId, productName } = req.body;
      
      // Basic validation
      if (!name || !email || !message) {
        return res.status(400).json({
          success: false,
          error: 'Name, email, and message are required'
        });
      }
      
      if (!validateEmail(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
      
      const inquiryData = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        message: message.trim(),
        productId: productId || null,
        productName: productName || null,
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('inquiries').add(inquiryData);
      
      console.log(`New inquiry saved from: ${email}`);
      
      res.json({
        success: true,
        message: 'Inquiry saved successfully. We will contact you soon.'
      });
      
    } catch (error) {
      console.error('Error saving inquiry:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

/**
 * Subscribe to newsletter
 */
exports.subscribeNewsletter = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { email } = req.body;
      
      if (!email || !validateEmail(email)) {
        return res.status(400).json({
          success: false,
          error: 'Valid email is required'
        });
      }
      
      const emailLower = email.trim().toLowerCase();
      
      // Check if already subscribed
      const existingQuery = await db.collection('newsletter')
        .where('email', '==', emailLower)
        .limit(1)
        .get();
      
      if (!existingQuery.empty) {
        return res.json({
          success: true,
          message: 'Already subscribed to newsletter'
        });
      }
      
      const subscriberData = {
        email: emailLower,
        subscribed: true,
        subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('newsletter').add(subscriberData);
      
      console.log(`New newsletter subscriber: ${emailLower}`);
      
      res.json({
        success: true,
        message: 'Successfully subscribed to newsletter'
      });
      
    } catch (error) {
      console.error('Error subscribing to newsletter:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// USER MANAGEMENT (BASIC)
// =============================================

/**
 * Get user profile
 */
exports.getUserProfile = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { userId } = req.query;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const userData = userDoc.data();
      
      // Return safe user data (exclude sensitive info)
      const safeUserData = {
        id: userDoc.id,
        displayName: userData.displayName || userData.user_Name || '',
        email: userData.email || '',
        profilePicture: userData.profilePicture || '',
        bio: userData.bio || '',
        website: userData.website || '',
        socialLinks: userData.socialLinks || {},
        createdAt: userData.createdAt?.toDate?.() || userData.createdAt,
        updatedAt: userData.updatedAt?.toDate?.() || userData.updatedAt
      };
      
      res.json({
        success: true,
        user: safeUserData
      });
      
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

/**
 * Update user profile
 */
exports.updateUserProfile = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { userId, displayName, bio, website, socialLinks } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      if (displayName !== undefined) updateData.displayName = displayName.trim();
      if (bio !== undefined) updateData.bio = bio.trim();
      if (website !== undefined) updateData.website = website.trim();
      if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
      
      await db.collection('users').doc(userId).update(updateData);
      
      res.json({
        success: true,
        message: 'Profile updated successfully'
      });
      
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// ANALYTICS & STATISTICS
// =============================================

/**
 * Track page view
 */
exports.trackPageView = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { page, referrer, userId } = req.body;
      
      if (!page) {
        return res.status(400).json({
          success: false,
          error: 'Page is required'
        });
      }
      
      const analyticsData = {
        page: page,
        referrer: referrer || 'direct',
        userId: userId || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userAgent: req.headers['user-agent'] || 'unknown',
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
      };
      
      await db.collection('analytics').add(analyticsData);
      
      res.json({
        success: true,
        message: 'Page view tracked'
      });
      
    } catch (error) {
      console.error('Error tracking page view:', error);
      // Don't fail the request for analytics errors
      res.json({
        success: true,
        message: 'Page view tracking skipped due to error'
      });
    }
  });
});

/**
 * Get site statistics (admin only)
 */
exports.getSiteStats = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Basic protection - in production, add proper auth
      if (ENVIRONMENT_CONFIG.IS_PRODUCTION && req.query.secret !== functions.config().admin?.secret) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized'
        });
      }
      
      // Get counts from different collections
      const [
        productsSnapshot,
        usersSnapshot,
        inquiriesSnapshot,
        newsletterSnapshot
      ] = await Promise.all([
        db.collection('products').count().get(),
        db.collection('users').count().get(),
        db.collection('inquiries').count().get(),
        db.collection('newsletter').count().get()
      ]);
      
      const stats = {
        products: productsSnapshot.data().count,
        users: usersSnapshot.data().count,
        inquiries: inquiriesSnapshot.data().count,
        newsletterSubscribers: newsletterSnapshot.data().count,
        timestamp: new Date().toISOString()
      };
      
      res.json({
        success: true,
        stats: stats
      });
      
    } catch (error) {
      console.error('Error getting site stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// INITIALIZATION LOG
// =============================================

console.log('🚀 KAUARA SYSTEM INITIALIZED');
console.log(`🔧 Environment: ${ENVIRONMENT_CONFIG.IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log('💰 Payment System: DISABLED');
console.log('🎨 Marketplace: DISABLED');
console.log('📊 Analytics: ENABLED');
console.log('📋 Total functions:', Object.keys(exports).length);

console.log('\n📋 CONFIGURATION SUMMARY:');
console.log(`   Printful: ${PRINTFUL_API_KEY ? '✅ CONFIGURED' : '⚠️ OPTIONAL'}`);
console.log(`   Environment: ${ENVIRONMENT_CONFIG.IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`   Log detail: ${ENVIRONMENT_CONFIG.LOG_DETAILED ? 'HIGH' : 'NORMAL'}`);

console.log('\n✅ SYSTEM READY - BASIC MODE');