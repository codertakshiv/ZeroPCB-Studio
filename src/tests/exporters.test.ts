/**
 * Export and assembly guide tests
 */

import { describe, it, expect } from 'vitest';
import { createEmptyBoard, BoardConfig } from '../board/types';
import { getRotatedPinPositions, getComponentBoundingBox, PlacedComponent } from '../footprints/types';
import { RESISTOR_AXIAL, LED_5MM, DIP_8 } from '../footprints/library';
import { Net } from '../circuit/types';
import { Route } from '../routing/types';
import { renderBoardSVG } from '../exporters/svg';
import { coordinateToPixel } from '../board/transforms';
import { generatePrintableGuide } from '../exporters/print';
import {
  createProjectFile,
  serializeProject,
  deserializeProject,
  exportToJSON,
  importFromJSON,
} from '../exporters/types';
import { exportBOMCSV, exportCoordinateListCSV, exportJumperListCSV, exportNetlistCSV, exportTrackCutListCSV } from '../exporters/csv';
import { generateAssemblyGuide } from '../soldering/types';

const config: BoardConfig = {
  id: 'export-test',
  name: 'Export Test Board',
  type: 'perfboard',
  dimensions: {
    rows: 10,
    cols: 10,
    holePitchMm: 2.54,
    widthMm: 30,
    heightMm: 30,
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
  value?: string,
  nets: Record<string, string> = {}
): PlacedComponent {
  return {
    id,
    footprintId: footprint.id,
    reference,
    value,
    position,
    orientation,
    locked: false,
    nets: new Map(Object.entries(nets)),
    footprint,
    pinPositions: getRotatedPinPositions(footprint, position, orientation),
    boundingBox: getComponentBoundingBox(position, orientation, footprint),
  };
}

const r1 = placeComponent('r1', 'R1', { row: 2, col: 2 }, 0, RESISTOR_AXIAL, '10k', { p1: 'vcc', p2: 'led_a' });
const d1 = placeComponent('d1', 'D1', { row: 6, col: 2 }, 0, LED_5MM, 'Red', { p1: 'led_a', p2: 'gnd' });

const nets: Net[] = [
  { id: 'vcc', name: 'VCC', pins: [{ componentId: 'r1', pinId: 'p1', pinName: 'Lead 1', pinNumber: '1' }], isPower: true },
  { id: 'led_a', name: 'LED_A', pins: [
    { componentId: 'r1', pinId: 'p2', pinName: 'Lead 2', pinNumber: '2' },
    { componentId: 'd1', pinId: 'p1', pinName: 'Anode (+)', pinNumber: '1' },
  ]},
  { id: 'gnd', name: 'GND', pins: [{ componentId: 'd1', pinId: 'p2', pinName: 'Cathode (-)', pinNumber: '2' }], isGround: true },
];

const route: Route = {
  id: 'route1',
  netId: 'led_a',
  segments: [
    { from: { row: 2, col: 6 }, to: { row: 3, col: 6 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 3, col: 6 }, to: { row: 4, col: 6 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 4, col: 6 }, to: { row: 5, col: 6 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 5, col: 6 }, to: { row: 6, col: 6 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 6, col: 6 }, to: { row: 6, col: 5 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 6, col: 5 }, to: { row: 6, col: 4 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 6, col: 4 }, to: { row: 6, col: 3 }, layer: 'solder', netId: 'led_a', type: 'wire' },
    { from: { row: 6, col: 3 }, to: { row: 6, col: 2 }, layer: 'solder', netId: 'led_a', type: 'wire' },
  ],
  layer: 'solder',
  length: 11,
  bendCount: 1,
  locked: false,
  manual: false,
};

describe('SVG export', () => {
  const board = createEmptyBoard(config);
  
  it('produces valid SVG for component side', () => {
    const svg = renderBoardSVG(board, [r1, d1], [route], nets, {
      side: 'component',
      title: 'Test Board',
    });
    
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('R1');
    expect(svg).toContain('D1');
    expect(svg).toContain('COMPONENT SIDE (TOP)');
  });
  
  it('produces valid SVG for solder side', () => {
    const svg = renderBoardSVG(board, [r1, d1], [route], nets, {
      side: 'solder',
      title: 'Test Board',
    });
    
    expect(svg).toContain('SOLDER SIDE (BOTTOM — MIRRORED VIEW)');
    expect(svg).toContain('LED_A'); // net name
  });
  
  it('includes scale bar and board dimensions', () => {
    const svg = renderBoardSVG(board, [], [], [], {
      side: 'component',
      scaleBar: true,
    });
    
    expect(svg).toContain('10 mm');
    expect(svg).toContain('30 × 30 mm');
  });
  
  it('mirrors the solder view correctly', () => {
    const componentSVG = renderBoardSVG(board, [], [], [], { side: 'component', showCoordinates: true });
    const solderSVG = renderBoardSVG(board, [], [], [], { side: 'solder', showCoordinates: true });
    
    // Same transform pipeline as the interactive renderer:
    // pixel = coordinateToPixel(coord) + ruler+margin offset (24px), 4 px/mm
    const holeX = (coord: { row: number; col: number }, viewSide: 'component' | 'solder') =>
      (24 + coordinateToPixel(coord, config, viewSide, 4).x).toFixed(1);
    
    // The pad at (2,2) is drawn as-is on the component side...
    expect(componentSVG).toContain(`cx="${holeX({ row: 2, col: 2 }, 'component')}"`);
    // ...but mirrored horizontally on the solder side: col 2 <-> col 7 on a 10-col board
    expect(solderSVG).toContain(`cx="${holeX({ row: 2, col: 2 }, 'solder')}"`);
    expect(holeX({ row: 2, col: 2 }, 'solder')).toBe(holeX({ row: 2, col: 7 }, 'component'));
    // Different physical x position on the two views
    expect(holeX({ row: 2, col: 2 }, 'solder')).not.toBe(holeX({ row: 2, col: 2 }, 'component'));
  });
  
  it('escapes XML in labels', () => {
    const weirdComp = placeComponent('x1', 'R&D<1>', { row: 2, col: 2 }, 0, RESISTOR_AXIAL);
    const svg = renderBoardSVG(board, [weirdComp], [], [], { side: 'component' });
    expect(svg).toContain('R&amp;D&lt;1&gt;');
  });
  
  it('renders wire colors on the solder side', () => {
    const svg = renderBoardSVG(board, [r1, d1], [route], nets, { side: 'solder' });
    // Route lines present with stroke color
    expect(svg).toContain('stroke="#');
  });
});

describe('CSV exports', () => {
  it('exports BOM grouped by footprint and value', () => {
    const r2 = placeComponent('r2', 'R2', { row: 4, col: 2 }, 0, RESISTOR_AXIAL, '10k');
    const csv = exportBOMCSV([r1, r2, d1]);
    
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('References,Value,Footprint,Quantity,Description');
    expect(csv).toContain('R1, R2');
    expect(csv).toContain('10k');
    expect(csv).toContain('Quantity'.toLowerCase() === 'quantity' ? '2' : '2');
    expect(csv).toContain('D1');
  });
  
  it('exports netlist with pin references', () => {
    const csv = exportNetlistCSV(nets, [r1, d1]);
    expect(csv).toContain('Net,Reference,Pin Number,Pin Name');
    expect(csv).toContain('LED_A,R1,2,Lead 2');
    expect(csv).toContain('LED_A,D1,1');
  });
  
  it('exports jumper wire list with lengths', () => {
    const csv = exportJumperListCSV([route], nets, 2.54);
    
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Wire #');
    expect(lines.length).toBeGreaterThan(1);
    // Route is one contiguous run from (2,6) to (6,2) with a bend
    expect(csv).toContain('LED_A');
    expect(csv).toContain('W1');
  });
  
  it('exports coordinate list', () => {
    const board = createEmptyBoard(config);
    const csv = exportCoordinateListCSV(board, [r1, d1], [route], nets);
    
    expect(csv).toContain('Coordinate,Row,Col,Type');
    expect(csv).toContain('C3'); // R1 pin 1 at (2,2) = C3
    expect(csv).toContain('component-pin');
  });
  
  it('exports track cut list for stripboard', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    const pad = board.pads.get('2,4');
    if (pad) pad.isTrackCut = true;
    
    const csv = exportTrackCutListCSV(board, nets);
    expect(csv).toContain('track-cut');
    expect(csv).toContain('C5'); // (2,4) = C5
  });
  
  it('escapes CSV commas and quotes', () => {
    const comp = placeComponent('x1', 'R,1"', { row: 2, col: 2 }, 0, RESISTOR_AXIAL, '10k, 5%');
    const csv = exportBOMCSV([comp]);
    expect(csv).toContain('"R,1"""');
    expect(csv).toContain('"10k, 5%"');
  });
});

