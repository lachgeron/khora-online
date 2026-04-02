import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerService } from './timer-service';

describe('TimerService', () => {
  let service: TimerService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new TimerService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startTimer', () => {
    it('calls onTimeout after duration expires', () => {
      const onTimeout = vi.fn();
      service.startTimer('g1', 'p1', 1000, onTimeout);
      expect(onTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('replaces existing timer for same player', () => {
      const onTimeout1 = vi.fn();
      const onTimeout2 = vi.fn();
      service.startTimer('g1', 'p1', 1000, onTimeout1);
      service.startTimer('g1', 'p1', 2000, onTimeout2);
      vi.advanceTimersByTime(1000);
      expect(onTimeout1).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onTimeout2).toHaveBeenCalledOnce();
    });
  });

  describe('cancelTimer', () => {
    it('prevents onTimeout from firing', () => {
      const onTimeout = vi.fn();
      service.startTimer('g1', 'p1', 1000, onTimeout);
      service.cancelTimer('g1', 'p1');
      vi.advanceTimersByTime(2000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('is safe to call when no timer exists', () => {
      expect(() => service.cancelTimer('g1', 'p1')).not.toThrow();
    });
  });

  describe('getRemainingTime', () => {
    it('returns 0 when no timer is active', () => {
      expect(service.getRemainingTime('g1', 'p1')).toBe(0);
    });

    it('returns remaining time', () => {
      service.startTimer('g1', 'p1', 5000, vi.fn());
      vi.advanceTimersByTime(2000);
      const remaining = service.getRemainingTime('g1', 'p1');
      expect(remaining).toBe(3000);
    });

    it('returns 0 after timer expires', () => {
      service.startTimer('g1', 'p1', 1000, vi.fn());
      vi.advanceTimersByTime(1500);
      expect(service.getRemainingTime('g1', 'p1')).toBe(0);
    });
  });

  it('supports multiple independent timers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    service.startTimer('g1', 'p1', 1000, cb1);
    service.startTimer('g1', 'p2', 2000, cb2);
    vi.advanceTimersByTime(1000);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb2).toHaveBeenCalledOnce();
  });
});
