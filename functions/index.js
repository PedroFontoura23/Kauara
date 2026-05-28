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

const ENVIRONMENT_CONFIG = {
  IS_PRODUCTION: process.env.NODE_ENV === 'production' ||
    functions.config().environment?.mode === 'production',
  LOG_DETAILED: functions.config().environment?.log_detailed === 'true'
};

if (ENVIRONMENT_CONFIG.IS_PRODUCTION) {
  console.log('🚀 PRODUCTION MODE');
} else {
  console.log('🧪 DEVELOPMENT/TEST MODE');
}

// =============================================
// IMPORT DIMONA FUNCTIONS (FULFILLMENT ONLY)
// =============================================
const dimonafunctions = require('./dimona-functions.js');
exports.getDimonaProducts         = dimonafunctions.getDimonaProducts;
exports.createDimonaOrderManually = dimonafunctions.createDimonaOrderManually;
exports.saveProductDimona         = dimonafunctions.saveProductDimona;
exports.getDimonaShipping         = dimonafunctions.getDimonaShipping;
exports.getDimonaOrderStatus      = dimonafunctions.getDimonaOrderStatus;
exports.dimonaWebhook             = dimonafunctions.dimonaWebhook;

// =============================================
// IMPORT SHOP FUNCTIONS (PAYMENT & ORDERS)
// =============================================
const shopfunctions = require('./shopFunctions.js');
exports.createCheckoutProPayment  = shopfunctions.createCheckoutProPayment;
exports.paymentWebhook            = shopfunctions.paymentWebhook;
exports.getPaymentStatus          = shopfunctions.getPaymentStatus;
exports.getOrderDetails           = shopfunctions.getOrderDetails;
exports.getUserOrders             = shopfunctions.getUserOrders;
exports.getUserOrdersByUserId     = shopfunctions.getUserOrdersByUserId;
exports.getUserOrdersV2           = shopfunctions.getUserOrdersV2;
exports.saveUserCart              = shopfunctions.saveUserCart;
exports.getUserCart               = shopfunctions.getUserCart;
exports.moveOrderToPurchased      = shopfunctions.moveOrderToPurchased;

// =============================================
// HELPER FUNCTIONS
// =============================================

function validatePrice(price) {
  if (price === null || price === undefined) return false;
  const priceNum = typeof price === 'number' ? price : parseFloat(price);
  if (typeof priceNum !== 'number' || isNaN(priceNum) || !isFinite(priceNum)) return false;
  const MIN_PRICE = 0.01;
  const MAX_PRICE = 10000.00;
  return priceNum >= MIN_PRICE && priceNum <= MAX_PRICE;
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// =============================================
// AUTH MIDDLEWARE
// =============================================
async function verifyAuthToken(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ success: false, error: 'Unauthorized: missing token' });
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
    res.status(401).json({ success: false, error: 'Unauthorized: invalid token' });
    return null;
  }
}

