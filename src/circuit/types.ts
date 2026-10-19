/**
 * Circuit and netlist type definitions
 */

import { Footprint } from '../footprints/types';

export interface Net {
  id: string;
  name: string;
  pins: NetPin[];
  color?: string;
  isPower?: boolean;
  isGround?: boolean;
}

export interface NetPin {
  componentId: string;
  pinId: string;
  pinName: string;
  pinNumber: string;
}

export interface Circuit {
  id: string;
  name: string;
  description?: string;
  components: CircuitComponent[];
  nets: Net[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface CircuitComponent {
  id: string;
  footprintId: string;
  reference: string;
  value?: string;
  pins: Map<string, string>; // pinId -> netId
  metadata?: Record<string, unknown>;
}

export interface CircuitValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  componentId?: string;
  netId?: string;
  pinId?: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  code: string;
  message: string;
  componentId?: string;
  netId?: string;
  pinId?: string;
}

export interface JsonCircuitFormat {
  version: string;
  circuit: {
    name: string;
    description?: string;
    components: JsonComponent[];
    nets: JsonNet[];
  };
}

export interface JsonComponent {
  id: string;
  footprintId: string;
  reference: string;
  value?: string;
  pins: JsonPinMapping[];
}

export interface JsonPinMapping {
  pinId: string;
  netName: string;
}

export interface JsonNet {
  name: string;
  color?: string;
  isPower?: boolean;
  isGround?: boolean;
}

export function createEmptyCircuit(name: string = 'Untitled Circuit'): Circuit {
  return {
    id: crypto.randomUUID(),
    name,
    components: [],
    nets: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function addComponentToCircuit(circuit: Circuit, component: CircuitComponent): Circuit {
  return {
    ...circuit,
    components: [...circuit.components, component],
    updatedAt: Date.now(),
  };
}

export function removeComponentFromCircuit(circuit: Circuit, componentId: string): Circuit {
  return {
    ...circuit,
    components: circuit.components.filter(c => c.id !== componentId),
    nets: circuit.nets.map(net => ({
      ...net,
      pins: net.pins.filter(p => p.componentId !== componentId),
    })).filter(net => net.pins.length > 0),
    updatedAt: Date.now(),
  };
}

export function addNetToCircuit(circuit: Circuit, net: Net): Circuit {
  return {
    ...circuit,
    nets: [...circuit.nets, net],
    updatedAt: Date.now(),
  };
}

export function connectPinToNet(circuit: Circuit, componentId: string, pinId: string, netId: string): Circuit {
  const component = circuit.components.find(c => c.id === componentId);
  if (!component) return circuit;
  
  const net = circuit.nets.find(n => n.id === netId);
  if (!net) return circuit;
  
  const footprint = getFootprintById(component.footprintId);
  const pin = footprint?.pins.find(p => p.id === pinId);
  if (!pin) return circuit;
  
  const newComponents = circuit.components.map(c => {
    if (c.id === componentId) {
      const newPins = new Map(c.pins);
      newPins.set(pinId, netId);
      return { ...c, pins: newPins };
    }
    return c;
  });
  
  const newNets = circuit.nets.map(n => {
    if (n.id === netId) {
      const existingPin = n.pins.find(p => p.componentId === componentId && p.pinId === pinId);
      if (existingPin) return n;
      return {
        ...n,
        pins: [...n.pins, {
          componentId,
          pinId,
          pinName: pin.name,
          pinNumber: pin.number,
        }],
      };
    }
    return n;
  });
  
  return {
    ...circuit,
    components: newComponents,
    nets: newNets,
    updatedAt: Date.now(),
  };
}

export function disconnectPinFromNet(circuit: Circuit, componentId: string, pinId: string): Circuit {
  const component = circuit.components.find(c => c.id === componentId);
  if (!component) return circuit;
  
  const netId = component.pins.get(pinId);
  if (!netId) return circuit;
  
  const newComponents = circuit.components.map(c => {
    if (c.id === componentId) {
      const newPins = new Map(c.pins);
      newPins.delete(pinId);
      return { ...c, pins: newPins };
    }
    return c;
  });
  
  const newNets = circuit.nets.map(n => {
    if (n.id === netId) {
      return {
        ...n,
        pins: n.pins.filter(p => !(p.componentId === componentId && p.pinId === pinId)),
      };
    }
    return n;
  }).filter(n => n.pins.length > 0);
  
  return {
    ...circuit,
    components: newComponents,
    nets: newNets,
    updatedAt: Date.now(),
  };
}

export function validateCircuit(circuit: Circuit, footprints: Map<string, Footprint>): CircuitValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Check for duplicate references
  const refs = new Map<string, string[]>();
  for (const comp of circuit.components) {
    const list = refs.get(comp.reference) || [];
    list.push(comp.id);
    refs.set(comp.reference, list);
  }
  for (const [ref, ids] of refs) {
    if (ids.length > 1) {
      errors.push({
        code: 'DUPLICATE_REFERENCE',
        message: `Duplicate reference designator: ${ref}`,
        componentId: ids[1],
        severity: 'error',
      });
    }
  }
  
  // Check each component has valid footprint
  for (const comp of circuit.components) {
    const footprint = footprints.get(comp.footprintId);
    if (!footprint) {
      errors.push({
        code: 'MISSING_FOOTPRINT',
        message: `Component ${comp.reference} references missing footprint ${comp.footprintId}`,
        componentId: comp.id,
        severity: 'error',
      });
      continue;
    }
    
    // Check all footprint pins are accounted for
    for (const pin of footprint.pins) {
      if (!comp.pins.has(pin.id)) {
        warnings.push({
          code: 'UNCONNECTED_PIN',
          message: `Pin ${pin.number} (${pin.name}) of ${comp.reference} is not connected to any net`,
          componentId: comp.id,
          pinId: pin.id,
        });
      }
    }
    
    // Check for pins connected to non-existent nets
    for (const [pinId, netId] of comp.pins) {
      if (!circuit.nets.some(n => n.id === netId)) {
        errors.push({
          code: 'INVALID_NET_REFERENCE',
          message: `Pin ${pinId} of ${comp.reference} references non-existent net ${netId}`,
          componentId: comp.id,
          pinId,
          netId,
          severity: 'error',
        });
      }
    }
  }
  
  // Check nets have at least 2 pins (unless power/ground)
  for (const net of circuit.nets) {
    if (net.pins.length === 1 && !net.isPower && !net.isGround) {
      warnings.push({
        code: 'SINGLETON_NET',
        message: `Net "${net.name}" has only one connection`,
        netId: net.id,
      });
    }
    if (net.pins.length === 0) {
      warnings.push({
        code: 'EMPTY_NET',
        message: `Net "${net.name}" has no connections`,
        netId: net.id,
      });
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Footprint registry - re-exported from footprints module (single source of truth)
export { 
  registerFootprint, 
  getFootprintById, 
  getAllFootprints, 
  getFootprintsByCategory,
  searchFootprintRegistry,
} from '../footprints/types';

// Import for use within this module
import { getFootprintById } from '../footprints/types';

export function circuitToJson(circuit: Circuit): JsonCircuitFormat {
  return {
    version: '1.0',
    circuit: {
      name: circuit.name,
      description: circuit.description,
      components: circuit.components.map(c => ({
        id: c.id,
        footprintId: c.footprintId,
        reference: c.reference,
        value: c.value,
        pins: Array.from(c.pins.entries()).map(([pinId, netId]) => {
          const net = circuit.nets.find(n => n.id === netId);
          return { pinId, netName: net?.name || '' };
        }),
      })),
      nets: circuit.nets.map(n => ({
        name: n.name,
        color: n.color,
        isPower: n.isPower,
        isGround: n.isGround,
      })),
    },
  };
}

export function jsonToCircuit(json: JsonCircuitFormat): Circuit {
  const circuit = createEmptyCircuit(json.circuit.name);
  circuit.description = json.circuit.description;
  
  // First pass: create components
  const netNameToId = new Map<string, string>();
  const tempComponents: CircuitComponent[] = [];
  
  for (const jc of json.circuit.components) {
    const component: CircuitComponent = {
      id: jc.id,
      footprintId: jc.footprintId,
      reference: jc.reference,
      value: jc.value,
      pins: new Map(),
    };
    tempComponents.push(component);
  }
  
  // Create nets
  const nets: Net[] = [];
  for (const jn of json.circuit.nets) {
    const net: Net = {
      id: crypto.randomUUID(),
      name: jn.name,
      pins: [],
      color: jn.color,
      isPower: jn.isPower,
      isGround: jn.isGround,
    };
    nets.push(net);
    netNameToId.set(jn.name, net.id);
  }
  
  // Connect pins to nets
  for (const jc of json.circuit.components) {
    const component = tempComponents.find(c => c.id === jc.id)!;
    for (const jp of jc.pins) {
      const netId = netNameToId.get(jp.netName);
      if (netId) {
        component.pins.set(jp.pinId, netId);
        const net = nets.find(n => n.id === netId)!;
        const footprint = getFootprintById(component.footprintId);
        const pin = footprint?.pins.find(p => p.id === jp.pinId);
        if (pin) {
          net.pins.push({
            componentId: component.id,
            pinId: jp.pinId,
            pinName: pin.name,
            pinNumber: pin.number,
          });
        }
      }
    }
  }
  
  return {
    ...circuit,
    components: tempComponents,
    nets,
  };
}