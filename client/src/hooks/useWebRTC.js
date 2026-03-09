import { useRef, useCallback, useEffect } from 'react';

// Extra RTCPeerConnection options that improve connectivity and performance.
// Mirrors what SmartMeet (and most production WebRTC apps) configure:
//   iceCandidatePoolSize – pre-gathers candidates before offer so the very
//     first connection attempt is faster (no cold-start delay).
//   bundlePolicy        – forces all tracks onto a single 5-tuple, saving
//     bandwidth and avoiding separate ICE negotiations per track.
//   iceTransportPolicy  – 'all' means host, srflx AND relay (TURN) candidates
//     are tried; without this some browsers skip relay candidates silently.
const EXTRA_PC_OPTIONS = {
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  iceTransportPolicy: 'all',
};

const DEFAULT_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  ...EXTRA_PC_OPTIONS,
};

// Log which ICE candidate types are gathered — helps diagnose whether TURN
// relay candidates arrive.  Only fires in non-production for debugging.
function logIceCandidate(label, candidate) {
  if (!candidate) return;
  const c = candidate.candidate || '';
  const type = candidate.type || (c.includes('relay') ? 'relay' : c.includes('srflx') ? 'srflx' : 'host');
  console.log(`[ICE ${label}] ${type}: ${c.slice(0, 80)}`);
}

/**
 * Hook for the HOST side: creates a peer connection per listener and sends audio.
 */
export function useHostWebRTC(socket, stream, iceServersConfig) {
  const peers = useRef(new Map()); // listenerId -> RTCPeerConnection
  const iceRef = useRef(iceServersConfig ? { ...iceServersConfig, ...EXTRA_PC_OPTIONS } : DEFAULT_ICE_SERVERS);
  useEffect(() => {
    iceRef.current = iceServersConfig ? { ...iceServersConfig, ...EXTRA_PC_OPTIONS } : DEFAULT_ICE_SERVERS;
  }, [iceServersConfig]);

  const createOffer = useCallback(
    async (listenerId) => {
      if (!stream) return;
      // Close stale connection if one already exists for this listener.
      const old = peers.current.get(listenerId);
      if (old) old.close();

      const pc = new RTCPeerConnection(iceRef.current);
      peers.current.set(listenerId, pc);

      // Add audio tracks
      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          logIceCandidate('host', e.candidate);
          socket.emit('signal:ice-candidate', { to: listenerId, candidate: e.candidate });
        }
      };

      // Auto-restart ICE when media path fails (network switch, timeout, etc.)
      let iceRestarts = 0;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && iceRestarts < 3) {
          iceRestarts++;
          console.log(`[WebRTC] host→${listenerId} failed – ICE restart #${iceRestarts}`);
          pc.restartIce();
          pc.createOffer({ iceRestart: true })
            .then((o) => pc.setLocalDescription(o))
            .then(() => socket.emit('signal:offer', { to: listenerId, offer: pc.localDescription }))
            .catch((err) => console.error('[WebRTC] ICE restart error:', err));
        } else if (pc.connectionState === 'connected') {
          iceRestarts = 0;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal:offer', { to: listenerId, offer });
    },
    [socket, stream],
  );

  const handleAnswer = useCallback((listenerId, answer) => {
    const pc = peers.current.get(listenerId);
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const handleIceCandidate = useCallback((listenerId, candidate) => {
    const pc = peers.current.get(listenerId);
    if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  const removePeer = useCallback((listenerId) => {
    const pc = peers.current.get(listenerId);
    if (pc) {
      pc.close();
      peers.current.delete(listenerId);
    }
  }, []);

  const closeAll = useCallback(() => {
    peers.current.forEach((pc) => pc.close());
    peers.current.clear();
  }, []);

  return { createOffer, handleAnswer, handleIceCandidate, removePeer, closeAll, peers };
}

/**
 * Hook for the LISTENER side: receives audio from host.
 *
 * onTrackReady() is called as soon as a remote audio stream arrives, so the
 * UI can show a "Tap to play" button.  We never attempt autoplay ourselves —
 * all mobile browsers require an explicit user gesture before audio can play,
 * and relying on error-detection misses several browser-specific error codes.
 */
export function useListenerWebRTC(socket, { onTrackReady, onConnectionState, iceServersConfig } = {}) {
  const pcRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const audioRef = useRef(null);
  // Ref-wrap callbacks so closures never hold stale values.
  const onTrackReadyRef = useRef(onTrackReady);
  const onConnectionStateRef = useRef(onConnectionState);
  const iceRef = useRef(iceServersConfig ? { ...iceServersConfig, ...EXTRA_PC_OPTIONS } : DEFAULT_ICE_SERVERS);
  useEffect(() => { onTrackReadyRef.current = onTrackReady; }, [onTrackReady]);
  useEffect(() => { onConnectionStateRef.current = onConnectionState; }, [onConnectionState]);
  useEffect(() => {
    iceRef.current = iceServersConfig ? { ...iceServersConfig, ...EXTRA_PC_OPTIONS } : DEFAULT_ICE_SERVERS;
  }, [iceServersConfig]);

  const hostIdRef = useRef(null);

  const handleOffer = useCallback(
    async (hostId, offer) => {
      // Same host re-sending offer on a live connection → ICE restart.
      // Reuse the existing RTCPeerConnection so relay candidates are
      // renegotiated without dropping the media stream.
      const existingPc = pcRef.current;
      if (existingPc && existingPc.signalingState !== 'closed' && hostIdRef.current === hostId) {
        await existingPc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await existingPc.createAnswer();
        await existingPc.setLocalDescription(answer);
        socket.emit('signal:answer', { to: hostId, answer });
        return;
      }

      // Different host or first offer — close old connection and create new one.
      if (existingPc) existingPc.close();
      hostIdRef.current = hostId;

      const pc = new RTCPeerConnection(iceRef.current);
      pcRef.current = pc;

      // Track real ICE/DTLS connection state so the UI can surface failures.
      pc.onconnectionstatechange = () => {
        onConnectionStateRef.current?.(pc.connectionState);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          logIceCandidate('listener', e.candidate);
          socket.emit('signal:ice-candidate', { to: hostId, candidate: e.candidate });
        }
      };

      pc.ontrack = (e) => {
        // Some mobile browsers fire ontrack before streams[] is populated —
        // fall back to constructing a stream directly from the track.
        const stream = (e.streams && e.streams.length > 0)
          ? e.streams[0]
          : new MediaStream([e.track]);

        remoteStreamRef.current = stream;

        // Prime the audio element if it is already in the DOM.
        if (audioRef.current) {
          audioRef.current.srcObject = stream;
          audioRef.current.muted = false;
        }

        // Tell the UI the stream is ready.  The UI will show a "Tap to play"
        // button; the user's tap calls audio.play() inside a gesture context,
        // which is the only reliable way to start audio on mobile.
        onTrackReadyRef.current?.();
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal:answer', { to: hostId, answer });
    },
    [socket],
  );

  const handleIceCandidate = useCallback((_fromId, candidate) => {
    if (pcRef.current) pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  const close = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    hostIdRef.current = null;
  }, []);

  return { handleOffer, handleIceCandidate, close, audioRef, remoteStreamRef };
}
