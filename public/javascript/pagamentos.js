// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let selectedProduct = null;
let selectedShippingOption = null;
let currentUser = null;

// Main initialization
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Inicializando página de pagamentos...');
    
    try {
        // Check authentication
        currentUser = await checkAuthentication();
        
        // Load product data from sessionStorage
        await loadProductData();
        
        // Calculate shipping options
        await calculateShipping();
        
        // Setup form validation
        setupFormValidation();
        
        // Setup CPF mask
        setupCPFMask();
        
        // Setup CEP auto-complete
        setupCEPAutoComplete();
        
        console.log('✅ Página de pagamentos inicializada com sucesso');
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        showError('Erro ao carregar página. Por favor, recarregue.');
    }
});

// Check user authentication
async function checkAuthentication() {
    return new Promise((resolve, reject) => {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log('👤 Usuário autenticado:', user.email);
                
                try {
                    // Get Firestore user ID
                    const userQuery = await db.collection("users")
                        .where("firebaseUID", "==", user.uid)
                        .get();
                    
                    if (!userQuery.empty) {
                        const firestoreUserId = userQuery.docs[0].id;
                        user.firestoreUserId = firestoreUserId;
                        console.log('🔑 Firestore User ID:', firestoreUserId);
                    }
                    
                    // Pre-fill user data if available
                    await prefillUserData(user);
                    resolve(user);
                } catch (error) {
                    console.error('Erro ao buscar dados do usuário:', error);
                    reject(error);
                }
            } else {
                console.warn('⚠️ Usuário não autenticado');
                alert('Você precisa estar logado para finalizar a compra.');
                window.location.href = 'login.html';
                reject(new Error('User not authenticated'));
            }
        });
    });
}

// Load product data from sessionStorage
async function loadProductData() {
    try {
        const productDataString = sessionStorage.getItem('selectedProduct');
        
        if (!productDataString) {
            throw new Error('Nenhum produto selecionado encontrado');
        }
        
        selectedProduct = JSON.parse(productDataString);
        console.log('📦 Produto carregado:', selectedProduct);
        
        // Update UI with product data
        updateProductDisplay();
        
    } catch (error) {
        console.error('❌ Erro ao carregar produto:', error);
        showError('Erro ao carregar informações do produto. Por favor, selecione o produto novamente.');
        
        // Redirect back after delay
        setTimeout(() => {
            window.history.back();
        }, 3000);
    }
}

// Update product display in UI
function updateProductDisplay() {
    if (!selectedProduct) return;
    
    // Product image
    const productImage = document.getElementById('productImage');
    if (selectedProduct.thumbnailUrl) {
        productImage.src = selectedProduct.thumbnailUrl;
        productImage.alt = selectedProduct.productTitle;
    } else {
        productImage.src = '../public/images/default-product.png';
    }
    
    // Product title
    document.getElementById('productTitle').textContent = selectedProduct.productTitle;
    
    // Variant info
    const variantInfo = document.getElementById('variantInfo');
    if (selectedProduct.selectedVariant) {
        const variant = selectedProduct.selectedVariant;
        const colorName = getColorName(variant.color_code, variant.color);
        
        variantInfo.innerHTML = `
            <div>
                <span class="color-indicator" style="background-color: ${variant.color_code || '#ccc'}"></span>
                ${colorName} - ${variant.size}
            </div>
        `;
    }
    
    // Price breakdown
    updatePriceBreakdown();
}

// Update price breakdown display
function updatePriceBreakdown() {
    if (!selectedProduct) return;
    
    const pricing = calculatePricing();
    
    document.getElementById('productPrice').textContent = formatCurrency(pricing.productPrice);
    document.getElementById('artistMarkup').textContent = formatCurrency(pricing.artistMarkup);
    document.getElementById('platformFee').textContent = formatCurrency(pricing.platformFee);
    document.getElementById('shippingCost').textContent = formatCurrency(pricing.shippingCost);
    document.getElementById('totalPrice').textContent = formatCurrency(pricing.totalWithShipping);
}

