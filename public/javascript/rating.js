// rating.js
class RatingSystem {
    constructor(userId, container) {
        this.userId = userId;
        this.container = container;
        this.db = firebase.firestore();
        this.auth = firebase.auth();
        this.init();
    }

    async init() {
        this.currentUser = await this.getCurrentUser();
        await this.loadRatings();
        this.render();
    }

    async getCurrentUser() {
        return new Promise((resolve) => {
            this.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    // Get the foreignUserId format for the current user
                    try {
                        const userDoc = await this.db.collection('users')
                            .where('firebaseUID', '==', user.uid)
                            .get();
                        if (!userDoc.empty) {
                            user.foreignUserId = userDoc.docs[0].id;
                            console.log("Auth state changed, user:", user ? user.uid : "No user logged in");
                        }
                    } catch (error) {
                        console.error("Error getting foreignUserId:", error);
                    }
                }
                resolve(user);
            });
        });
    }

    async loadRatings() {
        try {
            // Get the user document which now contains rating stats
            const userDoc = await this.db.collection('users').doc(this.userId).get();
            const userData = userDoc.data();
            
            // Get rating statistics from user document
            this.averageRating = userData.averageRating || 0;
            this.totalRatings = userData.totalRatings || 0;

            // Load individual ratings for the current user if logged in
            if (this.currentUser && this.currentUser.foreignUserId) {
                const ratingsRef = await this.db.collection('ratings')
                    .where('foreignUserId', '==', this.userId)
                    .where('raterForeignUserId', '==', this.currentUser.foreignUserId)
                    .get();

                this.ratings = [];
                ratingsRef.forEach(doc => {
                    this.ratings.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
            }
        } catch (error) {
            console.error("Error loading ratings:", error);
        }
    }

    async getUserRating() {
        if (!this.currentUser || !this.currentUser.foreignUserId) return null;

        const userRating = this.ratings.find(r => r.raterForeignUserId === this.currentUser.foreignUserId);
        return userRating ? userRating.ratingValue : null;
    }

    async submitRating(value) {
        if (!this.currentUser) {
            alert('Please log in to rate users');
            return;
        }

        if (this.currentUser.foreignUserId === this.userId) {
            alert('You cannot rate yourself');
            return;
        }

        try {
            const batch = this.db.batch();
            
            // Get existing rating if any
            const existingRatingDoc = await this.db.collection('ratings')
                .where('foreignUserId', '==', this.userId)
                .where('raterForeignUserId', '==', this.currentUser.foreignUserId)
                .get();

            let oldRatingValue = 0;
            
            if (!existingRatingDoc.empty) {
                // Update existing rating
                oldRatingValue = existingRatingDoc.docs[0].data().ratingValue;
                batch.update(existingRatingDoc.docs[0].ref, {
                    ratingValue: value,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Create new rating
                const newRatingRef = this.db.collection('ratings').doc();
                batch.set(newRatingRef, {
                    foreignUserId: this.userId,
                    raterForeignUserId: this.currentUser.foreignUserId,
                    ratingValue: value,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            // Update user document with new rating statistics
            const userRef = this.db.collection('users').doc(this.userId);
            const userDoc = await userRef.get();
            const userData = userDoc.data();
            
            const currentTotal = userData.totalRatings || 0;
            const currentSum = (userData.averageRating || 0) * currentTotal;
            
            let newTotal, newSum;
            if (oldRatingValue === 0) {
                // New rating
                newTotal = currentTotal + 1;
                newSum = currentSum + value;
            } else {
                // Updated rating
                newTotal = currentTotal;
                newSum = currentSum - oldRatingValue + value;
            }

            const newAverage = newSum / newTotal;

            batch.update(userRef, {
                averageRating: newAverage,
                totalRatings: newTotal
            });

            await batch.commit();
            await this.loadRatings();
            this.render();

            // 🔄 Force update of the product's rating section
            const ratingContainer = document.getElementById(`rating-${this.productId}`);
            if (ratingContainer) {
                console.log(`Forcing UI update for product ${this.productId}`);

                // Reinitialize the rating system for this product
                window.productRatingSystems[this.productId] = new ProductRatingSystem(
                    this.productId, ratingContainer, this.db, this.currentUserId
                );
            }



        } catch (error) {
            console.error("Error submitting rating:", error);
            alert('Failed to submit rating');
        }
    }

    render() {
        this.container.innerHTML = ""; // Clear before updating

        let html = `
            <div class="mt-4">
                <h4>Product Rating</h4>
                <p>Average Rating: ${this.averageRating.toFixed(1)} ⭐ (${this.totalRatings} ratings)</p>
        `;

        if (this.currentUser && this.currentUser.foreignUserId !== this.userId) {
            html += `
                <div class="rating-input mb-3">
                    <p>Your Rating:</p>
                    <div class="btn-group" role="group">
            `;

            for (let i = 1; i <= 5; i++) {
                const userRating = this.ratings.length > 0 ? this.ratings[0].ratingValue : null;
                html += `
                    <button type="button" 
                            class="btn ${userRating === i ? 'btn-warning' : 'btn-outline-warning'}"
                            onclick="ratingSystem.submitRating(${i})">
                        ${i} ⭐
                    </button>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        html += '</div>';
        this.container.innerHTML = html;
    }
}

// rating.js
class ProductRatingSystem {
    constructor(productId, container, db, currentUserId) {
        this.productId = productId;
        this.container = container;
        this.db = db;
        this.currentUserId = currentUserId;
        this.currentFirebaseUID = null;
        this.userRating = null;
        this.init();
    }

    async init() {
        await this.loadCurrentUserFirebaseUID();
        await this.loadRatings();
        this.render();
    }

    async loadCurrentUserFirebaseUID() {
        if (!this.currentUserId) return;
        
        try {
            const userDoc = await this.db.collection('users')
                .doc(this.currentUserId)
                .get();
                
            if (userDoc.exists) {
                this.currentFirebaseUID = userDoc.data().firebaseUID;
            }
        } catch (error) {
            console.error("Error loading Firebase UID:", error);
        }
    }

    async submitRating(value) {
        if (!this.currentUserId || !this.currentFirebaseUID) {
            alert('Please log in to rate products');
            return;
        }

        try {
            const batch = this.db.batch();

            // Query using composite index
            const existingQuery = this.db.collection('product_ratings')
                .where('productId', '==', this.productId)
                .where('foreignUserId', '==', this.currentUserId)
                .limit(1);

            const existingSnapshot = await existingQuery.get();
            let oldRatingValue = 0;

            if (!existingSnapshot.empty) {
                // Update existing rating
                const existingDoc = existingSnapshot.docs[0];
                oldRatingValue = existingDoc.data().ratingValue;
                batch.update(existingDoc.ref, {
                    ratingValue: value,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Create new rating
                const newRatingRef = this.db.collection('product_ratings').doc();
                batch.set(newRatingRef, {
                    productId: this.productId,
                    foreignUserId: this.currentUserId, // Your custom ID
                    firebaseUID: this.currentFirebaseUID, // For security rules
                    ratingValue: value,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            // Update product stats using transaction
            const productRef = this.db.collection('products').doc(this.productId);
            await this.db.runTransaction(async (transaction) => {
                const doc = await transaction.get(productRef);
                const data = doc.data();
                
                const currentTotal = data.totalRatings || 0;
                const currentSum = (data.averageRating || 0) * currentTotal;
                
                let newTotal, newSum;
                if (oldRatingValue === 0) {
                    newTotal = currentTotal + 1;
                    newSum = currentSum + value;
                } else {
                    newTotal = currentTotal;
                    newSum = currentSum - oldRatingValue + value;
                }
                
                transaction.update(productRef, {
                    averageRating: newSum / newTotal,
                    totalRatings: newTotal
                });
            });

            await batch.commit();
            await this.loadRatings();
            this.render();

        } catch (error) {
            console.error("Error submitting rating:", error);
            alert('Failed to submit rating: ' + error.message);
        }
    }

    // Update loadRatings to use foreignUserId
    async loadRatings() {
        try {
            // Get product stats
            const productDoc = await this.db.collection('products').doc(this.productId).get();
            if (!productDoc.exists) return;
            
            const productData = productDoc.data();
            this.averageRating = productData.averageRating || 0;
            this.totalRatings = productData.totalRatings || 0;

            // Get user's rating if logged in
            if (this.currentUserId) {
                const ratingsQuery = await this.db.collection('product_ratings')
                    .where('productId', '==', this.productId)
                    .where('foreignUserId', '==', this.currentUserId)
                    .limit(1)
                    .get();

                if (!ratingsQuery.empty) {
                    this.userRating = ratingsQuery.docs[0].data().ratingValue;
                }
            }
        } catch (error) {
            console.error("Error loading ratings:", error);
        }
    }

    render() {
        this.container.innerHTML = "";

        let html = `
            <div class="mt-4">
                <h4>Product Rating</h4>
                <p class="mb-2">Average Rating: ${this.averageRating.toFixed(1)} ⭐ (${this.totalRatings} ratings)</p>
        `;

        if (this.currentUserId) {
            html += `
                <div class="rating-input mb-3">
                    <div class="btn-group" role="group">
            `;

            for (let i = 1; i <= 5; i++) {
                html += `
                    <button type="button" 
                            class="btn ${this.userRating === i ? 'btn-warning' : 'btn-outline-warning'}"
                            onmouseover="this.style.opacity='0.8'"
                            onmouseout="this.style.opacity='1'"
                            onclick="productRatingSystems['${this.productId}'].submitRating(${i})">
                        ${i} ⭐
                    </button>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        html += '</div>';
        this.container.innerHTML = html;
    }
}

window.ProductRatingSystem = ProductRatingSystem;
window.productRatingSystems = {};