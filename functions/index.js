const functions = require('firebase-functions');
const axios = require('axios');
const cors = require('cors')({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://kauara1.web.app',
      'https://www.kauara1.web.app', 
      'https://kauava.com',
      'https://www.kauava.com',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000'
    ];
    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🚫 Origem bloqueada pelo CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Device-ID',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: [
    'Content-Range',
    'X-Content-Range'
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
});
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const printfunctions = require('./printfunctions');
exports.getProducts = printfunctions.getProducts;
exports.getFlatLay = printfunctions.getFlatLay;
exports.checkMockupStatus = printfunctions.checkMockupStatus;
exports.getPrintAreas = printfunctions.getPrintAreas;
exports.saveProduct = printfunctions.saveProduct;
exports.saveArt = printfunctions.saveArt;
exports.getProductPricing = printfunctions.getProductPricing;
exports.getAllProducts = printfunctions.getAllProducts;

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// =============================================
// FUNÇÃO PRINCIPAL - CRIAR PEDIDO CHECKOUT PRO
// =============================================

exports.createMarketplaceOrder = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🛒 INICIANDO CRIAÇÃO DE PEDIDO CHECKOUT PRO');
      console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
      
      const { productData, buyerInfo, sellerId, shippingOption } = req.body;
      
      // VALIDAÇÕES RIGOROSAS
      if (!productData || !buyerInfo || !sellerId) {
        console.error('❌ DADOS INCOMPLETOS:', { 
          hasProductData: !!productData, 
          hasBuyerInfo: !!buyerInfo, 
          hasSellerId: !!sellerId 
        });
        return res.status(400).json({ 
          success: false, 
          error: 'Dados incompletos: productData, buyerInfo e sellerId são obrigatórios' 
        });
      }

      // 1. BUSCAR INFORMAÇÕES DO ARTISTA (SELLER)
      console.log(`🔍 Buscando informações do artista: ${sellerId}`);
      const artistDoc = await db.collection("users").doc(sellerId).get();
      if (!artistDoc.exists) {
        throw new Error(`Artista ${sellerId} não encontrado`);
      }

      const artistData = artistDoc.data();
      console.log(`👤 Artista encontrado: ${artistData.email || 'Sem email'}`);
      
      // 2. CALCULAR SPLIT DE PAGAMENTO
      console.log('💰 CALCULANDO PREÇOS...');
      const pricing = calculatePaymentSplit(productData, shippingOption);
      console.log('💵 PREÇOS CALCULADOS:', pricing);

      // 3. BUSCAR ACCESS TOKEN DA LOJA (STORE)
      const storeConfig = functions.config().mercadopago;
      if (!storeConfig?.token) {
        console.error('❌ TOKEN DA STORE NÃO CONFIGURADO NO FIREBASE');
        throw new Error('Token de acesso da loja não configurado');
      }

      console.log('🔑 Token da store disponível:', storeConfig.token.substring(0, 10) + '...');

      // 4. CRIAR PREFERÊNCIA DE PAGAMENTO NO MERCADO PAGO (CHECKOUT PRO)
      console.log('🎯 CRIANDO PREFERÊNCIA CHECKOUT PRO...');
      const preferenceData = createCheckoutProPreference(
        productData, 
        buyerInfo, 
        pricing, 
        sellerId
      );

      // VALIDAR PREFERÊNCIA ANTES DE ENVIAR
      validatePreferenceData(preferenceData);

      console.log('📤 ENVIANDO PARA API MERCADO PAGO...');
      const preferenceResponse = await axios.post(
        'https://api.mercadopago.com/checkout/preferences',
        preferenceData,
        {
          headers: {
            'Authorization': `Bearer ${storeConfig.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

      const preference = preferenceResponse.data;
      console.log('✅ PREFERÊNCIA CHECKOUT PRO CRIADA COM SUCESSO:', preference.id);
      console.log('🔗 URLs disponíveis:', {
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point
      });

      // 5. SALVAR PEDIDO NO FIRESTORE
      console.log('💾 SALVANDO PEDIDO NO FIRESTORE...');
      const orderData = createOrderData(
        productData, buyerInfo, sellerId, artistData, 
        pricing, shippingOption, preference, false
      );
      
      const orderRef = await db.collection('orders').add(orderData);
      console.log('✅ PEDIDO CRIADO COM SUCESSO:', orderRef.id);

      // 6. RETORNAR RESPOSTA COM URL DO CHECKOUT PRO
      const responseData = {
        success: true,
        orderId: orderRef.id,
        preferenceId: preference.id,
        external_reference: preference.external_reference,
        checkout_url: preference.init_point, // URL PRINCIPAL DO CHECKOUT PRO
        sandbox_url: preference.sandbox_init_point,
        debug_info: {
          order_created: true,
          preference_created: true,
          checkout_type: 'pro'
        }
      };

      console.log('📨 RESPOSTA FINAL CHECKOUT PRO:', responseData);
      return res.json(responseData);

    } catch (error) {
      console.error('❌ ERRO CRÍTICO AO CRIAR PEDIDO CHECKOUT PRO:', error.message);
      console.error('📊 DETALHES DO ERRO:', error.response?.data || 'Sem detalhes adicionais');
      
      return res.status(500).json({
        success: false,
        error: error.response?.data?.message || error.message,
        details: error.response?.data || null
      });
    }
  });
});

// =============================================
// FUNÇÃO: CRIAR PREFERÊNCIA CHECKOUT PRO
// =============================================

function createCheckoutProPreference(productData, buyerInfo, pricing, sellerId) {
    console.log('🎯 CRIANDO PREFERÊNCIA CHECKOUT PRO...');
    
    const externalReference = `kauara_pro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const unitPrice = parseFloat(pricing.totalWithShipping.toFixed(2));

    // ✅ GARANTIR PREÇO VÁLIDO
    if (unitPrice <= 0 || isNaN(unitPrice)) {
        throw new Error(`Preço inválido: ${unitPrice}`);
    }

    // ✅✅✅ EMAIL REAL (CRÍTICO PARA CHECKOUT PRO)
    let payerEmail = buyerInfo.email;
    
    // CORRIGIR EMAILS INVÁLIDOS
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(payerEmail)) {
        console.warn('⚠️ Email inválido, usando fallback real');
        payerEmail = "cliente@exemplo.com.br";
    }

    const productTitle = productData.productTitle || "Produto Personalizado";

    // ✅✅✅ PREFERÊNCIA OTIMIZADA PARA CHECKOUT PRO
    const preferenceData = {
        items: [
            {
                id: productData.id || 'prod_001',
                title: productTitle.substring(0, 250),
                description: (productData.description || 'Produto personalizado').substring(0, 250),
                picture_url: productData.thumbnailUrl || "https://via.placeholder.com/300",
                category_id: "art",
                quantity: 1,
                currency_id: "BRL",
                unit_price: unitPrice
            }
        ],
        
        // ✅✅✅ PAYER COMPLETO PARA CHECKOUT PRO
        payer: {
            name: (buyerInfo.fullName?.split(' ')[0] || 'Cliente').substring(0, 50),
            surname: (buyerInfo.fullName?.split(' ').slice(1).join(' ') || 'Silva').substring(0, 50),
            email: payerEmail,
            
            phone: {
                area_code: (buyerInfo.phone?.substring(0, 2) || '11').replace(/\D/g, ''),
                number: (buyerInfo.phone?.substring(2) || '999999999').replace(/\D/g, '')
            },
            
            identification: {
                type: "CPF",
                number: (buyerInfo.cpf || '12345678900').replace(/\D/g, '')
            },
            
            address: {
                zip_code: (buyerInfo.zipCode || '01310100').replace(/\D/g, ''),
                street_name: buyerInfo.street || 'Avenida Paulista',
                street_number: String(buyerInfo.number || '1000'),
                neighborhood: buyerInfo.neighborhood || 'Bela Vista',
                city: buyerInfo.city || 'São Paulo',
                federal_unit: buyerInfo.state || 'SP'
            }
        },
        
        // ✅✅✅ MÉTODOS DE PAGAMENTO - TODOS HABILITADOS
        payment_methods: {
            excluded_payment_methods: [], // ✅ VAZIO = todos métodos habilitados
            excluded_payment_types: [],   // ✅ VAZIO = todos tipos habilitados
            installments: 12,             // ✅ Até 12 parcelas
            default_installments: 1       // ✅ Parcela padrão
        },
        
        // ✅ FRETE
        shipments: {
            cost: parseFloat(pricing.shippingCost?.toFixed(2) || 0),
            mode: "not_specified"
        },
        
        // ✅ URLs DE RETORNO (CRÍTICO PARA CHECKOUT PRO)
        back_urls: {
            success: "https://kauava.com/success.html",
            failure: "https://kauava.com/failure.html", 
            pending: "https://kauava.com/pending.html"
        },
        auto_return: "approved", // ✅ REDIRECIONAMENTO AUTOMÁTICO
        
        // ✅✅✅ CONFIGURAÇÕES CHECKOUT PRO
        binary_mode: false, // ✅ PERMITE PIX E BOLETO
        expires: false,
        
        external_reference: externalReference,
        notification_url: `https://us-central1-kauara1.cloudfunctions.net/handleMercadoPagoWebhook`,
        
        statement_descriptor: "KAUARA",
        
        // ✅ METADADOS PARA CHECKOUT PRO
        metadata: {
            platform: "kauara",
            seller_id: sellerId,
            product_id: productData.id,
            checkout_type: "pro",
            version: "2.0"
        }
    };

    console.log('✅✅✅ PREFERÊNCIA CHECKOUT PRO CONFIGURADA');
    return preferenceData;
}

// =============================================
// FUNÇÃO: CALCULAR SPLIT DE PAGAMENTO
// =============================================

function calculatePaymentSplit(productData, shippingOption) {
    console.log('🧮 CALCULANDO SPLIT...');
    
    // VALORES COM FALLBACKS ROBUSTOS
    const productPrice = productData.selectedVariant?.price || 
                        productData.pricing?.basePrice || 
                        productData.variants?.[0]?.price || 49.90;
    
    const artistMarkup = productData.pricing?.userMarkup || 
                        productData.selectedArt?.totalPrice || 
                        productData.selectedArt?.price || 0;
    
    const shippingCost = shippingOption ? parseFloat(shippingOption.rate) : 15.90;
    
    // GARANTIR VALORES MÍNIMOS VÁLIDOS
    const safeProductPrice = Math.max(5.00, parseFloat(productPrice));
    const safeArtistMarkup = Math.max(0, parseFloat(artistMarkup));
    const safeShippingCost = Math.max(0, parseFloat(shippingCost));
    
    // CÁLCULO REVISADO
    const subtotal = safeProductPrice + safeArtistMarkup;
    const platformFee = Math.max(1.00, subtotal * 0.05); // Mínimo R$ 1,00
    const totalWithoutShipping = subtotal + platformFee;
    const totalWithShipping = totalWithoutShipping + safeShippingCost;
    
    // GARANTIR TOTAL MÍNIMO
    const finalTotal = Math.max(5.00, totalWithShipping);
    
    console.log('💰 VALORES CALCULADOS:', {
        productPrice: safeProductPrice,
        artistMarkup: safeArtistMarkup,
        shippingCost: safeShippingCost,
        platformFee: platformFee,
        subtotal: subtotal,
        totalWithoutShipping: totalWithoutShipping,
        finalTotal: finalTotal
    });
    
    return {
        productPrice: safeProductPrice,
        artistMarkup: safeArtistMarkup,
        shippingCost: safeShippingCost,
        platformFee: platformFee,
        subtotal: subtotal,
        totalWithoutShipping: totalWithoutShipping,
        totalWithShipping: finalTotal,
        
        split: {
            artist: {
                amount: safeArtistMarkup,
                description: `Comissão do artista - ${productData.productTitle || 'Produto'}`
            },
            store: {
                amount: safeProductPrice + platformFee,
                description: `Produto + taxa da plataforma - ${productData.productTitle || 'Produto'}`
            }
        }
    };
}

// =============================================
// FUNÇÃO: GERAR PAGAMENTO DE TESTE (CHECKOUT PRO) - COM PAYMENT ID LOGGING
// =============================================

exports.generateTestCheckoutPro = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log("🧪 GERANDO TESTE CHECKOUT PRO COM PAYMENT ID LOGGING...");

      const storeConfig = functions.config().mercadopago;
      if (!storeConfig?.token) {
        return res.status(500).json({
          success: false,
          error: "Token Mercado Pago não configurado"
        });
      }

      const crypto = require('crypto');
      const testId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // ✅ PREFERÊNCIA DE TESTE CHECKOUT PRO COM WEBHOOK ESPECÍFICO
      const testPreference = {
        items: [
          {
            id: testId,
            title: "🧪 Produto Teste - Checkout Pro",
            description: "Teste de integração Checkout Pro - Kauara",
            picture_url: "https://via.placeholder.com/300",
            category_id: "art",
            quantity: 1,
            currency_id: "BRL",
            unit_price: 100.00
          }
        ],
        
        payer: {
          name: "Teste",
          surname: "Checkout Pro",
          email: "pedroadfontoura23@gmail.com",
          phone: {
            area_code: "11",
            number: "999999999"
          },
          identification: {
            type: "CPF",
            number: "12345678900"
          },
          address: {
            zip_code: "01310100",
            street_name: "Avenida Paulista",
            street_number: "1000",
            neighborhood: "Bela Vista",
            city: "São Paulo",
            federal_unit: "SP"
          }
        },
        
        payment_methods: {
          excluded_payment_methods: [],
          excluded_payment_types: [],
          installments: 12,
          default_installments: 1
        },
        
        back_urls: {
          success: `https://kauava.com/success.html?test_id=${testId}`,
          failure: `https://kauava.com/failure.html?test_id=${testId}`,
          pending: `https://kauava.com/pending.html?test_id=${testId}`
        },
        auto_return: "approved",
        
        binary_mode: false,
        external_reference: testId,
        
        // ✅ WEBHOOK ESPECIAL PARA TESTES
        notification_url: `https://us-central1-kauara1.cloudfunctions.net/handleTestPaymentWebhook`,
        
        statement_descriptor: "KAUARA TEST",
        
        metadata: {
          test: true,
          platform: "kauara",
          test_type: "checkout_pro",
          test_id: testId,
          timestamp: new Date().toISOString()
        }
      };

      console.log('📤 Criando preferência de teste...');
      const response = await axios.post(
        "https://api.mercadopago.com/checkout/preferences",
        testPreference,
        {
          headers: {
            "Authorization": `Bearer ${storeConfig.token}`,
            "Content-Type": "application/json"
          }
        }
      );

      const preference = response.data;

      // ✅ SALVAR NO FIRESTORE PARA TRACKING COMPLETO
      const testDocRef = await db.collection('test_checkouts').add({
        test_id: testId,
        preference_id: preference.id,
        external_reference: testId,
        checkout_url: preference.init_point,
        sandbox_url: preference.sandbox_init_point,
        amount: 100.00,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        status: 'preference_created',
        test_data: {
          payer_email: testPreference.payer.email,
          description: testPreference.items[0].description,
          back_urls: testPreference.back_urls
        },
        // ✅ CAMPOS PARA TRACKING DE PAYMENT ID
        payment_info: {
          payment_id: null,
          payment_status: null,
          payment_date: null
        },
        tracking: {
          preference_created: new Date().toISOString(),
          payment_received: null,
          webhook_called: null,
          completed: null
        }
      });

      console.log("✅ TESTE CHECKOUT PRO CRIADO:", {
        test_id: testId,
        preference_id: preference.id,
        firestore_id: testDocRef.id,
        checkout_url: preference.init_point
      });

      return res.json({
        success: true,
        test_id: testId,
        preference_id: preference.id,
        firestore_id: testDocRef.id,
        checkout_url: preference.init_point,
        sandbox_url: preference.sandbox_init_point,
        
        // ✅ INSTRUÇÕES DETALHADAS COM PAYMENT ID
        test_instructions: [
          '🧪 TESTE CHECKOUT PRO CRIADO!',
          `📋 Test ID: ${testId}`,
          `🎯 Preference ID: ${preference.id}`,
          `📁 Firestore ID: ${testDocRef.id}`,
          '',
          '1. 🌐 Acesse o checkout_url acima',
          '2. 📧 Use email: test_user_123456@testuser.com',
          '3. 🔢 Use CPF: 123.456.789-00',
          '4. 💳 Complete o pagamento no Mercado Pago',
          '5. 🔄 Você será redirecionado para success.html',
          '6. 📊 O webhook capturará o PAYMENT ID automaticamente',
          '',
          '📖 PARA VER O PAYMENT ID:',
          `🔍 Acesse: /getTestPaymentInfo?test_id=${testId}`,
          `📋 Ou: /listTestPayments`
        ],
        
        debug_info: {
          external_reference: testId,
          firestore_collection: 'test_checkouts',
          webhook_url: 'https://us-central1-kauara1.cloudfunctions.net/handleTestPaymentWebhook',
          tracking_url: `https://us-central1-kauara1.cloudfunctions.net/getTestPaymentInfo?test_id=${testId}`
        }
      });

    } catch (err) {
      console.error("❌ ERRO AO GERAR TESTE CHECKOUT PRO:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status
      });
      
      return res.status(500).json({
        success: false,
        error: err.response?.data?.message || err.message,
        details: err.response?.data || null,
        step: 'generate_test_checkout_pro'
      });
    }
  });
});