// Calculate pricing based on product data
function calculatePricing() {
    if (!selectedProduct) {
        return {
            productPrice: 0,
            artistMarkup: 0,
            platformFee: 0,
            shippingCost: 0,
            subtotal: 0,
            totalWithoutShipping: 0,
            totalWithShipping: 0
        };
    }
    
    const productPrice = selectedProduct.selectedVariant?.price || 
                        selectedProduct.pricing?.basePrice || 
                        selectedProduct.variants?.[0]?.price || 0;
    
    const artistMarkup = selectedProduct.pricing?.userMarkup || 
                        selectedProduct.selectedArt?.totalPrice || 
                        selectedProduct.selectedArt?.price || 0;
    
    const shippingCost = selectedShippingOption ? parseFloat(selectedShippingOption.rate) : 0;
    
    const subtotal = productPrice + artistMarkup;
    const platformFee = Math.max(1.00, subtotal * 0.05);
    const totalWithoutShipping = subtotal + platformFee;
    const totalWithShipping = totalWithoutShipping + shippingCost;
    
    return {
        productPrice: productPrice,
        artistMarkup: artistMarkup,
        platformFee: platformFee,
        shippingCost: shippingCost,
        subtotal: subtotal,
        totalWithoutShipping: totalWithoutShipping,
        totalWithShipping: Math.max(5.00, totalWithShipping)
    };
}

// Calculate shipping options
async function calculateShipping() {
    try {
        const shippingContainer = document.getElementById('shippingOptions');
        
        if (!selectedProduct) {
            shippingContainer.innerHTML = '<div class="alert alert-warning">Produto não encontrado</div>';
            return;
        }
        
        // Get address from form or use defaults
        const zipCode = document.getElementById('zipCode').value;
        
        if (!zipCode || zipCode.length < 8) {
            shippingContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    Informe o CEP para calcular o frete
                </div>
            `;
            return;
        }
        
        // Show loading
        shippingContainer.innerHTML = `
            <div class="text-center py-2">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                    <span class="visually-hidden">Carregando...</span>
                </div>
                Calculando frete...
            </div>
        `;
        
        // Prepare shipping request data
        const shippingData = {
            recipient: {
                zip: zipCode.replace(/\D/g, ''),
                country: 'BR'
            },
            items: [
                {
                    quantity: 1,
                    variant_id: selectedProduct.selectedVariant?.id,
                    product_id: selectedProduct.id
                }
            ],
            currency: 'BRL'
        };
        
        // Call shipping calculation function
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/calculateShipping', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(shippingData)
        });
        
        const result = await response.json();
        
        if (result.success && result.shipping_options) {
            displayShippingOptions(result.shipping_options);
        } else {
            throw new Error(result.error || 'Erro ao calcular frete');
        }
        
    } catch (error) {
        console.error('❌ Erro ao calcular frete:', error);
        document.getElementById('shippingOptions').innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Não foi possível calcular o frete. Tente novamente.
            </div>
        `;
        
        // Show fixed shipping options as fallback
        showFallbackShippingOptions();
    }
}

// Display shipping options
function displayShippingOptions(shippingOptions) {
    const container = document.getElementById('shippingOptions');
    
    if (!shippingOptions || shippingOptions.length === 0) {
        container.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Nenhuma opção de frete disponível para este CEP
            </div>
        `;
        return;
    }
    
    let html = '';
    shippingOptions.forEach((option, index) => {
        const isSelected = selectedShippingOption && selectedShippingOption.id === option.id;
        
        html += `
            <div class="shipping-option ${isSelected ? 'selected' : ''}" 
                 data-option='${JSON.stringify(option)}'
                 onclick="selectShippingOption(this)">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">${option.name}</h6>
                        <small class="text-muted">${option.carrier} • ${option.days} dia${option.days !== 1 ? 's' : ''}</small>
                    </div>
                    <div class="text-end">
                        <strong class="text-primary">R$ ${parseFloat(option.rate).toFixed(2)}</strong>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Auto-select first option if none selected
    if (!selectedShippingOption && shippingOptions.length > 0) {
        selectShippingOptionByData(shippingOptions[0]);
    }
}

// Show fallback shipping options
function showFallbackShippingOptions() {
    const fallbackOptions = [
        {
            name: 'Correios - PAC',
            rate: 15.90,
            days: 10,
            carrier: 'Correios',
            id: 'pac_fallback'
        },
        {
            name: 'Correios - Sedex',
            rate: 25.90,
            days: 5,
            carrier: 'Correios',
            id: 'sedex_fallback'
        }
    ];
    
    displayShippingOptions(fallbackOptions);
}

// Select shipping option
function selectShippingOption(element) {
    // Remove selected class from all options
    document.querySelectorAll('.shipping-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    // Add selected class to clicked option
    element.classList.add('selected');
    
    // Get option data
    const optionData = JSON.parse(element.getAttribute('data-option'));
    selectShippingOptionByData(optionData);
}

// Select shipping option by data
function selectShippingOptionByData(optionData) {
    selectedShippingOption = optionData;
    console.log('🚚 Frete selecionado:', selectedShippingOption);
    
    // Update pricing
    updatePriceBreakdown();
}

// Setup form validation
function setupFormValidation() {
    const form = document.getElementById('checkoutForm');
    
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        processCheckout();
    });
    
    // Real-time validation
    setupRealTimeValidation();
}

// Setup real-time form validation
function setupRealTimeValidation() {
    const fields = ['fullName', 'email', 'phone', 'zipCode', 'street', 'number', 'neighborhood', 'city', 'state'];
    
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('blur', function() {
                validateField(this);
            });
            
            field.addEventListener('input', function() {
                clearFieldError(this);
            });
        }
    });
    
    // Special handling for CEP (auto-calculate shipping)
    document.getElementById('zipCode').addEventListener('blur', function() {
        if (validateField(this)) {
            calculateShipping();
        }
    });
}

