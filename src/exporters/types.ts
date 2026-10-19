/**
 * Export types and interfaces
 */

import { BoardState, Coordinate, Pad, coordToKey, coordToLabel } from '../board/types';
import { PlacedComponent, registerFootprint } from '../footprints/types';
import { Circuit, Net } from '../circuit/types';
import { Route, RoutingConfig, DEFAULT_ROUTING_CONFIG } from '../routing/types';
import { extractJumperRuns } from '../routing/metrics';
import { AssemblyGuide, AssemblyGroupBy, AssemblyProgress, AssemblyStep } from '../soldering/types';
import { ValidationResult } from '../validation/types';

export interface ExportOptions {
  includeComponentSide: boolean;
  includeSolderSide: boolean;
  includeAssemblyGuide: boolean;
  includeBOM: boolean;
  includeNetlist: boolean;
  includeValidationReport: boolean;
  scale: number;
  pageSize: 'A4' | 'Letter' | 'Custom';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number }; // mm
  showGrid: boolean;
  showCoordinates: boolean;
  showNetNames: boolean;
  showComponentValues: boolean;
  colorScheme: 'color' | 'monochrome';
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeComponentSide: true,
  includeSolderSide: true,
  includeAssemblyGuide: true,
  includeBOM: true,
  includeNetlist: true,
  includeValidationReport: false,
  scale: 1.0,
  pageSize: 'A4',
  orientation: 'landscape',
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  showGrid: true,
  showCoordinates: true,
  showNetNames: true,
  showComponentValues: true,
  colorScheme: 'color',
};

export interface ExportResult {
  success: boolean;
  data?: string | Blob;
  filename: string;
  mimeType: string;
  error?: string;
}

export interface BoardSVGOptions extends ExportOptions {
  side: 'component' | 'solder' | 'both';
  layers: SVGLayer[];
}

export type SVGLayer = 
  | 'grid'
  | 'holes'
  | 'components'
  | 'routes'
  | 'labels'
  | 'dimensions'
  | 'mounting-holes'
  | 'track-cuts'
  | 'bridges';

export interface PDFExportOptions extends ExportOptions {
  title: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  includeTableOfContents: boolean;
  includePageNumbers: boolean;
}

export interface BOMItem {
  reference: string;
  value: string;
  footprint: string;
  quantity: number;
  description?: string;
  manufacturer?: string;
  partNumber?: string;
  notes?: string;
}

export interface NetlistEntry {
  netName: string;
  pins: NetlistPin[];
}

export interface NetlistPin {
  reference: string;
  pinNumber: string;
  pinName: string;
}

export interface CoordinateListEntry {
  coordinate: string;
  type: 'component-pin' | 'jumper' | 'bridge' | 'track-cut' | 'mounting-hole';
  component?: string;
  pin?: string;
  net?: string;
  notes?: string;
}

export interface JumperWireListEntry {
  id: string;
  from: string;
  to: string;
  lengthMm: number;
  side: 'solder' | 'component';
  netName: string;
  gauge?: string;
  color?: string;
}

export interface TrackCutListEntry {
  coordinate: string;
  netName?: string;
  reason: string;
}

export interface ProjectFile {
  version: string;
  createdAt: number;
  updatedAt: number;
  board: BoardState;
  circuit: Circuit;
  components: PlacedComponent[];
  routes: Route[];
  nets: Net[];
  /** Schematic editor symbol positions (componentId -> grid units) */
  schematicPositions?: Map<string, { x: number; y: number }>;
  /** Schematic drawing area in grid units */
  schematicCanvasSize?: { w: number; h: number };
  validation?: ValidationResult;
  assemblyGuide?: AssemblyGuide;
  /** Soldering checklist progress (completed step ids + current step) */
  assemblyProgress?: AssemblyProgress;
  /** User's routing preference; omitted by older project files. */
  routingPreference?: RoutingConfig['preference'];
  /** Counter behind generated net ids - keeps new nets unique after a load */
  netIdCounter?: number;
  metadata: ProjectMetadata;
}

