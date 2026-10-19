/**
 * Automatic component placement engine
 * 
 * Algorithm phases:
 * 1. Constraint-based initial placement (large/edge components first)
 * 2. Connectivity-aware greedy placement with candidate scoring
 * 3. Simulated annealing refinement
 * 4. Legality validation
 * 
 * The engine is deterministic: identical inputs + seed produce identical results.
 */

import { BoardState, Coordinate, coordToLabel } from '../board/types';
import { 
  Footprint, 
  PlacedComponent, 
  Orientation,
  getRotatedPinPositions,
  getComponentBoundingBox,
  BoundingBox,
} from '../footprints/types';
import { Circuit, Net } from '../circuit/types';
import { 
  PlacementConfig, 
  PlacementResult, 
  PlacementError,
  PlacementSpec,
  DEFAULT_PLACEMENT_CONFIG,
  SeededRandom,
} from './types';

interface Candidate {
  position: Coordinate;
  orientation: Orientation;
  score: number;
  pinPositions: Map<string, Coordinate>;
  boundingBox: BoundingBox;
}

const EDGE_CATEGORIES = new Set(['connector', 'screw-terminal', 'barrel-jack', 'pin-header']);

export function placeComponents(
  board: BoardState,
  circuit: Circuit,
  componentFootprints: { component: PlacementSpec; footprint: Footprint }[],
  nets: Net[],
  existingPlacement: PlacedComponent[] = [],
  config: PlacementConfig = DEFAULT_PLACEMENT_CONFIG
): PlacementResult {
  const startTime = Date.now();
  const rng = new SeededRandom(config.seed);
  const errors: PlacementError[] = [];
  
  const { rows, cols } = board.config.dimensions;
  
  // Validate that all components can fit
  const totalPins = componentFootprints.reduce((sum, cf) => sum + cf.footprint.pins.length, 0);
  const availableHoles = rows * cols - board.config.mountingHoles.length;
  
  if (totalPins > availableHoles) {
    return {
      placedComponents: existingPlacement,
      score: -Infinity,
      iterations: 0,
      timeMs: Date.now() - startTime,
      success: false,
      errors: [{
        code: 'BOARD_TOO_SMALL',
        message: `Board is too small: ${totalPins} pins required, only ${availableHoles} holes available`,
      }],
      unplacedComponents: componentFootprints.map(cf => cf.component),
    };
  }
  
  // Start with locked components from existing placement
  const lockedComponents = existingPlacement.filter(c => c.locked);
  const placed: PlacedComponent[] = [...lockedComponents];
  const unplaced = componentFootprints.filter(cf => 
    !lockedComponents.some(lc => lc.id === cf.component.id)
  );
  
  // Sort components: edge components first, then by pin count descending
  const sortedComponents = [...unplaced].sort((a, b) => {
    const aEdge = EDGE_CATEGORIES.has(a.footprint.category) ? 0 : 1;
    const bEdge = EDGE_CATEGORIES.has(b.footprint.category) ? 0 : 1;
    if (aEdge !== bEdge) return aEdge - bEdge;
    return b.footprint.pins.length - a.footprint.pins.length;
  });
  
  // Phase 1 & 2: Greedy placement with candidate scoring
  const unplacedComponents: PlacementSpec[] = [];
  
  for (const { component, footprint } of sortedComponents) {
    const candidate = findBestPosition(
      component, footprint, board, placed, nets, config, rng
    );
    
    if (!candidate) {
      unplacedComponents.push(component);
      errors.push({
        code: 'NO_VALID_POSITION',
        message: `Cannot place ${component.reference} (${footprint.name}): no valid position found`,
        componentId: component.id,
      });
      continue;
    }
    
    const placedComponent: PlacedComponent = {
      id: component.id,
      footprintId: component.footprintId,
      reference: component.reference,
      value: component.value,
      position: candidate.position,
      orientation: candidate.orientation,
      locked: false,
      nets: new Map(component.nets),
      footprint,
      pinPositions: candidate.pinPositions,
      boundingBox: candidate.boundingBox,
    };
    
    placed.push(placedComponent);
  }
  
  // Phase 3: Simulated annealing (if intensity allows)
  let iterations = sortedComponents.length;
  if (config.intensity !== 'fast' && placed.length > 1) {
    const annealResult = simulatedAnnealing(
      placed, board, nets, config, rng, 
      config.intensity === 'thorough' ? 3 : 1
    );
    iterations += annealResult.iterations;
    // Use the annealed placement
    placed.length = 0;
    placed.push(...annealResult.placed);
  }
  
  // Phase 4: Final validation
  const validationErrors = validatePlacement(placed, board);
  errors.push(...validationErrors);
  
  // Calculate final score
  const score = calculateTotalScore(placed, nets);
  
  return {
    placedComponents: placed,
    score,
    iterations,
    timeMs: Date.now() - startTime,
    success: errors.filter(e => e.code !== 'NO_VALID_POSITION').length === 0 && unplacedComponents.length === 0,
    errors,
    unplacedComponents,
  };
}

