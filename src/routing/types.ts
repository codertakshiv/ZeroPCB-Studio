/**
 * Routing engine types
 * (Implementation in engine.ts)
 */

import { BoardState, Coordinate, Pad } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';

export interface RouteSegment {
  from: Coordinate;
  to: Coordinate;
  layer: RouteLayer;
  netId: string;
  type: 'wire' | 'bridge' | 'component-lead' | 'track';
}

export type RouteLayer = 'solder' | 'component' | 'strip';

export interface Route {
  id: string;
  netId: string;
  segments: RouteSegment[];
  layer: RouteLayer;
  length: number;
  bendCount: number;
  locked: boolean;
  manual: boolean;
}

export interface RoutingGraph {
  nodes: Map<string, RoutingNode>;
  edges: Map<string, RoutingEdge[]>;
}

export interface RoutingNode {
  coordinate: Coordinate;
  pad: Pad;
  componentId?: string;
  pinId?: string;
  isOccupied: boolean;
  netId?: string;
}

export interface RoutingEdge {
  from: string;
  to: string;
  cost: number;
  layer: RouteLayer;
  type: 'adjacent' | 'strip' | 'bridge';
}

export interface RoutingConfig {
  allowSolderSide: boolean;
  allowComponentSide: boolean;
  allowStripRouting: boolean;
  maxBendsPerRoute: number;
  maxRouteLength: number;
  crossingPenalty: number;
  bendPenalty: number;
  lengthWeight: number;
  congestionPenalty: number;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  allowSolderSide: true,
  allowComponentSide: false,
  allowStripRouting: true,
  maxBendsPerRoute: 10,
  maxRouteLength: 200,
  crossingPenalty: 10,
  bendPenalty: 2,
  lengthWeight: 1,
  congestionPenalty: 5,
};

export interface RoutingResult {
  routes: Route[];
  unroutedNets: string[];
  errors: RoutingError[];
  stats: RoutingStats;
}

export interface RoutingError {
  code: string;
  message: string;
  netId?: string;
  coordinate?: Coordinate;
}

export interface RoutingStats {
  totalRoutes: number;
  totalWireLength: number;
  totalBends: number;
  totalCrossings: number;
  routedNets: number;
  unroutedNets: number;
  timeMs: number;
}

export interface RoutingContext {
  board: BoardState;
  components: PlacedComponent[];
  nets: Net[];
  existingRoutes: Route[];
  lockedRoutes: Set<string>;
  config: RoutingConfig;
  graph: RoutingGraph;
  congestion: Map<string, number>;
}

export type { BoardState, Coordinate } from '../board/types';
export type { PlacedComponent } from '../footprints/types';
export type { Net } from '../circuit/types';