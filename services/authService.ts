/**
 * Auth Service - Handles authentication through the backend server
 * instead of directly calling Firebase Auth from the client.
 * 
 * The server uses Firebase Admin SDK to verify credentials,
 * then returns tokens that the frontend uses to authenticate
 * with Firestore (client SDK still reads data directly).
 */

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || 'http://localhost:3001';

interface LoginResponse {
  idToken: string;
  customToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email: string;
  role: string;
  displayName: string;
}

interface VerifyResponse {
  email: string;
  role: string;
  displayName: string;
  uid: string;
}

interface CreateUserResponse {
  success: boolean;
  email: string;
  password: string;
  uid: string;
  displayName: string;
  role: string;
}

interface RefreshResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

// Token storage keys
const TOKEN_KEY = 'jati_id_token';
const REFRESH_TOKEN_KEY = 'jati_refresh_token';
const TOKEN_EXPIRY_KEY = 'jati_token_expiry';

/**
 * Login via server - sends credentials to backend,
 * server verifies with Firebase Admin SDK
 */
export async function serverLogin(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Authentication failed');
  }

  // Store tokens
  localStorage.setItem(TOKEN_KEY, data.idToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + Number(data.expiresIn) * 1000));

  return data;
}

/**
 * Verify current token is still valid
 */
export async function verifyToken(): Promise<VerifyResponse | null> {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const response = await fetch(`${API_BASE}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Try refresh
      const refreshed = await refreshToken();
      if (refreshed) {
        return verifyToken();
      }
      clearTokens();
      return null;
    }

    return response.json();
  } catch (err) {
    console.error('Token verification failed:', err);
    return null;
  }
}

/**
 * Refresh an expired token
 */
export async function refreshToken(): Promise<RefreshResponse | null> {
  const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!storedRefreshToken) return null;

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storedRefreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = await response.json();

    localStorage.setItem(TOKEN_KEY, data.idToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + Number(data.expiresIn) * 1000));

    return data;
  } catch (err) {
    console.error('Token refresh failed:', err);
    clearTokens();
    return null;
  }
}

/**
 * Create a new user (admin only) - done on server via Admin SDK
 */
export async function serverCreateUser(
  email: string,
  displayName: string,
  role: string
): Promise<CreateUserResponse> {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${API_BASE}/api/auth/create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ email, displayName, role }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create user');
  }

  return data;
}

/**
 * Logout - notify server and clear local tokens
 */
export async function serverLogout(): Promise<void> {
  const token = getStoredToken();

  if (token) {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error('Server logout failed (continuing anyway):', err);
    }
  }

  clearTokens();
}

/**
 * Get the stored ID token (for Authorization headers)
 */
export function getStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

  if (!token) return null;

  // Check if token is about to expire (within 5 minutes)
  if (expiry && Date.now() > Number(expiry) - 5 * 60 * 1000) {
    // Token is expired or about to expire
    // Don't return null - let the caller try to refresh
    return token;
  }

  return token;
}

/**
 * Check if user is token-expired and needs refresh
 */
export function isTokenExpired(): boolean {
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiry) return true;
  return Date.now() > Number(expiry);
}

/**
 * Check if we have any stored auth
 */
export function hasStoredAuth(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * Clear all stored tokens
 */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}
