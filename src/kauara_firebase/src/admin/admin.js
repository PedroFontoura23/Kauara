document.addEventListener("DOMContentLoaded", function () {
    // Your Firebase config (same as other files)
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.appspot.com",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const auth = firebase.auth();

    // Hardcoded admin UID - replace with your actual Firebase UID
    const ADMIN_UID = 'Sb1COfVyuzgfAyRCljhtRC8a1S62';

    // Elements
    const usersList = document.getElementById('usersList');
    const searchInput = document.getElementById('searchUsers');

    // Security check
    function verifyAdmin() {
        return new Promise((resolve, reject) => {
            auth.onAuthStateChanged(user => {
                if (!user || user.uid !== ADMIN_UID) {
                    reject('Unauthorized access');
                } else {
                    resolve();
                }
            });
        });
    }

    // Render users
    async function renderUsers(searchTerm = '') {
        const snapshot = await db.collection('users').get();
        usersList.innerHTML = '';
        
        snapshot.forEach(doc => {
            const user = doc.data();
            if (matchesSearch(user, searchTerm)) {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.user_Name || 'N/A'}</td>
                    <td>${user.email || 'N/A'}</td>
                    <td>${user.mercadoPagoUserId || 'Not connected'}</td>
                    <td>${user.mercadoPagoConnectedAt ? 
                        new Date(user.mercadoPagoConnectedAt.toDate()).toLocaleString() : 'N/A'}</td>
                    <td>${user.lastLogin ? 
                        new Date(user.lastLogin.toDate()).toLocaleString() : 'Never'}</td>
                `;
                usersList.appendChild(row);
            }
        });
    }

    function matchesSearch(user, term) {
        const search = term.toLowerCase();
        return (
            (user.user_Name?.toLowerCase().includes(search)) ||
            (user.email?.toLowerCase().includes(search)) ||
            (user.mercadoPagoUserId?.includes(search))
        );
    }

    // Initialize admin dashboard
    async function initAdmin() {
        await verifyAdmin();
        await renderUsers();
        
        // Search functionality
        searchInput.addEventListener('input', (e) => {
            renderUsers(e.target.value);
        });
    }

    // Start the admin dashboard
    auth.signInAnonymously().catch(error => {
        console.error('Authentication error:', error);
    }).then(() => {
        initAdmin().catch(error => {
            console.error('Admin initialization error:', error);
        });
    });
});