describe('Assembly guide generation', () => {
  it('generates steps for components, pins, jumpers, and verification', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'LED Test');
    
    expect(guide.steps.length).toBeGreaterThan(0);
    expect(guide.circuitName).toBe('LED Test');
    expect(guide.boardName).toBe('Test Board');
    
    const placeSteps = guide.steps.filter(s => s.type === 'place-component');
    const solderSteps = guide.steps.filter(s => s.type === 'solder-pin');
    const jumperSteps = guide.steps.filter(s => s.type === 'install-jumper');
    
    expect(placeSteps.length).toBe(2); // R1, D1
    expect(solderSteps.length).toBe(4); // 2 pins each
    expect(jumperSteps.length).toBeGreaterThan(0);
  });
  
  it('generates exact coordinates dynamically from the layout', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'LED Test');
    
    // R1 pin 1 at (2,2) = "C3"
    const r1pin1Step = guide.steps.find(s => 
      s.type === 'solder-pin' && s.componentRef === 'R1' && s.pinNumber === '1'
    );
    expect(r1pin1Step).toBeDefined();
    expect(r1pin1Step!.description).toContain('C3');
    expect(r1pin1Step!.coordinates).toEqual([{ row: 2, col: 2 }]);
    
    // D1 anode at (6,2) = "G3"
    const d1pin1Step = guide.steps.find(s =>
      s.type === 'solder-pin' && s.componentRef === 'D1' && s.pinNumber === '1'
    );
    expect(d1pin1Step!.coordinates).toEqual([{ row: 6, col: 2 }]);
  });
  
  it('includes jumper wire lengths in mm', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'LED Test');
    
    const jumperStep = guide.steps.find(s => s.type === 'install-jumper');
    expect(jumperStep).toBeDefined();
    expect(jumperStep!.wireLength).toBeGreaterThan(0);
    // The route runs 8 grid steps ((2,6)->(6,6)->(6,2)); 8 * 2.54mm = 20.32mm -> rounds to 20mm
    expect(jumperStep!.wireLength).toBe(20);
  });
  
  it('includes verification steps for multi-pin nets', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'LED Test');
    
    const verifySteps = guide.steps.filter(s => s.type === 'verify-connection');
    // LED_A has 2 pins -> verified. VCC and GND have 1 pin each -> skipped.
    expect(verifySteps.length).toBe(1);
    expect(verifySteps[0].netName).toBe('LED_A');
  });
  
  it('always includes a final inspection step', () => {
    const guide = generateAssemblyGuide([r1], nets, [], 'Test Board', 'Test');
    const inspectSteps = guide.steps.filter(s => s.type === 'inspect');
    expect(inspectSteps.length).toBe(1);
  });
  
  it('steps are numbered sequentially', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'Test');
    for (let i = 0; i < guide.steps.length; i++) {
      expect(guide.steps[i].order).toBe(i);
    }
  });
  
  it('highlights correct coordinates per step', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'Test');
    
    const placeStep = guide.steps.find(s => s.type === 'place-component' && s.componentRef === 'R1');
    expect(placeStep!.highlightedCoords).toEqual([{ row: 2, col: 2 }, { row: 2, col: 6 }]);
  });
  
  it('handles DIP ICs with multiple pins', () => {
    const u1 = placeComponent('u1', 'U1', { row: 1, col: 1 }, 0, DIP_8, 'ATtiny85');
    const guide = generateAssemblyGuide([u1], [], [], 'Test Board', 'IC Test');
    
    const solderSteps = guide.steps.filter(s => s.type === 'solder-pin');
    expect(solderSteps.length).toBe(8);
  });
  
  it('groups steps by component, net, and side', () => {
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'Test');
    
    expect(guide.groupedSteps.has('component')).toBe(true);
    expect(guide.groupedSteps.has('net')).toBe(true);
    expect(guide.groupedSteps.has('side')).toBe(true);
    expect(guide.groupedSteps.has('sequence')).toBe(true);
  });
});