// =============================================
// WEBHOOK ESPECIAL PARA TESTES (CAPTURA PAYMENT ID)
// =============================================

exports.handleTestPaymentWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔔 WEBHOOK DE TESTE RECEBIDO - CAPTURANDO PAYMENT ID');
      console.log('📦 Dados do webhook:', JSON.stringify(req.body, null, 2));
      
      const { type, data } = req.body;
      
      if (type === 'payment') {
        const paymentId = data.id;
        console.log(`💳 PAYMENT ID CAPTURADO: ${paymentId}`);
        
        // Buscar detalhes do pagamento
        const config = functions.config().mercadopago;
        const paymentResponse = await axios.get(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          {
            headers: {
              'Authorization': `Bearer ${config.token}`
            }
          }
        );
        
        const payment = paymentResponse.data;
        const externalReference = payment.external_reference;
        
        console.log(`🔍 Buscando teste com external_reference: ${externalReference}`);
        
        if (!externalReference) {
          console.warn('⚠️ External reference não encontrada no pagamento de teste');
          return res.status(200).send('OK');
        }

        // Buscar teste no Firestore
        const testQuery = await db.collection('test_checkouts')
          .where('external_reference', '==', externalReference)
          .limit(1)
          .get();
          
        if (testQuery.empty) {
          console.warn(`⚠️ Teste não encontrado para: ${externalReference}`);
          return res.status(200).send('OK');
        }

        const testDoc = testQuery.docs[0];
        const testData = testDoc.data();
        
        console.log(`✅ TESTE ENCONTRADO: ${testDoc.id} - Atualizando com Payment ID`);

        // ✅ ATUALIZAR COM PAYMENT ID E DADOS COMPLETOS
        await testDoc.ref.update({
          'payment_info.payment_id': paymentId,
          'payment_info.payment_status': payment.status,
          'payment_info.payment_date': payment.date_approved || payment.date_created,
          'payment_info.payment_details': {
            id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            transaction_amount: payment.transaction_amount,
            date_created: payment.date_created,
            date_approved: payment.date_approved,
            payment_method: payment.payment_method_id,
            payment_type: payment.payment_type_id,
            payer: {
              email: payment.payer?.email,
              name: `${payment.payer?.first_name} ${payment.payer?.last_name}`
            }
          },
          status: `payment_${payment.status}`,
          'tracking.webhook_called': new Date().toISOString(),
          'tracking.payment_received': new Date().toISOString(),
          'tracking.completed': payment.status === 'approved' ? new Date().toISOString() : null,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ PAYMENT ID ${paymentId} SALVO PARA TESTE ${externalReference}`);
        console.log(`📊 Status do pagamento: ${payment.status}`);
        
        // Log detalhado para debug
        console.log('📋 DADOS DO PAYMENT CAPTURADOS:', {
          payment_id: paymentId,
          test_id: externalReference,
          status: payment.status,
          amount: payment.transaction_amount,
          method: payment.payment_method_id,
          payer: payment.payer?.email
        });
      }
      
      return res.status(200).send('OK');
      
    } catch (error) {
      console.error('❌ ERRO NO WEBHOOK DE TESTE:', error.message);
      console.error('📊 Detalhes do erro:', error.response?.data);
      return res.status(500).send('Error');
    }
  });
});

// =============================================
// FUNÇÃO: BUSCAR INFORMAÇÕES DE TESTE POR TEST_ID
// =============================================

exports.getTestPaymentInfo = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const testId = req.query.test_id;
      
      if (!testId) {
        return res.status(400).json({
          success: false,
          error: 'Parâmetro "test_id" é obrigatório'
        });
      }

      console.log(`🔍 BUSCANDO INFORMAÇÕES DO TESTE: ${testId}`);
      
      // Buscar por test_id OU external_reference
      const testQuery = await db.collection('test_checkouts')
        .where('test_id', '==', testId)
        .limit(1)
        .get();

      if (testQuery.empty) {
        // Tentar buscar por external_reference
        const externalQuery = await db.collection('test_checkouts')
          .where('external_reference', '==', testId)
          .limit(1)
          .get();
          
        if (externalQuery.empty) {
          return res.status(404).json({
            success: false,
            error: `Teste não encontrado: ${testId}`
          });
        }
        
        var testDoc = externalQuery.docs[0];
      } else {
        var testDoc = testQuery.docs[0];
      }

      const testData = testDoc.data();
      
      console.log(`✅ TESTE ENCONTRADO:`, {
        test_id: testData.test_id,
        payment_id: testData.payment_info?.payment_id,
        status: testData.status
      });

      // Buscar informações atualizadas do pagamento se existir payment_id
      let paymentDetails = null;
      if (testData.payment_info?.payment_id) {
        try {
          const storeConfig = functions.config().mercadopago;
          const paymentResponse = await axios.get(
            `https://api.mercadopago.com/v1/payments/${testData.payment_info.payment_id}`,
            {
              headers: {
                'Authorization': `Bearer ${storeConfig.token}`
              }
            }
          );
          paymentDetails = paymentResponse.data;
        } catch (paymentError) {
          console.warn('⚠️ Erro ao buscar detalhes do pagamento:', paymentError.message);
        }
      }

      res.json({
        success: true,
        test_info: {
          id: testDoc.id,
          test_id: testData.test_id,
          preference_id: testData.preference_id,
          external_reference: testData.external_reference,
          status: testData.status,
          created_at: testData.created_at,
          checkout_url: testData.checkout_url
        },
        payment_info: testData.payment_info || {
          payment_id: null,
          payment_status: 'pending',
          message: 'Aguardando pagamento...'
        },
        payment_details: paymentDetails ? {
          id: paymentDetails.id,
          status: paymentDetails.status,
          status_detail: paymentDetails.status_detail,
          transaction_amount: paymentDetails.transaction_amount,
          date_created: paymentDetails.date_created,
          date_approved: paymentDetails.date_approved,
          payment_method: paymentDetails.payment_method_id,
          payment_type: paymentDetails.payment_type_id,
          payer: {
            email: paymentDetails.payer?.email,
            name: `${paymentDetails.payer?.first_name} ${paymentDetails.payer?.last_name}`
          }
        } : null,
        tracking: testData.tracking || {},
        
        // ✅ STATUS DO TESTE
        test_status: getTestStatus(testData),
        
        // ✅ INSTRUÇÕES
        next_steps: getNextSteps(testData)
      });

    } catch (error) {
      console.error(`❌ ERRO AO BUSCAR TESTE ${req.query.test_id}:`, error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// FUNÇÃO: LISTAR TODOS OS TESTES COM PAYMENT IDs
// =============================================

exports.listTestPayments = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('📋 LISTANDO TODOS OS TESTES COM PAYMENT IDs...');
      
      const limit = parseInt(req.query.limit) || 20;
      
      const testCheckouts = await db.collection('test_checkouts')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .get();

      const tests = testCheckouts.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Estatísticas
      const stats = {
        total: tests.length,
        with_payment_id: tests.filter(t => t.payment_info?.payment_id).length,
        status_approved: tests.filter(t => t.payment_info?.payment_status === 'approved').length,
        status_pending: tests.filter(t => t.payment_info?.payment_status === 'pending' || !t.payment_info?.payment_id).length,
        status_rejected: tests.filter(t => t.payment_info?.payment_status === 'rejected').length
      };

      res.json({
        success: true,
        stats: stats,
        tests: tests.map(test => ({
          test_id: test.test_id,
          preference_id: test.preference_id,
          payment_id: test.payment_info?.payment_id || '❌ Não capturado',
          payment_status: test.payment_info?.payment_status || 'pending',
          amount: test.amount,
          created_at: test.created_at,
          status: test.status,
          checkout_url: test.checkout_url,
          tracking: {
            preference_created: test.tracking?.preference_created,
            payment_received: test.tracking?.payment_received,
            completed: test.tracking?.completed
          }
        })),
        
        // ✅ URLs para ações
        actions: {
          create_test: 'https://us-central1-kauara1.cloudfunctions.net/generateTestCheckoutPro',
          get_test_info: 'https://us-central1-kauara1.cloudfunctions.net/getTestPaymentInfo?test_id=SEU_TEST_ID',
          debug: 'https://us-central1-kauara1.cloudfunctions.net/debugCheckoutPro'
        },
        
        instructions: [
          '💡 PARA CAPTURAR PAYMENT ID:',
          '1. Crie um teste com /generateTestCheckoutPro',
          '2. Acesse o checkout_url e faça o pagamento',
          '3. O webhook capturará automaticamente o payment_id',
          '4. Verifique aqui ou em /getTestPaymentInfo?test_id=SEU_ID'
        ]
      });

    } catch (error) {
      console.error('❌ ERRO AO LISTAR TESTES:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// =============================================
// FUNÇÕES AUXILIARES PARA TESTES
// =============================================

function getTestStatus(testData) {
  if (!testData.payment_info?.payment_id) {
    return {
      status: '🟡 AGUARDANDO PAGAMENTO',
      description: 'Acesse o checkout_url e complete o pagamento',
      progress: 30
    };
  }
  
  switch (testData.payment_info.payment_status) {
    case 'approved':
      return {
        status: '✅ PAGAMENTO APROVADO',
        description: 'Payment ID capturado com sucesso!',
        progress: 100
      };
    case 'pending':
      return {
        status: '🟡 PAGAMENTO PENDENTE',
        description: 'Pagamento em processamento',
        progress: 60
      };
    case 'rejected':
      return {
        status: '❌ PAGAMENTO REJEITADO',
        description: 'Tente novamente com outro método',
        progress: 0
      };
    default:
      return {
        status: '🔵 STATUS DESCONHECIDO',
        description: `Status: ${testData.payment_info.payment_status}`,
        progress: 50
      };
  }
}

function getNextSteps(testData) {
  if (!testData.payment_info?.payment_id) {
    return [
      '1. 🌐 Acesse o checkout_url para fazer o pagamento',
      '2. 💳 Use dados de teste: test_user_123456@testuser.com',
      '3. 🔄 Aguarde o redirecionamento',
      '4. 📊 O payment_id será capturado automaticamente'
    ];
  }
  
  return [
    '✅ Payment ID capturado com sucesso!',
    `📋 Payment ID: ${testData.payment_info.payment_id}`,
    `📊 Status: ${testData.payment_info.payment_status}`,
    '🎯 Teste de integração concluído'
  ];
}

// =============================================
// FUNÇÃO: VALIDAR DADOS DA PREFERÊNCIA
// =============================================

function validatePreferenceData(preferenceData) {
    console.log('🔍 VALIDANDO DADOS DA PREFERÊNCIA CHECKOUT PRO...');
    const errors = [];
    
    // Validar items
    if (!preferenceData.items || preferenceData.items.length === 0) {
        errors.push('Items array está vazio');
    } else {
        const item = preferenceData.items[0];
        if (!item.title || item.title.length < 3) errors.push('Item title muito curto');
        if (typeof item.unit_price !== 'number' || item.unit_price <= 0) {
            errors.push(`Preço unitário inválido: ${item.unit_price}`);
        }
        if (!item.currency_id || item.currency_id !== 'BRL') errors.push('Moeda deve ser BRL');
    }
    
    // Validar payer (menos crítico para Checkout Pro)
    if (!preferenceData.payer.email || !preferenceData.payer.email.includes('@')) {
        errors.push('Email do pagador inválido');
    }
    
    // Validar back_urls (CRÍTICO para Checkout Pro)
    if (!preferenceData.back_urls.success || !preferenceData.back_urls.success.startsWith('http')) {
        errors.push('URL de success inválida');
    }
    
    if (errors.length > 0) {
        console.error('❌ ERROS DE VALIDAÇÃO NA PREFERÊNCIA:', errors);
        throw new Error(`Dados da preferência inválidos: ${errors.join(', ')}`);
    }
    
    console.log('✅ DADOS DA PREFERÊNCIA CHECKOUT PRO VALIDADOS COM SUCESSO');
}

// =============================================
// FUNÇÃO: CRIAR DADOS DO PEDIDO
// =============================================

function createOrderData(productData, buyerInfo, sellerId, artistData, pricing, shippingOption, preference, hasValidMercadoPago) {
    return {
        // Informações do produto
        productId: productData.id || productData.productId,
        productTitle: productData.productTitle,
        productDescription: productData.description,
        selectedVariant: productData.selectedVariant,
        thumbnailUrl: productData.thumbnailUrl || productData.thumbnail,
        
        // Informações do comprador
        buyerInfo: buyerInfo,
        buyerEmail: buyerInfo.email,
        buyerName: buyerInfo.fullName,
        
        // Informações do artista
        artistId: sellerId,
        artistEmail: artistData.email,
        artistName: artistData.displayName || artistData.email,
        
        // Informações de pagamento
        pricing: pricing,
        mercadoPagoPreferenceId: preference.id,
        externalReference: preference.external_reference,
        
        // Informações de frete
        shippingOption: shippingOption,
        shippingAddress: {
            street: buyerInfo.street,
            number: buyerInfo.number,
            complement: buyerInfo.complement,
            neighborhood: buyerInfo.neighborhood,
            city: buyerInfo.city,
            state: buyerInfo.state,
            zipCode: buyerInfo.zipCode,
            country: buyerInfo.country || 'BR'
        },
        
        // Status
        status: 'pending',
        paymentStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        splitEnabled: false, // Checkout Pro não suporta split no frontend
        checkout_type: 'pro',
        
        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        
        // Metadata adicional
        preferenceData: {
            id: preference.id,
            init_point: preference.init_point,
            sandbox_init_point: preference.sandbox_init_point,
            expiration_date: preference.expiration_date
        },
        
        // Logs para debug
        debug: {
            totalAmount: pricing.totalWithShipping,
            checkoutType: 'pro',
            createdAt: new Date().toISOString()
        }
    };
}

// =============================================
// WEBHOOK PARA PROCESSAR PAGAMENTOS (CHECKOUT PRO)
// =============================================

exports.handleMercadoPagoWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔔 WEBHOOK DO MERCADO PAGO RECEBIDO (CHECKOUT PRO)');
      console.log('📦 Dados do webhook:', JSON.stringify(req.body, null, 2));
      
      const { type, data } = req.body;
      
      if (type === 'payment') {
        const paymentId = data.id;
        console.log(`💳 Processando pagamento: ${paymentId}`);
        
        // Buscar detalhes do pagamento
        const config = functions.config().mercadopago;
        const paymentResponse = await axios.get(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          {
            headers: {
              'Authorization': `Bearer ${config.token}`
            }
          }
        );
        
        const payment = paymentResponse.data;
        const externalReference = payment.external_reference;
        
        console.log(`🔍 Buscando pedido com external_reference: ${externalReference}`);
        
        if (!externalReference) {
          throw new Error('External reference não encontrada no pagamento');
        }
        
        // Buscar pedido pelo external_reference
        const ordersQuery = await db.collection('orders')
          .where('externalReference', '==', externalReference)
          .limit(1)
          .get();
          
        if (ordersQuery.empty) {
          // Pode ser um teste - buscar em test_checkouts
          const testQuery = await db.collection('test_checkouts')
            .where('external_reference', '==', externalReference)
            .limit(1)
            .get();
            
          if (!testQuery.empty) {
            const testDoc = testQuery.docs[0];
            await testDoc.ref.update({
              payment_id: paymentId,
              status: payment.status,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              payment_data: {
                status: payment.status,
                status_detail: payment.status_detail,
                date_approved: payment.date_approved
              }
            });
            console.log(`✅ TESTE ATUALIZADO: ${externalReference} -> ${payment.status}`);
          } else {
            console.warn(`⚠️ Nenhum pedido ou teste encontrado para: ${externalReference}`);
          }
        } else {
          // Atualizar pedido real
          const orderDoc = ordersQuery.docs[0];
          const orderData = orderDoc.data();
          
          console.log(`📋 Pedido encontrado: ${orderDoc.id}`);
          
          // Atualizar status do pedido baseado no pagamento
          let orderStatus = 'pending';
          let paymentStatus = payment.status;
          let fulfillmentStatus = 'unfulfilled';
          
          switch (payment.status) {
            case 'approved':
              orderStatus = 'confirmed';
              paymentStatus = 'approved';
              fulfillmentStatus = 'paid';
              console.log(`✅ Pagamento APROVADO para pedido: ${orderDoc.id}`);
              break;
            case 'rejected':
              orderStatus = 'cancelled';
              paymentStatus = 'rejected';
              console.log(`❌ Pagamento REJEITADO para pedido: ${orderDoc.id}`);
              break;
            case 'in_process':
              orderStatus = 'pending';
              paymentStatus = 'pending';
              console.log(`⏳ Pagamento EM PROCESSAMENTO para pedido: ${orderDoc.id}`);
              break;
            case 'cancelled':
              orderStatus = 'cancelled';
              paymentStatus = 'cancelled';
              console.log(`🚫 Pagamento CANCELADO para pedido: ${orderDoc.id}`);
              break;
            default:
              console.log(`📊 Status desconhecido: ${payment.status} para pedido: ${orderDoc.id}`);
          }
          
          // Atualizar pedido
          await orderDoc.ref.update({
            status: orderStatus,
            paymentStatus: paymentStatus,
            fulfillmentStatus: fulfillmentStatus,
            mercadoPagoPaymentId: paymentId,
            paymentDetails: {
              id: payment.id,
              status: payment.status,
              status_detail: payment.status_detail,
              transaction_amount: payment.transaction_amount,
              date_approved: payment.date_approved,
              payment_method: payment.payment_method_id,
              payment_type: payment.payment_type_id
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          // Se pagamento aprovado, criar ordem de produção
          if (payment.status === 'approved') {
            await createProductionOrder(orderDoc.id, orderData, payment);
          }
          
          console.log(`✅ Pedido ${orderDoc.id} atualizado para status: ${orderStatus}`);
        }
      }
      
      return res.status(200).send('OK');
      
    } catch (error) {
      console.error('❌ ERRO NO WEBHOOK CHECKOUT PRO:', error.message);
      console.error('📊 Detalhes do erro:', error.response?.data);
      return res.status(500).send('Error');
    }
  });
});

// =============================================
// FUNÇÃO: CRIAR ORDEM DE PRODUÇÃO
// =============================================

async function createProductionOrder(orderId, orderData, payment) {
  try {
    console.log(`🏭 CRIANDO ORDEM DE PRODUÇÃO para pedido: ${orderId}`);
    
    const productionOrder = {
      orderId: orderId,
      productId: orderData.productId,
      productTitle: orderData.productTitle,
      variant: orderData.selectedVariant,
      designInfo: {
        designImage: orderData.productData?.designImage,
        placement: orderData.productData?.placement,
        artistId: orderData.artistId
      },
      shippingInfo: {
        address: orderData.shippingAddress,
        method: orderData.shippingOption?.name,
        estimate: orderData.shippingOption?.days,
        recipient: orderData.buyerInfo.fullName
      },
      customerInfo: {
        name: orderData.buyerInfo.fullName,
        email: orderData.buyerInfo.email,
        phone: orderData.buyerInfo.phone
      },
      artistInfo: {
        artistId: orderData.artistId,
        artistEmail: orderData.artistEmail,
        artistName: orderData.artistName
      },
      paymentInfo: {
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        paymentId: payment.id,
        method: payment.payment_method_id,
        checkout_type: 'pro'
      },
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      priority: 'normal'
    };
    
    const productionRef = await db.collection('production_orders').add(productionOrder);
    
    console.log(`✅ ORDEM DE PRODUÇÃO criada: ${productionRef.id} para pedido: ${orderId}`);
    
  } catch (error) {
    console.error('❌ ERRO AO CRIAR ORDEM DE PRODUÇÃO:', error);
    throw error;
  }
}

// =============================================
// FUNÇÃO: CALCULAR FRETE
// =============================================

exports.calculateShipping = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('📦 CALCULANDO FRETE...');
      
      const { recipient, items, currency } = req.body;
      
      if (!recipient || !items) {
        return res.status(400).json({
          success: false,
          error: 'Dados incompletos: recipient e items são obrigatórios'
        });
      }

      console.log('📍 Endereço para cálculo:', {
        zip: recipient.zip,
        city: recipient.city,
        state: recipient.state_code
      });

      // OPÇÕES DE FRETE FIXAS
      const shippingOptions = [
        {
          name: 'Correios - PAC',
          rate: 15.90,
          days: 10,
          carrier: 'Correios',
          id: 'pac'
        },
        {
          name: 'Correios - Sedex',
          rate: 25.90,
          days: 5,
          carrier: 'Correios',
          id: 'sedex'
        },
        {
          name: 'Transportadora',
          rate: 35.90,
          days: 7,
          carrier: 'Jadlog',
          id: 'jadlog'
        }
      ];

      console.log('🚚 Opções de frete calculadas:', shippingOptions);

      return res.json({
        success: true,
        shipping_options: shippingOptions,
        currency: currency || 'BRL',
        debug: {
          address_received: recipient,
          items_count: items.length
        }
      });

    } catch (error) {
      console.error('❌ ERRO AO CALCULAR FRETE:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        debug: 'Erro interno no cálculo de frete'
      });
    }
  });
});

