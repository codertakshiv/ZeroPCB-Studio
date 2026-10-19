/**
 * Application state store (Zustand)
 * Single source of truth for board, circuit, placement, routing state.
 */

import { create } from 'zustand';
import { 
  BoardConfig, 
  BoardDimensions,
  BoardState, 
  Coordinate, 
  createEmptyBoard,
  coordToKey,
  coordToLabel,
  isCornerMountingHoles,
  makeCornerMountingHoles,
  withDerivedSize,
} from '../board/types';
import { 
  PlacedComponent, 
  Orientation,
  getRotatedPinPositions,
  getComponentBoundingBox,
} from '../footprints/types';
import { 
  Circuit, 
  Net, 
  createEmptyCircuit,
} from '../circuit/types';
import { 
  PlacementConfig, 
  PlacementMode,
  OptimizationIntensity,
  DEFAULT_PLACEMENT_CONFIG,
  PlacementResult,
} from '../placement/types';
import { 
  RoutingConfig, 
  DEFAULT_ROUTING_CONFIG, 
  RoutingResult,
  Route,
} from '../routing/types';
import { ValidationResult } from '../validation/types';
import { validateBoard } from '../validation/types';
import { AssemblyGuide, AssemblyProgress } from '../soldering/types';
import { generateAssemblyGuide, createAssemblyProgress } from '../soldering/types';
import { ProjectMetadata } from '../exporters/types';
import {
  SchematicPosition,
  computeSchematicLayout,
  nextAutoNetName,
  suggestNetName,
  isAutoNetName,
} from '../schematic/symbols';

// ============ HISTORY FOR UNDO/REDO ============

interface HistorySnapshot {
  boardConfig: BoardConfig;
  circuit: Circuit;
  placedComponents: PlacedComponent[];
  routes: Route[];
  netIdCounter: number;
  /** Pad keys (`row,col`) that carried track cuts when the snapshot was taken */
  trackCuts: string[];
  /** Schematic sheet placement, so symbol moves (single or group) undo too */
  schematicPositions: Map<string, SchematicPosition>;
}

const MAX_HISTORY = 50;

/** Reference to a single component pin */
export interface PinRef {
  componentId: string;
  pinId: string;
}

function collectTrackCuts(board: BoardState): string[] {
  const cuts: string[] = [];
  for (const [key, pad] of board.pads) {
    if (pad.isTrackCut) cuts.push(key);
  }
  return cuts;
}

function makeSnapshot(state: {
  board: BoardState;
  boardConfig: BoardConfig;
  circuit: Circuit;
  placedComponents: PlacedComponent[];
  routes: Route[];
  netIdCounter: number;
  schematicPositions: Map<string, SchematicPosition>;
}): HistorySnapshot {
  return {
    boardConfig: state.boardConfig,
    circuit: state.circuit,
    placedComponents: state.placedComponents,
    routes: state.routes,
    netIdCounter: state.netIdCounter,
    trackCuts: collectTrackCuts(state.board),
    schematicPositions: new Map(state.schematicPositions),
  };
}

/** Rebuild the mutable board (with its track cuts) from a snapshot */
function applySnapshot(snapshot: HistorySnapshot): {
  boardConfig: BoardConfig;
  board: BoardState;
  circuit: Circuit;
  placedComponents: PlacedComponent[];
  routes: Route[];
  netIdCounter: number;
  schematicPositions: Map<string, SchematicPosition>;
} {
  const board = createEmptyBoard(snapshot.boardConfig);
  for (const key of snapshot.trackCuts) {
    const pad = board.pads.get(key);
    if (pad) pad.isTrackCut = true;
  }
  return {
    boardConfig: snapshot.boardConfig,
    board,
    circuit: snapshot.circuit,
    placedComponents: snapshot.placedComponents,
    routes: snapshot.routes,
    netIdCounter: snapshot.netIdCounter,
    schematicPositions: new Map(snapshot.schematicPositions),
  };
}

// ============ STORE STATE ============

export interface AppState {
  // Board
  boardConfig: BoardConfig;
  board: BoardState;
  
  // Circuit
  circuit: Circuit;
  netIdCounter: number;
  
  // Placement
  placedComponents: PlacedComponent[];
  placementConfig: PlacementConfig;
  placementResult: PlacementResult | null;
  
  // Routing
  routes: Route[];
  routingConfig: RoutingConfig;
  routingResult: RoutingResult | null;
  lockedRouteIds: Set<string>;
  
  // Validation
  validationResult: ValidationResult | null;
  isValidating: boolean;
  
  // Assembly
  assemblyGuide: AssemblyGuide | null;
  assemblyProgress: AssemblyProgress | null;
  
  // UI State
  selectedComponentIds: Set<string>;
  selectedNetId: string | null;
  highlightedCoordinates: Set<string>;
  activeSide: 'component' | 'solder' | 'both';
  showRoutes: boolean;
  showHoles: boolean;
  zoom: number;
  panOffset: { x: number; y: number };
  theme: 'light' | 'dark';
  isOptimizing: boolean;
  optimizationStatus: string;

  // Schematic editor
  /** Which editor is shown in the workspace */
  workspaceView: 'board' | 'schematic';
  /** Symbol positions in the schematic canvas (componentId -> grid units) */
  schematicPositions: Map<string, SchematicPosition>;
  schematicZoom: number;
  /** Interactive schematic drawing area in grid units (enlarge it in the toolbar) */
  schematicCanvasSize: { w: number; h: number };
  /** Focus mode hides both side panels so the workspace fills the window */
  focusMode: boolean;
  
  // Project
  projectMetadata: ProjectMetadata;
  lastSaved: number | null;
  isDirty: boolean;
  /** Autosave feedback for the UI: idle | saving | saved | error */
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveStatusAt: number | null;
  saveError: string | null;
  
  // History (not persisted). `history` is the undo stack of snapshots taken
  // BEFORE each change; `future` holds states undone and available for redo.
  history: HistorySnapshot[];
  future: HistorySnapshot[];
  
