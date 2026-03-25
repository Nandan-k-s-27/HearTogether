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

      removeVisibilityListener();

      // Re-acquire if tab comes back to focus (page visibility change)
      const handleVisibilityChange = async () => {
        if (document.hidden) {
          wakeLockRef.current = null;
        } else if (!wakeLockRef.current) {
          try {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
            debugLog('[WakeLock] Re-acquired after visibility change');
          } catch (err) {
            errorLog('[WakeLock] Failed to re-acquire:', err);
          }
        }
      };

      visibilityHandlerRef.current = handleVisibilityChange;
      document.addEventListener('visibilitychange', handleVisibilityChange);
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
      removeVisibilityListener();
      // Cleanup: release on unmount
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => { });
      }
    };
  }, [removeVisibilityListener]);

  return { requestWakeLock, releaseWakeLock };
}
