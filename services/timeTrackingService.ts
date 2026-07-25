/**
 * Time Tracking Service - Accumulates per-user active time, bucketed by
 * Cairo calendar day, tagged with whichever page (viewMode) was active.
 *
 * Storage: users/{email}/dailyActivity/{YYYY-MM-DD}
 *   - date: string (same as doc id, kept as a field so range queries work)
 *   - totalSeconds: number
 *   - perPage: { [viewModeKey]: number }
 *
 * Mirrors the MachineSS/{id}/dailyLogs/{date} sub-collection pattern
 * already used elsewhere in this app.
 */

import { doc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
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

// This factory's work week runs Saturday -> Friday (Cairo time).
export function getCairoWeekRange(d: Date = new Date()): { start: string; end: string } {
  const todayStr = getCairoDateString(d);
  const [y, m, day] = todayStr.split('-').map(Number);
  const asUTC = new Date(Date.UTC(y, m - 1, day));
  const dow = asUTC.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceSaturday = (dow + 1) % 7; // Sat->0, Sun->1, ... Fri->6
  const startUTC = new Date(asUTC);
  startUTC.setUTCDate(asUTC.getUTCDate() - daysSinceSaturday);
  const endUTC = new Date(startUTC);
  endUTC.setUTCDate(startUTC.getUTCDate() + 6);
  const fmt = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return { start: fmt(startUTC), end: fmt(endUTC) };
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

// Groups pages (viewMode keys) into the feature areas tracked for reporting.
// Admin-only pages (Users, Machines) are intentionally left unmapped so they
// never appear in the Feature Usage report, even though a user's total daily
// time (recorded regardless of page) still includes them.
export const FEATURE_GROUPS: { id: string; label: string; pages: string[] }[] = [
  { id: 'main-orders', label: 'Main Orders Functionality', pages: ['orders', 'excel', 'compare', 'history', 'fabric-history'] },
  { id: 'dyehouse', label: 'IN Dyehouse Features', pages: ['dyehouse-directory', 'dyehouse-inventory'] },
  { id: 'planning', label: 'Planning', pages: ['planning', 'maintenance'] },
  { id: 'factory', label: 'IN Factory', pages: ['real-maintenance', 'idle', 'recent-prints', 'fabric-reports', 'sample-tracking', 'sample-archive'] },
];

const PAGE_TO_GROUP: Record<string, string> = {};
FEATURE_GROUPS.forEach(g => g.pages.forEach(p => { PAGE_TO_GROUP[p] = g.id; }));

export function getGroupIdForPage(page: string): string | null {
  return PAGE_TO_GROUP[page] || null;
}

export const TimeTrackingService = {
  /**
   * Adds `seconds` of active time to today's (Cairo) bucket for this user,
   * tagged to whichever page was active. Called from the presence heartbeat
   * only while the user's status is 'online' (not idle/background) — idle
   * and background time is never recorded.
   */
  async recordActiveSeconds(email: string, seconds: number, page: string): Promise<void> {
    if (!email || seconds <= 0) return;
    const dateStr = getCairoDateString();
    const ref = doc(db, 'users', email.toLowerCase(), 'dailyActivity', dateStr);
    const pageKey = page || 'unknown';
    try {
      await setDoc(ref, {
        date: dateStr,
        totalSeconds: increment(seconds),
        [`perPage.${pageKey}`]: increment(seconds),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('Failed to record active time:', err);
    }
  }
};
