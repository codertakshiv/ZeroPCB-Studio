/**
 * Coordinate transformation tests
 * Verifies the documented coordinate system and solder-side mirroring.
 */

import { describe, it, expect } from 'vitest';
import {
  componentToSolderView,
  solderViewToComponent,
  viewCoordinate,
  physicalCoordinate,
  coordinateToPixel,
  pixelToCoordinate,
  boardPixelSize,
  rotatePoint,
  roundTripIdentity,
} from '../board/transforms';
import { BoardConfig, coordToLabel, labelToCoord, createEmptyBoard, coordToKey } from '../board/types';

const testConfig: BoardConfig = {
  id: 'test',
  name: 'Test Board',
  type: 'perfboard',
  dimensions: {
    rows: 10,
    cols: 20,
    holePitchMm: 2.54,
    widthMm: 55.88,
    heightMm: 30.48,
    marginTopMm: 2.54,
    marginBottomMm: 2.54,
    marginLeftMm: 2.54,
    marginRightMm: 2.54,
  },
  mountingHoles: [],
  createdAt: 0,
  updatedAt: 0,
};

describe('Solder-side mirroring', () => {
  it('mirrors columns left-right, keeps rows', () => {
    // A1 at (0,0) in a 20-col board appears at column 20 in solder view
    expect(componentToSolderView({ row: 0, col: 0 }, 20)).toEqual({ row: 0, col: 19 });
    // Last column appears first
    expect(componentToSolderView({ row: 0, col: 19 }, 20)).toEqual({ row: 0, col: 0 });
    // Row unchanged
    expect(componentToSolderView({ row: 5, col: 3 }, 20)).toEqual({ row: 5, col: 16 });
  });

  it('is an involution (self-inverse)', () => {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 20; c++) {
        const original = { row: r, col: c };
        const mirrored = componentToSolderView(original, 20);
        const back = solderViewToComponent(mirrored, 20);
        expect(back).toEqual(original);
      }
    }
  });

  it('round-trips through both helpers', () => {
    expect(roundTripIdentity({ row: 3, col: 7 }, 20)).toBe(true);
    expect(roundTripIdentity({ row: 0, col: 0 }, 20)).toBe(true);
  });

  it('viewCoordinate and physicalCoordinate are consistent', () => {
    const coord = { row: 4, col: 6 };
    const view = viewCoordinate(coord, 20, 'solder');
    const physical = physicalCoordinate(view, 20, 'solder');
    expect(physical).toEqual(coord);
  });

  it('component side view is identity', () => {
    const coord = { row: 4, col: 6 };
    expect(viewCoordinate(coord, 20, 'component')).toEqual(coord);
    expect(physicalCoordinate(coord, 20, 'component')).toEqual(coord);
  });
});

describe('Coordinate labels', () => {
  it('converts coordinates to labels', () => {
    expect(coordToLabel({ row: 0, col: 0 })).toBe('A1');
    expect(coordToLabel({ row: 1, col: 2 })).toBe('B3');
    expect(coordToLabel({ row: 25, col: 9 })).toBe('Z10');
  });

  it('converts labels back to coordinates', () => {
    expect(labelToCoord('A1')).toEqual({ row: 0, col: 0 });
    expect(labelToCoord('B3')).toEqual({ row: 1, col: 2 });
    expect(labelToCoord('Z10')).toEqual({ row: 25, col: 9 });
    expect(labelToCoord('AA1')).toEqual({ row: 26, col: 0 });
  });

  it('round-trips labels', () => {
    for (let r = 0; r < 30; r += 3) {
      for (let c = 0; c < 15; c += 2) {
        const coord = { row: r, col: c };
        expect(labelToCoord(coordToLabel(coord))).toEqual(coord);
      }
    }
  });

  it('rejects invalid labels', () => {
    expect(() => labelToCoord('123')).toThrow();
    expect(() => labelToCoord('abc')).toThrow();
  });
});

describe('Pixel conversions', () => {
  it('converts coordinates to pixels on component side', () => {
    const p = coordinateToPixel({ row: 0, col: 0 }, testConfig, 'component', 4);
    expect(p.x).toBeCloseTo(2.54 * 4); // marginLeft * pxPerMm
    expect(p.y).toBeCloseTo(2.54 * 4); // marginTop * pxPerMm
  });

  it('converts coordinates to pixels on solder side with mirrored X', () => {
    const pComponent = coordinateToPixel({ row: 0, col: 0 }, testConfig, 'component', 4);
    const pSolder = coordinateToPixel({ row: 0, col: 0 }, testConfig, 'solder', 4);
    // Same row -> same Y
    expect(pSolder.y).toBeCloseTo(pComponent.y);
    // Different column -> mirrored X
    expect(pSolder.x).not.toBeCloseTo(pComponent.x);
    // The mirrored position of col 0 in a 20-col board is col 19
    const expected = coordinateToPixel({ row: 0, col: 19 }, testConfig, 'component', 4);
    expect(pSolder.x).toBeCloseTo(expected.x);
  });

  it('pixel-to-coordinate round-trips exactly on hole centers', () => {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 20; c += 4) {
        for (const side of ['component', 'solder'] as const) {
          const p = coordinateToPixel({ row: r, col: c }, testConfig, side, 4);
          const back = pixelToCoordinate(p.x, p.y, testConfig, side, 4);
          expect(back).toEqual({ row: r, col: c });
        }
      }
    }
  });

  it('returns null for out-of-bounds clicks', () => {
    expect(pixelToCoordinate(-100, 0, testConfig, 'component', 4)).toBeNull();
    expect(pixelToCoordinate(0, 10000, testConfig, 'component', 4)).toBeNull();
  });

  it('boardPixelSize matches mm dimensions', () => {
    const size = boardPixelSize(testConfig, 4);
    expect(size.width).toBeCloseTo(55.88 * 4);
    expect(size.height).toBeCloseTo(30.48 * 4);
  });
});

