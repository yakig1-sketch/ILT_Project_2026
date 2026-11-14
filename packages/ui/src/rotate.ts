// Hand video turned 180° (Phase 5f QA): a camera facing the child shows the sheet upside down. The
// choice is kept in this browser and shared by the cockpit's live view and the replay.
import { useCallback, useState } from 'react';

const KEY = 'ilt.video.rotate180';

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function useVideoRotation(): [boolean, () => void] {
  const [rotated, setRotated] = useState(read);
  const toggle = useCallback(() => {
    setRotated((r) => {
      try {
        localStorage.setItem(KEY, r ? '0' : '1');
      } catch {
        // Kept for this page only.
      }
      return !r;
    });
  }, []);
  return [rotated, toggle];
}
