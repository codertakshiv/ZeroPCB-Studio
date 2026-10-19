/**
 * Electrical validation types
 */

import { BoardState, Coordinate, coordToLabel } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import { Route, RouteSegment } from '../routing/types';

export interface ValidationIssue {
  id: string;
  type: ValidationIssueType;
  severity: 'error' | 'warning' | 'info';
  message: string;
  coordinates: Coordinate[];
  componentIds: string[];
  netIds: string[];
  routeIds: string[];
  suggestion?: string;
}

export type ValidationIssueType = 
  | 'unconnected-pin'
  | 'short-circuit'
  | 'open-circuit'
  | 'pin-conflict'
  | 'component-overlap'
  | 'component-out-of-bounds'
  | 'missing-jumper'
  | 'invalid-stripboard-connection'
  | 'track-cut-conflict'
  | 'route-crossing'
  | 'route-congestion'
  | 'floating-net'
  | 'single-pin-net'
  | 'missing-footprint'
  | 'polarity-violation';

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  connectivityGraph: ConnectivityGraph;
  stats: ValidationStats;
}

export interface ConnectivityGraph {
  nodes: ConnectivityNode[];
  edges: ConnectivityEdge[];
  components: ConnectedComponent[];
}

export interface ConnectivityNode {
  id: string;
  coordinate: Coordinate;
  type: 'pad' | 'component-pin' | 'junction';
  netId?: string;
  componentId?: string;
  pinId?: string;
}

export interface ConnectivityEdge {
  from: string;
  to: string;
  type: 'trace' | 'component-lead' | 'jumper' | 'strip' | 'bridge';
  routeId?: string;
}

export interface ConnectedComponent {
  netId: string;
  nodes: string[];
  isComplete: boolean;
  missingPins: string[];
  extraConnections: string[];
}

export interface ValidationStats {
  totalPins: number;
  connectedPins: number;
  unconnectedPins: number;
  totalNets: number;
  completeNets: number;
  incompleteNets: number;
  shortCircuits: number;
  totalRoutes: number;
  totalWireLength: number;
  componentCount: number;
  overlapCount: number;
}

export function validateBoard(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[]
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const stats: ValidationStats = {
    totalPins: 0,
    connectedPins: 0,
    unconnectedPins: 0,
    totalNets: nets.length,
    completeNets: 0,
    incompleteNets: 0,
    shortCircuits: 0,
    totalRoutes: routes.length,
    totalWireLength: routes.reduce((sum, r) => sum + r.length, 0),
    componentCount: components.length,
    overlapCount: 0,
  };
  
  // Check component placement validity
  validateComponentPlacement(board, components, issues, stats);
  
  // Check pin connections
  validatePinConnections(board, components, nets, routes, issues, stats);
  
  // Check for short circuits
  validateShortCircuits(board, components, nets, routes, issues, stats);
  
  // Check routing validity
  validateRouting(board, routes, nets, issues);
  
  // Build connectivity graph
  const connectivityGraph = buildConnectivityGraph(board, components, nets, routes);
  
  // Validate connectivity per net
  validateNetConnectivity(connectivityGraph, nets, issues, stats);
  
  // Check for track cut conflicts on stripboard
  if (board.config.type === 'stripboard') {
    validateStripboard(board, components, nets, issues);
  }
  
  const isValid = issues.filter(i => i.severity === 'error').length === 0;
  
  return { isValid, issues, connectivityGraph, stats };
}

function validateComponentPlacement(
  board: BoardState,
  components: PlacedComponent[],
  issues: ValidationIssue[],
  stats: ValidationStats
): void {
  const occupiedPads = new Map<string, { componentId: string; pinId: string }>();
  
  for (const comp of components) {
    // Check bounds
    const bbox = comp.boundingBox;
    const { rows, cols } = board.config.dimensions;
    
    if (bbox.minRow < 0 || bbox.maxRow >= rows || bbox.minCol < 0 || bbox.maxCol >= cols) {
      issues.push({
        id: crypto.randomUUID(),
        type: 'component-out-of-bounds',
        severity: 'error',
        message: `Component ${comp.reference} extends beyond board boundaries`,
        coordinates: [
          { row: bbox.minRow, col: bbox.minCol },
          { row: bbox.maxRow, col: bbox.maxCol },
        ],
        componentIds: [comp.id],
        netIds: [],
        routeIds: [],
      });
    }
    
    // Check pin conflicts
    for (const [pinId, coord] of comp.pinPositions) {
      stats.totalPins++;
      const key = `${coord.row},${coord.col}`;
      const existing = occupiedPads.get(key);
      
      if (existing) {
        stats.overlapCount++;
        issues.push({
          id: crypto.randomUUID(),
          type: 'pin-conflict',
          severity: 'error',
          message: `Pin conflict: ${comp.reference} pin ${pinId} overlaps with ${existing.componentId} pin ${existing.pinId} at ${coordToLabel(coord)}`,
          coordinates: [coord],
          componentIds: [comp.id, existing.componentId],
          netIds: [],
          routeIds: [],
        });
      } else {
        occupiedPads.set(key, { componentId: comp.id, pinId });
      }
      
      // Check if pad is a mounting hole
      const pad = board.pads.get(key);
      if (pad?.isMountingHole) {
        issues.push({
          id: crypto.randomUUID(),
          type: 'pin-conflict',
          severity: 'error',
          message: `Component ${comp.reference} pin ${pinId} placed on mounting hole at ${coordToLabel(coord)}`,
          coordinates: [coord],
          componentIds: [comp.id],
          netIds: [],
          routeIds: [],
        });
      }
    }
  }
}

