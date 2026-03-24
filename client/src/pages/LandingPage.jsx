import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../services/api';
import InteractiveWavesBackground from '../components/InteractiveWavesBackground';
import { Component as DockBar } from '../components/ui/docks';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { UserProfile } from '../components/UserProfile';
import ManualNavLink from '../components/ManualNavLink';
import { useAuth } from '../context/AuthContext';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, login, authBootState } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [authHint, setAuthHint] = useState('');

  const handleCreate = async () => {
    if (!user) {
      setAuthHint('Please sign in to create a room.');
      return;
    }
    setLoading(true);
    try {
      const { id } = await createRoom();
      navigate(`/host/${id}`);
    } catch {
      alert('Failed to create room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!user) {
      setAuthHint('Please sign in to join a room.');
      return;
    }
    const code = joinCode.trim().toUpperCase();
    if (code) navigate(`/room/${code}`);
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Interactive waves background */}
      <InteractiveWavesBackground
        lineColor="rgba(92, 124, 250, 0.15)"
        backgroundColor="transparent"
        waveSpeedX={0.02}
        waveSpeedY={0.01}
        waveAmpX={40}
        waveAmpY={20}
        friction={0.9}
        tension={0.01}
        maxCursorMove={120}
        xGap={12}
        yGap={36}
      />

      {/* Nav */}
      <nav className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-4 md:px-12">
        <div className="flex items-center gap-2 text-xl font-bold">
          HearTogether
        </div>
        <div className="flex w-full sm:w-auto items-center justify-end gap-2 sm:gap-4 flex-wrap">
          <UserProfile />
          <ManualNavLink />
          <DockBar />
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl md:text-6xl">
          Listen <span className="text-brand-400">Together</span>,<br />Anywhere
        </h1>

        <p className="mt-4 max-w-xl text-lg text-gray-500 dark:text-gray-400">
          Stream audio from one device to everyone's headphones in real time.
          No Bluetooth pairing, no extra hardware — just the web.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <ShimmerButton
            onClick={handleCreate}
            disabled={loading}
            background="rgba(76, 110, 245, 1)"
            shimmerColor="#ffffff"
            className="dark:text-white text-lg font-semibold px-8"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </ShimmerButton>

          <form onSubmit={handleJoin} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Enter room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={10}
              className="w-40 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5 px-4 py-3 text-center text-gray-900 dark:text-white font-mono uppercase tracking-widest placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand-500 focus:outline-none transition-colors"
            />
            <ShimmerButton
              type="submit"
              background="rgba(20, 20, 30, 0.95)"
              shimmerColor="#5c7cfa"
              className="dark:text-white font-semibold"
            >
              Join
            </ShimmerButton>
          </form>
        </div>

        {authHint && !user && (
          <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
            <div className="flex items-center gap-3">
              <span>{authHint}</span>
              <button
                onClick={() => login()}
                disabled={authBootState.active}
                className="rounded-md bg-yellow-400/20 px-3 py-1 text-yellow-200 hover:bg-yellow-400/30 transition disabled:cursor-not-allowed disabled:opacity-70"
              >
                {authBootState.active ? 'Starting...' : 'Sign In'}
              </button>
            </div>
          </div>
        )}

        {/* How it works */}
        <section className="mt-24 w-full max-w-4xl">
          <h2 className="mb-10 text-2xl font-bold">How It Works</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <StepCard step="1" title="Create a Room" desc="Click Create Room to start a listening session from your device." />
            <StepCard step="2" title="Share the Code" desc="Share the QR code or room link with anyone who wants to listen." />
            <StepCard step="3" title="Listen Together" desc="Everyone hears the same audio through their own headphones, in sync." />
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-200 dark:border-white/5 py-6 text-center text-sm text-gray-500 dark:text-gray-500">
        © {new Date().getFullYear()} HearTogether. Built for shared listening.
      </footer>
    </div>
  );
}

function StepCard({ step, title, desc }) {
  return (
    <GlowCard customSize glowColor="blue" className="w-full text-left">
      <div>
        <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-600/20 text-sm font-bold text-brand-400">
          {step}
        </span>
        <h3 className="mt-2 font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{desc}</p>
      </div>
    </GlowCard>
  );
}


