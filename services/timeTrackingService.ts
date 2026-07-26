/**
 * Time Tracking Service - Tracks each user's total active time for today
 * (Cairo calendar day), stored directly on their own users/{email} doc:
 *   - activeDateToday: string (e.g. "2026-07-26")
 *   - activeSecondsToday: number
 *
 * Written directly on the user doc (rather than a dailyActivity
 * sub-collection) so it's readable from the same live "users" listener
 * every page already uses — no extra collectionGroup query, and no
 * Firestore index to configure.
 */

import { doc, getDoc, updateDoc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db } from './firebase';

// Cairo-local calendar date, e.g. "2026-07-20"
export function getCairoDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  if (seconds < 60) return '0m';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export const TimeTrackingService = {
  /**
   * Adds `seconds` to today's (Cairo) active-time total for this user.
   * Called from the presence heartbeat only while the user's status is
   * 'online' (not idle/background) — idle and background time is never
   * recorded. Resets to today's count if the stored date has rolled over.
   */
  async recordActiveSeconds(email: string, seconds: number): Promise<void> {
    if (!email || seconds <= 0) return;
    const todayStr = getCairoDateString();
    const ref = doc(db, 'users', email.toLowerCase());
    try {
      const snap = await getDoc(ref);
      const data = snap.exists() ? (snap.data() as any) : {};
      if (data.activeDateToday === todayStr) {
        await updateDoc(ref, { activeSecondsToday: increment(seconds), lastActiveAt: serverTimestamp() });
      } else {
        await setDoc(ref, { activeDateToday: todayStr, activeSecondsToday: seconds, lastActiveAt: serverTimestamp() }, { merge: true });
      }
    } catch (err) {
      console.error('Failed to record active time:', err);
    }
  }
};
