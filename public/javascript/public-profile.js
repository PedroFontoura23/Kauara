const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

const urlParams = new URLSearchParams(window.location.search);
const userIdFromUrl = urlParams.get("userId");

// DOM Elements
const userNameElement = document.getElementById("userName");
const userEmailElement = document.getElementById("userEmail");
const userBioElement = document.getElementById("userBio");
const profilePictureElement = document.getElementById("profilePicture");
const ratingContainer = document.getElementById("ratingContainer");
const donationSection = document.getElementById("donationSection");
const donateButton = document.getElementById("donateButton");
const pixKeyInfo = document.getElementById("pixKeyInfo");
const pixKeyValue = document.getElementById("pixKeyValue");
const directPixInfo = document.getElementById("directPixInfo");
const directPixKey = document.getElementById("directPixKey");

let ratingSystem;
let artManager;
let productManager;
let postManager;
let currentUserId = null;

// Cloud Function URLs
const API_BASE_URL = 'https://us-central1-kauara1.cloudfunctions.net';
const CREATE_DONATION_URL = `${API_BASE_URL}/createPIXDonation`;
const GET_PAYMENT_STATUS_URL = `${API_BASE_URL}/getPaymentStatus`;
const VALIDATE_PAYMENT_RECEIVER_URL = 'https://us-central1-kauara1.cloudfunctions.net/validatePaymentReceiver';;

// Payment status constants
const PAYMENT_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    AUTHORIZED: 'authorized',
    IN_PROCESS: 'in_process',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled'
};

// Initialize auth state
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userQuery = await db.collection("users").where("firebaseUID", "==", user.uid).get();
            currentUserId = !userQuery.empty ? userQuery.docs[0].id : null;
            console.log('✅ User authenticated:', currentUserId);
        } catch (error) {
            console.error("Error getting user ID:", error);
            currentUserId = null;
        }
    } else {
        currentUserId = null;
        console.log('❌ User not authenticated');
    }
});

async function getCurrentUserId() {
    return currentUserId;
}

async function displayPosts(userIdFromUrl) {
    const postsContainer = document.getElementById("postsContainer");
    if (!postsContainer) return;

    const currentUserId = await getCurrentUserId();
    
    if (typeof PostManager !== 'undefined') {
        postManager = new PostManager(db, auth, "postsContainer");
        postManager.displayPosts(userIdFromUrl, currentUserId);
    } else {
        console.warn("PostManager not available");
        postsContainer.innerHTML = "<p>Posts feature not available</p>";
    }
}

async function displayArts(userIdFromUrl) {
    const artsContainer = document.getElementById("artsContainer");
    if (!artsContainer) return;

    const currentUserId = await getCurrentUserId();
    
    if (typeof ArtManager !== 'undefined') {
        artManager = new ArtManager(db, auth, "artsContainer");
        artManager.displayArts(userIdFromUrl, currentUserId);
    } else {
        console.warn("ArtManager not available");
        artsContainer.innerHTML = "<p>Arts feature not available</p>";
    }
}

async function displayProducts(userIdFromUrl) {
    const productsContainer = document.getElementById("productsContainer");
    if (!productsContainer) return;

    const currentUserId = await getCurrentUserId();
    
    if (typeof ProductManager !== 'undefined') {
        productManager = new ProductManager(db, auth, "productsContainer");
        productManager.displayProducts(userIdFromUrl, currentUserId);
    } else {
        console.warn("ProductManager not available");
        productsContainer.innerHTML = "<p>Products feature not available</p>";
    }
}

