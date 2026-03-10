// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyD6MZrzLDv1bnv7MOn1h9j5C98yT19MOhE",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.appspot.com",
    messagingSenderId: "165818811192",
    appId: "1:165818811192:web:67247b17f5b90e1b1ed028"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Enable offline persistence
db.enablePersistence()
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.log('Multiple tabs open, persistence disabled');
        } else if (err.code === 'unimplemented') {
            console.log('Browser doesn\'t support persistence');
        }
    });

// Global data storage
let allData = {
    payments: [],
    orders: [],
    users: [],
    products: [],
    arts: [],
    purchased: [],
    orderEvents: [],
    webhookFailures: [],
    notificationQueue: [],
    adminAlerts: [],
    printfulOrders: [],
    printfulErrors: [],
    printfulRetry: [],
    printfulSuccess: [],
    purchaseErrors: [],
    orphanPayments: [],
    expirationTasks: [],
    captureQueue: []
};

// Collection mappings
const collections = [
    { name: 'checkout_payments', key: 'payments' },
    { name: 'orders', key: 'orders' },
    { name: 'users', key: 'users' },
    { name: 'products', key: 'products' },
    { name: 'arts', key: 'arts' },
    { name: 'purchased_products', key: 'purchased' },
    { name: 'order_events', key: 'orderEvents' },
    { name: 'webhook_failures', key: 'webhookFailures' },
    { name: 'notification_queue', key: 'notificationQueue' },
    { name: 'admin_alerts', key: 'adminAlerts' },
    { name: 'printful_errors', key: 'printfulErrors' },
    { name: 'printful_retry_queue', key: 'printfulRetry' },
    { name: 'printful_retry_success', key: 'printfulSuccess' },
    { name: 'purchase_errors', key: 'purchaseErrors' },
    { name: 'orphan_payments', key: 'orphanPayments' },
    { name: 'expiration_tasks', key: 'expirationTasks' },
    { name: 'capture_queue', key: 'captureQueue' }
];

// Also get printful orders from checkout_payments that have printful_order_id
async function fetchPrintfulOrders() {
    try {
        const snapshot = await db.collection('checkout_payments')
            .where('printful_order_id', '!=', null)
            .get();
        
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                created_at: data.created_at?.toDate?.() || data.created_at,
                updated_at: data.updated_at?.toDate?.() || data.updated_at,
                printful_order_created_at: data.printful_order_created_at?.toDate?.() || data.printful_order_created_at
            };
        });
    } catch (error) {
        console.error('Error fetching printful orders:', error);
        return [];
    }
}

// Fetch all data
async function refreshAllData() {
    document.getElementById('lastUpdated').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    
    try {
        // Fetch all collections in parallel
        const promises = collections.map(c => 
            db.collection(c.name).get()
                .then(snapshot => {
                    allData[c.key] = snapshot.docs.map(doc => {
                        const data = doc.data();
                        // Convert Firestore timestamps to JS dates
                        const processed = {};
                        Object.keys(data).forEach(key => {
                            if (data[key] && typeof data[key].toDate === 'function') {
                                processed[key] = data[key].toDate();
                            } else {
                                processed[key] = data[key];
                            }
                        });
                        return {
                            id: doc.id,
                            ...processed
                        };
                    });
                })
                .catch(error => {
                    console.error(`Error fetching ${c.name}:`, error);
                    allData[c.key] = [];
                })
        );

        // Add printful orders fetch
        promises.push(
            fetchPrintfulOrders().then(orders => {
                allData.printfulOrders = orders;
            })
        );

        await Promise.all(promises);

        // Update counts
        updateCounts();
        
        // Render all tables
        renderPayments();
        renderOrders();
        renderUsers();
        renderProducts();
        renderArts();
        renderPurchased();
        renderOrderEvents();
        renderWebhookFailures();
        renderNotificationQueue();
        renderAdminAlerts();
        renderPrintfulOrders();
        renderPrintfulErrors();
        renderPrintfulRetry();
        renderPrintfulSuccess();
        renderPurchaseErrors();
        renderOrphanPayments();
        renderExpirationTasks();
        renderCaptureQueue();

        document.getElementById('lastUpdated').innerHTML = 
            `<i class="fas fa-check-circle text-success"></i> Updated: ${new Date().toLocaleString()}`;

    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('lastUpdated').innerHTML = 
            `<i class="fas fa-exclamation-triangle text-danger"></i> Error: ${error.message}`;
    }
}