export const CURRENT_PROJECT_FORMAT = '1.1';

export interface ProjectMetadata {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  version: number;
  appVersion: string;
}

export function createProjectFile(
  board: BoardState,
  circuit: Circuit,
  components: PlacedComponent[],
  routes: Route[],
  nets: Net[],
  options: Partial<ProjectMetadata> = {}
): ProjectFile {
  return {
    version: CURRENT_PROJECT_FORMAT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    board,
    circuit,
    components,
    routes,
    nets,
    metadata: {
      name: options.name || circuit.name,
      description: options.description,
      author: options.author,
      tags: options.tags,
      version: 1,
      appVersion: '0.1.0',
    },
  };
}

export function generateBOM(components: PlacedComponent[]): BOMItem[] {
  const bomMap = new Map<string, BOMItem>();
  
  for (const comp of components) {
    const key = `${comp.footprintId}-${comp.value || ''}`;
    const existing = bomMap.get(key);
    
    if (existing) {
      existing.quantity++;
    } else {
      bomMap.set(key, {
        reference: comp.reference,
        value: comp.value || '',
        footprint: comp.footprintId,
        quantity: 1,
        description: comp.footprint.name,
      });
    }
  }
  
  return Array.from(bomMap.values()).sort((a, b) => a.reference.localeCompare(b.reference));
}

export function generateNetlist(nets: Net[], components: PlacedComponent[]): NetlistEntry[] {
  return nets.map(net => ({
    netName: net.name,
    pins: net.pins.map(pin => {
      const comp = components.find(c => c.id === pin.componentId);
      return {
        reference: comp?.reference || pin.componentId,
        pinNumber: pin.pinNumber,
        pinName: pin.pinName,
      };
    }),
  }));
}

export function generateCoordinateList(
  components: PlacedComponent[],
  routes: Route[],
  board: BoardState
): CoordinateListEntry[] {
  const entries: CoordinateListEntry[] = [];
  
  // Component pins
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const pin = comp.footprint.pins.find(p => p.id === pinId);
      const netId = comp.nets.get(pinId);
      entries.push({
        coordinate: coordToLabel(coord),
        type: 'component-pin',
        component: comp.reference,
        pin: pin?.number || pinId,
        net: netId,
      });
    }
  }
  
  // Jumpers
  for (const route of routes) {
    for (const segment of route.segments) {
      entries.push({
        coordinate: coordToLabel(segment.from),
        type: 'jumper',
        net: route.netId,
        notes: `To ${coordToLabel(segment.to)}`,
      });
      entries.push({
        coordinate: coordToLabel(segment.to),
        type: 'jumper',
        net: route.netId,
        notes: `From ${coordToLabel(segment.from)}`,
      });
    }
  }
  
  // Track cuts
  for (const [key, pad] of board.pads) {
    if (pad.isTrackCut) {
      const coord = keyToCoord(key);
      entries.push({
        coordinate: coordToLabel(coord),
        type: 'track-cut',
        notes: 'Track cut',
      });
    }
  }
  
  // Mounting holes
  for (const [key, pad] of board.pads) {
    if (pad.isMountingHole) {
      const coord = keyToCoord(key);
      entries.push({
        coordinate: coordToLabel(coord),
        type: 'mounting-hole',
      });
    }
  }
  
  return entries.sort((a, b) => a.coordinate.localeCompare(b.coordinate));
}

export function generateJumperWireList(
  routes: Route[],
  nets: Net[],
  holePitchMm: number = 2.54
): JumperWireListEntry[] {
  const entries: JumperWireListEntry[] = [];
  
  for (const route of routes) {
    const net = nets.find(n => n.id === route.netId);
    const jumpers = extractJumperRuns(route).map(run => ({
      ...run,
      length: Math.round(run.lengthHoles * holePitchMm),
    }));
    
    for (const jumper of jumpers) {
      entries.push({
        id: jumper.id,
        from: coordToLabel(jumper.from),
        to: coordToLabel(jumper.to),
        lengthMm: jumper.length,
        side: jumper.layer === 'solder' ? 'solder' : 'component',
        netName: net?.name || route.netId,
      });
    }
  }
  
  return entries;
}

