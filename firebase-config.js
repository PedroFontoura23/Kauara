// firebase-config.js

const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Database schema setup
const db = firebase.firestore();

// Create database collections to match SQL structure
const collections = {
    users: db.collection('users'),
    contacts: db.collection('contacts'),
    posts: db.collection('posts'),
    products: db.collection('products'),
    photos: db.collection('photos'),
    ratings: db.collection('ratings'),
    comments: db.collection('comments'),
    sales: db.collection('sales'),
    purchases: db.collection('purchases'),
    productSales: db.collection('productSales'),
    productPurchases: db.collection('productPurchases')
};

// Helper function to create a new user document with full structure
async function createUserDocument(uid, userData) {
    const userDoc = {
        userId: uid,
        username: userData.username,
        fullName: userData.fullName,
        bio: userData.bio || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    await collections.users.doc(uid).set(userDoc);
    
    // Create associated contact document
    const contactDoc = {
        userId: uid,
        email: userData.email,
        telephone: userData.telephone || null
    };
    
    await collections.contacts.doc(uid).set(contactDoc);
    
    return userDoc;
}

// Helper function to get user data with contacts
async function getUserWithContacts(uid) {
    const userDoc = await collections.users.doc(uid).get();
    const contactDoc = await collections.contacts.doc(uid).get();
    
    if (!userDoc.exists) return null;
    
    return {
        ...userDoc.data(),
        contact: contactDoc.exists ? contactDoc.data() : null
    };
}

export { 
    firebaseConfig, 
    collections, 
    createUserDocument, 
    getUserWithContacts 
};