/* ── Firebase Config ── */
const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebaseapp.com",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ── Dropdowns da nav ── */
(function () {
    const items = [
        { navId: 'navProdutos', linkId: 'linkProdutos', dropId: 'dropProdutos' },
        { navId: 'navArtistas', linkId: 'linkArtistas', dropId: 'dropArtistas' },
        { navId: 'navSobre',    linkId: 'linkSobre',    dropId: 'dropSobre'    },
    ];

    items.forEach(function({ navId, linkId, dropId }) {
        const nav  = document.getElementById(navId);
        const link = document.getElementById(linkId);
        const drop = document.getElementById(dropId);
        if (!nav || !drop) return;

        let timer = null;

        function open() {
            clearTimeout(timer);
            drop.classList.add('open');
            if (link) link.classList.add('active');
            if (dropId === 'dropArtistas') {
                loadArtistsIntoDropdown();
            }
        }
        function close() {
            timer = setTimeout(function() {
                drop.classList.remove('open');
                if (link) link.classList.remove('active');
            }, 80);
        }

        nav.addEventListener('mouseenter',  open);
        nav.addEventListener('mouseleave',  close);
        drop.addEventListener('mouseenter', open);
        drop.addEventListener('mouseleave', close);
    });

    document.addEventListener('click', function() {
        document.querySelectorAll('.mega-dropdown.open').forEach(function(d) {
            d.classList.remove('open');
        });
        document.querySelectorAll('.nav-item > a.active').forEach(function(a) {
            a.classList.remove('active');
        });
    });
})();

let artistsLoaded = false;
async function loadArtistsIntoDropdown() {
    if (artistsLoaded) return;
    
    const container = document.getElementById('artistasDropdownGrid');
    if (!container) return;

    try {
        const snapshot = await db.collection('users').where('artista', '==', true).get();

        if (snapshot.empty) {
            container.innerHTML = '<div style="padding:0.3cm; text-align:center; width:100%; color:#888;">Nenhum artista encontrado ainda.</div>';
            artistsLoaded = true;
            return;
        }

        const artists = [];
        snapshot.forEach(doc => {
            artists.push({ id: doc.id, ...doc.data() });
        });
        artists.sort((a, b) => {
            const ratingA = Number(a.averageRating || 0);
            const ratingB = Number(b.averageRating || 0);
            if (ratingB !== ratingA) return ratingB - ratingA;
            const totalA = Number(a.totalRatings || 0);
            const totalB = Number(b.totalRatings || 0);
            if (totalB !== totalA) return totalB - totalA;
            return (a.user_Name || '').localeCompare(b.user_Name || '');
        });

        container.innerHTML = artists.map(artist => `
            <div class="artist-dropdown-item" data-userid="${artist.id}">
                <img class="artist-dropdown-img" 
                     src="${artist.profilePicture ? `data:image/jpeg;base64,${artist.profilePicture}` : '/images/default-profile.png'}" 
                     alt="${escapeHtml(artist.user_Name || 'Artista')}">
                <span class="artist-dropdown-name">${escapeHtml(artist.user_Name || 'Artista')}</span>
                <span class="artist-dropdown-badge">Artista</span>
            </div>
        `).join('');

        container.querySelectorAll('.artist-dropdown-item').forEach(item => {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const userId = this.dataset.userid;
                if (userId) {
                    window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
                }
            });
        });

        artistsLoaded = true;
    } catch (error) {
        console.error('Erro ao carregar artistas:', error);
        container.innerHTML = '<div style="padding:0.3cm; text-align:center; width:100%; color:#d9534f;">Erro ao carregar artistas. Tente novamente.</div>';
    }
}

