import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
} catch (err) {
  console.error('❌ Could not read service account key file at:', serviceAccountPath);
  console.error('   Download it from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();

export default admin;