// Validate individual field
function validateField(field) {
    const value = field.value.trim();
    const fieldId = field.id;
    const errorElement = document.getElementById(fieldId + 'Error');
    
    // Clear previous error
    clearFieldError(field);
    
    let isValid = true;
    let errorMessage = '';
    
    switch (fieldId) {
        case 'fullName':
            if (value.length < 3) {
                errorMessage = 'Nome deve ter pelo menos 3 caracteres';
                isValid = false;
            }
            break;
            
        case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                errorMessage = 'Email inválido';
                isValid = false;
            }
            break;
            
        case 'phone':
            const phoneDigits = value.replace(/\D/g, '');
            if (phoneDigits.length < 10) {
                errorMessage = 'Telefone inválido';
                isValid = false;
            }
            break;
            
        case 'cpf':
            if (!validateCPF(value)) {
                errorMessage = 'CPF inválido';
                isValid = false;
            }
            break;
            
        case 'zipCode':
            const zipDigits = value.replace(/\D/g, '');
            if (zipDigits.length !== 8) {
                errorMessage = 'CEP inválido';
                isValid = false;
            }
            break;
            
        case 'street':
            if (value.length < 5) {
                errorMessage = 'Endereço muito curto';
                isValid = false;
            }
            break;
            
        case 'number':
            if (!value) {
                errorMessage = 'Número é obrigatório';
                isValid = false;
            }
            break;
            
        case 'neighborhood':
            if (value.length < 2) {
                errorMessage = 'Bairro inválido';
                isValid = false;
            }
            break;
            
        case 'city':
            if (value.length < 2) {
                errorMessage = 'Cidade inválida';
                isValid = false;
            }
            break;
            
        case 'state':
            if (!value) {
                errorMessage = 'Selecione um estado';
                isValid = false;
            }
            break;
    }
    
    if (!isValid) {
        field.classList.add('is-invalid');
        if (errorElement) {
            errorElement.textContent = errorMessage;
        }
    } else {
        field.classList.remove('is-invalid');
        field.classList.add('is-valid');
    }
    
    return isValid;
}

// Clear field error
function clearFieldError(field) {
    const fieldId = field.id;
    const errorElement = document.getElementById(fieldId + 'Error');
    
    field.classList.remove('is-invalid');
    if (errorElement) {
        errorElement.textContent = '';
    }
}

// Validate entire form
function validateForm() {
    const fields = ['fullName', 'email', 'phone', 'cpf', 'zipCode', 'street', 'number', 'neighborhood', 'city', 'state'];
    let isValid = true;
    
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field && !validateField(field)) {
            isValid = false;
        }
    });
    
    // Validate terms
    const termsCheck = document.getElementById('termsCheck');
    const termsError = document.getElementById('termsError');
    
    if (!termsCheck.checked) {
        termsError.textContent = 'Você deve aceitar os termos e condições';
        isValid = false;
    } else {
        termsError.textContent = '';
    }
    
    // Validate shipping option
    if (!selectedShippingOption) {
        showError('Selecione uma opção de frete');
        isValid = false;
    }
    
    return isValid;
}

