/**
 * Soldering assistant and assembly guide types
 */

import { Coordinate, coordToLabel } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import { Route } from '../routing/types';
import { extractJumperRuns } from '../routing/metrics';

export type AssemblyStepType = 
  | 'place-component'
  | 'solder-pin'
  | 'install-jumper'
  | 'cut-track'
  | 'add-bridge'
  | 'verify-connection'
  | 'inspect';

export type AssemblyGroupBy = 'component' | 'net' | 'side' | 'sequence';

export interface AssemblyStep {
  id: string;
  type: AssemblyStepType;
  order: number;
  description: string;
  detailedDescription?: string;
  componentId?: string;
  componentRef?: string;
  pinId?: string;
  pinName?: string;
  pinNumber?: string;
  coordinates: Coordinate[];
  netId?: string;
  netName?: string;
  routeId?: string;
  wireLength?: number;
  wireSide?: 'solder' | 'component';
  completed: boolean;
  highlightedCoords: Coordinate[];
  estimatedTimeSeconds?: number;
  tools?: string[];
  notes?: string;
}

export interface AssemblyGuide {
  id: string;
  circuitName: string;
  boardName: string;
  createdAt: number;
  steps: AssemblyStep[];
  totalSteps: number;
  completedSteps: number;
  estimatedTotalTimeSeconds: number;
  groupedSteps: Map<AssemblyGroupBy, AssemblyStep[][]>;
}

export interface AssemblyProgress {
  guideId: string;
  currentStepIndex: number;
  completedStepIds: Set<string>;
  startedAt: number;
  completedAt?: number;
}

export interface SolderingChecklist {
  id: string;
  guideId: string;
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
}

export interface ChecklistItem {
  id: string;
  stepId: string;
  description: string;
  category: 'component' | 'jumper' | 'track-cut' | 'verification' | 'inspection';
  required: boolean;
  completed: boolean;
  verifiedBy?: string;
  verifiedAt?: number;
}

export function generateAssemblyGuide(
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[],
  boardName: string,
  circuitName: string
): AssemblyGuide {
  const steps: AssemblyStep[] = [];
  let order = 0;
  
  // Group 1: Place all components
  for (const comp of components) {
    const bbox = comp.boundingBox;
    const centerCoord = {
      row: Math.floor((bbox.minRow + bbox.maxRow) / 2),
      col: Math.floor((bbox.minCol + bbox.maxCol) / 2),
    };
    
    steps.push({
      id: crypto.randomUUID(),
      type: 'place-component',
      order: order++,
      description: `Place ${comp.reference} (${comp.value || ''}) at ${coordToLabel(centerCoord)}`,
      detailedDescription: `Position ${comp.reference} with its pins aligned to the correct holes. Orientation: ${orientationToString(comp.orientation)}°`,
      componentId: comp.id,
      componentRef: comp.reference,
      coordinates: [centerCoord],
      highlightedCoords: Array.from(comp.pinPositions.values()),
      completed: false,
      estimatedTimeSeconds: 15,
      tools: ['tweezers', 'magnifying glass'],
    });
  }
  
  // Group 2: Solder component pins
  for (const comp of components) {
    for (const [pinId, coord] of comp.pinPositions) {
      const pin = comp.footprint.pins.find(p => p.id === pinId);
      const netId = comp.nets.get(pinId);
      const net = nets.find(n => n.id === netId);
      
      steps.push({
        id: crypto.randomUUID(),
        type: 'solder-pin',
        order: order++,
        description: `Solder ${comp.reference} pin ${pin?.number || pinId} (${pin?.name || ''}) at ${coordToLabel(coord)}`,
        componentId: comp.id,
        componentRef: comp.reference,
        pinId,
        pinName: pin?.name,
        pinNumber: pin?.number,
        coordinates: [coord],
        netId,
        netName: net?.name,
        highlightedCoords: [coord],
        completed: false,
        estimatedTimeSeconds: 10,
        tools: ['soldering iron', 'solder'],
        notes: pin?.isPolarized ? `Polarized pin: ${pin.polarity}` : undefined,
      });
    }
  }
  
  // Group 3: Install jumpers
  for (const route of routes) {
    if (route.manual) continue; // Skip manual routes for now
    if (route.segments.length === 0) continue; // Net fully handled by strips — no wire to install
    
    const net = nets.find(n => n.id === route.netId);
    
    // Group contiguous segments into individual jumpers
    const jumpers = extractJumperRuns(route).map(run => ({
      ...run,
      length: Math.round(run.lengthHoles * 2.54),
    }));
    
    for (const jumper of jumpers) {
      steps.push({
        id: crypto.randomUUID(),
        type: 'install-jumper',
        order: order++,
        description: `Install jumper ${jumper.id.slice(0, 8)} for net "${net?.name || route.netId}" from ${coordToLabel(jumper.from)} to ${coordToLabel(jumper.to)}`,
        detailedDescription: `Cut and install a ${jumper.length}mm jumper wire on the ${jumper.layer} side`,
        netId: route.netId,
        netName: net?.name,
        routeId: route.id,
        coordinates: [jumper.from, jumper.to],
        wireLength: jumper.length,
        wireSide: jumper.layer === 'solder' ? 'solder' : 'component',
        highlightedCoords: [jumper.from, jumper.to],
        completed: false,
        estimatedTimeSeconds: 30,
        tools: ['wire cutters', 'wire strippers', 'soldering iron', 'solder'],
      });
    }
  }
  
  // Group 4: Track cuts for stripboard
  // This would be added based on stripboard track cuts needed
  
  // Group 5: Verification steps
  for (const net of nets) {
    if (net.isPower || net.isGround) continue;
    if (net.pins.length < 2) continue;
    
    steps.push({
      id: crypto.randomUUID(),
      type: 'verify-connection',
      order: order++,
      description: `Verify continuity of net "${net.name}"`,
      detailedDescription: `Use a multimeter to check all pins of net "${net.name}" are connected`,
      netId: net.id,
      netName: net.name,
      coordinates: [],
      highlightedCoords: [],
      completed: false,
      estimatedTimeSeconds: 20,
      tools: ['multimeter'],
    });
  }
  
  // Final inspection
  steps.push({
    id: crypto.randomUUID(),
    type: 'inspect',
    order: order++,
    description: 'Final visual inspection',
    detailedDescription: 'Check for solder bridges, cold joints, missing components, and correct orientations',
    coordinates: [],
    highlightedCoords: [],
    completed: false,
    estimatedTimeSeconds: 60,
    tools: ['magnifying glass', 'multimeter'],
  });
  
  const groupedSteps = new Map<AssemblyGroupBy, AssemblyStep[][]>();
  
  // Group by component
  const byComponent = new Map<string, AssemblyStep[]>();
  for (const step of steps) {
    if (step.componentId) {
      const arr = byComponent.get(step.componentId) || [];
      arr.push(step);
      byComponent.set(step.componentId, arr);
    }
  }
  groupedSteps.set('component', Array.from(byComponent.values()));
  
  // Group by net
  const byNet = new Map<string, AssemblyStep[]>();
  for (const step of steps) {
    if (step.netId) {
      const arr = byNet.get(step.netId) || [];
      arr.push(step);
      byNet.set(step.netId, arr);
    }
  }
  groupedSteps.set('net', Array.from(byNet.values()));
  
  // Group by side
  const bySide = new Map<string, AssemblyStep[]>();
  for (const step of steps) {
    const side = step.wireSide || 'component';
    const arr = bySide.get(side) || [];
    arr.push(step);
    bySide.set(side, arr);
  }
  groupedSteps.set('side', Array.from(bySide.values()));
  
  // Group by sequence (default)
  groupedSteps.set('sequence', [steps]);
  
  return {
    id: crypto.randomUUID(),
    circuitName,
    boardName,
    createdAt: Date.now(),
    steps,
    totalSteps: steps.length,
    completedSteps: 0,
    estimatedTotalTimeSeconds: steps.reduce((sum, s) => sum + (s.estimatedTimeSeconds || 0), 0),
    groupedSteps,
  };
}

