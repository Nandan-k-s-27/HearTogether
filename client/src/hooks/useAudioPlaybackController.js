import { useEffect, useState } from 'react';
import { audioPlaybackController } from '../services/audioPlaybackController';

export function useAudioPlaybackController() {
  const [playbackState, setPlaybackState] = useState(audioPlaybackController.getState());

  useEffect(() => {
    const unsubscribe = audioPlaybackController.subscribe(setPlaybackState);
    return unsubscribe;
  }, []);

  return {
    playbackState,
    controller: audioPlaybackController,
  };
}