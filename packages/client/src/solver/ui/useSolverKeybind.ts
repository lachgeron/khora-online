/**
 * Keybind: press ' five times then 9 to trigger the solver.
 *
 * Ignores keystrokes while an input/textarea/contenteditable is focused.
 * Sequence resets after 1.5s of inactivity or on any non-matching key.
 */

import { useEffect, useRef } from 'react';

const SEQUENCE = ["'", "'", "'", "'", "'", '9'];
const TIMEOUT_MS = 1500;

export function useSolverKeybind(onTrigger: () => void): void {
  const progressRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when focus is on input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }

      const now = Date.now();
      if (now - lastTimeRef.current > TIMEOUT_MS) {
        progressRef.current = 0;
      }
      lastTimeRef.current = now;

      const expected = SEQUENCE[progressRef.current];
      if (e.key === expected) {
        progressRef.current += 1;
        if (progressRef.current === SEQUENCE.length) {
          progressRef.current = 0;
          onTrigger();
        }
      } else {
        // If the user presses ' when we expected 9, restart mid-sequence
        progressRef.current = e.key === "'" ? 1 : 0;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTrigger]);
}
