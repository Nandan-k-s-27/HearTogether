import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import socket from '../services/socket';
import { useHostWebRTC } from '../hooks/useWebRTC';
import { GlowCard } from '../components/ui/spotlight-card';
import { ShimmerButton } from '../components/ui/shimmer-button';

const CAPTURE_OPTIONS = [
  { id: 'tab', label: 'Browser Tab Audio', desc: 'Capture audio from a browser tab (recommended)' },
  { id: 'screen', label: 'Screen + Audio', desc: 'Capture screen share with system audio' },
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

  const { createOffer, handleAnswer, handleIceCandidate, removePeer, closeAll } = useHostWebRTC(socket, stream);
  const syncInterval = useRef(null);

  // Connect socket & join room
  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.emit('host:join', { roomId }, (res) => {
      if (res?.error) {
        alert(res.error);
        navigate('/');
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

  // Listen for signaling events
  useEffect(() => {
    const onListenerJoined = ({ listenerId }) => {
      setListeners((prev) => {
        if (prev.some((l) => l.id === listenerId)) return prev;
        return [...prev, { id: listenerId, joinedAt: Date.now() }];
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

  // Start capturing audio
  const startCapture = useCallback(async (type) => {
    try {
      let mediaStream;
      if (type === 'mic') {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else {
        // getDisplayMedia with audio for tab/screen capture
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: true, // required but we only use audio
          audio: true,
          preferCurrentTab: type === 'tab',
        });
        // Remove video tracks — we only need audio
        mediaStream.getVideoTracks().forEach((t) => t.stop());
      }

      setStream(mediaStream);
      setStreaming(true);
      setPaused(false);

      syncInterval.current = setInterval(() => {
        socket.emit('sync:timestamp', { timestamp: Date.now() });
      }, 5000);
    } catch (err) {
      console.error('Capture failed:', err);
      alert('Could not capture audio. Please ensure you grant the required permissions.');
    }
  }, [listeners]);

  // When stream changes, send offers to existing listeners
  useEffect(() => {
    if (stream && listeners.length > 0) {
      listeners.forEach((l) => createOffer(l.id));
    }
  }, [stream]); // intentionally only re-run when stream changes

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

  const handleStop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setStreaming(false);
    setPaused(false);
    closeAll();
    if (syncInterval.current) clearInterval(syncInterval.current);
    socket.emit('host:stop');
    navigate('/');
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
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🎧 HearTogether</h1>
        {streaming && (
          <div className="flex items-center gap-2 text-sm">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
            LIVE
          </div>
        )}
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
                  {paused ? '▶️ Resume' : '⏸️ Pause'}
                </ShimmerButton>
                <ShimmerButton
                  onClick={handleStop}
                  background="rgba(220, 38, 38, 1)"
                  shimmerColor="#ffffff"
                  className="dark:text-white flex-1 font-semibold"
                >
                  ⏹️ Stop
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
                      <span className="text-sm font-mono">{l.id.slice(0, 8)}…</span>
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
            )}\n          </GlowCard>
        </div>
      </div>
    </div>
  );
}
