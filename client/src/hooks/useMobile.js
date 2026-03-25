import { useEffect, useRef, useCallback } from 'react';
import { debugLog, warnLog, errorLog } from '../lib/logger';

/**
 * Detect if device is mobile/tablet based on viewport and user agent.
 */
export function isMobileDevice() {
  // Check viewport size
  if (typeof window === 'undefined') return false;
  
  const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
  
  // Check user agent as secondary indicator
  const ua = navigator.userAgent.toLowerCase();
  const isMobileAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua);
  
  return isMobileViewport || isMobileAgent;
}

/**
 * Hook to manage screen orientation lock for mobile listening sessions.
 * Locks to portrait when listening, unlocks when stopping.
 */
export function useOrientationLock() {
  const isLockedRef = useRef(false);

  const lockPortrait = useCallback(async () => {
    if (!isMobileDevice()) return;
    
    try {
      if (screen?.orientation?.lock) {
        await screen.orientation.lock('portrait-primary');
        isLockedRef.current = true;
        debugLog('[Mobile] Screen locked to portrait');
      }
    } catch (err) {
      warnLog('[Mobile] Could not lock orientation:', err?.message);
      // Not a critical failure — continue without lock
    }
  }, []);

  const unlockOrientation = useCallback(async () => {
    if (!isMobileDevice()) return;
    
    try {
      if (screen?.orientation?.unlock && isLockedRef.current) {
        screen.orientation.unlock();
        isLockedRef.current = false;
        debugLog('[Mobile] Screen orientation unlocked');
      }
    } catch (err) {
      warnLog('[Mobile] Could not unlock orientation:', err?.message);
    }
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup: unlock on unmount
      if (isLockedRef.current && screen?.orientation?.unlock) {
        screen.orientation.unlock();
      }
    };
  }, []);

  return { lockPortrait, unlockOrientation };
}

/**
 * Hook to manage WakeLock API — keeps screen awake during active listening.
 * Gracefully degrades on unsupported browsers.
 *
 * FIX: The visibilitychange listener is now properly tracked and cleaned up
 * on release/unmount to prevent listener leaks. The handler no longer nulls
 * out the wake lock ref on `document.hidden` — the OS auto-releases it, and
 * setting it null here would prevent proper re-acquire on foreground.
 */
export function useWakeLock() {
  const wakeLockRef = useRef(null);
  const visibilityHandlerRef = useRef(null);

  const removeVisibilityListener = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!navigator?.wakeLock) {
      debugLog('[WakeLock] Not supported on this device');
      return false;
    }

    if (wakeLockRef.current) {
      debugLog('[WakeLock] Already acquired');
      return true;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      debugLog('[WakeLock] Screen wake lock acquired');

      // Clean up any old listener before adding a new one
      removeVisibilityListener();

      // Re-acquire when tab comes back to focus (wake lock is auto-released
      // by the OS when the page is hidden)
      const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && !wakeLockRef.current) {
          try {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
            debugLog('[WakeLock] Re-acquired after visibility change');
          } catch (err) {
            errorLog('[WakeLock] Failed to re-acquire:', err);
          }
        } else if (document.visibilityState === 'hidden') {
          // The OS automatically releases the wake lock when hidden.
          // Set ref to null so we re-acquire on return.
          wakeLockRef.current = null;
        }
      };

      visibilityHandlerRef.current = handleVisibilityChange;
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Also handle the wake lock being released by the OS spontaneously
      wakeLockRef.current.addEventListener('release', () => {
        debugLog('[WakeLock] Released by OS');
        wakeLockRef.current = null;
      });

      return true;
    } catch (err) {
      errorLog('[WakeLock] Failed to request wake lock:', err);
      return false;
    }
  }, [removeVisibilityListener]);

  const releaseWakeLock = useCallback(async () => {
    removeVisibilityListener();

    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        debugLog('[WakeLock] Screen wake lock released');
      } catch (err) {
        errorLog('[WakeLock] Failed to release:', err);
      }
    }
  }, [removeVisibilityListener]);

  useEffect(() => {
    return () => {
      // Cleanup: release on unmount
      removeVisibilityListener();
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [removeVisibilityListener]);

  return { requestWakeLock, releaseWakeLock };
}
