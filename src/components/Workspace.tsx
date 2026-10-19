/**
 * Workspace - central board area with view tabs, zoom, pan, and drag-drop editing
 */

import React, { useState, useRef, useCallback } from 'react';
import { useAppStore } from '../app/store';
import { BoardCanvas } from './BoardCanvas';
import { SchematicCanvas } from './SchematicCanvas';
import { Coordinate, coordToLabel } from '../board/types';
import { Button } from './ui';
import { useCursorZoom } from './useCursorZoom';

/** Preset drawing areas for the schematic editor (grid units) */
const SCHEMATIC_CANVAS_PRESETS = [
  { w: 60, h: 40, label: 'S · 60×40' },
  { w: 90, h: 60, label: 'M · 90×60' },
  { w: 130, h: 85, label: 'L · 130×85' },
  { w: 180, h: 115, label: 'XL · 180×115' },
];

export function Workspace() {
  const board = useAppStore(s => s.board);
  const components = useAppStore(s => s.placedComponents);
  const routes = useAppStore(s => s.routes);
  const nets = useAppStore(s => s.circuit.nets);
  const activeSide = useAppStore(s => s.activeSide);
  const setActiveSide = useAppStore(s => s.setActiveSide);
  const showRoutes = useAppStore(s => s.showRoutes);
  const toggleShowRoutes = useAppStore(s => s.toggleShowRoutes);
  const showHoles = useAppStore(s => s.showHoles);
  const toggleShowHoles = useAppStore(s => s.toggleShowHoles);
  const selectedComponentIds = useAppStore(s => s.selectedComponentIds);
  const selectedNetId = useAppStore(s => s.selectedNetId);
  const highlightedCoordinates = useAppStore(s => s.highlightedCoordinates);
  const selectComponent = useAppStore(s => s.selectComponent);
  const clearHighlights = useAppStore(s => s.clearHighlights);
  const placeComponent = useAppStore(s => s.placeComponent);
  const zoom = useAppStore(s => s.zoom);
  const setZoom = useAppStore(s => s.setZoom);
  const panOffset = useAppStore(s => s.panOffset);
  const setPanOffset = useAppStore(s => s.setPanOffset);
  const workspaceView = useAppStore(s => s.workspaceView);
  const setWorkspaceView = useAppStore(s => s.setWorkspaceView);
  const schematicZoom = useAppStore(s => s.schematicZoom);
  const setSchematicZoom = useAppStore(s => s.setSchematicZoom);
  const autoArrangeSchematic = useAppStore(s => s.autoArrangeSchematic);
  const schematicCanvasSize = useAppStore(s => s.schematicCanvasSize);
  const setSchematicCanvasSize = useAppStore(s => s.setSchematicCanvasSize);
  const focusMode = useAppStore(s => s.focusMode);
  const setFocusMode = useAppStore(s => s.setFocusMode);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef<{ moved: boolean } | null>(null);
  // Swallow the click that trails a pan so panning never changes a selection
  const suppressClickRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // "Ready to build" welcome card - dismissible, comes back on reload
  const [showWelcome, setShowWelcome] = useState(true);
  
  // Track context menu state for track cuts
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    coord: Coordinate;
  } | null>(null);
  
  const handleHoleClick = useCallback(() => {
    clearHighlights();
  }, [clearHighlights]);
  
  const handleHoleContextMenu = useCallback((coord: Coordinate, event: React.MouseEvent) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      coord,
    });
  }, []);
  
  const handleComponentClick = useCallback((componentId: string, event: React.MouseEvent) => {
    selectComponent(componentId, event.shiftKey);
  }, [selectComponent]);
  
  const handleComponentDrop = useCallback((componentId: string, newPosition: Coordinate) => {
    const comp = components.find(c => c.id === componentId);
    if (!comp) return;
    
    const result = placeComponent(componentId, newPosition, comp.orientation);
    
    if (!result.success) {
      setErrorMessage(result.error || 'Cannot place component here');
      setTimeout(() => setErrorMessage(null), 2500);
    } else if (comp.locked) {
      // Preserve lock state after move
      useAppStore.getState().lockComponent(componentId, true);
    }
  }, [components, placeComponent]);
  
  // Left-drag on the empty area pans the board (components keep their own
  // drag); middle mouse pans as well, like every EDA tool.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    if (e.button === 0 && e.target instanceof Element && e.target.closest('.component-group')) return;
    panDragRef.current = { moved: false };
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = panDragRef.current;
    if (!drag) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    if (!drag.moved) {
      drag.moved = true;
      setIsPanning(true);
    }
    panStartRef.current = { x: e.clientX, y: e.clientY };
    setPanOffset({ x: panOffset.x + dx, y: panOffset.y + dy });
  }, [panOffset, setPanOffset]);

  const handleMouseUp = useCallback(() => {
    const drag = panDragRef.current;
    panDragRef.current = null;
    if (!drag?.moved) return;
    setIsPanning(false);
    suppressClickRef.current = true;
    // Release the suppression after the trailing click has been dispatched
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.stopPropagation();
  }, []);
  
  // Cursor-anchored wheel zoom + pinch/touch gestures (see useCursorZoom)
  const scrollRef = useRef<HTMLDivElement>(null);
  useCursorZoom(scrollRef, zoom, setZoom, {
    min: 0.25,
    max: 4,
    getPan: () => panOffset,
  });
  
  const componentSVG = (
    <BoardCanvas
      board={board}
      components={components}
      routes={routes}
      nets={nets}
      side="component"
      selectedComponentIds={selectedComponentIds}
      selectedNetId={selectedNetId}
      highlightedCoordinates={highlightedCoordinates}
      showRoutes={showRoutes}
      showHoles={showHoles}
      zoom={zoom}
      onHoleClick={handleHoleClick}
      onHoleContextMenu={handleHoleContextMenu}
      onComponentClick={handleComponentClick}
      onComponentDrop={handleComponentDrop}
      onBackgroundClick={clearHighlights}
    />
  );
  
  const solderSVG = (
    <BoardCanvas
      board={board}
      components={components}
      routes={routes}
      nets={nets}
      side="solder"
      selectedComponentIds={selectedComponentIds}
      selectedNetId={selectedNetId}
      highlightedCoordinates={highlightedCoordinates}
      showRoutes={showRoutes}
      showHoles={showHoles}
      zoom={zoom}
      onHoleClick={handleHoleClick}
      onHoleContextMenu={handleHoleContextMenu}
      onBackgroundClick={clearHighlights}
    />
  );

  return (
    <div className="flex flex-col h-full relative select-none" ref={containerRef}>
      {/* View controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-app bg-panel flex-wrap">
        {/* Editor switch: Schematic (circuit capture) / Board (physical build) */}
        <div className="flex rounded-lg border border-app overflow-hidden">
          <button
            className={`px-3 py-1.5 text-xs font-medium ${workspaceView === 'schematic' ? '' : 'hover-bg text-app'}`}
            style={workspaceView === 'schematic' ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
            onClick={() => setWorkspaceView('schematic')}
            title="Draw and wire the circuit (EasyEDA-style schematic)"
          >
            ⚡ Schematic
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium ${workspaceView === 'board' ? '' : 'hover-bg text-app'}`}
            style={workspaceView === 'board' ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
            onClick={() => setWorkspaceView('board')}
            title="View the physical board layout"
          >
            ▦ Board
          </button>
        </div>
        
        <div className="w-px h-5" style={{ backgroundColor: 'var(--border)' }} />
        
        {workspaceView === 'board' ? (
          <>
            <div className="flex rounded-lg border border-app overflow-hidden">
              <button
                className={`px-2.5 py-1.5 text-xs ${activeSide === 'component' ? '' : 'hover-bg text-app'}`}
                style={activeSide === 'component' ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
                onClick={() => setActiveSide('component')}
              >
                Component Side
              </button>
              <button
                className={`px-2.5 py-1.5 text-xs ${activeSide === 'solder' ? '' : 'hover-bg text-app'}`}
                style={activeSide === 'solder' ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
                onClick={() => setActiveSide('solder')}
              >
                Solder Side
              </button>
              <button
                className={`px-2.5 py-1.5 text-xs ${activeSide === 'both' ? '' : 'hover-bg text-app'}`}
                style={activeSide === 'both' ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
                onClick={() => setActiveSide('both')}
              >
                Side by Side
              </button>
            </div>
            
            <button
              className={`px-2.5 py-1.5 text-xs rounded-lg border border-app ${showRoutes ? '' : 'hover-bg text-app'}`}
              style={showRoutes ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
              onClick={toggleShowRoutes}
              title="Toggle wire overlay"
            >
              {showRoutes ? '◉' : '○'} Wires
            </button>
            
            <button
              className={`px-2.5 py-1.5 text-xs rounded-lg border border-app ${showHoles ? '' : 'hover-bg text-app'}`}
              style={showHoles ? { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
              onClick={toggleShowHoles}
              title="Show or hide the pad / hole grid (view only - exports keep the holes)"
            >
              {showHoles ? '◉' : '○'} Holes
            </button>
          </>
        ) : (
          <>
            <button
              className="px-2.5 py-1.5 text-xs rounded-lg border border-app hover-bg text-app"
              onClick={autoArrangeSchematic}
              title="Re-flow all symbols into a tidy grid"
            >
              ⤢ Auto arrange
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Size of the schematic drawing area">
              Canvas
              <select
                data-testid="schematic-canvas-size"
                title="Size of the schematic drawing area"
                className="text-[11px] px-1.5 py-1 rounded-lg border border-app bg-panel text-app"
                value={`${schematicCanvasSize.w}x${schematicCanvasSize.h}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  if (!Number.isNaN(w) && !Number.isNaN(h)) setSchematicCanvasSize({ w, h });
                }}
              >
                {SCHEMATIC_CANVAS_PRESETS.map(p => (
                  <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>
                ))}
                {!SCHEMATIC_CANVAS_PRESETS.some(p => p.w === schematicCanvasSize.w && p.h === schematicCanvasSize.h) && (
                  <option value={`${schematicCanvasSize.w}x${schematicCanvasSize.h}`}>
                    Custom {schematicCanvasSize.w}×{schematicCanvasSize.h}
                  </option>
                )}
              </select>
            </label>
            <span className="text-[11px] text-muted hidden xl:inline">
              {nets.length} net{nets.length === 1 ? '' : 's'} · {components.length}/{useAppStore.getState().circuit.components.length} placed
            </span>
          </>
        )}
        
        <div className="flex-1" />
        
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={() => setFocusMode(!focusMode)}
            title={focusMode ? 'Show the side panels again' : 'Hide the side panels so the canvas fills the window'}
          >
            {focusMode ? '⛶ Show panels' : '⛶ Expand'}
          </Button>
          <Button size="sm" onClick={() => (workspaceView === 'board' ? setZoom(zoom * 0.85) : setSchematicZoom(schematicZoom * 0.85))} title="Zoom out">−</Button>
          <span className="text-xs text-muted font-mono w-12 text-center">
            {Math.round((workspaceView === 'board' ? zoom : schematicZoom) * 100)}%
          </span>
          <Button size="sm" onClick={() => (workspaceView === 'board' ? setZoom(zoom * 1.15) : setSchematicZoom(schematicZoom * 1.15))} title="Zoom in">+</Button>
          <Button size="sm" onClick={() => { if (workspaceView === 'board') { setZoom(1); setPanOffset({ x: 0, y: 0 }); } else { setSchematicZoom(1); } }} title="Reset zoom">⤢ Fit</Button>
        </div>
      </div>
      
      {/* Status messages */}
      {errorMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded shadow-lg text-xs text-white"
          style={{ backgroundColor: 'var(--danger)' }}>
          {errorMessage}
        </div>
      )}
      
      {showWelcome && components.length === 0 && workspaceView === 'board' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="relative px-6 py-5 pt-4 rounded-2xl shadow-xl bg-panel border border-app max-w-xs text-center">
            <button
              type="button"
              onClick={() => setShowWelcome(false)}
              title="Dismiss this card"
              aria-label="Dismiss"
              className="pointer-events-auto absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full text-muted hover-bg text-xs leading-none"
            >
              ✕
            </button>
            <img src="/favicon.svg" alt="" className="w-9 h-9 mx-auto mb-2 rounded-lg" />
            <h3 className="font-semibold text-sm mb-1.5">Ready to build</h3>
            <p className="text-xs text-muted leading-relaxed">
              1. Add components from the Library<br />
              2. Wire them in the <span className="font-semibold" style={{ color: 'var(--accent)' }}>Schematic</span> view<br />
              3. Run auto-placement, then route<br />
              4. Export the soldering plan
            </p>
          </div>
        </div>
      )}
      
      {/* Board / schematic area */}
      {workspaceView === 'schematic' ? (
        <div className="flex-1 overflow-hidden min-h-0">
          <SchematicCanvas />
        </div>
      ) : (
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-app-grid"
        style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClickCapture={handleClickCapture}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="p-4 flex gap-6"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: 'top left',
            width: 'fit-content',
          }}
        >
          {(activeSide === 'component' || activeSide === 'both') && (
            <div data-testid="canvas-component-side">
              <div className="text-[10px] font-semibold text-muted mb-1 uppercase tracking-wide">
                Component side (top view)
              </div>
              {componentSVG}
            </div>
          )}
          {(activeSide === 'solder' || activeSide === 'both') && (
            <div data-testid="canvas-solder-side">
              <div className="text-[10px] font-semibold text-muted mb-1 uppercase tracking-wide">
                Solder side (mirrored view)
              </div>
              {solderSVG}
            </div>
          )}
        </div>
      </div>
      )}
      
      {/* Context menu for hole operations */}
      {contextMenu && (
        <HoleContextMenu
          coord={contextMenu.coord}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ============ HOLE CONTEXT MENU ============

function HoleContextMenu({
  coord,
  x,
  y,
  onClose,
}: {
  coord: Coordinate;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const board = useAppStore(s => s.board);
  const boardConfig = useAppStore(s => s.boardConfig);
  const toggleTrackCut = useAppStore(s => s.toggleTrackCut);
  
  const pad = board.pads.get(`${coord.row},${coord.col}`);
  const label = coordToLabel(coord);
  
  const handleToggleTrackCut = () => {
    toggleTrackCut(coord);
    onClose();
  };
  
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="fixed z-40 bg-panel border border-app rounded shadow-lg py-1 min-w-40"
        style={{ left: x, top: y }}
      >
        <div className="px-3 py-1 text-[10px] text-muted border-b border-app">
          Hole {label} (row {coord.row}, col {coord.col})
        </div>
        {boardConfig.type === 'stripboard' && (
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover-bg"
            onClick={handleToggleTrackCut}
          >
            {pad?.isTrackCut ? '↩ Remove track cut' : '✂ Cut track here'}
          </button>
        )}
        {pad?.isMountingHole && (
          <div className="px-3 py-1.5 text-xs text-muted">Mounting hole</div>
        )}
        <button
          className="w-full text-left px-3 py-1.5 text-xs hover-bg"
          onClick={() => {
            navigator.clipboard?.writeText(label);
            onClose();
          }}
        >
          📋 Copy coordinate label
        </button>
      </div>
    </>
  );
}