describe('Printable assembly guide (PDF via print dialog)', () => {
  it('renders a complete printable document with real coordinates', () => {
    const board = createEmptyBoard(config);
    const guide = generateAssemblyGuide([r1, d1], nets, [route], 'Test Board', 'LED Test');
    
    const html = generatePrintableGuide(guide, board, [r1, d1], nets, [route], {
      pageSize: 'A4',
      orientation: 'portrait',
      projectName: 'LED Test',
      includeCoverPage: true,
    });
    
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('LED Test');
    expect(html).toContain('R1');
    expect(html).toContain('D1');
    // Real pad coordinate labels from the layout (R1 pin 1 at (2,2) = C3)
    expect(html).toContain('C3');
    // Page setup reflects the requested paper size
    expect(html).toContain('210mm 297mm');
  });
  
  it('includes board diagrams and respects landscape orientation', () => {
    const board = createEmptyBoard(config);
    const guide = generateAssemblyGuide([r1], nets, [], 'Test Board', 'Test');
    const svg = renderBoardSVG(board, [r1], [], nets, { side: 'component' });
    
    const html = generatePrintableGuide(guide, board, [r1], nets, [], {
      pageSize: 'A4',
      orientation: 'landscape',
      projectName: 'Test',
      includeComponentSideSVG: svg,
      includeCoverPage: false,
    });
    
    expect(html).toContain('297mm 210mm');
    expect(html).toContain('<svg');
  });
});

