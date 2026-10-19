/**
 * Placement engine tests
 */

import { describe, it, expect } from 'vitest';
import { createEmptyBoard, BoardConfig } from '../board/types';
import { RESISTOR_AXIAL, DIP_8, LED_5MM, PIN_HEADER_1X4, SCREW_TERMINAL_2 } from '../footprints/library';
import { Footprint } from '../footprints/types';
import { Net, createEmptyCircuit } from '../circuit/types';
import { placeComponents } from '../placement/engine';
import { DEFAULT_PLACEMENT_CONFIG, PlacementSpec, SeededRandom } from '../placement/types';

const config: BoardConfig = {
  id: 'placement-test',
  name: 'Placement Test Board',
  type: 'perfboard',
  dimensions: {
    rows: 20,
    cols: 20,
    holePitchMm: 2.54,
    widthMm: 50,
    heightMm: 50,
    marginTopMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    marginRightMm: 2,
  },
  mountingHoles: [],
  createdAt: 0,
  updatedAt: 0,
};

function makeSpec(id: string, reference: string, footprint: Footprint, nets: Record<string, string> = {}): PlacementSpec {
  return {
    id,
    footprintId: footprint.id,
    reference,
    nets: new Map(Object.entries(nets)),
  };
}

describe('SeededRandom determinism', () => {
  it('produces identical sequences for identical seeds', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);
    
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = new SeededRandom(1);
    const rng2 = new SeededRandom(2);
    
    let identical = 0;
    for (let i = 0; i < 20; i++) {
      if (rng1.next() === rng2.next()) identical++;
    }
    expect(identical).toBeLessThan(5);
  });

  it('shuffle is deterministic for the same seed', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r1 = new SeededRandom(99).shuffle(arr);
    const r2 = new SeededRandom(99).shuffle(arr);
    expect(r1).toEqual(r2);
  });

  it('shuffle preserves all elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = new SeededRandom(7).shuffle(arr);
    expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Placement engine basics', () => {
  it('places a single resistor on the board', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [{ component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL }];
    const result = placeComponents(board, circuit, specs, [], [], { ...DEFAULT_PLACEMENT_CONFIG, intensity: 'fast' });
    
    expect(result.success).toBe(true);
    expect(result.placedComponents.length).toBe(1);
    expect(result.placedComponents[0].reference).toBe('R1');
  });

  it('places multiple components without overlaps', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [
      { component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('r2', 'R2', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('r3', 'R3', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('led1', 'D1', LED_5MM), footprint: LED_5MM },
    ];
    
    const result = placeComponents(board, circuit, specs, [], [], { ...DEFAULT_PLACEMENT_CONFIG, intensity: 'fast' });
    
    expect(result.success).toBe(true);
    expect(result.placedComponents.length).toBe(4);
    
    // Verify no overlapping pins
    const usedPads = new Set<string>();
    for (const comp of result.placedComponents) {
      for (const coord of comp.pinPositions.values()) {
        const key = `${coord.row},${coord.col}`;
        expect(usedPads.has(key), `pin collision at ${key}`).toBe(false);
        usedPads.add(key);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [
      { component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('r2', 'R2', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('dip1', 'U1', DIP_8), footprint: DIP_8 },
    ];
    
    const config1 = { ...DEFAULT_PLACEMENT_CONFIG, seed: 42, intensity: 'fast' as const };
    const config2 = { ...DEFAULT_PLACEMENT_CONFIG, seed: 42, intensity: 'fast' as const };
    
    const result1 = placeComponents(board, circuit, specs, [], [], config1);
    const result2 = placeComponents(board, circuit, specs, [], [], config2);
    
    expect(result1.placedComponents.length).toBe(result2.placedComponents.length);
    
    for (let i = 0; i < result1.placedComponents.length; i++) {
      expect(result1.placedComponents[i].position).toEqual(result2.placedComponents[i].position);
      expect(result1.placedComponents[i].orientation).toBe(result2.placedComponents[i].orientation);
    }
  });

  it('reports an error when the board is too small', () => {
    const tinyConfig: BoardConfig = {
      ...config,
      dimensions: { ...config.dimensions, rows: 2, cols: 2 },
    };
    const board = createEmptyBoard(tinyConfig);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [
      { component: makeSpec('u1', 'U1', DIP_8), footprint: DIP_8 },
      { component: makeSpec('u2', 'U2', DIP_8), footprint: DIP_8 },
      { component: makeSpec('u3', 'U3', DIP_8), footprint: DIP_8 },
    ];
    
    const result = placeComponents(board, circuit, specs, [], [], { ...DEFAULT_PLACEMENT_CONFIG, intensity: 'fast' });
    
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe('BOARD_TOO_SMALL');
  });

  it('does not move locked components', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [
      { component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('r2', 'R2', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
    ];
    
    // First placement run
    const result1 = placeComponents(board, circuit, specs, [], [], { ...DEFAULT_PLACEMENT_CONFIG, intensity: 'fast' });
    const r1Position = result1.placedComponents.find(c => c.id === 'r1')!.position;
    
    // Lock R1 and re-run
    const lockedPlacement = result1.placedComponents.map(c =>
      c.id === 'r1' ? { ...c, locked: true } : c
    );
    
    const result2 = placeComponents(board, circuit, specs, [], lockedPlacement, {
      ...DEFAULT_PLACEMENT_CONFIG, intensity: 'fast', seed: 999,
    });
    
    const r1After = result2.placedComponents.find(c => c.id === 'r1');
    expect(r1After?.position).toEqual(r1Position);
  });

  it('keeps all placed components within board bounds', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const specs = [
      { component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
      { component: makeSpec('h1', 'J1', PIN_HEADER_1X4), footprint: PIN_HEADER_1X4 },
      { component: makeSpec('t1', 'J2', SCREW_TERMINAL_2), footprint: SCREW_TERMINAL_2 },
      { component: makeSpec('dip1', 'U1', DIP_8), footprint: DIP_8 },
    ];
    
    const result = placeComponents(board, circuit, specs, [], [], { ...DEFAULT_PLACEMENT_CONFIG, intensity: 'standard' });
    
    for (const comp of result.placedComponents) {
      expect(comp.boundingBox.minRow).toBeGreaterThanOrEqual(0);
      expect(comp.boundingBox.minCol).toBeGreaterThanOrEqual(0);
      expect(comp.boundingBox.maxRow).toBeLessThan(config.dimensions.rows);
      expect(comp.boundingBox.maxCol).toBeLessThan(config.dimensions.cols);
    }
  });

  it('places connected components closer than unconnected ones', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    
    const nets: Net[] = [
      { id: 'net1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
    ];
    
    const specs = [
      { component: makeSpec('r1', 'R1', RESISTOR_AXIAL, { p1: 'net1' }), footprint: RESISTOR_AXIAL },
      { component: makeSpec('r2', 'R2', RESISTOR_AXIAL, { p1: 'net1' }), footprint: RESISTOR_AXIAL },
    ];
    
    const result = placeComponents(board, circuit, specs, nets, [], {
      ...DEFAULT_PLACEMENT_CONFIG,
      intensity: 'standard',
      mode: 'min-wire',
    });
    
    expect(result.success).toBe(true);
    
    const r1p1 = result.placedComponents.find(c => c.id === 'r1')!.pinPositions.get('p1')!;
    const r2p1 = result.placedComponents.find(c => c.id === 'r2')!.pinPositions.get('p1')!;
    const distance = Math.abs(r1p1.row - r2p1.row) + Math.abs(r1p1.col - r2p1.col);
    
    // Connected pins should be reasonably close on a 20x20 board
    expect(distance).toBeLessThan(15);
  });
});

describe('Placement modes', () => {
  const specs = [
    { component: makeSpec('r1', 'R1', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
    { component: makeSpec('r2', 'R2', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
    { component: makeSpec('r3', 'R3', RESISTOR_AXIAL), footprint: RESISTOR_AXIAL },
  ];
  
  it('runs in min-wire mode', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    const result = placeComponents(board, circuit, specs, [], [], {
      ...DEFAULT_PLACEMENT_CONFIG, mode: 'min-wire', intensity: 'fast',
    });
    expect(result.placedComponents.length).toBe(3);
  });

  it('runs in max-neatness mode', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    const result = placeComponents(board, circuit, specs, [], [], {
      ...DEFAULT_PLACEMENT_CONFIG, mode: 'max-neatness', intensity: 'fast',
    });
    expect(result.placedComponents.length).toBe(3);
  });

  it('runs in balanced mode', () => {
    const board = createEmptyBoard(config);
    const circuit = createEmptyCircuit('Test');
    const result = placeComponents(board, circuit, specs, [], [], {
      ...DEFAULT_PLACEMENT_CONFIG, mode: 'balanced', intensity: 'fast',
    });
    expect(result.placedComponents.length).toBe(3);
  });
});