// Setup CPF mask
function setupCPFMask() {
    const cpfField = document.getElementById('cpf');
    
    cpfField.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length <= 11) {
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        }
        
        e.target.value = value;
    });
}

// Setup CEP auto-complete
function setupCEPAutoComplete() {
    const cepField = document.getElementById('zipCode');
    
    cepField.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        
        if (value.length > 5) {
            value = value.replace(/(\d{5})(\d)/, '$1-$2');
        }
        
        e.target.value = value;
    });
    
    // Auto-fill address when CEP is completed
    cepField.addEventListener('blur', async function() {
        const cep = this.value.replace(/\D/g, '');
        
        if (cep.length === 8) {
            try {
                await fetchAddressByCEP(cep);
            } catch (error) {
                console.log('Não foi possível buscar endereço pelo CEP');
            }
        }
    });
}

// Fetch address by CEP
async function fetchAddressByCEP(cep) {
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        
        if (!data.erro) {
            document.getElementById('street').value = data.logradouro || '';
            document.getElementById('neighborhood').value = data.bairro || '';
            document.getElementById('city').value = data.localidade || '';
            document.getElementById('state').value = data.uf || '';
            
            // Trigger validation
            validateField(document.getElementById('street'));
            validateField(document.getElementById('neighborhood'));
            validateField(document.getElementById('city'));
            validateField(document.getElementById('state'));
        }
    } catch (error) {
        console.log('Erro ao buscar CEP:', error);
    }
}

// Pre-fill user data
async function prefillUserData(user) {
    try {
        // Get user data from Firestore
        const userQuery = await db.collection("users")
            .where("firebaseUID", "==", user.uid)
            .get();
        
        if (!userQuery.empty) {
            const userData = userQuery.docs[0].data();
            
            // Pre-fill form fields
            if (userData.user_Name) {
                document.getElementById('fullName').value = userData.user_Name;
            }
            
            if (user.email) {
                document.getElementById('email').value = user.email;
            }
            
            // Trigger validation for pre-filled fields
            validateField(document.getElementById('fullName'));
            validateField(document.getElementById('email'));
        }
    } catch (error) {
        console.error('Erro ao preencher dados do usuário:', error);
    }
}

// Process checkout
async function processCheckout() {
    console.log('🛒 Iniciando processo de checkout...');
    
    // Validate form
    if (!validateForm()) {
        showError('Por favor, corrija os erros no formulário');
        return;
    }
    
    // Validate product and shipping
    if (!selectedProduct || !selectedShippingOption) {
        showError('Informações do produto ou frete incompletas');
        return;
    }
    
    try {
        // Show loading
        showLoading();
        
        // Prepare checkout data
        const checkoutData = {
            productData: selectedProduct,
            buyerInfo: getBuyerInfo(),
            sellerId: selectedProduct.designerUserId,
            shippingOption: selectedShippingOption
        };
        
        console.log('📤 Enviando dados para checkout:', checkoutData);
        
        // Call Cloud Function to create Checkout Pro order
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/createMarketplaceOrder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(checkoutData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Checkout criado com sucesso:', result);
            
            // Redirect to Mercado Pago Checkout Pro
            if (result.checkout_url) {
                window.location.href = result.checkout_url;
            } else {
                throw new Error('URL do checkout não encontrada');
            }
            
        } else {
            throw new Error(result.error || 'Erro ao criar checkout');
        }
        
    } catch (error) {
        console.error('❌ Erro no checkout:', error);
        hideLoading();
        showError(`Erro ao processar checkout: ${error.message}`);
    }
}

// Get buyer info from form
function getBuyerInfo() {
    return {
        fullName: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        cpf: document.getElementById('cpf').value.replace(/\D/g, ''),
        zipCode: document.getElementById('zipCode').value.replace(/\D/g, ''),
        street: document.getElementById('street').value.trim(),
        number: document.getElementById('number').value.trim(),
        complement: document.getElementById('complement').value.trim(),
        neighborhood: document.getElementById('neighborhood').value.trim(),
        city: document.getElementById('city').value.trim(),
        state: document.getElementById('state').value
    };
}

