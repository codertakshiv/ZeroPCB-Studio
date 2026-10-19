/**
 * Schematic editor + board appearance tests
 *
 * Covers the symbol layout engine, auto-layout determinism, pin-to-pin wiring
 * semantics (create / join / merge nets) and the PCB appearance palettes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app/store';
import { registerAllStandardFootprints, RESISTOR_AXIAL, DIP_8, LED_5MM, CAPACITOR_CERAMIC } from '../footprints/library';
import {
  getSymbolLayout,
  getSymbolBodyBox,
  computeSchematicLayout,
  getWirePoints,
  suggestNetName,
  nextAutoNetName,
  isAutoNetName,
} from '../schematic/symbols';
import { getPcbPalette, BOARD_APPEARANCES } from '../board/appearance';
import { renderBoardSVG } from '../exporters/svg';
import { createEmptyBoard, BoardConfig } from '../board/types';
import { registerFootprint, Footprint, Pin, getAllFootprints } from '../footprints/types';

registerAllStandardFootprints();

function resetStore() {
  useAppStore.getState().resetProject();
}

describe('Schematic symbols', () => {
  it('draws two-pin parts left-to-right with pins on the border', () => {
    const layout = getSymbolLayout(RESISTOR_AXIAL);
    expect(layout.drawing).toBe('resistor');
    expect(layout.pins).toHaveLength(2);
    expect(layout.pins[0].side).toBe('left');
    expect(layout.pins[0].x).toBe(0);
    expect(layout.pins[1].side).toBe('right');
    expect(layout.pins[1].x).toBe(layout.width);
  });

  it('maps footprints missing from the layout rules to a generic symbol', () => {
    const layout = getSymbolLayout(undefined);
    expect(layout.pins).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
  });

  it('keeps every symbol body box inside the symbol and free of pins', () => {
    // The wire router bows legs around body boxes and relies on this:
    // a pin sits on the border or outside, never inside its own body.
    const layouts = getAllFootprints().map(f => getSymbolLayout(f));
    layouts.push(getSymbolLayout(undefined));
    expect(layouts.length).toBeGreaterThan(5);

    for (const layout of layouts) {
      const box = getSymbolBodyBox(layout);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height);

      for (const pin of layout.pins) {
        const inside =
          pin.x > box.x + 0.05 &&
          pin.x < box.x + box.width - 0.05 &&
          pin.y > box.y + 0.05 &&
          pin.y < box.y + box.height - 0.05;
        expect(inside, `pin ${pin.pinId} of ${layout.drawing} lies inside the body box`).toBe(false);
      }
    }
  });

  it('lays out DIP packages with pin 1 top-left and the last pin top-right', () => {
    const layout = getSymbolLayout(DIP_8);
    expect(layout.drawing).toBe('dip');
    expect(layout.pins).toHaveLength(8);
    const first = layout.pins[0];
    const last = layout.pins[7];
    expect(first.side).toBe('left');
    expect(first.y).toBe(1); // top of the left side
    expect(last.side).toBe('right');
    expect(last.y).toBe(1); // top of the right side
    // Left column descends: pins 1..4
    expect(layout.pins[1].y).toBe(2);
    expect(layout.pins[3].y).toBe(4);
    // Right column ascends towards pin 8
    expect(layout.pins[5].y).toBe(3);
  });

  it('lays out LEDs and capacitors with the two-pin rule', () => {
    for (const fp of [LED_5MM, CAPACITOR_CERAMIC]) {
      const layout = getSymbolLayout(fp);
      expect(layout.pins).toHaveLength(2);
      expect(layout.pins[0].x).toBe(0);
      expect(layout.pins[1].x).toBe(layout.width);
    }
  });
});

describe('Schematic auto layout', () => {
  it('is deterministic and lays symbols out without overlap', () => {
    const components = [
      { id: 'a', footprint: RESISTOR_AXIAL },
      { id: 'b', footprint: LED_5MM },
      { id: 'c', footprint: DIP_8 },
    ];
    const first = computeSchematicLayout(components);
    const second = computeSchematicLayout(components);
    expect([...first.entries()]).toEqual([...second.entries()]);

    // No two symbols share the same origin
    const origins = [...first.values()].map(p => `${p.x},${p.y}`);
    expect(new Set(origins).size).toBe(origins.length);
  });

  it('keeps existing positions and places only new components below them', () => {
    const components = [
      { id: 'a', footprint: RESISTOR_AXIAL },
      { id: 'b', footprint: DIP_8 },
    ];
    const existing = new Map([['a', { x: 12, y: 3 }]]);
    const result = computeSchematicLayout(components, existing, true);
    expect(result.get('a')).toEqual({ x: 12, y: 3 });
    const b = result.get('b')!;
    expect(b.y).toBeGreaterThan(3); // below the existing symbol
  });
});

describe('Schematic wires', () => {
  it('uses a straight line for aligned pins and an orthogonal dogleg otherwise', () => {
    expect(getWirePoints({ x: 0, y: 0 }, { x: 5, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    const path = getWirePoints({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(path).toHaveLength(4);
    expect(path[1].x).toBe(2);
    expect(path[2].x).toBe(2);
  });
});

describe('Net naming', () => {
  it('suggests names for power and ground pins', () => {
    const pin = (name: string): Pin => ({ id: 'p', number: '1', name, offset: { row: 0, col: 0 } });
    expect(suggestNetName([pin('GND')])).toBe('GND');
    expect(suggestNetName([pin('VCC')])).toBe('VCC');
    expect(suggestNetName([pin('3V3')])).toBe('3V3');
    expect(suggestNetName([pin('Pin 1')])).toBeNull();
  });

  it('generates unique auto names', () => {
    expect(nextAutoNetName([], 1)).toEqual({ name: 'N1', counter: 2 });
    expect(nextAutoNetName(['N1', 'N2'], 1).name).toBe('N3');
    expect(isAutoNetName('N12')).toBe(true);
    expect(isAutoNetName('GND')).toBe(false);
  });
});

describe('Store: connectPins', () => {
  beforeEach(resetStore);

  it('creates a new net connecting both pins', () => {
    const store = useAppStore.getState();
    const r1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const r2 = store.addComponentToCircuit('resistor-axial', 'R2');

    useAppStore.getState().connectPins(
      { componentId: r1, pinId: 'p1' },
      { componentId: r2, pinId: 'p1' }
    );

    const state = useAppStore.getState();
    expect(state.circuit.nets).toHaveLength(1);
    const net = state.circuit.nets[0];
    expect(net.pins).toHaveLength(2);
    expect(state.circuit.components.find(c => c.id === r1)!.pins.get('p1')).toBe(net.id);
    expect(state.circuit.components.find(c => c.id === r2)!.pins.get('p1')).toBe(net.id);
  });

  it('joins an existing net when the other pin is unconnected', () => {
    const store = useAppStore.getState();
    const r1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const r2 = store.addComponentToCircuit('resistor-axial', 'R2');
    const netId = store.addNet('SIG');

    useAppStore.getState().connectPinToNet(r1, 'p1', netId);
    useAppStore.getState().connectPins(
      { componentId: r1, pinId: 'p1' },
      { componentId: r2, pinId: 'p2' }
    );

    const state = useAppStore.getState();
    expect(state.circuit.nets).toHaveLength(1);
    expect(state.circuit.nets[0].pins).toHaveLength(2);
    expect(state.circuit.components.find(c => c.id === r2)!.pins.get('p2')).toBe(netId);
  });

  it('merges two nets that get wired together, keeping the meaningful name', () => {
    const store = useAppStore.getState();
    const r1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const r2 = store.addComponentToCircuit('resistor-axial', 'R2');
    const r3 = store.addComponentToCircuit('resistor-axial', 'R3');
    const r4 = store.addComponentToCircuit('resistor-axial', 'R4');

    const autoNet = store.addNet('N1');
    const namedNet = store.addNet('GND');

    useAppStore.getState().connectPinToNet(r1, 'p1', autoNet);
    useAppStore.getState().connectPinToNet(r2, 'p1', autoNet);
    useAppStore.getState().connectPinToNet(r3, 'p1', namedNet);
    useAppStore.getState().connectPinToNet(r4, 'p1', namedNet);

    // Wire the two nets together
    useAppStore.getState().connectPins(
      { componentId: r1, pinId: 'p1' },
      { componentId: r3, pinId: 'p1' }
    );

    const state = useAppStore.getState();
    expect(state.circuit.nets).toHaveLength(1);
    expect(state.circuit.nets[0].name).toBe('GND');
    expect(state.circuit.nets[0].pins).toHaveLength(4);
    // All pins now point at the surviving net
    for (const id of [r1, r2, r3, r4]) {
      const comp = state.circuit.components.find(c => c.id === id)!;
      expect(comp.pins.get('p1')).toBe(state.circuit.nets[0].id);
    }
  });

  it('does nothing when both pins are already on the same net', () => {
    const store = useAppStore.getState();
    const r1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const r2 = store.addComponentToCircuit('resistor-axial', 'R2');
    const netId = store.addNet('SIG');
    useAppStore.getState().connectPinToNet(r1, 'p1', netId);
    useAppStore.getState().connectPinToNet(r2, 'p1', netId);

    const historyBefore = useAppStore.getState().history.length;
    useAppStore.getState().connectPins(
      { componentId: r1, pinId: 'p1' },
      { componentId: r2, pinId: 'p1' }
    );
    expect(useAppStore.getState().history.length).toBe(historyBefore);
  });

  it('is undoable as a single action', () => {
    const store = useAppStore.getState();
    const r1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const r2 = store.addComponentToCircuit('resistor-axial', 'R2');

    useAppStore.getState().connectPins(
      { componentId: r1, pinId: 'p1' },
      { componentId: r2, pinId: 'p1' }
    );
    expect(useAppStore.getState().circuit.nets).toHaveLength(1);

    useAppStore.getState().undo();
    expect(useAppStore.getState().circuit.nets).toHaveLength(0);
    expect(useAppStore.getState().circuit.components.find(c => c.id === r1)!.pins.size).toBe(0);
  });

  it('names nets after GND/VCC pins when a wire is drawn between them', () => {
    // Custom footprint with named power pins
    const powerHeader: Footprint = {
      id: 'test-power-header',
      name: 'Power Header',
      description: 'test',
      category: 'pin-header',
      pins: [
        { id: 'p1', number: '1', name: 'GND', offset: { row: 0, col: 0 } },
        { id: 'p2', number: '2', name: 'VCC', offset: { row: 1, col: 0 } },
        { id: 'p3', number: '3', name: 'GND', offset: { row: 2, col: 0 } },
      ],
      width: 1,
      height: 3,
      supportedOrientations: [0],
      defaultOrientation: 0,
      pinSpacing: { row: 1, col: 0 },
      isPolarized: false,
    };
    registerFootprint(powerHeader);

    const store = useAppStore.getState();
    const h1 = store.addComponentToCircuit('test-power-header', 'J1');
    const h2 = useAppStore.getState().addComponentToCircuit('test-power-header', 'J2');

    useAppStore.getState().connectPins(
      { componentId: h1, pinId: 'p1' },
      { componentId: h2, pinId: 'p1' }
    );
    const gndNet = useAppStore.getState().circuit.nets[0];
    expect(gndNet.name).toBe('GND');
    expect(gndNet.isGround).toBe(true);

    useAppStore.getState().connectPins(
      { componentId: h1, pinId: 'p2' },
      { componentId: h2, pinId: 'p2' }
    );
    const vccNet = useAppStore.getState().circuit.nets.find(n => n.name === 'VCC');
    expect(vccNet).toBeTruthy();
    expect(vccNet!.isPower).toBe(true);
  });
});

describe('Board appearance', () => {
  it('provides five distinct finishes with a black default', () => {
    expect(BOARD_APPEARANCES).toHaveLength(5);
    const masks = BOARD_APPEARANCES.map(a => getPcbPalette(a).maskTop);
    expect(new Set(masks).size).toBe(5);
    expect(getPcbPalette(undefined).maskTop).toBe(getPcbPalette('black').maskTop);
    expect(getPcbPalette('black').maskTop).not.toBe(getPcbPalette('green').maskTop);
  });

  it('renders the chosen finish into exported SVG', () => {
    const baseConfig: BoardConfig = {
      id: 'test-board',
      name: 'Test',
      type: 'perfboard',
      dimensions: {
        rows: 4, cols: 4, holePitchMm: 2.54,
        widthMm: 10.16, heightMm: 10.16,
        marginTopMm: 3, marginBottomMm: 3, marginLeftMm: 3, marginRightMm: 3,
      },
      mountingHoles: [],
      createdAt: 0,
      updatedAt: 0,
    };

    // renderBoardSVG(board, components, routes, nets, options)
    const blackBoard = createEmptyBoard({ ...baseConfig, appearance: 'black' });
    const blackSvg = renderBoardSVG(blackBoard, [], [], [], { side: 'solder' });
    expect(blackSvg).toContain(getPcbPalette('black').maskBottom);
    expect(blackSvg).toContain(getPcbPalette('black').pad);

    // Default finish (black) is used when no appearance is chosen
    const defaultBoard = createEmptyBoard({ ...baseConfig });
    const defaultSvg = renderBoardSVG(defaultBoard, [], [], [], { side: 'component' });
    expect(defaultSvg).toContain(getPcbPalette('black').maskTop);

    // Explicit green finish still renders green (option remains selectable)
    const greenBoard = createEmptyBoard({ ...baseConfig, appearance: 'green' });
    const greenSvg = renderBoardSVG(greenBoard, [], [], [], { side: 'component' });
    expect(greenSvg).toContain(getPcbPalette('green').maskTop);
  });
});
