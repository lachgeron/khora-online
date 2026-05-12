import { useEffect, useRef } from 'react';

const SEQUENCE = ["'", "'", "'", "'", "'", '9'];
const TIMEOUT_MS = 1600;

export function useLiveSolverKeybind(onTrigger: () => void): void {
  const indexRef = useRef(0);
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }

      const now = Date.now();
      if (now - lastKeyAtRef.current > TIMEOUT_MS) {
        indexRef.current = 0;
      }
      lastKeyAtRef.current = now;

      const expected = SEQUENCE[indexRef.current];
      if (event.key === expected) {
        indexRef.current += 1;
        if (indexRef.current === SEQUENCE.length) {
          indexRef.current = 0;
          onTrigger();
        }
        return;
      }

      indexRef.current = event.key === "'" ? 1 : 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTrigger]);
}