describe('Rotation', () => {
  it('rotates 90° clockwise correctly', () => {
    // Point to the right of origin rotates to below origin
    const rotated = rotatePoint({ row: 0, col: 2 }, { row: 0, col: 0 }, 90);
    expect(rotated).toEqual({ row: 2, col: 0 });
  });

  it('rotates 180° correctly', () => {
    const rotated = rotatePoint({ row: 1, col: 2 }, { row: 0, col: 0 }, 180);
    expect(rotated).toEqual({ row: -1, col: -2 });
  });

  it('four 90° rotations return to start', () => {
    let point = { row: 3, col: 1 };
    const origin = { row: 0, col: 0 };
    for (let i = 0; i < 4; i++) {
      point = rotatePoint(point, origin, 90);
    }
    expect(point).toEqual({ row: 3, col: 1 });
  });

  it('0° rotation is identity', () => {
    expect(rotatePoint({ row: 5, col: 3 }, { row: 2, col: 1 }, 0)).toEqual({ row: 5, col: 3 });
  });
});

describe('Board creation', () => {
  it('creates the right number of holes', () => {
    const board = createEmptyBoard(testConfig);
    expect(board.pads.size).toBe(200); // 10 rows x 20 cols
    expect(board.holeCoordinates.length).toBe(200);
  });

  it('creates keys addressable by coordinate', () => {
    const board = createEmptyBoard(testConfig);
    expect(board.pads.has(coordToKey({ row: 0, col: 0 }))).toBe(true);
    expect(board.pads.has(coordToKey({ row: 9, col: 19 }))).toBe(true);
    expect(board.pads.has(coordToKey({ row: 10, col: 0 }))).toBe(false);
  });

  it('marks mounting holes', () => {
    const config: BoardConfig = {
      ...testConfig,
      mountingHoles: [{ id: 'mh1', row: 0, col: 0, diameterMm: 3 }],
    };
    const board = createEmptyBoard(config);
    const pad = board.pads.get(coordToKey({ row: 0, col: 0 }));
    expect(pad?.isMountingHole).toBe(true);
  });
});

describe('Stripboard connectivity', () => {
  it('connects adjacent holes horizontally', () => {
    const config: BoardConfig = {
      ...testConfig,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(config);
    const pad = board.pads.get(coordToKey({ row: 0, col: 0 }));
    expect(pad?.customConnectedPads).toContainEqual({ row: 0, col: 1 });
  });

  it('does not wrap around rows (last column not connected to first of next row)', () => {
    const config: BoardConfig = {
      ...testConfig,
      type: 'stripboard',
      stripDirection: 'horizontal',
    };
    const board = createEmptyBoard(config);
    const lastPadOfRow = board.pads.get(coordToKey({ row: 0, col: 19 }));
    // Should not be connected to (1,0)
    expect(lastPadOfRow?.customConnectedPads).not.toContainEqual({ row: 1, col: 0 });
    // But it IS connected to its left neighbor — strip links are bidirectional
    expect(lastPadOfRow?.customConnectedPads).toContainEqual({ row: 0, col: 18 });
  });
  
  it('breaks strips at mounting holes', () => {
    const config: BoardConfig = {
      ...testConfig,
      type: 'stripboard',
      stripDirection: 'horizontal',
      mountingHoles: [{ id: 'mh1', row: 0, col: 1, diameterMm: 3 }],
    };
    const board = createEmptyBoard(config);
    // (0,0) must not connect across the mounting hole at (0,1)
    expect(board.pads.get(coordToKey({ row: 0, col: 0 }))?.customConnectedPads || [])
      .not.toContainEqual({ row: 0, col: 1 });
    expect(board.pads.get(coordToKey({ row: 0, col: 1 }))?.customConnectedPads).toBeUndefined();
    // The strip resumes on the far side: (0,2) <-> (0,3)
    expect(board.pads.get(coordToKey({ row: 0, col: 2 }))?.customConnectedPads)
      .toContainEqual({ row: 0, col: 3 });
  });

  it('connects vertically when direction is vertical', () => {
    const config: BoardConfig = {
      ...testConfig,
      type: 'stripboard',
      stripDirection: 'vertical',
    };
    const board = createEmptyBoard(config);
    const pad = board.pads.get(coordToKey({ row: 0, col: 0 }));
    expect(pad?.customConnectedPads).toContainEqual({ row: 1, col: 0 });
  });
});
