(function() {
    function getClosestActionElement(element) {
        return element.closest('[data-action]');
    }

    function parseJsonData(value) {
        try {
            return value ? JSON.parse(decodeURIComponent(value)) : null;
        } catch (err) {
            console.error('Failed to parse JSON data attribute:', err, value);
            return null;
        }
    }

    document.addEventListener('click', function(event) {
        const target = getClosestActionElement(event.target);
        if (!target) return;

        const action = target.dataset.action;
        if (!action) return;

        event.preventDefault();

        switch (action) {
            case 'goBack':
                window.history.back();
                break;
            case 'navigate':
                if (target.dataset.target) window.location.href = target.dataset.target;
                break;
            case 'checkoutSelected':
                if (typeof checkoutSelected === 'function') checkoutSelected();
                break;
            case 'refreshAllData':
                if (typeof refreshAllData === 'function') refreshAllData();
                break;
            case 'removeFromCart':
                if (typeof removeFromCart === 'function') removeFromCart(Number(target.dataset.index));
                break;
            case 'refreshOrderStatus':
                if (typeof refreshOrderStatus === 'function') refreshOrderStatus(target.dataset.orderId, Number(target.dataset.index));
                break;
            case 'cancelPurchase':
                if (typeof cancelPurchase === 'function') cancelPurchase(target.dataset.orderId, Number(target.dataset.index));
                break;
            case 'selectShippingOption':
                if (typeof selectShippingOption === 'function' && target.dataset.opt) {
                    const opt = parseJsonData(target.dataset.opt);
                    if (opt) selectShippingOption(opt);
                }
                break;
            case 'submitRating':
                if (window.productRatingSystems && target.dataset.productId && typeof window.productRatingSystems[target.dataset.productId]?.submitRating === 'function') {
                    window.productRatingSystems[target.dataset.productId].submitRating(Number(target.dataset.value));
                }
                break;
            case 'copyText':
                if (navigator.clipboard && target.dataset.copy) {
                    navigator.clipboard.writeText(target.dataset.copy).catch(console.error);
                }
                break;
            case 'viewJson':
                if (target.dataset.json) {
                    const data = parseJsonData(target.dataset.json);
                    alert(JSON.stringify(data, null, 2));
                }
                break;
            case 'comprarProduto':
                if (typeof comprarProduto === 'function') comprarProduto(target.dataset.productId);
                break;
            case 'toggleSelectAll':
                if (typeof toggleSelectAll === 'function') toggleSelectAll(event.target.checked);
                break;
            case 'updateSelectionTotal':
                if (typeof updateSelectionTotal === 'function') updateSelectionTotal();
                break;
            default:
                console.warn('Unhandled data-action:', action);
        }
    });

    document.addEventListener('change', function(event) {
        const target = getClosestActionElement(event.target);
        if (!target) return;
        const action = target.dataset.action;
        if (!action) return;

        if (action === 'toggleSelectAll' && typeof toggleSelectAll === 'function') {
            toggleSelectAll(event.target.checked);
        }
        if (action === 'updateSelectionTotal' && typeof updateSelectionTotal === 'function') {
            updateSelectionTotal();
        }
    });

    document.addEventListener('mouseover', function(event) {
        const target = getClosestActionElement(event.target);
        if (!target || target.dataset.action !== 'hoverColor') return;
        if (typeof handleColorHover === 'function') handleColorHover(target.dataset.color);
    });

    document.addEventListener('mouseout', function(event) {
        const target = getClosestActionElement(event.target);
        if (!target || target.dataset.action !== 'hoverColor') return;
        if (typeof handleColorHoverEnd === 'function') handleColorHoverEnd();
    });

    document.addEventListener('error', function(event) {
        const target = event.target;
        if (target && target.tagName === 'IMG' && target.dataset.fallbackSrc) {
            target.src = target.dataset.fallbackSrc;
        }
    }, true);
})();
