import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomInfo } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRoomInfo(code)
      .then(setRoom)
      .catch(() => setError('Room not found or has ended.'))
      .finally(() => setLoading(false));
  }, [code]);

  const handleJoin = () => {
    navigate(`/listen/${code}`);
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
            {room?.listenerCount ?? 0} listener{room?.listenerCount !== 1 ? 's' : ''} connected
          </p>
          <ShimmerButton
            onClick={handleJoin}
            background="rgba(76, 110, 245, 1)"
            shimmerColor="#ffffff"
            className="dark:text-white mt-6 w-full text-lg font-semibold"
          >
            Start Listening
          </ShimmerButton>
        </div>
      </GlowCard>
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-white transition">
        ← Back to Home
      </button>
    </div>
  );
}