export function generateTrackCutList(board: BoardState): TrackCutListEntry[] {
  const entries: TrackCutListEntry[] = [];
  
  for (const [key, pad] of board.pads) {
    if (pad.isTrackCut) {
      const coord = keyToCoord(key);
      entries.push({
        coordinate: coordToLabel(coord),
        reason: 'Track cut for circuit isolation',
      });
    }
  }
  
  return entries;
}

function keyToCoord(key: string): Coordinate {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

// ============ PROJECT SERIALIZATION ============
//
// ProjectFile holds runtime data structures (Maps for board pads, component
// pins/nets and assembly groups). JSON.stringify would silently flatten those
// Maps to `{}`, so JSON export/import goes through the explicit converters
// below, which flatten Maps to plain objects and rebuild them on import.

function mapToRecord<V>(map: Map<string, V> | undefined): Record<string, V> {
  const record: Record<string, V> = {};
  if (!map) return record;
  for (const [key, value] of map) record[key] = value;
  return record;
}

function recordToMap<V>(record: Record<string, V> | undefined): Map<string, V> {
  return new Map<string, V>(Object.entries(record || {}));
}

/** Convert a ProjectFile into plain JSON-safe data (Maps -> objects) */
export function serializeProjectFile(project: ProjectFile): Record<string, unknown> {
  return {
    version: project.version,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    metadata: project.metadata,
    board: {
      config: project.board.config,
      pads: mapToRecord(project.board.pads),
      holeCoordinates: project.board.holeCoordinates,
    },
    circuit: {
      ...project.circuit,
      components: (project.circuit.components || []).map(c => ({
        ...c,
        pins: mapToRecord(c.pins),
      })),
    },
    components: (project.components || []).map(c => ({
      ...c,
      nets: mapToRecord(c.nets),
      pinPositions: mapToRecord(c.pinPositions),
    })),
    routes: project.routes,
    nets: project.nets,
    schematicPositions: mapToRecord(project.schematicPositions),
    schematicCanvasSize: project.schematicCanvasSize,
    validation: project.validation,
    assemblyGuide: project.assemblyGuide
      ? {
          ...project.assemblyGuide,
          groupedSteps: mapToRecord(project.assemblyGuide.groupedSteps),
        }
      : undefined,
    assemblyProgress: project.assemblyProgress
      ? {
          ...project.assemblyProgress,
          // Sets are not JSON; store the checklist as a plain list
          completedStepIds: Array.from(project.assemblyProgress.completedStepIds),
        }
      : undefined,
    netIdCounter: project.netIdCounter,
  };
}

/** Serialize a project to JSON text */
export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(serializeProjectFile(project), null, 2);
}

