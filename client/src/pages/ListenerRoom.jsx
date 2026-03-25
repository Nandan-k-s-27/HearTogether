import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../services/socket';
import { useListenerWebRTC } from '../hooks/useWebRTC';
import { getIceServers, pingServer } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { useToast, ToastContainer } from '../components/ui/toast';
import { SkeletonBox } from '../components/ui/skeleton';
import { debugLog, warnLog, errorLog } from '../lib/logger';

const QUICK_REACTIONS = ['❤️', '👍', '👎', '😭', '😍'];
const EXTRA_REACTIONS = ['👏', '🔥', '🎉', '😮', '🙏', '😂', '🤯', '💯'];

export default function ListenerRoom() {
  const { code: roomCode } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const toastRef = useRef(toast);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [status, setStatus] = useState('connecting'); // connecting | listening | paused | ended
  // connState tracks actual WebRTC ICE/DTLS state (not just socket signaling)
  const [connState, setConnState] = useState('new'); // new|connecting|connected|disconnected|failed|closed
  const [iceServersConfig, setIceServersConfig] = useState(null);
  const [selectedReaction, setSelectedReaction] = useState('');
  const [showExtraReactions, setShowExtraReactions] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
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

  const { handleOffer, handleIceCandidate, close, remoteStreamRef } = useListenerWebRTC(socket, {
    onTrackReady: () => {
      // Intentionally ignored: listener audio playback feature has been removed.
    },
    onConnectionState: setConnState,
    iceServersConfig,
  });
  const joinedRoomIdRef = useRef(null);
  const offerRetryTimerRef = useRef(null);
  const offerRetryAttemptsRef = useRef(0);

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
      close();
      socket.disconnect();
    };
  }, [iceReady, roomCode, navigate, close, clearOfferRetryTimer, clearDisconnectRecoveryTimer, remoteStreamRef]);

  // Keep Render awake: ping /api/health every 8 minutes.
  useEffect(() => {
    const id = setInterval(pingServer, 8 * 60 * 1000);
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
      close();
    };
    const onRemoved = () => {
      debugLog(`[ListenerRoom] removed by host`);
      setStatus('ended');
      clearOfferRetryTimer();
      close();
    };

    const onListenerCount = ({ listenerCount, maxListeners }) => {
      if (typeof listenerCount !== 'number') return;
      setRoomCapacity((prev) => ({
        listenerCount,
        maxListeners: typeof maxListeners === 'number'
          ? maxListeners
          : (prev?.maxListeners || 0),
      }));
    };

    const onSessionReplaced = () => {
      toastRef.current.warning('You were reconnected from another session. This tab will now close its connection.');
      clearOfferRetryTimer();
      clearDisconnectRecoveryTimer();
      close();
      socket.disconnect();
      navigate('/', { replace: true });
    };

    socket.on('signal:offer', onOffer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('host:paused', onPaused);
    socket.on('host:resumed', onResumed);
    socket.on('host:stopped', onStopped);
    socket.on('host:removed', onRemoved);
    socket.on('room:listener-count', onListenerCount);
    socket.on('session:replaced', onSessionReplaced);

    return () => {
      socket.off('signal:offer', onOffer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('host:paused', onPaused);
      socket.off('host:resumed', onResumed);
      socket.off('host:stopped', onStopped);
      socket.off('host:removed', onRemoved);
      socket.off('room:listener-count', onListenerCount);
      socket.off('session:replaced', onSessionReplaced);
    };
  }, [
    handleOffer,
    handleIceCandidate,
    close,
    clearOfferRetryTimer,
    clearDisconnectRecoveryTimer,
    navigate,
  ]);

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

  const handleLeave = () => {
    clearOfferRetryTimer();
    clearDisconnectRecoveryTimer();
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
    close(); // Close existing connection

    // Reload page after a short delay to reset everything cleanly
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }, [close]);

  const s = statusConfig[status];

  return (
    <div
      className="h-[100dvh] overflow-hidden px-3 py-3 md:px-6 md:py-4"
    >
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <GlowCard customSize glowColor="blue" className="mx-auto h-full w-full max-w-md text-center">
        <div className="flex h-full flex-col px-4 py-4 md:px-6 md:py-6">
          <h1 className="mb-4 text-center text-3xl font-bold md:mb-5 md:text-2xl">HearTogether</h1>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">

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

          {/* WebRTC connection state */}
          {status !== 'ended' && iceReady && (
            <div className={`mb-4 flex items-center justify-center gap-2 text-xs rounded-lg px-3 py-2 ${connState === 'connected'
                ? 'bg-green-900/40 text-green-300'
                : connState === 'failed'
                  ? 'bg-red-900/40 text-red-300'
                  : connState === 'disconnected'
                    ? 'bg-yellow-900/40 text-yellow-300'
                    : 'bg-gray-800/60 text-gray-400'
              }`}>
              <span className={`h-2 w-2 rounded-full ${connState === 'connected' ? 'bg-green-400' :
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

          {/* Actions */}
          {status !== 'ended' && (
            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 md:p-4">
              <p className="mb-4 text-xs uppercase tracking-wider text-gray-400 md:text-sm">React to host</p>

              <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => sendReaction(emoji)}
                    className={`rounded-lg border transition ${selectedReaction === emoji
                        ? 'border-brand-400 bg-brand-500/20'
                        : 'border-white/10 bg-black/20 hover:bg-white/10'
                      } px-3 py-1.5 text-lg md:px-4 md:py-3 md:text-2xl`}
                    style={{ touchAction: 'manipulation' }}
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowExtraReactions((v) => !v)}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm font-semibold text-gray-200 transition hover:bg-white/10 md:px-4 md:py-3 md:text-lg"
                  style={{ touchAction: 'manipulation' }}
                  aria-label="More reactions"
                >
                  +
                </button>
              </div>

              {showExtraReactions && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-3 md:gap-3">
                  {EXTRA_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => sendReaction(emoji)}
                      className={`rounded-lg border transition ${selectedReaction === emoji
                          ? 'border-brand-400 bg-brand-500/20'
                          : 'border-white/10 bg-black/20 hover:bg-white/10'
                        } px-3 py-1.5 text-lg md:px-4 md:py-3 md:text-2xl`}
                      style={{ touchAction: 'manipulation' }}
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {selectedReaction && (
                <p className="mt-3 text-xs text-gray-400 md:text-sm">
                  Your current reaction: <span className="text-base md:text-2xl">{selectedReaction}</span>
                </p>
              )}
            </div>
          )}

          {status !== 'ended' && (
            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 md:p-4">
              <button
                type="button"
                onClick={() => setShowChat((v) => !v)}
                className="w-full py-1 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 transition hover:text-gray-300 md:py-2 md:text-sm"
              >
                {showChat ? '▼ Message Host' : '▶ Message Host'}
              </button>
              {showChat && (
                <div className="mt-3 space-y-2 md:space-y-3">
                  <div className="flex flex-col gap-2 md:flex-row">
                    <input
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value.slice(0, 50))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder="Say something..."
                      className="flex-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-brand-400 focus:outline-none md:px-4 md:py-3 md:text-base"
                      maxLength="50"
                    />
                    <button
                      type="button"
                      onClick={sendMessage}
                      disabled={!chatMessage.trim()}
                      className="rounded-lg bg-brand-500/80 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 md:px-4 md:py-3 md:text-base"
                    >
                      Send
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 md:text-sm">{chatMessage.length}/50</p>
                </div>
              )}
            </div>
          )}
          </div>

          <div className="shrink-0 pt-2">
            {status === 'ended' ? (
              <ShimmerButton
                onClick={() => navigate('/', { replace: true })}
                background="rgba(76, 110, 245, 1)"
                shimmerColor="#ffffff"
                className="w-full py-3 text-base font-semibold dark:text-white md:py-4 md:text-lg"
              >
                Back to Home
              </ShimmerButton>
            ) : (
              <ShimmerButton
                onClick={handleLeave}
                background="rgba(20, 20, 30, 0.95)"
                shimmerColor="#5c7cfa"
                className="w-full py-3 text-base font-semibold dark:text-white md:py-4 md:text-lg"
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
