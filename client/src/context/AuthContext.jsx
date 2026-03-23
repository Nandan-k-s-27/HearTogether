import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { BACKEND_URL } from '../lib/config';

const AuthContext = createContext(null);

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

  const getStoredToken = () => localStorage.getItem('auth_token');

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
        console.error('Auth check failed:', err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [BACKEND_URL]);

  // Handle OAuth callback from Google (redirect with token in URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');
    const authError = params.get('auth_error');

    if (token) {
      // Persist token on frontend origin for cross-domain API auth.
      localStorage.setItem('auth_token', token);

      // Parse token to get user info and keep UI responsive before /auth/status completes.
      const payload = decodeJwtPayload(token);
      if (payload) setUser(payload);
      
      const returnTo = localStorage.getItem('post_auth_redirect');
      if (returnTo) {
        localStorage.removeItem('post_auth_redirect');
        window.location.assign(returnTo);
        return;
      }

      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (authError) {
      setError('Authentication failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const login = ({ prompt, returnTo } = {}) => {
    if (returnTo) {
      localStorage.setItem('post_auth_redirect', returnTo);
    }

    const qp = prompt ? `?prompt=${encodeURIComponent(prompt)}` : '';
    window.location.href = `${BACKEND_URL}/auth/google${qp}`;
  };

  const switchAccount = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
    login({ prompt: 'select_account' });
  };

  const logout = async () => {
    try {
      const token = getStoredToken();
      await axios.post(
        `${BACKEND_URL}/auth/logout`,
        {},
        {
          withCredentials: true,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      setUser(null);
      localStorage.removeItem('auth_token');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, switchAccount, BACKEND_URL }}>
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
