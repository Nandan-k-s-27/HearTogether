import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../services/socket';
import { useHostWebRTC } from '../hooks/useWebRTC';
import { getIceServers, pingServer } from '../services/api';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';
import { UserProfile } from '../components/UserProfile';

const CAPTURE_OPTIONS = [
  { id: 'display', label: 'System Audio (Tab / Window / Screen)', desc: 'Share audio from a browser tab, app window, or entire screen' },
  { id: 'mic', label: 'Microphone', desc: 'Broadcast live microphone input' },
];

export default function HostRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [roomCode, setRoomCode] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [listeners, setListeners] = useState([]);
  const [stream, setStream] = useState(null);
  const [iceServersConfig, setIceServersConfig] = useState(null);
  const [captureError, setCaptureError] = useState(null);

  // Fetch TURN-capable ICE servers from backend as early as possible so they
  // are ready before the first listener joins and createOffer() is called.
  useEffect(() => {
    getIceServers().then((data) => {
      if (data?.iceServers) setIceServersConfig({ iceServers: data.iceServers });
    });
  }, []);

  const { createOffer, handleAnswer, handleIceCandidate, removePeer, closeAll } = useHostWebRTC(socket, stream, iceServersConfig);
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
      setListeners((prev) => {
        if (prev.some((l) => l.id === listenerId)) return prev;
        return [...prev, {
          id: listenerId,
          email: listenerEmail || null,
          name: listenerName || null,
          joinedAt: Date.now(),
        }];
      });
      if (stream) createOffer(listenerId);
    };

    const onListenerLeft = ({ listenerId }) => {
      setListeners((prev) => prev.filter((l) => l.id !== listenerId));
      removePeer(listenerId);
    };

    const onAnswer = ({ from, answer }) => handleAnswer(from, answer);
    const onIce = ({ from, candidate }) => handleIceCandidate(from, candidate);

    socket.on('listener:joined', onListenerJoined);
    socket.on('listener:left', onListenerLeft);
    socket.on('signal:answer', onAnswer);
    socket.on('signal:ice-candidate', onIce);

    return () => {
      socket.off('listener:joined', onListenerJoined);
      socket.off('listener:left', onListenerLeft);
      socket.off('signal:answer', onAnswer);
      socket.off('signal:ice-candidate', onIce);
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
    closeAll();
    if (syncInterval.current) {
      clearInterval(syncInterval.current);
      syncInterval.current = null;
    }
    socket.emit('host:stop');
    // replace: true removes /host/:roomId from history so pressing back from
    // home does not re-mount this component and attempt to rejoin the room.
    navigate('/', { replace: true });
  }, [navigate, closeAll]);

  // Keep the ref pointing at the latest handleStop so capture-time listeners
  // don't hold a stale closure.
  handleStopRef.current = handleStop;

  // Start capturing audio
  const startCapture = useCallback(async (type) => {
    setCaptureError(null);
    try {
      let mediaStream;
      if (type === 'mic') {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else if (type === 'display') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setCaptureError('Display capture is not supported on this device. Open HearTogether on a desktop browser, or use Microphone mode instead.');
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
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          // Browser picker still lets host choose tab/window/screen explicitly.
          preferCurrentTab: false,
        });

        if (mediaStream.getAudioTracks().length === 0) {
          mediaStream.getTracks().forEach((track) => track.stop());
          setCaptureError('No system audio was selected. Start again and enable the Share audio checkbox in the browser picker.');
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

      if (syncInterval.current) clearInterval(syncInterval.current);
      syncInterval.current = setInterval(() => {
        socket.emit('sync:timestamp', { timestamp: Date.now() });
      }, 5000);
    } catch (err) {
      console.error('Capture failed:', err);
      setCaptureError('Could not capture audio. Please make sure you grant the required permissions and try again.');
    }
  }, []); // no external deps needed — everything is accessed via refs or stable socket

  // When stream changes, send offers to any listeners already in the room.
  useEffect(() => {
    if (stream && listeners.length > 0) {
      listeners.forEach((l) => createOffer(l.id));
    }
  }, [stream, listeners, createOffer]);

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

  const roomUrl = `${window.location.origin}/room/${roomCode}`;

  return (
    <div className="min-h-screen px-4 py-8 md:px-12">
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

            {captureError && (
              <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
                {captureError}
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
              Listeners <span className="text-brand-400">({listeners.length})</span>
            </h2>

            {listeners.length === 0 ? (
              <p className="text-sm text-gray-500">No listeners yet. Share the QR code to invite people.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {listeners.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <div className="text-left">
                        <div className="text-sm font-semibold">{l.name || l.email || `${l.id.slice(0, 8)}…`}</div>
                        {l.email && <div className="text-xs text-gray-400">{l.email}</div>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveListener(l.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </GlowCard>
        </div>
      </div>
    </div>
  );
}
