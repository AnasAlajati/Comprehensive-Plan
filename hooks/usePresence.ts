import { useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Presence — "is a tab open". Writes lastSeen to the user's own
 * users/{email} doc immediately on mount and then every 60s, for as long
 * as a tab is open, regardless of whether the user is actually touching
 * anything (that's useActivityTracking's job).
 *
 * Online/Offline is derived purely client-side from this timestamp
 * (now - lastSeen < 3min) — never stored as a boolean, so it can't go
 * stale relative to the check itself.
 *
 * Mount this once near the root of the app, for as long as the user is
 * authenticated.
 */
export function usePresence(email: string | null | undefined) {
  useEffect(() => {
    if (!email) return;
    const ref = doc(db, 'users', email.toLowerCase());

    const ping = () => {
      setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true })
        .catch(err => console.error('Presence ping failed:', err));
    };

    ping();
    const interval = setInterval(ping, 60000);
    return () => clearInterval(interval);
  }, [email]);
}
