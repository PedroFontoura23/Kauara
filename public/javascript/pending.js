// pending.js - Versão que chama o PPP diretamente

const FUNCTIONS_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';
let checkInterval = null;
let attempts = 0;
let isRedirecting = false; // Evitar múltiplos redirecionamentos

const MAX_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 3000;

// =============================================
// UTILITÁRIOS
// =============================================

function getExternalReference() {
    // Método 1: URL params
    const urlParams = new URLSearchParams(window.location.search);
    let externalReference = urlParams.get('external_reference');
    
    if (externalReference) {
        console.log('✅ Encontrado na URL:', externalReference);
        return externalReference;
    }
    
    // Método 2: SessionStorage - lastPayment
    const lastPayment = sessionStorage.getItem('lastPayment');
    if (lastPayment) {
        try {
            const paymentData = JSON.parse(lastPayment);
            if (paymentData.external_reference) {
                console.log('✅ Encontrado no lastPayment:', paymentData.external_reference);
                return paymentData.external_reference;
            }
        } catch(e) {}
    }
    
    // Método 3: SessionStorage - lastPaymentRef
    const lastPaymentRef = sessionStorage.getItem('lastPaymentRef');
    if (lastPaymentRef) {
        console.log('✅ Encontrado no lastPaymentRef:', lastPaymentRef);
        return lastPaymentRef;
    }
    
    console.error('❌ Nenhum external_reference encontrado');
    return null;
}

function stopPolling() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

// =============================================
// 🔥 FUNÇÃO CRÍTICA: Move os produtos do carrinho
// =============================================