function findBestPosition(
  component: PlacementSpec,
  footprint: Footprint,
  board: BoardState,
  placed: PlacedComponent[],
  nets: Net[],
  config: PlacementConfig,
  rng: SeededRandom
): Candidate | null {
  const candidates: Candidate[] = [];
  const { rows, cols } = board.config.dimensions;
  
  const orientations = footprint.supportedOrientations;
  
  for (const orientation of orientations) {
    // Calculate rotated dimensions
    const rotatedWidth = (orientation === 90 || orientation === 270) ? footprint.height : footprint.width;
    const rotatedHeight = (orientation === 90 || orientation === 270) ? footprint.width : footprint.height;
    
    const maxRow = rows - rotatedHeight;
    const maxCol = cols - rotatedWidth;
    
    if (maxRow < 0 || maxCol < 0) continue; // Component doesn't fit
    
    // Sample positions - full scan for thorough, sampled for fast
    const rowStep = config.intensity === 'thorough' ? 1 : (config.intensity === 'standard' ? 1 : 2);
    const colStep = rowStep;
    
    const positions: Coordinate[] = [];
    for (let r = 0; r <= maxRow; r += rowStep) {
      for (let c = 0; c <= maxCol; c += colStep) {
        positions.push({ row: r, col: c });
      }
    }
    
    // For fast mode, limit positions
    const sampledPositions = config.intensity === 'fast' 
      ? rng.shuffle(positions).slice(0, 50)
      : positions;
    
    for (const position of sampledPositions) {
      const pinPositions = getRotatedPinPositions(footprint, position, orientation);
      const boundingBox = getComponentBoundingBox(position, orientation, footprint);
      
      // Check legality
      if (!isPlacementLegal(pinPositions, boundingBox, board, placed)) {
        continue;
      }
      
      const score = scoreCandidate(
        component, footprint, position, orientation, 
        pinPositions, boundingBox, placed, nets, board, config
      );
      
      candidates.push({ position, orientation, score, pinPositions, boundingBox });
    }
  }
  
  if (candidates.length === 0) return null;
  
  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  
  // Add some randomness for non-locked components (helps escape local minima)
  const topN = Math.min(3, candidates.length);
  const selectedIndex = rng.nextInt(topN);
  
  return candidates[selectedIndex];
}

function isPlacementLegal(
  pinPositions: Map<string, Coordinate>,
  boundingBox: BoundingBox,
  board: BoardState,
  placed: PlacedComponent[]
): boolean {
  const { rows, cols } = board.config.dimensions;
  
  // Check bounds
  if (boundingBox.minRow < 0 || boundingBox.maxRow >= rows ||
      boundingBox.minCol < 0 || boundingBox.maxCol >= cols) {
    return false;
  }
  
  // Check all pins are on valid pads
  for (const coord of pinPositions.values()) {
    const pad = board.pads.get(`${coord.row},${coord.col}`);
    if (!pad) return false;
    if (pad.isMountingHole) return false;
  }
  
  // Check conflicts with placed components
  for (const other of placed) {
    // Check pin-to-pin conflicts
    for (const coord of pinPositions.values()) {
      for (const otherCoord of other.pinPositions.values()) {
        if (coord.row === otherCoord.row && coord.col === otherCoord.col) {
          return false;
        }
      }
    }
    
    // Check bounding box overlap (with 0 spacing requirement for now)
    if (!(boundingBox.maxRow < other.boundingBox.minRow ||
          boundingBox.minRow > other.boundingBox.maxRow ||
          boundingBox.maxCol < other.boundingBox.minCol ||
          boundingBox.minCol > other.boundingBox.maxCol)) {
      // Bounding boxes overlap - check if they actually use the same holes
      // For components like resistors that only occupy pins, this might be OK
      // But for now, be conservative and require no overlap
      const sameHoles = checkHoleOverlap(pinPositions, other.pinPositions);
      if (sameHoles) return false;
    }
  }
  
  return true;
}