function updateCounts() {
    document.getElementById('paymentsCount').textContent = allData.payments.length;
    document.getElementById('ordersCount').textContent = allData.orders.length;
    document.getElementById('usersCount').textContent = allData.users.length;
    document.getElementById('productsCount').textContent = allData.products.length;
    document.getElementById('artsCount').textContent = allData.arts.length;
    document.getElementById('purchasedCount').textContent = allData.purchased.length;
    document.getElementById('webhooksCount').textContent = 
        allData.orderEvents.length + allData.webhookFailures.length + allData.notificationQueue.length + allData.adminAlerts.length;
    document.getElementById('printfulCount').textContent = 
        allData.printfulOrders.length + allData.printfulErrors.length + allData.printfulRetry.length + allData.printfulSuccess.length;
    document.getElementById('errorsCount').textContent = 
        allData.purchaseErrors.length + allData.orphanPayments.length + allData.expirationTasks.length + allData.captureQueue.length;
}

// Helper function to format JSON for display
function formatJSON(data, maxLength = 300) {
    if (!data) return 'null';
    try {
        const str = JSON.stringify(data, null, 2);
        if (str.length > maxLength) {
            return `<div class="json-view">${str.substring(0, maxLength)}... <button class="btn btn-sm btn-link" onclick='alert(JSON.stringify(${JSON.stringify(data).replace(/'/g, "\\'")}, null, 2))'>View Full</button></div>`;
        }
        return `<div class="json-view">${str}</div>`;
    } catch {
        return String(data);
    }
}

