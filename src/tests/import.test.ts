import { describe, it, expect, beforeAll } from 'vitest';
import {
  importCircuitText,
  importCircuitJson,
  importKiCadNetlist,
  mapKiCadFootprintToBuiltIn,
} from '../circuit/import';
import { circuitToJson, createEmptyCircuit } from '../circuit/types';
import { registerAllStandardFootprints } from '../footprints/library';

beforeAll(() => {
  registerAllStandardFootprints();
});

// A realistic KiCad 7 netlist export (abridged to the parts we import)
const KICAD_NETLIST = `(export (version "E")
  (design
    (source "/home/user/led_blink.kicad_sch")
    (date "2026-10-19 12:00:00")
    (tool "Eeschema 7.0.0")
    (sheet (number "1") (name "/") (tstamps "/")
      (title_block
        (title "LED Blink")
        (rev "1")
      )
    )
  )
  (components
    (comp (ref "R1")
      (value "330")
      (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal")
      (datasheet "~")
    )
    (comp (ref "D1")
      (value "Red")
      (footprint "LED_THT:LED_D5.0mm")
      (datasheet "~")
    )
    (comp (ref "U1")
      (value "ATtiny85")
      (footprint "Package_DIP:DIP-8_W7.62mm")
      (datasheet "~")
    )
    (comp (ref "X1")
      (value "SMD junk")
      (footprint "Resistor_SMD:R_0805_2012Metric")
      (datasheet "~")
    )
  )
  (nets
    (net (code "1") (name "VCC")
      (node (ref "R1") (pin "1") (pinfunction "~") (pintype "passive"))
      (node (ref "U1") (pin "8") (pinfunction "VCC") (pintype "power_in"))
    )
    (net (code "2") (name "GND")
      (node (ref "D1") (pin "2") (pinfunction "K") (pintype "passive"))
      (node (ref "U1") (pin "4") (pinfunction "GND") (pintype "power_in"))
    )
    (net (code "3") (name "LED_A")
      (node (ref "R1") (pin "2") (pinfunction "~") (pintype "passive"))
      (node (ref "D1") (pin "1") (pinfunction "A") (pintype "passive"))
    )
    (net (code "4") (name "unconnected-(U1-Pad1)")
      (node (ref "U1") (pin "1") (pinfunction "PB5") (pintype "bidirectional"))
    )
  )
)`;

