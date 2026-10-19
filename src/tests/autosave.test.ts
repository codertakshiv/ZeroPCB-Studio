/**
 * Local persistence: autosave record building, change detection, the
 * "don't overwrite a saved project with the empty default" guard and a full
 * round-trip of the project through the stored (JSON-safe) shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app/store';
import { registerAllStandardFootprints } from '../footprints/library';
import { deserializeProject, serializeProject } from '../exporters/types';
import {
  LOCAL_PROJECT_ID,
  buildStoredProject,
  hasDesignContent,
  persistedSliceOf,
  saveStatusLabel,
  samePersistedState,
  storedToLoadPayload,
  type PersistedProjectState,
} from '../storage/autosave';

registerAllStandardFootprints();

function resetStore() {
  useAppStore.getState().resetProject();
}

/** The persisted slice, exactly as the persistence hook reads it */
function slice(): PersistedProjectState {
  return persistedSliceOf(useAppStore.getState());
}

describe('Autosave: change detection', () => {
  beforeEach(resetStore);

  it('ignores changes that only touch UI state', () => {
    const before = slice();
    useAppStore.getState().selectComponent(null);
    useAppStore.getState().setZoom(2);
    useAppStore.getState().setPanOffset({ x: 40, y: 10 });
    useAppStore.getState().setActiveSide('both');
    expect(samePersistedState(before, slice())).toBe(true);
  });

  it('sees design changes', () => {
    const before = slice();
    useAppStore.getState().addComponentToCircuit('resistor-axial', 'R1');
    expect(samePersistedState(before, slice())).toBe(false);
  });

  it('treats a missing baseline as dirty', () => {
    expect(samePersistedState(null, slice())).toBe(false);
  });
});

describe('Autosave: initial state guard', () => {
  beforeEach(resetStore);

  it('reports no design content for the untouched default project', () => {
    const state = useAppStore.getState();
    expect(hasDesignContent(state)).toBe(false);
    expect(state.isDirty).toBe(false);
  });

  it('reports design content as soon as the user works on the circuit', () => {
    useAppStore.getState().addComponentToCircuit('resistor-axial', 'R1');
    expect(hasDesignContent(useAppStore.getState())).toBe(true);
    expect(useAppStore.getState().isDirty).toBe(true);
  });
});

