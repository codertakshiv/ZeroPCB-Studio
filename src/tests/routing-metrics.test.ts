import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/types';
import { extractJumperRuns, measureJumperRuns } from '../routing/metrics';

const route: Route = {
  id: 'r1',
  netId: 'n1',
  layer: 'solder',
  segments: [
    { from: { row: 1, col: 1 }, to: { row: 1, col: 2 }, layer: 'solder', netId: 'n1', type: 'wire' },
    { from: { row: 1, col: 2 }, to: { row: 2, col: 2 }, layer: 'solder', netId: 'n1', type: 'wire' },
    { from: { row: 2, col: 2 }, to: { row: 2, col: 3 }, layer: 'strip', netId: 'n1', type: 'track' },
    { from: { row: 2, col: 3 }, to: { row: 2, col: 4 }, layer: 'solder', netId: 'n1', type: 'wire' },
  ],
  length: 3,
  bendCount: 1,
  locked: false,
  manual: false,
};

describe('Physical jumper metrics', () => {
  it('groups only connected wire edges on the same board side', () => {
    const runs = extractJumperRuns(route);
    expect(runs).toHaveLength(2);
    expect(runs.map(run => [run.from, run.to, run.lengthHoles])).toEqual([
      [{ row: 1, col: 1 }, { row: 2, col: 2 }, 2],
      [{ row: 2, col: 3 }, { row: 2, col: 4 }, 1],
    ]);
  });

  it('reports jumper count and length from physical runs', () => {
    expect(measureJumperRuns([route])).toMatchObject({ count: 2, lengthHoles: 3 });
  });
});
