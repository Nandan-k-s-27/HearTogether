import { useRef, useCallback } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Hook for the HOST side: creates a peer connection per listener and sends audio.
 */
export function useHostWebRTC(socket, stream) {
  const peers = useRef(new Map()); // listenerId -> RTCPeerConnection

  const createOffer = useCallback(
    async (listenerId) => {
      if (!stream) return;
      const pc = new RTCPeerConnection(ICE_SERVERS);
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
 */
export function useListenerWebRTC(socket) {
  const pcRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const audioRef = useRef(null);

  const handleOffer = useCallback(
    async (hostId, offer) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('signal:ice-candidate', { to: hostId, candidate: e.candidate });
        }
      };

      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
          audioRef.current.play().catch(() => {});
        }
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
