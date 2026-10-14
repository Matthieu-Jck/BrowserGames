import { describe, it, expect } from 'vitest';
import { beltPath, dirTo } from './belt-path';

describe('ribbon drag paths', () => {
  it('a click lays one tile in the tool rotation', () => {
    expect(beltPath(5, 5, 5, 5, false, 3)).toEqual([[5, 5, 3]]);
  });

  it('a straight drag points every tile along the drag', () => {
    expect(beltPath(2, 4, 5, 4, false, 0)).toEqual([[2, 4, 1], [3, 4, 1], [4, 4, 1], [5, 4, 1]]);
    expect(beltPath(3, 6, 3, 3, false, 0).map((p) => p[2])).toEqual([0, 0, 0, 0]);
  });

  it('an L goes along x first, or y first once flipped, and turns at the corner', () => {
    const a = beltPath(0, 0, 2, 2, false, 0);
    expect(a.map(([x, y]) => [x, y])).toEqual([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
    expect(a.map((p) => p[2])).toEqual([1, 1, 2, 2, 2]);
    const b = beltPath(0, 0, 2, 2, true, 0);
    expect(b.map(([x, y]) => [x, y])).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);
    expect(b.map((p) => p[2])).toEqual([2, 2, 1, 1, 1]);
  });

  it('runs backwards too, each tile adjacent to the next', () => {
    const p = beltPath(6, 6, 2, 1, false, 0);
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i]![0] - p[i - 1]![0]) + Math.abs(p[i]![1] - p[i - 1]![1])).toBe(1);
    expect(p[0]![2]).toBe(dirTo(-1, 0));
  });
});