async function setupDonationButton(artistData) {
    if (!donateButton || !artistData) return;
    
    // Add artist badge to name
    const artistBadge = document.createElement('span');
    artistBadge.className = 'artist-badge';
    artistBadge.innerHTML = '<i class="fas fa-palette me-1"></i>Artist';
    userNameElement.appendChild(artistBadge);
    
    // Validate if artist can receive payments
    try {
        const response = await fetch(`${VALIDATE_PAYMENT_RECEIVER_URL}?userId=${userIdFromUrl}`);
        const validation = await response.json();
        
        if (validation.success && validation.validation.canReceivePayments) {
            // Show PIX key info if available
            if (artistData.pix_key) {
                const pixTypeLabel = getPIXTypeLabel(artistData.pix_keyType);
                const formattedPixKey = formatPIXKey(artistData.pix_key, artistData.pix_keyType);
                
                pixKeyValue.textContent = `${pixTypeLabel}: ${formattedPixKey}`;
                pixKeyInfo.classList.remove('d-none');
                
                // Also show direct PIX transfer option
                directPixKey.textContent = formattedPixKey;
                directPixInfo.classList.remove('d-none');
            }
            
            // Set up donation button click handler
            donateButton.addEventListener('click', () => {
                showDonationModal(artistData);
            });
            
            // Enable donate button
            donateButton.disabled = false;
            donateButton.innerHTML = '<i class="fas fa-heart me-2"></i> Support Artist';
            
        } else {
            // Artist cannot receive payments
            console.warn('Artist cannot receive payments:', validation);
            
            if (artistData.pix_key) {
                // Show PIX key but disable donation button
                const pixTypeLabel = getPIXTypeLabel(artistData.pix_keyType);
                const formattedPixKey = formatPIXKey(artistData.pix_key, artistData.pix_keyType);
                
                pixKeyValue.textContent = `${pixTypeLabel}: ${formattedPixKey}`;
                pixKeyInfo.classList.remove('d-none');
                pixKeyInfo.classList.add('text-warning');
                pixKeyValue.innerHTML += ' <span class="badge bg-warning">Verification Pending</span>';
                
                directPixKey.textContent = formattedPixKey;
                directPixInfo.classList.remove('d-none');
                
                donateButton.disabled = true;
                donateButton.innerHTML = '<i class="fas fa-clock me-2"></i> Payment Setup Pending';
                donateButton.title = 'Artist payment setup is not complete';
            } else {
                // No PIX key configured
                donateButton.disabled = true;
                donateButton.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i> Payment Not Available';
                donateButton.title = 'Artist has not configured payment method';
            }
        }
    } catch (error) {
        console.error('Error validating payment receiver:', error);
        // Fallback to old behavior
        if (artistData.pix_key) {
            const pixTypeLabel = getPIXTypeLabel(artistData.pix_keyType);
            const formattedPixKey = formatPIXKey(artistData.pix_key, artistData.pix_keyType);
            
            pixKeyValue.textContent = `${pixTypeLabel}: ${formattedPixKey}`;
            pixKeyInfo.classList.remove('d-none');
            
            directPixKey.textContent = formattedPixKey;
            directPixInfo.classList.remove('d-none');
        }
        
        donateButton.addEventListener('click', () => {
            showDonationModal(artistData);
        });
    }
}

function getPIXTypeLabel(type) {
    const labels = {
        'phone': 'Phone',
        'email': 'Email',
        'cpf': 'CPF',
        'cnpj': 'CNPJ',
        'random': 'Random Key'
    };
    return labels[type] || type;
}

function formatPIXKey(key, type) {
    if (!key) return '';
    
    switch(type) {
        case 'phone':
            const phoneDigits = key.replace(/\D/g, '');
            if (phoneDigits.length === 11) {
                return `+55 (${phoneDigits.substring(0,2)}) ${phoneDigits.substring(2,7)}-${phoneDigits.substring(7)}`;
            }
            return key;
            
        case 'email':
            return key;
            
        case 'cpf':
            const cpfDigits = key.replace(/\D/g, '');
            if (cpfDigits.length === 11) {
                return `${cpfDigits.substring(0,3)}.${cpfDigits.substring(3,6)}.${cpfDigits.substring(6,9)}-${cpfDigits.substring(9)}`;
            }
            return key;
            
        case 'cnpj':
            const cnpjDigits = key.replace(/\D/g, '');
            if (cnpjDigits.length === 14) {
                return `${cnpjDigits.substring(0,2)}.${cnpjDigits.substring(2,5)}.${cnpjDigits.substring(5,8)}/${cnpjDigits.substring(8,12)}-${cnpjDigits.substring(12)}`;
            }
            return key;
            
        default:
            return key;
    }
}

