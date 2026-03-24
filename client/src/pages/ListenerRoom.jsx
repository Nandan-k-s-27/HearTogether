import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../services/socket';
import { useListenerWebRTC } from '../hooks/useWebRTC';
import { useAudioPlaybackController } from '../hooks/useAudioPlaybackController';
import { useOrientationLock, useWakeLock, isMobileDevice } from '../hooks/useMobile';
import { getIceServers, pingServer } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { useToast, ToastContainer } from '../components/ui/toast';
import { SkeletonBox, SkeletonButton } from '../components/ui/skeleton';
import { debugLog, warnLog, errorLog } from '../lib/logger';

const QUICK_REACTIONS = ['❤️', '👍', '👎', '😭', '😍'];
const EXTRA_REACTIONS = ['👏', '🔥', '🎉', '😮', '🙏', '😂', '🤯', '💯'];

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ListenerRoom() {
  const { code: roomCode } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const toastRef = useRef(toast);
  const { lockPortrait, unlockOrientation } = useOrientationLock();
  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  const isMobile = isMobileDevice();
  const { playbackState, controller } = useAudioPlaybackController();

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [status, setStatus] = useState('connecting'); // connecting | listening | paused | ended
  const [volume, setVolume] = useState(1);
  // audioReady  → remote stream has arrived, waiting for user tap to play
  const [audioReady, setAudioReady] = useState(false);
  const audioPlaying = playbackState.isPlaying;
  // connState tracks actual WebRTC ICE/DTLS state (not just socket signaling)
  const [connState, setConnState] = useState('new'); // new|connecting|connected|disconnected|failed|closed
  const [iceServersConfig, setIceServersConfig] = useState(null);
  const [selectedReaction, setSelectedReaction] = useState('');
  const [showExtraReactions, setShowExtraReactions] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [sessionLimitMs, setSessionLimitMs] = useState(60 * 60 * 1000);
  const [sessionRemainingSec, setSessionRemainingSec] = useState(null);
  // iceReady gates the socket join — we must not emit listener:join until the
  // ICE servers fetch has settled.  If the offer arrives before iceRef is
  // updated the RTCPeerConnection is created with STUN-only and TURN relay
  // is never used, causing silent audio failure on cellular networks.
  const [iceReady, setIceReady] = useState(false);

  // Error & retry states
  const [connError, setConnError] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(null);
  const prevConnStateRef = useRef('new');
  const disconnectRecoveryTimerRef = useRef(null);
  const sessionExpiryMsRef = useRef(null);

  // Fetch TURN-capable ICE servers FIRST, then join the room.
  useEffect(() => {
    debugLog(`[ListenerRoom] fetching ICE servers`);
    getIceServers()
      .then((data) => {
        if (data?.iceServers) {
          debugLog(`[ListenerRoom] ICE servers loaded:`, data.iceServers);
          const turnCount = data.iceServers.filter(s => s.urls.toLowerCase().includes('turn')).length;
          const stunCount = data.iceServers.filter(s => s.urls.toLowerCase().includes('stun')).length;
          debugLog(`[ListenerRoom] STUN=${stunCount}, TURN=${turnCount}`);
          setIceServersConfig({ iceServers: data.iceServers });
        } else {
          warnLog(`[ListenerRoom] no iceServers in response`);
          // Still allow connection with default STUN servers
        }
      })
      .catch((err) => {
        errorLog(`[ListenerRoom] failed to fetch ICE servers:`, err);
        toastRef.current.warning('Connection may be slower without relay servers');
      })
      .finally(() => {
        debugLog(`[ListenerRoom] setting iceReady=true`);
        setIceReady(true);
      });
  }, []);

  const { handleOffer, handleIceCandidate, close, audioRef, remoteStreamRef } = useListenerWebRTC(socket, {
    onTrackReady: (stream) => {
      controller.setStream(stream);
      setAudioReady(true);
    },
    onConnectionState: setConnState,
    iceServersConfig,
  });
  const joinedRoomIdRef = useRef(null);
  const offerRetryTimerRef = useRef(null);
  const offerRetryAttemptsRef = useRef(0);

  useEffect(() => {
    if (typeof playbackState.volume === 'number' && Math.abs(playbackState.volume - volume) > 0.001) {
      setVolume(playbackState.volume);
    }
  }, [playbackState.volume, volume]);

  useEffect(() => {
    if (audioPlaying) {
      setAudioReady(false);
    }
  }, [audioPlaying]);

  useEffect(() => {
    const normalizedRoomCode = roomCode?.toUpperCase();
    controller.setMetadata({
      title: normalizedRoomCode ? `HearTogether Room ${normalizedRoomCode}` : 'HearTogether Live Stream',
      artist: 'HearTogether',
      album: 'Live Audio Session',
    });
  }, [controller, roomCode]);

  const clearOfferRetryTimer = useCallback(() => {
    if (offerRetryTimerRef.current) {
      clearInterval(offerRetryTimerRef.current);
      offerRetryTimerRef.current = null;
    }
    offerRetryAttemptsRef.current = 0;
  }, []);

  const clearDisconnectRecoveryTimer = useCallback(() => {
    if (disconnectRecoveryTimerRef.current) {
      clearTimeout(disconnectRecoveryTimerRef.current);
      disconnectRecoveryTimerRef.current = null;
    }
  }, []);

  // Stable callback ref — using useCallback avoids React's detach-reattach
  // cycle on every re-render, which would briefly set audioRef.current = null
  // and miss an ontrack event arriving in that window.
  const setAudioEl = useCallback((el) => {
    audioRef.current = el;
    controller.attachAudioElement(el);
    // If the stream arrived before the element mounted, attach it now.
    if (el && remoteStreamRef.current) {
      controller.setStream(remoteStreamRef.current);
    }
  }, [audioRef, controller, remoteStreamRef]);

  // Called by the "Tap to Hear" button — runs inside a real user-gesture context
  // so audio.play() is guaranteed to succeed on all mobile browsers.
  const handleStartAudio = useCallback(async () => {
    if (remoteStreamRef.current) {
      controller.setStream(remoteStreamRef.current);
    }
    controller.setVolume(volume);
    const started = await controller.play();
    if (started) {
      setAudioReady(false);
    }
  }, [controller, remoteStreamRef, volume]);

  // Connect & join room — gated on iceReady so TURN credentials are loaded
  // into iceRef before the host's offer arrives and creates the peer connection.
  useEffect(() => {
    if (!iceReady) return;
    if (!socket.connected) socket.connect();

    let retries = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1200; // ms

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
          if (String(res.error).toLowerCase().includes('full')) {
            setJoinError(res.error);
            setStatus('ended');
            toastRef.current.error(res.error);
            return;
          }
          toastRef.current.error(res.error || 'Could not join this room');
          // replace: true removes this room URL from history so pressing back
          // from home does not re-mount this component and attempt reconnect.
          navigate('/', { replace: true });
          return;
        }
        setStatus('listening');
        setJoinError('');
        joinedRoomIdRef.current = res.roomId;
        if (typeof res.listenerCount === 'number' && typeof res.maxListeners === 'number') {
          setRoomCapacity({ listenerCount: res.listenerCount, maxListeners: res.maxListeners });
        }
        if (typeof res.sessionLimitMs === 'number' && res.sessionLimitMs > 0) {
          setSessionLimitMs(res.sessionLimitMs);
        }

        // Recovery path: if first offer gets missed due to timing, ask host
        // to resend it a few times while still waiting for a remote track.
        clearOfferRetryTimer();
        offerRetryTimerRef.current = setInterval(() => {
          const roomId = joinedRoomIdRef.current;
          const hasTrack = Boolean(remoteStreamRef.current);
          if (!roomId || hasTrack) {
            clearOfferRetryTimer();
            return;
          }
          offerRetryAttemptsRef.current += 1;
          if (offerRetryAttemptsRef.current > 8) {
            clearOfferRetryTimer();
            return;
          }
          debugLog(`[ListenerRoom] no remote track yet, requesting offer retry #${offerRetryAttemptsRef.current}`);
          socket.emit('listener:request-offer', { roomId });
        }, 1200);
      });
    }

    tryJoin();

    return () => {
      clearOfferRetryTimer();
      clearDisconnectRecoveryTimer();
      joinedRoomIdRef.current = null;
      controller.stop();
      close();
      socket.disconnect();
    };
  }, [iceReady, roomCode, navigate, close, clearOfferRetryTimer, clearDisconnectRecoveryTimer, remoteStreamRef, controller]);

  // Keep Render awake: ping /api/health every 8 minutes.
  useEffect(() => {
    const id = setInterval(pingServer, 8 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const updateCountdown = () => {
      if (!sessionExpiryMsRef.current) return;
      const remainingSec = Math.max(0, Math.ceil((sessionExpiryMsRef.current - Date.now()) / 1000));
      setSessionRemainingSec(remainingSec);
    };

    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, []);

  // Signaling events
  useEffect(() => {
    const onOffer = ({ from, offer }) => {
      debugLog(`[ListenerRoom] received offer from ${from}`);
      clearOfferRetryTimer();
      handleOffer(from, offer);
      setStatus('listening');
    };

    const onIce = ({ from, candidate }) => {
      debugLog(`[ListenerRoom] received ice-candidate from ${from}`);
      handleIceCandidate(from, candidate);
    };

    const onPaused = () => {
      debugLog(`[ListenerRoom] host paused`);
      setStatus('paused');
    };
    const onResumed = () => {
      debugLog(`[ListenerRoom] host resumed`);
      setStatus('listening');
    };
    const onStopped = () => {
      debugLog(`[ListenerRoom] host stopped`);
      setStatus('ended');
      clearOfferRetryTimer();
      controller.stop();
      close();
    };
    const onRemoved = () => {
      debugLog(`[ListenerRoom] removed by host`);
      setStatus('ended');
      clearOfferRetryTimer();
      controller.stop();
      close();
    };

    const onSyncTimestamp = ({ sessionStartedAt, sessionLimitMs: syncedLimitMs }) => {
      if (!sessionStartedAt || !Number.isFinite(sessionStartedAt)) return;
      const effectiveLimit = Number.isFinite(syncedLimitMs) && syncedLimitMs > 0 ? syncedLimitMs : sessionLimitMs;
      const expiry = Number(sessionStartedAt) + Number(effectiveLimit);
      if (!Number.isFinite(expiry)) return;

      sessionExpiryMsRef.current = expiry;
      setSessionLimitMs(Number(effectiveLimit));
      setSessionRemainingSec(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
    };

    socket.on('signal:offer', onOffer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('host:paused', onPaused);
    socket.on('host:resumed', onResumed);
    socket.on('host:stopped', onStopped);
    socket.on('host:removed', onRemoved);
    socket.on('sync:timestamp', onSyncTimestamp);

    return () => {
      socket.off('signal:offer', onOffer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('host:paused', onPaused);
      socket.off('host:resumed', onResumed);
      socket.off('host:stopped', onStopped);
      socket.off('host:removed', onRemoved);
      socket.off('sync:timestamp', onSyncTimestamp);
    };
  }, [handleOffer, handleIceCandidate, close, clearOfferRetryTimer, controller, sessionLimitMs]);

  // Monitor connection state for errors
  useEffect(() => {
    if (prevConnStateRef.current === connState) return;
    prevConnStateRef.current = connState;

    if (connState === 'failed') {
      clearDisconnectRecoveryTimer();
      setConnError('WebRTC connection failed. ICE negotiation could not establish a path.');
      toastRef.current.error('Connection failed - try leaving and rejoining the room');
    } else if (connState === 'disconnected') {
      setConnError('Connection interrupted. Attempting to recover…');
      toastRef.current.warning('Connection lost, trying to reconnect');

      clearDisconnectRecoveryTimer();
      disconnectRecoveryTimerRef.current = setTimeout(() => {
        const roomId = joinedRoomIdRef.current;
        if (!roomId || connState === 'connected') return;
        debugLog('[ListenerRoom] disconnected persisted, requesting fresh offer');
        socket.emit('listener:request-offer', { roomId });
      }, 1200);
    } else if (connState === 'connected') {
      clearDisconnectRecoveryTimer();
      setConnError(null);
    }
  }, [connState, clearDisconnectRecoveryTimer]);

  // Mobile: Lock orientation and manage screen wake lock during listening
  useEffect(() => {
    if (!audioPlaying) {
      releaseWakeLock();
      unlockOrientation();
      return;
    }

    // When audio starts playing on mobile, lock to portrait and request wake lock
    if (isMobile) {
      lockPortrait();
      requestWakeLock();
    }
  }, [audioPlaying, isMobile, lockPortrait, unlockOrientation, requestWakeLock, releaseWakeLock]);

  const handleLeave = () => {
    clearOfferRetryTimer();
    clearDisconnectRecoveryTimer();
    controller.stop();
    close();
    socket.disconnect();
    // replace: true removes this room URL from history so pressing the device
    // back button from home does not land back here and attempt reconnect.
    navigate('/', { replace: true });
  };

  const sendReaction = (reaction) => {
    const emoji = String(reaction || '').trim();
    if (!emoji || status === 'ended') return;
    setSelectedReaction(emoji);
    socket.emit('listener:reaction', { reaction: emoji });
    setShowExtraReactions(false);
  };

  const sendMessage = () => {
    const text = chatMessage.trim();
    if (!text || status === 'ended') return;
    socket.emit('listener:send-message', { text });
    setChatMessage('');
  };

  const statusConfig = {
    connecting: { color: 'text-yellow-400', label: 'Connecting…' },
    listening: { color: 'text-green-400', label: 'Listening' },
    paused: { color: 'text-yellow-400', label: 'Paused by Host' },
    ended: { color: 'text-red-400', label: 'Session Ended' },
  };

  const handleRetry = useCallback(() => {
    setIsRetrying(true);
    setConnError(null);
    controller.stop();
    close(); // Close existing connection
    
    // Reload page after a short delay to reset everything cleanly
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }, [close, controller]);

  const s = statusConfig[status];

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-start md:justify-center overflow-y-auto px-4 md:px-6 py-6 md:py-0"
      style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
    >
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <GlowCard customSize glowColor="blue" className="w-full max-w-md text-center">
        <div className={isMobile ? 'px-4 py-6' : 'px-6 py-8'}>
          <h1 className={`font-bold text-center ${isMobile ? 'text-3xl mb-8' : 'text-2xl mb-6'}`}>HearTogether</h1>

        {/* Status — hidden while the socket is still joining (connects near-
            instantly so showing a 'Connecting' flash is more confusing than
            helpful; the connState pill below already covers ICE progress). */}
        {status !== 'connecting' && (
          <div className="mb-6">
            <p className={`text-lg font-semibold ${s.color}`}>{s.label}</p>
            <p className="mt-1 text-sm text-gray-500 font-mono">Room: {roomCode?.toUpperCase()}</p>
            {roomCapacity && (
              <p className="mt-1 text-xs text-gray-400">Listeners: {roomCapacity.listenerCount}/{roomCapacity.maxListeners}</p>
            )}
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Session Remaining</p>
              <p className={`font-mono text-base font-semibold ${
                sessionRemainingSec === null
                  ? 'text-gray-300'
                  : sessionRemainingSec <= 60
                  ? 'text-red-300'
                  : sessionRemainingSec <= 5 * 60
                  ? 'text-yellow-300'
                  : 'text-blue-300'
              }`}>
                {sessionRemainingSec === null ? 'Waiting for host timer…' : formatDuration(sessionRemainingSec)}
              </p>
              <p className="text-[10px] text-gray-500">
                Session limit: {Math.floor(sessionLimitMs / 60000)} min
              </p>
            </div>
          </div>
        )}
        {status === 'connecting' && (
          <div className="mb-6">
            {!iceReady ? (
              <div className="space-y-2">
                <SkeletonBox height="h-6" width="w-32" />
                <p className="text-sm text-gray-500 font-mono">Room: {roomCode?.toUpperCase()}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 font-mono">Room: {roomCode?.toUpperCase()}</p>
            )}
          </div>
        )}

        {/* ICE/TURN loading state */}
        {!iceReady && (
          <div className="mb-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Initializing…</p>
            <SkeletonBox height="h-10" />
          </div>
        )}

        {/* Connection error state */}
        {connError && !isRetrying && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 space-y-3">
            <div>
              <p className="text-sm font-semibold text-red-300">⚠️ Connection Issue</p>
              <p className="text-xs text-red-200 mt-1">{connError}</p>
            </div>
            <button
              onClick={handleRetry}
              className="w-full rounded-lg bg-red-600/40 hover:bg-red-600/60 px-3 py-2 text-xs font-semibold text-red-100 transition"
            >
              Retry Connection
            </button>
          </div>
        )}

        {joinError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 space-y-3">
            <div>
              <p className="text-sm font-semibold text-red-300">Room is full</p>
              <p className="text-xs text-red-200 mt-1">{joinError}</p>
            </div>
            <ShimmerButton
              onClick={() => navigate(`/join/${roomCode?.toUpperCase()}`, { replace: true })}
              background="rgba(20, 20, 30, 0.95)"
              shimmerColor="#5c7cfa"
              className="dark:text-white w-full font-semibold"
            >
              Back to Join Page
            </ShimmerButton>
          </div>
        )}

        {/* WebRTC connection state — shown while audio is not yet playing */}
        {!audioPlaying && status !== 'ended' && iceReady && (
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

        {/* Hidden audio element — playback triggered by user tap, not autoplay.
            Do NOT set the HTML muted attribute here — some mobile browsers
            (especially iOS Safari) treat a muted HTML attribute as sticky and
            refuse to unmute via JS.  The element starts silent because it has
            no srcObject; handleStartAudio() calls play() inside a user gesture. */}
        <audio ref={setAudioEl} playsInline />

        {/* Shown as soon as the remote stream arrives.
            Must be a real tap/click so mobile browsers allow audio.play(). */}
        {audioReady && !audioPlaying && (
          <ShimmerButton
            onClick={handleStartAudio}
            background="rgba(76, 110, 245, 1)"
            shimmerColor="#ffffff"
            className={`dark:text-white mb-6 w-full font-semibold ${isMobile ? 'py-4 text-xl' : 'py-3 text-lg'}`}
          >
            Tap to Hear
          </ShimmerButton>
        )}

        {/* Loading state while waiting for audio to be ready */}
        {!audioReady && !audioPlaying && iceReady && status === 'listening' && (
          <div className={`mb-6 ${isMobile ? 'h-14' : 'h-10'}`}>
            <SkeletonButton />
          </div>
        )}

        {/* Volume — only shown once playback has actually started */}
        {audioPlaying && status !== 'ended' && (
          <div className={`mb-6 ${isMobile ? 'space-y-3' : 'space-y-2'}`}>
            <label className={`block text-gray-400 ${isMobile ? 'text-base' : 'text-sm'}`}>Volume</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                controller.setVolume(v);
              }}
              className={`w-full accent-brand-500 ${isMobile ? 'h-2' : 'h-1'}`}
              style={{ WebkitAppearance: 'slider-horizontal' }}
            />
            <p className={`text-gray-500 ${isMobile ? 'text-sm' : 'text-xs'}`}>{Math.round(volume * 100)}%</p>
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
        {status !== 'ended' && (
          <div className={`mb-4 rounded-xl border border-white/10 bg-white/5 ${isMobile ? 'p-4' : 'p-3'}`}>
            <p className={`mb-4 uppercase tracking-wider text-gray-400 ${isMobile ? 'text-sm' : 'text-xs'}`}>React to host</p>

            <div className={`flex flex-wrap items-center justify-center ${isMobile ? 'gap-3' : 'gap-2'}`}>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => sendReaction(emoji)}
                  className={`rounded-lg border transition ${
                    selectedReaction === emoji
                      ? 'border-brand-400 bg-brand-500/20'
                      : 'border-white/10 bg-black/20 hover:bg-white/10'
                  } ${isMobile ? 'px-4 py-3 text-2xl' : 'px-3 py-1.5 text-lg'}`}
                  style={{ touchAction: 'manipulation' }}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setShowExtraReactions((v) => !v)}
                className={`rounded-lg border border-white/10 bg-black/20 font-semibold text-gray-200 transition hover:bg-white/10 ${
                  isMobile ? 'px-4 py-3 text-lg' : 'px-3 py-1.5 text-sm'
                }`}
                style={{ touchAction: 'manipulation' }}
                aria-label="More reactions"
              >
                +
              </button>
            </div>

            {showExtraReactions && (
              <div className={`border-t border-white/10 pt-3 mt-3 flex flex-wrap items-center justify-center ${isMobile ? 'gap-3' : 'gap-2'}`}>
                {EXTRA_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => sendReaction(emoji)}
                    className={`rounded-lg border transition ${
                      selectedReaction === emoji
                        ? 'border-brand-400 bg-brand-500/20'
                        : 'border-white/10 bg-black/20 hover:bg-white/10'
                    } ${isMobile ? 'px-4 py-3 text-2xl' : 'px-3 py-1.5 text-lg'}`}
                    style={{ touchAction: 'manipulation' }}
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {selectedReaction && (
              <p className={`mt-3 text-gray-400 ${isMobile ? 'text-sm' : 'text-xs'}`}>
                Your current reaction: <span className={isMobile ? 'text-2xl' : 'text-base'}>{selectedReaction}</span>
              </p>
            )}
          </div>
        )}

        {status !== 'ended' && (
          <div className={`mb-4 rounded-xl border border-white/10 bg-white/5 ${isMobile ? 'p-4' : 'p-3'}`}>
            <button 
              type="button" 
              onClick={() => setShowChat((v) => !v)} 
              className={`w-full text-left uppercase tracking-wider text-gray-400 hover:text-gray-300 transition font-semibold ${
                isMobile ? 'text-sm py-2' : 'text-xs py-1'
              }`}
            >
              {showChat ? '▼ Message Host' : '▶ Message Host'}
            </button>
            {showChat && (
              <div className={`mt-3 space-y-2 ${isMobile ? 'space-y-3' : 'space-y-2'}`}>
                <div className={`flex gap-2 ${isMobile ? 'flex-col' : ''}`}>
                  <input 
                    type="text" 
                    value={chatMessage} 
                    onChange={(e) => setChatMessage(e.target.value.slice(0, 50))} 
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} 
                    placeholder="Say something..." 
                    className={`rounded-lg border border-white/20 bg-black/40 text-white placeholder-gray-500 focus:outline-none focus:border-brand-400 ${
                      isMobile 
                        ? 'px-4 py-3 text-base flex-1' 
                        : 'px-3 py-2 text-xs'
                    }` } 
                    maxLength="50" 
                  />
                  <button 
                    type="button" 
                    onClick={sendMessage} 
                    disabled={!chatMessage.trim()} 
                    className={`rounded-lg bg-brand-500/80 font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed ${
                      isMobile 
                        ? 'px-4 py-3 text-base' 
                        : 'px-3 py-2 text-xs'
                    }` }
                  >
                    Send
                  </button>
                </div>
                <p className={`text-gray-500 ${isMobile ? 'text-sm' : 'text-xs'}`}>{chatMessage.length}/50</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {status === 'ended' ? (
            <ShimmerButton
              onClick={() => navigate('/', { replace: true })}
              background="rgba(76, 110, 245, 1)"
              shimmerColor="#ffffff"
              className={`dark:text-white w-full font-semibold ${isMobile ? 'py-4 text-lg' : 'py-3 text-base'}`}
            >
              Back to Home
            </ShimmerButton>
          ) : (
            <ShimmerButton
              onClick={handleLeave}
              background="rgba(20, 20, 30, 0.95)"
              shimmerColor="#5c7cfa"
              className={`dark:text-white w-full font-semibold ${isMobile ? 'py-4 text-lg' : 'py-3 text-base'}`}
            >
              Leave Room
            </ShimmerButton>
          )}
        </div>
        </div>
      </GlowCard>
    </div>
  );
}