  // Actions
  setBoardConfig: (config: Partial<BoardConfig>) => void;
  setBoardDimensions: (dims: Partial<BoardConfig['dimensions']>) => void;
  toggleTrackCut: (coord: Coordinate) => void;
  
  addComponentToCircuit: (footprintId: string, reference: string, value?: string) => string;
  removeComponentFromCircuit: (componentId: string) => void;
  updateComponentValue: (componentId: string, value: string) => void;
  updateComponentReference: (componentId: string, reference: string) => void;
  /** Replace the whole circuit (e.g. from a netlist/JSON import). Clears layout-derived state. */
  importCircuit: (circuit: Circuit) => void;
  
  addNet: (name: string, options?: Partial<Net>) => string;
  /** Rename a net in place, keeping every connected pin */
  renameNet: (netId: string, name: string) => void;
  removeNet: (netId: string) => void;
  connectPinToNet: (componentId: string, pinId: string, netId: string) => void;
  disconnectPinFromNet: (componentId: string, pinId: string) => void;
  /**
   * Connect two pins directly (schematic wiring). Creates a net when neither
   * pin is connected, joins the existing net when one is, and merges the two
   * nets when both are connected to different nets.
   */
  connectPins: (a: PinRef, b: PinRef) => void;
  
  placeComponent: (componentId: string, position: Coordinate, orientation: Orientation) => { success: boolean; error?: string };
  unplaceComponent: (componentId: string) => void;
  rotateComponent: (componentId: string, direction: 'cw' | 'ccw') => void;
  lockComponent: (componentId: string, locked: boolean) => void;
  
  runPlacement: () => Promise<void>;
  setPlacementConfig: (config: Partial<PlacementConfig>) => void;
  setPlacementMode: (mode: PlacementMode) => void;
  setOptimizationIntensity: (intensity: OptimizationIntensity) => void;
  
  runRouting: () => Promise<void>;
  updateRoute: (routeId: string, segments: Route['segments']) => void;
  lockRoute: (routeId: string, locked: boolean) => void;
  setRoutingConfig: (config: Partial<RoutingConfig>) => void;
  
  validate: () => void;
  
  generateGuide: () => void;
  updateAssemblyProgress: (stepId: string, completed: boolean) => void;
  setCurrentStep: (index: number) => void;
  
  selectComponent: (componentId: string | null, additive?: boolean) => void;
  selectComponents: (componentIds: string[], additive?: boolean) => void;
  selectNet: (netId: string | null) => void;
  highlightCoordinates: (coords: Coordinate[]) => void;
  clearHighlights: () => void;
  setActiveSide: (side: 'component' | 'solder' | 'both') => void;
  toggleShowRoutes: () => void;
  toggleShowHoles: () => void;
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  toggleTheme: () => void;
  setIsOptimizing: (value: boolean, status?: string) => void;

  // Schematic editor actions
  setWorkspaceView: (view: 'board' | 'schematic') => void;
  setSchematicZoom: (zoom: number) => void;
  /** Resize the schematic drawing area (grid units) */
  setSchematicCanvasSize: (size: { w: number; h: number }) => void;
  /** Hide/show both side panels for a bigger canvas */
  setFocusMode: (on: boolean) => void;
  moveSchematicComponent: (componentId: string, position: SchematicPosition) => void;
  /** Give schematic positions to components that don't have one yet */
  ensureSchematicPositions: () => void;
  /** Re-flow every component into the deterministic grid layout */
  autoArrangeSchematic: () => void;
  
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  
  loadProject: (data: Partial<AppState>) => void;
  resetProject: () => void;
  setProjectMetadata: (metadata: Partial<ProjectMetadata>) => void;
  markSaved: () => void;
  /** Autosave feedback: 'saving' while a write runs, 'saved' / 'error' afterwards */
  setSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error', error?: string | null) => void;
}

// ============ DEFAULT CONFIG ============

/** Default schematic sheet size in grid units (enlarge via the toolbar) */
const DEFAULT_SCHEMATIC_CANVAS = { w: 90, h: 60 };

// 30×20 holes @2.54mm with 1.27mm margins = a classic 50.8×76.2mm (5×7cm)
// protoboard, sized so the hole grid exactly fills the board.
const DEFAULT_DIMENSIONS: BoardDimensions = {
  rows: 30,
  cols: 20,
  holePitchMm: 2.54,
  widthMm: 50.8,
  heightMm: 76.2,
  marginTopMm: 1.27,
  marginBottomMm: 1.27,
  marginLeftMm: 1.27,
  marginRightMm: 1.27,
};

