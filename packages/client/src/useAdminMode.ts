import { useEffect, useRef, useState } from 'react';

export type AdminPanel = 'cards' | 'events' | null;

/**
 * Detects secret admin key sequences:
 *   ' x5 then 1 → card swap panel
 *   ' x5 then 2 → event reorder panel
 *
 * Completely invisible to players — no UI hint that this exists.
 */
export function useAdminMode() {
  const [activePanel, setActivePanel] = useState<AdminPanel>(null);
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
        seq[4] === "'"
      ) {
        if (seq[5] === '1') {
          setActivePanel('cards');
          sequenceRef.current = [];
        } else if (seq[5] === '2') {
          setActivePanel('events');
          sequenceRef.current = [];
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const deactivate = () => setActivePanel(null);

  return { adminPanel: activePanel, deactivateAdmin: deactivate };
}