function orientationToString(orientation: number): string {
  switch (orientation) {
    case 0: return '0';
    case 90: return '90';
    case 180: return '180';
    case 270: return '270';
    default: return '0';
  }
}

export function createAssemblyProgress(guide: AssemblyGuide): AssemblyProgress {
  return {
    guideId: guide.id,
    currentStepIndex: 0,
    completedStepIds: new Set(),
    startedAt: Date.now(),
  };
}

export function createChecklist(guide: AssemblyGuide): SolderingChecklist {
  const items: ChecklistItem[] = [];
  
  for (const step of guide.steps) {
    let category: ChecklistItem['category'] = 'component';
    if (step.type === 'install-jumper') category = 'jumper';
    else if (step.type === 'cut-track') category = 'track-cut';
    else if (step.type === 'verify-connection') category = 'verification';
    else if (step.type === 'inspect') category = 'inspection';
    
    items.push({
      id: crypto.randomUUID(),
      stepId: step.id,
      description: step.description,
      category,
      required: true,
      completed: false,
    });
  }
  
  return {
    id: crypto.randomUUID(),
    guideId: guide.id,
    items,
    completedCount: 0,
    totalCount: items.length,
  };
}

/**
 * Apply a step completion change to assembly progress.
 * The guide is required so the helper can advance the current step pointer
 * and detect when every step has been completed.
 */
export function updateStepProgress(
  guide: AssemblyGuide,
  progress: AssemblyProgress,
  stepId: string,
  completed: boolean
): AssemblyProgress {
  const newCompleted = new Set(progress.completedStepIds);
  if (completed) {
    newCompleted.add(stepId);
  } else {
    newCompleted.delete(stepId);
  }
  
  let currentStepIndex = progress.currentStepIndex;
  if (completed && currentStepIndex < guide.steps.length - 1) {
    currentStepIndex++;
  }
  
  return {
    ...progress,
    completedStepIds: newCompleted,
    currentStepIndex,
    completedAt: newCompleted.size === guide.steps.length ? Date.now() : undefined,
  };
}

export function getCurrentStep(guide: AssemblyGuide, progress: AssemblyProgress): AssemblyStep | null {
  if (progress.currentStepIndex >= 0 && progress.currentStepIndex < guide.steps.length) {
    return guide.steps[progress.currentStepIndex];
  }
  return null;
}

export function getNextStep(guide: AssemblyGuide, progress: AssemblyProgress): AssemblyStep | null {
  const nextIndex = progress.currentStepIndex + 1;
  if (nextIndex < guide.steps.length) {
    return guide.steps[nextIndex];
  }
  return null;
}

export function getPreviousStep(guide: AssemblyGuide, progress: AssemblyProgress): AssemblyStep | null {
  const prevIndex = progress.currentStepIndex - 1;
  if (prevIndex >= 0) {
    return guide.steps[prevIndex];
  }
  return null;
}

export type { Coordinate } from '../board/types';
export type { PlacedComponent } from '../footprints/types';
export type { Net } from '../circuit/types';
export type { Route } from '../routing/types';