let featuredArtistsLoaded = false;
async function loadFeaturedArtists() {
    if (featuredArtistsLoaded) return;

    const container = document.getElementById('artistasDestaqueGrid');
    if (!container) return;

    try {
        const snapshot = await db.collection('users').where('artista', '==', true).get();

        if (snapshot.empty) {
            container.innerHTML = '<div class="text-muted">Nenhum artista em destaque no momento.</div>';
            featuredArtistsLoaded = true;
            return;
        }

        const artists = [];
        snapshot.forEach(doc => {
            artists.push({ id: doc.id, ...doc.data() });
        });

        artists.sort((a, b) => {
            const likesA = Number(a.likes_count || 0);
            const likesB = Number(b.likes_count || 0);
            if (likesB !== likesA) return likesB - likesA;
            return (a.user_Name || '').localeCompare(b.user_Name || '');
        });

        container.innerHTML = artists.map(artist => `
            <div class="artist-card" data-userid="${artist.id}">
                <div class="artist-avatar-wrap">
                    <img class="artist-avatar-img" src="${artist.profilePicture ? `data:image/jpeg;base64,${artist.profilePicture}` : '/images/default-profile.png'}" alt="${escapeHtml(artist.user_Name || 'Artista')}">
                </div>
                <div class="artist-card-name">${escapeHtml(artist.user_Name || 'Artista')}</div>
                <div class="artist-card-role">${escapeHtml(artist.user_Bio || 'Artista')}</div>
                <div class="artist-card-rating">♥ ${Number(artist.likes_count || 0)} Likes</div>
            </div>
        `).join('');

        container.querySelectorAll('.artist-card').forEach(item => {
            item.addEventListener('click', function() {
                const userId = this.dataset.userid;
                if (userId) {
                    window.location.href = `public-profile.html?userId=${encodeURIComponent(userId)}`;
                }
            });
        });

        featuredArtistsLoaded = true;
    } catch (error) {
        console.error('Erro ao carregar artistas em destaque:', error);
        container.innerHTML = '<div class="text-danger">Erro ao carregar artistas. Tente novamente.</div>';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.classList.add('section-highlight');
    setTimeout(() => section.classList.remove('section-highlight'), 1000);
}

document.getElementById('lancamentosLink')?.addEventListener('click', function(e) {
    e.preventDefault();
    scrollToSection('lancamentosSection');
});

document.getElementById('artsLink')?.addEventListener('click', function(e) {
    e.preventDefault();
    scrollToSection('artsSection');
});

document.getElementById('candidatosButton')?.addEventListener('click', function(e) {
    e.preventDefault();
    scrollToSection('candidatosSection');
});

window.setProfileButtonState = function(loggedIn, photoUrl) {
    var btn = document.getElementById('profileButton');
    if (!btn) return;

    if (loggedIn) {
        var src = photoUrl || '/images/profile_icon.png';
        btn.innerHTML = '<img src="' + src + '" alt="Perfil">';
        btn.classList.add('logged-in');
        btn.onclick = function() { window.location.href = 'profile.html'; };
    } else {
        btn.innerHTML = 'Registrar';
        btn.classList.remove('logged-in');
        btn.onclick = function() {
            var modal = new bootstrap.Modal(document.getElementById('authModal'));
            modal.show();
        };
    }
};

window.setProfileButtonState(false);

window.setupLancamentos = function(productsArray) {
    const container = document.getElementById('novosProdutosContainer');
    if (!container || !productsArray || productsArray.length === 0) return;

    const sorted = [...productsArray].sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
    });

    const lancamentos = sorted.slice(0, 8);

    if (window._kauavaProductManager && typeof window._kauavaProductManager.createProductElement === 'function') {
        container.innerHTML = '';
        lancamentos.forEach(product => {
            const el = window._kauavaProductManager.createProductElement(
                product.id, 
                product.data, 
                product.userData || {}, 
                null,
                false
            );
            if (el) container.appendChild(el);
        });
    } else {
        container.innerHTML = lancamentos.map(p => `
            <div class="col-md-3 col-sm-4 mb-3">
                <div class="card h-100">
                    <div class="card-body">
                        <h6>${escapeHtml(p.data?.productTitle || 'Produto')}</h6>
                        <small class="text-muted">R$ ${parseFloat(p.data?.productPrice || 0).toFixed(2)}</small>
                    </div>
                </div>
            </div>
        `).join('');
    }
};

document.addEventListener('DOMContentLoaded', function() {
    const cartBtn = document.getElementById('cartButton');
    if (cartBtn) {
        const newBtn = cartBtn.cloneNode(true);
        cartBtn.parentNode.replaceChild(newBtn, cartBtn);
        
        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Cart button clicked!');
            window.location.href = '/carrinho.html';
        });
    }

    loadFeaturedArtists();
});
