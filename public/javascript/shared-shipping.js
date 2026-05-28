/**
 * shared-shipping.js
 * ──────────────────────────────────────────────────────────────
 * Gerencia o CEP do usuário - inline editing, no popup
 * Click "Insira seu CEP" → turns into input field
 * Type CEP → auto-calculates freight
 * Shows result inline
 * ──────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    /* ── Cloud Function de frete Dimona ────────────────────────────────────── */
    const DIMONA_SHIPPING_URL = 'https://us-central1-kauara1.cloudfunctions.net/getDimonaShipping';

    /* ── Storage key ──────────────────────────────────────────────────────── */
    const CEP_KEY     = 'kauava_user_cep';
    const FREIGHT_KEY = 'kauava_freight';

    /* ── State ────────────────────────────────────────────────────────────── */
    let _cep     = localStorage.getItem(CEP_KEY)     || null;
    let _freight = parseFloat(localStorage.getItem(FREIGHT_KEY)) || null;
    let _listeners = [];

    /* ── Helpers ──────────────────────────────────────────────────────────── */
    function _notify() {
        _listeners.forEach(fn => { try { fn(_freight, _cep); } catch(e){} });
    }

    async function _fetchDimonaFreight(cep) {
        const digits = cep.replace(/\D/g, '');
        const r = await fetch(`${DIMONA_SHIPPING_URL}?zipcode=${digits}&quantity=1`);
        if (!r.ok) throw new Error(`Erro ao consultar frete (${r.status})`);
        const data = await r.json();
        if (!data.success || !data.options?.length) throw new Error('Nenhuma opção de frete disponível para este CEP');
        return data.options[0].value;
    }

    function _fmt(val) {
        if (val == null) return null;
        return 'R$ ' + val.toFixed(2).replace('.', ',');
    }

    function _maskCep(raw) {
        const d = raw.replace(/\D/g, '').slice(0, 8);
        return d.length > 5 ? d.slice(0,5) + '-' + d.slice(5) : d;
    }

    function _unmaskCep(masked) {
        return masked.replace(/\D/g, '');
    }

    /* ── Save & notify ────────────────────────────────────────────────────── */
    function _save(cep, freight) {
        _cep     = cep;
        _freight = freight;
        if (cep) {
            localStorage.setItem(CEP_KEY, cep);
            localStorage.setItem(FREIGHT_KEY, freight);
        } else {
            localStorage.removeItem(CEP_KEY);
            localStorage.removeItem(FREIGHT_KEY);
        }
        _notify();
    }

    /* ────────────────────────────────────────────────────────────────────────
       INLINE CEP INPUT - no popup, just inline editing
    ──────────────────────────────────────────────────────────────────────── */
    function _injectStyles() {
        if (document.getElementById('shipping-inline-styles')) return;
        const s = document.createElement('style');
        s.id = 'shipping-inline-styles';
        s.textContent = `
            /* Header button - transparent, just text and icon */
            #shippingHeaderBtn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 0;
                background: transparent !important;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
                color: #333;
                font-size: 0.85rem;
                font-weight: 500;
                cursor: pointer;
                white-space: nowrap;
                transition: color 0.15s;
            }
            #shippingHeaderBtn:hover {
                color: #7B5CF0;
            }
            #shippingHeaderBtn:focus,
            #shippingHeaderBtn:active {
                outline: none !important;
            }
            #shippingHeaderBtn .sh-icon {
                flex-shrink: 0;
                font-size: 1.1rem;
                color: #7B5CF0;
            }
            #shippingHeaderBtn .sh-label {
                display: flex;
                flex-direction: column;
                line-height: 1.2;
                text-align: left;
            }
            #shippingHeaderBtn .sh-cep-line {
                font-size: 0.65rem;
                color: #888;
                display: block;
            }
            #shippingHeaderBtn:hover .sh-cep-line {
                color: #7B5CF0;
            }

            /* Inline input mode */
            #shippingHeaderBtn.cep-editing {
                cursor: default;
            }
            #shippingHeaderBtn.cep-editing:hover {
                color: #333;
            }
            .cep-inline-input {
                background: transparent;
                border: none;
                border-bottom: 1.5px solid #7B5CF0;
                font-size: 0.85rem;
                font-weight: 500;
                color: #333;
                width: 100px;
                padding: 2px 0;
                outline: none;
                font-family: inherit;
            }
            .cep-inline-input:focus {
                outline: none;
                border-bottom-color: #5e3fd0;
            }
            .sh-loading-dots {
                display: inline-flex;
                gap: 2px;
                font-size: 0.7rem;
            }
            .sh-loading-dots span {
                animation: blink 1.4s infinite;
            }
            .sh-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
            .sh-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes blink {
                0%, 100% { opacity: 0.2; }
                50% { opacity: 1; }
            }

            /* Freight badge on cards */
            .shipping-freight-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: 0.7rem;
                color: #198754;
                font-weight: 500;
                margin-top: 2px;
            }
            .shipping-freight-badge.loading { color: #aaa; }
            .shipping-freight-badge.no-cep  { color: #aaa; cursor: pointer; }
            .shipping-freight-badge.no-cep:hover { color: #7B5CF0; text-decoration: underline; }

            /* produto.html freight row */
            #productFreightRow {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: #f0f7ff;
                border-radius: 8px;
                font-size: 0.85rem;
                color: #1a1a2e;
                margin-top: 8px;
                cursor: pointer;
                border: 1px solid #c8e0ff;
                transition: border-color .15s;
            }
            #productFreightRow:hover { border-color: #7B5CF0; }
            #productFreightRow .pfr-icon { color: #7B5CF0; font-size: 0.9rem; }
            #productFreightRow .pfr-val {
                font-weight: 700;
                color: #7B5CF0;
            }
            #productFreightRow .pfr-change {
                margin-left: auto;
                font-size: 0.72rem;
                color: #888;
                text-decoration: underline;
            }
        `;
        document.head.appendChild(s);
    }

    // Enter edit mode - replaces text with input field
    function _enterEditMode() {
        const btn = document.getElementById('shippingHeaderBtn');
        const labelSpan = document.getElementById('cepAreaLabel');
        if (!btn || !labelSpan) return;

        // Save current CEP value to pre-fill input
        const currentCep = _cep || '';
        
        btn.classList.add('cep-editing');
        
        // Create input element
        const input = document.createElement('input');
        input.type = 'tel';
        input.inputMode = 'numeric';
        input.placeholder = '00000-000';
        input.value = currentCep ? _maskCep(currentCep) : '';
        input.className = 'cep-inline-input';
        input.maxLength = 9;
        
        // Clear the label span and append input
        labelSpan.innerHTML = '';
        labelSpan.appendChild(input);
        
        input.focus();
        input.select();
        
        // Handle input masking as user types
        function onInput(e) {
            input.value = _maskCep(input.value);
        }
        
        async function onComplete() {
            const rawCep = _unmaskCep(input.value);
            
            // Remove input and restore label
            btn.classList.remove('cep-editing');
            
            if (rawCep.length === 8) {
                // Show loading state
                labelSpan.innerHTML = `<span class="sh-loading-dots">Calculando<span>.</span><span>.</span><span>.</span></span><span class="sh-cep-line">buscando frete</span>`;
                
                try {
                    const freight = await _fetchDimonaFreight(rawCep);
                    _save(rawCep, freight);
                    _renderHeaderBtn();
                    _updateAllFreightBadges();
                } catch (err) {
                    console.error('Freight error:', err);
                    _save(null, null);
                    _renderHeaderBtn();
                    _updateAllFreightBadges();
                    // Show error briefly then revert
                    labelSpan.innerHTML = `CEP inválido<span class="sh-cep-line">tente novamente</span>`;
                    setTimeout(() => {
                        if (!_cep) {
                            labelSpan.innerHTML = `Insira seu CEP<span class="sh-cep-line">calcular frete</span>`;
                        } else {
                            _renderHeaderBtn();
                        }
                    }, 2000);
                }
            } else {
                // Invalid CEP or empty - just revert
                if (rawCep.length > 0 && rawCep.length !== 8) {
                    labelSpan.innerHTML = `CEP inválido<span class="sh-cep-line">use 8 dígitos</span>`;
                    setTimeout(() => {
                        if (!_cep) {
                            labelSpan.innerHTML = `Insira seu CEP<span class="sh-cep-line">calcular frete</span>`;
                        } else {
                            _renderHeaderBtn();
                        }
                    }, 1500);
                } else {
                    labelSpan.innerHTML = `Insira seu CEP<span class="sh-cep-line">calcular frete</span>`;
                }
            }
        }
        
        function handleBlur() {
            input.removeEventListener('blur', handleBlur);
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('input', onInput);
            onComplete();
        }
        
        function handleKeydown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.removeEventListener('blur', handleBlur);
                input.removeEventListener('keydown', handleKeydown);
                input.removeEventListener('input', onInput);
                onComplete();
            } else if (e.key === 'Escape') {
                input.removeEventListener('blur', handleBlur);
                input.removeEventListener('keydown', handleKeydown);
                input.removeEventListener('input', onInput);
                btn.classList.remove('cep-editing');
                _renderHeaderBtn();
            }
        }
        
        input.addEventListener('input', onInput);
        input.addEventListener('blur', handleBlur);
        input.addEventListener('keydown', handleKeydown);
    }

    /* ────────────────────────────────────────────────────────────────────────
       HEADER BUTTON RENDER
    ──────────────────────────────────────────────────────────────────────── */
    function _renderHeaderBtn() {
        const btn = document.getElementById('shippingHeaderBtn');
        const labelSpan = document.getElementById('cepAreaLabel');
        if (!btn || !labelSpan) return;

        // Don't mess with the button if it's in editing mode
        if (btn.classList.contains('cep-editing')) return;

        if (_cep && _freight) {
            const formatted = _maskCep(_cep);
            labelSpan.innerHTML = `${formatted}<span class="sh-cep-line">frete ${_fmt(_freight)}</span>`;
        } else {
            labelSpan.innerHTML = `Insira seu CEP<span class="sh-cep-line">calcular frete</span>`;
        }
    }

    function _injectHeaderButton() {
        const btn = document.getElementById('shippingHeaderBtn');
        if (btn) {
            // Replace existing click handler
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!newBtn.classList.contains('cep-editing')) {
                    _enterEditMode();
                }
            });
            window.shippingHeaderBtnElement = newBtn;
            _renderHeaderBtn();
            return;
        }

        // Create button if doesn't exist
        const newBtn = document.createElement('button');
        newBtn.id = 'shippingHeaderBtn';
        newBtn.title = 'Clique para definir CEP';
        newBtn.innerHTML = `<i class="fas fa-map-marker-alt sh-icon"></i><span class="sh-label" id="cepAreaLabel">Insira seu CEP<span class="sh-cep-line">calcular frete</span></span>`;
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!newBtn.classList.contains('cep-editing')) {
                _enterEditMode();
            }
        });

        const notifBtn = document.querySelector('#notificationButton')?.parentElement;
        if (notifBtn) {
            notifBtn.parentElement.insertBefore(newBtn, notifBtn);
        } else {
            const headerRight = document.querySelector('.header-right');
            if (headerRight) {
                headerRight.insertBefore(newBtn, headerRight.firstChild);
            }
        }

        _renderHeaderBtn();
    }

    /* ── FREIGHT BADGE ────────────────────────────────────────────────────── */
    function createFreightBadge() {
        const span = document.createElement('span');
        _applyBadgeContent(span);
        const _handler = () => _applyBadgeContent(span);
        _listeners.push(_handler);
        span._shippingUnsub = () => { _listeners = _listeners.filter(f => f !== _handler); };
        return span;
    }

    function _applyBadgeContent(span) {
        if (_freight != null) {
            span.className = 'shipping-freight-badge';
            span.innerHTML = `<i class="fas fa-truck" style="font-size:0.65rem;"></i> Frete ${_fmt(_freight)}`;
            span.onclick = null;
        } else {
            span.className = 'shipping-freight-badge no-cep';
            span.innerHTML = `<i class="fas fa-map-marker-alt" style="font-size:0.65rem;"></i> Ver frete`;
            span.onclick = (e) => { e.stopPropagation(); _enterEditMode(); };
        }
    }

    function _updateAllFreightBadges() {
        document.querySelectorAll('.shipping-freight-badge').forEach(el => {
            _applyBadgeContent(el);
        });
        _updateProductPageFreightRow();
    }

    /* ── produto.html freight row (click also triggers inline edit) ───────── */
    function renderProductPageFreightRow(containerEl) {
        if (!containerEl) return;
        if (document.getElementById('productFreightRow')) return;

        const row = document.createElement('div');
        row.id = 'productFreightRow';
        row.title = 'Clique para definir CEP';
        row.addEventListener('click', () => _enterEditMode());
        containerEl.appendChild(row);
        _updateProductPageFreightRow();

        _listeners.push(() => _updateProductPageFreightRow());
    }

    function _updateProductPageFreightRow() {
        const row = document.getElementById('productFreightRow');
        if (!row) return;
        if (_freight != null) {
            row.innerHTML = `
                <i class="fas fa-truck pfr-icon"></i>
                <span>Frete:</span>
                <span class="pfr-val">${_fmt(_freight)}</span>
                <span style="font-size:0.75rem;color:#555;">(${_maskCep(_cep || '')})</span>
                <span class="pfr-change">alterar CEP</span>`;
        } else {
            row.innerHTML = `
                <i class="fas fa-map-marker-alt pfr-icon"></i>
                <span>Clique para definir seu CEP</span>
                <span class="pfr-change" style="color:#7B5CF0;">inserir CEP</span>`;
        }
    }

    /* ── Total com frete ───────────────────────────────────────────────────── */
    function getTotalWithFreight(productPrice) {
        if (_freight === null) return productPrice;
        return productPrice + _freight;
    }

    function getFormattedTotalWithFreight(productPrice) {
        const total = getTotalWithFreight(productPrice);
        return `R$ ${total.toFixed(2).replace('.', ',')}`;
    }

    /* ── PUBLIC API ───────────────────────────────────────────────────────── */
    const ShippingManager = {
        getFreight()          { return _freight; },
        getFormattedFreight() { return _fmt(_freight); },
        getCep()              { return _cep; },
        getTotalWithFreight,
        getFormattedTotalWithFreight,
        onChange(fn) {
            _listeners.push(fn);
            return () => { _listeners = _listeners.filter(f => f !== fn); };
        },
        openCepInput: _enterEditMode,  // renamed - no popup anymore
        createFreightBadge,
        renderProductPageFreightRow,
    };

    window.ShippingManager = ShippingManager;

    /* ── Auto-init ────────────────────────────────────────────────────────── */
    function _autoInit() {
        _injectStyles();
        _injectHeaderButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoInit);
    } else {
        _autoInit();
    }
})();