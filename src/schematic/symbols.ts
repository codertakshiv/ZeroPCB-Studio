/**
 * Schematic symbols + auto-layout
 *
 * Renders circuit components as classic schematic symbols (EasyEDA style):
 * resistors, capacitors, diodes, transistors, DIP packages, headers, ...
 *
 * All geometry is expressed in schematic grid units. The canvas multiplies by
 * SCHEMATIC_UNIT to get pixels. Symbol origin (0,0) is the top-left of the
 * symbol's own coordinate space; pins sit on the symbol border/leads so wires
 * can connect to exact points.
 */

import { Footprint, Pin } from '../footprints/types';

export const SCHEMATIC_UNIT = 22; // px per grid unit at 100% zoom

export type SchematicDrawing =
  | 'resistor'
  | 'capacitor'
  | 'polarized-capacitor'
  | 'diode'
  | 'led'
  | 'crystal'
  | 'potentiometer'
  | 'switch'
  | 'push-button'
  | 'transistor'
  | 'mosfet'
  | 'dip'
  | 'header'
  | 'regulator'
  | 'generic';

export interface SymbolPinLayout {
  pinId: string;
  number: string;
  name: string;
  /** Pin connection point in symbol units */
  x: number;
  y: number;
  side: 'left' | 'right' | 'top' | 'bottom';
  isPolarized?: boolean;
}

export interface SymbolLayout {
  drawing: SchematicDrawing;
  width: number;
  height: number;
  pins: SymbolPinLayout[];
}

