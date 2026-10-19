/**
 * Circuit importers.
 *
 * Two documented input formats are supported:
 *
 * 1. ZeroPCB Studio circuit JSON — the format produced by `circuitToJson`,
 *    i.e. `{ version, circuit: { name, components: [{ footprintId, reference,
 *    value, pins: [{ pinId, netName }] }], nets: [{ name, ... }] } }`.
 *
 * 2. KiCad netlist files (.net) exported from Eeschema — parsed best-effort:
 *    KiCad footprints are mapped to built-in footprints when a confident
 *    match exists. Anything that cannot be mapped (or pins that do not exist
 *    on the mapped footprint) is reported as an error and never guessed.
 */

import {
  Circuit,
  CircuitComponent,
  JsonCircuitFormat,
  JsonComponent,
  Net,
  createEmptyCircuit,
  jsonToCircuit,
} from './types';
import { getFootprintById } from '../footprints/types';

export interface CircuitImportResult {
  /** Imported circuit, or null when nothing could be imported */
  circuit: Circuit | null;
  warnings: string[];
  errors: string[];
}

/** Import a circuit from JSON or KiCad netlist text (auto-detected). */
export function importCircuitText(text: string): CircuitImportResult {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return importCircuitJson(trimmed);
  if (trimmed.startsWith('(') || trimmed.startsWith(';')) return importKiCadNetlist(trimmed);
  return {
    circuit: null,
    warnings: [],
    errors: [
      'Unrecognised input: expected circuit JSON (starts with "{") or a KiCad netlist (starts with "(").',
    ],
  };
}

// ============ JSON import ============

