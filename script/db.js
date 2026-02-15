import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAv0ZL9zviZYaHINFpX0j7kkwlB7SvcMzM",
    authDomain: "pixel-merge-game.firebaseapp.com",
    projectId: "pixel-merge-game",
    storageBucket: "pixel-merge-game.firebasestorage.app",
    messagingSenderId: "655295451453",
    appId: "1:655295451453:web:ae0d1fc35d02f992ecf554"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);