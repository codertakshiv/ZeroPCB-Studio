/**
 * Component library panel - browse and add components
 */

import React, { useState, useMemo, useRef } from 'react';
import { useAppStore } from '../app/store';
import { ALL_STANDARD_FOOTPRINTS, createCustomFootprint } from '../footprints/library';
import { registerFootprint } from '../footprints/types';
import { Footprint, ComponentCategory } from '../footprints/types';
import { Panel, Input, Button } from './ui';

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  'resistor': 'Resistors',
  'capacitor': 'Capacitors',
  'polarized-capacitor': 'Polarized Capacitors',
  'led': 'LEDs',
  'diode': 'Diodes',
  'transistor': 'Transistors',
  'mosfet': 'MOSFETs',
  'ic-dip': 'DIP ICs',
  'ic-socket': 'IC Sockets',
  'pin-header': 'Pin Headers',
  'screw-terminal': 'Screw Terminals',
  'connector': 'Connectors',
  'switch': 'Switches',
  'push-button': 'Push Buttons',
  'potentiometer': 'Potentiometers',
  'crystal': 'Crystals',
  'voltage-regulator': 'Voltage Regulators',
  'custom': 'Custom',
};

const CATEGORY_PREFIXES: Partial<Record<ComponentCategory, string>> = {
  'resistor': 'R',
  'capacitor': 'C',
  'polarized-capacitor': 'C',
  'led': 'D',
  'diode': 'D',
  'transistor': 'Q',
  'mosfet': 'Q',
  'ic-dip': 'U',
  'ic-socket': 'X',
  'pin-header': 'J',
  'screw-terminal': 'J',
  'connector': 'J',
  'switch': 'SW',
  'push-button': 'SW',
  'potentiometer': 'RV',
  'crystal': 'Y',
  'voltage-regulator': 'U',
  'custom': 'X',
};

