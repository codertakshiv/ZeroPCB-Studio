/**
 * Board appearance (soldermask finish) palettes
 *
 * Each appearance maps to a realistic PCB finish. The same palette is used by
 * the interactive canvas (BoardCanvas) and the SVG/PNG exporters so exports
 * look exactly like the on-screen board.
 */

export type BoardAppearance = 'green' | 'brown' | 'red' | 'black' | 'white';

export interface PcbPalette {
  /** Human label for UI */
  label: string;
  /** Soldermask, component side */
  maskTop: string;
  /** Soldermask, solder side (slightly darker, as it reads in photos) */
  maskBottom: string;
  /** Board edge / cut line */
  edge: string;
  /** Silkscreen ink color (labels printed on the mask) */
  silk: string;
  /** Drilled hole interior */
  hole: string;
  /** Plated pad (ENIG gold) */
  pad: string;
  /** Pad rim */
  padEdge: string;
  /** Copper strip visible under the mask (stripboard) */
  strip: string;
  /** Strip edge */
  stripEdge: string;
  /** Subtle sheen overlay color (rgba) */
  sheen: string;
}

export const BOARD_APPEARANCES: BoardAppearance[] = ['green', 'brown', 'red', 'black', 'white'];

const PALETTES: Record<BoardAppearance, PcbPalette> = {
  green: {
    label: 'Green',
    maskTop: '#0e7a40',
    maskBottom: '#0a6132',
    edge: '#073d20',
    silk: '#eef7f0',
    hole: '#0d100e',
    pad: '#d7b348',
    padEdge: '#9c7c26',
    strip: '#16914f',
    stripEdge: '#0b5c31',
    sheen: 'rgba(255,255,255,0.09)',
  },
  brown: {
    label: 'Brown',
    maskTop: '#7d4e26',
    maskBottom: '#68401d',
    edge: '#472a10',
    silk: '#fdf3e3',
    hole: '#100c08',
    pad: '#d7b348',
    padEdge: '#9c7c26',
    strip: '#8f5c2d',
    stripEdge: '#5c3a17',
    sheen: 'rgba(255,255,255,0.08)',
  },
  red: {
    label: 'Red',
    maskTop: '#a5222a',
    maskBottom: '#8a1b22',
    edge: '#5d1016',
    silk: '#fdeef0',
    hole: '#120a0b',
    pad: '#d7b348',
    padEdge: '#9c7c26',
    strip: '#b72d35',
    stripEdge: '#711318',
    sheen: 'rgba(255,255,255,0.08)',
  },
  black: {
    label: 'Black',
    maskTop: '#181a1d',
    maskBottom: '#101215',
    edge: '#040506',
    silk: '#e9edf0',
    hole: '#050607',
    pad: '#d7b348',
    padEdge: '#9c7c26',
    strip: '#2b3138',
    stripEdge: '#1a1e23',
    sheen: 'rgba(255,255,255,0.06)',
  },
  white: {
    label: 'White',
    maskTop: '#eae6db',
    maskBottom: '#d9d4c5',
    edge: '#a9a28d',
    silk: '#3b3f39',
    hole: '#4a473e',
    pad: '#d7b348',
    padEdge: '#9c7c26',
    strip: '#d6cfae',
    stripEdge: '#b3aa88',
    sheen: 'rgba(255,255,255,0.35)',
  },
};

export const DEFAULT_BOARD_APPEARANCE: BoardAppearance = 'black';

export function getPcbPalette(appearance?: BoardAppearance): PcbPalette {
  return PALETTES[appearance || DEFAULT_BOARD_APPEARANCE] || PALETTES[DEFAULT_BOARD_APPEARANCE];
}

export function getAppearanceLabel(appearance?: BoardAppearance): string {
  return getPcbPalette(appearance).label;
}
