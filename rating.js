// rating.js
document.addEventListener("DOMContentLoaded", function() {
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

    const auth = firebase.auth();
    const db = firebase.firestore();

    class RatingSystem {
        constructor(userId, containerElement) {
            this.userId = userId;
            this.container = containerElement;
            this.currentUserRating = 0;
            this.auth = firebase.auth();
            this.db = firebase.firestore();
            this.stars = [];
            this.averageRating = 0;
            this.totalRatings = 0;
            
            this.initialize();
        }

        async initialize() {
            this.createStarElements();
            await this.loadRatingStats();
            await this.loadUserRating();
            this.setupEventListeners();
            this.updateDisplay();
        }

        createStarElements() {
            const starsContainer = document.createElement('div');
            starsContainer.className = 'stars-container d-flex align-items-center justify-content-center mb-3';
            
            // Create stars
            for (let i = 1; i <= 5; i++) {
                const star = document.createElement('span');
                star.innerHTML = '☆';
                star.className = 'star fs-3 mx-1';
                star.style.cursor = 'pointer';
                star.dataset.value = i;
                this.stars.push(star);
                starsContainer.appendChild(star);
            }

            // Create stats container
            const statsContainer = document.createElement('div');
            statsContainer.className = 'rating-stats text-center mt-2';
            statsContainer.innerHTML = `
                <span class="average-rating"></span>
                <span class="total-ratings"></span>
            `;

            this.container.appendChild(starsContainer);
            this.container.appendChild(statsContainer);
        }

        async loadRatingStats() {
            const userDoc = await this.db.collection('users').doc(this.userId).get();
            const userData = userDoc.data();
            this.averageRating = userData.averageRating || 0;
            this.totalRatings = userData.totalRatings || 0;
        }

        async loadUserRating() {
            const currentUser = this.auth.currentUser;
            if (currentUser) {
                const ratingDoc = await this.db.collection('ratings')
                    .doc(`${this.userId}_${currentUser.uid}`)
                    .get();
                
                if (ratingDoc.exists) {
                    this.currentUserRating = ratingDoc.data().rating;
                }
            }
        }

        setupEventListeners() {
            this.stars.forEach((star, index) => {
                star.addEventListener('mouseover', () => this.handleStarHover(index));
                star.addEventListener('mouseout', () => this.handleStarOut());
                star.addEventListener('click', () => this.handleStarClick(index + 1));
            });
        }

        handleStarHover(index) {
            this.stars.forEach((star, i) => {
                star.innerHTML = i <= index ? '★' : '☆';
            });
        }

        handleStarOut() {
            this.updateDisplay();
        }

        async handleStarClick(rating) {
            const currentUser = this.auth.currentUser;
            if (!currentUser) {
                alert('Please log in to rate');
                return;
            }

            if (currentUser.uid === this.userId) {
                alert('You cannot rate yourself');
                return;
            }

            const ratingRef = this.db.collection('ratings')
                .doc(`${this.userId}_${currentUser.uid}`);
            
            const batch = this.db.batch();
            const userRef = this.db.collection('users').doc(this.userId);

            try {
                const userDoc = await userRef.get();
                const userData = userDoc.data();
                let { averageRating = 0, totalRatings = 0 } = userData;

                // If user has already rated, update the average
                const oldRatingDoc = await ratingRef.get();
                if (oldRatingDoc.exists) {
                    const oldRating = oldRatingDoc.data().rating;
                    const newTotal = (averageRating * totalRatings - oldRating + rating);
                    averageRating = newTotal / totalRatings;
                } else {
                    // New rating
                    const newTotal = (averageRating * totalRatings + rating);
                    totalRatings++;
                    averageRating = newTotal / totalRatings;
                }

                // Update rating document
                batch.set(ratingRef, {
                    rating,
                    userId: currentUser.uid,
                    targetUserId: this.userId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Update user document
                batch.update(userRef, {
                    averageRating,
                    totalRatings
                });

                await batch.commit();

                this.currentUserRating = rating;
                this.averageRating = averageRating;
                this.totalRatings = totalRatings;
                this.updateDisplay();

            } catch (error) {
                console.error('Error updating rating:', error);
                alert('Error updating rating. Please try again.');
            }
        }

        updateDisplay() {
            // Update stars display
            this.stars.forEach((star, index) => {
                star.innerHTML = index < this.currentUserRating ? '★' : '☆';
            });

            // Update stats display
            const averageElement = this.container.querySelector('.average-rating');
            const totalElement = this.container.querySelector('.total-ratings');
            
            averageElement.textContent = `Average: ${this.averageRating.toFixed(1)} `;
            totalElement.textContent = `(${this.totalRatings} ${this.totalRatings === 1 ? 'rating' : 'ratings'})`;
        }
    }

    window.RatingSystem = RatingSystem;
});