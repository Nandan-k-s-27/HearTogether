import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { BACKEND_URL } from '../lib/config';
import { errorLog } from '../lib/logger';

const AuthContext = createContext(null);
const AUTH_IN_FLIGHT_KEY = 'auth_in_flight';

const AUTH_CALLBACK_QUERY_KEYS = [
  'auth_token',
  'auth_error',
  'code',
  'state',
  'scope',
  'prompt',
  'error',
  'error_description',
];

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authBootState, setAuthBootState] = useState({
    active: false,
    attempt: 0,
    message: '',
  });

  const getStoredToken = () => localStorage.getItem('auth_token');

  const hasKnownAuthCallbackParams = () => {
    const params = new URLSearchParams(window.location.search);
    return AUTH_CALLBACK_QUERY_KEYS.some((key) => params.has(key));
  };

  const sanitizeAuthCallbackUrl = () => {
    const url = new URL(window.location.href);
    let changed = false;

    AUTH_CALLBACK_QUERY_KEYS.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });

    if (changed) {
      const nextSearch = url.searchParams.toString();
      const cleanUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  };

  // Check if user is authenticated on mount or when token changes
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = getStoredToken();
        if (!token) {
          setUser(null);
          setLoading(false);
          return;
        }
        const response = await axios.get(`${BACKEND_URL}/auth/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.data.authenticated) {
          setUser(response.data.user);
        } else {
          setUser(null);
        }
      } catch (err) {
        errorLog('Auth check failed:', err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Handle OAuth callback from Google (redirect with token in URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');
    const authError = params.get('auth_error');
    const hasAuthParams = hasKnownAuthCallbackParams();
    const hadAuthFlowInFlight = sessionStorage.getItem(AUTH_IN_FLIGHT_KEY) === '1';

    if (token) {
      // Persist token on frontend origin for cross-domain API auth.
      localStorage.setItem('auth_token', token);

      // Parse token to get user info and keep UI responsive before /auth/status completes.
      const payload = decodeJwtPayload(token);
      if (payload) setUser(payload);
      
      const returnTo = localStorage.getItem('post_auth_redirect');
      if (returnTo) {
        localStorage.removeItem('post_auth_redirect');
        sessionStorage.removeItem(AUTH_IN_FLIGHT_KEY);
        window.location.replace(returnTo);
        return;
      }

      sanitizeAuthCallbackUrl();
      sessionStorage.removeItem(AUTH_IN_FLIGHT_KEY);
      setAuthBootState({
        active: false,
        attempt: 0,
        message: '',
      });
    }

    if (authError) {
      setError('Authentication failed. Please try again.');
      sanitizeAuthCallbackUrl();
      sessionStorage.removeItem(AUTH_IN_FLIGHT_KEY);
      setAuthBootState({
        active: false,
        attempt: 0,
        message: '',
      });
    }

    // Extra history guard for mobile/webview back-button edge cases.
    if (!token && !authError && (hasAuthParams || hadAuthFlowInFlight)) {
      sanitizeAuthCallbackUrl();
      sessionStorage.removeItem(AUTH_IN_FLIGHT_KEY);
    }
  }, []);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const probeBackendHealth = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const health = await fetch(`${BACKEND_URL}/api/health?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });

      return health.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const resetAuthState = () => {
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem(AUTH_IN_FLIGHT_KEY);
    setUser(null);
    setAuthBootState({
      active: false,
      attempt: 0,
      message: '',
    });
  };

  const waitForBackend = async () => {
    const timeoutMs = 75_000;
    const intervalMs = 2_500;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      attempt += 1;

      setAuthBootState({
        active: true,
        attempt,
        message:
          attempt === 1
            ? 'Checking backend status...'
            : attempt < 6
            ? 'Starting authentication service...'
            : 'Finalizing warm-up... this can take a moment on Render.',
      });

      const healthy = await probeBackendHealth();
      if (healthy) {
        return true;
      }

      await sleep(intervalMs);
    }

    return false;
  };

  const login = async ({ prompt, returnTo } = {}) => {
    if (authBootState.active) return;

    if (returnTo) {
      localStorage.setItem('post_auth_redirect', returnTo);
    }

    sessionStorage.setItem(AUTH_IN_FLIGHT_KEY, '1');

    setError(null);

    const ready = await waitForBackend();

    setAuthBootState((prev) => ({
      ...prev,
      active: true,
      message: ready
        ? 'Backend ready. Redirecting to Google...'
        : 'Still waking up. Redirecting now...',
    }));

    await sleep(450);

    const qp = prompt ? `?prompt=${encodeURIComponent(prompt)}` : '';
    // replace prevents stale auth-entry pages from staying in browser history.
    window.location.replace(`${BACKEND_URL}/auth/google${qp}`);
  };

  const switchAccount = async () => {
    resetAuthState();
    await login({ prompt: 'select_account' });
  };

  const logout = async () => {
    const token = getStoredToken();
    resetAuthState();

    try {
      await axios.post(
        `${BACKEND_URL}/auth/logout`,
        {},
        {
          withCredentials: true,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
    } catch (err) {
      errorLog('Logout failed:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        logout,
        switchAccount,
        authBootState,
        BACKEND_URL,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