function validatePinConnections(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[],
  issues: ValidationIssue[],
  stats: ValidationStats
): void {
  const netPinMap = new Map<string, Set<string>>(); // netId -> set of pin coordinates
  
  // Collect all pins per net from components
  for (const net of nets) {
    const pinCoords = new Set<string>();
    for (const pin of net.pins) {
      const comp = components.find(c => c.id === pin.componentId);
      if (!comp) continue;
      const coord = comp.pinPositions.get(pin.pinId);
      if (coord) {
        pinCoords.add(`${coord.row},${coord.col}`);
        stats.connectedPins++;
      } else {
        stats.unconnectedPins++;
        issues.push({
          id: crypto.randomUUID(),
          type: 'unconnected-pin',
          severity: 'error',
          message: `Pin ${pin.pinNumber} (${pin.pinName}) of ${pin.componentId} has no physical position`,
          coordinates: [],
          componentIds: [pin.componentId],
          netIds: [net.id],
          routeIds: [],
        });
      }
    }
    netPinMap.set(net.id, pinCoords);
  }
  
  // Collect connected pads from routes
  for (const route of routes) {
    for (const segment of route.segments) {
      const fromKey = `${segment.from.row},${segment.from.col}`;
      const toKey = `${segment.to.row},${segment.to.col}`;
      
      const netPins = netPinMap.get(route.netId);
      if (netPins) {
        netPins.add(fromKey);
        netPins.add(toKey);
      }
    }
  }
}

function validateShortCircuits(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[],
  issues: ValidationIssue[],
  stats: ValidationStats
): void {
  // Check for pads connected to multiple nets
  const padNetMap = new Map<string, Set<string>>(); // pad key -> netIds
  
  // Component pins
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const key = `${coord.row},${coord.col}`;
      const netId = comp.nets.get(pinId);
      if (netId) {
        const set = padNetMap.get(key) || new Set();
        set.add(netId);
        padNetMap.set(key, set);
      }
    }
  }
  
  // Route segments
  for (const route of routes) {
    for (const segment of route.segments) {
      const fromKey = `${segment.from.row},${segment.from.col}`;
      const toKey = `${segment.to.row},${segment.to.col}`;
      
      for (const key of [fromKey, toKey]) {
        const set = padNetMap.get(key) || new Set();
        set.add(route.netId);
        padNetMap.set(key, set);
      }
    }
  }
  
  // Stripboard strips merge every net that touches the same run of holes
  if (board.config.type === 'stripboard') {
    forEachStripRun(board, (run) => {
      const netsOnRun = new Set<string>();
      for (const coord of run) {
        const key = `${coord.row},${coord.col}`;
        const pad = board.pads.get(key);
        if (pad?.netId) netsOnRun.add(pad.netId);
        for (const netId of padNetMap.get(key) || []) netsOnRun.add(netId);
      }
      
      if (netsOnRun.size > 1) {
        stats.shortCircuits++;
        issues.push({
          id: crypto.randomUUID(),
          type: 'short-circuit',
          severity: 'error',
          message: `Strip from ${coordToLabel(run[0])} to ${coordToLabel(run[run.length - 1])} connects nets ${Array.from(netsOnRun).join(', ')}`,
          coordinates: [run[0], run[run.length - 1]],
          componentIds: [],
          netIds: Array.from(netsOnRun),
          routeIds: [],
        });
      }
    });
  }
  
  // Report shorts
  for (const [padKey, netIds] of padNetMap) {
    if (netIds.size > 1) {
      stats.shortCircuits++;
      const [row, col] = padKey.split(',').map(Number);
      issues.push({
        id: crypto.randomUUID(),
        type: 'short-circuit',
        severity: 'error',
        message: `Short circuit at ${coordToLabel({ row, col })}: nets ${Array.from(netIds).join(', ')} are connected`,
        coordinates: [{ row, col }],
        componentIds: [],
        netIds: Array.from(netIds),
        routeIds: [],
      });
    }
  }
}