function copyDirectPixKey() {
    const textToCopy = directPixKey.textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
        const button = document.querySelector('[onclick="copyDirectPixKey()"]');
        const originalHTML = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i>';
        button.classList.remove('btn-outline-secondary');
        button.classList.add('btn-success');
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('btn-success');
            button.classList.add('btn-outline-secondary');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy PIX key:', err);
    });
}

async function loadProfileData() {
    if (!userIdFromUrl) {
        showError("No user specified");
        return;
    }

    try {
        const userDoc = await db.collection("users").doc(userIdFromUrl).get();
        if (!userDoc.exists) {
            showError("User not found");
            return;
        }

        const userData = userDoc.data();
        userNameElement.textContent = userData.user_Name || "No Name Available";
        userBioElement.textContent = userData.user_Bio || "No bio available";

        // Show donation section only if user is an artist
        if (donationSection) {
            if (userData.artista === true) {
                donationSection.style.display = "block";
                console.log("User is an artist, showing donation section");
                
                // Setup donation button with artist data
                await setupDonationButton(userData);
            } else {
                donationSection.style.display = "none";
                console.log("User is not an artist, hiding donation section");
            }
        }

        // Load profile picture
        if (userData.profilePicture) {
            profilePictureElement.src = `data:image/jpeg;base64,${userData.profilePicture}`;
        } else {
            profilePictureElement.src = "../images/default-profile.png";
        }

        // Load contact data
        const contactSnapshot = await db.collection("contact")
            .where("foreignUserId", "==", userIdFromUrl)
            .get();
        if (!contactSnapshot.empty) {
            const contactData = contactSnapshot.docs[0].data();
            userEmailElement.textContent = contactData.contactEmail || "No Email Available";
        }

        // Initialize components
        if (typeof RatingSystem !== 'undefined') {
            ratingSystem = new RatingSystem(userIdFromUrl, ratingContainer);
        }

        // Load user content
        displayArts(userIdFromUrl);
        displayProducts(userIdFromUrl);
        displayPosts(userIdFromUrl);

    } catch (error) {
        console.error("Error loading profile:", error);
        showError("Error loading profile");
    }
}

function showError(message) {
    if (userNameElement) userNameElement.textContent = message;
    if (userEmailElement) userEmailElement.textContent = "";
    if (userBioElement) userBioElement.textContent = "";
    if (donationSection) donationSection.style.display = "none";
}

// =============================================
// DONATION MODAL FUNCTIONS (FIXED)
// =============================================