function checkHoleOverlap(
  pins1: Map<string, Coordinate>,
  pins2: Map<string, Coordinate>
): boolean {
  for (const coord of pins1.values()) {
    for (const otherCoord of pins2.values()) {
      if (coord.row === otherCoord.row && coord.col === otherCoord.col) {
        return true;
      }
    }
  }
  return false;
}

function scoreCandidate(
  component: PlacementSpec,
  footprint: Footprint,
  position: Coordinate,
  orientation: Orientation,
  pinPositions: Map<string, Coordinate>,
  boundingBox: BoundingBox,
  placed: PlacedComponent[],
  nets: Net[],
  board: BoardState,
  config: PlacementConfig
): number {
  const { weights } = config;
  const { rows, cols } = board.config.dimensions;
  
  let score = 0;
  let connectionCount = 0;
  let totalDistance = 0;
  
  // Wire length & grouping: find connected components
  for (const net of nets) {
    const compPins = net.pins.filter(p => p.componentId === component.id);
    if (compPins.length === 0) continue;
    
    for (const pin of compPins) {
      const myCoord = pinPositions.get(pin.pinId);
      if (!myCoord) continue;
      
      for (const otherPin of net.pins) {
        if (otherPin.componentId === component.id) continue;
        const otherComp = placed.find(c => c.id === otherPin.componentId);
        if (!otherComp) continue;
        
        const otherCoord = otherComp.pinPositions.get(otherPin.pinId);
        if (!otherCoord) continue;
        
        const dist = Math.abs(myCoord.row - otherCoord.row) + Math.abs(myCoord.col - otherCoord.col);
        totalDistance += dist;
        connectionCount++;
      }
    }
  }
  
  // Wire length score (shorter is better)
  if (connectionCount > 0) {
    const avgDistance = totalDistance / connectionCount;
    score += weights.wireLength * (1 / (1 + avgDistance / 5));
  } else {
    score += weights.wireLength * 0.5;
  }
  
  // Edge preference for connectors
  if (EDGE_CATEGORIES.has(footprint.category)) {
    const edgeDistance = Math.min(
      boundingBox.minRow,
      rows - 1 - boundingBox.maxRow,
      boundingBox.minCol,
      cols - 1 - boundingBox.maxCol
    );
    score += weights.edgeClearance * (1 / (1 + edgeDistance));
  } else {
    // Prefer not too close to edges (keeps room for mounting)
    const edgeDistance = Math.min(
      boundingBox.minRow,
      rows - 1 - boundingBox.maxRow,
      boundingBox.minCol,
      cols - 1 - boundingBox.maxCol
    );
    score += weights.edgeClearance * Math.min(1, edgeDistance / 4) * 0.5;
  }
  
  // Alignment: prefer positions aligned with already placed components
  let alignmentBonus = 0;
  for (const other of placed) {
    if (boundingBox.minRow === other.boundingBox.minRow) alignmentBonus += 0.3;
    if (boundingBox.maxRow === other.boundingBox.maxRow) alignmentBonus += 0.3;
    if (boundingBox.minCol === other.boundingBox.minCol) alignmentBonus += 0.3;
    if (boundingBox.maxCol === other.boundingBox.maxCol) alignmentBonus += 0.3;
  }
  score += weights.alignment * Math.min(1, alignmentBonus) * 0.5;
  
  // Spacing: prefer some breathing room
  let minClearance = Infinity;
  for (const other of placed) {
    const rowClearance = Math.max(
      boundingBox.minRow - other.boundingBox.maxRow - 1,
      other.boundingBox.minRow - boundingBox.maxRow - 1,
      0
    );
    const colClearance = Math.max(
      boundingBox.minCol - other.boundingBox.maxCol - 1,
      other.boundingBox.minCol - boundingBox.maxCol - 1,
      0
    );
    const clearance = rowClearance + colClearance;
    minClearance = Math.min(minClearance, clearance);
  }
  if (minClearance !== Infinity) {
    // Ideal clearance is 1-2 holes
    const clearanceScore = minClearance === 0 ? 0.5 : 
                          minClearance <= 2 ? 1.0 : 
                          Math.max(0, 1 - (minClearance - 2) / 10);
    score += weights.footprintSpacing * clearanceScore;
  }
  
  // Neatness mode: strong preference for straight alignment
  if (config.mode === 'max-neatness') {
    let straightConnections = 0;
    for (const net of nets) {
      const compPins = net.pins.filter(p => p.componentId === component.id);
      for (const pin of compPins) {
        const myCoord = pinPositions.get(pin.pinId);
        if (!myCoord) continue;
        for (const otherPin of net.pins) {
          if (otherPin.componentId === component.id) continue;
          const otherComp = placed.find(c => c.id === otherPin.componentId);
          if (!otherComp) continue;
          const otherCoord = otherComp.pinPositions.get(otherPin.pinId);
          if (!otherCoord) continue;
          if (myCoord.row === otherCoord.row || myCoord.col === otherCoord.col) {
            straightConnections++;
          }
        }
      }
    }
    if (connectionCount > 0) {
      score += 2.0 * (straightConnections / connectionCount);
    }
  }
  
  // Min-wire mode: strong preference for compact placement
  if (config.mode === 'min-wire') {
    score += weights.wireLength * (connectionCount > 0 ? 1 / (1 + totalDistance / connectionCount / 3) : 0.5);
  }
  
  return score;
}

