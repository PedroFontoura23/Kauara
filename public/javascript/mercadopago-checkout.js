// mercadopago-checkout-simple.js - CHECKOUT PRO SIMPLIFICADO
console.log('🔗 CHECKOUT PRO - CARREGADO');

// Funções auxiliares para debug
function debugCheckoutPro() {
    console.log('🔍 DEBUG CHECKOUT PRO:');
    console.log('- ✅ Redirecionamento para página do Mercado Pago');
    console.log('- ✅ Não requer SDK complexo no frontend');
    console.log('- ✅ Mais simples e confiável');
    console.log('- ✅ Resolve problemas de botões cinza');
    console.log('- ✅ Melhor experiência do usuário');
}

// Sistema de testes
async function runCheckoutProTests() {
    console.log('🧪 EXECUTANDO TESTES CHECKOUT PRO...');
    
    try {
        const response = await fetch('https://us-central1-kauara1.cloudfunctions.net/debugCheckoutPro');
        const result = await response.json();
        
        console.log('📊 RESULTADO TESTES:', result);
        return result;
    } catch (error) {
        console.error('❌ ERRO NOS TESTES:', error);
        return { error: error.message };
    }
}

// Exportar para uso global
window.CheckoutPro = {
    debug: debugCheckoutPro,
    test: runCheckoutProTests,
    info: 'Checkout Pro - Redirecionamento para Mercado Pago',
    version: '2.0'
};

console.log('🎯 CHECKOUT PRO CONFIGURADO - PRONTO PARA USO');