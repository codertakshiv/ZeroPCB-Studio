/**
 * ZeroPCB Studio - main application shell
 */

import React, { useEffect, useState } from 'react';
import { BookOpen, CircuitBoard, Download, FolderKanban, Move, Route as RouteIcon, ShieldCheck } from 'lucide-react';
import { useAppStore } from './store';
import { useProjectPersistence } from './useProjectPersistence';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { Workspace } from '../components/Workspace';
import { TopToolbar } from '../components/TopToolbar';
import { registerAllStandardFootprints } from '../footprints/library';
import type { WorkspaceStage } from './stages';
import { coordToLabel } from '../board/types';

const STAGES: { id: WorkspaceStage; label: string; fullName: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'project', label: 'Project', fullName: 'Project and board setup', icon: FolderKanban },
  { id: 'circuit', label: 'Circuit', fullName: 'Circuit and connectivity', icon: CircuitBoard },
  { id: 'placement', label: 'Place', fullName: 'Component placement', icon: Move },
  { id: 'routing', label: 'Route', fullName: 'Board routing', icon: RouteIcon },
  { id: 'validation', label: 'Check', fullName: 'Electrical validation', icon: ShieldCheck },
  { id: 'assembly', label: 'Build', fullName: 'Assembly guide', icon: BookOpen },
  { id: 'export', label: 'Export', fullName: 'Export project and files', icon: Download },
];

// Register all standard footprints once at app start
registerAllStandardFootprints();

