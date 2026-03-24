import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomInfo } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { useAuth } from '../context/AuthContext';
import { errorLog } from '../lib/logger';

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, login, authBootState } = useAuth();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authHint, setAuthHint] = useState('');

  const maxListeners = room?.maxListeners ?? 30;
  const listenerCount = room?.listenerCount ?? 0;
  const isRoomFull = Boolean(room?.isFull || listenerCount >= maxListeners);

  useEffect(() => {
    if (!code) return;
    const upperCode = code.trim().toUpperCase();
    getRoomInfo(upperCode)
      .then(setRoom)
      .catch((err) => {
        errorLog('Room info error:', err);
        setError('Room not found or has ended.');
      })
      .finally(() => setLoading(false));
  }, [code]);

  const handleJoin = () => {
    if (isRoomFull) {
      setAuthHint(`Room is full (${listenerCount}/${maxListeners}). Please try again later.`);
      return;
    }
    if (!user) {
      setAuthHint('Please sign in to start listening.');
      return;
    }
    // Always navigate with the room CODE. ListenerRoom sends it to the server
    // which looks up the room by code (getRoomByCode).
    // replace: true prevents this join page from remaining in history.
    // After a session ends and user goes home, pressing back should exit/app-switch
    // instead of reopening stale room pages.
    navigate(`/listen/${code.trim().toUpperCase()}`, { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xl text-red-400">{error}</p>
        <ShimmerButton
          onClick={() => navigate('/')}
          background="rgba(20, 20, 30, 0.95)"
          shimmerColor="#5c7cfa"
          className="dark:text-white font-semibold"
        >
          ← Back to Home
        </ShimmerButton>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold">Join Room</h1>
      <GlowCard customSize glowColor="blue" className="max-w-sm w-full text-center">
        <div>
          <p className="mb-1 text-sm text-gray-400">Room Code</p>
          <p className="text-3xl font-mono font-bold tracking-widest text-brand-400">{code?.toUpperCase()}</p>
          <p className="mt-4 text-sm text-gray-400">
            {listenerCount}/{maxListeners} listeners connected
          </p>
          {isRoomFull && (
            <p className="mt-2 text-xs text-red-300">Room is full. You cannot enter right now.</p>
          )}
          <ShimmerButton
            onClick={handleJoin}
            background="rgba(76, 110, 245, 1)"
            shimmerColor="#ffffff"
            className="dark:text-white mt-6 w-full text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isRoomFull}
          >
            {isRoomFull ? 'Room Full' : 'Start Listening'}
          </ShimmerButton>
          {authHint && !user && (
            <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-300">
              <div className="flex items-center justify-center gap-2">
                <span>{authHint}</span>
                <button
                  onClick={() => login({ returnTo: `/listen/${code.trim().toUpperCase()}` })}
                  disabled={authBootState.active}
                  className="underline underline-offset-2 disabled:no-underline disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {authBootState.active ? 'Starting...' : 'Sign In'}
                </button>
              </div>
            </div>
          )}
        </div>
      </GlowCard>
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-white transition">
        ← Back to Home
      </button>
    </div>
  );
}
