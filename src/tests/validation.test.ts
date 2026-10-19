/**
 * Electrical validation tests
 * Tests must distinguish visual success from actual electrical correctness.
 */

import { describe, it, expect } from 'vitest';
import { createEmptyBoard, BoardConfig, coordToKey, setPadNet } from '../board/types';
import { getRotatedPinPositions, getComponentBoundingBox, PlacedComponent } from '../footprints/types';
import { RESISTOR_AXIAL, LED_5MM, DIP_8 } from '../footprints/library';
import { Net } from '../circuit/types';
import { Route, RouteSegment } from '../routing/types';
import { validateBoard } from '../validation/types';

const config: BoardConfig = {
  id: 'test-board',
  name: 'Validation Test Board',
  type: 'perfboard',
  dimensions: {
    rows: 15,
    cols: 15,
    holePitchMm: 2.54,
    widthMm: 40,
    heightMm: 40,
    marginTopMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    marginRightMm: 2,
  },
  mountingHoles: [],
  createdAt: 0,
  updatedAt: 0,
};

function placeComponent(
  id: string,
  reference: string,
  position: { row: number; col: number },
  orientation: 0 | 90 | 180 | 270,
  footprint: typeof RESISTOR_AXIAL,
  nets: Record<string, string> = {}
): PlacedComponent {
  return {
    id,
    footprintId: footprint.id,
    reference,
    position,
    orientation,
    locked: false,
    nets: new Map(Object.entries(nets)),
    footprint,
    pinPositions: getRotatedPinPositions(footprint, position, orientation),
    boundingBox: getComponentBoundingBox(position, orientation, footprint),
  };
}

function makeRoute(netId: string, segments: [number, number, number, number][]): Route {
  const routeSegments: RouteSegment[] = segments.map(([fr, fc, tr, tc]) => ({
    from: { row: fr, col: fc },
    to: { row: tr, col: tc },
    layer: 'solder' as const,
    netId,
    type: 'wire' as const,
  }));
  
  let length = 0;
  for (const s of routeSegments) {
    length += Math.abs(s.from.row - s.to.row) + Math.abs(s.from.col - s.to.col);
  }
  
  return {
    id: `route-${netId}`,
    netId,
    segments: routeSegments,
    layer: 'solder',
    length,
    bendCount: 0,
    locked: false,
    manual: false,
  };
}

describe('Component placement validation', () => {
  it('detects pin conflicts between two components', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL);
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 7 }, 0, RESISTOR_AXIAL); // R1 pin2 at (5,7)
    
    const result = validateBoard(board, [r1, r2], [], []);
    
    const pinConflicts = result.issues.filter(i => i.type === 'pin-conflict');
    expect(pinConflicts.length).toBeGreaterThan(0);
    expect(result.isValid).toBe(false);
  });

  it('detects out-of-bounds placement', () => {
    const board = createEmptyBoard(config);
    // Resistor 5 wide at col 12 extends to col 16 (> 14)
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 12 }, 0, RESISTOR_AXIAL);
    
    const result = validateBoard(board, [r1], [], []);
    
    const oob = result.issues.filter(i => i.type === 'component-out-of-bounds');
    expect(oob.length).toBe(1);
    expect(result.isValid).toBe(false);
  });

  it('passes with no components', () => {
    const board = createEmptyBoard(config);
    const result = validateBoard(board, [], [], []);
    expect(result.isValid).toBe(true);
  });
});

