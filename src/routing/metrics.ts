import type { Coordinate } from '../board/types';
import type { Route, RouteSegment } from './types';

export interface JumperRun {
  id: string;
  routeId: string;
  netId: string;
  from: Coordinate;
  to: Coordinate;
  segments: RouteSegment[];
  lengthHoles: number;
  layer: 'solder' | 'component';
}

/** Return physical wire runs, joining only contiguous wire segments on one side. */
export function extractJumperRuns(route: Route): JumperRun[] {
  const runs: JumperRun[] = [];
  let current: RouteSegment[] = [];

  const finish = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    const lengthHoles = current.reduce((sum, segment) =>
      sum + Math.abs(segment.to.row - segment.from.row) + Math.abs(segment.to.col - segment.from.col), 0);
    runs.push({
      id: `${route.id}-jumper-${runs.length + 1}`,
      routeId: route.id,
      netId: route.netId,
      from: first.from,
      to: last.to,
      segments: current,
      lengthHoles,
      layer: first.layer === 'component' ? 'component' : 'solder',
    });
    current = [];
  };

  for (const segment of route.segments) {
    if (segment.type !== 'wire') {
      finish();
      continue;
    }
    const previous = current[current.length - 1];
    if (previous && (
      previous.to.row !== segment.from.row ||
      previous.to.col !== segment.from.col ||
      previous.layer !== segment.layer
    )) finish();
    current.push(segment);
  }
  finish();
  return runs;
}

export function measureJumperRuns(routes: Route[]) {
  const runs = routes.flatMap(extractJumperRuns);
  return {
    runs,
    count: runs.length,
    lengthHoles: runs.reduce((sum, run) => sum + run.lengthHoles, 0),
  };
}

export function countJumperRuns(segments: RouteSegment[]) {
  return extractJumperRuns({
    id: 'metric',
    netId: segments[0]?.netId ?? '',
    segments,
    layer: 'solder',
    length: 0,
    bendCount: 0,
    locked: false,
    manual: false,
  }).length;
}
