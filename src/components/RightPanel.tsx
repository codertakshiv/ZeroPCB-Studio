/**
 * Right panel - tabbed: Inspector, Placement, Routing, Validation, Assembly, Export
 */

import React, { useState } from 'react';
import { useAppStore } from '../app/store';
import type { WorkspaceStage } from '../app/stages';
import { PlacementPanel } from './PlacementPanel';
import { RoutingPanel } from './RoutingPanel';
import { ValidationPanel } from './ValidationPanel';
import { AssemblyPanel } from './AssemblyPanel';
import { ExportPanel } from './ExportPanel';
import { Panel, Button, Input } from './ui';
import { getFootprintById, Orientation } from '../footprints/types';
import { coordToLabel } from '../board/types';

export function RightPanel({ activeStage }: { activeStage: WorkspaceStage }) {
  const validationResult = useAppStore(s => s.validationResult);
  const placementResult = useAppStore(s => s.placementResult);
  const placementProposal = useAppStore(s => s.placementProposal);
  const selectedComponentIds = useAppStore(s => s.selectedComponentIds);
  const selectedNetId = useAppStore(s => s.selectedNetId);
  
  const errorCount = validationResult?.issues.filter(i => i.severity === 'error').length || 0;
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app bg-panel">
        <span className="text-xs font-medium text-app">
          {activeStage === 'project' || activeStage === 'placement' ? 'Inspector' : activeStage === 'circuit' ? 'Circuit' : activeStage === 'validation' ? 'Validation' : activeStage === 'routing' ? 'Routing' : activeStage === 'assembly' ? 'Assembly' : 'Project files'}
        </span>
        {activeStage === 'validation' && errorCount > 0 && (
          <span className="rounded px-1.5 py-0.5 text-[9px] text-white" style={{ backgroundColor: 'var(--danger)' }}>{errorCount} errors</span>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5">
        {(activeStage === 'project' || activeStage === 'circuit' || (activeStage === 'placement' && !placementResult && !placementProposal) || selectedComponentIds.size > 0 || selectedNetId) && <InspectorPanel />}
        {activeStage === 'placement' && <PlacementPanel />}
        {activeStage === 'routing' && <RoutingPanel />}
        {activeStage === 'validation' && <ValidationPanel />}
        {activeStage === 'assembly' && <AssemblyPanel />}
        {activeStage === 'export' && <ExportPanel />}
      </div>
    </div>
  );
}

function ComponentPositionEditor({ componentId, position, orientation, locked, placeComponent }: {
  componentId: string;
  position: { row: number; col: number };
  orientation: Orientation;
  locked: boolean;
  placeComponent: (id: string, position: { row: number; col: number }, orientation: Orientation) => { success: boolean; error?: string };
}) {
  const [row, setRow] = useState(String(position.row + 1));
  const [col, setCol] = useState(String(position.col + 1));
  const [error, setError] = useState('');

  const commit = () => {
    const rowNumber = Number.parseInt(row, 10);
    const colNumber = Number.parseInt(col, 10);
    if (!Number.isInteger(rowNumber) || !Number.isInteger(colNumber) || rowNumber < 1 || colNumber < 1) {
      setRow(String(position.row + 1));
      setCol(String(position.col + 1));
      setError('Enter positive hole coordinates.');
      return;
    }
    const result = placeComponent(componentId, { row: rowNumber - 1, col: colNumber - 1 }, orientation);
    setError(result.success ? '' : result.error || 'That position is not available.');
    if (!result.success) {
      setRow(String(position.row + 1));
      setCol(String(position.col + 1));
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-muted">Row
          <input type="number" min={1} value={row} disabled={locked} onChange={e => setRow(e.target.value)} onBlur={commit}
            className="mt-0.5 w-full rounded border border-app bg-app px-2 py-1 text-xs text-app disabled:opacity-50" />
        </label>
        <label className="text-[10px] text-muted">Column
          <input type="number" min={1} value={col} disabled={locked} onChange={e => setCol(e.target.value)} onBlur={commit}
            className="mt-0.5 w-full rounded border border-app bg-app px-2 py-1 text-xs text-app disabled:opacity-50" />
        </label>
      </div>
      <div className="mt-1 text-[10px] text-muted font-mono">Grid position: {coordToLabel(position)}</div>
      {locked && <div className="text-[10px] text-muted">Unlock to edit this position.</div>}
      {error && <div role="status" className="text-[10px] mt-1" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
function InspectorPanel() {
  const selectedComponentIds = useAppStore(s => s.selectedComponentIds);
  const components = useAppStore(s => s.placedComponents);
  const circuit = useAppStore(s => s.circuit);
  const boardConfig = useAppStore(s => s.boardConfig);
  const lockComponent = useAppStore(s => s.lockComponent);
  const rotateComponent = useAppStore(s => s.rotateComponent);
  const unplaceComponent = useAppStore(s => s.unplaceComponent);
  const removeComponentFromCircuit = useAppStore(s => s.removeComponentFromCircuit);
  const duplicateComponents = useAppStore(s => s.duplicateComponents);
  const updateComponentValue = useAppStore(s => s.updateComponentValue);
  const updateComponentReference = useAppStore(s => s.updateComponentReference);
  const placeComponent = useAppStore(s => s.placeComponent);
  const selectedNetId = useAppStore(s => s.selectedNetId);
  const nets = useAppStore(s => s.circuit.nets);
  
  const selectedComponents = components.filter(c => selectedComponentIds.has(c.id));
  const selectedCircuitComponents = circuit.components.filter(c => selectedComponentIds.has(c.id));
  
  if (selectedNetId) {
    const net = nets.find(n => n.id === selectedNetId);
    if (net) {
      return (
        <div className="flex flex-col gap-3">
          <Panel title={`Net: ${net.name}`}>
            <div className="text-xs flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-muted">Pins</span>
                <span>{net.pins.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Type</span>
                <span>{net.isPower ? 'Power' : net.isGround ? 'Ground' : 'Signal'}</span>
              </div>
              <div className="mt-2 flex flex-col gap-0.5">
                {net.pins.map(pin => {
                  const comp = circuit.components.find(c => c.id === pin.componentId);
                  return (
                    <div key={`${pin.componentId}-${pin.pinId}`} className="font-mono text-[10px]">
                      {comp?.reference}.{pin.pinNumber} — {pin.pinName}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>
      );
    }
  }
  
  if (selectedComponents.length === 0 && selectedCircuitComponents.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Panel title="Board" defaultOpen={false}>
          <div className="text-xs flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-muted">Board</span>
              <span>{boardConfig.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Type</span>
              <span className="capitalize">{boardConfig.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Grid</span>
              <span>{boardConfig.dimensions.rows} × {boardConfig.dimensions.cols}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Pitch</span>
              <span>{boardConfig.dimensions.holePitchMm}mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Components</span>
              <span>{components.length} placed / {circuit.components.length} total</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Nets</span>
              <span>{nets.length}</span>
            </div>
          </div>
        </Panel>
        
        <p className="text-[10px] text-muted text-center px-2">
          Select a component or route to inspect it.
        </p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col gap-3">
      {selectedComponents.map(comp => {
        const circuitComp = circuit.components.find(c => c.id === comp.id);
        const footprint = getFootprintById(comp.footprintId);
        
        return (
          <Panel key={comp.id} title={`${comp.reference} ${comp.value ? `(${comp.value})` : ''}`}>
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-muted">
                {footprint?.name} · {footprint?.pins.length} pins · orientation {comp.orientation}°
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Reference"
                  value={circuitComp?.reference || ''}
                  onChange={(v) => updateComponentReference(comp.id, v)}
                />
                <Input
                  label="Value"
                  value={circuitComp?.value || ''}
                  onChange={(v) => updateComponentValue(comp.id, v)}
                />
              </div>
              
              <ComponentPositionEditor key={`${comp.id}-${comp.position.row}-${comp.position.col}`} componentId={comp.id} position={comp.position} orientation={comp.orientation} locked={comp.locked} placeComponent={placeComponent} />
              
              <div className="flex flex-wrap gap-1">
                <Button size="sm" onClick={() => rotateComponent(comp.id, 'ccw')} title="Rotate counter-clockwise">↺</Button>
                <Button size="sm" onClick={() => rotateComponent(comp.id, 'cw')} title="Rotate clockwise (R)">↻</Button>
                <Button
                  size="sm"
                  onClick={() => lockComponent(comp.id, !comp.locked)}
                  title="Lock placement (L)"
                >
                  {comp.locked ? '🔒 Locked' : '🔓 Unlocked'}
                </Button>
              </div>
              
              <div className="flex gap-1">
                <Button size="sm" onClick={() => duplicateComponents([comp.id])} title="Duplicate component (Ctrl+D)">Duplicate</Button>
                <Button size="sm" onClick={() => unplaceComponent(comp.id)} title="Remove from board but keep in circuit">
                  Unplace
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm(`Delete ${comp.reference} from the circuit?`)) {
                      removeComponentFromCircuit(comp.id);
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
              
              <div className="border-t border-app pt-2 mt-1">
                <div className="text-[10px] font-semibold text-muted mb-1">Pins</div>
                <div className="flex flex-col gap-0.5">
                  {footprint?.pins.map(pin => {
                    const coord = comp.pinPositions.get(pin.id);
                    const netId = comp.nets.get(pin.id);
                    const net = nets.find(n => n.id === netId);
                    
                    return (
                      <div key={pin.id} className="flex items-center gap-1.5 text-[10px]">
                        <span className="font-mono w-8">{pin.number}</span>
                        <span className="flex-1 truncate text-muted">{pin.name}</span>
                        {coord && (
                          <span className="font-mono text-muted">
                            {coordToLabel(coord)}
                          </span>
                        )}
                        {net?.name && (
                          <span className="px-1 rounded-full text-[9px]"
                            style={{
                              backgroundColor: net.color || 'var(--accent)',
                              color: net.color ? '#ffffff' : 'var(--accent-ink)',
                            }}>
                            {net.name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