// =============================================
// PRODUCT CATALOG
// =============================================

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
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        });
      });

      res.json({ success: true, count: products.length, products });
    } catch (error) {
      console.error('Error getting catalog:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

exports.getProductById = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { productId } = req.query;

      if (!productId) {
        return res.status(400).json({ success: false, error: 'Product ID is required' });
      }

      const productDoc = await db.collection('products').doc(productId).get();

      if (!productDoc.exists) {
        return res.status(404).json({ success: false, error: 'Product not found' });
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
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

// =============================================
// INQUIRY FORM
// =============================================

exports.saveInquiry = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { name, email, message, productId, productName } = req.body;

      if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
      }

      if (!validateEmail(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }

      const inquiryData = {
        name: name.trim().slice(0, 100),
        email: email.trim().toLowerCase(),
        message: message.trim().slice(0, 2000),
        productId: productId || null,
        productName: productName ? productName.trim().slice(0, 200) : null,
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('inquiries').add(inquiryData);

      res.json({ success: true, message: 'Inquiry saved successfully. We will contact you soon.' });
    } catch (error) {
      console.error('Error saving inquiry:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// =============================================
// NEWSLETTER
// =============================================

exports.subscribeNewsletter = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { email } = req.body;

      if (!email || !validateEmail(email)) {
        return res.status(400).json({ success: false, error: 'Valid email is required' });
      }

      const emailLower = email.trim().toLowerCase();

      const existingQuery = await db.collection('newsletter')
        .where('email', '==', emailLower)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        return res.json({ success: true, message: 'Already subscribed to newsletter' });
      }

      await db.collection('newsletter').add({
        email: emailLower,
        subscribed: true,
        subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({ success: true, message: 'Successfully subscribed to newsletter' });
    } catch (error) {
      console.error('Error subscribing to newsletter:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

// =============================================
// USER PROFILE
// =============================================

exports.getUserProfile = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required' });
      }

      const userDoc = await db.collection('users').doc(userId).get();

      if (!userDoc.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const userData = userDoc.data();

      const safeUserData = {
        id: userDoc.id,
        displayName: userData.displayName || userData.user_Name || '',
        profilePicture: userData.profilePicture || '',
        bio: userData.bio || '',
        website: userData.website || '',
        socialLinks: userData.socialLinks || {},
        createdAt: userData.createdAt?.toDate?.() || userData.createdAt
      };

      res.json({ success: true, user: safeUserData });
    } catch (error) {
      console.error('Error getting user profile:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

exports.updateUserProfile = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const decoded = await verifyAuthToken(req, res);
    if (!decoded) return;

    try {
      const { displayName, bio, website, socialLinks } = req.body;

      const userQuery = await db.collection('users')
        .where('firebaseUID', '==', decoded.uid)
        .limit(1)
        .get();

      if (userQuery.empty) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const userDocId = userQuery.docs[0].id;

      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (displayName !== undefined) updateData.displayName = String(displayName).trim().slice(0, 50);
      if (bio !== undefined) updateData.bio = String(bio).trim().slice(0, 500);

      if (website !== undefined) {
        if (website === '') {
          updateData.website = '';
        } else if (validateUrl(website)) {
          updateData.website = website.trim();
        } else {
          return res.status(400).json({ success: false, error: 'Invalid website URL' });
        }
      }

      if (socialLinks !== undefined) {
        if (typeof socialLinks !== 'object' || Array.isArray(socialLinks)) {
          return res.status(400).json({ success: false, error: 'socialLinks must be an object' });
        }
        const sanitized = {};
        const ALLOWED_KEYS = ['instagram', 'twitter', 'linkedin', 'tiktok', 'youtube', 'facebook'];
        for (const key of ALLOWED_KEYS) {
          if (socialLinks[key] !== undefined) {
            const val = String(socialLinks[key]).trim();
            if (val && !validateUrl(val)) {
              return res.status(400).json({ success: false, error: `Invalid URL for socialLinks.${key}` });
            }
            sanitized[key] = val;
          }
        }
        updateData.socialLinks = sanitized;
      }

      await db.collection('users').doc(userDocId).update(updateData);

      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

// =============================================
// ANALYTICS
// =============================================

exports.trackPageView = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { page, referrer, userId } = req.body;

      if (!page || typeof page !== 'string') {
        return res.status(400).json({ success: false, error: 'Page is required' });
      }

      const analyticsData = {
        page: page.slice(0, 200),
        referrer: (referrer || 'direct').slice(0, 500),
        userId: userId || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userAgent: (req.headers['user-agent'] || 'unknown').slice(0, 300),
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
      };

      await db.collection('analytics').add(analyticsData);

      res.json({ success: true, message: 'Page view tracked' });
    } catch (error) {
      console.error('Error tracking page view:', error);
      res.json({ success: true, message: 'Page view tracking skipped due to error' });
    }
  });
});

exports.getSiteStats = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const decoded = await verifyAuthToken(req, res);
    if (!decoded) return;

    if (!decoded.admin) {
      return res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
    }

    try {
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

      res.json({
        success: true,
        stats: {
          products: productsSnapshot.data().count,
          users: usersSnapshot.data().count,
          inquiries: inquiriesSnapshot.data().count,
          newsletterSubscribers: newsletterSnapshot.data().count,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting site stats:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
});

// =============================================
// INITIALIZATION LOG
// =============================================
console.log('🚀 KAUARA SYSTEM INITIALIZED');
console.log(`🔧 Environment: ${ENVIRONMENT_CONFIG.IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log('📋 Total functions:', Object.keys(exports).length);