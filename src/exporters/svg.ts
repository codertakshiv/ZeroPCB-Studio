/**
 * SVG exporter - generates standalone SVG diagrams of the board
 * Uses the same coordinate transformations as the interactive renderer
 * to guarantee consistency between view and export.
 */

import { BoardState, Coordinate, coordToLabel } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import { Route } from '../routing/types';
import { BoardSide, coordinateToPixel, boardPixelSize } from '../board/transforms';
import { getPcbPalette } from '../board/appearance';

export interface SVGRenderOptions {
  side: BoardSide;
  showGrid?: boolean;
  showCoordinates?: boolean;
  showNetNames?: boolean;
  showComponentValues?: boolean;
  monochrome?: boolean;
  scaleBar?: boolean;
  pxPerMm?: number;
  title?: string;
}

const DEFAULT_PX_PER_MM = 4;

export function renderBoardSVG(
  board: BoardState,
  components: PlacedComponent[],
  routes: Route[],
  nets: Net[],
  options: SVGRenderOptions
): string {
  const {
    side,
    showCoordinates = true,
    showNetNames = true,
    showComponentValues = true,
    monochrome = false,
    scaleBar = true,
    pxPerMm = DEFAULT_PX_PER_MM,
    title,
  } = options;
  
  const config = board.config;
  const { rows, cols, holePitchMm, marginLeftMm, marginTopMm } = config.dimensions;
  const boardSize = boardPixelSize(config, pxPerMm);
  
  const rulerSize = 14;
  const margin = 10;
  const titleHeight = title ? 20 : 0;
  const scaleBarHeight = scaleBar ? 20 : 0;
  
  const totalWidth = boardSize.width + rulerSize + margin * 2;
  const totalHeight = boardSize.height + rulerSize + margin * 2 + titleHeight + scaleBarHeight;
  
  const toPixel = (coord: Coordinate) => {
    const p = coordinateToPixel(coord, config, side, pxPerMm);
    return { x: p.x + rulerSize + margin, y: p.y + rulerSize + margin + titleHeight };
  };
  
  const palette = getPcbPalette(config.appearance);
  const colors = monochrome ? {
    board: '#f0f0f0',
    outline: '#000000',
    hole: '#ffffff',
    holeStroke: '#000000',
    pad: '#cccccc',
    padEdge: '#000000',
    strip: '#cccccc',
    component: '#e0e0e0',
    componentStroke: '#666666',
    silk: '#000000',
    wire: '#000000',
    text: '#000000',
    textMuted: '#666666',
  } : {
    board: side === 'component' ? palette.maskTop : palette.maskBottom,
    outline: palette.edge,
    hole: palette.hole,
    holeStroke: palette.edge,
    pad: palette.pad,
    padEdge: palette.padEdge,
    strip: palette.strip,
    component: '#181c20',
    componentStroke: '#5c666e',
    silk: palette.silk,
    wire: '#000000',
    text: '#1a1a2e',
    textMuted: '#6b7280',
  };
  
  const elements: string[] = [];
  
  // SVG header
  elements.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  elements.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);
  elements.push(`<rect width="${totalWidth}" height="${totalHeight}" fill="white"/>`);
  
  // Title
  if (title) {
    elements.push(`<text x="${totalWidth / 2}" y="${margin + 12}" text-anchor="middle" font-size="12" font-weight="bold" font-family="sans-serif" fill="${colors.text}">${escapeXml(title)}</text>`);
  }
  
  const boardX = rulerSize + margin;
  const boardY = rulerSize + margin + titleHeight;
  
  // Board outline
  elements.push(`<rect x="${boardX}" y="${boardY}" width="${boardSize.width}" height="${boardSize.height}" rx="4" fill="${colors.board}" stroke="${colors.outline}" stroke-width="1.5"/>`);
  
  // Grid / hole rendering
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pad = board.pads.get(`${r},${c}`);
      if (!pad) continue;
      
      const p = toPixel({ row: r, col: c });
      
      if (pad.isMountingHole) {
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(1.6 * pxPerMm).toFixed(1)}" fill="${colors.hole}" stroke="${colors.holeStroke}" stroke-width="1"/>`);
        continue;
      }
      
      if (side === 'solder') {
        // Copper pad annulus
        const padColor = pad.isTrackCut ? '#c2203a' : colors.pad;
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(0.9 * pxPerMm).toFixed(1)}" fill="${padColor}" stroke="${colors.padEdge}" stroke-width="0.5"/>`);
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(0.5 * pxPerMm).toFixed(1)}" fill="${colors.hole}"/>`);
        
        if (pad.isTrackCut) {
          const r2 = 0.9 * pxPerMm;
          elements.push(`<line x1="${p.x - r2}" y1="${p.y - r2}" x2="${p.x + r2}" y2="${p.y + r2}" stroke="#ffffff" stroke-width="3" opacity="0.9"/>`);
          elements.push(`<line x1="${p.x - r2}" y1="${p.y - r2}" x2="${p.x + r2}" y2="${p.y + r2}" stroke="#dc2626" stroke-width="2"/>`);
        }
      } else {
        // Component side: plated through-hole ring + drill
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(0.9 * pxPerMm).toFixed(1)}" fill="${colors.pad}" stroke="${colors.padEdge}" stroke-width="0.4" opacity="0.95"/>`);
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(0.5 * pxPerMm).toFixed(1)}" fill="${colors.hole}"/>`);
      }
    }
  }
  
  // Stripboard strips
  if (side === 'solder' && config.type === 'stripboard') {
    const direction = config.stripDirection || 'horizontal';
    const stripWidth = 2.2 * pxPerMm;
    
    if (direction === 'horizontal') {
      for (let r = 0; r < rows; r++) {
        let spanStart: number | null = null;
        for (let c = 0; c <= cols; c++) {
          const atEnd = c === cols;
          const pad = atEnd ? null : board.pads.get(`${r},${c}`);
          const isCut = pad?.isTrackCut || pad?.isMountingHole;
          
          if (!atEnd && !isCut && spanStart === null) spanStart = c;
          
          if ((atEnd || isCut) && spanStart !== null) {
            const spanEnd = c - 1;
            const viewStartCol = side === 'solder' ? cols - 1 - spanEnd : spanStart;
            const viewEndCol = side === 'solder' ? cols - 1 - spanStart : spanEnd;
            
            const startP = toPixel({ row: r, col: 0 });
            const xs = boardX + (marginLeftMm + viewStartCol * holePitchMm) * pxPerMm;
            const xe = boardX + (marginLeftMm + viewEndCol * holePitchMm) * pxPerMm;
            
            elements.push(`<rect x="${(xs - holePitchMm * pxPerMm / 2).toFixed(1)}" y="${(startP.y - stripWidth / 2).toFixed(1)}" width="${((xe - xs) + holePitchMm * pxPerMm).toFixed(1)}" height="${stripWidth.toFixed(1)}" fill="${colors.strip}" opacity="0.9" rx="${(stripWidth / 2).toFixed(1)}"/>`);
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
          
          if (!atEnd && !isCut && spanStart === null) spanStart = r;
          
          if ((atEnd || isCut) && spanStart !== null) {
            const spanEnd = r - 1;
            const viewCol = side === 'solder' ? cols - 1 - c : c;
            const x = boardX + (marginLeftMm + viewCol * holePitchMm) * pxPerMm;
            const startP = toPixel({ row: spanStart, col: c });
            const endP = toPixel({ row: spanEnd, col: c });
            
            elements.push(`<rect x="${(x - stripWidth / 2).toFixed(1)}" y="${(startP.y - holePitchMm * pxPerMm / 2).toFixed(1)}" width="${stripWidth.toFixed(1)}" height="${((endP.y - startP.y) + holePitchMm * pxPerMm).toFixed(1)}" fill="${colors.strip}" opacity="0.9" rx="${(stripWidth / 2).toFixed(1)}"/>`);
            spanStart = null;
          }
        }
      }
    }
  }
  
  // Components (component side)
  if (side === 'component') {
    for (const comp of components) {
      const bbox = comp.boundingBox;
      const topLeft = toPixel({ row: bbox.minRow, col: bbox.minCol });
      const bottomRight = toPixel({ row: bbox.maxRow, col: bbox.maxCol });
      
      const x = Math.min(topLeft.x, bottomRight.x) - pxPerMm * 0.5;
      const y = Math.min(topLeft.y, bottomRight.y) - pxPerMm * 0.5;
      const width = Math.abs(bottomRight.x - topLeft.x) + pxPerMm;
      const height = Math.abs(bottomRight.y - topLeft.y) + pxPerMm;
      
      const isRound = comp.footprint.bodyOutline?.type === 'circle';
      
      if (isRound) {
        elements.push(`<ellipse cx="${(x + width / 2).toFixed(1)}" cy="${(y + height / 2).toFixed(1)}" rx="${(width / 2).toFixed(1)}" ry="${(height / 2).toFixed(1)}" fill="${colors.component}" stroke="${colors.componentStroke}" stroke-width="1" opacity="0.85"/>`);
      } else {
        elements.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${colors.component}" stroke="${colors.componentStroke}" stroke-width="1" opacity="0.85"/>`);
      }
      
      // Pins
      for (const pin of comp.footprint.pins) {
        const pinCoord = comp.pinPositions.get(pin.id);
        if (!pinCoord) continue;
        const p = toPixel(pinCoord);
        elements.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(1.1 * pxPerMm).toFixed(1)}" fill="${pin.isPolarized ? '#e0684b' : colors.pad}" stroke="${colors.padEdge}" stroke-width="0.5"/>`);
      }
      
      // Reference label (silkscreen)
      elements.push(`<text x="${(x + width / 2).toFixed(1)}" y="${(y - 1).toFixed(1)}" text-anchor="middle" font-size="${(2.5 * pxPerMm).toFixed(1)}" font-family="monospace" font-weight="bold" fill="${colors.silk}">${escapeXml(comp.reference)}</text>`);
      
      if (showComponentValues && comp.value) {
        elements.push(`<text x="${(x + width / 2).toFixed(1)}" y="${(y + height + 2.5 * pxPerMm).toFixed(1)}" text-anchor="middle" font-size="${(2.2 * pxPerMm).toFixed(1)}" font-family="monospace" fill="${colors.silk}" opacity="0.8">${escapeXml(comp.value)}</text>`);
      }
    }
  }
  
  // Routes (solder side)
  if (side === 'solder') {
    for (const route of routes) {
      const net = nets.find(n => n.id === route.netId);
      const color = monochrome ? '#000000' : (net?.color || getWireColor(net?.name || route.netId));
      
      for (const segment of route.segments) {
        if (segment.type === 'track') continue;
        const from = toPixel(segment.from);
        const to = toPixel(segment.to);
        elements.push(`<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${color}" stroke-width="${(0.8 * pxPerMm).toFixed(1)}" stroke-linecap="round"/>`);
      }
      
      // Net name label at the last segment
      if (showNetNames && route.segments.length > 0 && net) {
        const lastSeg = route.segments[route.segments.length - 1];
        const p = toPixel(lastSeg.to);
        elements.push(`<text x="${(p.x + 3).toFixed(1)}" y="${(p.y - 2).toFixed(1)}" font-size="${(2 * pxPerMm).toFixed(1)}" font-family="monospace" fill="${colors.silk}" opacity="0.85">${escapeXml(net.name)}</text>`);
      }
    }
  }
  
  // Coordinate rulers
  if (showCoordinates) {
    // Rows
    for (let r = 0; r < rows; r++) {
      const y = boardY + (marginTopMm + r * holePitchMm) * pxPerMm;
      const label = coordToLabel({ row: r, col: 0 }).slice(0, -1);
      elements.push(`<text x="${rulerSize / 2 + margin}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-size="${Math.min(9, pxPerMm * 1.8)}" font-family="monospace" fill="${colors.textMuted}">${label}</text>`);
    }
    // Columns
    for (let c = 0; c < cols; c++) {
      const viewCol = side === 'solder' ? cols - 1 - c : c;
      const x = boardX + (marginLeftMm + viewCol * holePitchMm) * pxPerMm;
      elements.push(`<text x="${x.toFixed(1)}" y="${(boardY - 4).toFixed(1)}" text-anchor="middle" font-size="${Math.min(9, pxPerMm * 1.8)}" font-family="monospace" fill="${colors.textMuted}">${c + 1}</text>`);
    }
  }
  
  // Scale bar
  if (scaleBar) {
    const scaleBarY = totalHeight - margin - 5;
    const scaleBarX = margin + rulerSize;
    const barLengthMm = 10;
    const barLengthPx = barLengthMm * pxPerMm;
    
    elements.push(`<line x1="${scaleBarX}" y1="${scaleBarY}" x2="${scaleBarX + barLengthPx}" y2="${scaleBarY}" stroke="${colors.text}" stroke-width="2"/>`);
    elements.push(`<line x1="${scaleBarX}" y1="${scaleBarY - 3}" x2="${scaleBarX}" y2="${scaleBarY + 3}" stroke="${colors.text}" stroke-width="2"/>`);
    elements.push(`<line x1="${scaleBarX + barLengthPx}" y1="${scaleBarY - 3}" x2="${scaleBarX + barLengthPx}" y2="${scaleBarY + 3}" stroke="${colors.text}" stroke-width="2"/>`);
    elements.push(`<text x="${scaleBarX + barLengthPx / 2}" y="${scaleBarY + 11}" text-anchor="middle" font-size="8" font-family="monospace" fill="${colors.text}">${barLengthMm} mm</text>`);
    
    // Board dimensions
    const dimText = `Board: ${config.dimensions.widthMm.toFixed(0)} × ${config.dimensions.heightMm.toFixed(0)} mm · ${rows}×${cols} holes · ${holePitchMm}mm pitch`;
    elements.push(`<text x="${scaleBarX + barLengthPx + 15}" y="${scaleBarY + 3}" font-size="8" font-family="monospace" fill="${colors.textMuted}">${escapeXml(dimText)}</text>`);
    
    // Side indicator
    const sideText = side === 'component' ? 'COMPONENT SIDE (TOP)' : 'SOLDER SIDE (BOTTOM — MIRRORED VIEW)';
    elements.push(`<text x="${totalWidth - margin}" y="${scaleBarY + 3}" text-anchor="end" font-size="8" font-family="monospace" font-weight="bold" fill="${colors.text}">${sideText}</text>`);
  }
  
  elements.push(`</svg>`);
  
  return elements.join('\n');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const WIRE_COLORS = [
  '#ef4444', '#3b82f6', '#eab308', '#a855f7', '#f97316',
  '#ec4899', '#8b5cf6', '#d946ef', '#f43f5e', '#38bdf8',
];

function getWireColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return WIRE_COLORS[Math.abs(hash) % WIRE_COLORS.length];
}