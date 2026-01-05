import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Your provided configuration
export const firebaseConfig = {
  apiKey: "AIzaSyBq5XzNwwv8cGAlPIJ6g0fs6FuTPe9bLUo",
  authDomain: "naseej-1df53.firebaseapp.com",
  projectId: "naseej-1df53",
  storageBucket: "naseej-1df53.firebasestorage.app",
  messagingSenderId: "826736615098",
  appId: "1:826736615098:web:2ebcfc2d32180065446c83",
  measurementId: "G-1DTEWZNK7J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Cloud Firestore with persistent cache settings
// This replaces getFirestore() and enableIndexedDbPersistence()
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});