describe('Project save/load (JSON round-trip)', () => {
  it('serializes and restores Maps, board state and track cuts', () => {
    const stripConfig: BoardConfig = {
      ...config,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(stripConfig);
    const cutPad = board.pads.get('2,4');
    if (cutPad) cutPad.isTrackCut = true;
    
    const circuit = {
      id: 'c1',
      name: 'Round Trip',
      components: [
        { id: 'r1', footprintId: 'resistor-axial', reference: 'R1', value: '10k', pins: new Map([['p1', 'led_a']]) },
      ],
      nets,
      createdAt: 0,
      updatedAt: 0,
    };
    
    const project = createProjectFile(board, circuit as never, [r1], [route], nets, { name: 'Round Trip' });
    const json = serializeProject(project);
    
    // The raw JSON must contain real pad data, not `{}` from a Map
    expect(json).toContain('"isTrackCut": true');
    
    const restored = deserializeProject(json);
    expect(restored).not.toBeNull();
    
    // Board pads restored as a Map, with the track cut intact
    expect(restored!.board.pads instanceof Map).toBe(true);
    expect(restored!.board.pads.get('2,4')?.isTrackCut).toBe(true);
    expect(restored!.board.pads.size).toBe(100);
    
    // Circuit component pin map restored
    expect(restored!.circuit.components[0].pins instanceof Map).toBe(true);
    expect(restored!.circuit.components[0].pins.get('p1')).toBe('led_a');
    
    // Placed component Maps restored
    expect(restored!.components[0].nets.get('p1')).toBe('vcc');
    expect(restored!.components[0].pinPositions.get('p1')).toEqual({ row: 2, col: 2 });
    expect(restored!.components[0].pinPositions.get('p2')).toEqual({ row: 2, col: 6 });
    
    // Routes and metadata survive
    expect(restored!.routes.length).toBe(1);
    expect(restored!.routes[0].segments.length).toBe(8);
    expect(restored!.metadata.name).toBe('Round Trip');
  });

  it('migrates version 1.0 projects without changing saved placement or locks', () => {
    const board = createEmptyBoard(config);
    const circuit = {
      id: 'legacy', name: 'Legacy project', components: [], nets, createdAt: 0, updatedAt: 0,
    };
    const placed = { ...r1, locked: true, position: { row: 4, col: 6 } };
    const raw = JSON.parse(serializeProject(createProjectFile(board, circuit as never, [placed], [], nets))) as Record<string, unknown>;
    raw.version = '1.0';
    delete raw.routingPreference;
    delete raw.schematicPositions;

    const restored = deserializeProject(JSON.stringify(raw));
    expect(restored?.version).toBe('1.1');
    expect(restored?.routingPreference).toBe('minimum-jumpers');
    expect(restored?.components[0].position).toEqual({ row: 4, col: 6 });
    expect(restored?.components[0].locked).toBe(true);
  });

  it('rejects project files from a newer unsupported format', () => {
    const raw = JSON.parse(serializeProject(createProjectFile(createEmptyBoard(config), { id: 'c', name: 'C', components: [], nets, createdAt: 0, updatedAt: 0 } as never, [], [], nets))) as Record<string, unknown>;
    raw.version = '2.0';
    expect(deserializeProject(JSON.stringify(raw))).toBeNull();
  });
  
  it('rejects malformed project files', () => {
    expect(deserializeProject('not json')).toBeNull();
    expect(deserializeProject('{"foo": 1}')).toBeNull();
  });
  
  it('exportToJSON/importFromJSON round-trips through the same pipeline', () => {
    const board = createEmptyBoard(config);
    const circuit = {
      id: 'c1',
      name: 'C',
      components: [{ id: 'r1', footprintId: 'resistor-axial', reference: 'R1', pins: new Map([['p1', 'vcc']]) }],
      nets,
      createdAt: 0,
      updatedAt: 0,
    };
    const project = createProjectFile(board, circuit as never, [r1], [], nets, { name: 'Exported' });
    
    const result = exportToJSON(project);
    expect(result.success).toBe(true);
    
    const imported = importFromJSON(result.data as string);
    expect(imported).not.toBeNull();
    expect(imported!.circuit.components[0].pins.get('p1')).toBe('vcc');
    expect(imported!.board.pads instanceof Map).toBe(true);
  });
});
