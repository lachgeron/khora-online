import { useEffect, useRef, useState } from 'react';

/**
 * Detects the secret admin key sequence: ' pressed 5 times, then 1.
 * Returns whether admin mode is active and a function to deactivate it.
 */
export function useAdminMode() {
  const [active, setActive] = useState(false);
  const sequenceRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = e.key;

      // Reset sequence after 2 seconds of inactivity
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        sequenceRef.current = [];
      }, 2000);

      sequenceRef.current.push(key);

      // Keep only the last 6 keys
      if (sequenceRef.current.length > 6) {
        sequenceRef.current = sequenceRef.current.slice(-6);
      }

      const seq = sequenceRef.current;
      if (
        seq.length === 6 &&
        seq[0] === "'" &&
        seq[1] === "'" &&
        seq[2] === "'" &&
        seq[3] === "'" &&
        seq[4] === "'" &&
        seq[5] === '1'
      ) {
        setActive(true);
        sequenceRef.current = [];
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const deactivate = () => setActive(false);

  return { adminMode: active, deactivateAdmin: deactivate };
}
