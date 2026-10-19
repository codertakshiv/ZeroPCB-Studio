/**
 * BoardCanvas - SVG renderer for the PCB board
 * 
 * Renders component side and/or solder side with correct mirroring,
 * components, routes, highlights, and interactive elements.
 */

import React, { useMemo, useCallback, useRef, useState } from 'react';
import { BoardState, BoardConfig, Coordinate, coordToLabel } from '../board/types';
import { 
  BoardSide, 
  coordinateToPixel, 
  pixelToCoordinate, 
  boardPixelSize,
} from '../board/transforms';
import { PlacedComponent } from '../footprints/types';
import { Route } from '../routing/types';
import { Net } from '../circuit/types';
import { getPcbPalette, PcbPalette } from '../board/appearance';
import { getNetColor } from './netColors';

const PX_PER_MM = 5;

export interface BoardCanvasProps {
  board: BoardState;
  components: PlacedComponent[];
  /** Ghosted target positions shown while the user reviews an optimization. */
  proposalComponents?: PlacedComponent[];
  routes: Route[];
  nets: Net[];
  side: BoardSide;
  selectedComponentIds: Set<string>;
  selectedNetId: string | null;
  highlightedCoordinates: Set<string>;
  showRoutes: boolean;
  /** Show the pad / hole grid (view option; exports keep holes too) */
  showHoles?: boolean;
  showLabels?: boolean;
  /** Current canvas zoom - ruler label density adapts to it */
  zoom?: number;
  interactive?: boolean;
  onHoleClick?: (coord: Coordinate, event: React.MouseEvent) => void;
  onHoleContextMenu?: (coord: Coordinate, event: React.MouseEvent) => void;
  onComponentClick?: (componentId: string, event: React.MouseEvent) => void;
  onComponentDrop?: (componentId: string, dropCoord: Coordinate) => void;
  onBackgroundClick?: () => void;
  className?: string;
}

