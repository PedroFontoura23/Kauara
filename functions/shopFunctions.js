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
    success: 'https://kauava.com/success',
    failure: 'https://kauava.com/failure',
    pending: 'https://kauava.com/pending'
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
  
  return {
    isValid: errors.length === 0,
    errors,
    validatedData: {
      title: data.title.trim(),
      quantity: parseInt(data.quantity),
      unit_price: parseFloat(price.toFixed(2)),
      email: data.email.trim()
    }
  };
}

// =============================================
// CREATE CHECKOUT PRO PAYMENT
// =============================================

exports.createCheckoutProPayment = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔄 Creating Checkout Pro payment');
      
      if (!MP_CONFIGURED) {
        console.error('❌ Mercado Pago not configured');
        return res.status(500).json({
          success: false,
          error: 'Payment system not configured',
          message: 'Please contact the store administrator'
        });
      }
      
      const paymentData = req.body;
      
      console.log('📦 Payment data received:', {
        title: paymentData.title,
        amount: paymentData.unit_price,
        quantity: paymentData.quantity,
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
      
      const { title, quantity, unit_price, email } = validation.validatedData;
      
      const externalReference = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const pictureUrl = paymentData.picture_url || 
                        paymentData.product_image || 
                        'https://via.placeholder.com/300x300.png?text=Product';
      
      const preferenceData = {
        items: [
          {
            id: 'product-' + Date.now(),
            title: title,
            description: paymentData.description || `Purchase from ${STORE_OWNER.name}`,
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
          success: paymentData.return_url || STORE_OWNER.redirectUrls.success,
          failure: paymentData.cancel_url || STORE_OWNER.redirectUrls.failure,
          pending: STORE_OWNER.redirectUrls.pending
        },
        auto_return: 'approved',
        statement_descriptor: STORE_OWNER.name.substring(0, 22),
        external_reference: externalReference,
        notification_url: 'https://us-central1-kauara1.cloudfunctions.net/paymentWebhook',
        metadata: {
          source: 'kauara_shop',
          product_id: paymentData.product_id || 'custom_product',
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
      
      console.log('💰 Creating preference with external_reference:', externalReference);
      
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
        sandbox_init_point: preference.sandbox_init_point
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
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point
      };
      
      await db.collection('checkout_payments').doc(externalReference).set(paymentRecord);
      
      console.log('📝 Payment record saved:', externalReference);
      
      return res.json({
        success: true,
        preference_id: preference.id,
        external_reference: externalReference,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point
      });
      
    } catch (error) {
      console.error('❌ Error creating payment:', error);
      
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
// GET PAYMENT STATUS
// =============================================

exports.getPaymentStatus = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { external_reference } = req.query;
      
      if (!external_reference) {
        return res.status(400).json({
          success: false,
          error: 'External reference is required'
        });
      }
      
      console.log('🔍 Checking payment status for:', external_reference);
      
      const paymentDoc = await db.collection('checkout_payments').doc(externalReference).get();
      
      if (!paymentDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
      }
      
      const paymentData = paymentDoc.data();
      
      return res.json({
        success: true,
        payment: paymentData,
        last_checked: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error getting payment status:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// PAYMENT WEBHOOK (CRITICAL - #1)
// =============================================

exports.paymentWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔄 Payment webhook received');
      
      const { type, data, action } = req.body;
      
      // Log incoming webhook
      console.log('📞 Webhook details:', { type, action, data });
      
      // 1. Handle payment.created (#1 from your list)
      if (action === 'payment.created') {
        console.log('📝 Payment created webhook received');
        if (data && data.id) {
          await handlePaymentCreated(data.id);
        }
      }
      
      // 2. Handle all payment status webhooks (#2 from your list)
      else if (type === 'payment' && data && data.id) {
        const paymentId = data.id;
        console.log(`💰 Processing payment webhook: ${paymentId}`);
        
        await handlePaymentWebhook(paymentId);
      }
      
      // 3. Handle dispute/chargeback webhooks (#3 from your list)
      else if (type === 'chargeback' || type === 'dispute') {
        console.log(`⚖️ ${type} webhook received`);
        await handleDisputeWebhook(type, data, action);
      }
      
      // 4. Handle refund webhooks (#4 from your list)
      else if (type === 'refund' && action === 'refund.created') {
        console.log('↩️ Refund webhook received');
        await handleRefundWebhook(data);
      }
      
      // 6. Handle merchant order webhooks (#6 from your list)
      else if (type === 'merchant_order') {
        console.log('🛒 Merchant order webhook received');
        await handleMerchantOrderWebhook(data);
      }
      
      else {
        console.log(`ℹ️ Ignoring webhook type: ${type}, action: ${action}`);
      }
      
      return res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      // Return 200 to prevent Mercado Pago from retrying
      return res.status(200).json({ error: error.message });
    }
  });
});

// =============================================
// DISPUTE WEBHOOK (#3)
// =============================================

exports.disputeWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('⚖️ Dispute webhook received');
      
      const { type, data, action } = req.body;
      
      if (type !== 'chargeback' && type !== 'dispute') {
        console.log(`ℹ️ Ignoring non-dispute webhook: ${type}`);
        return res.status(200).json({ received: true });
      }
      
      console.log(`🛡️ ${type.toUpperCase()} Webhook:`, { action, data });
      
      await handleDisputeWebhook(type, data, action);
      
      return res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('❌ Dispute webhook error:', error);
      return res.status(200).json({ error: error.message });
    }
  });
});

