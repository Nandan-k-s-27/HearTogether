import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { setSocketAuth } from './services/socket';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import HostRoom from './pages/HostRoom';
import ListenerRoom from './pages/ListenerRoom';
import JoinPage from './pages/JoinPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { user } = useAuth();

  // Update socket auth when user changes
  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('auth_token');
      if (token) {
        setSocketAuth(token);
      }
    }
  }, [user]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <LandingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/host/:roomId"
        element={
          <ProtectedRoute>
            <HostRoom />
          </ProtectedRoute>
        }
      />
      <Route
        path="/room/:code"
        element={
          <ProtectedRoute>
            <JoinPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/listen/:roomId"
        element={
          <ProtectedRoute>
            <ListenerRoom />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
