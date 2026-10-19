/**
 * Routing engine tests
 */

import { describe, it, expect } from 'vitest';
import { createEmptyBoard, BoardConfig } from '../board/types';
import { getRotatedPinPositions, getComponentBoundingBox, PlacedComponent } from '../footprints/types';
import { RESISTOR_AXIAL, DIP_8 } from '../footprints/library';
import { Net } from '../circuit/types';
import { createRoutingGraph, createRoutingContext, findPath, routeNet, routeAllNets } from '../routing/engine';
import { DEFAULT_ROUTING_CONFIG } from '../routing/types';

const config: BoardConfig = {
  id: 'routing-test',
  name: 'Routing Test Board',
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

describe('Routing graph construction', () => {
  it('creates a node for every pad', () => {
    const board = createEmptyBoard(config);
    const graph = createRoutingGraph(board, [], DEFAULT_ROUTING_CONFIG);
    expect(graph.nodes.size).toBe(225); // 15 x 15
  });

  it('creates edges between adjacent pads', () => {
    const board = createEmptyBoard(config);
    const graph = createRoutingGraph(board, [], DEFAULT_ROUTING_CONFIG);
    
    // Corner pad (0,0) has 2 neighbors
    const cornerEdges = graph.edges.get('0,0');
    expect(cornerEdges?.length).toBe(2);
    
    // Middle pad (7,7) has 4 neighbors
    const middleEdges = graph.edges.get('7,7');
    expect(middleEdges?.length).toBe(4);
  });

  it('marks component pin pads as occupied', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    const graph = createRoutingGraph(board, [r1], DEFAULT_ROUTING_CONFIG);
    
    const node = graph.nodes.get('5,3');
    expect(node?.isOccupied).toBe(true);
    expect(node?.componentId).toBe('r1');
    expect(node?.pinId).toBe('p1');
  });

  it('excludes mounting holes from edge creation', () => {
    const boardConfig: BoardConfig = {
      ...config,
      mountingHoles: [{ id: 'mh', row: 0, col: 0, diameterMm: 3 }],
    };
    const board = createEmptyBoard(boardConfig);
    const graph = createRoutingGraph(board, [], DEFAULT_ROUTING_CONFIG);
    
    // (1,0) should have only 2 edges instead of 3 (excluding (0,0))
    const edges = graph.edges.get('1,0');
    expect(edges?.every(e => e.to !== '0,0')).toBe(true);
  });

  it('creates strip edges for stripboard', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    const graph = createRoutingGraph(board, [], DEFAULT_ROUTING_CONFIG);
    
    const edges = graph.edges.get('5,3');
    const stripEdges = edges?.filter(e => e.type === 'strip');
    expect(stripEdges?.length).toBe(2); // left and right strip connections
    expect(stripEdges?.[0].cost).toBeLessThan(1); // strips cheaper than wires
  });
});

