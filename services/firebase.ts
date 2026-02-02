import { initializeApp, getApps, deleteApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED, terminate, clearIndexedDbPersistence } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

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
// Using multi-tab manager for better performance across browser tabs
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: CACHE_SIZE_UNLIMITED
  })
});

// Initialize Firebase Storage
export const storage = getStorage(app);

// Global error handler for Firestore assertion errors
// This catches the "Unexpected state" error and tries to recover
let errorRecoveryInProgress = false;

export const setupFirestoreErrorRecovery = () => {
  window.addEventListener('error', async (event) => {
    const errorMessage = event.error?.message || event.message || '';
    
    // Check if it's the Firestore assertion error
    if (errorMessage.includes('FIRESTORE') && errorMessage.includes('INTERNAL ASSERTION FAILED') && !errorRecoveryInProgress) {
      errorRecoveryInProgress = true;
      console.warn('Firestore assertion error detected, attempting automatic recovery...');
      
      // Prevent the error from crashing the app immediately
      event.preventDefault();
      
      // Show a user-friendly message
      const shouldReload = window.confirm(
        'حدث خطأ في الاتصال بقاعدة البيانات.\n' +
        'A database connection error occurred.\n\n' +
        'سيتم إعادة تحميل التطبيق للإصلاح.\n' +
        'The app will reload to fix this.\n\n' +
        'Press OK to reload.'
      );
      
      if (shouldReload) {
        // Clear the corrupted cache and reload
        try {
          // Try to delete IndexedDB to clear corrupted state
          const databases = await window.indexedDB.databases?.();
          if (databases) {
            for (const dbInfo of databases) {
              if (dbInfo.name && dbInfo.name.includes('firebase')) {
                window.indexedDB.deleteDatabase(dbInfo.name);
              }
            }
          }
        } catch (e) {
          console.error('Error clearing IndexedDB:', e);
        }
        
        // Reload the page
        window.location.reload();
      }
      
      errorRecoveryInProgress = false;
    }
  });

  // Also handle unhandled promise rejections
  window.addEventListener('unhandledrejection', async (event) => {
    const errorMessage = event.reason?.message || String(event.reason) || '';
    
    if (errorMessage.includes('FIRESTORE') && errorMessage.includes('INTERNAL ASSERTION FAILED') && !errorRecoveryInProgress) {
      errorRecoveryInProgress = true;
      console.warn('Firestore assertion error in promise, attempting recovery...');
      
      event.preventDefault();
      
      // Auto-reload after a short delay to let user see console
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
      errorRecoveryInProgress = false;
    }
  });
};

// Call setup immediately
setupFirestoreErrorRecovery();