describe('Net connectivity validation', () => {
  it('reports unconnected nets as open circuits', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    const r2 = placeComponent('r2', 'R2', { row: 8, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'NET1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
      { id: 'net2', name: 'NET2', pins: [
        { componentId: 'r1', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
        { componentId: 'r2', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
      ]},
    ];
    
    // No routes: nets must be detected as not fully connected
    const result = validateBoard(board, [r1, r2], nets, []);
    
    const openCircuits = result.issues.filter(i => i.type === 'open-circuit');
    expect(openCircuits.length).toBe(2);
    expect(result.isValid).toBe(false);
    expect(result.stats.completeNets).toBe(0);
    expect(result.stats.incompleteNets).toBe(2);
  });

  it('marks nets complete when routed', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    const r2 = placeComponent('r2', 'R2', { row: 8, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'NET1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
    ];
    
    // Route from (5,3) [R1 pin1] to (8,3) [R2 pin1]
    const route = makeRoute('net1', [[5, 3, 6, 3], [6, 3, 7, 3], [7, 3, 8, 3]]);
    
    const result = validateBoard(board, [r1, r2], nets, [route]);
    
    const net1Component = result.connectivityGraph.components.find(c => c.netId === 'net1');
    expect(net1Component?.isComplete).toBe(true);
  });
});

describe('Short circuit detection', () => {
  it('detects two nets sharing the same pad via routes', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    const r2 = placeComponent('r2', 'R2', { row: 8, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'POWER', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
      { id: 'net2', name: 'SIGNAL', pins: [
        { componentId: 'r1', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
        { componentId: 'r2', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
      ]},
    ];
    
    // net1 route runs from (5,3) to (6,5). net2 route passes through (6,5)!
    const route1 = makeRoute('net1', [[5, 3, 5, 4], [5, 4, 6, 5]]);
    const route2 = makeRoute('net2', [[5, 7, 6, 6], [6, 6, 6, 5], [6, 5, 7, 5]]);
    
    const result = validateBoard(board, [r1, r2], nets, [route1, route2]);
    
    const shorts = result.issues.filter(i => i.type === 'short-circuit');
    expect(shorts.length).toBeGreaterThan(0);
    expect(result.stats.shortCircuits).toBeGreaterThan(0);
    expect(result.isValid).toBe(false);
  });

  it('does not report shorts for separate routes', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    const r2 = placeComponent('r2', 'R2', { row: 8, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
      { id: 'net2', name: 'B', pins: [
        { componentId: 'r1', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
        { componentId: 'r2', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
      ]},
    ];
    
    const route1 = makeRoute('net1', [[5, 3, 6, 3], [6, 3, 7, 3], [7, 3, 8, 3]]);
    const route2 = makeRoute('net2', [[5, 7, 6, 7], [6, 7, 7, 7], [7, 7, 8, 7]]);
    
    const result = validateBoard(board, [r1, r2], nets, [route1, route2]);
    
    const shorts = result.issues.filter(i => i.type === 'short-circuit');
    expect(shorts.length).toBe(0);
  });
});

describe('Routing validation', () => {
  it('detects route discontinuities', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
    ];
    
    // Broken route: (5,3)->(6,3) then (7,5)->(8,5) - a gap!
    const route = makeRoute('net1', [[5, 3, 6, 3], [7, 5, 8, 5]]);
    
    const result = validateBoard(board, [r1], nets, [route]);
    
    const gaps = result.issues.filter(i => i.type === 'open-circuit' && i.message.includes('gap'));
    expect(gaps.length).toBe(1);
  });
  
  it('accepts multi-leg routes that share a junction cell', () => {
    // Multi-pin nets are routed as chained legs: the second leg branches off
    // an existing point of the route instead of continuing the last segment.
    // The segments form one connected wire graph and must not be flagged.
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    const r2 = placeComponent('r2', 'R2', { row: 8, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
    ];
    
    // Leg 1: (5,3)->(6,3)->(6,4); Leg 2 branches from (6,3) to (7,3)
    const route = makeRoute('net1', [[5, 3, 6, 3], [6, 3, 6, 4], [6, 3, 7, 3]]);
    
    const result = validateBoard(board, [r1, r2], nets, [route]);
    
    const gaps = result.issues.filter(i => i.type === 'open-circuit' && i.message.includes('gap'));
    expect(gaps.length).toBe(0);
  });

  it('detects route crossings as warnings, not errors', () => {
    const board = createEmptyBoard(config);
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [] },
      { id: 'net2', name: 'B', pins: [] },
    ];
    
    // Both routes use segment (5,5)->(5,6)
    const route1 = makeRoute('net1', [[5, 5, 5, 6]]);
    const route2 = makeRoute('net2', [[5, 5, 5, 6]]);
    
    const result = validateBoard(board, [], nets, [route1, route2]);
    
    const crossings = result.issues.filter(i => i.type === 'route-crossing');
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings[0].severity).toBe('warning');
  });
});

describe('Stripboard validation', () => {
  it('detects track cuts conflicting with component pins', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    
    // R1 at (5,3) has pins at (5,3) and (5,7). Cutting (5,7) severs the
    // strip right where R1 pin 2 must be soldered.
    const pad = board.pads.get(coordToKey({ row: 5, col: 7 }));
    if (pad) pad.isTrackCut = true;
    
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL);
    
    const result = validateBoard(board, [r1], [], []);
    
    const conflicts = result.issues.filter(i => i.type === 'track-cut-conflict');
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].message).toContain('F8');
    expect(conflicts[0].message).toContain('R1 pin 2');
  });

  it('detects short circuits across strips with different nets', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    
    // Place two resistors' pins on the SAME strip row (row 5, cols 3 and 6 are all on one strip)
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net3' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 6 }, 0, RESISTOR_AXIAL, { p1: 'net2', p2: 'net3' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [{ componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' }] },
      { id: 'net2', name: 'B', pins: [{ componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' }] },
      { id: 'net3', name: 'C', pins: [
        { componentId: 'r1', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
        { componentId: 'r2', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
      ]},
    ];
    
    // Mark pads with nets
    setPadNet(board, { row: 5, col: 3 }, 'net1', 'r1', 'p1');
    setPadNet(board, { row: 5, col: 7 }, 'net2', 'r2', 'p2');
    
    const result = validateBoard(board, [r1, r2], nets, []);
    
    // The strip connects (5,3) through (5,7) — multiple nets on the same strip
    const invalidStrips = result.issues.filter(i => i.type === 'invalid-stripboard-connection');
    expect(invalidStrips.length).toBeGreaterThan(0);
  });
});