function validateRouting(
  board: BoardState,
  routes: Route[],
  nets: Net[],
  issues: ValidationIssue[]
): void {
  for (const route of routes) {
    // A route is a connected set of wire segments, not necessarily a single
    // walk: multi-pin nets are routed as chained legs that may revisit a
    // previous endpoint. Verify the cells touched by the segments form one
    // connected component and report any disconnected fragment as a gap.
    const parent = new Map<string, string>();
    const findRoot = (key: string): string => {
      let root = key;
      while (parent.get(root) !== root) root = parent.get(root)!;
      // Path compression
      let cursor = key;
      while (parent.get(cursor) !== root) {
        const next = parent.get(cursor)!;
        parent.set(cursor, root);
        cursor = next;
      }
      return root;
    };
    const addCell = (row: number, col: number): string => {
      const key = `${row},${col}`;
      if (!parent.has(key)) parent.set(key, key);
      return key;
    };
    
    for (const segment of route.segments) {
      const a = addCell(segment.from.row, segment.from.col);
      const b = addCell(segment.to.row, segment.to.col);
      const rootA = findRoot(a);
      const rootB = findRoot(b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    }
    
    const roots = new Map<string, Coordinate>();
    for (const key of Array.from(parent.keys())) {
      const root = findRoot(key);
      if (!roots.has(root)) {
        const [row, col] = key.split(',').map(Number);
        roots.set(root, { row, col });
      }
    }
    
    if (roots.size > 1) {
      const gapAt = Array.from(roots.values())[1];
      issues.push({
        id: crypto.randomUUID(),
        type: 'open-circuit',
        severity: 'error',
        message: `Route for net ${netName(nets, route.netId)} has a gap at ${coordToLabel(gapAt)} (${roots.size} disconnected wire fragments)`,
        coordinates: [gapAt],
        componentIds: [],
        netIds: [route.netId],
        routeIds: [route.id],
      });
    }
    
    // Check for excessive bends
    if (route.bendCount > 10) {
      issues.push({
        id: crypto.randomUUID(),
        type: 'route-congestion',
        severity: 'warning',
        message: `Route for net ${netName(nets, route.netId)} has ${route.bendCount} bends`,
        coordinates: route.segments.map(s => s.from),
        componentIds: [],
        netIds: [route.netId],
        routeIds: [route.id],
      });
    }
    
    // Check route length
    if (route.length > 200) {
      issues.push({
        id: crypto.randomUUID(),
        type: 'route-congestion',
        severity: 'warning',
        message: `Route for net ${netName(nets, route.netId)} is very long (${route.length} holes)`,
        coordinates: route.segments.map(s => s.from),
        componentIds: [],
        netIds: [route.netId],
        routeIds: [route.id],
      });
    }
  }
  
  // Check for route crossings (same layer, different nets)
  const segmentMap = new Map<string, (RouteSegment & { routeId: string })[]>();
  for (const route of routes) {
    for (const segment of route.segments) {
      const key = `${segment.layer}:${Math.min(segment.from.row, segment.to.row)},${Math.min(segment.from.col, segment.to.col)}-${Math.max(segment.from.row, segment.to.row)},${Math.max(segment.from.col, segment.to.col)}`;
      const existing = segmentMap.get(key) || [];
      existing.push({ ...segment, routeId: route.id });
      segmentMap.set(key, existing);
    }
  }
  
  for (const [key, segments] of segmentMap) {
    if (segments.length > 1) {
      const nets = new Set(segments.map(s => s.netId));
      if (nets.size > 1) {
        const [from, to] = key.split(':')[1].split('-');
        const [fr, fc] = from.split(',').map(Number);
        const [tr, tc] = to.split(',').map(Number);
        issues.push({
          id: crypto.randomUUID(),
          type: 'route-crossing',
          severity: 'warning',
          message: `Routes cross at ${coordToLabel({ row: fr, col: fc })}: nets ${Array.from(nets).join(', ')}`,
          coordinates: [{ row: fr, col: fc }, { row: tr, col: tc }],
          componentIds: [],
          netIds: Array.from(nets),
          routeIds: segments.map(s => s.routeId),
        });
      }
    }
  }
}

function validateNetConnectivity(
  graph: ConnectivityGraph,
  nets: Net[],
  issues: ValidationIssue[],
  stats: ValidationStats
): void {
  for (const component of graph.components) {
    const net = nets.find(n => n.id === component.netId);
    if (!net) continue;
    
    if (!component.isComplete) {
      stats.incompleteNets++;
      issues.push({
        id: crypto.randomUUID(),
        type: 'open-circuit',
        severity: 'error',
        message: `Net "${net.name}" is not fully connected. Missing pins: ${component.missingPins.join(', ')}`,
        coordinates: [],
        componentIds: [],
        netIds: [net.id],
        routeIds: [],
      });
    } else {
      stats.completeNets++;
    }
    
    if (net.pins.length === 1 && !net.isPower && !net.isGround) {
      issues.push({
        id: crypto.randomUUID(),
        type: 'single-pin-net',
        severity: 'warning',
        message: `Net "${net.name}" has only one connection`,
        coordinates: [],
        componentIds: [],
        netIds: [net.id],
        routeIds: [],
      });
    }
  }
}

/**
 * Walk the stripboard copper strips and invoke the visitor once per
 * contiguous run of copper-connected holes.
 * 
 * A run ends at a track cut (the copper is severed) or at a mounting hole
 * (drilled through the strip). Only meaningful for stripboard boards.
 */
function forEachStripRun(board: BoardState, visit: (run: Coordinate[]) => void): void {
  const { rows, cols } = board.config.dimensions;
  const horizontal = (board.config.stripDirection || 'horizontal') === 'horizontal';
  
  const breaksRun = (coord: Coordinate): boolean => {
    const pad = board.pads.get(`${coord.row},${coord.col}`);
    return !pad || pad.isTrackCut || pad.isMountingHole;
  };
  
  const flush = (run: Coordinate[]): void => {
    if (run.length > 0) visit(run);
  };
  
  if (horizontal) {
    for (let r = 0; r < rows; r++) {
      let run: Coordinate[] = [];
      for (let c = 0; c < cols; c++) {
        if (breaksRun({ row: r, col: c })) {
          flush(run);
          run = [];
        } else {
          run.push({ row: r, col: c });
        }
      }
      flush(run);
    }
  } else {
    for (let c = 0; c < cols; c++) {
      let run: Coordinate[] = [];
      for (let r = 0; r < rows; r++) {
        if (breaksRun({ row: r, col: c })) {
          flush(run);
          run = [];
        } else {
          run.push({ row: r, col: c });
        }
      }
      flush(run);
    }
  }
}

function validateStripboard(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  issues: ValidationIssue[]
): void {
  // Check for track cuts that conflict with component leads
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const pad = board.pads.get(`${coord.row},${coord.col}`);
      if (pad?.isTrackCut) {
        const pin = comp.footprint.pins.find(p => p.id === pinId);
        issues.push({
          id: crypto.randomUUID(),
          type: 'track-cut-conflict',
          severity: 'error',
          message: `Track cut at ${coordToLabel(coord)} conflicts with ${comp.reference} pin ${pin?.number ?? pinId}`,
          coordinates: [coord],
          componentIds: [comp.id],
          netIds: [],
          routeIds: [],
        });
      }
    }
  }
  
  // Nets present on each hole (from pad assignments and placed component pins)
  const pinNetByKey = new Map<string, string | undefined>();
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      pinNetByKey.set(`${coord.row},${coord.col}`, comp.nets.get(pinId));
    }
  }
  
  // Every hole on a contiguous strip is electrically common: if two
  // different nets touch the same strip, the board has an unintended short.
  forEachStripRun(board, (run) => {
    const netsOnRun = new Set<string>();
    for (const coord of run) {
      const key = `${coord.row},${coord.col}`;
      const pad = board.pads.get(key);
      const netId = pad?.netId ?? pinNetByKey.get(key);
      if (netId) netsOnRun.add(netId);
    }
    
    if (netsOnRun.size > 1) {
      const netNames = Array.from(netsOnRun)
        .map(id => nets.find(n => n.id === id)?.name || id);
      issues.push({
        id: crypto.randomUUID(),
        type: 'invalid-stripboard-connection',
        severity: 'error',
        message: `Strip from ${coordToLabel(run[0])} to ${coordToLabel(run[run.length - 1])} connects multiple nets: ${netNames.join(', ')}. Add a track cut to isolate them.`,
        coordinates: [run[0], run[run.length - 1]],
        componentIds: [],
        netIds: Array.from(netsOnRun),
        routeIds: [],
        suggestion: 'Cut the strip between the conflicting pins',
      });
    }
  });
}

