/**
 * Coordinate system and view transformations
 * 
 * DEFINED COORDINATE SYSTEM:
 * - Board coordinates are (row, col) integers, 0-based.
 * - (0,0) is the top-left hole as seen from the COMPONENT side.
 * - Row labels are letters (A, B, C...), column labels are numbers (1, 2, 3...).
 * - Hole A1 = (0,0). All component/pin positions are ALWAYS stored in
 *   component-side coordinates, regardless of which view is displayed.
 * 
 * SOLDER SIDE VIEW:
 * - The physical board is flipped around its VERTICAL axis to view the solder side.
 * - A hole at component-side column c appears at solder-side column (cols-1-c).
 * - Row is unchanged: top of the board stays at the top.
 * - Hole A1 (component side top-left) appears at top-RIGHT in the solder view.
 * - This mirrors everything left-right, exactly like looking at the back of a PCB.
 * 
 * ALL rendering must use these transformation functions - never hand-roll
 * mirroring ad hoc, to guarantee pin identities stay correct across views.
 */

import { BoardConfig } from './types';

export interface Coordinate {
  row: number;
  col: number;
}

export type BoardSide = 'component' | 'solder';

/**
 * Transform a component-side coordinate into the solder-side view coordinate.
 * (Left-right mirror; rows unchanged.)
 */
export function componentToSolderView(coord: Coordinate, cols: number): Coordinate {
  return { row: coord.row, col: cols - 1 - coord.col };
}

/**
 * Transform a solder-side view coordinate back into component-side coordinates.
 * (Self-inverse: same operation.)
 */
export function solderViewToComponent(coord: Coordinate, cols: number): Coordinate {
  return { row: coord.row, col: cols - 1 - coord.col };
}

/**
 * Get the view coordinate for a hole depending on which side is displayed.
 */
export function viewCoordinate(
  componentCoord: Coordinate,
  cols: number,
  side: BoardSide
): Coordinate {
  if (side === 'solder') {
    return componentToSolderView(componentCoord, cols);
  }
  return componentCoord;
}

/**
 * Convert a view coordinate (displayed side) to physical component-side coordinate.
 */
export function physicalCoordinate(
  viewCoord: Coordinate,
  cols: number,
  side: BoardSide
): Coordinate {
  if (side === 'solder') {
    return solderViewToComponent(viewCoord, cols);
  }
  return viewCoord;
}

/**
 * Convert a board coordinate (component-side) to pixel position for a given side.
 * Uses millimetre dimensions and a pixels-per-mm scale.
 */
export function coordinateToPixel(
  componentCoord: Coordinate,
  config: BoardConfig,
  side: BoardSide,
  pxPerMm: number
): { x: number; y: number } {
  const { holePitchMm, marginLeftMm, marginTopMm, cols } = config.dimensions;
  const viewCoord = viewCoordinate(componentCoord, cols, side);
  
  return {
    x: (marginLeftMm + viewCoord.col * holePitchMm) * pxPerMm,
    y: (marginTopMm + viewCoord.row * holePitchMm) * pxPerMm,
  };
}

/**
 * Convert a pixel position in a given side's view to a board coordinate.
 * Returns null if outside the board area.
 */
export function pixelToCoordinate(
  x: number,
  y: number,
  config: BoardConfig,
  side: BoardSide,
  pxPerMm: number
): Coordinate | null {
  const { holePitchMm, marginLeftMm, marginTopMm, rows, cols } = config.dimensions;
  
  const viewCol = Math.round((x / pxPerMm - marginLeftMm) / holePitchMm);
  const viewRow = Math.round((y / pxPerMm - marginTopMm) / holePitchMm);
  
  if (viewRow < 0 || viewRow >= rows || viewCol < 0 || viewCol >= cols) {
    return null;
  }
  
  // Return physical (component-side) coordinate
  return physicalCoordinate({ row: viewRow, col: viewCol }, cols, side);
}

/**
 * Board pixel dimensions
 */
export function boardPixelSize(
  config: BoardConfig,
  pxPerMm: number
): { width: number; height: number } {
  const { widthMm, heightMm } = config.dimensions;
  return {
    width: widthMm * pxPerMm,
    height: heightMm * pxPerMm,
  };
}

/**
 * Rotation of a coordinate around an origin, for component rotation.
 * (Already in footprints/types rotateCoordinate but re-exported for tests.)
 */
export function rotatePoint(
  point: Coordinate,
  origin: Coordinate,
  degrees: 0 | 90 | 180 | 270
): Coordinate {
  const dr = point.row - origin.row;
  const dc = point.col - origin.col;
  
  let newDr: number;
  let newDc: number;
  
  switch (degrees) {
    case 0:
      newDr = dr;
      newDc = dc;
      break;
    case 90:
      // Clockwise in row/col space: (dr,dc) -> (dc, -dr)
      newDr = dc;
      newDc = -dr;
      break;
    case 180:
      newDr = -dr;
      newDc = -dc;
      break;
    case 270:
      newDr = -dc;
      newDc = dr;
      break;
  }
  
  return { row: origin.row + newDr, col: origin.col + newDc };
}

/**
 * Verify round-trip consistency: component -> view -> component.
 */
export function roundTripIdentity(coord: Coordinate, cols: number): boolean {
  const view = componentToSolderView(coord, cols);
  const back = solderViewToComponent(view, cols);
  return back.row === coord.row && back.col === coord.col;
}