// =============================================
// REFUND WEBHOOK (#4)
// =============================================

exports.refundWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('↩️ Refund webhook received');
      
      const { type, data, action } = req.body;
      
      if (type !== 'refund') {
        console.log(`ℹ️ Ignoring non-refund webhook: ${type}`);
        return res.status(200).json({ received: true });
      }
      
      console.log(`💸 Refund Action: ${action}`, { data });
      
      await handleRefundWebhook(data);
      
      return res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('❌ Refund webhook error:', error);
      return res.status(200).json({ error: error.message });
    }
  });
});

// =============================================
// MERCHANT ORDER WEBHOOK (#6)
// =============================================

exports.merchantOrderWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🛒 Merchant order webhook received');
      
      const { type, data, action } = req.body;
      
      if (type !== 'merchant_order') {
        console.log(`ℹ️ Ignoring non-merchant_order webhook: ${type}`);
        return res.status(200).json({ received: true });
      }
      
      console.log(`📦 Merchant Order ${action}:`, { data });
      
      await handleMerchantOrderWebhook(data);
      
      return res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('❌ Merchant order webhook error:', error);
      return res.status(200).json({ error: error.message });
    }
  });
});

// =============================================
// WEBHOOK HANDLER FUNCTIONS
// =============================================

async function handlePaymentCreated(paymentId) {
  try {
    console.log(`📝 Handling payment.created: ${paymentId}`);
    
    const payment = await getPaymentFromMP(paymentId);
    
    if (payment.external_reference) {
      const paymentRef = db.collection('checkout_payments').doc(payment.external_reference);
      
      await paymentRef.update({
        payment_id: payment.id,
        payment_created_at: payment.date_created,
        last_webhook: 'payment.created',
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ Payment created event recorded:', payment.external_reference);
    }
  } catch (error) {
    console.error('Error handling payment.created:', error);
  }
}

async function handlePaymentWebhook(paymentId) {
  try {
    const payment = await getPaymentFromMP(paymentId);
    
    if (!payment.external_reference) {
      console.warn('⚠️ No external_reference found in payment');
      return;
    }
    
    console.log(`💰 Payment ${paymentId} status: ${payment.status}`);
    
    const paymentRef = db.collection('checkout_payments').doc(payment.external_reference);
    
    const updateData = {
      status: payment.status,
      status_detail: payment.status_detail,
      payment_id: payment.id,
      payment_method: payment.payment_method_id,
      payment_type: payment.payment_type_id,
      transaction_amount: payment.transaction_amount,
      last_webhook: 'payment.' + payment.status,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (payment.date_approved) {
      updateData.date_approved = payment.date_approved;
    }
    
    if (payment.payer) {
      updateData.payer = {
        email: payment.payer.email,
        name: payment.payer.first_name + (payment.payer.last_name ? ' ' + payment.payer.last_name : '')
      };
    }
    
    await paymentRef.update(updateData);
    
    console.log('✅ Payment record updated:', payment.external_reference);
    
    // Handle specific status changes with detailed actions
    await handleDetailedPaymentStatus(payment.external_reference, payment.status, payment);
    
  } catch (error) {
    console.error('Error handling payment webhook:', error);
  }
}

async function handleDetailedPaymentStatus(externalReference, status, payment) {
  try {
    console.log(`🎯 Detailed handler for ${externalReference}: ${status}`);
    
    const paymentRef = db.collection('checkout_payments').doc(externalReference);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) return;
    
    const paymentData = paymentDoc.data();
    
    const handlers = {
      'approved': async () => {
        console.log('🎉 PAYMENT APPROVED - Order ready for fulfillment');
        
        await paymentRef.update({
          notification_sent: true,
          notification_sent_at: admin.firestore.FieldValue.serverTimestamp(),
          order_status: 'processing'
        });
        
        // Create detailed order record
        await db.collection('orders').doc(externalReference).set({
          ...paymentData,
          payment_details: {
            id: payment.id,
            method: payment.payment_method_id,
            installments: payment.installments,
            card_last_four: payment.card?.last_four_digits,
            payer_document: payment.payer?.identification?.number
          },
          order_status: 'processing',
          fulfillment_status: 'pending',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // TODO: Send confirmation email
        console.log('📧 Order confirmation email should be sent');
      },
      
      'rejected': async () => {
        console.log('❌ PAYMENT REJECTED - Customer payment failed');
        
        await paymentRef.update({
          failure_reason: payment.status_detail,
          retry_available: true,
          last_failure_time: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // TODO: Send payment failed email
        console.log('📧 Payment failure email should be sent');
        
        // Log failure reason for analytics
        console.log('📊 Failure reason:', payment.status_detail);
      },
      
      'pending': async () => {
        console.log('⏳ PAYMENT PENDING - Waiting for confirmation');
        
        await paymentRef.update({
          pending_since: admin.firestore.FieldValue.serverTimestamp(),
          expected_confirmation: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
        });
        
        // For bank transfers, this can take 1-2 days
        console.log('🏦 Payment pending - common for bank transfers');
      },
      
      'in_process': async () => {
        console.log('🔄 PAYMENT IN PROCESS - Under review');
        
        await paymentRef.update({
          in_process_since: admin.firestore.FieldValue.serverTimestamp()
        });
      },
      
      'cancelled': async () => {
        console.log('🚫 PAYMENT CANCELLED - By customer or timeout');
        
        await paymentRef.update({
          cancellation_time: admin.firestore.FieldValue.serverTimestamp(),
          cancellation_reason: payment.status_detail || 'customer_cancelled'
        });
        
        // TODO: Update inventory if needed
        console.log('📦 Inventory should be updated if reserved');
      },
      
      'refunded': async () => {
        console.log('↩️ PAYMENT REFUNDED - Full refund processed');
        
        await paymentRef.update({
          refund_status: 'refunded',
          refund_time: admin.firestore.FieldValue.serverTimestamp(),
          order_status: 'refunded'
        });
        
        // TODO: Send refund confirmation email
        console.log('📧 Refund confirmation email should be sent');
      },
      
      'charged_back': async () => {
        console.log('💸 PAYMENT CHARGED BACK - Fraud alert!');
        
        await paymentRef.update({
          fraud_alert: true,
          chargeback_time: admin.firestore.FieldValue.serverTimestamp(),
          order_status: 'fraud_review'
        });
        
        // Create fraud alert record
        await db.collection('fraud_alerts').add({
          payment_reference: externalReference,
          payment_id: payment.id,
          amount: payment.transaction_amount,
          payer_email: payment.payer?.email,
          reason: 'chargeback',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          status: 'needs_review'
        });
        
        console.log('🚨 FRAUD ALERT CREATED - Manual review required');
      },
      
      'in_mediation': async () => {
        console.log('⚖️ PAYMENT IN MEDIATION - Dispute resolution');
        
        await paymentRef.update({
          mediation_status: 'active',
          mediation_started: admin.firestore.FieldValue.serverTimestamp(),
          order_status: 'dispute'
        });
        
        console.log('⚖️ Dispute resolution process started');
      }
    };
    
    if (handlers[status]) {
      await handlers[status]();
    } else {
      console.log(`ℹ️ No specific handler for status: ${status}`);
    }
    
  } catch (error) {
    console.error('Error in detailed payment handler:', error);
  }
}

async function handleDisputeWebhook(type, data, action) {
  try {
    console.log(`🛡️ Handling ${type} webhook: ${action}`);
    
    let paymentId, disputeId;
    
    if (type === 'chargeback') {
      paymentId = data.payment_id;
      disputeId = data.id;
    } else if (type === 'dispute') {
      disputeId = data.id;
      // Need to get payment ID from dispute details
      const dispute = await getDisputeFromMP(disputeId);
      paymentId = dispute.payment_id;
    }
    
    if (!paymentId) {
      console.error('❌ No payment ID found in dispute data');
      return;
    }
    
    // Get payment to find external reference
    const payment = await getPaymentFromMP(paymentId);
    
    if (!payment.external_reference) {
      console.error('❌ No external reference found for disputed payment');
      return;
    }
    
    const paymentRef = db.collection('checkout_payments').doc(payment.external_reference);
    
    const disputeRecord = {
      type: type,
      action: action,
      dispute_id: disputeId,
      payment_id: paymentId,
      status: data.status || 'created',
      amount: data.amount || payment.transaction_amount,
      reason: data.reason || 'unknown',
      received_at: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await paymentRef.update({
      dispute: disputeRecord,
      has_dispute: true,
      order_status: 'dispute',
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create separate dispute record
    await db.collection('disputes').doc(disputeId).set({
      ...disputeRecord,
      payment_reference: payment.external_reference,
      customer_email: payment.payer?.email,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ ${type.toUpperCase()} recorded:`, disputeId);
    
  } catch (error) {
    console.error('Error handling dispute webhook:', error);
  }
}

async function handleRefundWebhook(data) {
  try {
    console.log('💸 Handling refund webhook');
    
    const paymentId = data.payment_id;
    const refundId = data.id;
    
    if (!paymentId || !refundId) {
      console.error('❌ Missing payment_id or refund_id in refund data');
      return;
    }
    
    const payment = await getPaymentFromMP(paymentId);
    
    if (!payment.external_reference) {
      console.error('❌ No external reference found for refunded payment');
      return;
    }
    
    const paymentRef = db.collection('checkout_payments').doc(payment.external_reference);
    
    const refundRecord = {
      refund_id: refundId,
      amount: data.amount || payment.transaction_amount,
      status: data.status || 'approved',
      refunded_at: admin.firestore.FieldValue.serverTimestamp(),
      source: data.source || 'mercadopago'
    };
    
    await paymentRef.update({
      refund: refundRecord,
      refund_status: 'refunded',
      order_status: 'refunded',
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Refund recorded:', { refundId, amount: refundRecord.amount });
    
  } catch (error) {
    console.error('Error handling refund webhook:', error);
  }
}

async function handleMerchantOrderWebhook(data) {
  try {
    console.log('📦 Handling merchant order webhook');
    
    const orderId = data.id;
    
    if (!orderId) {
      console.error('❌ No order ID in merchant order data');
      return;
    }
    
    // Get merchant order details from MP
    const order = await getMerchantOrderFromMP(orderId);
    
    console.log('🛒 Merchant Order Details:', {
      id: order.id,
      status: order.status,
      total_amount: order.total_amount,
      payments: order.payments?.length || 0
    });
    
    // If there are payments, update their records
    if (order.payments && order.payments.length > 0) {
      for (const paymentInfo of order.payments) {
        const payment = await getPaymentFromMP(paymentInfo.id);
        
        if (payment.external_reference) {
          const paymentRef = db.collection('checkout_payments').doc(payment.external_reference);
          
          await paymentRef.update({
            merchant_order_id: order.id,
            merchant_order_status: order.status,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
          });
          
          console.log('✅ Linked payment to merchant order:', payment.external_reference);
        }
      }
    }
    
    // Store merchant order record
    await db.collection('merchant_orders').doc(orderId.toString()).set({
      id: order.id,
      status: order.status,
      total_amount: order.total_amount,
      items: order.items || [],
      payments: order.payments || [],
      shipments: order.shipments || [],
      created_at: order.date_created,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Merchant order saved:', orderId);
    
  } catch (error) {
    console.error('Error handling merchant order webhook:', error);
  }
}

// =============================================
// MP API HELPER FUNCTIONS
// =============================================

async function getPaymentFromMP(paymentId) {
  try {
    const response = await axios.get(
      `${MP_API_BASE}/v1/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error getting payment from MP:', error.message);
    throw error;
  }
}

async function getDisputeFromMP(disputeId) {
  try {
    const response = await axios.get(
      `${MP_API_BASE}/v1/chargebacks/${disputeId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error getting dispute from MP:', error.message);
    throw error;
  }
}

async function getMerchantOrderFromMP(orderId) {
  try {
    const response = await axios.get(
      `${MP_API_BASE}/merchant_orders/${orderId}`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error getting merchant order from MP:', error.message);
    throw error;
  }
}

// =============================================
// ADDITIONAL FUNCTIONS (existing but updated)
// =============================================

exports.getPaymentMethods = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (!MP_CONFIGURED) {
        return res.status(500).json({
          success: false,
          error: 'Mercado Pago not configured'
        });
      }
      
      console.log('💳 Fetching available payment methods');
      
      const response = await axios.get(
        `${MP_API_BASE}/v1/payment_methods`,
        {
          headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
          }
        }
      );
      
      const paymentMethods = response.data;
      
      const brMethods = paymentMethods
        .filter(method => method.id !== 'account_money')
        .map(method => ({
          id: method.id,
          name: method.name,
          payment_type_id: method.payment_type_id,
          thumbnail: method.secure_thumbnail,
          min_accreditation_time: method.min_accreditation_time,
          max_accreditation_time: method.max_accreditation_time
        }));
      
      console.log(`✅ Found ${brMethods.length} payment methods`);
      
      return res.json({
        success: true,
        country: 'BR',
        payment_methods: brMethods
      });
      
    } catch (error) {
      console.error('❌ Error getting payment methods:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

exports.refundPayment = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: No token provided'
        });
      }
      
      const token = authHeader.split('Bearer ')[1];
      let decodedToken;
      
      try {
        decodedToken = await admin.auth().verifyIdToken(token);
      } catch (authError) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid token'
        });
      }
      
      const { payment_id, amount } = req.body;
      
      if (!payment_id) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required'
        });
      }
      
      if (!MP_CONFIGURED) {
        return res.status(500).json({
          success: false,
          error: 'Mercado Pago not configured'
        });
      }
      
      console.log(`↩️ Processing refund for payment: ${payment_id}`);
      
      const refundData = amount ? { amount: parseFloat(amount) } : {};
      
      const response = await axios.post(
        `${MP_API_BASE}/v1/payments/${payment_id}/refunds`,
        refundData,
        {
          headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const refund = response.data;
      
      console.log('✅ Refund created:', {
        id: refund.id,
        status: refund.status,
        amount: refund.amount
      });
      
      await db.collection('checkout_payments')
        .where('payment_id', '==', payment_id)
        .limit(1)
        .get()
        .then(async querySnapshot => {
          if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            await doc.ref.update({
              refund_status: 'refunded',
              refund_id: refund.id,
              refund_amount: refund.amount || refundData.amount,
              refunded_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        });
      
      return res.json({
        success: true,
        refund_id: refund.id,
        status: refund.status,
        amount: refund.amount
      });
      
    } catch (error) {
      console.error('❌ Error processing refund:', error);
      
      let errorMessage = 'Failed to process refund';
      if (error.response) {
        errorMessage = formatMercadoPagoError(error);
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  });
});

exports.getOrderHistory = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { 
        limit = 50, 
        offset = 0, 
        status, 
        start_date, 
        end_date,
        customer_email 
      } = req.query;
      
      let query = db.collection('checkout_payments');
      
      if (status) {
        query = query.where('status', '==', status);
      }
      
      if (customer_email) {
        query = query.where('customer_email', '==', customer_email);
      }
      
      if (start_date) {
        const start = new Date(start_date);
        query = query.where('created_at', '>=', start);
      }
      
      if (end_date) {
        const end = new Date(end_date);
        end.setHours(23, 59, 59, 999);
        query = query.where('created_at', '<=', end);
      }
      
      const snapshot = await query
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit))
        .offset(parseInt(offset))
        .get();
      
      const payments = [];
      let totalAmount = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data();
        payments.push({
          id: doc.id,
          ...data,
          created_at: data.created_at?.toDate?.() || data.created_at,
          updated_at: data.updated_at?.toDate?.() || data.updated_at
        });
        totalAmount += data.total_amount || 0;
      });
      
      const totalQuery = await query.count().get();
      const totalCount = totalQuery.data().count;
      
      return res.json({
        success: true,
        count: payments.length,
        total_count: totalCount,
        total_amount: totalAmount,
        payments: payments
      });
      
    } catch (error) {
      console.error('❌ Error getting order history:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

exports.debugCheckoutPro = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const token = MP_ACCESS_TOKEN;
      
      if (!token) {
        return res.json({
          configured: false,
          error: 'No access token configured'
        });
      }
      
      const isTestToken = token.startsWith('TEST-');
      const isProdToken = token.startsWith('APP_USR-');
      
      return res.json({
        configured: true,
        environment: isTestToken ? 'SANDBOX' : 'PRODUCTION',
        has_public_key: !!MP_PUBLIC_KEY,
        webhooks_configured: {
          paymentWebhook: true,
          disputeWebhook: true,
          refundWebhook: true,
          merchantOrderWebhook: true
        },
        store_owner: STORE_OWNER.name,
        redirect_urls: STORE_OWNER.redirectUrls
      });
      
    } catch (error) {
      return res.status(500).json({
        error: error.message
      });
    }
  });
});

console.log('🛒 ENHANCED CHECKOUT PRO FUNCTIONS INITIALIZED');
console.log(`💰 Mercado Pago: ${MP_CONFIGURED ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
if (MP_CONFIGURED) {
  console.log(`🔑 Environment: ${MP_ACCESS_TOKEN.startsWith('TEST-') ? 'SANDBOX' : 'PRODUCTION'}`);
}
console.log('🏪 Store Owner:', STORE_OWNER.name);
console.log('📡 Webhooks Available:');
console.log('  - paymentWebhook (handles: payment.created, payment.updated, etc.)');
console.log('  - disputeWebhook (handles: chargeback.*, dispute.*)');
console.log('  - refundWebhook (handles: refund.*)');
console.log('  - merchantOrderWebhook (handles: merchant_order.*)');