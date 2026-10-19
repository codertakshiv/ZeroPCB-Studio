/**
 * Real electrical routing engine
 * 
 * Uses A* graph search over the board's hole connectivity graph.
 * - For perfboard: each pad is a node; adjacent pads are connected by high-cost edges
 *   (representing possible jumper wires).
 * - For stripboard: pads on the same uncut strip are connected by low-cost edges.
 * 
 * Routing is congestion-aware and bend-penalized.
 */

import { BoardState, Coordinate } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import {
  RoutingConfig,
  DEFAULT_ROUTING_CONFIG,
  RoutingGraph,
  RoutingNode,
  RoutingEdge,
  RoutingContext,
  RoutingResult,
  RoutingError,
  RoutingStats,
  Route,
  RouteSegment,
} from './types';

export function createRoutingGraph(
  board: BoardState,
  components: PlacedComponent[],
  config: RoutingConfig
): RoutingGraph {
  const nodes = new Map<string, RoutingNode>();
  const edges = new Map<string, RoutingEdge[]>();
  
  // Create nodes for all pads
  for (const [key, pad] of board.pads) {
    const node: RoutingNode = {
      coordinate: pad.coordinate,
      pad,
      isOccupied: pad.isMountingHole,
      netId: pad.netId,
      componentId: pad.componentId,
      pinId: pad.pinId,
    };
    nodes.set(key, node);
  }
  
  // Mark component lead pads as occupied with their net
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const key = `${coord.row},${coord.col}`;
      const node = nodes.get(key);
      if (node) {
        node.isOccupied = true;
        node.componentId = comp.id;
        node.pinId = pinId;
        node.netId = comp.nets.get(pinId) || node.netId;
      }
    }
  }
  
  // Create edges for adjacent holes (jumper-wire routing)
  const useSolder = config.allowSolderSide;
  const useComponent = config.allowComponentSide;
  
  if (useSolder || useComponent) {
    for (const [key, node] of nodes) {
      const neighbors = getAdjacentCoordinates(node.coordinate, board.config.dimensions);
      const nodeEdges: RoutingEdge[] = [];
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.row},${neighbor.col}`;
        const neighborNode = nodes.get(neighborKey);
        if (!neighborNode) continue;
        
        // Skip mounting holes
        if (node.pad.isMountingHole || neighborNode.pad.isMountingHole) continue;
        
        nodeEdges.push({
          from: key,
          to: neighborKey,
          cost: 1,
          layer: useSolder ? 'solder' : 'component',
          type: 'adjacent',
        });
      }
      
      if (nodeEdges.length > 0) {
        edges.set(key, nodeEdges);
      }
    }
  }
  
  // Create edges for stripboard copper strips
  if (board.config.type === 'stripboard') {
    for (const [key, node] of nodes) {
      if (node.pad.isMountingHole) continue;
      
      const connectedPads = node.pad.customConnectedPads || [];
      const nodeEdges = edges.get(key) || [];
      
      for (const connected of connectedPads) {
        const connectedKey = `${connected.row},${connected.col}`;
        const connectedNode = nodes.get(connectedKey);
        if (!connectedNode || connectedNode.pad.isMountingHole) continue;
        
        // Check if either end has the track cut
        if (node.pad.isTrackCut || connectedNode.pad.isTrackCut) continue;
        
        nodeEdges.push({
          from: key,
          to: connectedKey,
          cost: 0.4, // Strip connections are preferred (cheaper than jumpers)
          layer: 'strip',
          type: 'strip',
        });
      }
      
      edges.set(key, nodeEdges);
    }
  }
  
  return { nodes, edges };
}

function getAdjacentCoordinates(
  coord: Coordinate,
  dimensions: { rows: number; cols: number }
): Coordinate[] {
  const { rows, cols } = dimensions;
  const neighbors: Coordinate[] = [];
  
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];
  
  for (const { dr, dc } of directions) {
    const nr = coord.row + dr;
    const nc = coord.col + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      neighbors.push({ row: nr, col: nc });
    }
  }
  
  return neighbors;
}

export function createRoutingContext(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  existingRoutes: Route[],
  lockedRoutes: Set<string>,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG
): RoutingContext {
  const graph = createRoutingGraph(board, components, config);
  const congestion = new Map<string, number>();
  
  // Pre-populate congestion from existing locked routes
  for (const route of existingRoutes) {
    if (!lockedRoutes.has(route.id)) continue;
    for (const segment of route.segments) {
      const key = `${segment.to.row},${segment.to.col}`;
      congestion.set(key, (congestion.get(key) || 0) + 1);
    }
  }
  
  return {
    board,
    components,
    nets,
    existingRoutes,
    lockedRoutes,
    config,
    graph,
    congestion,
  };
}

interface AStarState {
  key: string;
  g: number;
  f: number;
  parent: AStarState | null;
  edge: RoutingEdge | null;
}

export function findPath(
  context: RoutingContext,
  netId: string,
  startCoord: Coordinate,
  targetCoords: Coordinate[]
): RouteSegment[] | null {
  const { graph, config } = context;
  
  const startKey = `${startCoord.row},${startCoord.col}`;
  const targetKeys = new Set(targetCoords.map(c => `${c.row},${c.col}`));
  
  const startNode = graph.nodes.get(startKey);
  if (!startNode) return null;
  
  const openMap = new Map<string, AStarState>();
  const closedSet = new Set<string>();
  const gScores = new Map<string, number>();
  
  const startState: AStarState = {
    key: startKey,
    g: 0,
    f: heuristic(startCoord, targetCoords),
    parent: null,
    edge: null,
  };
  
  openMap.set(startKey, startState);
  gScores.set(startKey, 0);
  
  let foundState: AStarState | null = null;
  let searched = 0;
  const maxSearch = 20000;
  
  while (openMap.size > 0 && searched < maxSearch) {
    searched++;
    
    // Find node with lowest f score
    let currentKey = '';
    let lowestF = Infinity;
    for (const [key, state] of openMap) {
      if (state.f < lowestF) {
        lowestF = state.f;
        currentKey = key;
      }
    }
    
    const currentState = openMap.get(currentKey)!;
    openMap.delete(currentKey);
    closedSet.add(currentKey);
    
    if (targetKeys.has(currentKey)) {
      foundState = currentState;
      break;
    }
    
    const edges = graph.edges.get(currentKey) || [];
    
    for (const edge of edges) {
      if (closedSet.has(edge.to)) continue;
      
      const neighborNode = graph.nodes.get(edge.to);
      if (!neighborNode) continue;
      
      // A pad that carries another net's signal can never be entered,
      // not even as the destination — that would silently short two nets.
      const neighborNet = neighborNode.netId;
      if (neighborNet && neighborNet !== netId) continue;
      
      // Calculate cost
      let cost = edge.cost * config.lengthWeight;
      
      // Bend penalty: if direction changes from parent edge
      const parentEdge = currentState.edge;
      if (parentEdge && isDirectionChange(parentEdge, edge)) {
        cost += config.bendPenalty;
      }
      
      // Congestion penalty
      const congestionCount = context.congestion.get(edge.to) || 0;
      cost += congestionCount * config.congestionPenalty;
      
      // Unless this is a strip connection (strips don't consume wire)
      if (edge.type !== 'strip') {
        cost += config.crossingPenalty * 0.01; // Minimal crossing cost here; handled later
      }
      
      const tentativeG = currentState.g + cost;
      const existingG = gScores.get(edge.to);
      
      if (existingG === undefined || tentativeG < existingG) {
        gScores.set(edge.to, tentativeG);
        
        const neighborCoord = { row: neighborNode.coordinate.row, col: neighborNode.coordinate.col };
        const h = heuristic(neighborCoord, targetCoords);
        
        const newState: AStarState = {
          key: edge.to,
          g: tentativeG,
          f: tentativeG + h,
          parent: currentState,
          edge,
        };
        
        openMap.set(edge.to, newState);
      }
    }
  }
  
  if (!foundState) return null;
  
  // Reconstruct path
  const segments: RouteSegment[] = [];
  let state: AStarState | null = foundState;
  
  while (state && state.parent) {
    const edge = state.edge!;
    const fromCoord = state.parent.key.split(',').map(Number);
    const toCoord = state.key.split(',').map(Number);
    
    segments.unshift({
      from: { row: fromCoord[0], col: fromCoord[1] },
      to: { row: toCoord[0], col: toCoord[1] },
      layer: edge.layer,
      netId,
      type: edge.type === 'strip' ? 'track' : 'wire',
    });
    
    state = state.parent;
  }
  
  return segments;
}

function isDirectionChange(prev: RoutingEdge, next: RoutingEdge): boolean {
  const prevFrom = prev.from.split(',').map(Number);
  const prevTo = prev.to.split(',').map(Number);
  const nextTo = next.to.split(',').map(Number);
  
  const prevDr = prevTo[0] - prevFrom[0];
  const prevDc = prevTo[1] - prevFrom[1];
  const nextDr = nextTo[0] - prevTo[0];
  const nextDc = nextTo[1] - prevTo[1];
  
  return prevDr !== nextDr || prevDc !== nextDc;
}

function heuristic(coord: Coordinate, targets: Coordinate[]): number {
  let minDist = Infinity;
  for (const target of targets) {
    const dist = Math.abs(coord.row - target.row) + Math.abs(coord.col - target.col);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export function routeNet(context: RoutingContext, net: Net): Route | null {
  // Get physical coordinates of all pins in this net
  const pinCoords: Coordinate[] = [];
  const seen = new Set<string>();
  
  for (const pin of net.pins) {
    const comp = context.components.find(c => c.id === pin.componentId);
    if (!comp) continue;
    const coord = comp.pinPositions.get(pin.pinId);
    if (coord) {
      const key = `${coord.row},${coord.col}`;
      if (!seen.has(key)) {
        seen.add(key);
        pinCoords.push(coord);
      }
    }
  }
  
  if (pinCoords.length < 2) {
    // Check if net has implicit stripboard connectivity (all pins on same strip)
    return null;
  }
  
  // Check if existing strip connectivity already connects all pins
  if (areAllPinsConnectedViaStrips(context, net.id, pinCoords)) {
    return {
      id: crypto.randomUUID(),
      netId: net.id,
      segments: [],
      layer: 'strip',
      length: 0,
      bendCount: 0,
      locked: false,
      manual: false,
    };
  }
  
  // Build MST using A* pathfinding between pins
  const segmentsByPair: { from: Coordinate; to: Coordinate; segments: RouteSegment[] }[] = [];
  const tree = new Set<string>([`${pinCoords[0].row},${pinCoords[0].col}`]);
  const treeCoords: Coordinate[] = [pinCoords[0]];
  const remaining = pinCoords.slice(1);
  
  while (remaining.length > 0) {
    let best: { targetIdx: number; treeCoord: Coordinate; segments: RouteSegment[]; cost: number } | null = null;
    
    for (let i = 0; i < remaining.length; i++) {
      const target = remaining[i];
      const targetKey = `${target.row},${target.col}`;
      
      // Skip if already connected via strips
      if (tree.has(targetKey)) {
        remaining.splice(i, 1);
        i--;
        continue;
      }
      
      for (const treeCoord of treeCoords) {
        const segments = findPath(context, net.id, treeCoord, [target]);
        if (segments) {
          const cost = segments.length + segments.filter(s => s.type === 'wire').length * 0.5;
          
          // Also check if strip connectivity handles this for free
          if (cost < (best?.cost ?? Infinity) || !best) {
            best = { targetIdx: i, treeCoord, segments, cost };
          }
        }
      }
    }
    
    if (!best) {
      // Can't complete the routing for this net
      return null;
    }
    
    const target = remaining[best.targetIdx];
    segmentsByPair.push({ from: best.treeCoord, to: target, segments: best.segments });
    
    // Update tree and congestion
    treeCoords.push(target);
    tree.add(`${target.row},${target.col}`);
    
    for (const segment of best.segments) {
      if (segment.type === 'wire') {
        const key = `${segment.to.row},${segment.to.col}`;
        context.congestion.set(key, (context.congestion.get(key) || 0) + 1);
      }
    }
    
    remaining.splice(best.targetIdx, 1);
  }
  
  // Merge all segments into a single route
  const allSegments: RouteSegment[] = [];
  for (const pair of segmentsByPair) {
    allSegments.push(...pair.segments);
  }
  
  if (allSegments.length === 0) {
    // All connections handled by strips
    return {
      id: crypto.randomUUID(),
      netId: net.id,
      segments: [],
      layer: 'strip',
      length: 0,
      bendCount: 0,
      locked: false,
      manual: false,
    };
  }
  
  let length = 0;
  for (const segment of allSegments) {
    if (segment.type === 'wire') {
      length += Math.abs(segment.from.row - segment.to.row) + 
                Math.abs(segment.from.col - segment.to.col);
    }
  }
  
  const bendCount = countBends(allSegments);
  
  return {
    id: crypto.randomUUID(),
    netId: net.id,
    segments: allSegments,
    layer: 'solder',
    length,
    bendCount,
    locked: false,
    manual: false,
  };
}

function areAllPinsConnectedViaStrips(
  context: RoutingContext,
  netId: string,
  pinCoords: Coordinate[]
): boolean {
  if (context.board.config.type !== 'stripboard') return false;
  
  // BFS through strip connections only
  const visited = new Set<string>();
  const queue: Coordinate[] = [pinCoords[0]];
  visited.add(`${pinCoords[0].row},${pinCoords[0].col}`);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.row},${current.col}`;
    const pad = context.board.pads.get(key);
    if (!pad || pad.isTrackCut) continue;
    
    const connected = pad.customConnectedPads || [];
    for (const conn of connected) {
      const connKey = `${conn.row},${conn.col}`;
      if (visited.has(connKey)) continue;
      
      const connPad = context.board.pads.get(connKey);
      if (!connPad || connPad.isTrackCut) continue;
      
      visited.add(connKey);
      queue.push(conn);
    }
  }
  
  return pinCoords.every(c => visited.has(`${c.row},${c.col}`));
}