// Utility functions
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function validateCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    
    if (cpf.length !== 11) return false;
    
    // Basic CPF validation
    let sum = 0;
    let remainder;
    
    for (let i = 1; i <= 9; i++) {
        sum = sum + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(9, 10))) return false;
    
    sum = 0;
    for (let i = 1; i <= 10; i++) {
        sum = sum + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(10, 11))) return false;
    
    return true;
}

function getColorName(colorCode, colorNameFromFirestore = '') {
    const colorMap = {
        '#ffffff': 'Branco',
        '#000000': 'Preto',
        '#ff0000': 'Vermelho',
        '#00ff00': 'Verde',
        '#0000ff': 'Azul',
        '#ffff00': 'Amarelo',
        '#ff00ff': 'Magenta',
        '#00ffff': 'Ciano',
        '#808080': 'Cinza',
        '#c0c0c0': 'Prata',
        '#ffa500': 'Laranja',
        '#800080': 'Roxo',
        '#a52a2a': 'Marrom',
        '#ffc0cb': 'Rosa'
    };
    
    if (colorNameFromFirestore && colorNameFromFirestore !== 'Default Color') {
        return colorNameFromFirestore;
    }
    
    if (!colorCode) {
        return colorNameFromFirestore || 'Cor Indisponível';
    }
    
    const normalizedColor = colorCode.toLowerCase();
    return colorMap[normalizedColor] || colorNameFromFirestore || 'Cor Personalizada';
}

function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('submitButton').disabled = true;
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('submitButton').disabled = false;
}

function showError(message) {
    // Simple error display - you might want to use a more sophisticated notification system
    alert(`Erro: ${message}`);
}

function showSuccess(message) {
    alert(`Sucesso: ${message}`);
}

// Make functions available globally for HTML event handlers
window.selectShippingOption = selectShippingOption;

// Função para testar pagamento rapidamente
async function testPaymentQuick() {
    console.log('🧪 TESTE RÁPIDO DE PAGAMENTO INICIADO...');
    
    try {
        // Verificar autenticação
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Usuário não autenticado');
        }

        // Mostrar loading
        showLoading();
        
        // Dados de teste fixos
        const testData = {
            productData: {
                id: 'test_product_' + Date.now(),
                productTitle: '🧪 Produto Teste - Checkout Pro',
                description: 'Teste de integração Checkout Pro',
                thumbnailUrl: 'https://via.placeholder.com/300',
                designerUserId: 'test_seller_id',
                selectedVariant: {
                    id: 123,
                    color: 'Preto',
                    color_code: '#000000',
                    size: 'M',
                    price: 89.90
                },
                pricing: {
                    basePrice: 89.90,
                    userMarkup: 20.00
                }
            },
            buyerInfo: {
                fullName: 'Teste Checkout Pro',
                email: 'test_user_123456@testuser.com',
                phone: '11999999999',
                cpf: '12345678900',
                zipCode: '01310100',
                street: 'Avenida Paulista',
                number: '1000',
                complement: 'Sala 101',
                neighborhood: 'Bela Vista',
                city: 'São Paulo',
                state: 'SP'
            },
            sellerId: 'test_seller_id',
            shippingOption: {
                name: 'Correios - Sedex',
                rate: 25.90,
                days: 5,
                carrier: 'Correios',
                id: 'sedex_test'
            }
        };

        console.log('📤 Enviando dados de teste...', testData);

        // Chamar função de teste
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/generateTestCheckoutPro', {
            method: 'GET' // Mudado para GET pois a função é GET
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            console.log('✅ TESTE CRIADO COM SUCESSO:', result);
            
            // Mostrar resultados detalhados
            showTestResults(result);
            
        } else {
            throw new Error(result.error || 'Erro ao criar teste');
        }

    } catch (error) {
        console.error('❌ ERRO NO TESTE:', error);
        hideLoading();
        showError(`Erro no teste: ${error.message}`);
    }
}