// Helper function to format currency
function formatCurrency(value) {
    if (!value && value !== 0) return 'N/A';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

// Helper function to format date
function formatDate(date) {
    if (!date) return 'N/A';
    if (date && typeof date === 'object' && date.seconds) {
        date = new Date(date.seconds * 1000);
    }
    if (typeof date === 'string') date = new Date(date);
    if (!(date instanceof Date) || isNaN(date)) return 'Invalid Date';
    return date.toLocaleString('pt-BR');
}

// Helper to get status badge class
function getStatusClass(status) {
    const statusMap = {
        'approved': 'text-success',
        'completed': 'text-success',
        'pending': 'text-warning',
        'rejected': 'text-danger',
        'cancelled': 'text-danger',
        'refunded': 'text-info',
        'processing': 'text-info',
        'shipped': 'text-primary',
        'delivered': 'text-success'
    };
    return statusMap[status?.toLowerCase()] || '';
}

// Render functions for each table
function renderPayments() {
    const tbody = document.getElementById('paymentsBody');
    if (!allData.payments.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No payments found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.payments.map(p => {
        try {
            return `
                <tr>
                    <td><strong>${p.external_reference || p.id || 'N/A'}</strong><br>
                        <small class="timestamp">Pref: ${p.preference_id || 'N/A'}</small></td>
                    <td>
                        ${p.customer_email || p.buyer_info?.email || 'N/A'}<br>
                        <small>${p.buyer_info?.name || ''}</small><br>
                        <small class="timestamp">Phone: ${p.buyer_info?.phone || p.phone || 'N/A'}</small>
                    </td>
                    <td>
                        <span class="fw-bold">${formatCurrency(p.total_amount || p.unit_price)}</span><br>
                        <small>Shipping: ${formatCurrency(p.shipping_cost)}</small>
                    </td>
                    <td>
                        <span class="${getStatusClass(p.status)} fw-bold">${p.status || 'N/A'}</span><br>
                        <small>Order: ${p.order_status || 'N/A'}</small><br>
                        <small>MP: ${p.payment_id || 'N/A'}</small>
                    </td>
                    <td>
                        ${p.payment_method || p.payment_details?.method || 'N/A'}<br>
                        <small>${p.payment_type || p.payment_details?.type || ''}</small>
                    </td>
                    <td>
                        <strong>${p.cart_products?.length || 0} products</strong>
                        ${(p.cart_products || []).slice(0, 3).map(prod => `
                            <div class="small border-top mt-1 pt-1">
                                <span>${prod.title || 'Product'}</span><br>
                                <span class="timestamp">Designer: ${prod.designer_name || prod.designer_id || 'N/A'}</span><br>
                                <span class="timestamp">Variant: ${prod.variant_id || 'N/A'}</span>
                            </div>
                        `).join('')}
                        ${p.cart_products?.length > 3 ? `<div class="small text-muted">+${p.cart_products.length - 3} more</div>` : ''}
                    </td>
                    <td>
                        <small>Method: ${p.shipping_method || 'N/A'}</small><br>
                        <small>Address: ${p.shipping_address?.street_name || p.shipping_address?.address1 || ''} ${p.shipping_address?.street_number || ''}</small><br>
                        <small>${p.shipping_address?.city_name || ''} - ${p.shipping_address?.state_name || ''}</small>
                    </td>
                    <td>
                        ${p.printful_order_id ? `
                            <span class="text-success">✅ ${p.printful_order_id}</span><br>
                            <small>Status: ${p.printful_order_status || 'N/A'}</small>
                        ` : '❌ Not created'}
                    </td>
                    <td>${formatDate(p.created_at)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(p).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering payment:', e);
            return '';
        }
    }).join('');
}

function renderOrders() {
    const tbody = document.getElementById('ordersBody');
    if (!allData.orders.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No orders found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.orders.map(o => {
        try {
            return `
                <tr>
                    <td><strong>${o.id || 'N/A'}</strong></td>
                    <td>${o.customer_email || 'N/A'}</td>
                    <td>${formatCurrency(o.total_amount)}</td>
                    <td>
                        <span class="${getStatusClass(o.status)} fw-bold">${o.status || 'N/A'}</span>
                        ${o.payment_approved_at ? '<br><small class="timestamp">Approved: ' + formatDate(o.payment_approved_at) + '</small>' : ''}
                    </td>
                    <td>
                        <strong>${o.products?.length || 0} products</strong>
                        ${(o.products || []).slice(0, 3).map(p => `
                            <div class="small border-top mt-1 pt-1">
                                ${p.title || p.product_id || 'Product'}<br>
                                <span class="timestamp">Designer: ${p.designer_name || 'N/A'}</span>
                            </div>
                        `).join('')}
                    </td>
                    <td>
                        ${o.payment_details ? `
                            <small>ID: ${o.payment_details.id || 'N/A'}</small><br>
                            <small>Method: ${o.payment_details.method || 'N/A'}</small><br>
                            <small>Installments: ${o.payment_details.installments || 'N/A'}</small>
                        ` : 'N/A'}
                    </td>
                    <td>${formatDate(o.created_at)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(o).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering order:', e);
            return '';
        }
    }).join('');
}

function renderUsers() {
    const tbody = document.getElementById('usersBody');
    if (!allData.users.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.users.map(u => {
        try {
            return `
                <tr>
                    <td><strong>${u.id || 'N/A'}</strong><br><small class="timestamp">${u.userId || ''}</small></td>
                    <td>${u.user_Name || u.displayName || 'N/A'}</td>
                    <td>${u.email || 'N/A'}</td>
                    <td>${u.firebaseUID || 'N/A'}</td>
                    <td>${u.pix_key || '❌'}</td>
                    <td>${u.pix_keyType || 'N/A'}</td>
                    <td>
                        ${u.profilePicture ? '✅ Has picture' : '❌ No picture'}<br>
                        <small>${u.bio ? 'Has bio' : 'No bio'}</small>
                    </td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(u).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering user:', e);
            return '';
        }
    }).join('');
}

function renderProducts() {
    const tbody = document.getElementById('productsBody');
    if (!allData.products.length) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.products.map(p => {
        try {
            return `
                <tr>
                    <td><strong>${p.id || 'N/A'}</strong><br><small class="timestamp">Printful: ${p.productId || 'N/A'}</small></td>
                    <td>${p.productTitle || p.name || 'N/A'}</td>
                    <td>
                        ${p.designerUserId || 'N/A'}<br>
                        <small>${p.userEmail || ''}</small>
                    </td>
                    <td>${p.side || 'N/A'}</td>
                    <td>
                        <strong>${p.variants?.length || 0} variants</strong>
                        ${(p.variants || []).slice(0, 3).map(v => `
                            <div class="small border-top mt-1 pt-1">
                                ${v.size || 'One Size'} - ${v.color || 'N/A'}<br>
                                <span class="timestamp">R$ ${v.retail_price || '0'}</span>
                            </div>
                        `).join('')}
                        ${p.variants?.length > 3 ? `<div class="small text-muted">+${p.variants.length - 3} more</div>` : ''}
                    </td>
                    <td>
                        ${p.pricing_summary ? `
                            <small>Base: R$ ${p.pricing_summary.product_price_range?.min || 0} - R$ ${p.pricing_summary.product_price_range?.max || 0}</small><br>
                            <small>Artist: R$ ${p.pricing_summary.artist_cut || 0}</small><br>
                            <small>Platform: ${(p.pricing_summary.platform_fee_percentage * 100) || 5}%</small>
                        ` : 'No summary'}
                    </td>
                    <td>${p.printfulSyncProductId || 'Not synced'}</td>
                    <td>
                        <span class="${getStatusClass(p.status)}">${p.status || 'N/A'}</span><br>
                        <small>Printful: ${p.printfulStatus || 'N/A'}</small>
                    </td>
                    <td>${formatDate(p.createdAt)}</td>
                    <td>
                        ${p.thumbnailUrl ? '✅ Thumb<br>' : ''}
                        ${p.designUrl ? '✅ Design' : ''}
                    </td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(p).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering product:', e);
            return '';
        }
    }).join('');
}

function renderArts() {
    const tbody = document.getElementById('artsBody');
    if (!allData.arts.length) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">No arts found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.arts.map(a => {
        try {
            return `
                <tr>
                    <td><strong>${a.id || 'N/A'}</strong></td>
                    <td>${a.name || a.artName || 'N/A'}</td>
                    <td>${a.userId || 'N/A'}</td>
                    <td>${formatCurrency(a.price)}</td>
                    <td>${formatCurrency(a.platformFee)}</td>
                    <td>${formatCurrency(a.totalPrice)}</td>
                    <td>${a.filename || 'N/A'}</td>
                    <td>
                        ${a.downloadURL ? `<a href="${a.downloadURL}" target="_blank">View</a>` : 'N/A'}
                    </td>
                    <td>${a.size ? (a.size / 1024).toFixed(2) + ' KB' : 'N/A'}</td>
                    <td>${a.type || 'N/A'}</td>
                    <td>${formatDate(a.createdAt)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(a).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering art:', e);
            return '';
        }
    }).join('');
}

function renderPurchased() {
    const tbody = document.getElementById('purchasedBody');
    if (!allData.purchased.length) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center">No purchased items found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.purchased.map(p => {
        try {
            return `
                <tr>
                    <td><strong>${p.purchased_id || p.id || 'N/A'}</strong></td>
                    <td>${p.order_id || 'N/A'}</td>
                    <td>
                        ${p.title || 'N/A'}<br>
                        <small class="timestamp">ID: ${p.product_id || 'N/A'}</small><br>
                        <small class="timestamp">Variant: ${p.variant_id || p.printful_variant_id || 'N/A'}</small>
                    </td>
                    <td>
                        ${p.designer_name || 'N/A'}<br>
                        <small class="timestamp">${p.designer_email || ''}</small>
                    </td>
                    <td>
                        ${p.customer_email || 'N/A'}<br>
                        <small>${p.customer_name || ''}</small>
                    </td>
                    <td>${formatCurrency(p.price)}</td>
                    <td>
                        <span class="${getStatusClass(p.payment_status)}">${p.payment_status || 'N/A'}</span>
                    </td>
                    <td>
                        <span class="${getStatusClass(p.order_status)}">${p.order_status || 'N/A'}</span>
                    </td>
                    <td>
                        <span class="${getStatusClass(p.shipping_status)}">${p.shipping_status || 'N/A'}</span>
                    </td>
                    <td>
                        ${p.printful_order_id ? `
                            <span class="text-success">✅ ${p.printful_order_id}</span><br>
                            <small>Status: ${p.printful_order_status || 'N/A'}</small>
                        ` : '❌ Not created'}
                    </td>
                    <td>
                        ${p.tracking_code ? `
                            <a href="${p.tracking_url || '#'}" target="_blank">${p.tracking_code}</a>
                        ` : 'No tracking'}
                    </td>
                    <td>${formatDate(p.purchased_at)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick='alert(JSON.stringify(${JSON.stringify(p).replace(/'/g, "\\'")}, null, 2))'>
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering purchased:', e);
            return '';
        }
    }).join('');
}