function showDonationModal(artistData) {
    // Check authentication
    if (!currentUserId) {
        if (confirm('You need to be logged in to make a donation. Do you want to login now?')) {
            window.location.href = '/login.html';
        }
        return;
    }
    
    const modalHtml = `
        <div class="modal fade" id="donationModal" tabindex="-1" aria-labelledby="donationModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title" id="donationModalLabel">
                            <i class="fas fa-heart me-2"></i> Support ${artistData.user_Name || 'Artist'}
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div id="donationStep1">
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle me-2"></i>
                                Your donation will be securely processed via Mercado Pago PIX.
                            </div>
                            
                            <div class="mb-4">
                                <label for="donationAmount" class="form-label">
                                    <strong>Donation Amount (R$)</strong>
                                </label>
                                <div class="input-group input-group-lg">
                                    <span class="input-group-text bg-light">R$</span>
                                    <input type="number" 
                                           class="form-control" 
                                           id="donationAmount" 
                                           min="5" 
                                           step="0.01" 
                                           value="10.00"
                                           placeholder="Ex: 10.00">
                                </div>
                                <div class="mt-2">
                                    <div class="btn-group w-100" role="group">
                                        <button type="button" class="btn btn-outline-secondary" onclick="setDonationAmount(5)">R$ 5</button>
                                        <button type="button" class="btn btn-outline-secondary" onclick="setDonationAmount(10)">R$ 10</button>
                                        <button type="button" class="btn btn-outline-secondary" onclick="setDonationAmount(20)">R$ 20</button>
                                        <button type="button" class="btn btn-outline-secondary" onclick="setDonationAmount(50)">R$ 50</button>
                                        <button type="button" class="btn btn-outline-secondary" onclick="setDonationAmount(100)">R$ 100</button>
                                    </div>
                                </div>
                                <small class="text-muted">Minimum amount: R$ 5.00</small>
                            </div>
                            
                            <div class="mb-3">
                                <label for="donationMessage" class="form-label">
                                    <strong>Message (optional)</strong>
                                </label>
                                <textarea class="form-control" 
                                          id="donationMessage" 
                                          rows="3" 
                                          placeholder="Leave a message of support for the artist..."></textarea>
                                <small class="text-muted">Your message will be shared with the artist</small>
                            </div>
                            
                            <div class="form-check mb-3">
                                <input class="form-check-input" type="checkbox" id="anonymousDonation">
                                <label class="form-check-label" for="anonymousDonation">
                                    Make this donation anonymous
                                </label>
                            </div>
                            
                            <div id="donationError" class="alert alert-danger d-none"></div>
                        </div>
                        
                        <div id="donationStep2" class="d-none">
                            <div id="donationLoading" class="text-center">
                                <div class="spinner-border text-success" style="width: 3rem; height: 3rem;" role="status">
                                    <span class="visually-hidden">Loading...</span>
                                </div>
                                <p class="mt-3 fs-5">Creating secure payment...</p>
                            </div>
                            
                            <div id="donationResult" class="d-none">
                                <!-- Result will be inserted here -->
                            </div>
                            
                            <div id="paymentStatus" class="d-none">
                                <div class="text-center mb-4">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="visually-hidden">Checking payment...</span>
                                    </div>
                                    <p class="mt-2">Waiting for payment confirmation...</p>
                                </div>
                                <div class="progress mb-3">
                                    <div class="progress-bar progress-bar-striped progress-bar-animated" 
                                         role="progressbar" 
                                         style="width: 50%" 
                                         aria-valuenow="50" 
                                         aria-valuemin="0" 
                                         aria-valuemax="100"></div>
                                </div>
                                <p class="text-center text-muted">This may take a few moments after you complete the PIX payment</p>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <div id="step1Buttons">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-success" id="confirmDonationBtn">
                                <i class="fas fa-lock me-2"></i> Continue to Secure Payment
                            </button>
                        </div>
                        <div id="step2Buttons" class="d-none">
                            <button type="button" class="btn btn-secondary" onclick="resetDonationForm()">
                                <i class="fas fa-redo me-1"></i> New Donation
                            </button>
                            <button type="button" class="btn btn-outline-success" data-bs-dismiss="modal">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal
    const existingModal = document.getElementById('donationModal');
    if (existingModal) existingModal.remove();
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Initialize modal
    const modalElement = document.getElementById('donationModal');
    const modal = new bootstrap.Modal(modalElement);
    
    // Set up confirmation button
    document.getElementById('confirmDonationBtn').addEventListener('click', async () => {
        await processDonation(artistData, modal);
    });
    
    // Set up amount preset buttons
    window.setDonationAmount = function(amount) {
        document.getElementById('donationAmount').value = amount.toFixed(2);
    };
    
    // Reset form function
    window.resetDonationForm = function() {
        document.getElementById('donationStep1').classList.remove('d-none');
        document.getElementById('donationStep2').classList.add('d-none');
        document.getElementById('step1Buttons').classList.remove('d-none');
        document.getElementById('step2Buttons').classList.add('d-none');
        document.getElementById('donationResult').classList.add('d-none');
        document.getElementById('paymentStatus').classList.add('d-none');
        document.getElementById('donationLoading').classList.remove('d-none');
        hideDonationError();
    };
    
    // Clean up on close
    modalElement.addEventListener('hidden.bs.modal', function() {
        // Clear any polling intervals
        if (window.donationStatusInterval) {
            clearInterval(window.donationStatusInterval);
            delete window.donationStatusInterval;
        }
        this.remove();
    });
    
    // Show modal
    modal.show();
}

async function processDonation(artistData, modal) {
    try {
        const amount = parseFloat(document.getElementById('donationAmount').value);
        const message = document.getElementById('donationMessage').value.trim();
        const anonymous = document.getElementById('anonymousDonation').checked;
        
        // Validate amount
        if (!amount || amount < 5 || amount > 10000) {
            showDonationError('Please enter a valid amount between R$ 5.00 and R$ 10,000.00');
            return;
        }
        
        // Switch to step 2
        document.getElementById('donationStep1').classList.add('d-none');
        document.getElementById('donationStep2').classList.remove('d-none');
        document.getElementById('step1Buttons').classList.add('d-none');
        document.getElementById('step2Buttons').classList.remove('d-none');
        document.getElementById('donationLoading').classList.remove('d-none');
        
        hideDonationError();
        
        // Get current user info for anonymous handling
        let payerId = currentUserId;
        if (anonymous) {
            console.log('Processing anonymous donation');
        }
        
        // Create donation via backend API
        const result = await createDonationViaAPI(
            payerId,
            userIdFromUrl,
            amount,
            message || `Donation to ${artistData.user_Name}`,
            anonymous
        );
        
        if (result.success) {
            // Show QR code (pass modal as parameter)
            showDonationQRCode(result, artistData, modal);
        } else {
            showDonationError(result.error || 'Failed to create donation');
            resetDonationForm();
        }
        
    } catch (error) {
        console.error('❌ Error in donation process:', error);
        showDonationError(error.message || 'Error processing donation');
        resetDonationForm();
    }
}

async function createDonationViaAPI(payerId, receiverId, amount, description, anonymous = false) {
    try {
        // Get Firebase auth token
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
        }
        
        const token = await user.getIdToken();
        
        const response = await fetch(CREATE_DONATION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                payerId: payerId,
                receiverId: receiverId,
                amount: amount,
                description: description,
                anonymous: anonymous
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        return data;
        
    } catch (error) {
        console.error('❌ API Error:', error);
        throw error;
    }
}

function showDonationQRCode(result, artistData, modal) {
    // Hide loading, show result
    document.getElementById('donationLoading').classList.add('d-none');
    document.getElementById('donationResult').classList.remove('d-none');
    
    const resultHtml = `
        <div class="alert alert-success">
            <h5><i class="fas fa-check-circle me-2"></i> Payment Ready!</h5>
            <p class="mb-2">Scan the QR Code below with your banking app to complete the donation:</p>
        </div>
        
        <div class="text-center mb-4">
            <img src="data:image/png;base64,${result.pix.qr_code_base64}" 
                 alt="PIX QR Code" 
                 class="img-fluid border rounded shadow"
                 style="max-width: 280px;">
            <p class="text-muted mt-2">Valid for 30 minutes</p>
        </div>
        
        <div class="mb-4">
            <label class="form-label"><strong>PIX Code (copy and paste):</strong></label>
            <div class="input-group">
                <input type="text" 
                       class="form-control font-monospace" 
                       value="${result.pix.qr_code}" 
                       readonly
                       id="pixCodeInput">
                <button class="btn btn-outline-secondary" type="button" onclick="copyPIXCode()">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
            <small class="text-muted">Paste this code in your banking app if you can't scan the QR code</small>
        </div>
        
        <div class="row mb-4">
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-body">
                        <h6><i class="fas fa-user me-2"></i> Donation Details</h6>
                        <p class="mb-1"><strong>Artist:</strong> ${artistData.user_Name || 'Artist'}</p>
                        <p class="mb-1"><strong>Amount:</strong> R$ ${result.amount.toFixed(2)}</p>
                        <p class="mb-1"><strong>Transaction ID:</strong> ${result.transactionId}</p>
                        <p class="mb-0"><small class="text-muted">Status: <span class="badge bg-warning">Pending</span></small></p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-body">
                        <h6><i class="fas fa-clock me-2"></i> Next Steps</h6>
                        <ol class="mb-0 ps-3">
                            <li>Open your banking app</li>
                            <li>Select "PIX" or "PIX Transfer"</li>
                            <li>Scan QR code or paste PIX code</li>
                            <li>Confirm payment amount</li>
                            <li>Complete transaction</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="alert alert-info">
            <h6><i class="fas fa-info-circle me-2"></i> Payment Information</h6>
            <ul class="mb-0">
                <li>Payment is processed instantly via PIX</li>
                <li>You will receive email confirmation</li>
                <li>The artist will be notified automatically</li>
                <li>Keep your payment receipt for reference</li>
            </ul>
        </div>
        
        <!-- ADD A START POLLING BUTTON -->
        <div class="text-center mt-4">
            <button type="button" class="btn btn-primary" id="startPollingBtn">
                <i class="fas fa-sync-alt me-2"></i> Start Checking Payment Status
            </button>
            <p class="text-muted mt-2 small">Click this button after you've completed the PIX payment</p>
        </div>
    `;
    
    const resultElement = document.getElementById('donationResult');
    resultElement.innerHTML = resultHtml;
    
    // Add global copy function
    window.copyPIXCode = function() {
        const input = document.getElementById('pixCodeInput');
        input.select();
        input.setSelectionRange(0, 99999); // For mobile
        
        navigator.clipboard.writeText(input.value).then(() => {
            const buttonIcon = document.querySelector('#pixCodeInput + button i');
            const originalClass = buttonIcon.className;
            buttonIcon.className = 'fas fa-check';
            
            setTimeout(() => {
                buttonIcon.className = originalClass;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    };
    
    // Add event listener for the start polling button
    document.getElementById('startPollingBtn').addEventListener('click', () => {
        // Hide QR code, show polling status
        document.getElementById('donationResult').classList.add('d-none');
        document.getElementById('paymentStatus').classList.remove('d-none');
        
        // Start polling for payment status
        startPaymentStatusPolling(result.transactionId, modal);
    });
    
    // Auto-start polling after 60 seconds as fallback
    setTimeout(() => {
        if (document.getElementById('donationResult') && !document.getElementById('donationResult').classList.contains('d-none')) {
            console.log('Auto-starting payment status check after 60 seconds');
            document.getElementById('donationResult').classList.add('d-none');
            document.getElementById('paymentStatus').classList.remove('d-none');
            startPaymentStatusPolling(result.transactionId, modal);
        }
    }, 60000);
}

function startPaymentStatusPolling(transactionId, modal) {
    // Show payment status section
    document.getElementById('donationResult').classList.add('d-none');
    document.getElementById('paymentStatus').classList.remove('d-none');
    
    let attempts = 0;
    const maxAttempts = 60; // Poll for 5 minutes (5 seconds * 60)
    const pollInterval = 5000; // 5 seconds
    
    // Start polling
    window.donationStatusInterval = setInterval(async () => {
        attempts++;
        
        try {
            const response = await fetch(`${GET_PAYMENT_STATUS_URL}?transactionId=${transactionId}`);
            const data = await response.json();
            
            if (data.success && data.payment) {
                const payment = data.payment;
                
                // Check if payment is approved
                if (payment.status === PAYMENT_STATUS.APPROVED) {
                    clearInterval(window.donationStatusInterval);
                    showPaymentSuccess(transactionId, payment);
                    return;
                }
                
                // Check if payment is rejected or expired
                if ([PAYMENT_STATUS.REJECTED, PAYMENT_STATUS.CANCELLED].includes(payment.status)) {
                    clearInterval(window.donationStatusInterval);
                    showPaymentError('Payment was rejected or cancelled');
                    return;
                }
            }
            
            // Stop polling after max attempts
            if (attempts >= maxAttempts) {
                clearInterval(window.donationStatusInterval);
                showPaymentTimeout();
            }
            
        } catch (error) {
            console.error('Error polling payment status:', error);
            
            if (attempts >= maxAttempts) {
                clearInterval(window.donationStatusInterval);
                showPaymentTimeout();
            }
        }
    }, pollInterval);
}

function showPaymentSuccess(transactionId, payment) {
    document.getElementById('paymentStatus').innerHTML = `
        <div class="text-center py-4">
            <div class="mb-3">
                <i class="fas fa-check-circle text-success" style="font-size: 4rem;"></i>
            </div>
            <h3 class="text-success">Payment Successful!</h3>
            <p class="lead">Thank you for your donation!</p>
            
            <div class="card mt-4">
                <div class="card-body">
                    <h5>Donation Confirmed</h5>
                    <p class="mb-1"><strong>Transaction ID:</strong> ${transactionId}</p>
                    <p class="mb-1"><strong>Amount:</strong> R$ ${payment.amount.toFixed(2)}</p>
                    <p class="mb-1"><strong>Status:</strong> <span class="badge bg-success">Completed</span></p>
                    <p class="mb-0"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                </div>
            </div>
            
            <div class="alert alert-success mt-4">
                <i class="fas fa-envelope me-2"></i>
                A confirmation email has been sent to you. The artist has been notified of your generous donation!
            </div>
        </div>
    `;
}

function showPaymentError(message) {
    document.getElementById('paymentStatus').innerHTML = `
        <div class="text-center py-4">
            <div class="mb-3">
                <i class="fas fa-times-circle text-danger" style="font-size: 4rem;"></i>
            </div>
            <h3 class="text-danger">Payment Failed</h3>
            <p class="lead">${message}</p>
            
            <div class="alert alert-warning mt-3">
                <p class="mb-0">You can try again or contact support if the issue persists.</p>
            </div>
            
            <button class="btn btn-primary mt-3" onclick="resetDonationForm()">
                <i class="fas fa-redo me-1"></i> Try Again
            </button>
        </div>
    `;
}

function showPaymentTimeout() {
    document.getElementById('paymentStatus').innerHTML = `
        <div class="text-center py-4">
            <div class="mb-3">
                <i class="fas fa-clock text-warning" style="font-size: 4rem;"></i>
            </div>
            <h3 class="text-warning">Payment Status Unknown</h3>
            <p class="lead">We're still waiting for payment confirmation.</p>
            
            <div class="alert alert-info mt-3">
                <p class="mb-0">
                    If you completed the payment, it may take a few minutes to process. 
                    You can check your email for confirmation or try again later.
                </p>
            </div>
            
            <button class="btn btn-outline-secondary mt-3" onclick="resetDonationForm()">
                <i class="fas fa-redo me-1"></i> Check Again
            </button>
        </div>
    `;
}

function showDonationLoading(show) {
    const loadingElement = document.getElementById('donationLoading');
    const confirmButton = document.getElementById('confirmDonationBtn');
    
    if (show) {
        loadingElement.classList.remove('d-none');
        if (confirmButton) confirmButton.disabled = true;
        hideDonationError();
    } else {
        loadingElement.classList.add('d-none');
        if (confirmButton) confirmButton.disabled = false;
    }
}

function showDonationError(message) {
    const errorElement = document.getElementById('donationError');
    errorElement.textContent = message;
    errorElement.classList.remove('d-none');
    errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideDonationError() {
    const errorElement = document.getElementById('donationError');
    errorElement.classList.add('d-none');
}

// =============================================
// PAGE INITIALIZATION
// =============================================

// Wait for dependencies to load
function waitForDependencies() {
    return new Promise((resolve) => {
        const checkDependencies = () => {
            const dependenciesLoaded = 
                typeof firebase !== 'undefined' &&
                (typeof PostManager !== 'undefined' || document.querySelector('script[src*="shared-posts"]')) &&
                (typeof ProductManager !== 'undefined' || document.querySelector('script[src*="shared-products"]')) &&
                (typeof ArtManager !== 'undefined' || document.querySelector('script[src*="shared-art"]'));

            if (dependenciesLoaded) {
                resolve();
            } else {
                setTimeout(checkDependencies, 100);
            }
        };
        checkDependencies();
    });
}

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Public profile page loaded");
    
    await waitForDependencies();
    console.log("Dependencies loaded, initializing profile...");
    
    loadProfileData();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && userIdFromUrl) {
        loadProfileData();
    }
});