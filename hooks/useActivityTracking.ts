import { useEffect, useRef } from 'react';
import { TimeTrackingService } from '../services/timeTrackingService';

const TICK_MS = 15000;                   // classify the preceding window as active or idle
const FLUSH_MS = 30000;                  // drain buffers to Firestore
const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // no real input for this long => idle

/**
 * Activity/idle tracking. Real input (mouse/keyboard/touch/scroll) just
 * stamps a ref — no per-event Firestore writes. Every 15s, one tick
 * classifies the whole preceding 15s as active or idle in one shot:
 *   timedOut = now - lastInput > 3 minutes
 *   isVisible = document.visibilityState === 'visible' (tab foregrounded)
 *   active if !timedOut && isVisible, otherwise idle — bucketed into an
 *   in-memory buffer. Sampling in fixed 15s chunks (rather than a single
 *   continuous idle timer reset on every event) avoids drift, double
 *   counting, and throttled-timer misses when a tab is backgrounded.
 *
 * Every 30s a separate tick drains both buffers via
 * TimeTrackingService.flushActivity(), which increments (never
 * overwrites) today's Firestore doc — safe against concurrent tabs.
 * On unmount (tab close/logout) does one best-effort final flush of
 * whatever's left in the buffers.
 *
 * Mount this once near the root of the app, for as long as the user is
 * authenticated. `uid` should be a stable per-user identifier (lowercase
 * email, matching the doc id used elsewhere).
 */
export function useActivityTracking(uid: string | null | undefined) {
  const lastInputRef = useRef(Date.now());
  const activeBufferRef = useRef(0);
  const idleBufferRef = useRef(0);

  useEffect(() => {
    if (!uid) return;

    lastInputRef.current = Date.now();
    activeBufferRef.current = 0;
    idleBufferRef.current = 0;

    const markInput = () => { lastInputRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, markInput, { passive: true }));

    const tickSeconds = TICK_MS / 1000;
    const classifyTick = setInterval(() => {
      const timedOut = Date.now() - lastInputRef.current > IDLE_THRESHOLD_MS;
      const isVisible = document.visibilityState === 'visible';
      if (!timedOut && isVisible) {
        activeBufferRef.current += tickSeconds;
      } else {
        idleBufferRef.current += tickSeconds;
      }
    }, TICK_MS);

    const flushTick = setInterval(() => {
      const active = activeBufferRef.current;
      const idle = idleBufferRef.current;
      activeBufferRef.current = 0;
      idleBufferRef.current = 0;
      if (active > 0 || idle > 0) {
        TimeTrackingService.flushActivity(uid, { active, idle });
      }
    }, FLUSH_MS);

    return () => {
      events.forEach(ev => window.removeEventListener(ev, markInput));
      clearInterval(classifyTick);
      clearInterval(flushTick);
      // Best-effort final flush — whatever's left in the buffers at unmount
      const active = activeBufferRef.current;
      const idle = idleBufferRef.current;
      if (active > 0 || idle > 0) {
        TimeTrackingService.flushActivity(uid, { active, idle });
      }
    };
  }, [uid]);
}
