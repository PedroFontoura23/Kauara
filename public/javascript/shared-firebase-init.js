const firebaseConfig = {
	apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
	authDomain: "kauara1.firebaseapp.com",
	projectId: "kauara1",
	storageBucket: "kauara1.firebaseapp.com",
	messagingSenderId: "651139031771",
	appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
	measurementId: "G-KL18R1CJ6S"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
	firebase.initializeApp(firebaseConfig);
}
