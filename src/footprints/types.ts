/**
 * Component and footprint type definitions
 */

import { Coordinate } from '../board/types';

export interface Pin {
  id: string;
  number: string;
  name: string;
  offset: Coordinate;
  isPolarized?: boolean;
  polarity?: 'anode' | 'cathode' | 'positive' | 'negative' | 'input' | 'output';
}

export interface Footprint {
  id: string;
  name: string;
  description: string;
  category: ComponentCategory;
  pins: Pin[];
  width: number; // in grid units (cols)
  height: number; // in grid units (rows)
  bodyOutline?: BodyOutline;
  supportedOrientations: Orientation[];
  defaultOrientation: Orientation;
  pinSpacing: { row: number; col: number };
  isPolarized: boolean;
  polarizationMark?: PolarizationMark;
  metadata?: Record<string, unknown>;
}

export interface BodyOutline {
  type: 'rectangle' | 'circle' | 'custom';
  width: number;
  height: number;
  customPath?: string; // SVG path
}

export interface PolarizationMark {
  type: 'notch' | 'dot' | 'stripe' | 'flat';
  position: Coordinate;
  size: number;
}

export type Orientation = 0 | 90 | 180 | 270;

export type ComponentCategory = 
  | 'resistor'
  | 'capacitor'
  | 'polarized-capacitor'
  | 'led'
  | 'diode'
  | 'transistor'
  | 'mosfet'
  | 'ic-dip'
  | 'ic-socket'
  | 'pin-header'
  | 'screw-terminal'
  | 'connector'
  | 'switch'
  | 'push-button'
  | 'potentiometer'
  | 'crystal'
  | 'voltage-regulator'
  | 'custom';

export interface Component {
  id: string;
  footprintId: string;
  reference: string; // e.g., "R1", "C2", "U1"
  value?: string; // e.g., "10k", "100uF", "ATmega328P"
  position: Coordinate;
  orientation: Orientation;
  locked: boolean;
  nets: Map<string, string>; // pinId -> netId
  metadata?: Record<string, unknown>;
}

export interface PlacedComponent extends Component {
  footprint: Footprint;
  pinPositions: Map<string, Coordinate>; // pinId -> board coordinate
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Rotate a coordinate around a center point.
 * 
 * Convention: positive rotation (90°) is CLOCKWISE in screen space, where
 * rows increase downward and columns increase rightward — e.g. a point one
 * hole to the RIGHT of the center moves to one hole BELOW it.
 * This matches `rotatePoint()` in board/transforms.ts and the UI rotate action.
 */
export function rotateCoordinate(coord: Coordinate, center: Coordinate, orientation: Orientation): Coordinate {
  const { row, col } = coord;
  const { row: cr, col: cc } = center;
  const dr = row - cr;
  const dc = col - cc;
  
  let newDr: number, newDc: number;
  
  switch (orientation) {
    case 0:
      newDr = dr;
      newDc = dc;
      break;
    case 90:
      // Clockwise: (dr, dc) -> (dc, -dr)
      newDr = dc;
      newDc = -dr;
      break;
    case 180:
      newDr = -dr;
      newDc = -dc;
      break;
    case 270:
      // Counterclockwise: (dr, dc) -> (-dc, dr)
      newDr = -dc;
      newDc = dr;
      break;
    default:
      newDr = dr;
      newDc = dc;
  }
  
  return { row: cr + newDr, col: cc + newDc };
}

export function getRotatedPinPositions(footprint: Footprint, position: Coordinate, orientation: Orientation): Map<string, Coordinate> {
  const pinPositions = new Map<string, Coordinate>();
  
  for (const pin of footprint.pins) {
    const rotatedOffset = rotateCoordinate(pin.offset, { row: 0, col: 0 }, orientation);
    const pinCoord = {
      row: position.row + rotatedOffset.row,
      col: position.col + rotatedOffset.col,
    };
    pinPositions.set(pin.id, pinCoord);
  }
  
  return pinPositions;
}

export function getComponentBoundingBox(position: Coordinate, orientation: Orientation, footprint: Footprint): BoundingBox {
  const pinPositions = getRotatedPinPositions(footprint, position, orientation);
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  
  for (const coord of pinPositions.values()) {
    minRow = Math.min(minRow, coord.row);
    maxRow = Math.max(maxRow, coord.row);
    minCol = Math.min(minCol, coord.col);
    maxCol = Math.max(maxCol, coord.col);
  }
  
  return { minRow, maxRow, minCol, maxCol };
}

export function checkOverlap(comp1: PlacedComponent, comp2: PlacedComponent): boolean {
  return !(
    comp1.boundingBox.maxRow < comp2.boundingBox.minRow ||
    comp1.boundingBox.minRow > comp2.boundingBox.maxRow ||
    comp1.boundingBox.maxCol < comp2.boundingBox.minCol ||
    comp1.boundingBox.minCol > comp2.boundingBox.maxCol
  );
}

export function checkPinConflict(comp1: PlacedComponent, comp2: PlacedComponent): Coordinate[] {
  const conflicts: Coordinate[] = [];
  for (const [, coord1] of comp1.pinPositions) {
    for (const [, coord2] of comp2.pinPositions) {
      if (coord1.row === coord2.row && coord1.col === coord2.col) {
        conflicts.push(coord1);
      }
    }
  }
  return conflicts;
}

// ============ FOOTPRINT REGISTRY ============
// Single registry for all footprints (standard + custom)

const footprintRegistry: Map<string, Footprint> = new Map();

export function registerFootprint(footprint: Footprint): void {
  footprintRegistry.set(footprint.id, footprint);
}

export function getFootprintById(id: string): Footprint | undefined {
  return footprintRegistry.get(id);
}

export function getAllFootprints(): Footprint[] {
  return Array.from(footprintRegistry.values());
}

export function getFootprintsByCategory(category: ComponentCategory): Footprint[] {
  return Array.from(footprintRegistry.values()).filter(f => f.category === category);
}

export function searchFootprintRegistry(query: string): Footprint[] {
  const q = query.toLowerCase();
  return Array.from(footprintRegistry.values()).filter(f =>
    f.id.toLowerCase().includes(q) ||
    f.name.toLowerCase().includes(q) ||
    f.description.toLowerCase().includes(q) ||
    f.category.toLowerCase().includes(q)
  );
}

export function clearFootprintRegistry(): void {
  footprintRegistry.clear();
}

export type { Coordinate } from '../board/types';