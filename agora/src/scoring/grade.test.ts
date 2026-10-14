import { describe, it, expect } from 'vitest';
import { scorePrediction, severityFromRatio, gradeLetter, starsFromSeverity } from './grade';

describe('scorePrediction', () => {
  it('nails an exact answer with 3 stars', () => {
    const s = scorePrediction(60, 60, 8);
    expect(s.severity).toBe('nailed');
    expect(s.stars).toBe(3);
    expect(s.error).toBe(0);
  });

  it('calls a wild miss catastrophic with 0 stars', () => {
    const s = scorePrediction(10, 60, 8); // 50 off, > 3 tolerances
    expect(s.severity).toBe('catastrophic');
    expect(s.stars).toBe(0);
  });

  it('is monotonic — a worse guess never scores better', () => {
    let prev = 4;
    for (let guess = 60; guess <= 120; guess += 5) {
      const stars = scorePrediction(guess, 60, 8).stars;
      expect(stars).toBeLessThanOrEqual(prev);
      prev = stars;
    }
  });

  it('respects the band boundaries', () => {
    expect(severityFromRatio(0.5)).toBe('nailed');
    expect(severityFromRatio(0.51)).toBe('close');
    expect(severityFromRatio(1.5)).toBe('close');
    expect(severityFromRatio(1.51)).toBe('wrong');
    expect(severityFromRatio(3)).toBe('wrong');
    expect(severityFromRatio(3.01)).toBe('catastrophic');
  });
});

describe('grade helpers', () => {
  it('maps severities to stars', () => {
    expect(starsFromSeverity('nailed')).toBe(3);
    expect(starsFromSeverity('catastrophic')).toBe(0);
  });

  it('maps average stars to letters', () => {
    expect(gradeLetter(3)).toBe('A');
    expect(gradeLetter(0)).toBe('F');
    expect(gradeLetter(1.7)).toBe('B');
  });
});