// Mostrar resultados do teste
function showTestResults(result) {
    hideLoading();
    
    const modalHtml = `
        <div class="modal fade" id="testResultsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle me-2"></i>
                            Teste Criado com Sucesso!
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6>📋 Informações do Teste:</h6>
                                <table class="table table-sm">
                                    <tr><td><strong>Test ID:</strong></td><td><code>${result.test_id}</code></td></tr>
                                    <tr><td><strong>Preference ID:</strong></td><td><code>${result.preference_id}</code></td></tr>
                                    <tr><td><strong>Firestore ID:</strong></td><td><code>${result.firestore_id}</code></td></tr>
                                </table>
                            </div>
                            <div class="col-md-6">
                                <h6>🎯 Ações Rápidas:</h6>
                                <div class="d-grid gap-2">
                                    <button class="btn btn-primary" onclick="openTestCheckout('${result.checkout_url}')">
                                        <i class="fas fa-external-link-alt me-2"></i>
                                        Abrir Checkout
                                    </button>
                                    <button class="btn btn-outline-info" onclick="checkTestPaymentInfo('${result.test_id}')">
                                        <i class="fas fa-search me-2"></i>
                                        Ver Payment ID
                                    </button>
                                    <button class="btn btn-outline-secondary" onclick="copyTestId('${result.test_id}')">
                                        <i class="fas fa-copy me-2"></i>
                                        Copiar Test ID
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <hr>
                        
                        <h6>📖 Instruções do Teste:</h6>
                        <div class="bg-light p-3 rounded small">
                            ${result.test_instructions ? result.test_instructions.map(instruction => 
                                `<div class="mb-1">${instruction}</div>`
                            ).join('') : 'Nenhuma instrução disponível'}
                        </div>
                        
                        <div class="mt-3">
                            <h6>🔗 URLs do Checkout:</h6>
                            <div class="input-group mb-2">
                                <input type="text" class="form-control" id="checkoutUrl" value="${result.checkout_url}" readonly>
                                <button class="btn btn-outline-secondary" onclick="copyToClipboard('checkoutUrl')">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                            <div class="input-group">
                                <input type="text" class="form-control" id="sandboxUrl" value="${result.sandbox_url}" readonly>
                                <button class="btn btn-outline-secondary" onclick="copyToClipboard('sandboxUrl')">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-success" onclick="openTestCheckout('${result.checkout_url}')">
                            <i class="fas fa-credit-card me-2"></i>
                            Testar Pagamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Adicionar modal ao DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('testResultsModal'));
    modal.show();
    
    // Limpar modal quando fechar
    document.getElementById('testResultsModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// Verificar Payment ID do teste
exports.getTestPaymentInfo = functions.https.onRequest((req, res) => {
  // ✅ CRITICAL: Set CORS headers FIRST, before any other logic
  res.set('Access-Control-Allow-Origin', '*'); // Ou use domínios específicos
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-Requested-With, Accept, Origin');
  res.set('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Continue with normal CORS wrapper for consistency
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

// Mostrar informações do payment
function showPaymentInfo(result) {
    hideLoading();
    
    const paymentInfo = result.payment_info;
    const hasPaymentId = paymentInfo && paymentInfo.payment_id;
    
    const modalHtml = `
        <div class="modal fade" id="paymentInfoModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header ${hasPaymentId ? 'bg-success text-white' : 'bg-warning'}">
                        <h5 class="modal-title">
                            <i class="fas ${hasPaymentId ? 'fa-check-circle' : 'fa-clock'} me-2"></i>
                            ${hasPaymentId ? 'Payment ID Capturado!' : 'Aguardando Pagamento'}
                        </h5>
                        <button type="button" class="btn-close ${hasPaymentId ? 'btn-close-white' : ''}" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6>📊 Status do Teste:</h6>
                                <div class="card ${hasPaymentId ? 'border-success' : 'border-warning'}">
                                    <div class="card-body">
                                        <h5 class="card-title ${hasPaymentId ? 'text-success' : 'text-warning'}">
                                            ${result.test_status?.status || 'Status desconhecido'}
                                        </h5>
                                        <p class="card-text">${result.test_status?.description || ''}</p>
                                        <div class="progress mb-2">
                                            <div class="progress-bar ${hasPaymentId ? 'bg-success' : 'bg-warning'}" 
                                                 style="width: ${result.test_status?.progress || 0}%">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <h6>💳 Informações do Pagamento:</h6>
                                ${hasPaymentId ? `
                                    <table class="table table-sm table-bordered">
                                        <tr><td><strong>Payment ID:</strong></td><td><code class="text-success">${paymentInfo.payment_id}</code></td></tr>
                                        <tr><td><strong>Status:</strong></td><td><span class="badge bg-success">${paymentInfo.payment_status}</span></td></tr>
                                        <tr><td><strong>Data:</strong></td><td>${new Date(paymentInfo.payment_date).toLocaleString()}</td></tr>
                                    </table>
                                ` : `
                                    <div class="alert alert-warning">
                                        <i class="fas fa-clock me-2"></i>
                                        Aguardando pagamento...<br>
                                        <small>Faça o pagamento no checkout para capturar o Payment ID</small>
                                    </div>
                                `}
                            </div>
                        </div>
                        
                        ${hasPaymentId && result.payment_details ? `
                            <hr>
                            <h6>📋 Detalhes do Pagamento:</h6>
                            <div class="table-responsive">
                                <table class="table table-sm table-striped">
                                    <tr><td><strong>ID:</strong></td><td>${result.payment_details.id}</td></tr>
                                    <tr><td><strong>Status:</strong></td><td>${result.payment_details.status}</td></tr>
                                    <tr><td><strong>Valor:</strong></td><td>R$ ${result.payment_details.transaction_amount}</td></tr>
                                    <tr><td><strong>Método:</strong></td><td>${result.payment_details.payment_method}</td></tr>
                                    <tr><td><strong>Data Criação:</strong></td><td>${new Date(result.payment_details.date_created).toLocaleString()}</td></tr>
                                    <tr><td><strong>Data Aprovação:</strong></td><td>${result.payment_details.date_approved ? new Date(result.payment_details.date_approved).toLocaleString() : 'N/A'}</td></tr>
                                    <tr><td><strong>Pagador:</strong></td><td>${result.payment_details.payer?.name} (${result.payment_details.payer?.email})</td></tr>
                                </table>
                            </div>
                        ` : ''}
                        
                        ${result.next_steps ? `
                            <hr>
                            <h6>🎯 Próximos Passos:</h6>
                            <ul class="list-group list-group-flush">
                                ${result.next_steps.map(step => `<li class="list-group-item">${step}</li>`).join('')}
                            </ul>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        ${!hasPaymentId ? `
                            <button type="button" class="btn btn-primary" onclick="checkTestPaymentInfo('${result.test_info.test_id}')">
                                <i class="fas fa-sync-alt me-2"></i>
                                Atualizar
                            </button>
                        ` : `
                            <button type="button" class="btn btn-success" onclick="copyPaymentId('${paymentInfo.payment_id}')">
                                <i class="fas fa-copy me-2"></i>
                                Copiar Payment ID
                            </button>
                        `}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = new bootstrap.Modal(document.getElementById('paymentInfoModal'));
    modal.show();
    
    document.getElementById('paymentInfoModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// Funções auxiliares para os testes
function openTestCheckout(url) {
    window.open(url, '_blank');
}

function copyTestId(testId) {
    copyToClipboardValue(testId);
    showTempAlert('Test ID copiado!', 'success');
}

function copyPaymentId(paymentId) {
    copyToClipboardValue(paymentId);
    showTempAlert('Payment ID copiado!', 'success');
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    copyToClipboardValue(element.value);
    showTempAlert('Copiado!', 'success');
}

function copyToClipboardValue(value) {
    navigator.clipboard.writeText(value).then(() => {
        console.log('Texto copiado:', value);
    }).catch(err => {
        console.error('Erro ao copiar:', err);
        // Fallback para older browsers
        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}

function showTempAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3" 
             style="z-index: 9999;" role="alert">
            <i class="fas fa-${type === 'success' ? 'check' : 'info'}-circle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) {
            alert.remove();
        }
    }, 3000);
}

// Listar todos os testes
async function listAllTestPayments() {
    console.log('📋 Listando todos os testes...');
    
    try {
        showLoading();
        
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/listTestPayments');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Lista de testes:', result);
            showTestList(result);
        } else {
            throw new Error(result.error || 'Erro ao listar testes');
        }
        
    } catch (error) {
        console.error('❌ Erro ao listar testes:', error);
        hideLoading();
        showError(`Erro: ${error.message}`);
    }
}

// Mostrar lista de testes
function showTestList(result) {
    hideLoading();
    
    const modalHtml = `
        <div class="modal fade" id="testListModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header bg-info text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-list me-2"></i>
                            Lista de Testes de Pagamento
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-4">
                            <div class="col-md-3">
                                <div class="card text-white bg-primary">
                                    <div class="card-body text-center">
                                        <h4>${result.stats.total}</h4>
                                        <small>Total de Testes</small>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card text-white bg-success">
                                    <div class="card-body text-center">
                                        <h4>${result.stats.with_payment_id}</h4>
                                        <small>Com Payment ID</small>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card text-white bg-warning">
                                    <div class="card-body text-center">
                                        <h4>${result.stats.status_pending}</h4>
                                        <small>Pendentes</small>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="card text-white bg-danger">
                                    <div class="card-body text-center">
                                        <h4>${result.stats.status_rejected}</h4>
                                        <small>Rejeitados</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="table-responsive">
                            <table class="table table-striped table-hover">
                                <thead class="table-dark">
                                    <tr>
                                        <th>Test ID</th>
                                        <th>Payment ID</th>
                                        <th>Status</th>
                                        <th>Valor</th>
                                        <th>Criado em</th>
                                        <th>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${result.tests.map(test => `
                                        <tr>
                                            <td><code>${test.test_id}</code></td>
                                            <td>
                                                ${test.payment_id !== '❌ Não capturado' ? 
                                                    `<code class="text-success">${test.payment_id}</code>` : 
                                                    '<span class="text-muted">❌ Não capturado</span>'
                                                }
                                            </td>
                                            <td>
                                                <span class="badge ${getStatusBadgeClass(test.payment_status)}">
                                                    ${test.payment_status}
                                                </span>
                                            </td>
                                            <td>R$ ${test.amount}</td>
                                            <td>${new Date(test.created_at?.toDate?.() || test.created_at).toLocaleString()}</td>
                                            <td>
                                                <button class="btn btn-sm btn-outline-info" onclick="checkTestPaymentInfo('${test.test_id}')">
                                                    <i class="fas fa-search"></i>
                                                </button>
                                                <button class="btn btn-sm btn-outline-secondary" onclick="copyTestId('${test.test_id}')">
                                                    <i class="fas fa-copy"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-primary" onclick="testPaymentQuick()">
                            <i class="fas fa-plus me-2"></i>
                            Novo Teste
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = new bootstrap.Modal(document.getElementById('testListModal'));
    modal.show();
    
    document.getElementById('testListModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function getStatusBadgeClass(status) {
    switch(status) {
        case 'approved': return 'bg-success';
        case 'pending': return 'bg-warning';
        case 'rejected': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

// Adicionar botão de teste à interface
function addTestButtonToUI() {
    const testButtonHtml = `
        <div class="position-fixed bottom-0 end-0 m-3" style="z-index: 1000;">
            <div class="btn-group-vertical">
                <button class="btn btn-warning btn-lg shadow" onclick="testPaymentQuick()" title="Teste Rápido de Pagamento">
                    <i class="fas fa-bolt me-2"></i>
                    Teste Rápido
                </button>
                <button class="btn btn-info btn-sm shadow mt-2" onclick="listAllTestPayments()" title="Ver Todos os Testes">
                    <i class="fas fa-list me-2"></i>
                    Listar Testes
                </button>
                <button class="btn btn-outline-dark btn-sm shadow mt-2" onclick="debugAuthState()" title="Debug Auth">
                    <i class="fas fa-bug me-2"></i>
                    Debug Auth
                </button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', testButtonHtml);
}

// Inicializar botões de teste quando a página carregar
document.addEventListener('DOMContentLoaded', function() {
    // Adicionar após um pequeno delay para garantir que tudo carregou
    setTimeout(addTestButtonToUI, 1000);
});

// Make functions available globally
window.testPaymentQuick = testPaymentQuick;
window.checkTestPaymentInfo = checkTestPaymentInfo;
window.listAllTestPayments = listAllTestPayments;
window.openTestCheckout = openTestCheckout;
window.copyTestId = copyTestId;
window.copyPaymentId = copyPaymentId;
window.copyToClipboard = copyToClipboard;