export interface SchematicPosition {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

function toPin(pin: Pin, x: number, y: number, side: SymbolPinLayout['side']): SymbolPinLayout {
  return {
    pinId: pin.id,
    number: pin.number,
    name: pin.name,
    x,
    y,
    side,
    isPolarized: pin.isPolarized,
  };
}

/** Two-pin parts drawn left-to-right (resistor, cap, diode, ...) */
function twoPinLayout(drawing: SchematicDrawing, pins: Pin[]): SymbolLayout {
  if (pins.length !== 2) return headerLayout('generic', pins);
  return {
    drawing,
    width: 6,
    height: 4,
    pins: [toPin(pins[0], 0, 2, 'left'), toPin(pins[1], 6, 2, 'right')],
  };
}

/** Three-pin parts with a wiper/common pin at the bottom */
function wiperLayout(drawing: SchemaDrawingWiper, pins: Pin[]): SymbolLayout {
  if (pins.length !== 3) return headerLayout('generic', pins);
  return {
    drawing,
    width: 7,
    height: 6,
    pins: [
      toPin(pins[0], 0, 3, 'left'),
      toPin(pins[1], 3.5, 6, 'bottom'),
      toPin(pins[2], 7, 3, 'right'),
    ],
  };
}

type SchemaDrawingWiper = Extract<SchematicDrawing, 'potentiometer' | 'switch'>;

/** BJT / MOSFET: control pin left, channel pins right */
function transistorLayout(drawing: Extract<SchematicDrawing, 'transistor' | 'mosfet'>, pins: Pin[]): SymbolLayout {
  if (pins.length !== 3) return headerLayout('generic', pins);
  return {
    drawing,
    width: 8,
    height: 6,
    pins: [
      toPin(pins[0], 0, 3, 'left'),
      toPin(pins[1], 8, 1.8, 'right'),
      toPin(pins[2], 8, 4.2, 'right'),
    ],
  };
}

/** DIP-style IC: pin 1 top-left, down the left side, back up the right side */
function dipLayout(pins: Pin[]): SymbolLayout {
  const n = pins.length;
  if (n === 0) {
    return { drawing: 'dip', width: 7, height: 4, pins: [] };
  }
  const half = Math.ceil(n / 2);
  const width = 7;
  const height = half + 1;
  const layoutPins: SymbolPinLayout[] = pins.map((pin, i) => {
    if (i < half) {
      return toPin(pin, 0, 1 + i, 'left');
    }
    // Right side: last pin at the top, pin `half` at the bottom
    return toPin(pin, width, 1 + (n - 1 - i), 'right');
  });
  return { drawing: 'dip', width, height, pins: layoutPins };
}

/** Headers / terminals / connectors: pins in a vertical column on the left */
function headerLayout(drawing: Extract<SchematicDrawing, 'header' | 'generic'>, pins: Pin[]): SymbolLayout {
  const n = Math.max(1, pins.length);
  return {
    drawing,
    width: 5,
    height: n + 1,
    pins: pins.map((pin, i) => toPin(pin, 0, 0.5 + i, 'left')),
  };
}

function buttonLayout(pins: Pin[]): SymbolLayout {
  if (pins.length === 2) return twoPinLayout('push-button', pins);
  if (pins.length === 4) {
    return {
      drawing: 'push-button',
      width: 6,
      height: 6,
      pins: [
        toPin(pins[0], 0, 1.8, 'left'),
        toPin(pins[1], 0, 4.2, 'left'),
        toPin(pins[2], 6, 1.8, 'right'),
        toPin(pins[3], 6, 4.2, 'right'),
      ],
    };
  }
  return headerLayout('generic', pins);
}

/** TO-220 regulators: three pins in a row along the bottom */
function regulatorLayout(pins: Pin[]): SymbolLayout {
  if (pins.length !== 3) return headerLayout('generic', pins);
  return {
    drawing: 'regulator',
    width: 8,
    height: 7,
    pins: [
      toPin(pins[0], 2, 7, 'bottom'),
      toPin(pins[1], 4, 7, 'bottom'),
      toPin(pins[2], 6, 7, 'bottom'),
    ],
  };
}

export function getSymbolLayout(footprint?: Footprint): SymbolLayout {
  const pins = footprint?.pins ?? [];
  const category = footprint?.category ?? 'custom';

  switch (category) {
    case 'resistor':
      return twoPinLayout('resistor', pins);
    case 'capacitor':
      return twoPinLayout('capacitor', pins);
    case 'polarized-capacitor':
      return twoPinLayout('polarized-capacitor', pins);
    case 'diode':
      return twoPinLayout('diode', pins);
    case 'led':
      return twoPinLayout('led', pins);
    case 'crystal':
      return twoPinLayout('crystal', pins);
    case 'potentiometer':
      return wiperLayout('potentiometer', pins);
    case 'switch':
      return wiperLayout('switch', pins);
    case 'push-button':
      return buttonLayout(pins);
    case 'transistor':
      return transistorLayout('transistor', pins);
    case 'mosfet':
      return transistorLayout('mosfet', pins);
    case 'ic-dip':
    case 'ic-socket':
      return dipLayout(pins);
    case 'pin-header':
    case 'screw-terminal':
    case 'connector':
      return headerLayout('header', pins);
    case 'voltage-regulator':
      return regulatorLayout(pins);
    default:
      if (pins.length === 2) return twoPinLayout('generic', pins);
      return headerLayout('generic', pins);
  }
}

// ============ AUTO LAYOUT ============

const LAYOUT_MARGIN_X = 3;
const LAYOUT_MARGIN_Y = 4;
const LAYOUT_MAX_WIDTH = 54; // units before wrapping to a new row
const LAYOUT_GAP_X = 5;
const LAYOUT_GAP_Y = 5;

export interface LayoutComponent {
  id: string;
  footprint?: Footprint;
}

/**
 * Deterministic flow layout: components are laid left-to-right in symbol
 * order, wrapping to new rows. With `onlyMissing` the positions already in
 * `existing` are kept and new components are placed below them.
 */
export function computeSchematicLayout(
  components: LayoutComponent[],
  existing?: Map<string, SchematicPosition>,
  onlyMissing = false
): Map<string, SchematicPosition> {
  const result = new Map<string, SchematicPosition>(existing ?? []);
  let cursorX = LAYOUT_MARGIN_X;
  let cursorY = LAYOUT_MARGIN_Y;
  let rowHeight = 0;

  if (onlyMissing) {
    // Start below everything that already has a position
    let maxY = LAYOUT_MARGIN_Y;
    for (const comp of components) {
      const pos = result.get(comp.id);
      if (!pos) continue;
      const sym = getSymbolLayout(comp.footprint);
      maxY = Math.max(maxY, pos.y + sym.height + LAYOUT_GAP_Y);
    }
    cursorY = maxY;
  }

  for (const comp of components) {
    if (onlyMissing && result.has(comp.id)) continue;

    const sym = getSymbolLayout(comp.footprint);
    if (cursorX + sym.width > LAYOUT_MAX_WIDTH && cursorX > LAYOUT_MARGIN_X) {
      cursorX = LAYOUT_MARGIN_X;
      cursorY += rowHeight + LAYOUT_GAP_Y;
      rowHeight = 0;
    }

    result.set(comp.id, { x: cursorX, y: cursorY });
    cursorX += sym.width + LAYOUT_GAP_X;
    rowHeight = Math.max(rowHeight, sym.height);
  }

  return result;
}

// ============ WIRES ============

/** Orthogonal (manhattan) wire path between two points */
export function getWirePoints(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const midX = Math.round(((a.x + b.x) / 2) * 2) / 2;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

export function wirePointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * Visual body box of a symbol (symbol units, pins excluded) - mirrors what
 * `SymbolBodyView` draws. The wire router uses it to keep nets out of symbol
 * bodies, so a wire crossing the sheet never disappears under a part.
 */
export function getSymbolBodyBox(layout: SymbolLayout): { x: number; y: number; width: number; height: number } {
  switch (layout.drawing) {
    case 'dip':
      return { x: 1, y: 0.5, width: layout.width - 2, height: layout.height - 1 };
    case 'header':
    case 'generic':
    case 'regulator':
      return { x: 1.5, y: 0.2, width: layout.width - 1.5, height: layout.height - 0.4 };
    default:
      // Two/three-pin drawings (resistor, LED, transistor, ...) sit on the
      // middle row of the symbol.
      return { x: 1, y: layout.height / 2 - 1.4, width: layout.width - 2, height: 2.8 };
  }
}

// ============ NET AUTO-NAMING ============

/** Suggest a net name from the names of the pins being connected */
export function suggestNetName(pins: Pin[]): string | null {
  for (const pin of pins) {
    const n = pin.name.trim().toUpperCase();
    if (/^(GND|VSS|GROUND|AGND)$/.test(n)) return 'GND';
    if (/^(VCC|VDD|V\+|\+5V|5V)$/.test(n)) return 'VCC';
    if (/^(3V3|3\.3V|\+3V3|\+3\.3V)$/.test(n)) return '3V3';
    if (/^(VIN|VBAT)$/.test(n)) return 'VIN';
  }
  return null;
}

/** Next free auto net name (N1, N2, ...) given existing nets */
export function nextAutoNetName(existingNetNames: Iterable<string>, startAt: number): { name: string; counter: number } {
  const taken = new Set<string>(existingNetNames);
  let counter = Math.max(1, startAt);
  while (taken.has(`N${counter}`)) counter++;
  return { name: `N${counter}`, counter: counter + 1 };
}

/** True when a net name was auto-generated by the tool */
export function isAutoNetName(name: string): boolean {
  return /^N\d+$/.test(name);
}