function countBends(segments: RouteSegment[]): number {
  let bends = 0;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    
    const prevDr = prev.to.row - prev.from.row;
    const prevDc = prev.to.col - prev.from.col;
    const currDr = curr.to.row - curr.from.row;
    const currDc = curr.to.col - curr.from.col;
    
    if (prevDr !== currDr || prevDc !== currDc) {
      bends++;
    }
  }
  return bends;
}

export function routeAllNets(context: RoutingContext): RoutingResult {
  const startTime = Date.now();
  const routes: Route[] = [];
  const unroutedNets: string[] = [];
  const errors: RoutingError[] = [];
  
  // Keep existing locked routes
  for (const route of context.existingRoutes) {
    if (context.lockedRoutes.has(route.id)) {
      routes.push(route);
    }
  }
  
  // Sort nets by priority
  const sortedNets = [...context.nets].sort((a, b) => {
    if (a.isPower && !b.isPower) return -1;
    if (!a.isPower && b.isPower) return 1;
    if (a.isGround && !b.isGround) return -1;
    if (!a.isGround && b.isGround) return 1;
    return b.pins.length - a.pins.length;
  });
  
  for (const net of sortedNets) {
    // Skip if already routed and locked
    if (context.lockedRoutes.size > 0 && 
        context.existingRoutes.some(r => r.netId === net.id && context.lockedRoutes.has(r.id))) {
      continue;
    }
    
    // Skip single-pin nets
    if (net.pins.length < 2) continue;
    
    const route = routeNet(context, net);
    
    if (route === null) {
      unroutedNets.push(net.id);
      errors.push({
        code: 'ROUTING_FAILED',
        message: `Failed to route net "${net.name}" — no path found. May require manual jumper placement.`,
        netId: net.id,
      });
    } else {
      routes.push(route);
    }
  }
  
  const stats: RoutingStats = {
    totalRoutes: routes.length,
    totalWireLength: routes.reduce((sum, r) => sum + r.length, 0),
    totalBends: routes.reduce((sum, r) => sum + r.bendCount, 0),
    totalCrossings: countCrossings(routes),
    routedNets: routes.length,
    unroutedNets: unroutedNets.length,
    timeMs: Date.now() - startTime,
  };
  
  return { routes, unroutedNets, errors, stats };
}

function countCrossings(routes: Route[]): number {
  let crossings = 0;
  const wireMap = new Map<string, string[]>();
  
  for (const route of routes) {
    for (const segment of route.segments) {
      if (segment.type !== 'wire') continue;
      // For perpendicular segments, check crossing
      const key = normalizeSegmentKey(segment);
      const list = wireMap.get(key) || [];
      list.push(route.netId);
      wireMap.set(key, list);
    }
  }
  
  for (const [, netIds] of wireMap) {
    const uniqueNets = new Set(netIds);
    if (uniqueNets.size > 1) {
      crossings += netIds.length - 1;
    }
  }
  
  return crossings;
}

function normalizeSegmentKey(segment: RouteSegment): string {
  const r1 = Math.min(segment.from.row, segment.to.row);
  const c1 = Math.min(segment.from.col, segment.to.col);
  const r2 = Math.max(segment.from.row, segment.to.row);
  const c2 = Math.max(segment.from.col, segment.to.col);
  return `${segment.layer}:${r1},${c1}-${r2},${c2}`;
}

export { DEFAULT_ROUTING_CONFIG };
export type { RoutingConfig, RoutingContext, RoutingResult, Route } from './types';