export function ComponentLibraryPanel() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ComponentCategory | 'all'>('all');
  const [customPinCount, setCustomPinCount] = useState(4);
  const [customRows, setCustomRows] = useState(2);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const cancelRenameRef = useRef(false);
  
  const circuit = useAppStore(s => s.circuit);
  const addComponentToCircuit = useAppStore(s => s.addComponentToCircuit);
  const placedComponents = useAppStore(s => s.placedComponents);
  const focusComponentId = useAppStore(s => s.selectedComponentIds);
  const updateComponentReference = useAppStore(s => s.updateComponentReference);
  
  const filteredFootprints = useMemo(() => {
    let list: Footprint[] = ALL_STANDARD_FOOTPRINTS;
    if (selectedCategory !== 'all') {
      list = list.filter(f => f.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, selectedCategory]);
  
  const categories = useMemo(() => {
    const cats = new Set<ComponentCategory>();
    for (const f of ALL_STANDARD_FOOTPRINTS) cats.add(f.category);
    return Array.from(cats);
  }, []);
  
  const getNextReference = (footprint: Footprint): string => {
    const prefix = CATEGORY_PREFIXES[footprint.category] || 'X';
    const existing = circuit.components.filter(c =>
      c.reference.startsWith(prefix) &&
      /^\D+\d+$/.test(c.reference)
    );
    const maxNum = existing.reduce((max, c) => {
      const num = parseInt(c.reference.replace(/\D/g, ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `${prefix}${maxNum + 1}`;
  };
  
  const addComponent = (footprint: Footprint) => {
    const reference = getNextReference(footprint);
    const defaultValue = getDefaultValue(footprint.category);
    addComponentToCircuit(footprint.id, reference, defaultValue);
  };
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Add Components">
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search components..."
        />
        
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-muted py-1">Categories</summary>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          <button
            className={`px-2 py-0.5 text-[10px] rounded border ${selectedCategory === 'all' ? '' : 'border-app text-app hover-bg'}`}
            style={selectedCategory === 'all' ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
            onClick={() => setSelectedCategory('all')}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              className={`px-2 py-0.5 text-[10px] rounded border ${selectedCategory === cat ? '' : 'border-app text-app hover-bg'}`}
              style={selectedCategory === cat ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
              onClick={() => setSelectedCategory(cat)}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
          </div>
        </details>
        
        <div className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-1">
          {filteredFootprints.length === 0 && (
            <p className="text-xs text-muted text-center py-3">No matching components</p>
          )}
          {filteredFootprints.map(fp => (
            <button
              key={fp.id}
              className="text-left px-2 py-1.5 rounded border border-app hover-bg transition-colors"
              onClick={() => addComponent(fp)}
              title={`${fp.description} — ${fp.pins.length} pins`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-app">{fp.name}</span>
                <span className="text-[10px] text-muted font-mono shrink-0">
                  {fp.pins.length}p
                </span>
              </div>
              <div className="text-[10px] text-muted truncate">{fp.description}</div>
            </button>
          ))}
        </div>
      </Panel>
      
      <Panel title="Custom Component" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Pin count"
            type="number"
            value={customPinCount}
            onChange={(v) => setCustomPinCount(Math.max(1, Math.min(64, parseInt(v) || 1)))}
            min={1}
            max={64}
          />
          <Input
            label="Rows"
            type="number"
            value={customRows}
            onChange={(v) => setCustomRows(Math.max(1, Math.min(4, parseInt(v) || 1)))}
            min={1}
            max={4}
          />
        </div>
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={() => {
            const pinsPerRow = Math.ceil(customPinCount / customRows);
            const pinDefs: { number: string; name: string; row: number; col: number }[] = [];
            
            for (let i = 0; i < customPinCount; i++) {
              const row = Math.floor(i / pinsPerRow);
              const col = i % pinsPerRow;
              pinDefs.push({ number: `${i + 1}`, name: `Pin ${i + 1}`, row, col });
            }
            
            const fp = createCustomFootprint(
              `custom-${Date.now()}`,
              `Custom ${customPinCount}-pin`,
              `User-defined ${customPinCount}-pin component`,
              pinDefs
            );
            
            registerFootprint(fp);
            addComponent(fp);
          }}
        >
          Create Custom Component
        </Button>
      </Panel>
      
      <Panel title="Circuit Components" defaultOpen={true}>
        {circuit.components.length === 0 ? (
          <p className="text-xs text-muted text-center py-2">
            No components yet. Click a component above to add it.
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {circuit.components.map(comp => {
              const placedComponent = placedComponents.find(p => p.id === comp.id);
              const isPlaced = !!placedComponent;
              const fp = ALL_STANDARD_FOOTPRINTS.find(f => f.id === comp.footprintId);
              const isSelected = focusComponentId.has(comp.id);
              
              return (
                <div
                  key={comp.id}
                  className={`flex items-center justify-between px-2 py-1 rounded text-xs ${isSelected ? 'selected' : 'hover-bg'}`}
                  onClick={() => useAppStore.getState().selectComponent(comp.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {renamingId === comp.id ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${comp.reference}`}
                      className="w-16 min-w-0 rounded border border-app bg-app px-1 py-0.5 font-mono"
                      value={renameValue}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (cancelRenameRef.current) {
                          cancelRenameRef.current = false;
                          setRenamingId(null);
                          return;
                        }
                        const reference = renameValue.trim();
                        if (reference) updateComponentReference(comp.id, reference);
                        setRenamingId(null);
                      }}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          cancelRenameRef.current = true;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="font-mono font-medium hover:underline"
                      title="Click to rename component"
                      onClick={e => {
                        e.stopPropagation();
                        setRenameValue(comp.reference);
                        setRenamingId(comp.id);
                      }}
                    >
                      {comp.reference}
                    </button>
                  )}
                  <span className="text-muted truncate mx-1 flex-1 text-right text-[10px]">
                    {comp.value || fp?.name || comp.footprintId}
                  </span>
                  {placedComponent?.locked && <span title="Position locked" aria-label="Position locked" className="text-[10px]">🔒</span>}
                  <span className={`text-[9px] px-1 rounded ${isPlaced ? '' : 'opacity-60'}`}
                    style={{ 
                      backgroundColor: isPlaced ? 'var(--success)' : 'var(--warning)', 
                      color: 'white' 
                    }}
                  >
                    {isPlaced ? 'PCB placed' : 'PCB needed'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function getDefaultValue(category: ComponentCategory): string {
  switch (category) {
    case 'resistor': return '10k';
    case 'capacitor': return '100nF';
    case 'polarized-capacitor': return '10uF';
    case 'led': return 'Red';
    case 'diode': return '1N4148';
    case 'transistor': return 'BC547';
    case 'mosfet': return '2N7000';
    case 'ic-dip': return '';
    case 'ic-socket': return '';
    case 'voltage-regulator': return '7805';
    case 'crystal': return '16MHz';
    default: return '';
  }
}