export function App() {
  const theme = useAppStore(s => s.theme);
  const focusMode = useAppStore(s => s.focusMode);
  const setWorkspaceView = useAppStore(s => s.setWorkspaceView);
  const [activeStage, setActiveStage] = useState<WorkspaceStage>('project');
  const [mobilePanel, setMobilePanel] = useState<'inputs' | 'tools' | null>(null);
  const selectStage = (stage: WorkspaceStage) => {
    setActiveStage(stage);
    setWorkspaceView(stage === 'circuit' ? 'schematic' : 'board');
    setMobilePanel(null);
  };
  
  // Restore the last local project on boot and autosave every change
  useProjectPersistence();
  
  // Apply theme class to document root
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return;
      }
      
      const state = useAppStore.getState();
      const selected = Array.from(state.selectedComponentIds);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected.length > 0) {
        e.preventDefault();
        state.duplicateComponents(selected);
        return;
      }
      
      // Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          state.redo();
        } else {
          state.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
        return;
      }
      
      // R: rotate selected component
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && selected.length > 0) {
        state.rotateComponent(selected[0], e.shiftKey ? 'ccw' : 'cw');
        return;
      }
      
      // L: toggle lock
      if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && selected.length > 0) {
        for (const id of selected) {
          const comp = state.placedComponents.find(c => c.id === id);
          if (comp) state.lockComponent(id, !comp.locked);
        }
        return;
      }
      
      // Delete/Backspace: remove from board
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
        e.preventDefault();
        for (const id of selected) {
          state.unplaceComponent(id);
        }
        return;
      }
      
      // Escape: clear selection
      if (e.key === 'Escape') {
        state.clearHighlights();
        return;
      }
      
      // F: fit view
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        state.setZoom(1);
        state.setPanOffset({ x: 0, y: 0 });
        return;
      }
      
      // +/-: zoom
      if (e.key === '+' || e.key === '=') {
        state.setZoom(state.zoom * 1.15);
        return;
      }
      if (e.key === '-') {
        state.setZoom(state.zoom * 0.85);
        return;
      }
    };
    
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  
  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useAppStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-app text-app">
      <TopToolbar />

      {!focusMode && (
        <nav aria-label="Design workflow" className="stage-navigation flex items-center gap-1 px-3 py-1.5 border-b border-app bg-panel overflow-x-auto">
          {STAGES.map(stage => {
            const Icon = stage.icon;
            const active = activeStage === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                aria-current={active ? 'step' : undefined}
                title={stage.fullName}
                onClick={() => selectStage(stage.id)}
                className={`stage-tab flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs ${active ? 'stage-tab-active' : 'text-muted hover-bg'}`}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{stage.label}</span>
              </button>
            );
          })}
          <span className="ml-auto hidden xl:block text-[10px] text-muted whitespace-nowrap pr-2">
            Circuit → Place → Route → Check → Build
          </span>
          <button type="button" className="mobile-panel-toggle" onClick={() => setMobilePanel(current => current === 'inputs' ? null : 'inputs')}>Inputs</button>
          <button type="button" className="mobile-panel-toggle" onClick={() => setMobilePanel(current => current === 'tools' ? null : 'tools')}>Tools</button>
        </nav>
      )}
      
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Left sidebar (hidden in focus mode) */}
        <aside className={`app-sidebar app-sidebar-left w-72 shrink-0 border-r border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden md:flex'} ${mobilePanel === 'inputs' ? 'mobile-visible' : ''}`}>
          <LeftPanel activeStage={activeStage} onStageChange={selectStage} />
        </aside>
        
        {/* Center workspace */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Workspace />
        </main>
        
        {/* Right sidebar (hidden in focus mode) */}
        <aside className={`app-sidebar app-sidebar-right w-80 shrink-0 border-l border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden lg:flex'} ${mobilePanel === 'tools' ? 'mobile-visible' : ''}`}>
          <RightPanel activeStage={activeStage} />
        </aside>
      </div>
      
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const boardConfig = useAppStore(s => s.boardConfig);
  const placedComponents = useAppStore(s => s.placedComponents);
  const circuit = useAppStore(s => s.circuit);
  const routes = useAppStore(s => s.routes);
  const isOptimizing = useAppStore(s => s.isOptimizing);
  const optimizationStatus = useAppStore(s => s.optimizationStatus);
  const validationResult = useAppStore(s => s.validationResult);
  const routingResult = useAppStore(s => s.routingResult);
  const placementProposal = useAppStore(s => s.placementProposal);
  const selectedComponentIds = useAppStore(s => s.selectedComponentIds);
  const selected = placedComponents.filter(component => selectedComponentIds.has(component.id));
  
  return (
    <footer className="flex items-center gap-3 px-4 py-1.5 border-t border-app bg-panel text-[10px] text-muted font-mono">
      <span>{boardConfig.name}</span>
      <span className="opacity-40">|</span>
      <span>
        {boardConfig.dimensions.rows}×{boardConfig.dimensions.cols} @ {boardConfig.dimensions.holePitchMm}mm
      </span>
      <span className="opacity-40">|</span>
      <span>{placedComponents.length}/{circuit.components.length} placed</span>
      <span className="opacity-40">|</span>
      <span>{circuit.nets.length} nets · {routes.length} routes</span>
      
      {selected.length === 1 && (
        <>
          <span className="opacity-40">|</span>
          <span>{selected[0].reference} @ {coordToLabel(selected[0].position)}{selected[0].locked ? ' · locked' : ''}</span>
        </>
      )}

      {routingResult && (
        <>
          <span className="opacity-40">|</span>
          <span style={{ color: routingResult.unroutedNets.length ? 'var(--danger)' : 'var(--success)' }}>
            {routingResult.unroutedNets.length ? `${routingResult.unroutedNets.length} unrouted` : 'Routing complete'}
          </span>
        </>
      )}

      {placementProposal && <span className="text-amber-500">Placement review pending</span>}

      {validationResult && (
        <>
          <span className="opacity-40">|</span>
          <span style={{ color: validationResult.isValid ? 'var(--success)' : 'var(--danger)' }}>
            {validationResult.isValid ? '✓ Valid' : `✗ ${validationResult.issues.filter(i => i.severity === 'error').length} errors`}
          </span>
        </>
      )}
      
      <span className="flex-1" />
      
      {(isOptimizing || optimizationStatus) && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
          {optimizationStatus}
        </span>
      )}
    </footer>
  );
}
