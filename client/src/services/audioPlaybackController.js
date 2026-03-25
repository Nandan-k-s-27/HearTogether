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
    this.boundAudioEventHandler = () => this.syncState();
    this.boundPageRestoreHandler = () => this.syncState();
    this.boundPageUnloadHandler = () => this.handlePageUnload();

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

    // Initial Media Session registration — primarily registers action handlers.
    // Metadata + full binding is refreshed inside attachAudioElement() once the
    // <audio> element is available, which is when Android Chrome actually
    // activates the media notification.
    this.setupMediaSession();
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    this.applyMediaMetadata(this.metadata);

    // FIX: Re-attach the current stream before playing so the lock-screen
    // "Play" button always has a valid srcObject, even after ICE renegotiation.
    this.setMediaSessionActionHandler('play', async () => {
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
      // Some actions are unsupported on older/mobile browser builds.
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
    const events = ['play', 'pause', 'ended', 'volumechange', 'waiting', 'canplay', 'error'];
    events.forEach((eventName) => {
      el.addEventListener(eventName, this.boundAudioEventHandler);
    });
  }

  removeAudioEventListeners(el) {
    const events = ['play', 'pause', 'ended', 'volumechange', 'waiting', 'canplay', 'error'];
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

    // FIX: Re-apply Media Session metadata and action handlers now that an
    // <audio> element is mounted. Android Chrome only activates the media
    // notification when a real <audio> element is attached to the page.
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

      // FIX: Force-push metadata and 'playing' state immediately after the
      // play() promise resolves. This is the moment Android Chrome locks in
      // the notification card — doing it here (not in syncState) guarantees
      // the OS receives the signal while the browser is in a trusted context.
      this.applyMediaMetadata(this.metadata);
      this.updateMediaSessionPlaybackState('playing');

      this.syncState();
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

    // FIX: Only communicate a non-'none' playback state to the OS after the
    // user has activated playback at least once. Sending 'paused' before any
    // user gesture causes Android to show a broken notification with no
    // controls, which it then dismisses — preventing the notification from
    // appearing at all when actual playback starts.
    if (this.hasUserActivatedPlayback) {
      this.updateMediaSessionPlaybackState(isPlaying ? 'playing' : 'paused');
    }
  }

  handlePageUnload() {
    // If the browser tab is closed or the process is being torn down,
    // release playback resources so no stale element survives remounts.
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