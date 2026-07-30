/**
 * Time Tracking Service - Three independent pieces:
 *
 * 1. Presence ("is a tab open") — see hooks/usePresence.ts. Writes lastSeen
 *    to the user's own users/{email} doc. Online/Offline is derived purely
 *    client-side from that timestamp (now - lastSeen < 3min) — never stored
 *    as a boolean.
 *
 * 2. Activity/idle tracking — see hooks/useActivityTracking.ts. Buffers
 *    active/idle seconds in memory (sampled every 15s, classified by real
 *    input + tab visibility) and flushes them here via flushActivity(),
 *    which increments (never overwrites) a per-day doc so concurrent tabs
 *    or tick drift can't clobber each other.
 *
 * 3. History — getUserActivityHistory() / getTodayActivityForAllUsers()
 *    below, reading the user_activity collection this writes to.
 *
 * Storage: user_activity/{uid}_{date}
 *   - uid: string, date: string (YYYY-MM-DD, Cairo calendar day)
 *   - activeSeconds: number, idleSeconds: number
 *
 * Deliberately a flat top-level collection (not a sub-collection) so every
 * read here is a single-field equality query — no collectionGroup query,
 * no composite index to configure in Firebase Console.
 */

import { doc, setDoc, serverTimestamp, increment, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// Cairo-local calendar date, e.g. "2026-07-20" — the reset boundary for
// "today", the same calendar day for every user regardless of the
// server's or viewer's own timezone.
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

export interface DailyActivity {
  uid: string;
  date: string;
  activeSeconds: number;
  idleSeconds: number;
}

export const TimeTrackingService = {
  /**
   * Adds `seconds.active` / `seconds.idle` to today's (Cairo) bucket for
   * this user. Uses increment() so multiple open tabs, or a flush racing
   * a day rollover, only ever add — never overwrite each other.
   */
  async flushActivity(uid: string, seconds: { active: number; idle: number }): Promise<void> {
    if (!uid || (seconds.active <= 0 && seconds.idle <= 0)) return;
    const dateStr = getCairoDateString();
    const docId = `${uid}_${dateStr}`;
    try {
      await setDoc(doc(db, 'user_activity', docId), {
        uid,
        date: dateStr,
        activeSeconds: increment(Math.max(0, Math.round(seconds.active))),
        idleSeconds: increment(Math.max(0, Math.round(seconds.idle))),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error('Failed to flush activity:', err);
    }
  },

  /**
   * Last `days` days of activity for one user, newest first. Sorted
   * client-side (not via Firestore orderBy) so this stays a single
   * equality-filter query — no composite index needed.
   */
  async getUserActivityHistory(uid: string, days = 14): Promise<DailyActivity[]> {
    if (!uid) return [];
    try {
      const snap = await getDocs(query(collection(db, 'user_activity'), where('uid', '==', uid)));
      const rows = snap.docs.map(d => d.data() as DailyActivity);
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return rows.slice(0, days);
    } catch (err) {
      console.error('Failed to fetch activity history:', err);
      return [];
    }
  },

  /** Today's activity for every user, keyed by uid — for the live admin list view. */
  async getTodayActivityForAllUsers(): Promise<Record<string, DailyActivity>> {
    const todayStr = getCairoDateString();
    try {
      const snap = await getDocs(query(collection(db, 'user_activity'), where('date', '==', todayStr)));
      const map: Record<string, DailyActivity> = {};
      snap.docs.forEach(d => {
        const data = d.data() as DailyActivity;
        map[data.uid] = data;
      });
      return map;
    } catch (err) {
      console.error('Failed to fetch today activity:', err);
      return {};
    }
  },
};
