import { debugLog, warnLog, errorLog } from '../lib/logger';

const DEFAULT_METADATA = {
  title: 'HearTogether Live Stream',
  artist: 'HearTogether',
  album: 'Live Session',
  artwork: [
    { src: '/favicon.png', sizes: '192x192', type: 'image/png' },
    { src: '/favicon.png', sizes: '512x512', type: 'image/png' },
  ],
};

class AudioPlaybackController {
  constructor() {
    this.audioEl = null;
    this.currentStream = null;
    this.subscribers = new Set();
    this.hasUserActivatedPlayback = false;
    this.metadata = DEFAULT_METADATA;
    this.keepAliveInterval = null;
    this.boundAudioEventHandler = () => this.syncState();
    this.boundPageRestoreHandler = () => this.syncState();
    this.boundPageUnloadHandler = () => this.handlePageUnload();
    this.boundVisibilityHandler = () => this.handleVisibilityChange();

    this.state = {
      isReady: false,
      isPlaying: false,
      volume: 1,
      muted: false,
      ended: false,
      lastError: null,
    };

    window.addEventListener('pageshow', this.boundPageRestoreHandler);
    window.addEventListener('focus', this.boundPageRestoreHandler);
    // Do not stop on pagehide: mobile browsers can fire it when switching
    // apps or locking the screen, which breaks background playback.
    window.addEventListener('beforeunload', this.boundPageUnloadHandler);
    window.addEventListener('unload', this.boundPageUnloadHandler);
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    this.setupMediaSession();
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    this.applyMediaMetadata(this.metadata);

    this.setMediaSessionActionHandler('play', async () => {
      // Re-attach the current stream before playing so the lock-screen
      // "Play" button always has a valid srcObject.
      if (this.audioEl && this.currentStream && this.audioEl.srcObject !== this.currentStream) {
        this.audioEl.srcObject = this.currentStream;
        this.audioEl.muted = false;
      }
      await this.play();
    });

    this.setMediaSessionActionHandler('pause', () => {
      this.pause();
    });

    this.setMediaSessionActionHandler('stop', () => {
      this.stop();
    });
  }

