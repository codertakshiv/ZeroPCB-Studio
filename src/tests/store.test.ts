/**
 * Store tests - undo/redo, component management, project save/load
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app/store';
import { registerAllStandardFootprints } from '../footprints/library';

registerAllStandardFootprints();

function resetStore() {
  useAppStore.getState().resetProject();
}

describe('Store: component management', () => {
  beforeEach(resetStore);
  
  it('adds components to the circuit', () => {
    const store = useAppStore.getState();
    const id = store.addComponentToCircuit('resistor-axial', 'R1', '10k');
    
    const updated = useAppStore.getState();
    expect(updated.circuit.components.length).toBe(1);
    expect(updated.circuit.components[0].reference).toBe('R1');
    expect(updated.circuit.components[0].value).toBe('10k');
    expect(id).toBeTruthy();
  });
  
  it('removes components and their net pins', () => {
    const store = useAppStore.getState();
    const id = store.addComponentToCircuit('resistor-axial', 'R1', '10k');
    const netId = store.addNet('NET1');
    
    useAppStore.getState().connectPinToNet(id, 'p1', netId);
    expect(useAppStore.getState().circuit.nets[0].pins.length).toBe(1);
    
    useAppStore.getState().removeComponentFromCircuit(id);
    
    const after = useAppStore.getState();
    expect(after.circuit.components.length).toBe(0);
    // Net should have its pin removed
    const net = after.circuit.nets.find(n => n.id === netId);
    expect(net?.pins.length || 0).toBe(0);
  });
  
  it('connects and disconnects pins to nets', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    const netId = store.addNet('SIGNAL');
    
    useAppStore.getState().connectPinToNet(compId, 'p1', netId);
    
    let state = useAppStore.getState();
    expect(state.circuit.components[0].pins.get('p1')).toBe(netId);
    expect(state.circuit.nets[0].pins.length).toBe(1);
    expect(state.circuit.nets[0].pins[0].pinNumber).toBe('1');
    
    useAppStore.getState().disconnectPinFromNet(compId, 'p1');
    
    state = useAppStore.getState();
    expect(state.circuit.components[0].pins.has('p1')).toBe(false);
  });
  
  it('moving a pin to another net removes the old connection', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    const net1 = store.addNet('NET1');
    const net2 = store.addNet('NET2');
    
    useAppStore.getState().connectPinToNet(compId, 'p1', net1);
    useAppStore.getState().connectPinToNet(compId, 'p1', net2);
    
    const state = useAppStore.getState();
    expect(state.circuit.components[0].pins.get('p1')).toBe(net2);
    
    const n1 = state.circuit.nets.find(n => n.id === net1);
    const n2 = state.circuit.nets.find(n => n.id === net2);
    expect(n1?.pins.length || 0).toBe(0);
    expect(n2?.pins.length).toBe(1);
  });
});

describe('Store: placement', () => {
  beforeEach(resetStore);
  
  it('places a component at valid coordinates', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    
    const result = useAppStore.getState().placeComponent(compId, { row: 5, col: 5 }, 0);
    
    expect(result.success).toBe(true);
    const state = useAppStore.getState();
    expect(state.placedComponents.length).toBe(1);
    expect(state.placedComponents[0].position).toEqual({ row: 5, col: 5 });
    expect(state.placedComponents[0].pinPositions.get('p1')).toEqual({ row: 5, col: 5 });
    expect(state.placedComponents[0].pinPositions.get('p2')).toEqual({ row: 5, col: 9 });
  });
  
  it('rejects placement outside the board', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    
    // Default board is 30 rows x 20 cols
    const result = useAppStore.getState().placeComponent(compId, { row: 50, col: 5 }, 0);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
  
  it('rejects placement on a mounting hole', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    
    // Default board has mounting holes at corners (0,0), (0,19), (29,0), (29,19)
    const result = useAppStore.getState().placeComponent(compId, { row: 0, col: 0 }, 0);
    expect(result.success).toBe(false);
  });
  
  it('rejects overlapping placements', () => {
    const store = useAppStore.getState();
    const c1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const c2 = store.addComponentToCircuit('resistor-axial', 'R2');
    
    useAppStore.getState().placeComponent(c1, { row: 5, col: 5 }, 0);
    const result = useAppStore.getState().placeComponent(c2, { row: 5, col: 5 }, 0);
    
    expect(result.success).toBe(false);
  });
  
  it('rotates components', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    
    useAppStore.getState().placeComponent(compId, { row: 5, col: 5 }, 0);
    useAppStore.getState().rotateComponent(compId, 'cw');
    
    const comp = useAppStore.getState().placedComponents[0];
    expect(comp.orientation).toBe(90);
  });
  
  it('locks and unlocks components', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    
    useAppStore.getState().placeComponent(compId, { row: 5, col: 5 }, 0);
    useAppStore.getState().lockComponent(compId, true);
    expect(useAppStore.getState().placedComponents[0].locked).toBe(true);
    
    useAppStore.getState().lockComponent(compId, false);
    expect(useAppStore.getState().placedComponents[0].locked).toBe(false);
  });
});

describe('Store: undo/redo', () => {
  beforeEach(resetStore);
  
  it('undoes adding a component', () => {
    const store = useAppStore.getState();
    
    // pushHistory happens inside addComponentToCircuit
    store.addComponentToCircuit('resistor-axial', 'R1');
    expect(useAppStore.getState().circuit.components.length).toBe(1);
    
    useAppStore.getState().undo();
    expect(useAppStore.getState().circuit.components.length).toBe(0);
  });
  
  it('redoes after undo', () => {
    const store = useAppStore.getState();
    
    store.addComponentToCircuit('resistor-axial', 'R1');
    store.addComponentToCircuit('resistor-axial', 'R2');
    expect(useAppStore.getState().circuit.components.length).toBe(2);
    
    useAppStore.getState().undo();
    expect(useAppStore.getState().circuit.components.length).toBe(1);
    
    useAppStore.getState().redo();
    expect(useAppStore.getState().circuit.components.length).toBe(2);
  });
  
  it('undoes pin connections', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    const netId = store.addNet('NET1');
    useAppStore.getState().connectPinToNet(compId, 'p1', netId);
    
    expect(useAppStore.getState().circuit.nets[0].pins.length).toBe(1);
    
    useAppStore.getState().undo();
    expect(useAppStore.getState().circuit.nets[0].pins.length).toBe(0);
  });
  
  it('undoes placement', () => {
    const store = useAppStore.getState();
    const compId = store.addComponentToCircuit('resistor-axial', 'R1');
    useAppStore.getState().placeComponent(compId, { row: 5, col: 5 }, 0);
    
    expect(useAppStore.getState().placedComponents.length).toBe(1);
    
    useAppStore.getState().undo();
    expect(useAppStore.getState().placedComponents.length).toBe(0);
  });
  
  it('undone actions do not resurrect after a new action', () => {
    let store = useAppStore.getState();
    store.addComponentToCircuit('resistor-axial', 'R1');
    useAppStore.getState().undo();
    store = useAppStore.getState();
    store.addComponentToCircuit('resistor-axial', 'R2');
    
    // A new action clears the redo future - R1 must not come back
    useAppStore.getState().redo();
    const state = useAppStore.getState();
    expect(state.circuit.components.length).toBe(1);
    expect(state.circuit.components[0].reference).toBe('R2');
  });
});

describe('Store: board configuration', () => {
  beforeEach(resetStore);
  
  it('changes board dimensions', () => {
    useAppStore.getState().setBoardDimensions({ rows: 10, cols: 10 });
    
    const state = useAppStore.getState();
    expect(state.boardConfig.dimensions.rows).toBe(10);
    expect(state.boardConfig.dimensions.cols).toBe(10);
    expect(state.board.pads.size).toBe(100);
  });
  
  it('defaults to a consistent 5x7cm protoboard (20x30 holes, exact 50.8x76.2mm)', () => {
    const dims = useAppStore.getState().boardConfig.dimensions;
    expect(dims.rows).toBe(30);
    expect(dims.cols).toBe(20);
    expect(dims.widthMm).toBeCloseTo(50.8, 2);
    expect(dims.heightMm).toBeCloseTo(76.2, 2);
  });
  
  it('always derives the physical board size from the hole grid', () => {
    useAppStore.getState().setBoardDimensions({ rows: 31, cols: 21 });
    
    const dims = useAppStore.getState().boardConfig.dimensions;
    // width = marginLeft + (cols-1)*pitch + marginRight (and same for height)
    expect(dims.widthMm).toBeCloseTo(1.27 + 20 * 2.54 + 1.27, 2);
    expect(dims.heightMm).toBeCloseTo(1.27 + 30 * 2.54 + 1.27, 2);
  });
  
  it('re-derives the size when pitch or margins change', () => {
    useAppStore.getState().setBoardDimensions({ holePitchMm: 5.08 });
    const pitchDims = useAppStore.getState().boardConfig.dimensions;
    expect(pitchDims.widthMm).toBeCloseTo(1.27 + 19 * 5.08 + 1.27, 2);
    
    useAppStore.getState().setBoardDimensions({ marginLeftMm: 5, marginRightMm: 5 });
    const marginDims = useAppStore.getState().boardConfig.dimensions;
    expect(marginDims.widthMm).toBeCloseTo(5 + 19 * 5.08 + 5, 2);
  });
  
  it('switching to stripboard creates strip connectivity', () => {
    useAppStore.getState().setBoardConfig({
      type: 'stripboard',
      stripDirection: 'horizontal',
    });
    
    const state = useAppStore.getState();
    expect(state.boardConfig.type).toBe('stripboard');
    
    // (0,0) is a mounting hole, so check a regular hole: (5,5) must be
    // connected both left (5,4) and right (5,6) by its copper strip
    const pad = state.board.pads.get('5,5');
    expect(pad?.customConnectedPads?.length).toBe(2);
    expect(pad?.customConnectedPads).toContainEqual({ row: 5, col: 4 });
    expect(pad?.customConnectedPads).toContainEqual({ row: 5, col: 6 });
  });
  
  it('toggles track cuts and undoes them', () => {
    useAppStore.getState().setBoardConfig({
      type: 'stripboard',
      stripDirection: 'horizontal',
    });
    
    useAppStore.getState().toggleTrackCut({ row: 5, col: 5 });
    expect(useAppStore.getState().board.pads.get('5,5')?.isTrackCut).toBe(true);
    
    useAppStore.getState().undo();
    expect(useAppStore.getState().board.pads.get('5,5')?.isTrackCut).toBe(false);
  });
});

describe('Store: net selection & highlighting', () => {
  beforeEach(resetStore);
  
  it('selecting a net highlights its pins', () => {
    const store = useAppStore.getState();
    const c1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const c2 = store.addComponentToCircuit('resistor-axial', 'R2');
    const netId = store.addNet('SIG');
    
    useAppStore.getState().connectPinToNet(c1, 'p1', netId);
    useAppStore.getState().connectPinToNet(c2, 'p2', netId);
    useAppStore.getState().placeComponent(c1, { row: 2, col: 2 }, 0);
    useAppStore.getState().placeComponent(c2, { row: 8, col: 2 }, 0);
    
    useAppStore.getState().selectNet(netId);
    
    const state = useAppStore.getState();
    expect(state.selectedNetId).toBe(netId);
    // R1 pin1 at (2,2), R2 pin2 at (8,6)
    expect(state.highlightedCoordinates.has('2,2')).toBe(true);
    expect(state.highlightedCoordinates.has('8,6')).toBe(true);
  });
  
  it('clearHighlights resets selection', () => {
    const store = useAppStore.getState();
    const c1 = store.addComponentToCircuit('resistor-axial', 'R1');
    useAppStore.getState().placeComponent(c1, { row: 2, col: 2 }, 0);
    useAppStore.getState().selectComponent(c1);
    
    expect(useAppStore.getState().selectedComponentIds.size).toBe(1);
    
    useAppStore.getState().clearHighlights();
    expect(useAppStore.getState().selectedComponentIds.size).toBe(0);
    expect(useAppStore.getState().highlightedCoordinates.size).toBe(0);
  });

  it('selectComponents selects a group and highlights every pad', () => {
    const store = useAppStore.getState();
    const c1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const c2 = store.addComponentToCircuit('resistor-axial', 'R2');
    const c3 = store.addComponentToCircuit('led-5mm', 'D1');
    useAppStore.getState().placeComponent(c1, { row: 2, col: 2 }, 0);
    useAppStore.getState().placeComponent(c2, { row: 8, col: 2 }, 0);
    useAppStore.getState().placeComponent(c3, { row: 12, col: 2 }, 0);

    useAppStore.getState().selectComponents([c1, c2]);

    let state = useAppStore.getState();
    expect([...state.selectedComponentIds].sort()).toEqual([c1, c2].sort());
    // R1 pin1 (2,2) / pin2 (2,6), R2 pin1 (8,2) / pin2 (8,6)
    expect(state.highlightedCoordinates.has('2,2')).toBe(true);
    expect(state.highlightedCoordinates.has('8,6')).toBe(true);
    expect(state.highlightedCoordinates.has('12,2')).toBe(false);

    // additive selection adds, and toggling one off keeps the rest
    useAppStore.getState().selectComponents([c3], true);
    expect(useAppStore.getState().selectedComponentIds.size).toBe(3);
    useAppStore.getState().selectComponents([c3], true);
    state = useAppStore.getState();
    expect([...state.selectedComponentIds].sort()).toEqual([c1, c2].sort());
    expect(state.highlightedCoordinates.has('12,2')).toBe(false);

    // a plain call replaces the selection
    useAppStore.getState().selectComponents([c3]);
    state = useAppStore.getState();
    expect([...state.selectedComponentIds]).toEqual([c3]);
  });

  it('moving several schematic symbols keeps one undo step', () => {
    const store = useAppStore.getState();
    const c1 = store.addComponentToCircuit('resistor-axial', 'R1');
    const c2 = store.addComponentToCircuit('resistor-axial', 'R2');
    useAppStore.getState().ensureSchematicPositions();

    const before = new Map(useAppStore.getState().schematicPositions);
    expect(before.size).toBe(2);

    // What the canvas drag does: one snapshot, then raw moves
    useAppStore.getState().pushHistory();
    for (const [id, pos] of before) {
      useAppStore.getState().moveSchematicComponent(id, { x: pos.x + 2, y: pos.y + 1.5 });
    }
    const moved = useAppStore.getState().schematicPositions;
    for (const [id, pos] of before) {
      expect(moved.get(id)).toEqual({ x: pos.x + 2, y: pos.y + 1.5 });
    }

    useAppStore.getState().undo();
    const restored = useAppStore.getState().schematicPositions;
    for (const [id, pos] of before) {
      expect(restored.get(id)).toEqual(pos);
    }

    // The component ids are stable references for the drag
    expect([c1, c2].every(id => restored.has(id))).toBe(true);
  });
});

describe('Store: project load/reset', () => {
  beforeEach(resetStore);
  
  it('loads a project snapshot', () => {
    const state = useAppStore.getState();
    
    // Build a project
    const c1 = state.addComponentToCircuit('resistor-axial', 'R1');
    const c2 = state.addComponentToCircuit('led-5mm', 'D1');
    const netId = state.addNet('LED_A');
    useAppStore.getState().connectPinToNet(c2, 'p1', netId);
    useAppStore.getState().placeComponent(c1, { row: 3, col: 3 }, 0);
    useAppStore.getState().placeComponent(c2, { row: 7, col: 3 }, 0);
    
    const snapshot = {
      boardConfig: useAppStore.getState().boardConfig,
      circuit: useAppStore.getState().circuit,
      placedComponents: useAppStore.getState().placedComponents,
      routes: [],
      netIdCounter: 2,
      projectMetadata: { name: 'Test Project', version: 1, appVersion: '0.1.0' },
    };
    
    // Reset and reload
    useAppStore.getState().resetProject();
    expect(useAppStore.getState().circuit.components.length).toBe(0);
    
    useAppStore.getState().loadProject(snapshot);
    
    const after = useAppStore.getState();
    expect(after.circuit.components.length).toBe(2);
    expect(after.placedComponents.length).toBe(2);
    expect(after.circuit.nets.length).toBe(1);
    expect(after.projectMetadata.name).toBe('Test Project');
  });
});
