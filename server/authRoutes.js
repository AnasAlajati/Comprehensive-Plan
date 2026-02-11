import { Router } from 'express';
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { verifyToken, requireAdmin } from './middleware.js';
import admin from 'firebase-admin';

const router = Router();

// ─────────────────────────────────────────────
// POST /api/auth/login
// Client sends email + password → Server authenticates via Admin SDK
// Returns a custom token the client can use with signInWithCustomToken
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Use Firebase Auth REST API to verify email/password
    // The Admin SDK doesn't have signInWithEmailAndPassword,
    // so we use the Firebase Auth REST API endpoint
    const apiKey = process.env.FIREBASE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Server Firebase API key not configured' });
    }

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errorCode = data.error?.message || 'UNKNOWN_ERROR';
      let userMessage = 'Authentication failed';
      if (errorCode === 'EMAIL_NOT_FOUND' || errorCode === 'INVALID_PASSWORD' || errorCode === 'INVALID_LOGIN_CREDENTIALS') {
        userMessage = 'Invalid email or password';
      }
      return res.status(401).json({ error: userMessage });
    }

    // Get user info from Firestore
    const userEmail = email.toLowerCase();
    const userDoc = await adminDb.collection('users').doc(userEmail).get();

    let role = 'pending';
    let displayName = email.split('@')[0];

    if (userDoc.exists) {
      const userData = userDoc.data();
      role = userData.role || 'pending';
      displayName = userData.displayName || displayName;
    } else {
      // First time user - create entry
      await adminDb.collection('users').doc(userEmail).set({
        email: userEmail,
        displayName,
        role: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Update presence
    await adminDb.collection('users').doc(userEmail).update({
      isOnline: true,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create a custom token so the client can call signInWithCustomToken()
    // This is different from the ID token - it lets the Firebase client SDK authenticate
    const customToken = await adminAuth.createCustomToken(data.localId);

    // Return both tokens + user info
    res.json({
      idToken: data.idToken,
      customToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      localId: data.localId,
      email: data.email,
      role,
      displayName,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during authentication' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify
// Verify an existing token is still valid
// ─────────────────────────────────────────────
router.post('/verify', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email?.toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: 'No email in token' });
    }

    const userDoc = await adminDb.collection('users').doc(userEmail).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found in system' });
    }

    const userData = userDoc.data();
    res.json({
      email: userEmail,
      role: userData.role,
      displayName: userData.displayName,
      uid: req.user.uid,
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/create-user (Admin only)
// Creates a new Firebase Auth user + Firestore record
// ─────────────────────────────────────────────
router.post('/create-user', verifyToken, requireAdmin, async (req, res) => {
  const { email, displayName, role } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const password = Math.random().toString(36).slice(-4) + Math.random().toString(36).slice(-4) + '!';

  try {
    // Create user in Firebase Auth using Admin SDK
    let uid = '';
    try {
      const userRecord = await adminAuth.createUser({
        email,
        password,
        displayName: displayName || email.split('@')[0],
      });
      uid = userRecord.uid;
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-exists') {
        // User exists in Auth, just add to Firestore
        const existingUser = await adminAuth.getUserByEmail(email);
        uid = existingUser.uid;
      } else {
        throw authErr;
      }
    }

    // Add to Firestore
    const userEmail = email.toLowerCase();
    await adminDb.collection('users').doc(userEmail).set({
      email: userEmail,
      displayName: displayName || email.split('@')[0],
      role: role || 'viewer',
      isOnline: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      uid,
      password, // Store as requested by existing logic
    });

    res.json({
      success: true,
      email: userEmail,
      password,
      uid,
      displayName: displayName || email.split('@')[0],
      role: role || 'viewer',
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/logout
// Mark user as offline
// ─────────────────────────────────────────────
router.post('/logout', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email?.toLowerCase();
    if (userEmail) {
      await adminDb.collection('users').doc(userEmail).update({
        isOnline: false,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/refresh
// Refresh an expired ID token using the refresh token
// ─────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const apiKey = process.env.FIREBASE_API_KEY;
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(401).json({ error: 'Failed to refresh token' });
    }

    res.json({
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

export default router;