  setMediaSessionActionHandler(action, handler) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      debugLog(`[AudioPlaybackController] media action '${action}' unsupported`, err?.message || err);
    }
  }

  applyMediaMetadata(metadata) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata(metadata);
    } catch (err) {
      warnLog('[AudioPlaybackController] Failed to apply Media Session metadata', err);
    }
  }

  setMetadata(nextMetadata) {
    this.metadata = {
      ...DEFAULT_METADATA,
      ...nextMetadata,
      artwork: nextMetadata?.artwork?.length ? nextMetadata.artwork : DEFAULT_METADATA.artwork,
    };
    this.applyMediaMetadata(this.metadata);
  }

  addAudioEventListeners(el) {
    const events = ['play', 'pause', 'playing', 'ended', 'volumechange', 'waiting', 'canplay', 'error'];
    events.forEach((eventName) => {
      el.addEventListener(eventName, this.boundAudioEventHandler);
    });
  }

  removeAudioEventListeners(el) {
    const events = ['play', 'pause', 'playing', 'ended', 'volumechange', 'waiting', 'canplay', 'error'];
    events.forEach((eventName) => {
      el.removeEventListener(eventName, this.boundAudioEventHandler);
    });
  }

  attachAudioElement(el) {
    if (this.audioEl === el) return;

    if (this.audioEl) {
      this.removeAudioEventListeners(this.audioEl);
    }

    this.audioEl = el || null;

    if (!this.audioEl) {
      this.updateState({ isReady: false, isPlaying: false, ended: false });
      return;
    }

    this.addAudioEventListeners(this.audioEl);
    this.audioEl.playsInline = true;

    if (this.currentStream && this.audioEl.srcObject !== this.currentStream) {
      this.audioEl.srcObject = this.currentStream;
    }

    // Re-apply Media Session now that a real <audio> element is present.
    this.setupMediaSession();
    this.syncState();
  }

  setStream(stream) {
    this.currentStream = stream || null;

    if (this.audioEl) {
      this.audioEl.srcObject = this.currentStream;
      if (this.currentStream) {
        this.audioEl.muted = false;
      }
    }

    this.updateState({
      isReady: Boolean(this.currentStream),
      ended: false,
      lastError: null,
    });
  }

  async play() {
    if (!this.audioEl) {
      warnLog('[AudioPlaybackController] play() ignored because no audio element is attached');
      return false;
    }

    try {
      await this.audioEl.play();
      this.hasUserActivatedPlayback = true;

      // Force-push metadata and 'playing' state immediately after the
      // play() promise resolves to cement the Android notification card.
      this.applyMediaMetadata(this.metadata);
      this.updateMediaSessionPlaybackState('playing');

      this.syncState();
      this.startKeepAlive();
      return true;
    } catch (err) {
      errorLog('[AudioPlaybackController] play() failed', err?.name, err?.message || err);
      this.updateState({ lastError: err?.message || 'Playback failed' });
      return false;
    }
  }

  pause() {
    if (!this.audioEl) return;
    this.audioEl.pause();
    this.syncState();
  }

  stop() {
    this.stopKeepAlive();

    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl.removeAttribute('src');
      this.audioEl.load();
    }

    this.currentStream = null;
    this.hasUserActivatedPlayback = false;
    this.updateState({
      isReady: false,
      isPlaying: false,
      ended: true,
      lastError: null,
    });

    this.updateMediaSessionPlaybackState('none');
  }

  setVolume(volume) {
    const normalized = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.audioEl) {
      this.audioEl.volume = normalized;
    }
    this.updateState({ volume: normalized });
  }

  // Keepalive: periodically checks if the browser paused the audio (common
  // on Android background) and resumes it. Also re-pushes Media Session
  // metadata so the notification stays alive.
  startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (!this.audioEl || !this.currentStream || !this.hasUserActivatedPlayback) return;

      // Ensure srcObject is still attached (can be cleared by browser GC)
      if (!this.audioEl.srcObject && this.currentStream) {
        debugLog('[AudioPlaybackController] keepalive: re-attaching stream');
        this.audioEl.srcObject = this.currentStream;
      }

      // If browser paused us in background, try to resume
      if (this.audioEl.paused && this.currentStream) {
        debugLog('[AudioPlaybackController] keepalive: audio was paused, resuming');
        this.audioEl.play().then(() => {
          this.applyMediaMetadata(this.metadata);
          this.updateMediaSessionPlaybackState('playing');
        }).catch((err) => {
          debugLog('[AudioPlaybackController] keepalive resume failed:', err?.message);
        });
      }

      // Re-push metadata to keep the notification alive
      if (!this.audioEl.paused) {
        this.updateMediaSessionPlaybackState('playing');
      }
    }, 10000);
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Returned to foreground — re-cement the notification and sync state
      if (this.hasUserActivatedPlayback && this.audioEl) {
        this.applyMediaMetadata(this.metadata);
        this.syncState();

        // If the browser paused audio while backgrounded, resume it
        if (this.audioEl.paused && this.currentStream) {
          debugLog('[AudioPlaybackController] visibility: audio was paused, resuming');
          this.audioEl.play().then(() => {
            this.updateMediaSessionPlaybackState('playing');
          }).catch(() => {});
        }
      }
    }
    // IMPORTANT: Do nothing on 'hidden' — we must NOT pause/stop audio on
    // visibility change. Let the audio continue playing in the background.
  }

  syncState() {
    if (!this.audioEl) return;

    const isPlaying = !this.audioEl.paused && !this.audioEl.ended;
    const nextState = {
      isReady: Boolean(this.audioEl.srcObject || this.currentStream),
      isPlaying,
      volume: this.audioEl.volume,
      muted: this.audioEl.muted,
      ended: this.audioEl.ended,
      lastError: this.audioEl.error ? this.audioEl.error.message || 'Audio element error' : null,
    };

    this.updateState(nextState);

    // Only push playback state after user has tapped play at least once.
    if (this.hasUserActivatedPlayback) {
      this.updateMediaSessionPlaybackState(isPlaying ? 'playing' : 'paused');
    }
  }

  handlePageUnload() {
    this.stop();
  }

  updateMediaSessionPlaybackState(playbackState) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch (err) {
      debugLog('[AudioPlaybackController] Unable to set mediaSession.playbackState', err);
    }
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.subscribers.forEach((subscriber) => subscriber(this.getState()));
  }

  getState() {
    return { ...this.state };
  }

  subscribe(subscriber) {
    this.subscribers.add(subscriber);
    subscriber(this.getState());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

export const audioPlaybackController = new AudioPlaybackController();