export function importCircuitJson(text: string): CircuitImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let data: JsonCircuitFormat;
  try {
    data = JSON.parse(text) as JsonCircuitFormat;
  } catch (e) {
    return {
      circuit: null,
      warnings,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`],
    };
  }

  if (!data || typeof data !== 'object' || !data.circuit || !Array.isArray(data.circuit.components)) {
    return {
      circuit: null,
      warnings,
      errors: ['Invalid circuit JSON: expected { version, circuit: { name, components, nets } }.'],
    };
  }

  // Skip components whose footprint is not in the library instead of silently importing them
  const kept: JsonComponent[] = [];
  for (const comp of data.circuit.components) {
    if (!comp.reference || !comp.footprintId) {
      errors.push('Skipped a component entry without reference/footprintId.');
      continue;
    }
    if (!getFootprintById(comp.footprintId)) {
      errors.push(
        `Component ${comp.reference}: footprint "${comp.footprintId}" is not in the footprint library (skipped).`
      );
      continue;
    }
    kept.push(comp);
  }

  try {
    const circuit = jsonToCircuit({
      ...data,
      circuit: { ...data.circuit, components: kept, nets: data.circuit.nets || [] },
    });
    if (circuit.components.length === 0) {
      errors.push('No importable components found.');
      return { circuit: null, warnings, errors };
    }
    return { circuit, warnings, errors };
  } catch (e) {
    return {
      circuit: null,
      warnings,
      errors: [`Failed to build circuit: ${e instanceof Error ? e.message : 'unknown error'}`],
    };
  }
}

// ============ KiCad netlist import ============

/**
 * Map a KiCad footprint string to a built-in footprint id.
 * Returns null when no confident match exists (SMD packages, exotic parts).
 */
export function mapKiCadFootprintToBuiltIn(kicadFootprint: string, reference: string): string | null {
  const fp = kicadFootprint.toLowerCase();
  const prefix = reference.replace(/\d+$/, '').toUpperCase();

  // Bridge rectifier first (its KiCad footprint contains "DIP-4")
  if (fp.includes('diode_bridge') || fp.includes('bridge')) return 'diode-bridge';

  // Resistors
  if (/r_axial/.test(fp)) return 'resistor-axial';
  if (/^r_\d|r_0\d{3}|r_1\d{3}|smd/.test(fp) && !/r_axial/.test(fp)) return null;

  // LEDs
  if (fp.includes('led')) {
    if (/d5\.0|d5mm|led-5|led_5/.test(fp)) return 'led-5mm';
    if (/d3\.0|d3mm|led-3|led_3/.test(fp)) return 'led-3mm';
    // SMD / unknown LED packages are not supported
    if (/smd|0805|0603|1206|0402|plcc/.test(fp)) return null;
    return 'led-5mm'; // KiCad's classic through-hole LED package is 5 mm
  }

  // Diodes
  if (fp.includes('do-35')) return 'diode-1n4148';
  if (fp.includes('do-41')) return 'diode-1n4007';

  // Capacitors
  if (/c_elec|c_polarized|cp_|capacitor.*electro/.test(fp)) return 'capacitor-electrolytic';
  if (/c_tantal|tantalum/.test(fp)) return 'capacitor-tantalum';
  if (/c_disc|c_radial|c_0805|c_0603|c_1206|c_0402/.test(fp)) {
    return /c_0805|c_0603|c_1206|c_0402/.test(fp) ? null : 'capacitor-ceramic';
  }

  // DIP ICs
  const dip = fp.match(/dip-?(\d+)/);
  if (dip) {
    const n = parseInt(dip[1], 10);
    if ([4, 6, 8, 14, 16, 18, 20, 28, 40].includes(n)) return `dip-${n}`;
    return null;
  }

  // Transistors / MOSFETs / regulators
  if (fp.includes('to-92') || fp.includes('to92')) {
    if (prefix === 'VR') return 'regulator-to92';
    if (prefix === 'U') return 'regulator-to92';
    return 'transistor-to92-ebc';
  }
  if (fp.includes('to-220') || fp.includes('to220')) {
    if (prefix === 'VR' || prefix === 'U') return 'regulator-to220';
    if (prefix === 'Q') return 'mosfet-to220';
    return 'transistor-to220';
  }

  // Crystals / resonators
  if (/hc-?49/.test(fp)) return 'crystal-hc49';
  if (fp.includes('resonator')) return 'resonator-3pin';

  // Potentiometers
  if (fp.includes('potentiometer')) return 'potentiometer-trimp';

  // Switches / buttons
  if (/sw_push|pushbutton|push_button/.test(fp)) return 'push-button-6mm';
  if (/sw_spdt/.test(fp)) return 'switch-spdt-slide';
  if (/sw_spst|sw_slide|sw_pcb/.test(fp)) return 'switch-spst-slide';
  if (/sw_dip.*4|sw_dip_x04/.test(fp)) return 'switch-dip-4';

  // Power connectors
  if (/barreljack|barrel_jack|barrel/.test(fp)) return 'barrel-jack';
  if (fp.includes('jst')) {
    const n = pinCountFromFootprint(fp);
    if (n === 2) return 'jst-2pin';
    if (n === 3) return 'jst-3pin';
    return null;
  }

  // Screw terminals
  if (/terminalblock|screw_terminal|screw_term/.test(fp)) {
    const n = pinCountFromFootprint(fp);
    if (n === 2) return 'screw-terminal-2';
    if (n === 3) return 'screw-terminal-3';
    if (n === 4) return 'screw-terminal-4';
    return null;
  }

  // Pin headers (also KiCad "Conn_01xNN")
  if (/pinheader|pin_header|conn_01x|conn_02x|generic_conn/.test(fp)) {
    const m = fp.match(/([12])x0?(\d+)/);
    if (m) {
      const rows = parseInt(m[1], 10);
      const n = parseInt(m[2], 10);
      if (n > 0 && n <= 20) return `pin-header-${rows}x${n}`;
    }
    return null;
  }

  return null;
}

/** Extract a pin count from KiCad footprint names like "1x04", "01x02", "bornier-2" */
function pinCountFromFootprint(fp: string): number | null {
  let m = fp.match(/(?:^|[^0-9])(?:0?[12])x0?(\d+)(?:[^0-9]|$)/);
  if (m) return parseInt(m[1], 10);
  m = fp.match(/bornier-(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * Find all blocks of the form `(name ...)` in a KiCad S-expression,
 * skipping nested blocks. Handles quoted strings and escapes.
 */
function findBlocks(text: string, name: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`\\(${name}(?=[\\s()])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = findBlockEnd(text, m.index);
    if (end === -1) break;
    blocks.push(text.slice(m.index, end + 1));
    re.lastIndex = end + 1;
  }
  return blocks;
}

/** Index of the closing paren matching the open paren at `start`, or -1 */
function findBlockEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Read a field like `(ref "R1")` or `(value 10k)` from a block */
function blockField(block: string, field: string): string | null {
  const m = block.match(new RegExp(`\\(${field}\\s+(?:"((?:[^"\\\\]|\\\\.)*)"|([^\\s()]+))`));
  if (!m) return null;
  const raw = m[1] !== undefined ? m[1] : m[2];
  return raw.replace(/\\"/g, '"');
}

function powerFlagsForName(name: string): Partial<Net> {
  const n = name.toUpperCase();
  if (n === 'GND' || n.startsWith('GND') || n === 'VSS' || n.startsWith('VSS')) {
    return { isGround: true };
  }
  const powerNames = ['VCC', 'VDD', 'VBUS', 'VIN', '+5V', '5V', '+3V3', '3V3', '+12V', '12V', '+9V', '9V'];
  if (powerNames.includes(n) || n.startsWith('+')) return { isPower: true };
  return {};
}

export function importKiCadNetlist(text: string): CircuitImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const compBlocks = findBlocks(text, 'comp');
  const netBlocks = findBlocks(text, 'net');

  if (compBlocks.length === 0 && netBlocks.length === 0) {
    return {
      circuit: null,
      warnings,
      errors: ['Not a KiCad netlist: no (comp ...) or (net ...) blocks found.'],
    };
  }

  // Derive a title from the exported source/title block if present
  const title = blockField(text, 'title') || 'Imported KiCad Netlist';
  const circuit = createEmptyCircuit(title);

  // --- Components ---
  const refToComponent = new Map<string, CircuitComponent>();
  for (const block of compBlocks) {
    const ref = blockField(block, 'ref');
    const value = blockField(block, 'value') || undefined;
    const fp = blockField(block, 'footprint') || '';

    if (!ref) {
      errors.push('Skipped a (comp ...) block without a reference designator.');
      continue;
    }
    if (refToComponent.has(ref)) {
      errors.push(`Duplicate reference "${ref}" in netlist — the second entry was skipped.`);
      continue;
    }

    const footprintId = mapKiCadFootprintToBuiltIn(fp, ref);
    if (!footprintId) {
      errors.push(
        `${ref}: KiCad footprint "${fp || '(none)'}" has no matching built-in footprint — component skipped.`
      );
      continue;
    }

    const component: CircuitComponent = {
      id: crypto.randomUUID(),
      footprintId,
      reference: ref,
      value,
      pins: new Map<string, string>(),
    };
    circuit.components.push(component);
    refToComponent.set(ref, component);
  }

  // --- Nets ---
  for (const block of netBlocks) {
    const name = blockField(block, 'name');
    if (!name) continue;

    // KiCad auto-generates pseudo-nets for unconnected pins — not real nets
    if (name.startsWith('unconnected-')) continue;

    const net: Net = {
      id: crypto.randomUUID(),
      name,
      pins: [],
      ...powerFlagsForName(name),
    };

    for (const node of findBlocks(block, 'node')) {
      const ref = blockField(node, 'ref');
      const pinNumber = blockField(node, 'pin');
      if (!ref || !pinNumber) continue;

      const comp = refToComponent.get(ref);
      if (!comp) continue; // the component was skipped above — already reported

      const footprint = getFootprintById(comp.footprintId);
      const pin = footprint?.pins.find(p => p.number === pinNumber);
      if (!pin) {
        errors.push(
          `${ref}: net "${name}" references pin ${pinNumber}, which does not exist on footprint "${comp.footprintId}".`
        );
        continue;
      }
      if (comp.pins.has(pin.id)) {
        const existing = circuit.nets.find(n => n.id === comp.pins.get(pin.id));
        warnings.push(
          `${ref} pin ${pinNumber} appears in multiple nets ("${existing?.name}" and "${name}") — kept the first.`
        );
        continue;
      }

      comp.pins.set(pin.id, net.id);
      net.pins.push({
        componentId: comp.id,
        pinId: pin.id,
        pinName: pin.name,
        pinNumber: pin.number,
      });
    }

    circuit.nets.push(net);
  }

  if (circuit.components.length === 0) {
    errors.push('No importable components found.');
    return { circuit: null, warnings, errors };
  }

  return { circuit, warnings, errors };
}
