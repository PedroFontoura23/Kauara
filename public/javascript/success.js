// success.js - Payment return page polling logic

const FUNCTIONS_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';
const POLL_INTERVAL_MS   = 3000;
const MAX_POLL_ATTEMPTS  = 40;

let pollAttempts = 0;
let pollTimer    = null;

window.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(window.location.search);

  // Get external_reference from URL only (no fallbacks)
  const ref = params.get('external_reference');

  if (!ref) {
    render('error', 'Nenhuma referência de pedido encontrada na URL', null);
    return;
  }

  render('pending', null, ref);
  startPolling(ref);
});

function render(state, message, ref) {
  const card = document.getElementById('card');
  if (!card) return;

  const refHtml = ref
    ? '<p class="order-ref">Pedido: <strong>' + escHtml(ref) + '</strong></p>'
    : '';

  const states = {
    pending:
      '<div class="icon-wrap pending"><div class="spinner"></div></div>' +
      '<h2>Aguardando confirmação<span class="dots"></span></h2>' +
      '<p>Seu pedido foi recebido. Estamos aguardando a confirmação do Mercado Pago.</p>' +
      '<p class="hint">Isso normalmente leva alguns segundos. Não feche esta página.</p>' +
      refHtml +
      '<div id="pollInfo"></div>',

    approved:
      '<div class="icon-wrap approved">✓</div>' +
      '<h2>Pagamento confirmado!</h2>' +
      '<p>Seu pedido foi aprovado e está sendo processado.</p>' +
      '<p class="hint">Você será redirecionado para o carrinho em alguns segundos para ver seus itens comprados.</p>' +
      refHtml +
      '<div class="mt-3">' +
      '<div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>' +
      '<span>Redirecionando...</span>' +
      '</div>',

    rejected:
      '<div class="icon-wrap rejected">✗</div>' +
      '<h2>Pagamento não aprovado</h2>' +
      '<p>' + escHtml(message || 'Seu pagamento foi recusado. Nenhum valor foi cobrado.') + '</p>' +
      refHtml +
      '<a href="/checkout.html" class="btn btn-secondary">Tentar novamente</a>',

    cancelled:
      '<div class="icon-wrap rejected">✗</div>' +
      '<h2>Pagamento cancelado</h2>' +
      '<p>Você cancelou o pagamento. Seu carrinho foi mantido.</p>' +
      '<a href="/checkout.html" class="btn btn-secondary">Voltar ao checkout</a>',

    timeout:
      '<div class="icon-wrap timeout">⏳</div>' +
      '<h2>Tempo limite excedido</h2>' +
      '<p>Não foi possível confirmar o status do pagamento. Verifique seu email para confirmação.</p>' +
      refHtml +
      '<a href="/inicio.html" class="btn btn-primary">Ir à loja</a>',

    error:
      '<div class="icon-wrap rejected">!</div>' +
      '<h2>Erro ao verificar pedido</h2>' +
      '<p>' + escHtml(message || 'Não foi possível identificar seu pedido.') + '</p>' +
      '<a href="/inicio.html" class="btn btn-primary">Ir à loja</a>',
  };

  card.innerHTML = states[state] || states.error;
}

function startPolling(ref) {
  pollAttempts = 0;
  poll(ref);
}

async function poll(ref) {
  if (pollAttempts >= MAX_POLL_ATTEMPTS) {
    clearTimeout(pollTimer);
    render('timeout', null, ref);
    return;
  }

  pollAttempts++;
  updatePollInfo();

  try {
    const res = await fetch(
      FUNCTIONS_BASE_URL + '/getPaymentStatus?external_reference=' + encodeURIComponent(ref)
    );

    if (!res.ok) {
      scheduleNext(ref);
      return;
    }

    const data = await res.json();
    const status = data.payment?.status || 'pending';

    console.log('[attempt ' + pollAttempts + '] status:', status);

    if (status === 'approved') {
      clearTimeout(pollTimer);
      
      console.log('✅ Pagamento aprovado! Aguardando processamento...');
      
      // 🔥 FIX: Clear ALL cart-related storage immediately
      sessionStorage.removeItem('lastPaymentRef');
      sessionStorage.removeItem('cartToPay');
      sessionStorage.removeItem('selectedProduct');
      sessionStorage.removeItem('lastPayment');
      
      // Force clear localStorage cart
      localStorage.removeItem('cart');
      
      // Pequeno delay para garantir que o webhook processou
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to force manual cleanup
      try {
        console.log('🔧 Attempting manual cart cleanup for order:', ref);
        const cleanupResponse = await fetch(
          `${FUNCTIONS_BASE_URL}/manualCartCleanup?order_id=${encodeURIComponent(ref)}&force=true`
        );
        const cleanupResult = await cleanupResponse.json();
        console.log('Manual cleanup result:', cleanupResult);
      } catch (cleanupError) {
        console.warn('Manual cleanup failed (non-critical):', cleanupError);
      }
      
      // Set flags for cart page
      sessionStorage.setItem('forceCartRefresh', 'true');
      sessionStorage.setItem('pendingOrderCheck', ref);
      
      render('approved', null, ref);
      
      // Redirecionar para o carrinho após 3 segundos
      setTimeout(() => {
        window.location.href = '/carrinho.html?refresh=true&force_clear=true&order=' + encodeURIComponent(ref);
      }, 3000);
      
      return;
    } else if (status === 'rejected') {
      clearTimeout(pollTimer);
      render('rejected', null, ref);
      return;
    } else if (status === 'cancelled') {
      clearTimeout(pollTimer);
      render('cancelled', null, ref);
      return;
    } else {
      scheduleNext(ref);
      return;
    }
  } catch (err) {
    console.warn('Poll error:', err.message);
    scheduleNext(ref);
  }
}

function scheduleNext(ref) {
  pollTimer = setTimeout(function () { poll(ref); }, POLL_INTERVAL_MS);
}

function updatePollInfo() {
  var el = document.getElementById('pollInfo');
  if (el) {
    el.textContent = 'Verificando... (' + pollAttempts + '/' + MAX_POLL_ATTEMPTS + ')';
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}