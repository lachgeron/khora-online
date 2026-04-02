import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('server package setup', () => {
  it('vitest runs correctly', () => {
    expect(true).toBe(true);
  });

  it('fast-check is available', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return n * 0 === 0;
      }),
      { numRuns: 100 },
    );
  });
});