function simulatedAnnealing(
  placed: PlacedComponent[],
  board: BoardState,
  nets: Net[],
  config: PlacementConfig,
  rng: SeededRandom,
  passes: number
): { placed: PlacedComponent[]; iterations: number } {
  const startTime = Date.now();
  let current = [...placed.map(p => ({ ...p }))];
  let currentScore = calculateTotalScore(current, nets);
  let iterations = 0;
  
  const movable = current.filter(c => !c.locked);
  if (movable.length < 2) return { placed: current, iterations };
  
  const iterationsPerPass = config.intensity === 'thorough' ? 500 : 200;
  const maxIterations = iterationsPerPass * passes;
  
  let temperature = 10.0;
  const coolingRate = 0.995;
  const minTemperature = 0.01;
  
  while (iterations < maxIterations && temperature > minTemperature) {
    if (Date.now() - startTime > config.timeLimitMs) break; // Time limit
    
    iterations++;
    temperature *= coolingRate;
    
    // Pick a random movable component
    const idx = rng.nextInt(movable.length);
    const component = movable[idx];
    
    // Try a move: shift position or rotate
    const moveType = rng.next();
    let newPosition = { ...component.position };
    let newOrientation = component.orientation;
    
    if (moveType < 0.7) {
      // Position shift
      const dr = rng.nextInt(5) - 2;
      const dc = rng.nextInt(5) - 2;
      newPosition = { row: component.position.row + dr, col: component.position.col + dc };
    } else {
      // Rotation
      const orientations = component.footprint.supportedOrientations;
      newOrientation = orientations[rng.nextInt(orientations.length)];
    }
    
    // Calculate new position data
    const newPinPositions = getRotatedPinPositions(component.footprint, newPosition, newOrientation);
    const newBoundingBox = getComponentBoundingBox(
      newPosition,
      newOrientation,
      component.footprint
    );
    
    // Check legality against other components (excluding self)
    const others = current.filter(c => c.id !== component.id);
    if (!isPlacementLegal(newPinPositions, newBoundingBox, board, others)) {
      continue;
    }
    
    // Score new configuration
    const newComponent: PlacedComponent = {
      ...component,
      position: newPosition,
      orientation: newOrientation,
      pinPositions: newPinPositions,
      boundingBox: newBoundingBox,
    };
    
    const newPlaced = current.map(c => c.id === component.id ? newComponent : c);
    const newScore = calculateTotalScore(newPlaced, nets);
    const delta = newScore - currentScore;
    
    // Accept if better, or with probability if worse
    if (delta > 0 || rng.next() < Math.exp(delta / temperature)) {
      current = newPlaced;
      currentScore = newScore;
    }
  }
  
  return { placed: current, iterations };
}