describe('Autosave: project round-trip', () => {
  beforeEach(resetStore);

  it('restores board settings, components, positions, routes and checklist progress', async () => {
    // --- Board settings first (a grid change invalidates the layout) ---
    useAppStore.getState().setBoardDimensions({ rows: 24, cols: 16 });
    useAppStore.getState().setBoardConfig({ appearance: 'green' });

    // --- Circuit ---
    const c1 = useAppStore.getState().addComponentToCircuit('resistor-axial', 'R1');
    const c2 = useAppStore.getState().addComponentToCircuit('led-5mm', 'D1');
    const netId = useAppStore.getState().addNet('SIG');
    useAppStore.getState().connectPinToNet(c1, 'p1', netId);
    useAppStore.getState().connectPinToNet(c2, 'p1', netId);

    // --- Place + route ---
    await useAppStore.getState().runPlacement();
    await useAppStore.getState().runRouting();
    useAppStore.getState().validate();

    // --- Assembly guide + checklist progress ---
    useAppStore.getState().generateGuide();
    const guide = useAppStore.getState().assemblyGuide;
    expect(guide).not.toBeNull();
    const firstStep = guide!.steps[0].id;
    useAppStore.getState().updateAssemblyProgress(firstStep, true);

    // --- Schematic sheet edits ---
    useAppStore.getState().ensureSchematicPositions();
    const schematicPositions = new Map(useAppStore.getState().schematicPositions);
    expect(schematicPositions.size).toBe(2);
    useAppStore.getState().setSchematicCanvasSize({ w: 140, h: 90 });

    // --- Snapshot what has to survive ---
    const before = {
      rows: 24,
      cols: 16,
      appearance: useAppStore.getState().boardConfig.appearance,
      routes: useAppStore.getState().routes.length,
      placed: useAppStore.getState().placedComponents.length,
      netIdCounter: useAppStore.getState().netIdCounter,
      completed: useAppStore.getState().assemblyProgress!.completedStepIds.size,
      progressIndex: useAppStore.getState().assemblyProgress!.currentStepIndex,
      validation: useAppStore.getState().validationResult !== null,
    };
    expect(before.routes).toBeGreaterThan(0);
    expect(before.netIdCounter).toBeGreaterThan(1);
    expect(before.completed).toBe(1);

    // --- Build the record, push it through plain JSON (no Maps/Sets) ---
    const record = buildStoredProject(slice(), { id: LOCAL_PROJECT_ID, createdAt: 1000, now: 5000 });
    expect(record.id).toBe(LOCAL_PROJECT_ID);
    expect(record.createdAt).toBe(1000);
    expect(record.updatedAt).toBe(5000);

    const json = serializeProject(record);
    const parsed = deserializeProject(json);
    expect(parsed).not.toBeNull();

    // --- "Refresh": reset to the empty default and restore ---
    useAppStore.getState().resetProject();
    expect(useAppStore.getState().circuit.components.length).toBe(0);
    expect(useAppStore.getState().routes.length).toBe(0);

    useAppStore.getState().loadProject(storedToLoadPayload(parsed!));

    const state = useAppStore.getState();
    // Board settings
    expect(state.boardConfig.dimensions.rows).toBe(before.rows);
    expect(state.boardConfig.dimensions.cols).toBe(before.cols);
    expect(state.boardConfig.appearance).toBe(before.appearance);
    // Circuit + placement
    expect(state.circuit.components.map(c => c.reference).sort()).toEqual(['D1', 'R1']);
    expect(state.circuit.nets.length).toBe(1);
    expect(state.netIdCounter).toBe(before.netIdCounter);
    expect(state.placedComponents.length).toBe(before.placed);
    // Routes (a real project cannot route without them)
    expect(state.routes.length).toBe(before.routes);
    expect(state.routes[0].segments.length).toBeGreaterThan(0);
    // Checklist progress + guide
    expect(state.assemblyGuide).not.toBeNull();
    const restoredStep = state.assemblyGuide!.steps[0].id;
    expect(state.assemblyProgress!.completedStepIds.has(restoredStep)).toBe(true);
    expect(state.assemblyProgress!.completedStepIds.size).toBe(before.completed);
    expect(state.assemblyProgress!.currentStepIndex).toBe(before.progressIndex);
    // Validation result survives too
    expect(state.validationResult !== null).toBe(before.validation);
    // Schematic sheet
    expect(state.schematicPositions.size).toBe(2);
    expect(state.schematicCanvasSize).toEqual({ w: 140, h: 90 });
    for (const [id, pos] of schematicPositions) {
      expect(state.schematicPositions.get(id)).toEqual(pos);
    }
    // A freshly loaded project is not dirty
    expect(state.isDirty).toBe(false);
  });

  it('clears derived results when a plain JSON import has none', () => {
    const c1 = useAppStore.getState().addComponentToCircuit('resistor-axial', 'R1');
    useAppStore.getState().placeComponent(c1, { row: 2, col: 2 }, 0);
    useAppStore.getState().generateGuide();
    expect(useAppStore.getState().assemblyGuide).not.toBeNull();

    // JSON files without guide/progress must not keep stale derived state
    useAppStore.getState().loadProject({
      circuit: { ...useAppStore.getState().circuit, components: [] },
    });
    expect(useAppStore.getState().assemblyGuide).toBeNull();
    expect(useAppStore.getState().assemblyProgress).toBeNull();
  });
});

describe('Autosave: status labels', () => {
  it('spells out saving, saved and failure', () => {
    expect(saveStatusLabel('saving', null, null)).toBe('Saving…');
    expect(saveStatusLabel('saved', Date.parse('2026-01-02T09:05:00'), null)).toMatch(/^Saved /);
    expect(saveStatusLabel('saved', null, null)).toBe('Saved');
    expect(saveStatusLabel('error', null, 'quota exceeded')).toBe('Save failed — quota exceeded');
    expect(saveStatusLabel('error', null, null)).toBe('Save failed');
    expect(saveStatusLabel('idle', null, null)).toBe('Not saved yet');
  });
});