function renderOrderEvents() {
    const tbody = document.getElementById('orderEventsBody');
    if (!allData.orderEvents.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No order events found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.orderEvents.map(e => {
        try {
            return `
                <tr>
                    <td><strong>${e.id || 'N/A'}</strong></td>
                    <td>${e.order_id || 'N/A'}</td>
                    <td><span class="badge bg-info">${e.event_type || 'N/A'}</span></td>
                    <td>${formatJSON(e.event_data)}</td>
                    <td>${formatDate(e.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering order event:', e);
            return '';
        }
    }).join('');
}

function renderWebhookFailures() {
    const tbody = document.getElementById('webhookFailuresBody');
    if (!allData.webhookFailures.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No webhook failures found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.webhookFailures.map(f => {
        try {
            return `
                <tr>
                    <td><strong>${f.id || 'N/A'}</strong></td>
                    <td>${f.payment_id || 'N/A'}</td>
                    <td><span class="text-danger">${f.error || 'N/A'}</span></td>
                    <td>${formatJSON(f.response_data)}</td>
                    <td>${f.retry_count || 0}</td>
                    <td>${formatDate(f.timestamp)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering webhook failure:', e);
            return '';
        }
    }).join('');
}

function renderNotificationQueue() {
    const tbody = document.getElementById('notificationQueueBody');
    if (!allData.notificationQueue.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No notifications in queue</td></tr>';
        return;
    }

    tbody.innerHTML = allData.notificationQueue.map(n => {
        try {
            return `
                <tr>
                    <td><strong>${n.id || 'N/A'}</strong></td>
                    <td>${n.type || 'N/A'}</td>
                    <td>${formatJSON(n.data)}</td>
                    <td><span class="badge bg-${n.status === 'pending' ? 'warning' : 'success'}">${n.status || 'N/A'}</span></td>
                    <td>${n.retry_count || 0}</td>
                    <td>${formatDate(n.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering notification:', e);
            return '';
        }
    }).join('');
}

function renderAdminAlerts() {
    const tbody = document.getElementById('adminAlertsBody');
    if (!allData.adminAlerts.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No admin alerts found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.adminAlerts.map(a => {
        try {
            return `
                <tr>
                    <td><strong>${a.id || 'N/A'}</strong></td>
                    <td>${a.type || 'N/A'}</td>
                    <td>${formatJSON(a.data)}</td>
                    <td><span class="badge bg-${a.severity === 'high' ? 'danger' : 'warning'}">${a.severity || 'N/A'}</span></td>
                    <td>${a.status || 'N/A'}</td>
                    <td>${formatDate(a.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering alert:', e);
            return '';
        }
    }).join('');
}

function renderPrintfulOrders() {
    const tbody = document.getElementById('printfulOrdersBody');
    if (!allData.printfulOrders.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No Printful orders found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.printfulOrders.map(o => {
        try {
            return `
                <tr>
                    <td>${o.id || o.external_reference || 'N/A'}</td>
                    <td><strong>${o.printful_order_id || 'N/A'}</strong></td>
                    <td>
                        <span class="${getStatusClass(o.printful_order_status)}">${o.printful_order_status || 'N/A'}</span>
                    </td>
                    <td>${o.printful_test_mode ? '✅ Test' : '❌ Production'}</td>
                    <td>${formatJSON(o.printful_order_data)}</td>
                    <td>${formatDate(o.printful_order_created_at || o.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering printful order:', e);
            return '';
        }
    }).join('');
}

function renderPrintfulErrors() {
    const tbody = document.getElementById('printfulErrorsBody');
    if (!allData.printfulErrors.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No Printful errors found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.printfulErrors.map(e => {
        try {
            return `
                <tr>
                    <td><strong>${e.id || 'N/A'}</strong></td>
                    <td>${e.order_id || 'N/A'}</td>
                    <td><span class="text-danger">${e.error || 'N/A'}</span></td>
                    <td><small>${e.stack || 'N/A'}</small></td>
                    <td>${formatJSON(e.payment_data)}</td>
                    <td>${e.test_mode ? '✅ Test' : '❌ Production'}</td>
                    <td>${formatDate(e.timestamp)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering printful error:', e);
            return '';
        }
    }).join('');
}

function renderPrintfulRetry() {
    const tbody = document.getElementById('printfulRetryBody');
    if (!allData.printfulRetry.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No items in retry queue</td></tr>';
        return;
    }

    tbody.innerHTML = allData.printfulRetry.map(r => {
        try {
            return `
                <tr>
                    <td><strong>${r.id || 'N/A'}</strong></td>
                    <td>${r.order_id || 'N/A'}</td>
                    <td>${r.attempts || 0} / 5</td>
                    <td><span class="text-danger">${r.last_error || 'N/A'}</span></td>
                    <td>${formatDate(r.next_retry)}</td>
                    <td>${formatDate(r.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering retry item:', e);
            return '';
        }
    }).join('');
}

function renderPrintfulSuccess() {
    const tbody = document.getElementById('printfulSuccessBody');
    if (!allData.printfulSuccess.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No retry successes found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.printfulSuccess.map(s => {
        try {
            return `
                <tr>
                    <td><strong>${s.id || 'N/A'}</strong></td>
                    <td>${s.order_id || 'N/A'}</td>
                    <td>${s.printful_order_id || 'N/A'}</td>
                    <td>${s.attempts || 0}</td>
                    <td>${s.test_mode ? '✅ Test' : '❌ Production'}</td>
                    <td>${formatDate(s.timestamp)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering success:', e);
            return '';
        }
    }).join('');
}

function renderPurchaseErrors() {
    const tbody = document.getElementById('purchaseErrorsBody');
    if (!allData.purchaseErrors.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No purchase errors found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.purchaseErrors.map(e => {
        try {
            return `
                <tr>
                    <td><strong>${e.id || 'N/A'}</strong></td>
                    <td>${e.order_id || 'N/A'}</td>
                    <td><span class="text-danger">${e.error || 'N/A'}</span></td>
                    <td><small>${e.stack || 'N/A'}</small></td>
                    <td>${formatDate(e.timestamp)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering purchase error:', e);
            return '';
        }
    }).join('');
}

function renderOrphanPayments() {
    const tbody = document.getElementById('orphanPaymentsBody');
    if (!allData.orphanPayments.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No orphan payments found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.orphanPayments.map(o => {
        try {
            return `
                <tr>
                    <td><strong>${o.id || 'N/A'}</strong></td>
                    <td>${o.payment_id || 'N/A'}</td>
                    <td>${o.status || 'N/A'}</td>
                    <td>${formatJSON(o.payment_data)}</td>
                    <td>${formatDate(o.received_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering orphan payment:', e);
            return '';
        }
    }).join('');
}

function renderExpirationTasks() {
    const tbody = document.getElementById('expirationTasksBody');
    if (!allData.expirationTasks.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No expiration tasks found</td></tr>';
        return;
    }

    tbody.innerHTML = allData.expirationTasks.map(t => {
        try {
            return `
                <tr>
                    <td><strong>${t.id || 'N/A'}</strong></td>
                    <td>${t.order_id || 'N/A'}</td>
                    <td>${formatDate(t.expires_at)}</td>
                    <td>${t.status || 'N/A'}</td>
                    <td>${formatDate(t.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering expiration task:', e);
            return '';
        }
    }).join('');
}

function renderCaptureQueue() {
    const tbody = document.getElementById('captureQueueBody');
    if (!allData.captureQueue.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No items in capture queue</td></tr>';
        return;
    }

    tbody.innerHTML = allData.captureQueue.map(c => {
        try {
            return `
                <tr>
                    <td><strong>${c.id || 'N/A'}</strong></td>
                    <td>${c.order_id || 'N/A'}</td>
                    <td>${c.payment_id || 'N/A'}</td>
                    <td>${c.status || 'N/A'}</td>
                    <td>${formatDate(c.created_at)}</td>
                </tr>
            `;
        } catch (e) {
            console.error('Error rendering capture item:', e);
            return '';
        }
    }).join('');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', refreshAllData);

// Auto-refresh every 30 seconds
setInterval(refreshAllData, 30000);

// Make functions available globally
window.refreshAllData = refreshAllData;
window.formatJSON = formatJSON;