import { adminAuth } from './firebaseAdmin.js';

/**
 * Middleware to verify Firebase ID token from Authorization header.
 * Attaches decoded user info to req.user
 */
export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Send Authorization: Bearer <token>' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Middleware to check if user has admin role in Firestore
 */
export const requireAdmin = async (req, res, next) => {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { adminDb } = await import('./firebaseAdmin.js');
    const userDoc = await adminDb.collection('users').doc(req.user.email.toLowerCase()).get();

    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('Admin check failed:', err);
    return res.status(500).json({ error: 'Failed to verify admin status' });
  }
};
