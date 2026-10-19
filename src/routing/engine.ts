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
  RouteLayer,
} from './types';
import { measureJumperRuns } from './metrics';
import { countJumperRuns } from './metrics';

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
      
      const connectedPads = config.allowStripRouting ? node.pad.customConnectedPads || [] : [];
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

    // Copper is shared by every pad in one uncut strip. Label those pads from
    // their component pins so a different net cannot route along that strip.
    const stripQueue = Array.from(nodes.values()).filter(node => node.netId && !node.pad.isMountingHole && !node.pad.isTrackCut);
    const visitedStripNodes = new Set<string>();
    for (const root of stripQueue) {
      const rootKey = `${root.coordinate.row},${root.coordinate.col}`;
      if (visitedStripNodes.has(rootKey)) continue;
      const queue: RoutingNode[] = [root];
      const group: RoutingNode[] = [];
      const groupNets = new Set<string>();
      visitedStripNodes.add(rootKey);
      while (queue.length) {
        const current = queue.shift()!;
        group.push(current);
        if (current.netId) groupNets.add(current.netId);
        for (const connected of current.pad.customConnectedPads || []) {
          const connectedKey = `${connected.row},${connected.col}`;
          const neighbor = nodes.get(connectedKey);
          if (!neighbor || neighbor.pad.isMountingHole || neighbor.pad.isTrackCut || visitedStripNodes.has(connectedKey)) continue;
          visitedStripNodes.add(connectedKey);
          queue.push(neighbor);
        }
      }
      if (groupNets.size === 1) {
        const stripNet = [...groupNets][0];
        for (const node of group) if (!node.netId) node.netId = stripNet;
      }
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
    reserveRoutePads(graph, route);
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
  stateKey: string;
  key: string;
  direction: string | null;
  previousType: 'wire' | 'strip' | null;
  previousLayer: RouteLayer | null;
  g: number;
  f: number;
  parent: AStarState | null;
  edge: RoutingEdge | null;
}