describe('A* pathfinding', () => {
  it('finds a straight path between adjacent pads', () => {
    const board = createEmptyBoard(config);
    const context = createRoutingContext(board, [], [], [], new Set());
    
    const segments = findPath(context, 'net1', { row: 5, col: 5 }, [{ row: 5, col: 6 }]);
    
    expect(segments).not.toBeNull();
    expect(segments!.length).toBe(1);
    expect(segments![0].from).toEqual({ row: 5, col: 5 });
    expect(segments![0].to).toEqual({ row: 5, col: 6 });
  });

  it('finds the shortest Manhattan path', () => {
    const board = createEmptyBoard(config);
    const context = createRoutingContext(board, [], [], [], new Set());
    
    const segments = findPath(context, 'net1', { row: 2, col: 2 }, [{ row: 4, col: 5 }]);
    
    expect(segments).not.toBeNull();
    // Manhattan distance is 2 + 3 = 5
    expect(segments!.length).toBe(5);
  });

  it('routes around occupied pads of other nets', () => {
    const board = createEmptyBoard(config);
    // Block a diagonal line of pads with another net
    const blocker = placeComponent('blocker', 'B1', { row: 3, col: 2 }, 0, RESISTOR_AXIAL, { p1: 'other', p2: 'other' });
    // blocker pins at (3,2) and (3,6)
    
    const context = createRoutingContext(board, [blocker], [], [], new Set());
    
    // Route from (3,1) to (3,7), must avoid (3,2) and (3,6) - go around
    const segments = findPath(context, 'net1', { row: 3, col: 1 }, [{ row: 3, col: 7 }]);
    
    expect(segments).not.toBeNull();
    
    // The path must not pass through the blocked pins
    for (const seg of segments!) {
      expect(`${seg.to.row},${seg.to.col}`).not.toBe('3,2');
      expect(`${seg.to.row},${seg.to.col}`).not.toBe('3,6');
    }
    
    // Path must be longer than the direct Manhattan distance (6)
    expect(segments!.length).toBeGreaterThan(6);
  });

  it('returns null when no path exists', () => {
    const board = createEmptyBoard(config);
    // Create a component that blocks the start entirely? Start is our own net's pin.
    // Instead test a fully blocked target: surround (5,5) with occupied pins of other nets.
    // Simplify: place a DIP-8 that occupies the target with a different net
    const dip = placeComponent('u1', 'U1', { row: 4, col: 4 }, 0, DIP_8, {
      p1: 'other', p2: 'other', p3: 'other', p4: 'other',
      p5: 'other', p6: 'other', p7: 'other', p8: 'other',
    });
    
    const context = createRoutingContext(board, [dip], [], [], new Set());
    
    // Target (5,4) is DIP pin 1 with net 'other' - path should fail for net1
    const segments = findPath(context, 'net1', { row: 0, col: 0 }, [{ row: 5, col: 4 }]);
    expect(segments).toBeNull();
  });
});

