/**
 * Local project persistence helpers.
 *
 * The app keeps working with no accounts and no backend: the whole project is
 * written to IndexedDB in this browser (see `storage/types.ts`) so a refresh
 * or a new visit picks up exactly where the user left off.
 *
 * These helpers are pure (no store import) so they are easy to unit test:
 *  - `buildStoredProject` turns the app's persisted slice into a stored record
 *  - `storedToLoadPayload` turns a stored record back into `loadProject` input
 *  - `samePersistedState` compares two slices by reference for cheap change
 *    detection (zustand replaces changed slices, so `===` is enough)
 */

import { createProjectFile, migrateProject } from '../exporters/types';
import type { ProjectFile, ProjectMetadata } from '../exporters/types';
import type { BoardConfig, BoardState } from '../board/types';
import type { Circuit } from '../circuit/types';
import type { PlacedComponent } from '../footprints/types';
import type { Route } from '../routing/types';
import { DEFAULT_ROUTING_CONFIG, type RoutingConfig } from '../routing/types';
import type { AssemblyGuide, AssemblyProgress } from '../soldering/types';
import type { ValidationResult } from '../validation/types';
import type { StoredProject } from './types';

/**
 * Fixed key of the local project slot. This browser keeps exactly one project:
 * the autosave writes it on every change and the panel's manual Save writes
 * the same record, so Load always brings back the latest state.
 */
export const LOCAL_PROJECT_ID = 'zeropcb-local-project';

/** Idle time after the last design change before the project is written */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/** The part of the app state that is persisted to the browser */
export interface PersistedProjectState {
  board: BoardState;
  boardConfig: BoardConfig;
  circuit: Circuit;
  netIdCounter: number;
  placedComponents: PlacedComponent[];
  routes: Route[];
  projectMetadata: ProjectMetadata;
  schematicPositions: Map<string, { x: number; y: number }>;
  schematicCanvasSize: { w: number; h: number };
  validationResult: ValidationResult | null;
  assemblyGuide: AssemblyGuide | null;
  assemblyProgress: AssemblyProgress | null;
  routingConfig: RoutingConfig;
}

/** The persisted slice of the store, by reference (UI state is left out) */
export function persistedSliceOf(state: PersistedProjectState): PersistedProjectState {
  return {
    board: state.board,
    boardConfig: state.boardConfig,
    circuit: state.circuit,
    netIdCounter: state.netIdCounter,
    placedComponents: state.placedComponents,
    routes: state.routes,
    projectMetadata: state.projectMetadata,
    schematicPositions: state.schematicPositions,
    schematicCanvasSize: state.schematicCanvasSize,
    validationResult: state.validationResult,
    assemblyGuide: state.assemblyGuide,
    assemblyProgress: state.assemblyProgress,
    routingConfig: state.routingConfig,
  };
}

/**
 * Does the design hold any user work? Used together with `isDirty` to protect
 * a previously saved project from being skipped over by the initial empty
 * state. A bare default board does not count as work.
 */
export function hasDesignContent(state: {
  circuit: Circuit;
  placedComponents: PlacedComponent[];
  routes: Route[];
}): boolean {
  return (
    state.circuit.components.length > 0 ||
    state.circuit.nets.length > 0 ||
    state.placedComponents.length > 0 ||
    state.routes.length > 0
  );
}

/** Cheap change detection: zustand swaps the slices that actually changed */
export function samePersistedState(a: PersistedProjectState | null, b: PersistedProjectState | null): boolean {
  if (!a || !b) return false;
  return (
    a.board === b.board &&
    a.boardConfig === b.boardConfig &&
    a.circuit === b.circuit &&
    a.netIdCounter === b.netIdCounter &&
    a.placedComponents === b.placedComponents &&
    a.routes === b.routes &&
    a.projectMetadata === b.projectMetadata &&
    a.schematicPositions === b.schematicPositions &&
    a.schematicCanvasSize === b.schematicCanvasSize &&
    a.validationResult === b.validationResult &&
    a.assemblyGuide === b.assemblyGuide &&
    a.assemblyProgress === b.assemblyProgress &&
    a.routingConfig === b.routingConfig
  );
}

/** Build the IndexedDB record for the current design */
export function buildStoredProject(
  state: PersistedProjectState,
  options: { id?: string; createdAt?: number; now?: number } = {},
): StoredProject {
  const now = options.now ?? Date.now();
  const project = createProjectFile(
    state.board,
    state.circuit,
    state.placedComponents,
    state.routes,
    state.circuit.nets,
    {
      name: state.projectMetadata.name,
      version: state.projectMetadata.version,
    },
  );

  project.createdAt = options.createdAt ?? project.createdAt;
  project.updatedAt = now;
  project.schematicPositions = state.schematicPositions;
  project.schematicCanvasSize = state.schematicCanvasSize;
  project.validation = state.validationResult || undefined;
  project.assemblyGuide = state.assemblyGuide || undefined;
  project.netIdCounter = state.netIdCounter;
  project.assemblyProgress = state.assemblyProgress
    ? { ...state.assemblyProgress, completedStepIds: new Set(state.assemblyProgress.completedStepIds) }
    : undefined;
  project.routingPreference = state.routingConfig.preference;

  return { ...project, id: options.id ?? LOCAL_PROJECT_ID };
}

/** Turn a stored record (or an imported project file) into `loadProject` input */
export function storedToLoadPayload(stored: ProjectFile): {
  board: ProjectFile['board'];
  boardConfig: ProjectFile['board']['config'];
  circuit: ProjectFile['circuit'];
  netIdCounter: ProjectFile['netIdCounter'];
  placedComponents: ProjectFile['components'];
  routes: ProjectFile['routes'];
  projectMetadata: ProjectFile['metadata'];
  schematicPositions: ProjectFile['schematicPositions'];
  schematicCanvasSize: ProjectFile['schematicCanvasSize'];
  validationResult: ProjectFile['validation'] | null;
  assemblyGuide: ProjectFile['assemblyGuide'] | null;
  assemblyProgress: AssemblyProgress | null;
  routingConfig: RoutingConfig;
} {
  const project = migrateProject(stored);
  return {
    board: project.board,
    boardConfig: project.board.config,
    circuit: project.circuit,
    netIdCounter: project.netIdCounter,
    placedComponents: project.components,
    routes: project.routes,
    projectMetadata: project.metadata,
    schematicPositions: project.schematicPositions,
    schematicCanvasSize: project.schematicCanvasSize,
    validationResult: project.validation ?? null,
    assemblyGuide: project.assemblyGuide ?? null,
    assemblyProgress: project.assemblyProgress
      ? { ...project.assemblyProgress, completedStepIds: new Set(project.assemblyProgress.completedStepIds) }
      : null,
    routingConfig: { ...DEFAULT_ROUTING_CONFIG, preference: project.routingPreference ?? DEFAULT_ROUTING_CONFIG.preference },
  };
}

/** Human readable status for the UI */
export function saveStatusLabel(
  status: 'idle' | 'saving' | 'saved' | 'error',
  at: number | null,
  error: string | null,
): string {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'saved': {
      const time = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return time ? `Saved ${time}` : 'Saved';
    }
    case 'error':
      return error ? `Save failed — ${error}` : 'Save failed';
    default:
      return 'Not saved yet';
  }
}
