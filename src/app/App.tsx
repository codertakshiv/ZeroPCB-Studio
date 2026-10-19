/**
 * ZeroPCB Studio - main application shell
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { useProjectPersistence } from './useProjectPersistence';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { Workspace } from '../components/Workspace';
import { TopToolbar } from '../components/TopToolbar';
import { registerAllStandardFootprints } from '../footprints/library';
import type { WorkspaceStage } from './stages';


// Register all standard footprints once at app start
registerAllStandardFootprints();

export function App() {
  const theme = useAppStore(s => s.theme);
  const focusMode = useAppStore(s => s.focusMode);
  const setWorkspaceView = useAppStore(s => s.setWorkspaceView);
  const [activeStage, setActiveStage] = useState<WorkspaceStage>('placement');
  const [mobilePanel, setMobilePanel] = useState<'inputs' | 'tools' | null>(null);
  const selectStage = (stage: WorkspaceStage) => {
    setActiveStage(stage);
    setWorkspaceView(stage === 'circuit' ? 'schematic' : 'board');
    setMobilePanel(null);
  };
  const runPlacement = useAppStore(s => s.runPlacement);
  const runRouting = useAppStore(s => s.runRouting);
  const validate = useAppStore(s => s.validate);
  const placeAll = () => { setActiveStage('placement'); setWorkspaceView('board'); void runPlacement(); };
  const routeAll = () => { setActiveStage('routing'); setWorkspaceView('board'); void runRouting(); };
  const checkBoard = () => { setActiveStage('validation'); setWorkspaceView('board'); validate(); };
  
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
        setMobilePanel(null);
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
      <TopToolbar onRunPlacement={placeAll} onRunRouting={routeAll} onCheck={checkBoard} onOpenStage={selectStage}
        onToggleInputs={() => setMobilePanel(current => current === 'inputs' ? null : 'inputs')}
        onToggleInspector={() => setMobilePanel(current => current === 'tools' ? null : 'tools')} />

      
      <div className="flex flex-1 overflow-hidden gap-0 relative min-h-0">
        {mobilePanel && <button className="drawer-backdrop" aria-label="Close panel" onClick={() => setMobilePanel(null)} />}
        {/* Left sidebar (hidden in focus mode) */}
        <aside className={`app-sidebar app-sidebar-left w-64 shrink-0 border-r border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden xl:flex'} ${mobilePanel === 'inputs' ? 'mobile-visible' : ''}`}>
          <LeftPanel activeStage={activeStage} onStageChange={selectStage} />
        </aside>
        
        {/* Center workspace */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Workspace />
        </main>
        
        {/* Right sidebar (hidden in focus mode) */}
        <aside className={`app-sidebar app-sidebar-right w-72 shrink-0 border-l border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden xl:flex'} ${mobilePanel === 'tools' ? 'mobile-visible' : ''}`}>
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
  const routingResult = useAppStore(s => s.routingResult);
  const placementResult = useAppStore(s => s.placementResult);

  return (
    <footer className="flex items-center gap-3 px-3 py-1 border-t border-app bg-panel text-[10px] text-muted font-mono overflow-x-auto whitespace-nowrap">
      <span>{boardConfig.dimensions.rows}×{boardConfig.dimensions.cols} @ {boardConfig.dimensions.holePitchMm}mm</span>
      <span>{placedComponents.length}/{circuit.components.length} placed</span>
      <span>{routes.length} routes</span>
      <span style={{ color: routingResult?.unroutedNets.length ? 'var(--danger)' : undefined }}>{routingResult?.unroutedNets.length ?? '—'} unrouted</span>
      <span>{routingResult?.stats.jumperCount ?? 0} jumpers</span>
      <span style={{ color: placementResult?.errors.length ? 'var(--danger)' : undefined }}>{placementResult?.errors.length ?? 0} placement issues</span>
    </footer>
  );
}