describe('Net routing', () => {
  it('keeps minimum-jumper routes short instead of taking a large low-bend detour', () => {
    const board = createEmptyBoard(config);
    const routingConfig = { ...DEFAULT_ROUTING_CONFIG, preference: 'minimum-jumpers' as const };
    const context = createRoutingContext(board, [], [], [], new Set(), routingConfig);
    // Two staggered walls force a short zig-zag path; going around the outer
    // edge uses fewer bends but adds ten holes. Length must win that tradeoff.
    for (let row = 1; row < 14; row++) {
      if (row !== 6) context.graph.nodes.get(`${row},5`)!.componentId = 'wall-a';
      if (row !== 8) context.graph.nodes.get(`${row},9`)!.componentId = 'wall-b';
    }

    const path = findPath(context, 'n1', { row: 7, col: 1 }, [{ row: 7, col: 13 }]);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(16);
    const pathPads = [path![0].from, ...path!.map(segment => segment.to)]
      .map(coord => `${coord.row},${coord.col}`);
    expect(new Set(pathPads).size).toBe(pathPads.length);
  });

  it('routes a two-pin net', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 8 }, 0, RESISTOR_AXIAL, { p1: 'net1', p2: 'net2' });
    
    const net: Net = {
      id: 'net1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ],
    };
    
    const context = createRoutingContext(board, [r1, r2], [net], [], new Set());
    const route = routeNet(context, net);
    
    expect(route).not.toBeNull();
    expect(route!.segments.length).toBeGreaterThan(0);
    // Direct Manhattan distance between (5,3) and (5,8) is 5, but R1 pin 2
    // occupies (5,7) on the straight line (net2) — the router must detour
    // around it, giving 7 grid steps.
    expect(route!.length).toBe(7);
    for (const seg of route!.segments) {
      expect(`${seg.to.row},${seg.to.col}`).not.toBe('5,7');
    }
  });

  it('routes a three-pin net (MST behavior)', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 2, col: 2 }, 90, RESISTOR_AXIAL, { p1: 'net1' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 2 }, 90, RESISTOR_AXIAL, { p1: 'net1' });
    const r3 = placeComponent('r3', 'R3', { row: 8, col: 2 }, 90, RESISTOR_AXIAL, { p1: 'net1' });
    
    const net: Net = {
      id: 'net1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r3', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ],
    };
    
    const context = createRoutingContext(board, [r1, r2, r3], [net], [], new Set());
    const route = routeNet(context, net);
    
    expect(route).not.toBeNull();
    // The second span detours around R1's unconnected pin lead at (6,2).
    expect(route!.length).toBe(8);
  });

  it('returns empty route when stripboard already connects all pins', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    // Both resistors on the same strip row
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 2 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 6 }, 0, RESISTOR_AXIAL, { p1: 'net1' });
    // pins at (5,2), (5,6) both on row-5 strip
    
    const net: Net = {
      id: 'net1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' },
      ],
    };
    
    const context = createRoutingContext(board, [r1, r2], [net], [], new Set());
    const route = routeNet(context, net);
    
    expect(route).not.toBeNull();
    expect(route!.segments.length).toBe(0); // No wires needed - the strip does it
  });

  it('refuses to route a net across copper shared by a different net', () => {
    const stripConfig: BoardConfig = { ...config, type: 'stripboard', stripDirection: 'horizontal' };
    const board = createEmptyBoard(stripConfig);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 2 }, 90, RESISTOR_AXIAL, { p1: 'n1' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 10 }, 90, RESISTOR_AXIAL, { p1: 'n1' });
    const shorted = placeComponent('r3', 'R3', { row: 5, col: 6 }, 90, RESISTOR_AXIAL, { p1: 'n2' });
    const net: Net = { id: 'n1', name: 'N1', pins: [
      { componentId: 'r1', pinId: 'p1', pinName: '1', pinNumber: '1' },
      { componentId: 'r2', pinId: 'p1', pinName: '1', pinNumber: '1' },
    ] };
    const result = routeAllNets(createRoutingContext(board, [r1, r2, shorted], [net], [], new Set()));
    expect(result.unroutedNets).toEqual(['n1']);
    expect(result.errors[0].code).toBe('STRIPBOARD_NET_CONFLICT');
    expect(result.routes).toHaveLength(0);
  });

  it('routes multiple nets without overlapping same-net pairs', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 3, col: 3 }, 90, RESISTOR_AXIAL, { p1: 'n1', p2: 'n2' });
    const r2 = placeComponent('r2', 'R2', { row: 3, col: 10 }, 90, RESISTOR_AXIAL, { p1: 'n1', p2: 'n2' });
    
    const nets: Net[] = [
      { id: 'n1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'A', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'A', pinNumber: '1' },
      ]},
      { id: 'n2', name: 'N2', pins: [
        { componentId: 'r1', pinId: 'p2', pinName: 'B', pinNumber: '2' },
        { componentId: 'r2', pinId: 'p2', pinName: 'B', pinNumber: '2' },
      ]},
    ];
    
    const context = createRoutingContext(board, [r1, r2], nets, [], new Set());
    const result = routeAllNets(context);
    
    expect(result.routes.length).toBe(2);
    expect(result.unroutedNets.length).toBe(0);
  });

  it('does not reuse a routed perfboard pad for another net', () => {
    const board = createEmptyBoard(config);
    const endpoint = (id: string, row: number, col: number, netId: string) => {
      const component = placeComponent(id, id.toUpperCase(), { row, col }, 0, RESISTOR_AXIAL, { p1: netId });
      component.pinPositions = new Map([['p1', { row, col }]]);
      component.nets = new Map([['p1', netId]]);
      return component;
    };
    const components = [
      endpoint('a1', 7, 1, 'horizontal'),
      endpoint('a2', 7, 13, 'horizontal'),
      endpoint('b1', 1, 7, 'vertical'),
      endpoint('b2', 13, 7, 'vertical'),
    ];
    const nets: Net[] = [
      { id: 'horizontal', name: 'H', pins: [
        { componentId: 'a1', pinId: 'p1', pinName: '1', pinNumber: '1' },
        { componentId: 'a2', pinId: 'p1', pinName: '1', pinNumber: '1' },
      ] },
      { id: 'vertical', name: 'V', pins: [
        { componentId: 'b1', pinId: 'p1', pinName: '1', pinNumber: '1' },
        { componentId: 'b2', pinId: 'p1', pinName: '1', pinNumber: '1' },
      ] },
    ];

    const result = routeAllNets(createRoutingContext(board, components, nets, [], new Set()));
    expect(result.unroutedNets).toHaveLength(0);
    const routePads = result.routes.map(route => new Set(route.segments.flatMap(segment => [
      `${segment.from.row},${segment.from.col}`,
      `${segment.to.row},${segment.to.col}`,
    ])));
    expect([...routePads[0]].some(pad => routePads[1].has(pad))).toBe(false);
  });

  it('rejects different nets assigned to the same physical component pad', () => {
    const board = createEmptyBoard(config);
    const endpoint = (id: string, row: number, col: number, netId: string) => {
      const component = placeComponent(id, id.toUpperCase(), { row, col }, 0, RESISTOR_AXIAL, { p1: netId });
      component.pinPositions = new Map([['p1', { row, col }]]);
      return component;
    };
    const components = [
      endpoint('shared-a', 7, 7, 'n1'),
      endpoint('shared-b', 7, 7, 'n2'),
      endpoint('a-end', 7, 2, 'n1'),
      endpoint('b-end', 7, 12, 'n2'),
    ];
    const nets: Net[] = [
      { id: 'n1', name: 'N1', pins: [
        { componentId: 'shared-a', pinId: 'p1', pinName: '1', pinNumber: '1' },
        { componentId: 'a-end', pinId: 'p1', pinName: '1', pinNumber: '1' },
      ] },
      { id: 'n2', name: 'N2', pins: [
        { componentId: 'shared-b', pinId: 'p1', pinName: '1', pinNumber: '1' },
        { componentId: 'b-end', pinId: 'p1', pinName: '1', pinNumber: '1' },
      ] },
    ];

    const result = routeAllNets(createRoutingContext(board, components, nets, [], new Set()));
    expect(result.routes).toHaveLength(0);
    expect(result.unroutedNets).toEqual(expect.arrayContaining(['n1', 'n2']));
    expect(result.errors.filter(error => error.code === 'PAD_NET_CONFLICT')).toHaveLength(2);
    expect(result.errors.every(error => error.coordinate?.row === 7 && error.coordinate?.col === 7)).toBe(true);
  });

  it('branches a multi-pin net from existing wire pads without duplicating wire segments', () => {
    const board = createEmptyBoard(config);
    const endpoint = (id: string, row: number, col: number) => {
      const component = placeComponent(id, id.toUpperCase(), { row, col }, 0, RESISTOR_AXIAL, { p1: 'n1' });
      component.pinPositions = new Map([['p1', { row, col }]]);
      return component;
    };
    const components = [endpoint('left', 7, 1), endpoint('right', 7, 13), endpoint('branch', 6, 7)];
    const net: Net = { id: 'n1', name: 'N1', pins: components.map(component => ({
      componentId: component.id,
      pinId: 'p1',
      pinName: '1',
      pinNumber: '1',
    })) };

    const route = routeNet(createRoutingContext(board, components, [net], [], new Set()), net);
    expect(route).not.toBeNull();
    const edgeKeys = route!.segments.map(segment => {
      const from = `${segment.from.row},${segment.from.col}`;
      const to = `${segment.to.row},${segment.to.col}`;
      return from < to ? `${from}|${to}` : `${to}|${from}`;
    });
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
    expect(route!.segments.length).toBeLessThanOrEqual(14);
  });
});

describe('Congestion handling', () => {
  it('increases congestion on used paths', () => {
    const board = createEmptyBoard(config);
    const r1 = placeComponent('r1', 'R1', { row: 5, col: 3 }, 0, RESISTOR_AXIAL, { p1: 'n1' });
    const r2 = placeComponent('r2', 'R2', { row: 5, col: 8 }, 0, RESISTOR_AXIAL, { p1: 'n1' });
    
    const net: Net = {
      id: 'n1', name: 'N1', pins: [
        { componentId: 'r1', pinId: 'p1', pinName: 'A', pinNumber: '1' },
        { componentId: 'r2', pinId: 'p1', pinName: 'A', pinNumber: '1' },
      ],
    };
    
    const context = createRoutingContext(board, [r1, r2], [net], [], new Set());
    routeNet(context, net);
    
    // Some pads along the path should have congestion > 0
    const congestedPads = Array.from(context.congestion.values()).filter(v => v > 0);
    expect(congestedPads.length).toBeGreaterThan(0);
  });
});