describe('KiCad netlist import', () => {
  it('imports components, nets and pin connections', () => {
    const result = importKiCadNetlist(KICAD_NETLIST);

    expect(result.circuit).not.toBeNull();
    const circuit = result.circuit!;

    // R1, D1, U1 imported; the SMD part (X1) is skipped and reported
    expect(circuit.components.map(c => c.reference).sort()).toEqual(['D1', 'R1', 'U1']);
    expect(result.errors.some(e => e.includes('X1') && e.includes('no matching built-in footprint'))).toBe(true);

    // Components use built-in footprints
    const r1 = circuit.components.find(c => c.reference === 'R1')!;
    const u1 = circuit.components.find(c => c.reference === 'U1')!;
    expect(r1.footprintId).toBe('resistor-axial');
    expect(u1.footprintId).toBe('dip-8');
    expect(r1.value).toBe('330');

    // Nets exist with expected pin memberships
    const vcc = circuit.nets.find(n => n.name === 'VCC')!;
    const gnd = circuit.nets.find(n => n.name === 'GND')!;
    const ledA = circuit.nets.find(n => n.name === 'LED_A')!;
    expect(vcc.pins.length).toBe(2);
    expect(gnd.pins.length).toBe(2);
    expect(ledA.pins.length).toBe(2);

    // Power flags inferred from net names
    expect(vcc.isPower).toBe(true);
    expect(gnd.isGround).toBe(true);

    // Pin maps on the components point at the correct nets
    expect(r1.pins.get('p1')).toBe(vcc.id);
    expect(r1.pins.get('p2')).toBe(ledA.id);
    expect(u1.pins.get('p4')).toBe(gnd.id);
    expect(u1.pins.get('p8')).toBe(vcc.id);

    // KiCad pseudo-nets for unconnected pins are not imported
    expect(circuit.nets.some(n => n.name.startsWith('unconnected-'))).toBe(false);
  });

  it('reports pins that do not exist on the mapped footprint', () => {
    const netlist = `(export (version "E")
  (components
    (comp (ref "U1") (value "X") (footprint "Package_DIP:DIP-8_W7.62mm"))
  )
  (nets
    (net (code "1") (name "SIG")
      (node (ref "U1") (pin "42") (pintype "passive"))
    )
  )
)`;

    const result = importKiCadNetlist(netlist);

    expect(result.circuit).not.toBeNull();
    expect(result.circuit!.components.length).toBe(1);
    expect(result.circuit!.nets[0].pins.length).toBe(0);
    expect(result.errors.some(e => e.includes('pin 42'))).toBe(true);
  });

  it('rejects text that is not a netlist', () => {
    const result = importKiCadNetlist('hello world');
    expect(result.circuit).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('KiCad footprint mapping', () => {
  it('maps common through-hole footprints', () => {
    expect(mapKiCadFootprintToBuiltIn('Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm', 'R1')).toBe('resistor-axial');
    expect(mapKiCadFootprintToBuiltIn('LED_THT:LED_D5.0mm', 'D1')).toBe('led-5mm');
    expect(mapKiCadFootprintToBuiltIn('LED_THT:LED_D3.0mm', 'D1')).toBe('led-3mm');
    expect(mapKiCadFootprintToBuiltIn('Package_DIP:DIP-14_W7.62mm', 'U1')).toBe('dip-14');
    expect(mapKiCadFootprintToBuiltIn('Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', 'D1')).toBe('diode-1n4148');
    expect(mapKiCadFootprintToBuiltIn('Diode_Bridge_DIP-4_W7.62mm', 'D1')).toBe('diode-bridge');
    expect(mapKiCadFootprintToBuiltIn('Crystal:Crystal_HC49-U_Vertical', 'Y1')).toBe('crystal-hc49');
    expect(mapKiCadFootprintToBuiltIn('Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', 'J1')).toBe('pin-header-1x4');
    expect(mapKiCadFootprintToBuiltIn('TerminalBlock:TerminalBlock_bornier-2_P5.08mm', 'J1')).toBe('screw-terminal-2');
    expect(mapKiCadFootprintToBuiltIn('Package_TO_SOT_THT:TO-92_Inline', 'VR1')).toBe('regulator-to92');
    expect(mapKiCadFootprintToBuiltIn('Package_TO_SOT_THT:TO-92_Inline', 'Q1')).toBe('transistor-to92-ebc');
  });

  it('refuses SMD and unknown footprints instead of guessing', () => {
    expect(mapKiCadFootprintToBuiltIn('Resistor_SMD:R_0805_2012Metric', 'R1')).toBeNull();
    expect(mapKiCadFootprintToBuiltIn('LED_SMD:LED_0603_1608Metric', 'D1')).toBeNull();
    expect(mapKiCadFootprintToBuiltIn('Package_QFP:LQFP-48_7x7mm_P0.5mm', 'U1')).toBeNull();
    expect(mapKiCadFootprintToBuiltIn('', 'X1')).toBeNull();
  });
});

describe('Circuit JSON import', () => {
  it('round-trips the documented JSON format', () => {
    // Build a circuit with 2 components and 2 nets programmatically
    const original = createEmptyCircuit('Round Trip');
    const r1Id = '11111111-1111-4111-8111-111111111111';
    const d1Id = '22222222-2222-4222-8222-222222222222';
    const vccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ledId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    original.components = [
      { id: r1Id, footprintId: 'resistor-axial', reference: 'R1', value: '10k', pins: new Map([['p1', vccId], ['p2', ledId]]) },
      { id: d1Id, footprintId: 'led-5mm', reference: 'D1', value: 'Red', pins: new Map([['p1', ledId], ['p2', vccId]]) },
    ];
    original.nets = [
      { id: vccId, name: 'VCC', pins: [], isPower: true },
      { id: ledId, name: 'LED_A', pins: [] },
    ];

    const json = JSON.stringify(circuitToJson(original), null, 2);
    const result = importCircuitJson(json);

    expect(result.errors).toEqual([]);
    expect(result.circuit).not.toBeNull();
    const imported = result.circuit!;

    expect(imported.name).toBe('Round Trip');
    expect(imported.components.length).toBe(2);
    expect(imported.nets.length).toBe(2);

    const r1 = imported.components.find(c => c.reference === 'R1')!;
    const vcc = imported.nets.find(n => n.name === 'VCC')!;
    const ledA = imported.nets.find(n => n.name === 'LED_A')!;

    // Pin maps were rebuilt with the NEW net ids
    expect(r1.pins.get('p1')).toBe(vcc.id);
    expect(r1.pins.get('p2')).toBe(ledA.id);
    expect(vcc.isPower).toBe(true);
  });

  it('skips components whose footprint is not in the library', () => {
    const json = JSON.stringify({
      version: '1.0',
      circuit: {
        name: 'Bad parts',
        components: [
          { id: 'c1', footprintId: 'nonexistent-part', reference: 'U9', pins: [] },
          { id: 'c2', footprintId: 'resistor-axial', reference: 'R1', pins: [] },
        ],
        nets: [],
      },
    });

    const result = importCircuitJson(json);

    expect(result.circuit).not.toBeNull();
    expect(result.circuit!.components.map(c => c.reference)).toEqual(['R1']);
    expect(result.errors.some(e => e.includes('U9') && e.includes('nonexistent-part'))).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(importCircuitJson('{ not json').circuit).toBeNull();
    expect(importCircuitJson('{"version":"1.0"}').circuit).toBeNull();
  });
});

describe('Auto-detection', () => {
  it('picks the JSON parser for JSON input and the netlist parser for S-expressions', () => {
    const jsonResult = importCircuitText(JSON.stringify({
      version: '1.0',
      circuit: {
        name: 'J',
        components: [{ id: 'c1', footprintId: 'resistor-axial', reference: 'R1', pins: [] }],
        nets: [],
      },
    }));
    expect(jsonResult.circuit?.name).toBe('J');

    const netlistResult = importCircuitText(KICAD_NETLIST);
    expect(netlistResult.circuit?.components.length).toBe(3);
  });

  it('reports unrecognised input', () => {
    const result = importCircuitText('just some text');
    expect(result.circuit).toBeNull();
    expect(result.errors[0]).toContain('Unrecognised input');
  });
});