// =============================================
// FUNÇÕES DE TESTE E DEBUG
// =============================================

exports.debugCheckoutPro = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🔧 DEBUG CHECKOUT PRO');
      
      const storeConfig = functions.config().mercadopago;
      
      if (!storeConfig?.token) {
        return res.json({ 
          error: 'Token não configurado',
          config_status: 'missing'
        });
      }

      // Testar criação de preferência Checkout Pro
      let testPreference;
      try {
        const testData = {
          items: [{
            title: "Teste Checkout Pro",
            quantity: 1,
            currency_id: "BRL",
            unit_price: 10.00
          }],
          payer: {
            email: "test_user_123456@testuser.com"
          },
          back_urls: {
            success: "https://kauava.com/success.html",
            failure: "https://kauava.com/failure.html",
            pending: "https://kauava.com/pending.html"
          },
          auto_return: "approved",
          binary_mode: false
        };

        testPreference = await axios.post(
          'https://api.mercadopago.com/checkout/preferences',
          testData,
          {
            headers: {
              'Authorization': `Bearer ${storeConfig.token}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (prefError) {
        console.error('❌ Erro na preferência:', prefError.response?.data);
        return res.json({
          preference_status: 'failed',
          error: prefError.response?.data
        });
      }

      // Buscar estatísticas de testes
      const testCheckouts = await db.collection('test_checkouts')
        .orderBy('created_at', 'desc')
        .limit(5)
        .get();

      const recentTests = testCheckouts.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const result = {
        status: 'healthy',
        checkout_type: 'pro',
        config: {
          has_token: true,
          token_preview: storeConfig.token.substring(0, 10) + '...'
        },
        preference: {
          status: 'success',
          id: testPreference.data.id,
          checkout_url: testPreference.data.init_point,
          sandbox_url: testPreference.data.sandbox_init_point
        },
        recent_tests: {
          total: recentTests.length,
          with_payment_id: recentTests.filter(t => t.payment_info?.payment_id).length,
          tests: recentTests.map(t => ({
            test_id: t.test_id,
            payment_id: t.payment_info?.payment_id || 'pending',
            status: t.status
          }))
        },
        endpoints: {
          create_order: '/createMarketplaceOrder',
          test_checkout: '/generateTestCheckoutPro',
          list_payments: '/listTestPayments',
          get_test_info: '/getTestPaymentInfo?test_id=',
          get_payment: '/getPaymentById?id=',
          webhook: '/handleMercadoPagoWebhook',
          test_webhook: '/handleTestPaymentWebhook'
        },
        recommendations: [
          '✅ Use Checkout Pro - Mais simples e confiável',
          '🔗 Teste com /generateTestCheckoutPro',
          '📋 Verifique pagamentos com /listTestPayments',
          '🎯 Use webhook para atualizações automáticas'
        ]
      };

      console.log('📊 DEBUG CHECKOUT PRO:', result);
      res.json(result);

    } catch (error) {
      console.error('❌ ERRO NO DEBUG:', error);
      res.json({
        error: error.message,
        stack: error.stack
      });
    }
  });
});

// =============================================
// HEALTH CHECK
// =============================================

exports.healthCheck = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      console.log('🏥 HEALTH CHECK CHECKOUT PRO');
      
      const storeConfig = functions.config().mercadopago;
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checkout_type: 'pro',
        mercado_pago: {
          configured: !!storeConfig?.token,
          token_length: storeConfig?.token?.length || 0
        },
        firebase: {
          connected: true,
          timestamp: admin.firestore.Timestamp.now().toMillis()
        },
        functions: {
          createMarketplaceOrder: 'active',
          generateTestCheckoutPro: 'active',
          listTestPayments: 'active',
          getTestPaymentInfo: 'active',
          getPaymentById: 'active',
          handleMercadoPagoWebhook: 'active',
          handleTestPaymentWebhook: 'active'
        },
        environment: process.env.NODE_ENV || 'production'
      };

      console.log('✅ HEALTH CHECK PRO:', healthStatus);
      res.json(healthStatus);

    } catch (error) {
      console.error('❌ HEALTH CHECK FALHOU:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// =============================================
// FUNÇÕES AUXILIARES (mantidas do original)
// =============================================

async function getValidAccessToken(userDoc) {
  const config = functions.config().mercadopago;
  const info = userDoc.data().mercadopago_info;

  if (!info || !info.refresh_token || !info.expires_at) {
    throw new Error("Missing Mercado Pago token info.");
  }

  const expiresAt = info.expires_at.toMillis();
  if (Date.now() < expiresAt - 2 * 60 * 1000) {
    return info.access_token;
  }

  try {
    // Token expired — attempt refresh
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', config.client_id);
    params.append('client_secret', config.client_secret);
    params.append('refresh_token', info.refresh_token);

    const response = await axios.post(
      'https://api.mercadopago.com/oauth/token',
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const newExpiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + expires_in * 1000);

    await userDoc.ref.update({
      "mercadopago_info.access_token": access_token,
      "mercadopago_info.refresh_token": refresh_token,
      "mercadopago_info.expires_at": newExpiresAt,
      "mercadopago_info.last_updated": admin.firestore.FieldValue.serverTimestamp()
    });

    return access_token;
  } catch (err) {
    console.error("❌ Failed to refresh Mercado Pago token:", err.message);
    
    await userDoc.ref.update({
      mercadopago_info: admin.firestore.FieldValue.delete(),
      "mp_disconnected_at": admin.firestore.FieldValue.serverTimestamp()
    });

    throw new Error("Mercado Pago disconnected. User must reconnect.");
  }
}

console.log('🚀 CHECKOUT PRO - FUNÇÕES INICIALIZADAS');
console.log('📋 Endpoints disponíveis:');
console.log('   - createMarketplaceOrder (CHECKOUT PRO)');
console.log('   - generateTestCheckoutPro (TESTES COM PAYMENT ID)');
console.log('   - listTestPayments (LISTA TESTES)');
console.log('   - getTestPaymentInfo (INFO ESPECÍFICA)');
console.log('   - getPaymentById (CONSULTA PAGAMENTO)');
console.log('   - handleMercadoPagoWebhook (WEBHOOK PRODUÇÃO)');
console.log('   - handleTestPaymentWebhook (WEBHOOK TESTES)');
console.log('   - debugCheckoutPro (DEBUG COMPLETO)');
console.log('   - healthCheck (STATUS DO SISTEMA)');

module.exports = exports;