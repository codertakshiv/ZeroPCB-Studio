/**
 * ZeroPCB Studio - main application shell
 */

import React, { useEffect } from 'react';
import { useAppStore } from './store';
import { useProjectPersistence } from './useProjectPersistence';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { Workspace } from '../components/Workspace';
import { TopToolbar } from '../components/TopToolbar';
import { registerAllStandardFootprints } from '../footprints/library';

// Register all standard footprints once at app start
registerAllStandardFootprints();

export function App() {
  const theme = useAppStore(s => s.theme);
  const focusMode = useAppStore(s => s.focusMode);
  
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
      
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Left sidebar (hidden in focus mode) */}
        <aside className={`w-72 shrink-0 border-r border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden md:flex'}`}>
          <LeftPanel />
        </aside>
        
        {/* Center workspace */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Workspace />
        </main>
        
        {/* Right sidebar (hidden in focus mode) */}
        <aside className={`w-80 shrink-0 border-l border-app bg-panel overflow-hidden flex-col ${focusMode ? 'hidden' : 'hidden lg:flex'}`}>
          <RightPanel />
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
      
      {validationResult && (
        <>
          <span className="opacity-40">|</span>
          <span style={{ color: validationResult.isValid ? 'var(--success)' : 'var(--danger)' }}>
            {validationResult.isValid ? '✓ Valid' : `✗ ${validationResult.issues.filter(i => i.severity === 'error').length} errors`}
          </span>
        </>
      )}
      
      <span className="flex-1" />
      
      {isOptimizing && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
          {optimizationStatus}
        </span>
      )}
    </footer>
  );
}