function calculateTotalScore(
  placed: PlacedComponent[],
  nets: Net[]
): number {
  let score = 0;
  
  // Wire length component
  let totalWireLength = 0;
  for (const net of nets) {
    const pinCoords: Coordinate[] = [];
    for (const pin of net.pins) {
      const comp = placed.find(c => c.id === pin.componentId);
      if (!comp) continue;
      const coord = comp.pinPositions.get(pin.pinId);
      if (coord) pinCoords.push(coord);
    }
    
    // Use MST length as approximation of wire length
    if (pinCoords.length >= 2) {
      totalWireLength += calculateMSTLength(pinCoords);
    }
  }
  
  score -= totalWireLength * 0.1;
  
  // Compactness component
  const bbox = getPlacementBoundingBox(placed);
  if (bbox) {
    const area = (bbox.maxRow - bbox.minRow + 1) * (bbox.maxCol - bbox.minCol + 1);
    score += 100 / (1 + area / 100);
  }
  
  return score;
}

function calculateMSTLength(coords: Coordinate[]): number {
  if (coords.length < 2) return 0;
  
  const inTree = new Set<number>([0]);
  let totalLength = 0;
  
  while (inTree.size < coords.length) {
    let minDist = Infinity;
    let bestIdx = -1;
    
    for (const treeIdx of inTree) {
      for (let i = 0; i < coords.length; i++) {
        if (inTree.has(i)) continue;
        const dist = Math.abs(coords[treeIdx].row - coords[i].row) + 
                     Math.abs(coords[treeIdx].col - coords[i].col);
        if (dist < minDist) {
          minDist = dist;
          bestIdx = i;
        }
      }
    }
    
    if (bestIdx === -1) break;
    inTree.add(bestIdx);
    totalLength += minDist;
  }
  
  return totalLength;
}

function getPlacementBoundingBox(placed: PlacedComponent[]): BoundingBox | null {
  if (placed.length === 0) return null;
  
  let minRow = Infinity, maxRow = -Infinity;
  let minCol = Infinity, maxCol = -Infinity;
  
  for (const comp of placed) {
    minRow = Math.min(minRow, comp.boundingBox.minRow);
    maxRow = Math.max(maxRow, comp.boundingBox.maxRow);
    minCol = Math.min(minCol, comp.boundingBox.minCol);
    maxCol = Math.max(maxCol, comp.boundingBox.maxCol);
  }
  
  return { minRow, maxRow, minCol, maxCol };
}

function validatePlacement(
  placed: PlacedComponent[],
  board: BoardState
): PlacementError[] {
  const errors: PlacementError[] = [];
  const { rows, cols } = board.config.dimensions;
  
  // Check all components are within bounds
  for (const comp of placed) {
    const { minRow, maxRow, minCol, maxCol } = comp.boundingBox;
    if (minRow < 0 || maxRow >= rows || minCol < 0 || maxCol >= cols) {
      errors.push({
        code: 'OUT_OF_BOUNDS',
        message: `${comp.reference} extends beyond board boundaries`,
        componentId: comp.id,
      });
    }
  }
  
  // Check for pin conflicts
  const pinMap = new Map<string, string[]>();
  for (const comp of placed) {
    for (const [pinId, coord] of comp.pinPositions) {
      const key = `${coord.row},${coord.col}`;
      const list = pinMap.get(key) || [];
      list.push(`${comp.reference}:${pinId}`);
      pinMap.set(key, list);
    }
  }
  
  for (const [key, pins] of pinMap) {
    if (pins.length > 1) {
      const [row, col] = key.split(',').map(Number);
      errors.push({
        code: 'PIN_CONFLICT',
        message: `Pin conflict at ${coordToLabel({ row, col })}: ${pins.join(', ')}`,
        coordinate: { row, col },
      });
    }
  }
  
  return errors;
}

export type { Coordinate } from '../board/types';
export type { Component, Footprint, PlacedComponent } from '../footprints/types';
export type { Net } from '../circuit/types';