async function moveProductsToPurchased(externalReference) {
    console.log('='.repeat(60));
    console.log('🚚 MOVENDO PRODUTOS DO CARRINHO...');
    console.log('='.repeat(60));
    console.log(`📦 Order ID: ${externalReference}`);

    // Declarado FORA do try para que o catch também possa acessar
    const moveStatusEl = document.getElementById('moveStatus');

    try {
        if (moveStatusEl) {
            moveStatusEl.style.display = 'block';
            moveStatusEl.innerHTML = '<i class="fas fa-spinner fa-pulse me-2"></i> Movendo produtos...';
        }

        console.log('📡 Chamando moveOrderToPurchased...');

        const response = await fetch(`${FUNCTIONS_BASE_URL}/moveOrderToPurchased`, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: externalReference })
        });

        const data = await response.json();
        console.log('📦 moveOrderToPurchased response:', data);

        if (!response.ok || !data.success) {
            console.error('❌ moveOrderToPurchased falhou:', data.error, data.detail || '');
            if (moveStatusEl) {
                moveStatusEl.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i> Erro: ${data.error || 'Falha ao mover produtos'}`;
            }
            return false;
        }

        if (data.moved === 0 && !data.already_processed) {
            console.warn('⚠️ moveOrderToPurchased retornou moved=0 — verifique os logs do Firebase para detalhes do usuário e cart_products');
        }

        if (moveStatusEl) {
            moveStatusEl.innerHTML = '<i class="fas fa-check-circle me-2"></i> Produtos movidos com sucesso!';
        }
        return true;

    } catch (error) {
        console.error('❌ Erro ao mover produtos:', error);
        if (moveStatusEl) {
            moveStatusEl.innerHTML = '<i class="fas fa-info-circle me-2"></i> Pedido será processado em alguns instantes...';
        }
        return false;
    }
}

// =============================================
// VERIFICAÇÃO DO STATUS
// =============================================

async function checkPaymentStatus(externalReference) {
    if (isRedirecting) {
        console.log('⏭️ Já está redirecionando, ignorando...');
        return false;
    }
    
    console.log(`🔍 Verificando pedido: ${externalReference}`);
    console.log(`⏰ ${new Date().toLocaleString()}`);
    
    try {
        // Buscar status do Firestore
        const response = await fetch(
            `${FUNCTIONS_BASE_URL}/getOrderDetails?order_id=${externalReference}`
        );
        
        if (!response.ok) {
            console.warn(`⚠️ HTTP ${response.status}`);
            return false;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.order) {
            console.warn('⚠️ Pedido não encontrado');
            return false;
        }
        
        const order = data.order;
        const paymentStatus = order.payment_status || order.status;
        
        console.log(`📊 Status do Firestore: "${paymentStatus}"`);
        
        // Atualizar UI
        const valorElement = document.getElementById('orderAmount');
        if (valorElement) {
            valorElement.textContent = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            }).format(order.total_amount || 0);
        }
        
        const statusBadge = document.getElementById('paymentStatus');
        
        // 🔥 CASO APROVADO
        if (paymentStatus === 'approved') {
            console.log('✅✅✅ PAGAMENTO APROVADO! ✅✅✅');
            
            // Atualizar UI imediatamente
            if (statusBadge) {
                statusBadge.textContent = 'APROVADO!';
                statusBadge.className = 'status-badge status-approved';
            }
            document.getElementById('spinner').style.display = 'none';
            document.querySelector('.payment-icon').textContent = '✅';
            
            // 🔥🔥🔥 CHAMAR A MOVIMENTAÇÃO DOS PRODUTOS 🔥🔥🔥
            const moved = await moveProductsToPurchased(externalReference);
            
            if (moved) {
                console.log('🎉 Produtos movidos com sucesso! Redirecionando...');
                if (document.getElementById('statusMessage')) {
                    document.getElementById('statusMessage').innerHTML = 
                        '<i class="fas fa-check-circle me-2"></i> Pagamento confirmado! Produtos movidos para sua conta. Redirecionando...';
                }
            } else {
                console.warn('⚠️ Falha ao mover produtos, mas pagamento está aprovado');
                if (document.getElementById('statusMessage')) {
                    document.getElementById('statusMessage').innerHTML = 
                        '<i class="fas fa-check-circle me-2"></i> Pagamento confirmado! Redirecionando... (Produtos serão sincronizados em breve)';
                }
            }
            
            stopPolling();
            isRedirecting = true;
            
            // Limpar sessionStorage
            sessionStorage.removeItem('lastPayment');
            sessionStorage.removeItem('pendingOrderCheck');
            sessionStorage.removeItem('cartToPay');
            sessionStorage.removeItem('selectedProduct');
            
            // Redirecionar para success após 2 segundos
            setTimeout(() => {
                window.location.href = `/success.html?external_reference=${externalReference}&status=approved&moved=${moved}`;
            }, 2000);
            
            return true;
        }
        
        // CASO REJEITADO
        if (paymentStatus === 'rejected' || 
            paymentStatus === 'cancelled' || 
            paymentStatus === 'refunded') {
            console.log('❌ Pagamento REJEITADO');
            stopPolling();
            isRedirecting = true;
            showFailedPayment(`Pagamento ${paymentStatus}. Tente novamente.`);
            return true;
        }
        
        // CASO PENDENTE
        console.log('⏳ Pagamento PENDENTE - aguardando...');
        if (statusBadge) {
            statusBadge.textContent = 'Aguardando pagamento';
            statusBadge.className = 'status-badge status-pending';
        }
        
        // Mostrar instruções baseado no método
        const paymentType = new URLSearchParams(window.location.search).get('payment_type');
        if (paymentType === 'bank_transfer' || paymentType === 'pix') {
            const pixInstructions = document.getElementById('pixInstructions');
            if (pixInstructions) pixInstructions.classList.remove('d-none');
        } else if (paymentType === 'ticket') {
            const boletoInstructions = document.getElementById('boletoInstructions');
            if (boletoInstructions) boletoInstructions.classList.remove('d-none');
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ Erro ao verificar:', error);
        return false;
    }
}

// =============================================
// INICIALIZAÇÃO E POLLING
// =============================================

async function startChecking() {
    const externalReference = getExternalReference();
    
    console.log('🚀 Iniciando verificação para:', externalReference);
    console.log('📍 URL atual:', window.location.href);
    
    // Atualizar elementos da UI
    const orderIdEl = document.getElementById('orderId');
    if (orderIdEl) orderIdEl.textContent = externalReference || 'N/A';
    
    const maxAttemptsEl = document.getElementById('maxAttempts');
    if (maxAttemptsEl) maxAttemptsEl.textContent = MAX_ATTEMPTS;
    
    if (!externalReference) {
        showError('Nenhuma referência de pedido encontrada');
        return;
    }
    
    // Verificação imediata
    console.log('🔍 Verificação inicial...');
    try {
        const done = await checkPaymentStatus(externalReference);
        if (done) return;
    } catch(e) {
        console.warn('Verificação inicial falhou:', e);
    }
    
    // Iniciar polling
    console.log(`🔄 Iniciando polling a cada ${POLL_INTERVAL_MS}ms`);
    checkInterval = setInterval(async () => {
        attempts++;
        const attemptEl = document.getElementById('attemptCount');
        if (attemptEl) attemptEl.textContent = attempts;
        
        console.log(`🔄 Polling ${attempts}/${MAX_ATTEMPTS}...`);
        
        try {
            const done = await checkPaymentStatus(externalReference);
            if (done) return;
        } catch (error) {
            console.error('❌ Erro no polling:', error);
        }
        
        if (attempts >= MAX_ATTEMPTS) {
            stopPolling();
            const spinner = document.getElementById('spinner');
            if (spinner) spinner.style.display = 'none';
            
            const statusMsg = document.getElementById('statusMessage');
            if (statusMsg) {
                statusMsg.innerHTML = '⏰ Tempo limite excedido. Use o botão abaixo para verificar manualmente.';
            }
        }
        
    }, POLL_INTERVAL_MS);
}

function showFailedPayment(message) {
    stopPolling();
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'none';
    
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) statusMsg.innerHTML = message;
    
    const statusBadge = document.getElementById('paymentStatus');
    if (statusBadge) {
        statusBadge.textContent = 'FALHOU';
        statusBadge.className = 'status-badge status-failed';
    }
    
    const icon = document.querySelector('.payment-icon');
    if (icon) icon.textContent = '❌';
    
    const title = document.querySelector('h2');
    if (title) title.textContent = 'Pagamento Não Confirmado';
    
    const btn = document.getElementById('checkAgainBtn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-redo"></i> Tentar Novamente';
        btn.onclick = () => { window.location.href = '/checkout.html'; };
    }
}

function showError(message) {
    stopPolling();
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'none';
    
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) statusMsg.innerHTML = message;
    
    const statusBadge = document.getElementById('paymentStatus');
    if (statusBadge) {
        statusBadge.textContent = 'ERRO';
        statusBadge.className = 'status-badge status-failed';
    }
}

// =============================================
// EVENT LISTENERS
// =============================================

// Botão de verificar novamente
const checkAgainBtn = document.getElementById('checkAgainBtn');
if (checkAgainBtn) {
    checkAgainBtn.addEventListener('click', async function() {
        const externalReference = getExternalReference();
        if (!externalReference) {
            window.location.reload();
            return;
        }
        
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        
        try {
            await checkPaymentStatus(externalReference);
        } catch(e) {
            console.error('Erro:', e);
            alert('Erro ao verificar. Tente novamente.');
        }
        
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-sync-alt"></i> Verificar Novamente';
    });
}

// Quando a janela ganhar foco
window.addEventListener('focus', async function() {
    const externalReference = getExternalReference();
    if (!externalReference || !checkInterval || isRedirecting) return;
    console.log('👁️ Página em foco - verificando novamente');
    try {
        await checkPaymentStatus(externalReference);
    } catch(e) {}
});

// Iniciar
document.addEventListener('DOMContentLoaded', startChecking);

console.log('✅ pending.js carregado - Modo com movimentação automática ativada');