export function findPath(
  context: RoutingContext,
  netId: string,
  startCoord: Coordinate,
  targetCoords: Coordinate[],
  freePads: ReadonlySet<string> = new Set()
): RouteSegment[] | null {
  const { graph, config } = context;
  
  const startKey = `${startCoord.row},${startCoord.col}`;
  const targetKeys = new Set(targetCoords.map(c => `${c.row},${c.col}`));
  
  const startNode = graph.nodes.get(startKey);
  if (!startNode) return null;
  // A route may only start at a pad owned by its own net. The search checks
  // ownership when entering pads; without this guard, a conflicting pin could
  // start a path from another net's pad and escape the conflict check.
  if (startNode.netId && startNode.netId !== netId) return null;
  
  const openMap = new Map<string, AStarState>();
  const closedSet = new Set<string>();
  const gScores = new Map<string, number>();
  
  const startState: AStarState = {
    stateKey: `${startKey}|start`,
    key: startKey,
    direction: null,
    previousType: null,
    previousLayer: null,
    g: 0,
    f: routingHeuristic(startCoord, targetCoords, config),
    parent: null,
    edge: null,
  };
  
  openMap.set(startState.stateKey, startState);
  gScores.set(startState.stateKey, 0);
  
  let foundState: AStarState | null = null;
  let searched = 0;
  // The search state includes incoming direction, layer, and edge type, so its
  // size can be several times larger than the physical board graph.
  const maxSearch = Math.max(20_000, graph.nodes.size * 24);
  
  while (openMap.size > 0 && searched < maxSearch) {
    searched++;
    
    // Find node with lowest f score
    let currentStateKey = '';
    let lowestF = Infinity;
    for (const [key, state] of openMap) {
      if (state.f < lowestF) {
        lowestF = state.f;
        currentStateKey = key;
      }
    }
    
    const currentState = openMap.get(currentStateKey)!;
    openMap.delete(currentStateKey);
    closedSet.add(currentStateKey);
    
    if (targetKeys.has(currentState.key)) {
      foundState = currentState;
      break;
    }
    
    const edges = graph.edges.get(currentState.key) || [];
    
    for (const edge of edges) {
      const fromCoord = currentState.key.split(',').map(Number);
      const toCoord = edge.to.split(',').map(Number);
      const direction = `${toCoord[0] - fromCoord[0]},${toCoord[1] - fromCoord[1]}`;
      const edgeType = edge.type === 'strip' ? 'strip' : 'wire';
      const nextStateKey = `${edge.to}|${direction}|${edgeType}|${edge.layer}`;
      if (closedSet.has(nextStateKey)) continue;
      
      const neighborNode = graph.nodes.get(edge.to);
      if (!neighborNode) continue;
      
      // A pad that carries another net's signal can never be entered,
      // not even as the destination — that would silently short two nets.
      const neighborNet = neighborNode.netId;
      if (neighborNet && neighborNet !== netId) continue;
      // Never route through a component lead that is not assigned to this net.
      if (neighborNode.componentId && neighborNet !== netId) continue;
      
      // Calculate cost
      const startsJumper = edgeType === 'wire' && (
        currentState.previousType !== 'wire' || currentState.previousLayer !== edge.layer
      );
      // Wire distance must remain a real cost under every preference. The old
      // 0.001 edge cost made one bend more expensive than hundreds of holes,
      // so A* drew huge loops just to avoid turns.
      const preferenceBase = config.preference === 'minimum-jumpers'
        ? (startsJumper ? 10_000 : edge.cost)
        : edge.cost * config.lengthWeight;
      let cost = preferenceBase;
      
      // Bend penalty: if direction changes from parent edge
      if (currentState.direction && currentState.direction !== direction) {
        const bendWeight = config.preference === 'clean'
          ? Math.min(config.bendPenalty, 1.5)
          : config.preference === 'balanced'
            ? Math.min(config.bendPenalty, 0.5)
            : Math.min(config.bendPenalty, 0.2);
        cost += bendWeight;
      }
      
      // Congestion penalty
      const congestionCount = freePads.has(edge.to) ? 0 : context.congestion.get(edge.to) || 0;
      cost += congestionCount * config.congestionPenalty;
      
      const tentativeG = currentState.g + cost;
      const existingG = gScores.get(nextStateKey);
      
      if (existingG === undefined || tentativeG < existingG) {
        gScores.set(nextStateKey, tentativeG);
        
        const neighborCoord = { row: neighborNode.coordinate.row, col: neighborNode.coordinate.col };
        const h = routingHeuristic(neighborCoord, targetCoords, config);
        
        const newState: AStarState = {
          stateKey: nextStateKey,
          key: edge.to,
          direction,
          previousType: edgeType,
          previousLayer: edge.layer,
          g: tentativeG,
          f: tentativeG + h,
          parent: currentState,
          edge,
        };
        
        openMap.set(nextStateKey, newState);
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
  
  return removePathCycles(segments);
}

function removePathCycles(segments: RouteSegment[]): RouteSegment[] {
  if (segments.length < 2) return segments;
  const path = [segments[0].from];
  const result: RouteSegment[] = [];
  const visited = new Map([[`${path[0].row},${path[0].col}`, 0]]);

  for (const segment of segments) {
    const key = `${segment.to.row},${segment.to.col}`;
    const repeatedAt = visited.get(key);
    if (repeatedAt !== undefined) {
      result.splice(repeatedAt);
      for (let i = path.length - 1; i > repeatedAt; i--) {
        visited.delete(`${path[i].row},${path[i].col}`);
      }
      path.splice(repeatedAt + 1);
      continue;
    }
    result.push(segment);
    path.push(segment.to);
    visited.set(key, path.length - 1);
  }

  return result;
}

function routingHeuristic(coord: Coordinate, targets: Coordinate[], config: RoutingConfig): number {
  if (config.preference === 'minimum-jumpers') return 0;
  // Strip edges cost less than a jumper edge, so scale the Manhattan bound by
  // the cheapest possible edge to keep A*'s heuristic admissible.
  return heuristic(coord, targets) * 0.4 * config.lengthWeight;
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
  if (getConflictingPinPad(context, net.id)) return null;

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
  const treeCoordKeys = new Set(tree);
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
        const segments = findPath(context, net.id, treeCoord, [target], tree);
        if (segments) {
          const wireCount = segments.filter(segment => segment.type === 'wire').length;
          const wireLength = segments.filter(s => s.type === 'wire').reduce((sum, segment) =>
            sum + Math.abs(segment.to.row - segment.from.row) + Math.abs(segment.to.col - segment.from.col), 0);
          const cost = context.config.preference === 'minimum-jumpers'
            ? countJumperRuns(segments) * 10_000 + wireLength + segments.length * 0.01
            : segments.length + wireCount * 0.5 + (context.config.preference === 'clean' ? countBends(segments) * 1.5 : 0);
          
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
    
    // Treat every pad reached by this net as part of its connected tree.
    // Starting later branches at an existing route pad avoids drawing a second
    // wire over a segment that already connects this net.
    for (const segment of best.segments) {
      const rowStep = Math.sign(segment.to.row - segment.from.row);
      const colStep = Math.sign(segment.to.col - segment.from.col);
      const steps = Math.max(Math.abs(segment.to.row - segment.from.row), Math.abs(segment.to.col - segment.from.col));
      for (let step = 0; step <= steps; step++) {
        const coordinate = {
          row: segment.from.row + rowStep * step,
          col: segment.from.col + colStep * step,
        };
        const key = `${coordinate.row},${coordinate.col}`;
        tree.add(key);
        if (!treeCoordKeys.has(key)) {
          treeCoordKeys.add(key);
          treeCoords.push(coordinate);
        }
      }
    }
    const targetKey = `${target.row},${target.col}`;
    tree.add(targetKey);
    if (!treeCoordKeys.has(targetKey)) {
      treeCoordKeys.add(targetKey);
      treeCoords.push(target);
    }
    
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
  const uniqueSegments = new Set<string>();
  for (const pair of segmentsByPair) {
    for (const segment of pair.segments) {
      const fromKey = `${segment.from.row},${segment.from.col}`;
      const toKey = `${segment.to.row},${segment.to.col}`;
      const edgeKey = `${segment.layer}|${fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`}`;
      if (uniqueSegments.has(edgeKey)) continue;
      uniqueSegments.add(edgeKey);
      allSegments.push(segment);
    }
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
  if (context.board.config.type !== 'stripboard' || !context.config.allowStripRouting) return false;
  
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
  const pinPadConflicts = getPinPadNetConflicts(context);
  
  // Keep existing locked routes
  for (const route of context.existingRoutes) {
    const pinConflict = pinPadConflicts.find(conflict => conflict.netIds.has(route.netId));
    if (context.lockedRoutes.has(route.id) && !pinConflict) {
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
    const pinConflict = pinPadConflicts.find(conflict => conflict.netIds.has(net.id));
    if (pinConflict) {
      unroutedNets.push(net.id);
      errors.push({
        code: 'PAD_NET_CONFLICT',
        message: `Net "${net.name}" shares pad ${pinConflict.key} with a different net. Move a component lead or assign the pins to one net before routing.`,
        netId: net.id,
        coordinate: pinConflict.coordinate,
      });
      continue;
    }

    // Skip if already routed and locked
    if (context.lockedRoutes.size > 0 && 
        context.existingRoutes.some(r => r.netId === net.id && context.lockedRoutes.has(r.id))) {
      continue;
    }
    
    // Skip single-pin nets
    if (net.pins.length < 2) continue;

    if (hasStripboardNetConflict(context, net)) {
      unroutedNets.push(net.id);
      errors.push({
        code: 'STRIPBOARD_NET_CONFLICT',
        message: `Net "${net.name}" shares uncut stripboard copper with another net. Add a track cut before routing.`,
        netId: net.id,
      });
      continue;
    }
    
    const route = routeNet(context, net);
    
    if (route === null) {
      unroutedNets.push(net.id);
      errors.push({
        code: 'ROUTING_FAILED',
        message: `Failed to route net "${net.name}" — no path found. May require manual jumper placement.`,
        netId: net.id,
      });
    } else {
      reserveRoutePads(context.graph, route);
      routes.push(route);
    }
  }
  
  const jumperMetrics = measureJumperRuns(routes);
  const stats: RoutingStats = {
    totalRoutes: routes.length,
    totalWireLength: routes.reduce((sum, r) => sum + r.length, 0),
    totalBends: routes.reduce((sum, r) => sum + r.bendCount, 0),
    jumperCount: jumperMetrics.count,
    jumperLength: jumperMetrics.lengthHoles,
    totalCrossings: countCrossings(routes),
    routedNets: routes.length,
    unroutedNets: unroutedNets.length,
    timeMs: Date.now() - startTime,
  };
  
  return { routes, unroutedNets, errors, stats };
}

function hasStripboardNetConflict(context: RoutingContext, net: Net): boolean {
  if (context.board.config.type !== 'stripboard') return false;
  const allPins = new Map<string, string>();
  for (const component of context.components) {
    for (const [pinId, netId] of component.nets) {
      const coord = component.pinPositions.get(pinId);
      if (coord && netId) allPins.set(`${coord.row},${coord.col}`, netId);
    }
  }
  for (const pin of net.pins) {
    const component = context.components.find(candidate => candidate.id === pin.componentId);
    const start = component?.pinPositions.get(pin.pinId);
    if (!start) continue;
    const queue = [start];
    const visited = new Set([`${start.row},${start.col}`]);
    while (queue.length) {
      const current = queue.shift()!;
      const key = `${current.row},${current.col}`;
      if (allPins.has(key) && allPins.get(key) !== net.id) return true;
      const pad = context.board.pads.get(key);
      if (!pad || pad.isMountingHole || pad.isTrackCut) continue;
      for (const next of pad.customConnectedPads || []) {
        const nextKey = `${next.row},${next.col}`;
        const nextPad = context.board.pads.get(nextKey);
        if (!nextPad || nextPad.isMountingHole || nextPad.isTrackCut || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push(next);
      }
    }
  }
  return false;
}

function getPinPadNetConflicts(context: RoutingContext): Array<{
  key: string;
  coordinate: Coordinate;
  netIds: Set<string>;
}> {
  const pinNetsByPad = new Map<string, Set<string>>();
  for (const component of context.components) {
    for (const [pinId, coordinate] of component.pinPositions) {
      const netId = component.nets.get(pinId);
      if (!netId) continue;
      const key = `${coordinate.row},${coordinate.col}`;
      const netIds = pinNetsByPad.get(key) ?? new Set<string>();
      netIds.add(netId);
      pinNetsByPad.set(key, netIds);
    }
  }

  return [...pinNetsByPad.entries()]
    .filter(([, netIds]) => netIds.size > 1)
    .map(([key, netIds]) => {
      const [row, col] = key.split(',').map(Number);
      return { key, coordinate: { row, col }, netIds };
    });
}

function getConflictingPinPad(context: RoutingContext, netId: string) {
  return getPinPadNetConflicts(context).find(conflict => conflict.netIds.has(netId));
}

/** Reserve pads touched by a wire so a later net cannot short through them. */
function reserveRoutePads(graph: RoutingGraph, route: Route): void {
  for (const segment of route.segments) {
    if (segment.type !== 'wire') continue;
    const rowStep = Math.sign(segment.to.row - segment.from.row);
    const colStep = Math.sign(segment.to.col - segment.from.col);
    const steps = Math.max(Math.abs(segment.to.row - segment.from.row), Math.abs(segment.to.col - segment.from.col));
    for (let i = 0; i <= steps; i++) {
      const key = `${segment.from.row + rowStep * i},${segment.from.col + colStep * i}`;
      const node = graph.nodes.get(key);
      if (node && !node.netId) node.netId = route.netId;
    }
  }
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
