import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Ensure BACKEND_URL is consistent - read once and use everywhere
  const BACKEND_URL = (() => {
    const url = import.meta.env.VITE_BACKEND_URL;
    // Only use localhost fallback in development (when running on localhost)
    if (!url && window.location.hostname === 'localhost') {
      return 'http://localhost:3001';
    }
    return url || 'https://heartogether.onrender.com';
  })();

  const getStoredToken = () => localStorage.getItem('auth_token');

  // Debug: Log the backend URL being used (remove in production)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Auth] BACKEND_URL:', BACKEND_URL);
      console.log('[Auth] VITE_BACKEND_URL env:', import.meta.env.VITE_BACKEND_URL);
    }
  }, [BACKEND_URL]);

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
          withCredentials: true,
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
      
      // Parse token to get user info (basic JWT decode)
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser(payload);
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (authError) {
      setError('Authentication failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const login = () => {
    // Use the BACKEND_URL from component scope
    window.location.href = `${BACKEND_URL}/auth/google`;
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
    <AuthContext.Provider value={{ user, loading, error, login, logout, BACKEND_URL }}>
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
