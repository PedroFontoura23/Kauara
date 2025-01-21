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

        } catch (error) {
            console.error("Error submitting rating:", error);
            alert('Failed to submit rating');
        }
    }

    render() {
        let html = `
            <div class="mt-4">
                <h4>Rating</h4>
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