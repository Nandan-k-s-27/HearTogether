import { useRef, useCallback, useEffect } from 'react';
import { debugLog, warnLog, errorLog } from '../lib/logger';

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
// relay candidates arrive. Logged in all builds to aid production debugging.
function logIceCandidate(label, candidate) {
  if (!candidate) return;
  const c = candidate.candidate || '';
  const type = candidate.type || (c.includes('relay') ? 'relay' : c.includes('srflx') ? 'srflx' : 'host');
  const parts = c.split(' ');
  const priority = parts[3] || '?';
  debugLog(`[ICE ${label}] type=${type} priority=${priority}`);
}

function normalizeIceUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  if (/^(turn|turns|stun|stuns):/i.test(url)) return url;
  // Provider dashboards sometimes return host:port without scheme.
  return `turn:${url}`;
}

function normalizeIceConfig(config) {
  const base = config?.iceServers ? config : DEFAULT_ICE_SERVERS;
  const normalizedServers = (base.iceServers || []).map((server) => {
    const rawUrls = server?.urls;
    const urls = Array.isArray(rawUrls)
      ? rawUrls.map((u) => normalizeIceUrl(u)).filter(Boolean)
      : normalizeIceUrl(rawUrls);

    if (!urls || (Array.isArray(urls) && urls.length === 0)) return null;
    return { ...server, urls };
  }).filter(Boolean);

  return {
    ...base,
    iceServers: normalizedServers,
    ...EXTRA_PC_OPTIONS,
  };
}

async function optimizeAudioSender(sender, label) {
  if (!sender || !sender.track || sender.track.kind !== 'audio') return;
  if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;

  try {
    const params = sender.getParameters();
    params.encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
    params.encodings[0].maxBitrate = 128000;
    params.encodings[0].dtx = false;
    params.encodings[0].networkPriority = 'high';

    await sender.setParameters(params);
    debugLog(`[WebRTC] optimized audio sender params for ${label}`);
  } catch (err) {
    // Not all browsers support these sender parameters.
    debugLog(`[WebRTC] audio sender optimization skipped for ${label}:`, err?.message || err);
  }
}

function applyOpusCodecPreference(pc, sender, label) {
  if (!pc || !sender) return;
  if (typeof RTCRtpSender === 'undefined' || typeof RTCRtpSender.getCapabilities !== 'function') return;

  try {
    const audioCaps = RTCRtpSender.getCapabilities('audio');
    if (!audioCaps?.codecs?.length) return;

    const opusCodecs = audioCaps.codecs.filter((codec) => {
      const mime = String(codec.mimeType || '').toLowerCase();
      return mime === 'audio/opus';
    });
    if (!opusCodecs.length) return;

    const otherCodecs = audioCaps.codecs.filter((codec) => {
      const mime = String(codec.mimeType || '').toLowerCase();
      return mime !== 'audio/opus';
    });

    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (transceiver && typeof transceiver.setCodecPreferences === 'function') {
      transceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
      debugLog(`[WebRTC] preferred Opus codec for ${label}`);
    }
  } catch (err) {
    debugLog(`[WebRTC] codec preference skipped for ${label}:`, err?.message || err);
  }
}

/**
 * Hook for the HOST side: creates a peer connection per listener and sends audio.
 */
