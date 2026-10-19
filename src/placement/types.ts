/**
 * Placement engine types
 * (Implementation in engine.ts)
 */

import { BoardState, Coordinate } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Circuit, Net } from '../circuit/types';

export type PlacementMode = 'min-wire' | 'max-neatness' | 'balanced';
export type OptimizationIntensity = 'fast' | 'standard' | 'thorough';

export interface PlacementConfig {
  mode: PlacementMode;
  intensity: OptimizationIntensity;
  weights: PlacementWeights;
  maxIterations: number;
  timeLimitMs: number;
  seed: number;
}

export interface PlacementWeights {
  wireLength: number;
  bends: number;
  crossings: number;
  footprintSpacing: number;
  edgeClearance: number;
  componentGrouping: number;
  alignment: number;
}

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  mode: 'balanced',
  intensity: 'standard',
  weights: {
    wireLength: 1.0,
    bends: 0.5,
    crossings: 0.8,
    footprintSpacing: 0.6,
    edgeClearance: 0.4,
    componentGrouping: 0.7,
    alignment: 0.5,
  },
  maxIterations: 1000,
  timeLimitMs: 5000,
  seed: 42,
};

/**
 * Minimal component description required by the placement engine.
 * Decouples the engine from circuit-editor concerns.
 */
export interface PlacementSpec {
  id: string;
  footprintId: string;
  reference: string;
  value?: string;
  nets: Map<string, string>;
}

export interface PlacementResult {
  placedComponents: PlacedComponent[];
  score: number;
  iterations: number;
  timeMs: number;
  success: boolean;
  errors: PlacementError[];
  unplacedComponents: PlacementSpec[];
}

export interface PlacementError {
  code: string;
  message: string;
  componentId?: string;
  coordinate?: Coordinate;
}

export interface PlacementContext {
  board: BoardState;
  circuit: Circuit;
  nets: Net[];
  placedComponents: PlacedComponent[];
  lockedComponents: Set<string>;
  availablePositions: Coordinate[];
  config: PlacementConfig;
  rng: SeededRandom;
}

/**
 * Deterministic seeded random number generator (LCG).
 * Guarantees reproducible placement for identical seeds.
 */
export class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed >>> 0;
  }
  
  next(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
  
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export type { BoardState, Coordinate } from '../board/types';
export type { Component, Footprint, PlacedComponent } from '../footprints/types';
export type { Circuit, Net } from '../circuit/types';