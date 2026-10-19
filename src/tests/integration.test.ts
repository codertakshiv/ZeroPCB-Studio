/**
 * Integration test: full pipeline from netlist import to a validated board.
 *
 * Reproduces the real browser flow (import → place → route → validate) through
 * the Zustand store and guards a real regression found during browser
 * verification: multi-leg routes (chained pin-to-pin wire runs) were reported
 * as "gap" open circuits because the validator assumed a single linear walk.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useAppStore } from '../app/store';
import { registerAllStandardFootprints } from '../footprints/library';
import { importKiCadNetlist } from '../circuit/import';

beforeAll(() => {
  registerAllStandardFootprints();
});

const KICAD_NETLIST = `(export (version "E")
  (design
    (sheet (number "1") (name "/")
      (title_block (title "Integration Test"))
    )
  )
  (components
    (comp (ref "R1") (value "330")
      (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal"))
    (comp (ref "D1") (value "Red") (footprint "LED_THT:LED_D5.0mm"))
    (comp (ref "U1") (value "ATtiny85") (footprint "Package_DIP:DIP-8_W7.62mm"))
    (comp (ref "C1") (value "100nF") (footprint "Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm"))
  )
  (nets
    (net (code "1") (name "VCC")
      (node (ref "R1") (pin "1")) (node (ref "D1") (pin "1"))
      (node (ref "U1") (pin "8")) (node (ref "C1") (pin "1")))
    (net (code "2") (name "GND")
      (node (ref "R1") (pin "2")) (node (ref "D1") (pin "2"))
      (node (ref "U1") (pin "4")) (node (ref "C1") (pin "2")))
    (net (code "3") (name "PB0")
      (node (ref "U1") (pin "5")) (node (ref "R1") (pin "2")) (node (ref "D1") (pin "2")))
  )
)`;

describe('Integration: import -> place -> route -> validate', () => {
  beforeEach(() => {
    useAppStore.getState().resetProject();
  });

  it('imports, places and routes a 4-component circuit with correct results', async () => {
    // --- Import ---
    const imported = importKiCadNetlist(KICAD_NETLIST);
    expect(imported.circuit).not.toBeNull();
    expect(imported.errors).toEqual([]);
    // R1.2 and D1.2 are listed in both GND and PB0 — reported, first net kept
    expect(imported.warnings.length).toBe(2);

    useAppStore.getState().importCircuit(imported.circuit!);
    expect(useAppStore.getState().circuit.components.length).toBe(4);
    expect(useAppStore.getState().circuit.nets.length).toBe(3);

    // --- Place ---
    await useAppStore.getState().runPlacement();
    let state = useAppStore.getState();

    expect(state.placementResult?.success).toBe(true);
    expect(state.placementResult?.placedComponents.length).toBe(4);
    expect(state.placementResult?.unplacedComponents.length).toBe(0);

    // No two placed components may overlap
    for (let i = 0; i < state.placedComponents.length; i++) {
      for (let j = i + 1; j < state.placedComponents.length; j++) {
        const a = state.placedComponents[i].boundingBox;
        const b = state.placedComponents[j].boundingBox;
        const overlaps = !(
          a.maxRow < b.minRow || a.minRow > b.maxRow ||
          a.maxCol < b.minCol || a.minCol > b.maxCol
        );
        expect(overlaps).toBe(false);
      }
    }

    // --- Route ---
    await useAppStore.getState().runRouting();
    state = useAppStore.getState();

    expect(state.routingResult?.unroutedNets.length).toBe(0);
    expect(state.routes.length).toBe(2); // VCC + GND (PB0 has one live pin)

    // At least one route is multi-leg: its segment list is a connected wire
    // graph rather than a single linear walk (the regression case)
    const multiLeg = state.routes.some(route => {
      for (let i = 0; i < route.segments.length - 1; i++) {
        const current = route.segments[i];
        const next = route.segments[i + 1];
        if (current.to.row !== next.from.row || current.to.col !== next.from.col) {
          return true;
        }
      }
      return false;
    });
    expect(multiLeg).toBe(true);

    // --- Validate ---
    useAppStore.getState().validate();
    state = useAppStore.getState();
    const result = state.validationResult!;

    // The regression: routed nets must NOT be reported as open circuits
    const openCircuits = result.issues.filter(i => i.type === 'open-circuit');
    expect(openCircuits).toEqual([]);
    expect(result.isValid).toBe(true);
    expect(result.stats.shortCircuits).toBe(0);
    expect(result.stats.completeNets).toBe(3);
    // The only finding is the honest warning about PB0's single live pin
    expect(result.issues.map(i => i.type)).toEqual(['single-pin-net']);
  }, 60000);
});