export function useHostWebRTC(socket, stream, iceServersConfig, { onPeerConnectionState } = {}) {
  const peers = useRef(new Map()); // listenerId -> RTCPeerConnection
  const onPeerConnectionStateRef = useRef(onPeerConnectionState);
  const iceRef = useRef(normalizeIceConfig(iceServersConfig));
  useEffect(() => {
    onPeerConnectionStateRef.current = onPeerConnectionState;
  }, [onPeerConnectionState]);
  useEffect(() => {
    iceRef.current = normalizeIceConfig(iceServersConfig);
  }, [iceServersConfig]);

  const createOffer = useCallback(
    async (listenerId) => {
      if (!stream) {
        warnLog(`[WebRTC] createOffer called but stream is null for ${listenerId}`);
        return;
      }
      // Close stale connection if one already exists for this listener.
      const old = peers.current.get(listenerId);
      if (old) {
        debugLog(`[WebRTC] closing stale connection for ${listenerId}`);
        old.close();
      }

      debugLog(`[WebRTC] creating offer for ${listenerId}`);
      let pc;
      try {
        pc = new RTCPeerConnection(iceRef.current);
      } catch (err) {
        errorLog(`[WebRTC] failed to construct host RTCPeerConnection for ${listenerId}:`, err, iceRef.current);
        return;
      }
      peers.current.set(listenerId, pc);

      // Add audio tracks
      const audioTracks = stream.getAudioTracks();
      debugLog(`[WebRTC] adding ${audioTracks.length} audio tracks to peer connection for ${listenerId}`);
      if (audioTracks.length === 0) {
        warnLog(`[WebRTC] WARNING: no audio tracks found in stream for ${listenerId}`);
      }
      audioTracks.forEach((track) => {
        if ('contentHint' in track) {
          track.contentHint = 'music';
        }
        const sender = pc.addTrack(track, stream);
        applyOpusCodecPreference(pc, sender, `host→${listenerId}`);
        optimizeAudioSender(sender, `host→${listenerId}`);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          logIceCandidate(`host→${listenerId}`, e.candidate);
          socket.emit('signal:ice-candidate', { to: listenerId, candidate: e.candidate });
        }
      };

      // Auto-restart ICE when media path fails (network switch, timeout, etc.)
      let iceRestarts = 0;
      let disconnectedTimer = null;
      const triggerIceRestart = () => {
        if (iceRestarts >= 3) return;
        iceRestarts++;
        debugLog(`[WebRTC] host→${listenerId} ICE restart #${iceRestarts}`);
        pc.restartIce();
        pc.createOffer({ iceRestart: true })
          .then((o) => pc.setLocalDescription(o))
          .then(() => socket.emit('signal:offer', { to: listenerId, offer: pc.localDescription }))
          .catch((err) => errorLog('[WebRTC] ICE restart error:', err));
      };

      pc.onconnectionstatechange = () => {
        debugLog(`[WebRTC] host→${listenerId} connectionState: ${pc.connectionState}`);
        onPeerConnectionStateRef.current?.(listenerId, pc.connectionState);
        if (pc.connectionState === 'disconnected') {
          if (!disconnectedTimer) {
            disconnectedTimer = setTimeout(() => {
              disconnectedTimer = null;
              if (pc.connectionState === 'disconnected') {
                debugLog(`[WebRTC] host→${listenerId} still disconnected, forcing ICE restart`);
                triggerIceRestart();
              }
            }, 3500);
          }
        } else if (pc.connectionState === 'failed') {
          if (disconnectedTimer) {
            clearTimeout(disconnectedTimer);
            disconnectedTimer = null;
          }
          triggerIceRestart();
        } else if (pc.connectionState === 'connected') {
          if (disconnectedTimer) {
            clearTimeout(disconnectedTimer);
            disconnectedTimer = null;
          }
          iceRestarts = 0;
          debugLog(`[WebRTC] host→${listenerId} connected successfully`);
        } else if (pc.connectionState === 'closed') {
          if (disconnectedTimer) {
            clearTimeout(disconnectedTimer);
            disconnectedTimer = null;
          }
        }
      };

      pc.addEventListener('icegatheringstatechange', () => {
        debugLog(`[WebRTC] host→${listenerId} iceGatheringState: ${pc.iceGatheringState}`);
      });

      try {
        const offer = await pc.createOffer();
        debugLog(`[WebRTC] offer created for ${listenerId}`);
        await pc.setLocalDescription(offer);
        debugLog(`[WebRTC] sending offer to ${listenerId}`);
        socket.emit('signal:offer', { to: listenerId, offer });
      } catch (err) {
        errorLog(`[WebRTC] failed to create/send offer for ${listenerId}:`, err);
      }
    },
    [socket, stream],
  );

  const handleAnswer = useCallback((listenerId, answer) => {
    const pc = peers.current.get(listenerId);
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(answer)).catch((err) => {
        errorLog('[WebRTC] failed to set remote answer:', err);
      });
    }
  }, []);

  const handleIceCandidate = useCallback((listenerId, candidate) => {
    const pc = peers.current.get(listenerId);
    if (pc) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        errorLog('[WebRTC] failed to add host ICE candidate:', err);
      });
    }
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
  const iceRef = useRef(normalizeIceConfig(iceServersConfig));
  useEffect(() => { onTrackReadyRef.current = onTrackReady; }, [onTrackReady]);
  useEffect(() => { onConnectionStateRef.current = onConnectionState; }, [onConnectionState]);
  useEffect(() => {
    iceRef.current = normalizeIceConfig(iceServersConfig);
  }, [iceServersConfig]);

  const hostIdRef = useRef(null);

  const handleOffer = useCallback(
    async (hostId, offer) => {
      debugLog(`[WebRTC] received offer from ${hostId}`);
      // Same host re-sending offer on a live connection → ICE restart.
      // Reuse the existing RTCPeerConnection so relay candidates are
      // renegotiated without dropping the media stream.
      const existingPc = pcRef.current;
      if (existingPc && existingPc.signalingState !== 'closed' && hostIdRef.current === hostId) {
        debugLog(`[WebRTC] reusing existing connection for ICE restart from ${hostId}`);
        try {
          await existingPc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await existingPc.createAnswer();
          await existingPc.setLocalDescription(answer);
          socket.emit('signal:answer', { to: hostId, answer });
          debugLog(`[WebRTC] sent answer for ICE restart to ${hostId}`);
        } catch (err) {
          errorLog(`[WebRTC] ICE restart failed for ${hostId}:`, err);
        }
        return;
      }

      // Different host or first offer — close old connection and create new one.
      if (existingPc) {
        debugLog(`[WebRTC] closing old connection (different host or first offer)`);
        existingPc.close();
      }
      hostIdRef.current = hostId;

      let pc;
      try {
        pc = new RTCPeerConnection(iceRef.current);
      } catch (err) {
        errorLog(`[WebRTC] failed to construct listener RTCPeerConnection for ${hostId}:`, err, iceRef.current);
        return;
      }
      pcRef.current = pc;

      debugLog(`[WebRTC] created new peer connection for ${hostId}`);

      // Track real ICE/DTLS connection state so the UI can surface failures.
      pc.onconnectionstatechange = () => {
        debugLog(`[WebRTC] listener←${hostId} connectionState: ${pc.connectionState}`);
        onConnectionStateRef.current?.(pc.connectionState);
      };

      pc.addEventListener('icegatheringstatechange', () => {
        debugLog(`[WebRTC] listener←${hostId} iceGatheringState: ${pc.iceGatheringState}`);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          logIceCandidate(`listener←${hostId}`, e.candidate);
          socket.emit('signal:ice-candidate', { to: hostId, candidate: e.candidate });
        }
      };

      pc.ontrack = (e) => {
        debugLog(`[WebRTC] received ontrack event from ${hostId}`, e.track);

        // Lower playout buffering for closer host/listener synchronization.
        if (e.receiver) {
          if (typeof e.receiver.playoutDelayHint === 'number') {
            e.receiver.playoutDelayHint = 0.04;
          }
          if (typeof e.receiver.jitterBufferTarget === 'number') {
            e.receiver.jitterBufferTarget = 40;
          }
        }

        // Some mobile browsers fire ontrack before streams[] is populated —
        // fall back to constructing a stream directly from the track.
        const stream = (e.streams && e.streams.length > 0)
          ? e.streams[0]
          : new MediaStream([e.track]);

        remoteStreamRef.current = stream;

        // Tell the UI the stream is ready.  The UI will show a "Tap to play"
        // button; the user's tap calls audio.play() inside a gesture context,
        // which is the only reliable way to start audio on mobile.
        debugLog(`[WebRTC] calling onTrackReady callback`);
        onTrackReadyRef.current?.(stream);
      };

      try {
        debugLog(`[WebRTC] setting remote description (offer) from ${hostId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        debugLog(`[WebRTC] created answer for ${hostId}`);
        await pc.setLocalDescription(answer);
        debugLog(`[WebRTC] sending answer to ${hostId}`);
        socket.emit('signal:answer', { to: hostId, answer });
      } catch (err) {
        errorLog(`[WebRTC] failed to handle offer from ${hostId}:`, err);
      }
    },
    [socket],
  );

  const handleIceCandidate = useCallback((_fromId, candidate) => {
    if (pcRef.current) {
      pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        errorLog('[WebRTC] failed to add listener ICE candidate:', err);
      });
    }
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
