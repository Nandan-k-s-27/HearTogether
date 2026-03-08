import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../services/socket';
import { useListenerWebRTC } from '../hooks/useWebRTC';
import { getIceServers, pingServer } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';

export default function ListenerRoom() {
  const { roomId: roomCode } = useParams(); // roomId here is actually the room code
  const navigate = useNavigate();

  const [status, setStatus] = useState('connecting'); // connecting | listening | paused | ended
  const [volume, setVolume] = useState(1);
  // audioReady  → remote stream has arrived, waiting for user tap to play
  // audioPlaying → audio.play() succeeded, currently streaming
  const [audioReady, setAudioReady] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  // connState tracks actual WebRTC ICE/DTLS state (not just socket signaling)
  const [connState, setConnState] = useState('new'); // new|connecting|connected|disconnected|failed|closed
  const [iceServersConfig, setIceServersConfig] = useState(null);
  // iceReady gates the socket join — we must not emit listener:join until the
  // ICE servers fetch has settled.  If the offer arrives before iceRef is
  // updated the RTCPeerConnection is created with STUN-only and TURN relay
  // is never used, causing silent audio failure on cellular networks.
  const [iceReady, setIceReady] = useState(false);

  // Fetch TURN-capable ICE servers FIRST, then join the room.
  useEffect(() => {
    getIceServers()
      .then((data) => {
        if (data?.iceServers) setIceServersConfig({ iceServers: data.iceServers });
      })
      .finally(() => setIceReady(true)); // always unblock join, even on fetch failure
  }, []);

  const { handleOffer, handleIceCandidate, close, audioRef, remoteStreamRef } = useListenerWebRTC(socket, {
    onTrackReady: () => setAudioReady(true),
    onConnectionState: setConnState,
    iceServersConfig,
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

  // Connect & join room — gated on iceReady so TURN credentials are loaded
  // into iceRef before the host's offer arrives and creates the peer connection.
  useEffect(() => {
    if (!iceReady) return;
    if (!socket.connected) socket.connect();

    let retries = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // ms

    function tryJoin() {
      socket.emit('listener:join', { roomCode }, (res) => {
        if (res?.error) {
          // "Room not found" can happen when the server just restarted and the
          // host hasn't re-joined yet.  Retry a few times with backoff before
          // giving up and navigating home.
          if (res.error.includes('not found') && retries < MAX_RETRIES) {
            retries++;
            setTimeout(tryJoin, RETRY_DELAY * retries);
            return;
          }
          alert(res.error);
          navigate('/');
          return;
        }
        setStatus('listening');
      });
    }

    tryJoin();

    return () => {
      close();
      socket.disconnect();
    };
  }, [iceReady, roomCode, navigate, close]);

  // Keep Render awake: ping /api/health every 8 minutes.
  useEffect(() => {
    const id = setInterval(pingServer, 8 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

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

    socket.on('signal:offer', onOffer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('host:paused', onPaused);
    socket.on('host:resumed', onResumed);
    socket.on('host:stopped', onStopped);
    socket.on('host:removed', onRemoved);

    return () => {
      socket.off('signal:offer', onOffer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('host:paused', onPaused);
      socket.off('host:resumed', onResumed);
      socket.off('host:stopped', onStopped);
      socket.off('host:removed', onRemoved);
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

        {/* WebRTC connection state — shown while audio is not yet playing */}
        {!audioPlaying && status !== 'ended' && (
          <div className={`mb-4 flex items-center justify-center gap-2 text-xs rounded-lg px-3 py-2 ${
            connState === 'connected'
              ? 'bg-green-900/40 text-green-300'
              : connState === 'failed'
              ? 'bg-red-900/40 text-red-300'
              : connState === 'disconnected'
              ? 'bg-yellow-900/40 text-yellow-300'
              : 'bg-gray-800/60 text-gray-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              connState === 'connected' ? 'bg-green-400' :
              connState === 'failed' ? 'bg-red-400' :
              connState === 'disconnected' ? 'bg-yellow-400' :
              'bg-gray-500 animate-pulse'
            }`} />
            {connState === 'new' && 'Waiting for stream…'}
            {connState === 'connecting' && 'Connecting audio path…'}
            {connState === 'connected' && 'Audio path ready'}
            {connState === 'disconnected' && 'Connection interrupted, retrying…'}
            {connState === 'failed' && 'Connection failed — try reconnecting'}
            {connState === 'closed' && 'Connection closed'}
          </div>
        )}

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
        {audioPlaying && status === 'listening' && (
          <div className="mb-4 flex items-center justify-center gap-2 text-xs text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Connected
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
