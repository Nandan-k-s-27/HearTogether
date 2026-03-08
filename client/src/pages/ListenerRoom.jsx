import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../services/socket';
import { useListenerWebRTC } from '../hooks/useWebRTC';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';

export default function ListenerRoom() {
  const { roomId: roomCode } = useParams(); // roomId here is actually the room code
  const navigate = useNavigate();

  const [status, setStatus] = useState('connecting'); // connecting | listening | paused | ended
  const [volume, setVolume] = useState(1);
  const [syncOffset, setSyncOffset] = useState(0);
  // audioReady  → remote stream has arrived, waiting for user tap to play
  // audioPlaying → audio.play() succeeded, currently streaming
  const [audioReady, setAudioReady] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const { handleOffer, handleIceCandidate, close, audioRef, remoteStreamRef } = useListenerWebRTC(socket, {
    onTrackReady: () => setAudioReady(true),
  });
  const audioElRef = useRef(null);

  // Stable callback ref — using useCallback avoids React's detach-reattach
  // cycle on every re-render, which would briefly set audioRef.current = null
  // and miss an ontrack event arriving in that window.
  const setAudioEl = useCallback((el) => {
    audioElRef.current = el;
    audioRef.current = el;
    // If the stream arrived before the element mounted, attach it now.
    if (el && remoteStreamRef.current && !el.srcObject) {
      el.srcObject = remoteStreamRef.current;
      el.muted = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by the "Tap to Hear" button — runs inside a real user-gesture context
  // so audio.play() is guaranteed to succeed on all mobile browsers.
  const handleStartAudio = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    // Safety net: wire up srcObject if ontrack fired while element was unmounted.
    if (!audio.srcObject && remoteStreamRef.current) {
      audio.srcObject = remoteStreamRef.current;
    }
    audio.muted = false;
    audio.volume = volume;
    audio
      .play()
      .then(() => {
        setAudioReady(false);
        setAudioPlaying(true);
      })
      .catch((err) => {
        // Should never reach here inside a gesture handler, but log just in case.
        console.error('[HearTogether] play() failed:', err.name, err.message);
      });
  }, [volume, remoteStreamRef]);

  // Connect & join room
  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.emit('listener:join', { roomCode }, (res) => {
      if (res?.error) {
        alert(res.error);
        navigate('/');
        return;
      }
      setStatus('listening');
    });

    return () => {
      close();
      socket.disconnect();
    };
  }, [roomCode, navigate, close]);

  // Signaling events
  useEffect(() => {
    const onOffer = ({ from, offer }) => {
      handleOffer(from, offer);
      setStatus('listening');
    };

    const onIce = ({ from, candidate }) => handleIceCandidate(from, candidate);

    const onPaused = () => setStatus('paused');
    const onResumed = () => setStatus('listening');
    const onStopped = () => {
      setStatus('ended');
      close();
    };
    const onRemoved = () => {
      setStatus('ended');
      close();
    };

    // Sync correction
    const onSync = ({ timestamp, serverTime }) => {
      const now = Date.now();
      const offset = now - serverTime;
      setSyncOffset(offset);
    };

    socket.on('signal:offer', onOffer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('host:paused', onPaused);
    socket.on('host:resumed', onResumed);
    socket.on('host:stopped', onStopped);
    socket.on('host:removed', onRemoved);
    socket.on('sync:timestamp', onSync);

    return () => {
      socket.off('signal:offer', onOffer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('host:paused', onPaused);
      socket.off('host:resumed', onResumed);
      socket.off('host:stopped', onStopped);
      socket.off('host:removed', onRemoved);
      socket.off('sync:timestamp', onSync);
    };
  }, [handleOffer, handleIceCandidate, close]);

  const handleLeave = () => {
    close();
    socket.disconnect();
    navigate('/');
  };

  const statusConfig = {
    connecting: { color: 'text-yellow-400', icon: '⏳', label: 'Connecting…' },
    listening: { color: 'text-green-400', icon: '🎵', label: 'Listening' },
    paused: { color: 'text-yellow-400', icon: '⏸️', label: 'Paused by Host' },
    ended: { color: 'text-red-400', icon: '⏹️', label: 'Session Ended' },
  };

  const s = statusConfig[status];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <GlowCard customSize glowColor="blue" className="w-full max-w-md text-center">
        <h1 className="mb-6 text-2xl font-bold">🎧 HearTogether</h1>

        {/* Status */}
        <div className="mb-6">
          <div className="text-5xl mb-2">{s.icon}</div>
          <p className={`text-lg font-semibold ${s.color}`}>{s.label}</p>
          <p className="mt-1 text-sm text-gray-500 font-mono">Room: {roomCode?.toUpperCase()}</p>
        </div>

        {/* Hidden audio element — playback triggered by user tap, not autoplay */}
        <audio ref={setAudioEl} playsInline muted />

        {/* ── "Tap to play" button ──────────────────────────────────────────
            Shown as soon as the remote stream arrives.
            Must be a real tap/click so mobile browsers allow audio.play().   */}
        {audioReady && !audioPlaying && (
          <button
            onClick={handleStartAudio}
            className="mb-6 w-full rounded-xl bg-brand-500 py-4 text-lg font-bold text-white shadow-lg animate-pulse hover:animate-none hover:bg-brand-600 active:scale-95 transition-transform"
          >
            🔊 Tap to Hear Audio
          </button>
        )}

        {/* Volume — only shown once playback has actually started */}
        {audioPlaying && status !== 'ended' && (
          <div className="mb-6">
            <label className="mb-2 block text-sm text-gray-400">Volume</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (audioElRef.current) audioElRef.current.volume = v;
              }}
              className="w-full accent-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">{Math.round(volume * 100)}%</p>
          </div>
        )}

        {/* Sync indicator */}
        {status === 'listening' && (
          <div className="mb-6 flex items-center justify-center gap-2 text-sm text-gray-400">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Sync offset: {syncOffset}ms
          </div>
        )}

        {/* Connection quality visual */}
        {status === 'listening' && (
          <div className="mb-6 flex items-center justify-center gap-1">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className={`w-2 rounded-sm ${
                  i < (Math.abs(syncOffset) < 100 ? 4 : Math.abs(syncOffset) < 300 ? 3 : 2)
                    ? 'bg-green-500'
                    : 'bg-gray-700'
                }`}
                style={{ height: `${(i + 1) * 6}px` }}
              />
            ))}
            <span className="ml-2 text-xs text-gray-500">Connection</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {status === 'ended' ? (
            <ShimmerButton
              onClick={() => navigate('/')}
              background="rgba(76, 110, 245, 1)"
              shimmerColor="#ffffff"
              className="dark:text-white w-full font-semibold"
            >
              Back to Home
            </ShimmerButton>
          ) : (
            <ShimmerButton
              onClick={handleLeave}
              background="rgba(20, 20, 30, 0.95)"
              shimmerColor="#5c7cfa"
              className="dark:text-white w-full font-semibold"
            >
              Leave Room
            </ShimmerButton>
          )}
        </div>
      </GlowCard>
    </div>
  );
}
