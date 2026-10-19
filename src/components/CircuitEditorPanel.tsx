/**
 * Circuit panel - the netlist workspace.
 *
 * This is the source of truth for the physical build: components, their pins
 * and the nets that connect them. The status checklist is the gate for the
 * rest of the pipeline - without components there is nothing to place, route
 * or validate, and unconnected pins are called out right here.
 *
 * Wiring itself happens in the Schematic view (click pin -> pin); this panel
 * is where you inspect the netlist, name nets, unstick a pin from the wrong
 * net, rename components and import a KiCad netlist / circuit JSON.
 */

import React, { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button, Input } from './ui';
import { getFootprintById } from '../footprints/types';
import { getNetColor } from './netColors';
import { importCircuitText } from '../circuit/import';

export function CircuitEditorPanel() {
  const circuit = useAppStore(s => s.circuit);
  const addNet = useAppStore(s => s.addNet);
  const renameNet = useAppStore(s => s.renameNet);
  const removeNet = useAppStore(s => s.removeNet);
  const connectPinToNet = useAppStore(s => s.connectPinToNet);
  const disconnectPinFromNet = useAppStore(s => s.disconnectPinFromNet);
  const removeComponentFromCircuit = useAppStore(s => s.removeComponentFromCircuit);
  const importCircuit = useAppStore(s => s.importCircuit);
  const selectedNetId = useAppStore(s => s.selectedNetId);
  const selectNet = useAppStore(s => s.selectNet);
  const selectComponent = useAppStore(s => s.selectComponent);
  
  const [newNetName, setNewNetName] = useState('');
  const [expandedNetId, setExpandedNetId] = useState<string | null>(null);
  const [expandedComponentId, setExpandedComponentId] = useState<string | null>(null);
  const [renamingNetId, setRenamingNetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  
  // Track pin connection mode: user picked a net, now click a pin
  const [pendingNetId, setPendingNetId] = useState<string | null>(null);
  
  // Import state (KiCad netlist / circuit JSON)
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<{
    ok: boolean;
    message: string;
    warnings: string[];
    errors: string[];
  } | null>(null);
  
  // ===== Circuit readiness =====
  const stats = useMemo(() => {
    const totalPins = circuit.components.reduce((sum, c) => {
      const footprint = getFootprintById(c.footprintId);
      return sum + (footprint?.pins.length || 0);
    }, 0);
    const connectedPins = circuit.components.reduce((sum, c) => sum + c.pins.size, 0);
    const singlePinNets = circuit.nets.filter(n => n.pins.length < 2).length;
    return {
      components: circuit.components.length,
      nets: circuit.nets.length,
      totalPins,
      connectedPins,
      unconnectedPins: Math.max(0, totalPins - connectedPins),
      singlePinNets,
    };
  }, [circuit]);
  
  const checklist = [
    {
      label: 'Components',
      value: `${stats.components}`,
      state: stats.components > 0 ? 'ok' : 'error',
      hint: stats.components > 0 ? '' : 'add parts from the Library',
    },
    {
      label: 'Nets',
      value: `${stats.nets}`,
      state: stats.nets > 0 ? 'ok' : stats.components > 0 ? 'warn' : 'idle',
      hint: stats.nets > 0 ? '' : 'wire pins in the Schematic view',
    },
    {
      label: 'Pins in a net',
      value: stats.totalPins > 0 ? `${stats.connectedPins}/${stats.totalPins}` : '—',
      state: stats.totalPins === 0 ? 'idle' : stats.unconnectedPins === 0 ? 'ok' : 'warn',
      hint: stats.unconnectedPins === 0 ? '' : `${stats.unconnectedPins} pin${stats.unconnectedPins === 1 ? '' : 's'} not connected`,
    },
    {
      label: 'Nets with 2+ pins',
      value: stats.nets > 0 ? `${stats.nets - stats.singlePinNets}/${stats.nets}` : '—',
      state: stats.nets === 0 ? 'idle' : stats.singlePinNets === 0 ? 'ok' : 'warn',
      hint: stats.singlePinNets === 0 ? '' : `${stats.singlePinNets} net${stats.singlePinNets === 1 ? '' : 's'} with a single pin`,
    },
  ] as const;
  
  const readyForPlacement = stats.components > 0;
  
  const runImport = (text: string) => {
    if (!text.trim()) return;
    const result = importCircuitText(text);
    if (result.circuit) {
      importCircuit(result.circuit);
      setImportResult({
        ok: true,
        message: `✓ Imported ${result.circuit.components.length} component(s) and ${result.circuit.nets.length} net(s).`,
        warnings: result.warnings,
        errors: result.errors,
      });
      setImportText('');
    } else {
      setImportResult({
        ok: false,
        message: '✗ Import failed — nothing was imported.',
        warnings: result.warnings,
        errors: result.errors,
      });
    }
  };
  
  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result || ''));
    reader.readAsText(file);
  };
  
  const handleAddNet = () => {
    const name = newNetName.trim() || `NET${circuit.nets.length + 1}`;
    const id = addNet(name);
    setNewNetName('');
    setPendingNetId(id);
  };
  
  const startRename = (netId: string, currentName: string) => {
    setRenamingNetId(netId);
    setRenameDraft(currentName);
  };
  
  const commitRename = () => {
    if (renamingNetId) renameNet(renamingNetId, renameDraft);
    setRenamingNetId(null);
  };
  
  const pendingNet = pendingNetId ? circuit.nets.find(n => n.id === pendingNetId) : null;
  
  const stateColor = (state: 'ok' | 'warn' | 'error' | 'idle') =>
    state === 'ok' ? 'var(--success)'
      : state === 'warn' ? 'var(--warning)'
      : state === 'error' ? 'var(--danger)'
      : 'var(--text-muted)';
  const stateIcon = (state: 'ok' | 'warn' | 'error' | 'idle') =>
    state === 'ok' ? '✓' : state === 'warn' ? '!' : state === 'error' ? '✗' : '·';
  
  return (
    <div className="flex flex-col gap-3">
      {/* ===== Status: what the rest of the pipeline needs ===== */}
      <Panel title="Circuit Status">
        <div className="flex flex-col gap-1">
          {checklist.map(item => (
            <div key={item.label} className="flex items-center gap-2 text-[11px]">
              <span className="font-bold w-3 text-center" style={{ color: stateColor(item.state) }}>
                {stateIcon(item.state)}
              </span>
              <span className="text-muted flex-1">{item.label}</span>
              {item.hint && <span className="text-[10px] text-muted truncate max-w-28">{item.hint}</span>}
              <span className="font-mono">{item.value}</span>
            </div>
          ))}
        </div>
        
        <div className="mt-2 px-2 py-1.5 rounded text-[10px] flex items-center gap-2"
          style={{ backgroundColor: 'var(--hover-bg)' }}>
          <span className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: readyForPlacement ? 'var(--success)' : 'var(--danger)' }} />
          {readyForPlacement
            ? 'Ready to place - switch to the Place tab to build the board.'
            : 'Empty circuit: add components in the Library tab first.'}
        </div>
      </Panel>
      
      {/* ===== Components & pins ===== */}
      <Panel title={`Components (${stats.components})`}>
        {circuit.components.length === 0 ? (
          <p className="text-xs text-muted text-center py-2">
            No components yet. Add them from the Library tab.
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {circuit.components.map(comp => {
              const footprint = getFootprintById(comp.footprintId);
              const isExpanded = expandedComponentId === comp.id;
              const pinCount = footprint?.pins.length || 0;
              const unconnected = footprint ? footprint.pins.filter(p => !comp.pins.has(p.id)).length : 0;
              
              return (
                <div key={comp.id} className="border border-app rounded">
                  <div
                    className="flex items-center gap-1 px-2 py-1 cursor-pointer hover-bg"
                    onClick={() => {
                      setExpandedComponentId(isExpanded ? null : comp.id);
                      selectComponent(comp.id);
                    }}
                  >
                    <span className="font-mono text-xs font-semibold">{comp.reference}</span>
                    <span className="text-[10px] text-muted flex-1 truncate">
                      {comp.value && `${comp.value} · `}{footprint?.name || comp.footprintId}
                    </span>
                    {unconnected > 0 && (
                      <span className="text-[9px] px-1 rounded-full shrink-0"
                        style={{ backgroundColor: 'var(--warning)', color: '#000' }}
                        title={`${unconnected} pin(s) not in a net`}>
                        {unconnected}
                      </span>
                    )}
                    <span className="text-[10px] text-muted shrink-0">{pinCount}p</span>
                    <button
                      className="text-red-400 text-xs px-1 hover:text-red-300"
                      title={`Remove ${comp.reference} from the circuit`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove ${comp.reference} from circuit?`)) {
                          removeComponentFromCircuit(comp.id);
                        }
                      }}
                    >
                      ×
                    </button>
                    <span className="text-muted text-[10px]">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  
                  {isExpanded && footprint && (
                    <div className="border-t border-app px-2 py-1">
                      {footprint.pins.map(pin => {
                        const netId = comp.pins.get(pin.id);
                        const net = circuit.nets.find(n => n.id === netId);
                        
                        return (
                          <div key={pin.id} className="flex items-center gap-2 py-0.5">
                            <span className="font-mono text-[10px] w-10 shrink-0">{pin.number}</span>
                            <span className="text-[10px] text-muted flex-1 truncate">
                              {pin.name}
                              {pin.isPolarized && pin.polarity && (
                                <span className="ml-1 text-red-400">({pin.polarity})</span>
                              )}
                            </span>
                            {net ? (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full text-white cursor-pointer shrink-0"
                                style={{ backgroundColor: net.color || getNetColor(net.name) }}
                                title="Click to disconnect this pin"
                                onClick={() => disconnectPinFromNet(comp.id, pin.id)}
                              >
                                {net.name} ×
                              </span>
                            ) : pendingNet ? (
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-app hover-bg shrink-0"
                                onClick={() => connectPinToNet(comp.id, pin.id, pendingNet.id)}
                              >
                                + connect
                              </button>
                            ) : circuit.nets.length > 0 ? (
                              <select
                                className="text-[10px] px-1 py-0.5 rounded border border-app bg-app text-app max-w-24 shrink-0"
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) connectPinToNet(comp.id, pin.id, e.target.value);
                                }}
                              >
                                <option value="">+ net...</option>
                                {circuit.nets.map(n => (
                                  <option key={n.id} value={n.id}>{n.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[10px] text-muted italic">no nets</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      
      {/* ===== Nets ===== */}
      <Panel title={`Nets (${stats.nets})`}>
        <div className="flex gap-2">
          <Input
            value={newNetName}
            onChange={setNewNetName}
            placeholder="Net name (e.g., VCC, GND)"
            className="flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddNet(); }}
          />
          <Button variant="primary" size="sm" onClick={handleAddNet}>+</Button>
        </div>
        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={() => { const id = addNet('VCC', { isPower: true }); setPendingNetId(id); }}>+VCC</Button>
          <Button size="sm" onClick={() => { const id = addNet('GND', { isGround: true }); setPendingNetId(id); }}>+GND</Button>
          <Button size="sm" onClick={() => { const id = addNet('5V', { isPower: true }); setPendingNetId(id); }}>+5V</Button>
          <Button size="sm" onClick={() => { const id = addNet('3V3', { isPower: true }); setPendingNetId(id); }}>+3V3</Button>
        </div>
        
        {pendingNet && (
          <div className="mt-2 px-2 py-1 rounded text-xs flex items-center gap-2"
            style={{ backgroundColor: 'var(--selected-bg)' }}>
            <span>Connecting pins to:</span>
            <strong>{pendingNet.name}</strong>
            <span className="text-[10px] text-muted hidden sm:inline">click “+ connect” on a pin</span>
            <button className="ml-auto text-xs" onClick={() => setPendingNetId(null)}>Done</button>
          </div>
        )}
        
        {circuit.nets.length === 0 ? (
          <p className="text-xs text-muted text-center py-2 mt-1">
            No nets yet. Draw wires in the Schematic view or use the buttons above.
          </p>
        ) : (
          <div className="flex flex-col gap-1 mt-2 max-h-64 overflow-y-auto">
            {circuit.nets.map(net => {
              const isSelected = selectedNetId === net.id;
              const isExpanded = expandedNetId === net.id;
              const color = net.color || getNetColor(net.name);
              
              return (
                <div key={net.id} className={`rounded border ${isSelected ? 'border-2' : 'border-app'}`}
                  style={isSelected ? { borderColor: 'var(--accent)' } : {}}>
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover-bg"
                    onClick={() => setExpandedNetId(isExpanded ? null : net.id)}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {renamingNetId === net.id ? (
                      <input
                        autoFocus
                        className="text-xs flex-1 min-w-0 px-1 py-0.5 rounded border border-app bg-app text-app"
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingNetId(null);
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="text-xs font-medium flex-1 truncate">{net.name}</span>
                    )}
                    {net.isPower && <span className="text-[9px] px-1 rounded text-black shrink-0" style={{ backgroundColor: 'var(--warning)' }}>PWR</span>}
                    {net.isGround && <span className="text-[9px] px-1 rounded text-white shrink-0" style={{ backgroundColor: '#525252' }}>GND</span>}
                    <span className="text-[10px] text-muted shrink-0">{net.pins.length} pins</span>
                    <span className="text-muted text-[10px]">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  
                  {isExpanded && (
                    <div className="border-t border-app px-2 py-1">
                      <div className="flex flex-col gap-0.5 mb-1">
                        {net.pins.map(pin => {
                          const comp = circuit.components.find(c => c.id === pin.componentId);
                          return (
                            <div key={`${pin.componentId}-${pin.pinId}`} className="flex items-center justify-between text-[10px]">
                              <span className="font-mono">
                                {comp?.reference}.{pin.pinNumber}
                                <span className="text-muted ml-1">({pin.pinName})</span>
                              </span>
                              <button
                                className="text-red-400 hover:text-red-300 px-1"
                                title="Disconnect pin"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  disconnectPinFromNet(pin.componentId, pin.pinId);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                        {net.pins.length === 0 && (
                          <span className="text-[10px] text-muted italic">No pins connected</span>
                        )}
                      </div>
                      
                      <div className="flex gap-1 mt-1">
                        <Button
                          size="sm"
                          onClick={() => selectNet(net.id)}
                          title="Highlight this net on the board"
                        >
                          Select
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setPendingNetId(net.id)}
                          title="Then click '+ connect' on pins to add them"
                        >
                          Connect pins
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => startRename(net.id, net.name)}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            if (confirm(`Delete net "${net.name}" and all its connections?`)) {
                              removeNet(net.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      
      {/* ===== Import ===== */}
      <Panel title="Import Netlist / JSON" defaultOpen={false}>
        <p className="text-[10px] text-muted mb-2">
          Import a KiCad netlist (.net exported from Eeschema) or ZeroPCB circuit JSON.
          Importing replaces the current circuit and clears the existing layout.
        </p>
        <input
          type="file"
          accept=".json,.net,.txt"
          className="text-[10px] text-muted w-full"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="…or paste circuit JSON / KiCad netlist here"
          rows={4}
          className="mt-2 px-2 py-1 text-[11px] font-mono rounded border border-app bg-app text-app w-full resize-y"
        />
        <Button
          variant="primary"
          size="sm"
          className="w-full mt-2"
          disabled={!importText.trim()}
          onClick={() => runImport(importText)}
        >
          Import Circuit
        </Button>
        
        {importResult && (
          <div className="mt-2 flex flex-col gap-1">
            <div className={`text-[10px] px-2 py-1 rounded ${
              importResult.ok
                ? 'bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100'
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}>
              {importResult.message}
            </div>
            {importResult.errors.map((err, i) => (
              <div key={`e${i}`} className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
                {err}
              </div>
            ))}
            {importResult.warnings.map((warn, i) => (
              <div key={`w${i}`} className="text-[10px] px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {warn}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
