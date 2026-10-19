/**
 * Right panel - tabbed: Inspector, Placement, Routing, Validation, Assembly, Export
 */

import React, { useState } from 'react';
import { useAppStore } from '../app/store';
import { PlacementPanel } from './PlacementPanel';
import { RoutingPanel } from './RoutingPanel';
import { ValidationPanel } from './ValidationPanel';
import { AssemblyPanel } from './AssemblyPanel';
import { ExportPanel } from './ExportPanel';
import { Panel, Button, Input } from './ui';
import { getFootprintById } from '../footprints/types';
import { coordToLabel } from '../board/types';

type RightTab = 'inspector' | 'placement' | 'routing' | 'validation' | 'assembly' | 'export';

const TABS: { id: RightTab; label: string; icon: string }[] = [
  { id: 'inspector', label: 'Inspect', icon: '🔍' },
  { id: 'placement', label: 'Place', icon: '⬚' },
  { id: 'routing', label: 'Route', icon: '〰' },
  { id: 'validation', label: 'Check', icon: '✓' },
  { id: 'assembly', label: 'Build', icon: '🔧' },
  { id: 'export', label: 'Export', icon: '⇩' },
];

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<RightTab>('inspector');
  const validationResult = useAppStore(s => s.validationResult);
  const circuit = useAppStore(s => s.circuit);
  
  const errorCount = validationResult?.issues.filter(i => i.severity === 'error').length || 0;
  
  return (
    <div className="flex flex-col h-full">
      {/* Permanent 2×3 tab grid - all sections always visible, no scrolling */}
      <div className="grid grid-cols-3 gap-1 p-2 border-b border-app bg-panel" data-testid="right-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id ? '' : 'text-muted hover-bg'
            }`}
            style={activeTab === tab.id ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
            onClick={() => setActiveTab(tab.id)}
          >
            <span aria-hidden>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.id === 'validation' && errorCount > 0 && (
              <span className="px-1 rounded-full text-[8px] text-white" style={{ backgroundColor: 'var(--danger)' }}>
                {errorCount}
              </span>
            )}
          </button>
        ))}
      </div>
      
      {circuit.components.length === 0 && (
        <div className="mx-2 mt-2 px-2 py-1.5 rounded border border-app text-[10px] text-muted leading-relaxed"
          style={{ backgroundColor: 'var(--hover-bg)' }}>
          The <strong className="text-app">Circuit</strong> is empty: add parts in the{' '}
          <strong className="text-app">Library</strong>, wire them in the{' '}
          <strong className="text-app">Schematic</strong> view, then place and route here.
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
        {activeTab === 'inspector' && <InspectorPanel />}
        {activeTab === 'placement' && <PlacementPanel />}
        {activeTab === 'routing' && <RoutingPanel />}
        {activeTab === 'validation' && <ValidationPanel />}
        {activeTab === 'assembly' && <AssemblyPanel />}
        {activeTab === 'export' && <ExportPanel />}
      </div>
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
  const updateComponentValue = useAppStore(s => s.updateComponentValue);
  const updateComponentReference = useAppStore(s => s.updateComponentReference);
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
        <Panel title="Board Summary">
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
          Select a component on the board or in the library to inspect it.
          Drag component pins to move them.
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
              
              <div className="text-[10px] text-muted font-mono">
                Position: {coordToLabel(comp.position)}
                {' → '}
                {coordToLabel({ row: comp.boundingBox.maxRow, col: comp.boundingBox.maxCol })}
              </div>
              
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