/**
 * Core board geometry and coordinate types
 */

import type { BoardAppearance } from './appearance';

export type BoardType = 'perfboard' | 'stripboard' | 'custom';

export interface BoardDimensions {
  rows: number;
  cols: number;
  holePitchMm: number;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
}

export interface MountingHole {
  id: string;
  row: number;
  col: number;
  diameterMm: number;
}

export interface BoardConfig {
  id: string;
  name: string;
  type: BoardType;
  dimensions: BoardDimensions;
  mountingHoles: MountingHole[];
  stripDirection?: 'horizontal' | 'vertical';
  customConnectivity?: PadConnectivity[][];
  /** Soldermask finish — green (classic), brown, red, black or white */
  appearance?: BoardAppearance;
  createdAt: number;
  updatedAt: number;
}

export interface Coordinate {
  row: number;
  col: number;
}

export function coordToKey(coord: Coordinate): string {
  return `${coord.row},${coord.col}`;
}

export function keyToCoord(key: string): Coordinate {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

/**
 * Convert a coordinate to a human-readable label.
 * Rows use spreadsheet-style letters: A..Z, AA..AZ, BA.. etc. (row 0 = A)
 * Columns are 1-based: col 0 = 1
 */
export function coordToLabel(coord: Coordinate): string {
  let row = coord.row;
  let rowLabel = '';
  do {
    rowLabel = String.fromCharCode(65 + (((row % 26) + 26) % 26)) + rowLabel;
    row = Math.floor(row / 26) - 1;
  } while (row >= 0);
  return `${rowLabel}${coord.col + 1}`;
}

export function labelToCoord(label: string): Coordinate {
  const match = label.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid coordinate label: ${label}`);
  let row = 0;
  for (const char of match[1]) {
    row = row * 26 + (char.charCodeAt(0) - 64);
  }
  row -= 1;
  const col = parseInt(match[2], 10) - 1;
  return { row, col };
}

export interface Pad {
  coordinate: Coordinate;
  isConnected: boolean;
  netId?: string;
  componentId?: string;
  pinId?: string;
  isMountingHole: boolean;
  isTrackCut: boolean;
  customConnectedPads?: Coordinate[];
}

export interface PadConnectivity {
  from: Coordinate;
  to: Coordinate;
  type: 'trace' | 'bridge' | 'component-lead';
}

export interface BoardState {
  config: BoardConfig;
  pads: Map<string, Pad>;
  holeCoordinates: Coordinate[];
}

/**
 * Physical board size implied by the hole grid: the board is exactly
 * `margin + (n-1) * pitch + margin` on each axis so the holes always sit
 * centered inside the soldermask with even margins.
 */
export function computeBoardSizeMm(dimensions: BoardDimensions): { widthMm: number; heightMm: number } {
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    widthMm: round(dimensions.marginLeftMm + (dimensions.cols - 1) * dimensions.holePitchMm + dimensions.marginRightMm),
    heightMm: round(dimensions.marginTopMm + (dimensions.rows - 1) * dimensions.holePitchMm + dimensions.marginBottomMm),
  };
}

/** BoardDimensions with widthMm/heightMm derived from the hole grid. */
export function withDerivedSize(dimensions: BoardDimensions): BoardDimensions {
  return { ...dimensions, ...computeBoardSizeMm(dimensions) };
}

/** Standard mounting holes: one in each corner of the hole grid */
export function makeCornerMountingHoles(dimensions: BoardDimensions): MountingHole[] {
  return [
    { id: 'mh1', row: 0, col: 0, diameterMm: 3 },
    { id: 'mh2', row: 0, col: dimensions.cols - 1, diameterMm: 3 },
    { id: 'mh3', row: dimensions.rows - 1, col: 0, diameterMm: 3 },
    { id: 'mh4', row: dimensions.rows - 1, col: dimensions.cols - 1, diameterMm: 3 },
  ];
}

/** True when every hole sits in a corner of the given grid (the default pattern) */
export function isCornerMountingHoles(holes: MountingHole[], dimensions: BoardDimensions): boolean {
  return holes.every(h =>
    (h.row === 0 || h.row === dimensions.rows - 1) &&
    (h.col === 0 || h.col === dimensions.cols - 1)
  );
}

export function createEmptyBoard(config: BoardConfig): BoardState {
  const pads = new Map<string, Pad>();
  const holeCoordinates: Coordinate[] = [];
  
  const { rows, cols } = config.dimensions;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const coord = { row: r, col: c };
      const key = coordToKey(coord);
      const isMountingHole = config.mountingHoles.some(mh => mh.row === r && mh.col === c);
      
      pads.set(key, {
        coordinate: coord,
        isConnected: false,
        isMountingHole,
        isTrackCut: false,
      });
      holeCoordinates.push(coord);
    }
  }
  
  // Apply stripboard connectivity if applicable
  if (config.type === 'stripboard') {
    applyStripboardConnectivity(pads, config);
  }
  
  // Apply custom connectivity
  if (config.type === 'custom' && config.customConnectivity) {
    applyCustomConnectivity(pads, config.customConnectivity);
  }
  
  return { config, pads, holeCoordinates };
}

function applyStripboardConnectivity(pads: Map<string, Pad>, config: BoardConfig): void {
  const { rows, cols } = config.dimensions;
  // Default strip direction is horizontal
  const direction = config.stripDirection || 'horizontal';
  
  const connect = (fromKey: string, toKey: string): void => {
    const fromPad = pads.get(fromKey);
    const toPad = pads.get(toKey);
    // Strips must not pass through mounting holes (drilled through the copper)
    if (!fromPad || !toPad || fromPad.isMountingHole || toPad.isMountingHole) return;
    
    // Strip connectivity is bidirectional
    fromPad.customConnectedPads = fromPad.customConnectedPads || [];
    if (!fromPad.customConnectedPads.some(c => c.row === toPad.coordinate.row && c.col === toPad.coordinate.col)) {
      fromPad.customConnectedPads.push({ row: toPad.coordinate.row, col: toPad.coordinate.col });
    }
    toPad.customConnectedPads = toPad.customConnectedPads || [];
    if (!toPad.customConnectedPads.some(c => c.row === fromPad.coordinate.row && c.col === fromPad.coordinate.col)) {
      toPad.customConnectedPads.push({ row: fromPad.coordinate.row, col: fromPad.coordinate.col });
    }
  };
  
  if (direction === 'horizontal') {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        connect(coordToKey({ row: r, col: c }), coordToKey({ row: r, col: c + 1 }));
      }
    }
  } else {
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows - 1; r++) {
        connect(coordToKey({ row: r, col: c }), coordToKey({ row: r + 1, col: c }));
      }
    }
  }
}

function applyCustomConnectivity(pads: Map<string, Pad>, connectivity: PadConnectivity[][]): void {
  for (const rowConnections of connectivity) {
    for (const conn of rowConnections) {
      const fromKey = coordToKey(conn.from);
      const fromPad = pads.get(fromKey);
      if (fromPad) {
        fromPad.customConnectedPads = fromPad.customConnectedPads || [];
        fromPad.customConnectedPads.push(conn.to);
      }
    }
  }
}

export function getPadAt(board: BoardState, coord: Coordinate): Pad | undefined {
  return board.pads.get(coordToKey(coord));
}

export function setPadNet(board: BoardState, coord: Coordinate, netId: string | undefined, componentId?: string, pinId?: string): void {
  const pad = getPadAt(board, coord);
  if (pad) {
    pad.netId = netId;
    pad.isConnected = netId !== undefined;
    pad.componentId = componentId;
    pad.pinId = pinId;
  }
}

export function isCoordinateValid(board: BoardState, coord: Coordinate): boolean {
  const { rows, cols } = board.config.dimensions;
  return coord.row >= 0 && coord.row < rows && coord.col >= 0 && coord.col < cols;
}

export function getBoardBounds(board: BoardState): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
  const { rows, cols } = board.config.dimensions;
  return { minRow: 0, maxRow: rows - 1, minCol: 0, maxCol: cols - 1 };
}

export function coordToPixel(coord: Coordinate, config: BoardConfig, zoom: number = 1, offset: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const { holePitchMm, marginLeftMm, marginTopMm } = config.dimensions;
  const mmToPx = 3.7795275591; // 1mm = 3.7795275591px at 96 DPI
  return {
    x: offset.x + (marginLeftMm + coord.col * holePitchMm) * mmToPx * zoom,
    y: offset.y + (marginTopMm + coord.row * holePitchMm) * mmToPx * zoom,
  };
}

export function pixelToCoord(x: number, y: number, config: BoardConfig, zoom: number = 1, offset: { x: number; y: number } = { x: 0, y: 0 }): Coordinate | null {
  const { holePitchMm, marginLeftMm, marginTopMm, rows, cols } = config.dimensions;
  const mmToPx = 3.7795275591;
  const col = Math.round((x - offset.x) / (mmToPx * zoom) / holePitchMm - marginLeftMm / holePitchMm);
  const row = Math.round((y - offset.y) / (mmToPx * zoom) / holePitchMm - marginTopMm / holePitchMm);
  
  if (row >= 0 && row < rows && col >= 0 && col < cols) {
    return { row, col };
  }
  return null;
}

export function distance(coord1: Coordinate, coord2: Coordinate): number {
  return Math.abs(coord1.row - coord2.row) + Math.abs(coord1.col - coord2.col);
}

export function manhattanDistance(coord1: Coordinate, coord2: Coordinate): number {
  return Math.abs(coord1.row - coord2.row) + Math.abs(coord1.col - coord2.col);
}