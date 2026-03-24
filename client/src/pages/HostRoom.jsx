import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../services/socket';
import { useHostWebRTC } from '../hooks/useWebRTC';
import { getIceServers, pingServer } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { UserProfile } from '../components/UserProfile';
import { useToast, ToastContainer } from '../components/ui/toast';
import { debugLog, errorLog } from '../lib/logger';

const CAPTURE_OPTIONS = [
  { id: 'display', label: 'System Audio (Tab / Window / Screen)', desc: 'Share audio from a browser tab, app window, or entire screen' },
  { id: 'mic', label: 'Microphone', desc: 'Broadcast live microphone input' },
];

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function HostRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [roomCode, setRoomCode] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [listeners, setListeners] = useState([]);
  const [stream, setStream] = useState(null);
  const [iceServersConfig, setIceServersConfig] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [listenerConnStates, setListenerConnStates] = useState({}); // listenerId -> connState
  const [maxListeners, setMaxListeners] = useState(30);
  const [sessionLimitMs, setSessionLimitMs] = useState(60 * 60 * 1000);
  const [sessionRemainingSec, setSessionRemainingSec] = useState(60 * 60);
  const sessionStartedAtRef = useRef(null);
  const sessionWarningMarksRef = useRef(new Set());

  // Fetch TURN-capable ICE servers from backend as early as possible so they
  // are ready before the first listener joins and createOffer() is called.
  useEffect(() => {
    debugLog(`[HostRoom] fetching ICE servers on mount`);
    getIceServers().then((data) => {
      if (data?.iceServers) {
        debugLog(`[HostRoom] ICE servers loaded:`, data.iceServers);
        const turnCount = data.iceServers.filter(s => s.urls.toLowerCase().includes('turn')).length;
        const stunCount = data.iceServers.filter(s => s.urls.toLowerCase().includes('stun')).length;
        debugLog(`[HostRoom] STUN=${stunCount}, TURN=${turnCount}`);
        setIceServersConfig({ iceServers: data.iceServers });
      }
    }).catch(err => {
      errorLog(`[HostRoom] failed to fetch ICE servers:`, err);
      toast.warning('Could not load relay servers. Peer connections may be slower.');
    });
  }, []);

  const onPeerConnectionState = useCallback((listenerId, state) => {
    setListenerConnStates((prev) => {
      if (prev[listenerId] === state) return prev;
      return { ...prev, [listenerId]: state };
    });
  }, []);

  const { createOffer, handleAnswer, handleIceCandidate, removePeer, closeAll } = useHostWebRTC(
    socket,
    stream,
    iceServersConfig,
    { onPeerConnectionState },
  );
  const syncInterval = useRef(null);
  // streamRef always holds the current stream — safe to use inside async callbacks
  // without worrying about stale closures over the `stream` state variable.
  const streamRef = useRef(null);
  // handleStopRef ensures track 'ended' listeners always invoke the latest handleStop.
  const handleStopRef = useRef(null);

  // Connect socket & join room
  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.emit('host:join', { roomId }, (res) => {
      if (res?.error) {
        alert(res.error);
        navigate('/', { replace: true });
        return;
      }
      setRoomCode(res.code);
      if (res.maxListeners) setMaxListeners(res.maxListeners);
      if (typeof res.sessionLimitMs === 'number' && res.sessionLimitMs > 0) {
        setSessionLimitMs(res.sessionLimitMs);
        setSessionRemainingSec(Math.floor(res.sessionLimitMs / 1000));
      }

      socket.emit('listener:request-messages', { roomId }, (historyRes) => {
        if (!historyRes?.ok || !Array.isArray(historyRes.messages)) return;
        setListeners((prev) => {
          if (prev.length === 0) return prev;
          return prev.map((listener) => {
            const ownMessages = historyRes.messages
              .filter((m) => m.socketId === listener.id)
              .slice(-10)
              .map((m) => ({ text: m.text, timestamp: m.timestamp }));
            if (ownMessages.length === 0) return listener;
            const latestTs = ownMessages[ownMessages.length - 1].timestamp;
            return {
              ...listener,
              messages: ownMessages,
              lastActivityAt: Math.max(listener.lastActivityAt || 0, latestTs || 0),
            };
          });
        });
      });
    });

    return () => {
      closeAll();
      if (syncInterval.current) clearInterval(syncInterval.current);
      socket.disconnect();
    };
  }, [roomId, navigate, closeAll]);

  // Re-join the room when the socket reconnects after a server restart.
  // Socket.IO fires 'reconnect' only on subsequent connections, never the first.
  useEffect(() => {
    const onReconnect = () => {
      socket.emit('host:join', { roomId }, (res) => {
        if (res?.error) {
          alert('Server restarted and could not recover your session. Please create a new room.');
          navigate('/', { replace: true });
          return;
        }
        // Server may have assigned a new code after the restart — update QR / display.
        setRoomCode(res.code);
        if (typeof res.sessionLimitMs === 'number' && res.sessionLimitMs > 0) {
          setSessionLimitMs(res.sessionLimitMs);
          if (!streamRef.current) {
            setSessionRemainingSec(Math.floor(res.sessionLimitMs / 1000));
          }
        }
      });
    };
    socket.io.on('reconnect', onReconnect);
    return () => socket.io.off('reconnect', onReconnect);
  }, [roomId, navigate]);

  // Keep Render awake: ping /api/health every 8 minutes.
  // Render free tier spins down after 15 min of no HTTP requests;
  // WebSocket messages don’t count as activity for Render’s purposes.
  useEffect(() => {
    const id = setInterval(pingServer, 8 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Listen for signaling events
  useEffect(() => {
    const onListenerJoined = ({ listenerId, listenerEmail, listenerName }) => {
      debugLog(`[HostRoom] listener joined: ${listenerId} (${listenerEmail})`);
      setListeners((prev) => {
        if (prev.some((l) => l.id === listenerId)) return prev;
        return [...prev, {
          id: listenerId,
          email: listenerEmail || null,
          name: listenerName || null,
          reaction: null,
          messages: [],
          joinedAt: Date.now(),
          lastActivityAt: Date.now(),
        }];
      });
      setListenerConnStates((prev) => ({ ...prev, [listenerId]: 'connecting' }));
      if (stream) {
        debugLog(`[HostRoom] stream exists, creating offer for ${listenerId}`);
        createOffer(listenerId);
      } else {
        debugLog(`[HostRoom] stream not ready yet, deferring offer creation for ${listenerId}`);
      }
    };

    const onListenerLeft = ({ listenerId }) => {
      debugLog(`[HostRoom] listener left: ${listenerId}`);
      setListeners((prev) => prev.filter((l) => l.id !== listenerId));
      setListenerConnStates((prev) => {
        const next = { ...prev };
        delete next[listenerId];
        return next;
      });
      removePeer(listenerId);
    };

    const onAnswer = ({ from, answer }) => {
      debugLog(`[HostRoom] received answer from ${from}`);
      setListenerConnStates((prev) => ({ ...prev, [from]: 'connected' }));
      handleAnswer(from, answer);
    };
    const onIce = ({ from, candidate }) => {
      debugLog(`[HostRoom] received ice-candidate from ${from}`);
      handleIceCandidate(from, candidate);
    };
    const onRequestOffer = ({ listenerId }) => {
      if (!listenerId) return;
      if (!streamRef.current) {
        debugLog(`[HostRoom] offer retry requested by ${listenerId}, but stream is not active`);
        return;
      }
      debugLog(`[HostRoom] offer retry requested by ${listenerId}; resending offer`);
      createOffer(listenerId);
    };

    const onListenerReaction = ({ listenerId, reaction, listenerEmail, listenerName }) => {
      if (!listenerId || !reaction) return;

      setListeners((prev) => {
        const exists = prev.some((listener) => listener.id === listenerId);
        if (!exists) {
          return [
            ...prev,
            {
              id: listenerId,
              email: listenerEmail || null,
              name: listenerName || null,
              reaction,
              messages: [],
              joinedAt: Date.now(),
              lastActivityAt: Date.now(),
            },
          ];
        }

        return prev.map((listener) =>
          listener.id === listenerId
            ? {
                ...listener,
                reaction,
                email: listener.email || listenerEmail || null,
                name: listener.name || listenerName || null,
                lastActivityAt: Date.now(),
              }
            : listener,
        );
      });
    };

    const onListenerMessage = ({ listenerId, text, timestamp }) => {
      if (!listenerId || !text) return;
      debugLog(`[HostRoom] message from ${listenerId}: "${text.slice(0, 30)}..."`);
      setListeners((prev) => {
        const exists = prev.some((listener) => listener.id === listenerId);
        if (!exists) {
          return [
            ...prev,
            {
              id: listenerId,
              email: null,
              name: null,
              reaction: null,
              messages: [{ text, timestamp }],
              joinedAt: Date.now(),
              lastActivityAt: Date.now(),
            },
          ];
        }

        return prev.map((listener) =>
          listener.id === listenerId
            ? {
                ...listener,
                messages: [...(listener.messages || []), { text, timestamp }].slice(-10), // keep last 10 messages
                lastActivityAt: Date.now(),
              }
            : listener,
        );
      });
    };

    socket.on('listener:joined', onListenerJoined);
    socket.on('listener:left', onListenerLeft);
    socket.on('signal:answer', onAnswer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('listener:request-offer', onRequestOffer);
    socket.on('listener:reaction', onListenerReaction);
    socket.on('listener:message', onListenerMessage);

    return () => {
      socket.off('listener:joined', onListenerJoined);
      socket.off('listener:left', onListenerLeft);
      socket.off('signal:answer', onAnswer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('listener:request-offer', onRequestOffer);
      socket.off('listener:reaction', onListenerReaction);
      socket.off('listener:message', onListenerMessage);
    };
  }, [stream, createOffer, handleAnswer, handleIceCandidate, removePeer]);

  // handleStop — uses streamRef so it is never stale inside media-track callbacks.
  const handleStop = useCallback(() => {
    // Clear all track listeners first to prevent any 'ended' handler re-firing.
    streamRef.current?.getTracks().forEach((t) => { t.onended = null; });
    // Stop every track — this closes the browser's sharing indicator on ALL
    // captured tabs/screens, including any still-live video tracks.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setStreaming(false);
    setPaused(false);
    sessionStartedAtRef.current = null;
    sessionWarningMarksRef.current.clear();
    setSessionRemainingSec(Math.floor(sessionLimitMs / 1000));
    closeAll();
    if (syncInterval.current) {
      clearInterval(syncInterval.current);
      syncInterval.current = null;
    }
    socket.emit('host:stop');
    // replace: true removes /host/:roomId from history so pressing back from
    // home does not re-mount this component and attempt to rejoin the room.
    navigate('/', { replace: true });
  }, [navigate, closeAll, sessionLimitMs]);

  // Keep the ref pointing at the latest handleStop so capture-time listeners
  // don't hold a stale closure.
  handleStopRef.current = handleStop;

  useEffect(() => {
    if (!streaming || !sessionStartedAtRef.current) {
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const elapsedMs = now - sessionStartedAtRef.current;
      const remainingMs = Math.max(0, sessionLimitMs - elapsedMs);
      const remainingSec = Math.ceil(remainingMs / 1000);

      setSessionRemainingSec(remainingSec);

      // Notify host near expiry so they can wrap up gracefully.
      [10 * 60, 5 * 60, 60].forEach((mark) => {
        if (remainingSec <= mark && !sessionWarningMarksRef.current.has(mark)) {
          sessionWarningMarksRef.current.add(mark);
          toast.warning(`Session ends in ${formatDuration(mark)}`);
        }
      });

      if (remainingSec <= 0) {
        toast.error('60-minute session limit reached. Stopping broadcast.');
        handleStopRef.current?.();
      }
    };

    updateCountdown();
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, [streaming, sessionLimitMs, toast]);

  // Start capturing audio
  const startCapture = useCallback(async (type) => {
    setCaptureError(null);
    try {
      let mediaStream;
      if (type === 'mic') {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            latency: 0,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } else if (type === 'display') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          const err = 'Display capture is not supported on this device. Open HearTogether on a desktop browser, or use Microphone mode instead.';
          setCaptureError(err);
          toast.error(err);
          return;
        }
        // getDisplayMedia — video is required by the API.
        // We do NOT stop video tracks here.  Stopping them early causes two problems:
        //  1. Chrome's "You are sharing [Tab X]" indicator may not close when the
        //     host later clicks Stop, because the browser considers video as the
        //     primary capture.  Stopping all tracks together in handleStop gives
        //     Chrome a clean single signal to close the entire capture session.
        //  2. On some Chrome builds, stopping a getDisplayMedia video track fires
        //     the track's 'ended' event on sibling audio tracks, triggering
        //     handleStop prematurely.
        // Video is never added to WebRTC peer connections (only audio is), so
        // keeping it alive here costs only a little CPU for an unused capture.
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            channelCount: 2,
            sampleRate: 48000,
            sampleSize: 16,
            latency: 0,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          // Browser picker still lets host choose tab/window/screen explicitly.
          preferCurrentTab: false,
        });

        if (mediaStream.getAudioTracks().length === 0) {
          mediaStream.getTracks().forEach((track) => track.stop());
          const err = 'No system audio was selected. Start again and enable the Share audio checkbox in the browser picker.';
          setCaptureError(err);
          toast.error(err);
          return;
        }
      }

      // Wire onended to EVERY track so that:
      //  - clicking HearTogether's Stop button → handleStop() (via button handler)
      //  - clicking the browser's own "Stop sharing" button → onended fires on
      //    whichever track Chrome ends first → handleStop() is called
      // handleStop() clears all listeners before stopping tracks, preventing
      // a cascade of multiple handleStop() calls.
      mediaStream.getTracks().forEach((track) => {
        track.onended = () => handleStopRef.current?.();
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setStreaming(true);
      setPaused(false);
      sessionStartedAtRef.current = Date.now();
      sessionWarningMarksRef.current.clear();
      setSessionRemainingSec(Math.ceil(sessionLimitMs / 1000));
      setCaptureError(null);
      toast.success('Audio capture started');

      if (syncInterval.current) clearInterval(syncInterval.current);
      syncInterval.current = setInterval(() => {
        socket.emit('sync:timestamp', { timestamp: Date.now() });
      }, 5000);
    } catch (err) {
      errorLog('Capture failed:', err);
      const errorMsg = err?.name === 'NotAllowedError'
        ? 'Permission denied. Please allow audio access to use HearTogether.'
        : err?.name === 'NotFoundError'
        ? 'No compatible audio device found.'
        : 'Could not capture audio. Please make sure you grant the required permissions and try again.';
      setCaptureError(errorMsg);
      toast.error(errorMsg);
    }
  }, [toast, sessionLimitMs]); // no other external deps needed — everything else is accessed via refs or stable socket

  // When stream starts (or listener membership changes), send offers only to
  // listeners that are not yet connected. This avoids renegotiation storms when
  // reactions/messages update listener UI state.
  useEffect(() => {
    if (stream && listeners.length > 0) {
      debugLog(`[HostRoom] stream available, checking offers for ${listeners.length} listeners`);
      listeners.forEach((l) => {
        const state = listenerConnStates[l.id];
        if (state !== 'connected' && state !== 'connecting') {
          debugLog(`[HostRoom] creating offer for listener ${l.id}`);
          setListenerConnStates((prev) => ({ ...prev, [l.id]: 'connecting' }));
          createOffer(l.id);
        }
      });
    }
  }, [stream, listeners, listenerConnStates, createOffer]);

  const handlePause = () => {
    if (paused) {
      socket.emit('host:resume');
      // Re-enable tracks
      stream?.getAudioTracks().forEach((t) => { t.enabled = true; });
    } else {
      socket.emit('host:pause');
      stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
    setPaused(!paused);
  };

  const handleRemoveListener = (listenerId) => {
    socket.emit('host:remove-listener', { listenerId });
    setListeners((prev) => prev.filter((l) => l.id !== listenerId));
    removePeer(listenerId);
  };

  const sortedListeners = [...listeners].sort((a, b) => {
    const aTs = a.lastActivityAt || a.joinedAt || 0;
    const bTs = b.lastActivityAt || b.joinedAt || 0;
    return bTs - aTs;
  });

  const roomUrl = `${window.location.origin}/room/${roomCode}`;

  return (
    <div className="min-h-screen px-4 py-8 md:px-12">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">HearTogether</h1>
        <div className="flex w-full sm:w-auto items-center justify-end gap-2 sm:gap-4 flex-wrap">
          {streaming && (
            <div className="flex items-center gap-2 text-sm">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
              LIVE
            </div>
          )}
          <UserProfile />
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        {/* Left: QR & Room Info */}
        <GlowCard customSize glowColor="blue" className="w-full">
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-lg font-semibold">Your Room</h2>

            {roomCode && (
              <>
                <div className="rounded-xl bg-white p-3 inline-flex">
                  <QRCodeSVG value={roomUrl} size={190} level="H" />
                </div>

                <div>
                  <p className="text-sm text-gray-400">Room Code</p>
                  <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-brand-400">{roomCode}</p>
                </div>

                <ShimmerButton
                  onClick={() => navigator.clipboard.writeText(roomUrl)}
                  background="rgba(20, 20, 30, 0.95)"
                  shimmerColor="#5c7cfa"
                  className="dark:text-white text-sm font-semibold"
                >
                  Copy Link
                </ShimmerButton>
              </>
            )}
          </div>
        </GlowCard>

        {/* Right: Controls */}
        <div className="flex flex-col gap-6">
          {/* Broadcast Controls */}
          <GlowCard customSize glowColor="purple" className="w-full">
            <h2 className="mb-4 text-lg font-semibold">Broadcast</h2>

            <div className={`mb-4 rounded-lg border px-4 py-3 ${
              streaming
                ? sessionRemainingSec <= 60
                  ? 'border-red-500/40 bg-red-900/20'
                  : sessionRemainingSec <= 5 * 60
                  ? 'border-yellow-500/40 bg-yellow-900/20'
                  : 'border-blue-500/30 bg-blue-900/20'
                : 'border-white/10 bg-white/5'
            }`}>
              <p className="text-xs uppercase tracking-wider text-gray-400">Session Timer</p>
              <p className={`mt-1 font-mono text-2xl font-bold ${
                streaming
                  ? sessionRemainingSec <= 60
                    ? 'text-red-300'
                    : sessionRemainingSec <= 5 * 60
                    ? 'text-yellow-300'
                    : 'text-blue-300'
                  : 'text-gray-200'
              }`}>
                {formatDuration(sessionRemainingSec)}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                One session is limited to {Math.floor(sessionLimitMs / 60000)} minutes.
              </p>
            </div>

          {captureError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-red-300">⚠️ Capture Error</p>
                  <p className="text-xs text-red-200 mt-2">{captureError}</p>
                </div>
                <button
                  onClick={() => setCaptureError(null)}
                  className="w-full rounded-lg bg-red-600/40 hover:bg-red-600/60 px-3 py-2 text-xs font-semibold text-red-100 transition"
                >
                  Dismiss
                </button>
              </div>
            )}

            {!streaming ? (
              <div className="flex flex-col gap-3">
                {CAPTURE_OPTIONS.map((opt) => (
                  <ShimmerButton
                    key={opt.id}
                    onClick={() => startCapture(opt.id)}
                    background="rgba(20, 20, 30, 0.95)"
                    shimmerColor="#5c7cfa"
                    className="dark:text-white justify-start text-left w-full"
                  >
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-gray-400">{opt.desc}</div>
                    </div>
                  </ShimmerButton>
                ))}
              </div>
            ) : (
              <div className="flex gap-3">
                <ShimmerButton
                  onClick={handlePause}
                  background="rgba(20, 20, 30, 0.95)"
                  shimmerColor="#5c7cfa"
                  className="dark:text-white flex-1 font-semibold"
                >
                  {paused ? 'Resume' : 'Pause'}
                </ShimmerButton>
                <ShimmerButton
                  onClick={handleStop}
                  background="rgba(220, 38, 38, 1)"
                  shimmerColor="#ffffff"
                  className="dark:text-white flex-1 font-semibold"
                >
                  Stop
                </ShimmerButton>
              </div>
            )}
          </GlowCard>

          {/* Listeners */}
          <GlowCard customSize glowColor="green" className="w-full">
            <h2 className="mb-4 text-lg font-semibold">
              Listeners <span className="text-brand-400">({listeners.length}/{maxListeners})</span>
            </h2>

            {listeners.length === 0 ? (
              <p className="text-sm text-gray-500">No listeners yet. Share the QR code to invite people.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedListeners.map((l) => {
                  const connState = listenerConnStates[l.id] || 'new';
                  const connStateColor = connState === 'connected' 
                    ? 'text-green-400' 
                    : connState === 'failed'
                    ? 'text-red-400'
                    : connState === 'disconnected'
                    ? 'text-yellow-400'
                    : 'text-gray-400';
                  const connStateLabel = connState === 'connected'
                    ? 'Connected'
                    : connState === 'connecting'
                    ? 'Connecting…'
                    : connState === 'failed'
                    ? 'Failed'
                    : connState === 'disconnected'
                    ? 'Interrupted'
                    : 'Pending';
                  
                  return (
                    <li key={l.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`h-2 w-2 rounded-full ${
                          connState === 'connected' ? 'bg-green-400' :
                          connState === 'failed' ? 'bg-red-400' :
                          connState === 'disconnected' ? 'bg-yellow-400' :
                          'bg-gray-400 animate-pulse'
                        }`} />
                        <div className="text-left min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{l.name || l.email || `${l.id.slice(0, 8)}…`}</div>
                          <div className={`text-xs ${connStateColor} mt-0.5`}>{connStateLabel}</div>
                          {l.messages?.length > 0 && (
                            <div className="mt-1 text-xs text-blue-300 truncate" title={l.messages[l.messages.length - 1].text}>
                              {l.messages[l.messages.length - 1].text}
                            </div>
                          )}
                          {l.email && <div className="text-xs text-gray-400">{l.email}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        <span className="text-lg leading-none" title={l.reaction ? 'Latest reaction' : 'No reaction yet'}>
                          {l.reaction || '·'}
                        </span>
                        <button
                          onClick={() => handleRemoveListener(l.id)}
                          className="text-xs text-red-400 hover:text-red-300 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </GlowCard>
        </div>
      </div>
    </div>
  );
}