/** Parse project JSON text back into a live ProjectFile (rebuilds all Maps) */
export function deserializeProject(json: string): ProjectFile | null {
  try {
    const data = JSON.parse(json) as Record<string, any>;
    if (!data || !data.board || !data.circuit) return null;
    
    // Board pads: `{ 'row,col': Pad }` (or an array in very early files)
    let pads: Map<string, Pad>;
    if (Array.isArray(data.board.pads)) {
      pads = new Map<string, Pad>(data.board.pads.map((p: Pad) => [coordToKey(p.coordinate), p]));
    } else {
      pads = recordToMap<Pad>(data.board.pads);
    }
    
    const board: BoardState = {
      config: data.board.config,
      pads,
      holeCoordinates: data.board.holeCoordinates || [],
    };
    
    const circuit: Circuit = {
      ...data.circuit,
      components: (data.circuit.components || []).map((c: any) => ({
        ...c,
        pins: recordToMap<string>(c.pins),
      })),
    };
    
    const components: PlacedComponent[] = (data.components || []).map((c: any) => {
      // Re-register embedded footprints (e.g. custom footprints) so footprint
      // ID lookups keep working after the project is reloaded
      if (c.footprint && c.footprint.id) {
        registerFootprint(c.footprint);
      }
      return {
        ...c,
        nets: recordToMap<string>(c.nets),
        pinPositions: recordToMap<Coordinate>(c.pinPositions),
      } as PlacedComponent;
    });
    
    const assemblyGuide: AssemblyGuide | undefined = data.assemblyGuide
      ? {
          ...data.assemblyGuide,
          groupedSteps: recordToMap<AssemblyStep[][]>(data.assemblyGuide.groupedSteps) as Map<AssemblyGroupBy, AssemblyStep[][]>,
        }
      : undefined;
    
    const assemblyProgress: AssemblyProgress | undefined = data.assemblyProgress
      ? {
          ...data.assemblyProgress,
          completedStepIds: new Set<string>(data.assemblyProgress.completedStepIds || []),
        }
      : undefined;
    
    const project: ProjectFile = {
      version: data.version || '1.0',
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now(),
      board,
      circuit,
      components,
      routes: data.routes || [],
      nets: data.nets || circuit.nets,
      schematicPositions: data.schematicPositions
        ? recordToMap<{ x: number; y: number }>(data.schematicPositions)
        : undefined,
      schematicCanvasSize: data.schematicCanvasSize?.w && data.schematicCanvasSize?.h
        ? { w: Number(data.schematicCanvasSize.w), h: Number(data.schematicCanvasSize.h) }
        : undefined,
      validation: data.validation,
      assemblyGuide,
      assemblyProgress,
      netIdCounter: data.netIdCounter,
      metadata: data.metadata || {
        name: circuit.name || 'Untitled Project',
        version: 1,
        appVersion: '0.1.0',
      },
    };
    
    return migrateProject(project);
  } catch (error) {
    console.error('Failed to deserialize project:', error);
    return null;
  }
}

export function exportToJSON(project: ProjectFile): ExportResult {
  try {
    const data = serializeProject(project);
    return {
      success: true,
      data,
      filename: `${project.metadata.name.replace(/\s+/g, '-')}.json`,
      mimeType: 'application/json',
    };
  } catch (error) {
    return {
      success: false,
      filename: '',
      mimeType: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function importFromJSON(json: string): ProjectFile | null {
  return deserializeProject(json);
}

export function migrateProject(project: ProjectFile): ProjectFile {
  const sourceVersion = String(project.version || '1.0');
  const [major, minor] = sourceVersion.split('.').map(part => Number.parseInt(part, 10) || 0);
  if (major > 1 || (major === 1 && minor > 1)) {
    throw new Error(`Project format ${sourceVersion} is newer than this ZeroPCB Studio build supports.`);
  }

  // 1.0 -> 1.1 added explicit defaults for routing preference and optional
  // schematic/assembly metadata. Missing values are filled without changing
  // the board, circuit, components, routes, or user lock states.
  return {
    ...project,
    version: CURRENT_PROJECT_FORMAT,
    routingPreference: project.routingPreference ?? DEFAULT_ROUTING_CONFIG.preference,
    schematicPositions: project.schematicPositions ?? new Map(),
    metadata: {
      ...project.metadata,
      name: project.metadata?.name || project.circuit.name || 'Untitled Project',
      version: project.metadata?.version ?? 1,
      appVersion: project.metadata?.appVersion || '0.1.0',
    },
  };
}

export type { BoardState } from '../board/types';
export type { PlacedComponent } from '../footprints/types';
export type { Circuit, Net } from '../circuit/types';
export type { Route } from '../routing/types';
export type { AssemblyGuide, AssemblyStep } from '../soldering/types';
export type { ValidationResult } from '../validation/types';
