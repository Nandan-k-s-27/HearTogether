import { useRef, useCallback, useEffect } from 'react';

const DEFAULT_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Hook for the HOST side: creates a peer connection per listener and sends audio.
 */
export function useHostWebRTC(socket, stream, iceServersConfig) {
  const peers = useRef(new Map()); // listenerId -> RTCPeerConnection
  const iceRef = useRef(iceServersConfig ?? DEFAULT_ICE_SERVERS);
  useEffect(() => { iceRef.current = iceServersConfig ?? DEFAULT_ICE_SERVERS; }, [iceServersConfig]);

  const createOffer = useCallback(
    async (listenerId) => {
      if (!stream) return;
      const pc = new RTCPeerConnection(iceRef.current);
      peers.current.set(listenerId, pc);

      // Add audio tracks
      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('signal:ice-candidate', { to: listenerId, candidate: e.candidate });
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
  const iceRef = useRef(iceServersConfig ?? DEFAULT_ICE_SERVERS);
  useEffect(() => { onTrackReadyRef.current = onTrackReady; }, [onTrackReady]);
  useEffect(() => { onConnectionStateRef.current = onConnectionState; }, [onConnectionState]);
  useEffect(() => { iceRef.current = iceServersConfig ?? DEFAULT_ICE_SERVERS; }, [iceServersConfig]);

  const handleOffer = useCallback(
    async (hostId, offer) => {
      const pc = new RTCPeerConnection(iceRef.current);
      pcRef.current = pc;

      // Track real ICE/DTLS connection state so the UI can surface failures.
      pc.onconnectionstatechange = () => {
        onConnectionStateRef.current?.(pc.connectionState);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
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
  }, []);

  return { handleOffer, handleIceCandidate, close, audioRef, remoteStreamRef };
}