describe('Connectivity graph', () => {
  it('builds a graph with nodes for every pin and junction', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [{ componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' }] },
    ];
    
    const route = makeRoute('net1', [[5, 3, 6, 3], [6, 3, 7, 3]]);
    const result = validateBoard(board, [r1], nets, [route]);
    
    // Should have 2 component pin nodes (r1 p1, p2) + junction nodes
    const pinNodes = result.connectivityGraph.nodes.filter(n => n.type === 'component-pin');
    expect(pinNodes.length).toBe(2);
    
    const junctionNodes = result.connectivityGraph.nodes.filter(n => n.type === 'junction');
    expect(junctionNodes.length).toBeGreaterThan(0);
  });

  it('reports the missing pins for incomplete nets', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    const r2 = placeComponent('r2', 'R2', { row: 10, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    
    const nets: Net[] = [
      { id: 'net1', name: 'A', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ]},
    ];
    
    const result = validateBoard(board, [r1, r2], nets, []);
    
    const netComp = result.connectivityGraph.components.find(c => c.netId === 'net1');
    expect(netComp?.isComplete).toBe(false);
    expect(netComp?.missingPins.length).toBe(1);
  });
});

describe('Multi-pin component validation', () => {
  it('handles DIP-8 components with all pins', () => {
    const board = createEmptyBoard(config);
    const u1 = placeComponent('u1', 'U1', { row: 3, col: 3 }, 0, DIP_8);
    
    const result = validateBoard(board, [u1], [], []);
    
    // DIP-8 has 8 pins, all placed, no unconnected-pin errors because no nets defined
    expect(result.stats.totalPins).toBe(8);
    expect(result.issues.filter(i => i.severity === 'error').length).toBe(0);
  });

  it('detects mounting hole conflicts', () => {
    const boardWithMounting: BoardConfig = {
      ...config,
      mountingHoles: [{ id: 'mh', row: 5, col: 3, diameterMm: 3 }],
    };
    const board = createEmptyBoard(boardWithMounting);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL);
    
    const result = validateBoard(board, [r1], [], []);
    
    expect(result.issues.some(i => i.message.includes('mounting hole'))).toBe(true);
  });
});

describe('Polarity awareness', () => {
  it('stores polarity in net pin metadata', () => {
    const anode = LED_5MM.pins.find(p => p.polarity === 'anode');
    const cathode = LED_5MM.pins.find(p => p.polarity === 'cathode');
    expect(anode && cathode).toBeTruthy();
  });
});