export function BoardCanvas({
  board,
  components,
  proposalComponents = [],
  routes,
  nets,
  side,
  selectedComponentIds,
  selectedNetId,
  highlightedCoordinates,
  showRoutes,
  showHoles = true,
  showLabels = true,
  zoom = 1,
  interactive = true,
  onHoleClick,
  onHoleContextMenu,
  onComponentClick,
  onComponentDrop,
  onBackgroundClick,
  className,
}: BoardCanvasProps) {
  const config = board.config;
  const { rows, cols, holePitchMm, marginLeftMm, marginTopMm } = config.dimensions;
  
  const boardSize = boardPixelSize(config, PX_PER_MM);
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Drag state
  const [drag, setDrag] = useState<{
    componentId: string;
    pinOffset: { row: number; col: number };
    hoverCoord: Coordinate | null;
  } | null>(null);
  
  // Ruler space: extra room for labels
  const rulerSize = 18;
  const totalWidth = boardSize.width + rulerSize * 2;
  const totalHeight = boardSize.height + rulerSize * 2;
  
  const toPixel = useCallback((coord: Coordinate) => {
    const p = coordinateToPixel(coord, config, side, PX_PER_MM);
    return { x: p.x + rulerSize, y: p.y + rulerSize };
  }, [config, side, rulerSize]);
  
  const screenToCoord = useCallback((clientX: number, clientY: number): Coordinate | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    
    const svgPoint = point.matrixTransform(ctm.inverse());
    const boardX = svgPoint.x - rulerSize;
    const boardY = svgPoint.y - rulerSize;
    
    return pixelToCoordinate(boardX, boardY, config, side, PX_PER_MM);
  }, [config, side, rulerSize]);
  
  const handleSvgClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const coord = screenToCoord(event.clientX, event.clientY);
    if (coord) {
      onHoleClick?.(coord, event);
    } else {
      onBackgroundClick?.();
    }
  }, [interactive, screenToCoord, onHoleClick, onBackgroundClick]);
  
  const handleContextMenu = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (!interactive) return;
    const coord = screenToCoord(event.clientX, event.clientY);
    if (coord) {
      onHoleContextMenu?.(coord, event);
    }
  }, [interactive, screenToCoord, onHoleContextMenu]);
  
  // Drag handling with pointer events
  const handlePinPointerDown = useCallback((
    componentId: string,
    pinId: string,
    event: React.PointerEvent
  ) => {
    if (!interactive || side !== 'component') return;
    
    const comp = components.find(c => c.id === componentId);
    if (!comp) return;
    
    const pinCoord = comp.pinPositions.get(pinId);
    if (!pinCoord) return;
    
    event.stopPropagation();
    event.preventDefault();
    
    if (comp.locked) {
      onComponentClick?.(componentId, event as unknown as React.MouseEvent);
      return;
    }
    
    (event.target as Element).setPointerCapture?.(event.pointerId);
    
    setDrag({
      componentId,
      pinOffset: {
        row: pinCoord.row - comp.position.row,
        col: pinCoord.col - comp.position.col,
      },
      hoverCoord: pinCoord,
    });
  }, [interactive, side, components, onComponentClick]);
  
  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    
    const coord = screenToCoord(event.clientX, event.clientY);
    if (coord && (!drag.hoverCoord || coord.row !== drag.hoverCoord.row || coord.col !== drag.hoverCoord.col)) {
      setDrag({ ...drag, hoverCoord: coord });
    }
  }, [drag, screenToCoord]);
  
  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    
    const coord = screenToCoord(event.clientX, event.clientY);
    const dragSnapshot = drag;
    setDrag(null);
    
    if (!coord) return;
    
    // Compute new component top-left position so that the grabbed pin lands on coord
    const newPosition = {
      row: coord.row - dragSnapshot.pinOffset.row,
      col: coord.col - dragSnapshot.pinOffset.col,
    };
    
    onComponentDrop?.(dragSnapshot.componentId, newPosition);
  }, [drag, screenToCoord, onComponentDrop]);
  
  // Rows/columns that contain a highlighted hole light up the ruler, so the
  // spreadsheet labels show where a selected net actually runs.
  const highlightedRows = useMemo(() => {
    const rowsWithHighlight = new Set<number>();
    for (const key of highlightedCoordinates) {
      const r = Number(key.split(',')[0]);
      if (!Number.isNaN(r)) rowsWithHighlight.add(r);
    }
    return rowsWithHighlight;
  }, [highlightedCoordinates]);
  
  const highlightedCols = useMemo(() => {
    const colsWithHighlight = new Set<number>();
    for (const key of highlightedCoordinates) {
      const c = Number(key.split(',')[1]);
      if (!Number.isNaN(c)) colsWithHighlight.add(c);
    }
    return colsWithHighlight;
  }, [highlightedCoordinates]);
  
  // Ruler labels adapt to the zoom level: at low zoom only every Nth hole gets
  // a label so numbers never collide into a smeared "10111213..." row.
  const pitchPx = holePitchMm * PX_PER_MM * zoom;
  const labelStep = useMemo(() => {
    const minSpacing = 22; // px of ruler room a readable label needs
    for (const step of [1, 2, 5, 10, 25, 50, 100]) {
      if (step * pitchPx >= minSpacing) return step;
    }
    return 100;
  }, [pitchPx]);
  
  // Ruler labels: for solder side, column numbers are reversed
  const columnLabels = useMemo(() => {
    const labels: { label: string; x: number; active: boolean }[] = [];
    for (let c = 0; c < cols; c++) {
      const viewCol = side === 'solder' ? cols - 1 - c : c;
      const x = rulerSize + (marginLeftMm + viewCol * holePitchMm) * PX_PER_MM;
      labels.push({ label: `${c + 1}`, x, active: highlightedCols.has(c) });
    }
    return labels;
  }, [cols, side, marginLeftMm, holePitchMm, rulerSize, highlightedCols]);
  
  const rowLabels = useMemo(() => {
    const labels: { label: string; y: number; active: boolean }[] = [];
    for (let r = 0; r < rows; r++) {
      const y = rulerSize + (marginTopMm + r * holePitchMm) * PX_PER_MM;
      labels.push({ label: coordToLabel({ row: r, col: 0 }).slice(0, -1), y, active: highlightedRows.has(r) });
    }
    return labels;
  }, [rows, marginTopMm, holePitchMm, rulerSize, highlightedRows]);
  
  // Component side: draw components. Solder side: draw wires.
  const renderComponents = side === 'component';
  const renderRoutes = side === 'solder' || side === 'component';
  const palette = useMemo(() => getPcbPalette(config.appearance), [config.appearance]);
  
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      width={totalWidth}
      height={totalHeight}
      className={className}
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
      onClick={handleSvgClick}
      onContextMenu={handleContextMenu}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="img"
      aria-label={`Board ${side} side`}
      data-side={side}
    >
      <defs>
        {/* Realistic sheen: light from top-left, slight vignette bottom-right */}
        <linearGradient id={`pcb-sheen-${side}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={side === 'component' ? 0.14 : 0.08} />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      
      {/* Board body (soldermask finish) */}
      <rect
        x={rulerSize}
        y={rulerSize}
        width={boardSize.width}
        height={boardSize.height}
        rx={7}
        fill={side === 'component' ? palette.maskTop : palette.maskBottom}
        stroke={palette.edge}
        strokeWidth={2}
      />
      
      {/* Silkscreen-style sheen overlay */}
      <rect
        x={rulerSize}
        y={rulerSize}
        width={boardSize.width}
        height={boardSize.height}
        rx={7}
        fill={`url(#pcb-sheen-${side})`}
        pointerEvents="none"
      />
      
      {/* Board edge highlight (milling bevel) */}
      <rect
        x={rulerSize + 1}
        y={rulerSize + 1}
        width={Math.max(0, boardSize.width - 2)}
        height={Math.max(0, boardSize.height - 2)}
        rx={6}
        fill="none"
        stroke={palette.sheen}
        strokeWidth={1}
        pointerEvents="none"
      />
      
      {/* Ruler: frame bands, one tick per hole, labels only where they fit */}
      {showLabels && (
        <>
          <rect x={0} y={0} width={totalWidth} height={rulerSize} fill="var(--panel-bg)" opacity={0.92} />
          <rect x={0} y={0} width={rulerSize} height={totalHeight} fill="var(--panel-bg)" opacity={0.92} />
          <line x1={0} y1={rulerSize} x2={totalWidth} y2={rulerSize} stroke="var(--border)" strokeWidth={1} pointerEvents="none" />
          <line x1={rulerSize} y1={0} x2={rulerSize} y2={totalHeight} stroke="var(--border)" strokeWidth={1} pointerEvents="none" />
        </>
      )}
      
      {showLabels && rowLabels.map((rl, i) => {
        const labeled = i % labelStep === 0;
        return (
          <g key={`row-${i}`}>
            <line
              x1={rulerSize - (labeled ? 6 : 3)}
              y1={rl.y}
              x2={rulerSize}
              y2={rl.y}
              stroke={rl.active ? 'var(--accent)' : 'var(--text-muted)'}
              strokeWidth={rl.active ? 1.6 : 1}
              opacity={rl.active ? 0.95 : 0.35}
            />
            {labeled && (
              <text
                x={rulerSize - 9}
                y={rl.y + 3.5}
                textAnchor="end"
                fontSize={10}
                fontWeight={rl.active ? 700 : 400}
                fill={rl.active ? 'var(--accent)' : 'var(--text)'}
                opacity={rl.active ? 1 : 0.85}
                fontFamily="ui-monospace, monospace"
              >
                {rl.label}
              </text>
            )}
          </g>
        );
      })}
      
      {showLabels && columnLabels.map((cl, i) => {
        const labeled = i % labelStep === 0;
        return (
          <g key={`col-${i}`}>
            <line
              x1={cl.x}
              y1={rulerSize - (labeled ? 6 : 3)}
              x2={cl.x}
              y2={rulerSize}
              stroke={cl.active ? 'var(--accent)' : 'var(--text-muted)'}
              strokeWidth={cl.active ? 1.6 : 1}
              opacity={cl.active ? 0.95 : 0.35}
            />
            {labeled && (
              <text
                x={cl.x}
                y={rulerSize - 10}
                textAnchor="middle"
                fontSize={10}
                fontWeight={cl.active ? 700 : 400}
                fill={cl.active ? 'var(--accent)' : 'var(--text)'}
                opacity={cl.active ? 1 : 0.85}
                fontFamily="ui-monospace, monospace"
              >
                {cl.label}
              </text>
            )}
          </g>
        );
      })}
      
      {/* Stripboard copper strips (solder side only) */}
      {side === 'solder' && config.type === 'stripboard' && (
        <StripboardTracks config={config} side={side} board={board} rulerSize={rulerSize} palette={palette} />
      )}
      
      {/* Holes and pads (view option). Mounting holes are drilled through the
          board, so they stay visible even when the pad grid is hidden. */}
      <HolesLayer
        board={board}
        side={side}
        toPixel={toPixel}
        highlightedCoordinates={highlightedCoordinates}
        palette={palette}
        showPads={showHoles}
      />

      {/* Click targets for each hole. Drawn BEFORE the components and wires on
          purpose: a hole under a part must not steal the part's click (that
          made selecting a component - and deleting it with Del - impossible). */}
      {interactive && (
        <HoleClickTargets
          board={board}
          toPixel={toPixel}
          onHoleClick={onHoleClick}
        />
      )}
      
      {/* Components (component side) */}
      {renderComponents && (
        <ComponentsLayer
          components={components}
          toPixel={toPixel}
          selectedComponentIds={selectedComponentIds}
          highlightedCoordinates={highlightedCoordinates}
          palette={palette}
          interactive={interactive}
          draggingComponentId={drag?.componentId || null}
          onPinPointerDown={handlePinPointerDown}
          onComponentClick={onComponentClick}
        />
      )}

      {renderComponents && proposalComponents.length > 0 && (
        <g data-testid="placement-preview" pointerEvents="none" opacity={0.55}>
          <ComponentsLayer
            components={proposalComponents}
            toPixel={toPixel}
            selectedComponentIds={new Set()}
            highlightedCoordinates={new Set()}
            palette={palette}
            interactive={false}
            draggingComponentId={null}
          />
          {proposalComponents.map(component => {
            const a = toPixel({ row: component.boundingBox.minRow, col: component.boundingBox.minCol });
            const b = toPixel({ row: component.boundingBox.maxRow, col: component.boundingBox.maxCol });
            return (
              <rect
                key={`proposal-${component.id}`}
                x={Math.min(a.x, b.x) - PX_PER_MM * 0.6}
                y={Math.min(a.y, b.y) - PX_PER_MM * 0.6}
                width={Math.abs(b.x - a.x) + PX_PER_MM * 1.2}
                height={Math.abs(b.y - a.y) + PX_PER_MM * 1.2}
                fill="none"
                stroke="var(--highlight)"
                strokeWidth={1.8}
                strokeDasharray="4 3"
              />
            );
          })}
        </g>
      )}
      
      {/* Routes (solder side primarily; show component-side wires on component side if any) */}
      {showRoutes && renderRoutes && (
        <RoutesLayer
          routes={routes}
          nets={nets}
          toPixel={toPixel}
          selectedNetId={selectedNetId}
          side={side}
        />
      )}
      
      {/* Wire-side markers for component-side view: show where wires connect */}
      {side === 'component' && showRoutes && (
        <ComponentSideWireMarkers
          routes={routes}
          toPixel={toPixel}
          selectedNetId={selectedNetId}
        />
      )}
      
      {/* Drag ghost indicator */}
      {drag?.hoverCoord && (
        <circle
          cx={toPixel(drag.hoverCoord).x}
          cy={toPixel(drag.hoverCoord).y}
          r={PX_PER_MM * 2.2}
          fill="none"
          stroke="var(--highlight)"
          strokeWidth={2.5}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}

// ============ HOLES LAYER ============

interface HolesLayerProps {
  board: BoardState;
  side: BoardSide;
  toPixel: (coord: Coordinate) => { x: number; y: number };
  highlightedCoordinates: Set<string>;
  palette: PcbPalette;
  /** View option: hide the pad grid. Mounting holes are always drawn. */
  showPads?: boolean;
}

function HolesLayer({ board, side, toPixel, highlightedCoordinates, palette, showPads = true }: HolesLayerProps) {
  // Realistic through-hole geometry at 2.54mm pitch: ~1.8mm plated pad,
  // ~1.0mm drill, so pads never touch and the mask stays visible between them.
  const holeRadius = 0.5 * PX_PER_MM;   // 1.0mm drill
  const padRadius = 0.9 * PX_PER_MM;    // 1.8mm plated pad
  const mountingHoleRadius = 1.6 * PX_PER_MM;
  
  const holes: React.ReactNode[] = [];
  
  for (const [key, pad] of board.pads) {
    const coord = pad.coordinate;
    const { x, y } = toPixel(coord);
    const isHighlighted = highlightedCoordinates.has(key);
    
    if (pad.isMountingHole) {
      // Mounting holes: unplated drill straight through the board
      holes.push(
        <g key={`mh-${key}`}>
          {/* Mask opening */}
          <circle cx={x} cy={y} r={mountingHoleRadius + 1} fill={palette.hole} opacity={0.35} />
          <circle
            cx={x}
            cy={y}
            r={mountingHoleRadius}
            fill={palette.hole}
            stroke={isHighlighted ? 'var(--highlight)' : palette.edge}
            strokeWidth={isHighlighted ? 2 : 1.2}
          />
          {/* Drill highlight */}
          <circle cx={x - mountingHoleRadius * 0.28} cy={y - mountingHoleRadius * 0.28} r={mountingHoleRadius * 0.28} fill="#ffffff" opacity={0.12} />
        </g>
      );
      continue;
    }
    if (!showPads) continue;
    
    if (side === 'component') {
      // Component side: plated through-hole ring + drill
      holes.push(
        <g key={`hole-${key}`}>
          <circle
            cx={x}
            cy={y}
            r={padRadius * 0.92}
            fill={palette.pad}
            stroke={isHighlighted ? 'var(--highlight)' : palette.padEdge}
            strokeWidth={isHighlighted ? 2.2 : 0.8}
            opacity={0.95}
          />
          {/* Drill */}
          <circle cx={x} cy={y} r={holeRadius} fill={palette.hole} />
          {/* Inner shadow of the drill wall */}
          <circle cx={x} cy={y} r={holeRadius} fill="none" stroke="#ffffff" strokeWidth={0.5} opacity={0.14} />
        </g>
      );
    } else {
      // Solder side: copper pad annulus + drill + track cut marker
      holes.push(
        <g key={`pad-${key}`}>
          <circle
            cx={x}
            cy={y}
            r={padRadius}
            fill={pad.isTrackCut ? '#c2203a' : palette.pad}
            stroke={isHighlighted ? 'var(--highlight)' : palette.padEdge}
            strokeWidth={isHighlighted ? 2.5 : 0.8}
          />
          <circle cx={x} cy={y} r={holeRadius} fill={palette.hole} />
          {pad.isTrackCut && (
            <g>
              <line x1={x - padRadius} y1={y - padRadius} x2={x + padRadius} y2={y + padRadius} stroke="#ffffff" strokeWidth={3.5} opacity={0.9} />
              <line x1={x - padRadius} y1={y - padRadius} x2={x + padRadius} y2={y + padRadius} stroke="var(--danger)" strokeWidth={2.2} />
            </g>
          )}
        </g>
      );
    }
  }
  
  return <g>{holes}</g>;
}

// ============ STRIPBOARD TRACKS ============

interface StripboardTracksProps {
  config: BoardConfig;
  side: BoardSide;
  board: BoardState;
  rulerSize: number;
  palette: PcbPalette;
}

function StripboardTracks({ config, side, board, rulerSize, palette }: StripboardTracksProps) {
  const { rows, cols, holePitchMm, marginLeftMm, marginTopMm } = config.dimensions;
  const direction = config.stripDirection || 'horizontal';
  const strips: React.ReactNode[] = [];
  
  if (direction === 'horizontal') {
    for (let r = 0; r < rows; r++) {
      // Find contiguous uncut spans
      let spanStart: number | null = null;
      
      for (let c = 0; c <= cols; c++) {
        const atEnd = c === cols;
        const pad = atEnd ? null : board.pads.get(`${r},${c}`);
        const isCut = pad?.isTrackCut || pad?.isMountingHole;
        
        if (!atEnd && !isCut && spanStart === null) {
          spanStart = c;
        }
        
        if ((atEnd || isCut) && spanStart !== null) {
          const spanEnd = c - 1;
          // Draw the strip from spanStart to spanEnd
          const viewStartCol = side === 'solder' ? cols - 1 - spanEnd : spanStart;
          const viewEndCol = side === 'solder' ? cols - 1 - spanStart : spanEnd;
          
          const x1 = rulerSize + (marginLeftMm + viewStartCol * holePitchMm) * PX_PER_MM;
          const x2 = rulerSize + (marginLeftMm + viewEndCol * holePitchMm) * PX_PER_MM;
          const y = rulerSize + (marginTopMm + r * holePitchMm) * PX_PER_MM;
          
          const stripHeight = 2.2 * PX_PER_MM;
          
          strips.push(
            <rect
              key={`strip-h-${r}-${spanStart}`}
              x={x1 - holePitchMm * PX_PER_MM / 2}
              y={y - stripHeight / 2}
              width={(x2 - x1) + holePitchMm * PX_PER_MM}
              height={stripHeight}
              fill={palette.strip}
              stroke={palette.stripEdge}
              strokeWidth={0.8}
              rx={stripHeight / 2}
            />
          );
          
          spanStart = null;
        }
      }
    }
  } else {
    for (let c = 0; c < cols; c++) {
      let spanStart: number | null = null;
      
      for (let r = 0; r <= rows; r++) {
        const atEnd = r === rows;
        const pad = atEnd ? null : board.pads.get(`${r},${c}`);
        const isCut = pad?.isTrackCut || pad?.isMountingHole;
        
        if (!atEnd && !isCut && spanStart === null) {
          spanStart = r;
        }
        
        if ((atEnd || isCut) && spanStart !== null) {
          const spanEnd = r - 1;
          
          const viewCol = side === 'solder' ? cols - 1 - c : c;
          const x = rulerSize + (marginLeftMm + viewCol * holePitchMm) * PX_PER_MM;
          const y1 = rulerSize + (marginTopMm + spanStart * holePitchMm) * PX_PER_MM;
          const y2 = rulerSize + (marginTopMm + spanEnd * holePitchMm) * PX_PER_MM;
          
          const stripWidth = 2.2 * PX_PER_MM;
          
          strips.push(
            <rect
              key={`strip-v-${c}-${spanStart}`}
              x={x - stripWidth / 2}
              y={y1 - holePitchMm * PX_PER_MM / 2}
              width={stripWidth}
              height={(y2 - y1) + holePitchMm * PX_PER_MM}
              fill={palette.strip}
              stroke={palette.stripEdge}
              strokeWidth={0.8}
              rx={stripWidth / 2}
            />
          );
          
          spanStart = null;
        }
      }
    }
  }
  
  return <g opacity={0.9}>{strips}</g>;
}

// ============ COMPONENTS LAYER ============

interface ComponentsLayerProps {
  components: PlacedComponent[];
  toPixel: (coord: Coordinate) => { x: number; y: number };
  selectedComponentIds: Set<string>;
  highlightedCoordinates: Set<string>;
  palette: PcbPalette;
  interactive?: boolean;
  draggingComponentId: string | null;
  onPinPointerDown?: (componentId: string, pinId: string, event: React.PointerEvent) => void;
  onComponentClick?: (componentId: string, event: React.MouseEvent) => void;
}

function ComponentsLayer({
  components,
  toPixel,
  selectedComponentIds,
  highlightedCoordinates,
  palette,
  interactive = true,
  draggingComponentId,
  onPinPointerDown,
  onComponentClick,
}: ComponentsLayerProps) {
  const elements: React.ReactNode[] = [];
  
  for (const comp of components) {
    const isSelected = selectedComponentIds.has(comp.id);
    const isDragging = draggingComponentId === comp.id;
    const bbox = comp.boundingBox;
    
    // Calculate body pixel rect from bounding box
    const topLeft = toPixel({ row: bbox.minRow, col: bbox.minCol });
    const bottomRight = toPixel({ row: bbox.maxRow, col: bbox.maxCol });
    
    const x = Math.min(topLeft.x, bottomRight.x) - PX_PER_MM * 0.5;
    const y = Math.min(topLeft.y, bottomRight.y) - PX_PER_MM * 0.5;
    const width = Math.abs(bottomRight.x - topLeft.x) + PX_PER_MM;
    const height = Math.abs(bottomRight.y - topLeft.y) + PX_PER_MM;
    
    // Component body
    const isRound = comp.footprint.bodyOutline?.type === 'circle';
    const bodyFill = isSelected ? 'rgba(34,197,94,0.22)' : 'rgba(18,22,26,0.88)';
    const bodyStroke = isSelected ? 'var(--accent)' : 'rgba(160,175,190,0.55)';
    
    elements.push(
      <g
        key={`comp-${comp.id}`}
        className="component-group"
        style={{ opacity: isDragging ? 0.5 : 1, cursor: comp.locked ? 'pointer' : 'grab' }}
        onClick={(e) => {
          e.stopPropagation();
          onComponentClick?.(comp.id, e);
        }}
      >
        {/* Body - clicking the body grabs via the topmost pin */}
        {isRound ? (
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth={isSelected ? 2.5 : 1.5}
          />
        ) : (
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={4}
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth={isSelected ? 2.5 : 1.5}
          />
        )}
        
        {/* Pin markers and numbers - these are the drag handles */}
        {comp.footprint.pins.map(pin => {
          const pinCoord = comp.pinPositions.get(pin.id);
          if (!pinCoord) return null;
          const p = toPixel(pinCoord);
          const isHighlighted = highlightedCoordinates.has(`${pinCoord.row},${pinCoord.col}`);
          
          return (
            <g key={`pin-${comp.id}-${pin.id}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={2.6 * PX_PER_MM / 2}
                fill={isHighlighted ? 'var(--highlight)' : (pin.isPolarized ? '#e0684b' : palette.pad)}
                stroke={pin.isPolarized ? '#8f3a24' : palette.padEdge}
                strokeWidth={1}
                style={{ cursor: comp.locked ? 'pointer' : 'grab' }}
                onPointerDown={(e) => {
                  if (interactive) {
                    onPinPointerDown?.(comp.id, pin.id, e);
                  }
                }}
              />
              {width > 18 && (
                <text
                  x={p.x}
                  y={p.y - 4}
                  textAnchor="middle"
                  fontSize={5.5}
                  fill={palette.silk}
                  opacity={0.9}
                  fontFamily="monospace"
                  pointerEvents="none"
                >
                  {pin.number}
                </text>
              )}
            </g>
          );
        })}
        
        {/* Reference label (silkscreen) */}
        <text
          x={x + width / 2}
          y={y - 3}
          textAnchor="middle"
          fontSize={7}
          fontWeight="600"
          fill={isSelected ? 'var(--accent)' : palette.silk}
          fontFamily="monospace"
          pointerEvents="none"
        >
          {comp.reference}
        </text>
        
        {/* Value label */}
        {comp.value && (
          <text
            x={x + width / 2}
            y={y + height + 9}
            textAnchor="middle"
            fontSize={6}
            fill={palette.silk}
            opacity={0.75}
            fontFamily="monospace"
            pointerEvents="none"
          >
            {comp.value}
          </text>
        )}
        
        {/* Lock indicator */}
        {comp.locked && (
          <text
            x={x + width - 2}
            y={y + 8}
            textAnchor="end"
            fontSize={8}
            fill="var(--accent)"
            pointerEvents="none"
          >
            🔒
          </text>
        )}
      </g>
    );
  }
  
  return <g>{elements}</g>;
}

// ============ ROUTES LAYER ============

interface RoutesLayerProps {
  routes: Route[];
  nets: Net[];
  toPixel: (coord: Coordinate) => { x: number; y: number };
  selectedNetId: string | null;
  side: BoardSide;
}

function RoutesLayer({ routes, nets, toPixel, selectedNetId, side }: RoutesLayerProps) {
  const elements: React.ReactNode[] = [];
  const col = (coord: Coordinate) => toPixel(coord);
  
  for (const route of routes) {
    const net = nets.find(n => n.id === route.netId);
    const isSelected = selectedNetId === route.netId;
    const color = net?.color || getNetColor(net?.name || route.netId);
    
    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i];
      
      // On component side view, only show wires that are routed on the component side
      if (side === 'component' && segment.layer !== 'component') continue;
      // On solder side view, show solder-side wires and strip tracks
      if (side === 'solder' && segment.layer === 'component') continue;
      
      // Strip connections: don't draw wires, they're part of the copper
      if (segment.type === 'track') continue;
      
      const from = col(segment.from);
      const to = col(segment.to);
      
      // Dark outline under the wire makes it read as insulated jumper wire
      elements.push(
        <line
          key={`seg-shadow-${route.id}-${i}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={isSelected ? 6.5 : 5}
          strokeLinecap="round"
        />
      );
      elements.push(
        <line
          key={`seg-${route.id}-${i}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={isSelected ? 4 : 2.5}
          strokeLinecap="round"
          opacity={isSelected ? 1 : 0.92}
        />
      );
    }
    
    // If route is selected, highlight endpoints with larger dots
    if (isSelected && route.segments.length > 0) {
      const start = col(route.segments[0].from);
      const end = col(route.segments[route.segments.length - 1].to);
      
      elements.push(
        <circle key={`start-${route.id}`} cx={start.x} cy={start.y} r={4} fill={color} stroke="white" strokeWidth={1.5} />,
        <circle key={`end-${route.id}`} cx={end.x} cy={end.y} r={4} fill={color} stroke="white" strokeWidth={1.5} />
      );
    }
  }
  
  return <g>{elements}</g>;
}

// ============ COMPONENT SIDE WIRE MARKERS ============

interface ComponentSideWireMarkersProps {
  routes: Route[];
  toPixel: (coord: Coordinate) => { x: number; y: number };
  selectedNetId: string | null;
}

function ComponentSideWireMarkers({ routes, toPixel, selectedNetId }: ComponentSideWireMarkersProps) {
  const markers: React.ReactNode[] = [];
  
  for (const route of routes) {
    if (route.segments.length === 0) continue;
    // Show small pads markers where solder-side wires connect
    const endpoints = [
      route.segments[0].from,
      route.segments[route.segments.length - 1].to,
    ];
    
    for (let i = 0; i < endpoints.length; i++) {
      const p = toPixel(endpoints[i]);
      const isSelected = selectedNetId === route.netId;
      
      markers.push(
        <circle
          key={`wiremark-${route.id}-${i}`}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill={isSelected ? 'var(--highlight)' : 'transparent'}
          stroke={isSelected ? 'var(--highlight)' : 'var(--text-muted)'}
          strokeWidth={1}
          opacity={isSelected ? 1 : 0.4}
        />
      );
    }
  }
  
  return <g>{markers}</g>;
}

// ============ HOLE CLICK TARGETS ============

interface HoleClickTargetsProps {
  board: BoardState;
  toPixel: (coord: Coordinate) => { x: number; y: number };
  onHoleClick?: (coord: Coordinate, event: React.MouseEvent) => void;
}

function HoleClickTargets({
  board,
  toPixel,
  onHoleClick,
}: HoleClickTargetsProps) {
  const targets: React.ReactNode[] = [];
  
  for (const [key, pad] of board.pads) {
    const { x, y } = toPixel(pad.coordinate);
    
    targets.push(
      <circle
        key={`target-${key}`}
        cx={x}
        cy={y}
        r={PX_PER_MM * 1.5}
        fill="transparent"
        style={{ cursor: 'crosshair' }}
        opacity={0}
        onClick={(e) => {
          e.stopPropagation();
          onHoleClick?.(pad.coordinate, e);
        }}
      />
    );
  }
  
  return <g>{targets}</g>;
}

// ============ UTILITIES ============

export { PX_PER_MM };