function buildConnectivityGraph(
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[]
): ConnectivityGraph {
  const nodes: ConnectivityNode[] = [];
  const edges: ConnectivityEdge[] = [];
  const nodeMap = new Map<string, string>(); // coordinate key -> node id
  
  // Add component pins as nodes
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const key = `${coord.row},${coord.col}`;
      const nodeId = `pin-${comp.id}-${pinId}`;
      nodes.push({
        id: nodeId,
        coordinate: coord,
        type: 'component-pin',
        netId: comp.nets.get(pinId),
        componentId: comp.id,
        pinId,
      });
      nodeMap.set(key, nodeId);
    }
  }
  
  // Add route segments as edges and junction nodes
  for (const route of routes) {
    for (const segment of route.segments) {
      const fromKey = `${segment.from.row},${segment.from.col}`;
      const toKey = `${segment.to.row},${segment.to.col}`;
      
      let fromNodeId = nodeMap.get(fromKey);
      let toNodeId = nodeMap.get(toKey);
      
      if (!fromNodeId) {
        fromNodeId = `junction-${fromKey}`;
        nodes.push({
          id: fromNodeId,
          coordinate: segment.from,
          type: 'junction',
          netId: route.netId,
        });
        nodeMap.set(fromKey, fromNodeId);
      }
      
      if (!toNodeId) {
        toNodeId = `junction-${toKey}`;
        nodes.push({
          id: toNodeId,
          coordinate: segment.to,
          type: 'junction',
          netId: route.netId,
        });
        nodeMap.set(toKey, toNodeId);
      }
      
      edges.push({
        from: fromNodeId,
        to: toNodeId,
        type: segment.type === 'track' ? 'strip' : 'jumper',
        routeId: route.id,
      });
    }
  }
  
  // Add stripboard connections as edges
  if (board.config.type === 'stripboard') {
    for (const [key, pad] of board.pads) {
      if (pad.customConnectedPads && !pad.isTrackCut) {
        const fromNodeId = nodeMap.get(key) || `pad-${key}`;
        if (!nodeMap.has(key)) {
          nodes.push({
            id: fromNodeId,
            coordinate: pad.coordinate,
            type: 'pad',
            netId: pad.netId,
          });
          nodeMap.set(key, fromNodeId);
        }
        
        for (const connected of pad.customConnectedPads) {
          const connKey = `${connected.row},${connected.col}`;
          let toNodeId = nodeMap.get(connKey);
          
          if (!toNodeId) {
            toNodeId = `pad-${connKey}`;
            const connPad = board.pads.get(connKey);
            nodes.push({
              id: toNodeId,
              coordinate: connected,
              type: 'pad',
              netId: connPad?.netId,
            });
            nodeMap.set(connKey, toNodeId);
          }
          
          edges.push({
            from: fromNodeId,
            to: toNodeId,
            type: 'strip',
          });
        }
      }
    }
  }
  
  // Find connected components per net
  const components_: ConnectedComponent[] = [];

  for (const net of nets) {
    const netNodes = nodes.filter(n => n.netId === net.id).map(n => n.id);
    if (netNodes.length === 0) continue;
    
    const componentNodes: string[] = [];
    const queue = [netNodes[0]];
    const componentVisited = new Set<string>();
    
    while (queue.length > 0) {
      const nodeId = queue.pop()!;
      if (componentVisited.has(nodeId)) continue;
      componentVisited.add(nodeId);
      componentNodes.push(nodeId);
      
      // Find connected nodes
      for (const edge of edges) {
        if (edge.from === nodeId && !componentVisited.has(edge.to)) {
          const targetNode = nodes.find(n => n.id === edge.to);
          if (targetNode && (targetNode.netId === net.id || !targetNode.netId)) {
            queue.push(edge.to);
          }
        }
        if (edge.to === nodeId && !componentVisited.has(edge.from)) {
          const targetNode = nodes.find(n => n.id === edge.from);
          if (targetNode && (targetNode.netId === net.id || !targetNode.netId)) {
            queue.push(edge.from);
          }
        }
      }
    }
    
    const missingPins = net.pins
      .map(p => `pin-${p.componentId}-${p.pinId}`)
      .filter(id => !componentVisited.has(id));
    
    components_.push({
      netId: net.id,
      nodes: componentNodes,
      isComplete: missingPins.length === 0,
      missingPins,
      extraConnections: [],
    });
  }
  
  return { nodes, edges, components: components_ };
}

function netName(nets: Net[], netId: string): string {
  return nets.find(n => n.id === netId)?.name || netId;
}

export type { Coordinate } from '../board/types';
export type { BoardState } from '../board/types';
export type { PlacedComponent } from '../footprints/types';
export type { Net } from '../circuit/types';
export type { Route } from '../routing/types';