import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, login, authBootState } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <GlowCard customSize glowColor="blue" className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">HearTogether</h1>
          <p className="text-gray-400 mb-8">
            Share audio with listeners in real-time. Sign in to get started.
          </p>

          <div className="space-y-4">
            <ShimmerButton
              onClick={login}
              disabled={authBootState.active}
              background="rgba(20, 20, 30, 0.95)"
              shimmerColor="#5c7cfa"
              className="dark:text-white w-full text-lg font-semibold py-3 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {authBootState.active ? 'Starting sign in...' : 'Sign in with Google'}
            </ShimmerButton>

            <p className="text-xs text-gray-500 px-4">
              By signing in, you agree to share your profile information to create and join audio rooms.
            </p>
          </div>

          <div className="mt-8 border-t border-white/10 pt-6">
            <h2 className="text-sm font-semibold mb-4">Features</h2>
            <ul className="text-xs text-gray-400 space-y-2 text-left">
              <li>✓ Share system audio from tabs, windows, or screens</li>
              <li>✓ Share microphone for live conversations</li>
              <li>✓ Real-time audio broadcasting to multiple listeners</li>
              <li>✓ No installation required - works on desktop browsers</li>
            </ul>
          </div>
        </div>
      </GlowCard>
    </div>
  );
}
