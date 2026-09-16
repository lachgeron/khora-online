import { describe, expect, it } from 'vitest';
import { analysisBudget } from './useScoreSolver';

describe('live analysis time budget', () => {
  it('leaves time to act and never blocks on an expired deadline', () => {
    expect(analysisBudget(10_000, 1_000)).toBe(7_000);
    expect(analysisBudget(10_000, 9_000)).toBe(50);
    expect(analysisBudget(10_000, 11_000)).toBe(50);
    expect(analysisBudget(undefined)).toBe(30_000);
    expect(analysisBudget(100_000, 0)).toBe(30_000);
  });
});
