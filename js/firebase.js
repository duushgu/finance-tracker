import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDSUPyNswBLx7Yp7UXPgmO9DWFu6HSFdf4",
  authDomain: "finance-tracker-duushgu.firebaseapp.com",
  projectId: "finance-tracker-duushgu",
  storageBucket: "finance-tracker-duushgu.firebasestorage.app",
  messagingSenderId: "5968351371",
  appId: "1:5968351371:web:7fdce24cbc0bab6b27048e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

const isFirebaseConfigured = !Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("REPLACE_WITH")
);

export { app, auth, db, googleProvider, firebaseConfig, isFirebaseConfigured };
