// Firebase project settings — these keys connect the app to Firestore database
const firebaseConfig = {
    apiKey:            "AIzaSyAQIYrX5aT8vmDRUwwZvsbks6lXJbGeNRQ",
    authDomain:        "furamora-2ce69.firebaseapp.com",
    projectId:         "furamora-2ce69",
    storageBucket:     "furamora-2ce69.firebasestorage.app",
    messagingSenderId: "686445011079",
    appId:             "1:686445011079:web:57dd36ca05cd780b455822",
    measurementId:     "G-E34G9JX30F"
};

// Start Firebase — the check stops it being initialised twice if the page reloads
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Set up Firestore — this is where I store users, bookings and reports
const db   = firebase.firestore();
window.db  = db; // make it available globally so other scripts can use it

// Set up Firebase Auth — this handles login and registration
const auth = firebase.auth();
window.auth = auth; // make it available globally so other scripts can use it
