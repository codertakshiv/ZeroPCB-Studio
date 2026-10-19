/**
 * Left sidebar - Board setup and Circuit editing
 */

import React, { useMemo } from 'react';
import type { WorkspaceStage } from '../app/stages';
import { useAppStore } from '../app/store';
import { BoardSetupPanel } from './BoardSetupPanel';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import { CircuitEditorPanel } from './CircuitEditorPanel';
import { getFootprintById } from '../footprints/types';

type LeftTab = 'board' | 'components' | 'circuit';

export function LeftPanel({ activeStage, onStageChange }: { activeStage: WorkspaceStage; onStageChange: (stage: WorkspaceStage) => void }) {
  const activeTab: LeftTab = activeStage === 'circuit' ? 'circuit' : activeStage === 'placement' ? 'components' : 'board';
  const circuit = useAppStore(s => s.circuit);
  const placedComponents = useAppStore(s => s.placedComponents);
  
  const unplacedCount = circuit.components.length - placedComponents.length;
  
  // Pins that are not part of any net — the Circuit tab is where they show up
  const unconnectedCount = useMemo(() => circuit.components.reduce((sum, comp) => {
    const footprint = getFootprintById(comp.footprintId);
    if (!footprint) return sum;
    return sum + footprint.pins.filter(p => !comp.pins.has(p.id)).length;
  }, 0), [circuit.components]);
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-app bg-panel">
        <button
          className={`flex-1 px-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'board' ? 'text-app' : 'text-muted border-transparent hover-bg'}`}
          style={activeTab === 'board' ? { borderBottomColor: 'var(--accent)' } : {}}
          onClick={() => onStageChange('project')}
        >
          Board
        </button>
        <button
          className={`flex-1 px-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'components' ? 'text-app' : 'text-muted border-transparent hover-bg'}`}
          style={activeTab === 'components' ? { borderBottomColor: 'var(--accent)' } : {}}
          onClick={() => onStageChange('placement')}
        >
          Library
          {unplacedCount > 0 && (
            <span className="ml-1 px-1 rounded-full text-[8px] text-white" style={{ backgroundColor: 'var(--warning)' }}>
              {unplacedCount}
            </span>
          )}
        </button>
        <button
          className={`flex-1 px-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'circuit' ? 'text-app' : 'text-muted border-transparent hover-bg'}`}
          style={activeTab === 'circuit' ? { borderBottomColor: 'var(--accent)' } : {}}
          onClick={() => onStageChange('circuit')}
        >
          Circuit
          {unconnectedCount > 0 && (
            <span className="ml-1 px-1 rounded-full text-[8px] text-black" style={{ backgroundColor: 'var(--warning)' }}
              title={`${unconnectedCount} pin(s) not connected to a net`}>
              {unconnectedCount}
            </span>
          )}
          {circuit.nets.length > 0 && (
            <span className="ml-1 px-1 rounded-full text-[8px]" style={{ backgroundColor: 'var(--hover-bg)' }}>
              {circuit.nets.length}
            </span>
          )}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'board' && <BoardSetupPanel />}
        {activeTab === 'components' && <ComponentLibraryPanel />}
        {activeTab === 'circuit' && <CircuitEditorPanel />}
      </div>
    </div>
  );
}
