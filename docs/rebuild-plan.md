# ZeroPCB Studio rebuild plan

This plan is based on the existing repository and protects its current design data and tested engineering workflows.

## Repository findings

- **App shell:** React 19, TypeScript, and Vite. `src/main.tsx` mounts one `App`; there is no URL router. Zustand state and keyboard actions live in `src/app/store.ts` and `src/app/App.tsx`.
- **Existing identity:** `/public/favicon.svg` is the ZeroPCB Studio mark. The app already has a black dark theme in `src/index.css`; the rebuild keeps that theme and asset.
- **Circuit model:** `src/circuit/types.ts` represents components, pins, and named nets. Manual net editing and a best-effort KiCad netlist importer are available. `src/schematic/Symbols.ts` and `SchematicCanvas.tsx` render and edit the schematic.
- **Board model:** `src/board/types.ts` stores a pad per grid coordinate. Perfboard pads are isolated. Stripboard pads have explicit connected-pad links; track cuts and mounting holes break strip continuity. Solder-side coordinates are mirrored in `src/board/transforms.ts`.
- **Placement:** `src/placement/engine.ts` uses scored candidate placement and simulated annealing. Board drag, rotation, coordinate editing, locks, undo, and redo are in the store and canvas. Placement proposals evaluate current and candidate layouts with the router, show measured metrics and preview moved parts, and require explicit approval.
- **Routing and validation:** `src/routing/engine.ts` runs A* over pads, treating adjacent-pad wire edges as explicit wire and strip links as copper. `src/validation/types.ts` checks board placement, connectivity, short circuits, routing continuity, and stripboard conflicts. `src/routing/metrics.ts` defines shared physical jumper-run counts and lengths used by routing, exports, and soldering steps.
- **Storage and interchange:** `src/storage/types.ts` uses IndexedDB and a projects object store. Autosave follows the active local project ID; users can save, switch, and delete named projects. JSON project files use format `1.1` with a `1.0` migration path that preserves existing design data.
- **User interface:** `App.tsx` currently has a compact top toolbar, left Board/Library/Circuit tabs, center schematic/board workspace, right Inspect/Place/Route/Check/Build/Export tabs, and a status bar. The component library already has search. The redesign can preserve these panels' capabilities while making the stage navigation, canvas controls, contextual inspector, and responsive behavior clearer.
- **Tests:** Vitest covers board transforms, placement, routing, validation, storage helpers, import/export, and the integrated circuit pipeline. Playwright covers the key browser flows, IndexedDB refresh recovery, schematic interactions, board pan, and board display.

## Staged implementation

1. **Protect the baseline:** Keep the existing SVG logo and black theme, inventory each current flow, and add focused regressions before replacing shared components. Do not delete or rewrite existing project records during schema changes.
2. **Workspace redesign:** Reorganize the existing shell into compact stage navigation, a searchable library, the central board/schematic canvas, a contextual inspector, and an always-readable engineering status bar. Keep current stage tools mounted or reachable, retain keyboard actions, and add small-screen navigation without changing design state during view changes.
3. **Placement and control:** Preserve grid-snap drag, coordinates, rotation, multi-select, lock state, duplicate/delete, and undo/redo. Ensure locked parts remain fixed in placement and in every routing-derived candidate.
4. **Routing correctness and objective metrics:** Keep board semantics explicit. Share a physical jumper-run extraction function between optimization, reports, exports, and the soldering guide. Route all nets with prioritized costs (validity, feasibility, jumper runs, length, bends, congestion) and add graph-based tests for both board types.
5. **Permission-based route improvement:** Evaluate current and candidate placements with the routing engine, show measured before/after counts and exact moved coordinates, and recalculate routes after approval. Existing positions are unchanged until the user applies a proposal.
6. **Data-safe project lifecycle:** Add versioned project migrations and multi-project selection while keeping legacy `1.0` JSON and the current local autosave recoverable. Test migration, round-trip import/export, refresh restore, and project switching with existing project records.
7. **Validation and delivery:** Ensure assembly steps are derived only from actual routes and board connectivity, surface unrouted nets and exact jumper endpoints/lengths, then run unit, integration, browser, lint, and production build checks. Record any unsupported feature as a limitation rather than implying verification.

## Existing behavior to preserve

Manual circuit entry and KiCad import; board presets and custom dimensions; mounting-hole settings; perfboard and stripboard selection; track cuts; board and schematic editing; component reference/value editing; lock persistence; route locking and preference; front/solder views; validation; assembly checklist; manual Save/Load; IndexedDB autosave; JSON/SVG/PNG/CSV/print exports.

