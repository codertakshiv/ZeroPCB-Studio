/**
 * Footprint and component pin tests
 */

import { describe, it, expect } from 'vitest';
import {
  getRotatedPinPositions,
  getComponentBoundingBox,
  checkPinConflict,
  Footprint,
  PlacedComponent,
} from '../footprints/types';
import {
  RESISTOR_AXIAL,
  DIP_8,
  LED_5MM,
  CAPACITOR_ELECTROLYTIC,
  PIN_HEADER_1X4,
  ALL_STANDARD_FOOTPRINTS,
  createCustomFootprint,
} from '../footprints/library';

describe('Footprint definitions', () => {
  it('has unique IDs across the library', () => {
    const ids = ALL_STANDARD_FOOTPRINTS.map(f => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all footprints have at least 1 pin', () => {
    for (const fp of ALL_STANDARD_FOOTPRINTS) {
      expect(fp.pins.length, `${fp.id} should have pins`).toBeGreaterThan(0);
    }
  });

  it('all pins have unique numbers within a footprint', () => {
    for (const fp of ALL_STANDARD_FOOTPRINTS) {
      const numbers = fp.pins.map(p => p.number);
      const unique = new Set(numbers);
      expect(unique.size, `${fp.id} has duplicate pin numbers`).toBe(numbers.length);
    }
  });
});

describe('Pin numbering - DIP-8', () => {
  it('numbers pins counterclockwise starting bottom-left', () => {
    expect(DIP_8.pins.find(p => p.number === '1')?.offset).toEqual({ row: 1, col: 0 });
    expect(DIP_8.pins.find(p => p.number === '4')?.offset).toEqual({ row: 1, col: 3 });
    expect(DIP_8.pins.find(p => p.number === '5')?.offset).toEqual({ row: 0, col: 3 });
    expect(DIP_8.pins.find(p => p.number === '8')?.offset).toEqual({ row: 0, col: 0 });
  });

  it('preserves pin identity after rotation', () => {
    const positions0 = getRotatedPinPositions(DIP_8, { row: 5, col: 5 }, 0);
    const positions90 = getRotatedPinPositions(DIP_8, { row: 5, col: 5 }, 90);
    const positions180 = getRotatedPinPositions(DIP_8, { row: 5, col: 5 }, 180);
    const positions270 = getRotatedPinPositions(DIP_8, { row: 5, col: 5 }, 270);
    
    // All 8 pins present in every orientation
    expect(positions0.size).toBe(8);
    expect(positions90.size).toBe(8);
    expect(positions180.size).toBe(8);
    expect(positions270.size).toBe(8);
    
    // Every pin still exists with the same id
    for (const pin of DIP_8.pins) {
      expect(positions0.has(pin.id)).toBe(true);
      expect(positions90.has(pin.id)).toBe(true);
      expect(positions180.has(pin.id)).toBe(true);
      expect(positions270.has(pin.id)).toBe(true);
    }
    
    // Correct physical positions at 90° (clockwise, anchored at footprint origin):
    // pin 8 (offset 0,0) stays at the anchor; pin 1 (offset 1,0) moves left of it.
    expect(positions90.get('p8')).toEqual({ row: 5, col: 5 });
    expect(positions90.get('p1')).toEqual({ row: 5, col: 4 });
    expect(positions90.get('p4')).toEqual({ row: 8, col: 4 });
    expect(positions90.get('p5')).toEqual({ row: 8, col: 5 });
    // 180° mirrors both axes
    expect(positions180.get('p8')).toEqual({ row: 5, col: 5 });
    expect(positions180.get('p1')).toEqual({ row: 4, col: 5 });
    
    // Rotation is rigid: squared distance between any two pins is invariant
    const dist = (a: { row: number; col: number }, b: { row: number; col: number }) =>
      Math.pow(a.row - b.row, 2) + Math.pow(a.col - b.col, 2);
    const pairs: [string, string][] = [['p1', 'p5'], ['p1', 'p8'], ['p2', 'p7'], ['p3', 'p6']];
    for (const [a, b] of pairs) {
      const d0 = dist(positions0.get(a)!, positions0.get(b)!);
      expect(d0).toBeGreaterThan(0);
      expect(dist(positions90.get(a)!, positions90.get(b)!)).toBe(d0);
      expect(dist(positions180.get(a)!, positions180.get(b)!)).toBe(d0);
      expect(dist(positions270.get(a)!, positions270.get(b)!)).toBe(d0);
    }
  });

  it('pin 1 lands at the component position in orientation 0', () => {
    // Pin 1 is at offset (1,0), so with component at (5,5), pin 1 is at (6,5)
    const positions = getRotatedPinPositions(DIP_8, { row: 5, col: 5 }, 0);
    expect(positions.get('p1')).toEqual({ row: 6, col: 5 });
  });
});

describe('Bounding boxes', () => {
  it('computes resistor bounding box', () => {
    const bbox = getComponentBoundingBox({ row: 3, col: 2 }, 0, RESISTOR_AXIAL);
    expect(bbox).toEqual({ minRow: 3, maxRow: 3, minCol: 2, maxCol: 6 });
  });

  it('rotation swaps width and height', () => {
    const bbox0 = getComponentBoundingBox({ row: 3, col: 2 }, 0, RESISTOR_AXIAL);
    const bbox90 = getComponentBoundingBox({ row: 3, col: 2 }, 90, RESISTOR_AXIAL);
    
    expect(bbox0.maxRow - bbox0.minRow).toBe(0); // 1 row
    expect(bbox0.maxCol - bbox0.minCol).toBe(4); // 5 cols
    
    expect(bbox90.maxRow - bbox90.minRow).toBe(4); // 5 rows
    expect(bbox90.maxCol - bbox90.minCol).toBe(0); // 1 col
  });
});

describe('Collision detection', () => {
  const makePlaced = (
    id: string,
    position: { row: number; col: number },
    orientation: 0 | 90 | 180 | 270,
    footprint: Footprint
  ): PlacedComponent => ({
    id,
    footprintId: footprint.id,
    reference: id.toUpperCase(),
    position,
    orientation,
    locked: false,
    nets: new Map(),
    footprint,
    pinPositions: getRotatedPinPositions(footprint, position, orientation),
    boundingBox: getComponentBoundingBox(position, orientation, footprint),
  });

  it('detects pin conflicts on the same coordinate', () => {
    const r1 = makePlaced('r1', { row: 0, col: 0 }, 0, RESISTOR_AXIAL);
    const r2 = makePlaced('r2', { row: 0, col: 4 }, 0, RESISTOR_AXIAL); // second pin collides
    const conflicts = checkPinConflict(r1, r2);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toEqual({ row: 0, col: 4 });
  });

  it('detects no conflicts when separated', () => {
    const r1 = makePlaced('r1', { row: 0, col: 0 }, 0, RESISTOR_AXIAL);
    const r2 = makePlaced('r2', { row: 2, col: 0 }, 0, RESISTOR_AXIAL);
    expect(checkPinConflict(r1, r2).length).toBe(0);
  });

  it('detects conflicts with rotated components', () => {
    const r1 = makePlaced('r1', { row: 0, col: 0 }, 0, RESISTOR_AXIAL);
    // Vertical resistor crossing the first one's second pin
    const r2 = makePlaced('r2', { row: 0, col: 4 }, 90, RESISTOR_AXIAL);
    const conflicts = checkPinConflict(r1, r2);
    expect(conflicts.length).toBeGreaterThan(0);
  });
});

describe('Polarized components', () => {
  it('marks LED polarity correctly', () => {
    const anode = LED_5MM.pins.find(p => p.name.includes('Anode'));
    const cathode = LED_5MM.pins.find(p => p.name.includes('Cathode'));
    
    expect(anode?.isPolarized).toBe(true);
    expect(anode?.polarity).toBe('anode');
    expect(cathode?.isPolarized).toBe(true);
    expect(cathode?.polarity).toBe('cathode');
    expect(LED_5MM.isPolarized).toBe(true);
  });

  it('marks electrolytic capacitor polarity', () => {
    expect(CAPACITOR_ELECTROLYTIC.isPolarized).toBe(true);
    const positive = CAPACITOR_ELECTROLYTIC.pins.find(p => p.polarity === 'positive');
    expect(positive).toBeDefined();
  });
});

describe('Custom footprints', () => {
  it('creates a custom footprint with correct pin positions', () => {
    const fp = createCustomFootprint('custom-test', 'Custom 3-pin', 'Test', [
      { number: '1', name: 'A', row: 0, col: 0 },
      { number: '2', name: 'B', row: 0, col: 1 },
      { number: '3', name: 'C', row: 1, col: 0 },
    ]);
    
    expect(fp.pins.length).toBe(3);
    expect(fp.width).toBe(2);
    expect(fp.height).toBe(2);
    expect(fp.pins[2].offset).toEqual({ row: 1, col: 0 });
  });
});

describe('Pin header pinouts', () => {
  it('numbers 1x4 header sequentially', () => {
    for (let i = 1; i <= 4; i++) {
      const pin = PIN_HEADER_1X4.pins.find(p => p.number === `${i}`);
      expect(pin?.offset).toEqual({ row: 0, col: i - 1 });
    }
  });
});