const DEFAULT_BOARD_CONFIG: BoardConfig = {
  id: 'default-board',
  name: 'Standard Perfboard',
  type: 'perfboard',
  dimensions: DEFAULT_DIMENSIONS,
  mountingHoles: makeCornerMountingHoles(DEFAULT_DIMENSIONS),
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============ STORE IMPLEMENTATION ============

export const useAppStore = create<AppState>((set, get) => {
  const initialBoardConfig = DEFAULT_BOARD_CONFIG;
  const initialBoard = createEmptyBoard(initialBoardConfig);
  const initialCircuit = createEmptyCircuit('New Circuit');
  
  return {
    // Initial state
    boardConfig: initialBoardConfig,
    board: initialBoard,
    circuit: initialCircuit,
    netIdCounter: 1,
    placedComponents: [],
    placementConfig: { ...DEFAULT_PLACEMENT_CONFIG },
    placementResult: null,
    routes: [],
    routingConfig: { ...DEFAULT_ROUTING_CONFIG },
    routingResult: null,
    lockedRouteIds: new Set(),
    validationResult: null,
    isValidating: false,
    assemblyGuide: null,
    assemblyProgress: null,
    selectedComponentIds: new Set(),
    selectedNetId: null,
    highlightedCoordinates: new Set(),
    activeSide: 'component',
    showRoutes: true,
    showHoles: true,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    theme: 'dark',
    isOptimizing: false,
    optimizationStatus: '',
    workspaceView: 'board',
    schematicPositions: new Map<string, SchematicPosition>(),
    schematicZoom: 1,
    schematicCanvasSize: DEFAULT_SCHEMATIC_CANVAS,
    focusMode: false,
    projectMetadata: {
      name: 'New Project',
      version: 1,
      appVersion: '0.1.0',
    },
    lastSaved: null,
    isDirty: false,
    saveStatus: 'idle',
    saveStatusAt: null,
    saveError: null,
    history: [],
    future: [],
    
    // ===== Board actions =====
    setBoardConfig: (config) => {
      const state = get();
      state.pushHistory();
      
      const oldConfig = state.boardConfig;
      const newConfig = { ...oldConfig, ...config, updatedAt: Date.now() };
      // The physical board is always exactly the hole grid plus margins, so
      // the soldermask can never be sized inconsistently with the holes.
      newConfig.dimensions = withDerivedSize(newConfig.dimensions);
      
      const oldDims = oldConfig.dimensions;
      const dims = newConfig.dimensions;
      const gridChanged =
        dims.rows !== oldDims.rows ||
        dims.cols !== oldDims.cols ||
        dims.holePitchMm !== oldDims.holePitchMm;
      const typeChanged =
        newConfig.type !== oldConfig.type ||
        newConfig.stripDirection !== oldConfig.stripDirection;
      
      // Mounting holes must track the board corners. Resizing the grid without
      // re-anchoring them leaves holes pointing at coordinates that no longer
      // exist (drills, pad flags and strip gaps all go out of sync).
      if (gridChanged) {
        if (newConfig.mountingHoles.length === 0 || isCornerMountingHoles(newConfig.mountingHoles, oldDims)) {
          newConfig.mountingHoles = makeCornerMountingHoles(dims);
        } else {
          newConfig.mountingHoles = newConfig.mountingHoles.filter(
            mh => mh.row >= 0 && mh.row < dims.rows && mh.col >= 0 && mh.col < dims.cols
          );
        }
      }
      
      const newBoard = createEmptyBoard(newConfig);
      
      // Preserve track cuts and pad assignments
      for (const [key, oldPad] of state.board.pads) {
        const newPad = newBoard.pads.get(key);
        if (newPad) {
          newPad.isTrackCut = oldPad.isTrackCut;
          newPad.netId = oldPad.netId;
        }
      }
      
      const holesChanged =
        JSON.stringify(newConfig.mountingHoles.map(mh => [mh.row, mh.col])) !==
        JSON.stringify(oldConfig.mountingHoles.map(mh => [mh.row, mh.col]));
      
      // Anything derived from the hole graph (placement, routing, validation,
      // assembly guide) is stale once the grid, board type or mounting holes
      // change - clear it instead of showing results that no longer apply.
      const layoutInvalidated = gridChanged || typeChanged || holesChanged;
      
      set({ 
        boardConfig: newConfig, 
        board: newBoard,
        ...(layoutInvalidated
          ? {
              placedComponents: [],
              routes: [],
              placementResult: null,
              routingResult: null,
              lockedRouteIds: new Set<string>(),
              validationResult: null,
              assemblyGuide: null,
              assemblyProgress: null,
              highlightedCoordinates: new Set<string>(),
            }
          : {}),
        isDirty: true,
      });
    },
    
    setBoardDimensions: (dims) => {
      const state = get();
      state.setBoardConfig({
        dimensions: { ...state.boardConfig.dimensions, ...dims },
      });
    },
    
    toggleTrackCut: (coord) => {
      const state = get();
      const key = coordToKey(coord);
      const pad = state.board.pads.get(key);
      if (!pad || pad.isMountingHole) return;
      
      state.pushHistory();
      
      const newPads = new Map(state.board.pads);
      newPads.set(key, { ...pad, isTrackCut: !pad.isTrackCut });
      
      set({
        board: { ...state.board, pads: newPads },
        isDirty: true,
      });
    },
    
    // ===== Circuit actions =====
    addComponentToCircuit: (footprintId, reference, value) => {
      const state = get();
      state.pushHistory();
      
      const id = crypto.randomUUID();
      const component = {
        id,
        footprintId,
        reference,
        value,
        pins: new Map<string, string>(),
      };
      
      set({
        circuit: {
          ...state.circuit,
          components: [...state.circuit.components, component],
          updatedAt: Date.now(),
        },
        isDirty: true,
      });
      
      return id;
    },
    
    removeComponentFromCircuit: (componentId) => {
      const state = get();
      state.pushHistory();
      
      set({
        circuit: {
          ...state.circuit,
          components: state.circuit.components.filter(c => c.id !== componentId),
          // Remove the component's pins from all nets, but keep the nets themselves
          nets: state.circuit.nets.map(net => ({
            ...net,
            pins: net.pins.filter(p => p.componentId !== componentId),
          })),
          updatedAt: Date.now(),
        },
        placedComponents: state.placedComponents.filter(c => c.id !== componentId),
        isDirty: true,
      });
    },
    
    updateComponentValue: (componentId, value) => {
      const state = get();
      set({
        circuit: {
          ...state.circuit,
          components: state.circuit.components.map(c => 
            c.id === componentId ? { ...c, value } : c
          ),
          updatedAt: Date.now(),
        },
        placedComponents: state.placedComponents.map(c =>
          c.id === componentId ? { ...c, value } : c
        ),
        isDirty: true,
      });
    },
    
    updateComponentReference: (componentId, reference) => {
      const state = get();
      set({
        circuit: {
          ...state.circuit,
          components: state.circuit.components.map(c => 
            c.id === componentId ? { ...c, reference } : c
          ),
          updatedAt: Date.now(),
        },
        placedComponents: state.placedComponents.map(c =>
          c.id === componentId ? { ...c, reference } : c
        ),
        isDirty: true,
      });
    },
    
    importCircuit: (circuit) => {
      const state = get();
      state.pushHistory();
      
      set({
        circuit,
        // Layout-derived state no longer matches the imported circuit
        placedComponents: [],
        placementResult: null,
        routes: [],
        routingResult: null,
        lockedRouteIds: new Set(),
        validationResult: null,
        assemblyGuide: null,
        assemblyProgress: null,
        selectedComponentIds: new Set(),
        selectedNetId: null,
        highlightedCoordinates: new Set(),
        // Keep schematic positions of components that still exist
        schematicPositions: new Map(
          Array.from(state.schematicPositions.entries()).filter(([id]) =>
            circuit.components.some(c => c.id === id)
          )
        ),
        isDirty: true,
      });
    },
    
    addNet: (name, options) => {
      const state = get();
      state.pushHistory();
      
      const id = crypto.randomUUID();
      const net: Net = {
        id,
        name,
        pins: [],
        color: options?.color,
        isPower: options?.isPower,
        isGround: options?.isGround,
      };
      
      set({
        circuit: {
          ...state.circuit,
          nets: [...state.circuit.nets, net],
          updatedAt: Date.now(),
        },
        netIdCounter: state.netIdCounter + 1,
        isDirty: true,
      });
      
      return id;
    },
    
    renameNet: (netId, name) => {
      const state = get();
      const trimmed = name.trim();
      if (!trimmed) return;
      const net = state.circuit.nets.find(n => n.id === netId);
      if (!net || net.name === trimmed) return;
      
      state.pushHistory();
      
      // Conventional names carry the power/ground flags with them
      const upper = trimmed.toUpperCase();
      const isGround = /^(GND|AGND|DGND|VSS|GROUND|0V)$/.test(upper);
      const isPower = isGround || /^(VCC|VDD|VIN|VBAT|3V3|5V0|\+?\d+V\d*)$/.test(upper);
      
      set({
        circuit: {
          ...state.circuit,
          nets: state.circuit.nets.map(n =>
            n.id === netId ? { ...n, name: trimmed, isGround, isPower } : n
          ),
          updatedAt: Date.now(),
        },
        isDirty: true,
      });
    },
    
    removeNet: (netId) => {
      const state = get();
      state.pushHistory();
      
      set({
        circuit: {
          ...state.circuit,
          nets: state.circuit.nets.filter(n => n.id !== netId),
          components: state.circuit.components.map(c => {
            const newPins = new Map(c.pins);
            for (const [pinId, nId] of newPins) {
              if (nId === netId) newPins.delete(pinId);
            }
            return { ...c, pins: newPins };
          }),
        },
        routes: state.routes.filter(r => r.netId !== netId),
        isDirty: true,
      });
    },
    
    connectPinToNet: (componentId, pinId, netId) => {
      const state = get();
      
      const component = state.circuit.components.find(c => c.id === componentId);
      const net = state.circuit.nets.find(n => n.id === netId);
      if (!component || !net) return;
      
      // Get footprint pin info
      const footprint = getFootprintById(component.footprintId);
      const pin = footprint?.pins.find(p => p.id === pinId);
      if (!pin) return;
      
      state.pushHistory();
      
      // Remove pin from any existing net first
      let updatedNets = state.circuit.nets.map(n => ({
        ...n,
        pins: n.pins.filter(p => !(p.componentId === componentId && p.pinId === pinId)),
      }));
      
      // Add to new net
      updatedNets = updatedNets.map(n => {
        if (n.id !== netId) return n;
        return {
          ...n,
          pins: [...n.pins, {
            componentId,
            pinId,
            pinName: pin.name,
            pinNumber: pin.number,
          }],
        };
      });
      const updatedComponents = state.circuit.components.map(c => {
        if (c.id !== componentId) return c;
        const newPins = new Map(c.pins);
        newPins.set(pinId, netId);
        return { ...c, pins: newPins };
      });
      
      // Update placed components
      const updatedPlaced = state.placedComponents.map(c => {
        if (c.id !== componentId) return c;
        const newNets = new Map(c.nets);
        newNets.set(pinId, netId);
        return { ...c, nets: newNets };
      });
      
      set({
        circuit: {
          ...state.circuit,
          components: updatedComponents,
          // Nets are never deleted implicitly — disconnecting leaves the net
          // (possibly empty) in place; use removeNet to delete it explicitly.
          nets: updatedNets,
          updatedAt: Date.now(),
        },
        placedComponents: updatedPlaced,
        isDirty: true,
      });
    },
    
    disconnectPinFromNet: (componentId, pinId) => {
      const state = get();
      state.pushHistory();
      
      const component = state.circuit.components.find(c => c.id === componentId);
      if (!component) return;
      
      const netId = component.pins.get(pinId);
      if (!netId) return;
      
      const updatedComponents = state.circuit.components.map(c => {
        if (c.id !== componentId) return c;
        const newPins = new Map(c.pins);
        newPins.delete(pinId);
        return { ...c, pins: newPins };
      });
      
      const updatedNets = state.circuit.nets.map(n => {
        if (n.id !== netId) return n;
        return {
          ...n,
          pins: n.pins.filter(p => !(p.componentId === componentId && p.pinId === pinId)),
        };
      });
      
      const updatedPlaced = state.placedComponents.map(c => {
        if (c.id !== componentId) return c;
        const newNets = new Map(c.nets);
        newNets.delete(pinId);
        return { ...c, nets: newNets };
      });
      
      set({
        circuit: {
          ...state.circuit,
          components: updatedComponents,
          nets: updatedNets,
          updatedAt: Date.now(),
        },
        placedComponents: updatedPlaced,
        isDirty: true,
      });
    },

    connectPins: (a, b) => {
      const state = get();
      if (a.componentId === b.componentId && a.pinId === b.pinId) return;

      const compA = state.circuit.components.find(c => c.id === a.componentId);
      const compB = state.circuit.components.find(c => c.id === b.componentId);
      if (!compA || !compB) return;

      const netA = compA.pins.get(a.pinId);
      const netB = compB.pins.get(b.pinId);
      if (netA && netA === netB) return; // already connected

      const pinDefA = getFootprintById(compA.footprintId)?.pins.find(p => p.id === a.pinId);
      const pinDefB = getFootprintById(compB.footprintId)?.pins.find(p => p.id === b.pinId);
      if (!pinDefA || !pinDefB) return;

      state.pushHistory();

      // componentId -> new pins map (only entries that changed)
      const pinsChanges = new Map<string, Map<string, string>>();
      const changePins = (componentId: string, mutate: (pins: Map<string, string>) => void) => {
        let pins = pinsChanges.get(componentId);
        if (!pins) {
          const comp = state.circuit.components.find(c => c.id === componentId);
          pins = new Map(comp?.pins ?? []);
          pinsChanges.set(componentId, pins);
        }
        mutate(pins);
      };

      let nets = [...state.circuit.nets];
      let routes = state.routes;
      let netIdCounter = state.netIdCounter;

      const pinEntry = (componentId: string, pin: { id: string; name: string; number: string }) => ({
        componentId,
        pinId: pin.id,
        pinName: pin.name,
        pinNumber: pin.number,
      });

      if (netA && netB) {
        // ---- Merge the two nets (they are now wired together) ----
        const netAObj = nets.find(n => n.id === netA);
        const netBObj = nets.find(n => n.id === netB);
        if (!netAObj || !netBObj) return;

        // Keep the more meaningful name: a hand-named net wins over an auto
        // N# name; between two hand-named nets the larger one survives.
        const swap =
          (isAutoNetName(netAObj.name) && !isAutoNetName(netBObj.name)) ||
          (isAutoNetName(netAObj.name) === isAutoNetName(netBObj.name) &&
            netBObj.pins.length > netAObj.pins.length);
        const survivorId = swap ? netB : netA;
        const victimId = swap ? netA : netB;

        // Re-point every pin that referenced the victim net
        for (const comp of state.circuit.components) {
          for (const [, netId] of comp.pins) {
            if (netId === victimId) {
              changePins(comp.id, pins => {
                for (const [pinId, nId] of pins) {
                  if (nId === victimId) pins.set(pinId, survivorId);
                }
              });
              break;
            }
          }
        }

        const survivor = nets.find(n => n.id === survivorId)!;
        const victim = nets.find(n => n.id === victimId)!;
        const mergedPins = [
          ...survivor.pins,
          ...victim.pins.filter(vp =>
            !survivor.pins.some(sp => sp.componentId === vp.componentId && sp.pinId === vp.pinId)
          ),
        ];
        nets = nets
          .filter(n => n.id !== victimId)
          .map(n => (n.id === survivorId ? { ...n, pins: mergedPins } : n));

        // Routes of the dropped net no longer map to any net
        routes = state.routes.filter(r => r.netId !== victimId);
      } else if (netA || netB) {
        // ---- Join the unconnected pin to the existing net ----
        const targetId = (netA || netB)!;
        const other = netA
          ? { comp: compB, pin: pinDefB }
          : { comp: compA, pin: pinDefA };

        changePins(other.comp.id, pins => pins.set(other.pin.id, targetId));
        nets = nets.map(n => {
          if (n.id !== targetId) return n;
          if (n.pins.some(p => p.componentId === other.comp.id && p.pinId === other.pin.id)) return n;
          return { ...n, pins: [...n.pins, pinEntry(other.comp.id, other.pin)] };
        });
      } else {
        // ---- Fresh connection: create a new net ----
        const suggested = suggestNetName([pinDefA, pinDefB]);
        let name: string;
        if (suggested && !nets.some(n => n.name === suggested)) {
          name = suggested;
        } else {
          const auto = nextAutoNetName(nets.map(n => n.name), netIdCounter);
          name = auto.name;
          netIdCounter = auto.counter;
        }
        const id = crypto.randomUUID();
        const net: Net = {
          id,
          name,
          pins: [pinEntry(compA.id, pinDefA), pinEntry(compB.id, pinDefB)],
          isPower: name === 'VCC' || name === 'VIN' || name === '3V3',
          isGround: name === 'GND',
        };
        nets = [...nets, net];
        changePins(compA.id, pins => pins.set(pinDefA.id, id));
        changePins(compB.id, pins => pins.set(pinDefB.id, id));
      }

      set({
        circuit: {
          ...state.circuit,
          components: state.circuit.components.map(c =>
            pinsChanges.has(c.id) ? { ...c, pins: pinsChanges.get(c.id)! } : c
          ),
          nets,
          updatedAt: Date.now(),
        },
        placedComponents: state.placedComponents.map(c =>
          pinsChanges.has(c.id) ? { ...c, nets: new Map(pinsChanges.get(c.id)!) } : c
        ),
        netIdCounter,
        routes,
        validationResult: null,
        isDirty: true,
      });
    },

    // ===== Placement actions =====
    placeComponent: (componentId, position, orientation) => {
      const state = get();
      
      const circuitComponent = state.circuit.components.find(c => c.id === componentId);
      if (!circuitComponent) return { success: false, error: 'Component not found in circuit' };
      
      const footprint = getFootprintById(circuitComponent.footprintId);
      if (!footprint) return { success: false, error: 'Footprint not found' };
      
      const pinPositions = getRotatedPinPositions(footprint, position, orientation);
      const boundingBox = getComponentBoundingBox(position, orientation, footprint);
      
      // Validate placement
      const { rows, cols } = state.boardConfig.dimensions;
      if (boundingBox.minRow < 0 || boundingBox.maxRow >= rows ||
          boundingBox.minCol < 0 || boundingBox.maxCol >= cols) {
        return { success: false, error: 'Component extends beyond board boundaries' };
      }
      
      // Check pin conflicts
      const conflicts: string[] = [];
      for (const coord of pinPositions.values()) {
        const pad = state.board.pads.get(coordToKey(coord));
        if (!pad) {
          conflicts.push(`Hole ${coordToLabel(coord)} does not exist`);
          continue;
        }
        if (pad.isMountingHole) {
          conflicts.push(`Hole ${coordToLabel(coord)} is a mounting hole`);
        }
        
        // Check against other components
        for (const other of state.placedComponents) {
          if (other.id === componentId) continue;
          for (const otherCoord of other.pinPositions.values()) {
            if (coord.row === otherCoord.row && coord.col === otherCoord.col) {
              conflicts.push(`Hole ${coordToLabel(coord)} is used by ${other.reference}`);
            }
          }
        }
      }
      
      if (conflicts.length > 0) {
        return { success: false, error: conflicts[0] };
      }
      
      state.pushHistory();
      
      const placedComponent: PlacedComponent = {
        id: componentId,
        footprintId: circuitComponent.footprintId,
        reference: circuitComponent.reference,
        value: circuitComponent.value,
        position,
        orientation,
        locked: false,
        nets: new Map(circuitComponent.pins),
        footprint,
        pinPositions,
        boundingBox,
      };
      
      // Remove existing placement of this component if any
      const newPlaced = state.placedComponents.filter(c => c.id !== componentId);
      newPlaced.push(placedComponent);
      
      set({
        placedComponents: newPlaced,
        isDirty: true,
      });
      
      return { success: true };
    },
    
    unplaceComponent: (componentId) => {
      const state = get();
      state.pushHistory();
      
      set({
        placedComponents: state.placedComponents.filter(c => c.id !== componentId),
        isDirty: true,
      });
    },
    
    rotateComponent: (componentId, direction) => {
      const state = get();
      const comp = state.placedComponents.find(c => c.id === componentId);
      if (!comp) return;
      
      const orientations = comp.footprint.supportedOrientations;
      const currentIdx = orientations.indexOf(comp.orientation);
      let newIdx: number;
      
      if (direction === 'cw') {
        newIdx = (currentIdx + 1) % orientations.length;
      } else {
        newIdx = (currentIdx - 1 + orientations.length) % orientations.length;
      }
      
      const newOrientation = orientations[newIdx];
      
      // Try rotating in place
      const result = state.placeComponent(componentId, comp.position, newOrientation);
      
      if (!result.success) {
        // Try to find nearby valid position
        const offsets = [
          { dr: 0, dc: 1 }, { dr: 0, dc: -1 },
          { dr: 1, dc: 0 }, { dr: -1, dc: 0 },
          { dr: 1, dc: 1 }, { dr: -1, dc: -1 },
        ];
        
        for (const offset of offsets) {
          const newPos = {
            row: comp.position.row + offset.dr,
            col: comp.position.col + offset.dc,
          };
          const retryResult = state.placeComponent(componentId, newPos, newOrientation);
          if (retryResult.success) {
            // Preserve lock state
            if (comp.locked) {
              set(state2 => ({
                placedComponents: state2.placedComponents.map(c =>
                  c.id === componentId ? { ...c, locked: true } : c
                ),
              }));
            }
            return;
          }
        }
      } else {
        // Preserve lock state
        if (comp.locked) {
          set(s => ({
            placedComponents: s.placedComponents.map(c =>
              c.id === componentId ? { ...c, locked: true } : c
            ),
          }));
        }
      }
    },
    
    lockComponent: (componentId, locked) => {
      set(state => ({
        placedComponents: state.placedComponents.map(c =>
          c.id === componentId ? { ...c, locked } : c
        ),
        isDirty: true,
      }));
    },
    
    runPlacement: async () => {
      const state = get();
      set({ isOptimizing: true, optimizationStatus: 'Preparing placement...' });
      
      // Yield to let UI update
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const { placeComponents } = await import('../placement/engine');
        
        // Build component specs (decoupled from circuit-editor concerns)
        const componentFootprints = state.circuit.components
          .map(c => {
            const footprint = getFootprintById(c.footprintId);
            if (!footprint) return null;
            return {
              component: {
                id: c.id,
                footprintId: c.footprintId,
                reference: c.reference,
                value: c.value,
                nets: new Map(c.pins),
              },
              footprint,
            };
          })
          .filter((cf): cf is NonNullable<typeof cf> => cf !== null);
        
        if (componentFootprints.length === 0) {
          set({ 
            isOptimizing: false, 
            optimizationStatus: 'No components to place',
            placementResult: null,
          });
          return;
        }
        
        set({ optimizationStatus: `Placing ${componentFootprints.length} components...` });
        await new Promise(resolve => setTimeout(resolve, 30));
        
        const result = placeComponents(
          state.board,
          state.circuit,
          componentFootprints,
          state.circuit.nets,
          state.placedComponents,
          state.placementConfig
        );
        
        state.pushHistory();
        
        set({
          placedComponents: result.placedComponents,
          placementResult: result,
          isOptimizing: false,
          optimizationStatus: result.success 
            ? `Placement complete: ${result.placedComponents.length} components placed (${result.iterations} iterations, ${result.timeMs}ms)`
            : `Placement incomplete: ${result.errors.length} error(s)`,
          routes: [], // Routes invalidated by placement change
          validationResult: null,
          isDirty: true,
        });
      } catch (error) {
        set({
          isOptimizing: false,
          optimizationStatus: `Placement failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    },
    
    setPlacementConfig: (config) => {
      set(state => ({
        placementConfig: { ...state.placementConfig, ...config },
      }));
    },
    
    setPlacementMode: (mode) => {
      set(state => ({
        placementConfig: { ...state.placementConfig, mode },
      }));
    },
    
    setOptimizationIntensity: (intensity) => {
      set(state => ({
        placementConfig: { ...state.placementConfig, intensity },
      }));
    },
    
    // ===== Routing actions =====
    runRouting: async () => {
      const state = get();
      
      if (state.placedComponents.length === 0) {
        set({ optimizationStatus: 'Place components before routing' });
        return;
      }
      
      set({ isOptimizing: true, optimizationStatus: 'Building routing graph...' });
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const { createRoutingContext, routeAllNets } = await import('../routing/engine');
        
        const context = createRoutingContext(
          state.board,
          state.placedComponents,
          state.circuit.nets,
          state.routes,
          state.lockedRouteIds,
          state.routingConfig
        );
        
        set({ optimizationStatus: 'Routing nets with A* search...' });
        await new Promise(resolve => setTimeout(resolve, 30));
        
        const result = routeAllNets(context);
        
        state.pushHistory();
        
        set({
          routes: result.routes,
          routingResult: result,
          isOptimizing: false,
          optimizationStatus: result.unroutedNets.length > 0
            ? `Routing incomplete: ${result.unroutedNets.length} net(s) could not be routed`
            : `Routing complete: ${result.stats.totalRoutes} routes, ${result.stats.totalWireLength}mm total wire`,
          isDirty: true,
        });
      } catch (error) {
        set({
          isOptimizing: false,
          optimizationStatus: `Routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    },
    
    updateRoute: (routeId, segments) => {
      const state = get();
      state.pushHistory();
      
      set({
        routes: state.routes.map(r => {
          if (r.id !== routeId) return r;
          
          let length = 0;
          for (const seg of segments) {
            length += Math.abs(seg.from.row - seg.to.row) + Math.abs(seg.from.col - seg.to.col);
          }
          
          return { ...r, segments, length, manual: true };
        }),
        isDirty: true,
      });
    },
    
    lockRoute: (routeId, locked) => {
      set(state => {
        const newLocked = new Set(state.lockedRouteIds);
        if (locked) {
          newLocked.add(routeId);
        } else {
          newLocked.delete(routeId);
        }
        
        return {
          lockedRouteIds: newLocked,
          routes: state.routes.map(r => 
            r.id === routeId ? { ...r, locked } : r
          ),
          isDirty: true,
        };
      });
    },
    
    setRoutingConfig: (config) => {
      set(state => ({
        routingConfig: { ...state.routingConfig, ...config },
      }));
    },
    
    // ===== Validation =====
    validate: () => {
      const state = get();
      set({ isValidating: true });
      
      try {
        const result = validateBoard(
          state.board,
          state.placedComponents,
          state.circuit.nets,
          state.routes
        );
        
        set({
          validationResult: result,
          isValidating: false,
        });
      } catch (error) {
        console.error('Validation failed:', error);
        set({ isValidating: false });
      }
    },
    
    // ===== Assembly =====
    generateGuide: () => {
      const state = get();
      
      if (state.placedComponents.length === 0) return;
      
      const guide = generateAssemblyGuide(
        state.placedComponents,
        state.circuit.nets,
        state.routes,
        state.boardConfig.name,
        state.circuit.name
      );
      
      set({
        assemblyGuide: guide,
        assemblyProgress: createAssemblyProgress(guide),
      });
    },
    
    updateAssemblyProgress: (stepId, completed) => {
      set(state => {
        if (!state.assemblyProgress) return state;
        
        const newCompleted = new Set(state.assemblyProgress.completedStepIds);
        if (completed) {
          newCompleted.add(stepId);
        } else {
          newCompleted.delete(stepId);
        }
        
        return {
          assemblyProgress: {
            ...state.assemblyProgress,
            completedStepIds: newCompleted,
          },
          isDirty: true,
        };
      });
    },
    
    setCurrentStep: (index) => {
      set(state => {
        if (!state.assemblyProgress) return state;
        return {
          assemblyProgress: {
            ...state.assemblyProgress,
            currentStepIndex: index,
          },
        };
      });
    },
    
    // ===== UI state =====
    selectComponent: (componentId, additive = false) => {
      set(state => {
        const newSelected = additive ? new Set(state.selectedComponentIds) : new Set<string>();
        
        if (componentId) {
          if (additive && newSelected.has(componentId)) {
            newSelected.delete(componentId);
          } else if (componentId) {
            newSelected.add(componentId);
          }
        }
        
        // Highlight connected pads
        const highlights = new Set<string>();
        if (componentId) {
          const comp = state.placedComponents.find(c => c.id === componentId);
          if (comp) {
            for (const coord of comp.pinPositions.values()) {
              highlights.add(coordToKey(coord));
            }
          }
        }
        
        return {
          selectedComponentIds: newSelected,
          highlightedCoordinates: highlights,
        };
      });
    },
    
    selectComponents: (componentIds, additive = false) => {
      set(state => {
        const newSelected = additive ? new Set(state.selectedComponentIds) : new Set<string>();
        for (const id of componentIds) {
          if (additive && newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
        }
        
        // Highlight the pads of everything selected
        const highlights = new Set<string>();
        for (const id of newSelected) {
          const comp = state.placedComponents.find(c => c.id === id);
          if (comp) {
            for (const coord of comp.pinPositions.values()) {
              highlights.add(coordToKey(coord));
            }
          }
        }
        
        return {
          selectedComponentIds: newSelected,
          highlightedCoordinates: highlights,
        };
      });
    },
    
    selectNet: (netId) => {
      set(state => {
        const highlights = new Set<string>();
        
        if (netId) {
          const net = state.circuit.nets.find(n => n.id === netId);
          if (net) {
            for (const pin of net.pins) {
              const comp = state.placedComponents.find(c => c.id === pin.componentId);
              if (comp) {
                const coord = comp.pinPositions.get(pin.pinId);
                if (coord) highlights.add(coordToKey(coord));
              }
            }
          }
          
          // Also highlight route segments
          const route = state.routes.find(r => r.netId === netId);
          if (route) {
            for (const segment of route.segments) {
              highlights.add(coordToKey(segment.from));
              highlights.add(coordToKey(segment.to));
            }
          }
        }
        
        return {
          selectedNetId: netId,
          highlightedCoordinates: highlights,
        };
      });
    },
    
    highlightCoordinates: (coords) => {
      set({
        highlightedCoordinates: new Set(coords.map(coordToKey)),
      });
    },
    
    clearHighlights: () => {
      set({
        highlightedCoordinates: new Set(),
        selectedComponentIds: new Set(),
        selectedNetId: null,
      });
    },
    
    setActiveSide: (side) => set({ activeSide: side }),
    toggleShowRoutes: () => set(state => ({ showRoutes: !state.showRoutes })),
    toggleShowHoles: () => set(state => ({ showHoles: !state.showHoles })),
    setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),
    setPanOffset: (panOffset) => set({ panOffset }),
    toggleTheme: () => set(state => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
    setIsOptimizing: (value, status) => set({ 
      isOptimizing: value, 
      optimizationStatus: status ?? '' 
    }),

    // ===== Schematic editor =====
    setWorkspaceView: (view) => set({ workspaceView: view }),
    setSchematicZoom: (zoom) => set({ schematicZoom: Math.max(0.3, Math.min(2.5, zoom)) }),
    setSchematicCanvasSize: (size) => set({
      schematicCanvasSize: {
        w: Math.max(40, Math.min(400, Math.round(size.w))),
        h: Math.max(25, Math.min(300, Math.round(size.h))),
      },
    }),
    setFocusMode: (on) => set({ focusMode: on }),
    moveSchematicComponent: (componentId, position) => {
      set(state => {
        const next = new Map(state.schematicPositions);
        next.set(componentId, position);
        return { schematicPositions: next, isDirty: true };
      });
    },
    ensureSchematicPositions: () => {
      const state = get();
      const components = state.circuit.components.map(c => ({
        id: c.id,
        footprint: getFootprintById(c.footprintId),
      }));
      if (components.length === 0) return;
      if (components.every(c => state.schematicPositions.has(c.id))) return;
      const next = computeSchematicLayout(components, state.schematicPositions, true);
      set({ schematicPositions: next });
    },
    autoArrangeSchematic: () => {
      const state = get();
      const components = state.circuit.components.map(c => ({
        id: c.id,
        footprint: getFootprintById(c.footprintId),
      }));
      const next = computeSchematicLayout(components, new Map(), false);
      set({ schematicPositions: next, isDirty: true });
    },
    
    // ===== History =====
    // Two-stack undo/redo:
    //  - pushHistory() is called by every mutating action BEFORE the change.
    //    It snapshots the current state, pushes it on the undo stack and
    //    clears the redo stack (a new change invalidates the redo future).
    //  - undo() moves the live state onto the redo stack and restores the
    //    newest undo snapshot; redo() is the exact mirror image.
    pushHistory: () => {
      const state = get();
      const snapshot = makeSnapshot(state);
      const newHistory = [...state.history, snapshot];
      
      set({
        history: newHistory.length > MAX_HISTORY
          ? newHistory.slice(newHistory.length - MAX_HISTORY)
          : newHistory,
        future: [],
      });
    },
    
    undo: () => {
      const state = get();
      const previous = state.history[state.history.length - 1];
      if (!previous) return;
      
      const current = makeSnapshot(state);
      
      set({
        ...applySnapshot(previous),
        history: state.history.slice(0, -1),
        future: [...state.future, current].slice(-MAX_HISTORY),
        validationResult: null,
        isDirty: true,
      });
    },
    
    redo: () => {
      const state = get();
      const next = state.future[state.future.length - 1];
      if (!next) return;
      
      const current = makeSnapshot(state);
      
      set({
        ...applySnapshot(next),
        future: state.future.slice(0, -1),
        history: [...state.history, current].slice(-MAX_HISTORY),
        validationResult: null,
        isDirty: true,
      });
    },
    
    // ===== Project =====
    loadProject: (data) => {
      set(state => {
        const rawConfig = data.boardConfig || state.boardConfig;
        const newBoardConfig = { ...rawConfig, dimensions: withDerivedSize(rawConfig.dimensions) };
        const newBoard = createEmptyBoard(newBoardConfig);
        
        // Restore pad states if board data provided
        if (data.board) {
          for (const [key, pad] of data.board.pads) {
            const newPad = newBoard.pads.get(key);
            if (newPad) {
              newPad.isTrackCut = pad.isTrackCut;
              newPad.netId = pad.netId;
            }
          }
        }
        
        return {
          ...state,
          boardConfig: newBoardConfig,
          board: newBoard,
          circuit: data.circuit || state.circuit,
          placedComponents: data.placedComponents || [],
          routes: data.routes || [],
          netIdCounter: data.netIdCounter || 1,
          projectMetadata: data.projectMetadata || state.projectMetadata,
          schematicPositions: data.schematicPositions || new Map<string, SchematicPosition>(),
          schematicCanvasSize: data.schematicCanvasSize || state.schematicCanvasSize,
          // Derived results only come back when the caller passes them (the
          // autosave record does) - otherwise they must be regenerated.
          validationResult: data.validationResult ?? null,
          assemblyGuide: data.assemblyGuide ?? null,
          assemblyProgress: data.assemblyProgress ?? null,
          isDirty: false,
          history: [],
          future: [],
        };
      });
    },
    
    resetProject: () => {
      const boardConfig = DEFAULT_BOARD_CONFIG;
      const board = createEmptyBoard(boardConfig);
      const circuit = createEmptyCircuit('New Circuit');
      
      set({
        boardConfig,
        board,
        circuit,
        netIdCounter: 1,
        placedComponents: [],
        placementResult: null,
        routes: [],
        routingResult: null,
        lockedRouteIds: new Set(),
        validationResult: null,
        assemblyGuide: null,
        assemblyProgress: null,
        selectedComponentIds: new Set(),
        selectedNetId: null,
        highlightedCoordinates: new Set(),
        schematicPositions: new Map<string, SchematicPosition>(),
        schematicCanvasSize: DEFAULT_SCHEMATIC_CANVAS,
        focusMode: false,
        projectMetadata: {
          name: 'New Project',
          version: 1,
          appVersion: '0.1.0',
        },
        lastSaved: null,
        isDirty: false,
        history: [],
        future: [],
      });
    },
    
    setProjectMetadata: (metadata) => {
      set(state => ({
        projectMetadata: { ...state.projectMetadata, ...metadata },
        isDirty: true,
      }));
    },
    
    markSaved: () => {
      set({ lastSaved: Date.now(), isDirty: false });
    },
    
    setSaveStatus: (status, error = null) => {
      set({
        saveStatus: status,
        saveStatusAt: Date.now(),
        saveError: status === 'error' ? error : null,
      });
    },
  };
});

// Import footprint retrieval (uses the single registry in footprints/types)
import { getFootprintById } from '../footprints/types';