/**
 * CSV exporters - BOM, coordinate list, jumper wire list, track cut list
 */

import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import { Route } from '../routing/types';
import { BoardState, coordToLabel } from '../board/types';

function csvEscape(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers: string[], rows: (string | number | undefined)[][]): string {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map(row => row.map(csvEscape).join(',')),
  ];
  return lines.join('\r\n');
}

export function exportBOMCSV(components: PlacedComponent[]): string {
  // Group by footprint + value
  const groups = new Map<string, { references: string[]; value: string; footprint: string; description: string }>();
  
  for (const comp of components) {
    const key = `${comp.footprintId}|${comp.value || ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.references.push(comp.reference);
    } else {
      groups.set(key, {
        references: [comp.reference],
        value: comp.value || '',
        footprint: comp.footprint.name,
        description: comp.footprint.description,
      });
    }
  }
  
  const rows = Array.from(groups.values()).map(g => [
    g.references.sort().join(', '),
    g.value,
    g.footprint,
    g.references.length,
    g.description,
  ]);
  
  return toCSV(
    ['References', 'Value', 'Footprint', 'Quantity', 'Description'],
    rows
  );
}

export function exportCoordinateListCSV(
  board: BoardState,
  components: PlacedComponent[],
  routes: Route[],
  nets: Net[]
): string {
  const rows: (string | number | undefined)[][] = [];
  
  // Component pins
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const pin = comp.footprint.pins.find(p => p.id === pinId);
      const netId = comp.nets.get(pinId);
      const net = nets.find(n => n.id === netId);
      
      rows.push([
        coordToLabel(coord),
        coord.row,
        coord.col,
        'component-pin',
        comp.reference,
        pin?.number || pinId,
        pin?.name || '',
        net?.name || '',
        '',
      ]);
    }
  }
  
  // Jumper endpoints
  for (const route of routes) {
    const net = nets.find(n => n.id === route.netId);
    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i];
      if (segment.type === 'track') continue;
      
      rows.push([
        coordToLabel(segment.from),
        segment.from.row,
        segment.from.col,
        'jumper-endpoint',
        '',
        '',
        '',
        net?.name || route.netId,
        `Segment ${i + 1} of ${route.segments.length}`,
      ]);
    }
  }
  
  // Sort by row, col
  rows.sort((a, b) => {
    const rowA = a[1] as number, colA = a[2] as number;
    const rowB = b[1] as number, colB = b[2] as number;
    return rowA - rowB || colA - colB;
  });
  
  return toCSV(
    ['Coordinate', 'Row', 'Col', 'Type', 'Component', 'Pin', 'Pin Name', 'Net', 'Notes'],
    rows
  );
}

export function exportJumperListCSV(
  routes: Route[],
  nets: Net[],
  holePitchMm: number
): string {
  const rows: (string | number | undefined)[][] = [];
  let wireNumber = 1;
  
  for (const route of routes) {
    const net = nets.find(n => n.id === route.netId);
    
    // Split the route into contiguous wire runs (each run = one physical wire)
    let run: typeof route.segments = [];
    
    const flushRun = () => {
      if (run.length === 0) return;
      
      // Physical length = sum of the grid steps covered by this run
      const gridSteps = run.reduce(
        (sum, s) => sum + Math.abs(s.from.row - s.to.row) + Math.abs(s.from.col - s.to.col),
        0
      );
      const physicalLength = Math.round(gridSteps * holePitchMm);
      const first = run[0];
      const last = run[run.length - 1];
      
      rows.push([
        `W${wireNumber++}`,
        coordToLabel(first.from),
        coordToLabel(last.to),
        physicalLength,
        `${physicalLength + 10}mm (incl. 10mm allowance)`,
        net?.name || route.netId,
        first.layer,
        `${gridSteps} grid units`,
      ]);
      
      run = [];
    };
    
    for (const segment of route.segments) {
      if (segment.type === 'track') continue;
      
      const prev = run[run.length - 1];
      if (
        prev &&
        (segment.from.row !== prev.to.row ||
          segment.from.col !== prev.to.col ||
          segment.layer !== prev.layer)
      ) {
        flushRun();
      }
      run.push(segment);
    }
    flushRun();
  }
  
  return toCSV(
    ['Wire #', 'From', 'To', 'Length (mm)', 'Cut length', 'Net', 'Side', 'Notes'],
    rows
  );
}

export function exportTrackCutListCSV(board: BoardState, nets: Net[]): string {
  const rows: (string | number | undefined)[][] = [];
  
  for (const [key, pad] of board.pads) {
    if (!pad.isTrackCut) continue;
    
    const coord = key.split(',').map(Number);
    const coordinate = { row: coord[0], col: coord[1] };
    
    rows.push([
      coordToLabel(coordinate),
      coordinate.row,
      coordinate.col,
      'track-cut',
      pad.netId ? nets.find(n => n.id === pad.netId)?.name || '' : '',
      'Cut copper strip at this hole with a 3mm drill bit',
    ]);
  }
  
  rows.sort((a, b) => (a[1] as number) - (b[1] as number) || (a[2] as number) - (b[2] as number));
  
  return toCSV(
    ['Coordinate', 'Row', 'Col', 'Type', 'Net', 'Instruction'],
    rows
  );
}

export function exportNetlistCSV(nets: Net[], components: PlacedComponent[] ): string {
  const rows: (string | number | undefined)[][] = [];
  
  for (const net of nets) {
    for (const pin of net.pins) {
      const comp = components.find(c => c.id === pin.componentId);
      rows.push([
        net.name,
        comp?.reference || pin.componentId,
        pin.pinNumber,
        pin.pinName,
      ]);
    }
  }
  
  return toCSV(['Net', 'Reference', 'Pin Number', 'Pin Name'], rows);
}

export function exportAssemblyChecklistCSV(
  steps: { order: number; description: string; coordinates: { row: number; col: number }[]; type: string }[]
): string {
  const rows = steps.map(step => [
    step.order + 1,
    step.type,
    step.description,
    step.coordinates.map(c => coordToLabel(c)).join(' '),
    '', // completed checkbox column for print
  ]);
  
  return toCSV(['Step', 'Type', 'Description', 'Coordinates', 'Done ✓'], rows);
}