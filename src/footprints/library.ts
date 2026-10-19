/**
 * Standard component footprint library
 * All footprints are defined in grid units (holes) with 2.54mm default pitch
 */

import { Footprint, Pin, registerFootprint } from './types';
import { ComponentCategory } from './types';

function pin(id: string, number: string, name: string, row: number, col: number, options?: Partial<Pin>): Pin {
  return {
    id,
    number,
    name,
    offset: { row, col },
    ...options,
  };
}

// ============ RESISTORS ============

export const RESISTOR_AXIAL: Footprint = {
  id: 'resistor-axial',
  name: 'Axial Resistor',
  description: 'Standard axial-lead resistor, 0.4" (10.16mm) lead spacing',
  category: 'resistor',
  pins: [
    pin('p1', '1', 'Lead 1', 0, 0),
    pin('p2', '2', 'Lead 2', 0, 4),
  ],
  width: 5,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 4 },
  isPolarized: false,
};

export const RESISTOR_AXIAL_SHORT: Footprint = {
  id: 'resistor-axial-short',
  name: 'Axial Resistor (short)',
  description: 'Compact axial resistor, 0.3" (7.62mm) lead spacing',
  category: 'resistor',
  pins: [
    pin('p1', '1', 'Lead 1', 0, 0),
    pin('p2', '2', 'Lead 2', 0, 3),
  ],
  width: 4,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 3 },
  isPolarized: false,
};

export const RESISTOR_SMD_0805: Footprint = {
  id: 'resistor-smd-0805',
  name: 'SMD Resistor 0805',
  description: 'Surface mount resistor with lead adapters',
  category: 'resistor',
  pins: [
    pin('p1', '1', 'Pad 1', 0, 0),
    pin('p2', '2', 'Pad 2', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 1, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: false,
};

// ============ CAPACITORS ============

export const CAPACITOR_CERAMIC: Footprint = {
  id: 'capacitor-ceramic',
  name: 'Ceramic Capacitor',
  description: 'Non-polarized ceramic capacitor, 0.1" lead spacing',
  category: 'capacitor',
  pins: [
    pin('p1', '1', 'Lead 1', 0, 0),
    pin('p2', '2', 'Lead 2', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 1, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: false,
};

export const CAPACITOR_ELECTROLYTIC: Footprint = {
  id: 'capacitor-electrolytic',
  name: 'Electrolytic Capacitor',
  description: 'Polarized electrolytic capacitor, 0.1" lead spacing',
  category: 'polarized-capacitor',
  pins: [
    pin('p1', '1', 'Positive (+)', 0, 0, { isPolarized: true, polarity: 'positive' }),
    pin('p2', '2', 'Negative (-)', 0, 2, { isPolarized: true, polarity: 'negative' }),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: true,
  polarizationMark: { type: 'stripe', position: { row: 0, col: 2 }, size: 1 },
};

export const CAPACITOR_TANTALUM: Footprint = {
  id: 'capacitor-tantalum',
  name: 'Tantalum Capacitor',
  description: 'Polarized tantalum capacitor, 0.1" lead spacing',
  category: 'polarized-capacitor',
  pins: [
    pin('p1', '1', 'Positive (+)', 0, 0, { isPolarized: true, polarity: 'positive' }),
    pin('p2', '2', 'Negative (-)', 0, 2, { isPolarized: true, polarity: 'negative' }),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 1, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: true,
  polarizationMark: { type: 'stripe', position: { row: 0, col: 2 }, size: 1 },
};

// ============ LEDs ============

export const LED_3MM: Footprint = {
  id: 'led-3mm',
  name: 'LED 3mm',
  description: 'Standard 3mm LED, 0.1" lead spacing',
  category: 'led',
  pins: [
    pin('p1', '1', 'Anode (+)', 0, 0, { isPolarized: true, polarity: 'anode' }),
    pin('p2', '2', 'Cathode (-)', 0, 2, { isPolarized: true, polarity: 'cathode' }),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 1.2, height: 1.2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 2 }, size: 1 },
};

export const LED_5MM: Footprint = {
  id: 'led-5mm',
  name: 'LED 5mm',
  description: 'Standard 5mm LED, 0.1" lead spacing',
  category: 'led',
  pins: [
    pin('p1', '1', 'Anode (+)', 0, 0, { isPolarized: true, polarity: 'anode' }),
    pin('p2', '2', 'Cathode (-)', 0, 2, { isPolarized: true, polarity: 'cathode' }),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 2 }, size: 1 },
};

// ============ DIODES ============

export const DIODE_1N4148: Footprint = {
  id: 'diode-1n4148',
  name: 'Diode 1N4148',
  description: 'Small signal diode, 0.3" lead spacing',
  category: 'diode',
  pins: [
    pin('p1', '1', 'Anode', 0, 0, { isPolarized: true, polarity: 'anode' }),
    pin('p2', '2', 'Cathode', 0, 3, { isPolarized: true, polarity: 'cathode' }),
  ],
  width: 4,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 1.5, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 3 },
  isPolarized: true,
  polarizationMark: { type: 'stripe', position: { row: 0, col: 3 }, size: 1 },
};

export const DIODE_1N4007: Footprint = {
  id: 'diode-1n4007',
  name: 'Diode 1N400x',
  description: 'Rectifier diode, 0.4" lead spacing',
  category: 'diode',
  pins: [
    pin('p1', '1', 'Anode', 0, 0, { isPolarized: true, polarity: 'anode' }),
    pin('p2', '2', 'Cathode', 0, 4, { isPolarized: true, polarity: 'cathode' }),
  ],
  width: 5,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 4 },
  isPolarized: true,
  polarizationMark: { type: 'stripe', position: { row: 0, col: 4 }, size: 1 },
};

export const DIODE_BRIDGE: Footprint = {
  id: 'diode-bridge',
  name: 'Bridge Rectifier',
  description: 'DIP-4 bridge rectifier',
  category: 'diode',
  pins: [
    pin('p1', '1', '+', 0, 0, { isPolarized: true, polarity: 'positive' }),
    pin('p2', '2', 'AC', 0, 1),
    pin('p3', '3', '-', 0, 2, { isPolarized: true, polarity: 'negative' }),
    pin('p4', '4', 'AC', 0, 3),
  ],
  width: 4,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ TRANSISTORS ============

export const TRANSISTOR_TO92_EBC: Footprint = {
  id: 'transistor-to92-ebc',
  name: 'Transistor TO-92 (E-B-C)',
  description: 'Small signal transistor in TO-92 package',
  category: 'transistor',
  pins: [
    pin('p1', '1', 'Emitter', 0, 0),
    pin('p2', '2', 'Base', 0, 1),
    pin('p3', '3', 'Collector', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 1 }, size: 1 },
};

export const TRANSISTOR_TO92_CBE: Footprint = {
  id: 'transistor-to92-cbe',
  name: 'Transistor TO-92 (C-B-E)',
  description: 'Small signal transistor in TO-92 package, C-B-E pinout',
  category: 'transistor',
  pins: [
    pin('p1', '1', 'Collector', 0, 0),
    pin('p2', '2', 'Base', 0, 1),
    pin('p3', '3', 'Emitter', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 1 }, size: 1 },
};

export const TRANSISTOR_TO220: Footprint = {
  id: 'transistor-to220',
  name: 'Transistor TO-220',
  description: 'Power transistor or regulator in TO-220 package',
  category: 'transistor',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 1),
    pin('p3', '3', 'Pin 3', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1.5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ MOSFETs ============

export const MOSFET_TO92: Footprint = {
  id: 'mosfet-to92',
  name: 'MOSFET TO-92',
  description: 'Small signal MOSFET, G-D-S pinout',
  category: 'mosfet',
  pins: [
    pin('p1', '1', 'Gate', 0, 0),
    pin('p2', '2', 'Drain', 0, 1),
    pin('p3', '3', 'Source', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 1 }, size: 1 },
};

export const MOSFET_TO220: Footprint = {
  id: 'mosfet-to220',
  name: 'MOSFET TO-220',
  description: 'Power MOSFET in TO-220 package',
  category: 'mosfet',
  pins: [
    pin('p1', '1', 'Gate', 0, 0),
    pin('p2', '2', 'Drain', 0, 1),
    pin('p3', '3', 'Source', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1.5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ DIP ICs ============

function createDIPFootprint(pinCount: number, name: string): Footprint {
  const pinsPerSide = pinCount / 2;
  const pins: Pin[] = [];
  
  // Pins 1..pinsPerSide on bottom row (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    pins.push(pin(`p${i + 1}`, `${i + 1}`, `Pin ${i + 1}`, 1, i));
  }
  
  // Pins pinsPerSide+1..pinCount on top row (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    const pinNum = pinsPerSide + i + 1;
    pins.push(pin(`p${pinNum}`, `${pinNum}`, `Pin ${pinNum}`, 0, pinsPerSide - 1 - i));
  }
  
  return {
    id: `dip-${pinCount}`,
    name,
    description: `DIP-${pinCount} integrated circuit`,
    category: 'ic-dip',
    pins,
    width: pinsPerSide,
    height: 2,
    bodyOutline: { type: 'rectangle', width: pinsPerSide, height: 2 },
    supportedOrientations: [0, 90, 180, 270],
    defaultOrientation: 0,
    pinSpacing: { row: 1, col: 1 },
    isPolarized: true,
    polarizationMark: { type: 'notch', position: { row: 1, col: 0 }, size: 1 },
  };
}

export const DIP_4 = createDIPFootprint(4, 'DIP-4');
export const DIP_6 = createDIPFootprint(6, 'DIP-6');
export const DIP_8 = createDIPFootprint(8, 'DIP-8');
export const DIP_14 = createDIPFootprint(14, 'DIP-14');
export const DIP_16 = createDIPFootprint(16, 'DIP-16');
export const DIP_18 = createDIPFootprint(18, 'DIP-18');
export const DIP_20 = createDIPFootprint(20, 'DIP-20');
export const DIP_28 = createDIPFootprint(28, 'DIP-28');
export const DIP_40 = createDIPFootprint(40, 'DIP-40');

// ============ DIP SOCKETS ============

function createDIPSocketFootprint(pinCount: number): Footprint {
  const base = createDIPFootprint(pinCount, `DIP-${pinCount} Socket`);
  return {
    ...base,
    id: `dip-socket-${pinCount}`,
    name: `DIP-${pinCount} Socket`,
    description: `DIP-${pinCount} IC socket`,
    category: 'ic-socket',
  };
}

export const DIP_SOCKET_8 = createDIPSocketFootprint(8);
export const DIP_SOCKET_14 = createDIPSocketFootprint(14);
export const DIP_SOCKET_16 = createDIPSocketFootprint(16);
export const DIP_SOCKET_28 = createDIPSocketFootprint(28);
export const DIP_SOCKET_40 = createDIPSocketFootprint(40);

// ============ PIN HEADERS ============

function createPinHeaderFootprint(pinCount: number): Footprint {
  const pins: Pin[] = [];
  for (let i = 0; i < pinCount; i++) {
    pins.push(pin(`p${i + 1}`, `${i + 1}`, `Pin ${i + 1}`, 0, i));
  }
  
  return {
    id: `pin-header-1x${pinCount}`,
    name: `Pin Header 1x${pinCount}`,
    description: `Single row ${pinCount}-pin header`,
    category: 'pin-header',
    pins,
    width: pinCount,
    height: 1,
    bodyOutline: { type: 'rectangle', width: pinCount, height: 1 },
    supportedOrientations: [0, 90, 180, 270],
    defaultOrientation: 0,
    pinSpacing: { row: 0, col: 1 },
    isPolarized: false,
  };
}

function createPinHeader2RowFootprint(pinCount: number): Footprint {
  const pinsPerRow = pinCount / 2;
  const pins: Pin[] = [];
  
  for (let i = 0; i < pinsPerRow; i++) {
    pins.push(pin(`p${i * 2 + 1}`, `${i * 2 + 1}`, `Pin ${i * 2 + 1}`, 0, i));
    pins.push(pin(`p${i * 2 + 2}`, `${i * 2 + 2}`, `Pin ${i * 2 + 2}`, 1, i));
  }
  
  return {
    id: `pin-header-2x${pinCount}`,
    name: `Pin Header 2x${pinsPerRow}`,
    description: `Double row ${pinCount}-pin header`,
    category: 'pin-header',
    pins,
    width: pinsPerRow,
    height: 2,
    bodyOutline: { type: 'rectangle', width: pinsPerRow, height: 2 },
    supportedOrientations: [0, 90],
    defaultOrientation: 0,
    pinSpacing: { row: 1, col: 1 },
    isPolarized: false,
  };
}

export const PIN_HEADER_1X2 = createPinHeaderFootprint(2);
export const PIN_HEADER_1X3 = createPinHeaderFootprint(3);
export const PIN_HEADER_1X4 = createPinHeaderFootprint(4);
export const PIN_HEADER_1X5 = createPinHeaderFootprint(5);
export const PIN_HEADER_1X6 = createPinHeaderFootprint(6);
export const PIN_HEADER_1X8 = createPinHeaderFootprint(8);
export const PIN_HEADER_1X10 = createPinHeaderFootprint(10);
export const PIN_HEADER_2X3 = createPinHeader2RowFootprint(6);
export const PIN_HEADER_2X4 = createPinHeader2RowFootprint(8);
export const PIN_HEADER_2X5 = createPinHeader2RowFootprint(10);

// ============ SCREW TERMINALS ============

function createScrewTerminalFootprint(pinCount: number): Footprint {
  const pins: Pin[] = [];
  for (let i = 0; i < pinCount; i++) {
    pins.push(pin(`p${i + 1}`, `${i + 1}`, `Terminal ${i + 1}`, 0, i));
  }
  
  return {
    id: `screw-terminal-${pinCount}`,
    name: `${pinCount}-Pin Screw Terminal`,
    description: `${pinCount}-position screw terminal block`,
    category: 'screw-terminal',
    pins,
    width: pinCount,
    height: 1,
    bodyOutline: { type: 'rectangle', width: pinCount, height: 1.5 },
    supportedOrientations: [0, 90, 180, 270],
    defaultOrientation: 0,
    pinSpacing: { row: 0, col: 1 },
    isPolarized: false,
  };
}

export const SCREW_TERMINAL_2 = createScrewTerminalFootprint(2);
export const SCREW_TERMINAL_3 = createScrewTerminalFootprint(3);
export const SCREW_TERMINAL_4 = createScrewTerminalFootprint(4);

// ============ CONNECTORS ============

export const BARREL_JACK: Footprint = {
  id: 'barrel-jack',
  name: 'Barrel Jack',
  description: 'DC power barrel jack',
  category: 'connector',
  pins: [
    pin('p1', '1', 'Center Pin', 0, 0, { isPolarized: true, polarity: 'positive' }),
    pin('p2', '2', 'Sleeve', 0, 3, { isPolarized: true, polarity: 'negative' }),
  ],
  width: 4,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 3 },
  isPolarized: true,
  polarizationMark: { type: 'dot', position: { row: 0, col: 0 }, size: 1 },
};

export const JST_CONNECTOR_2: Footprint = {
  id: 'jst-2pin',
  name: 'JST 2-pin',
  description: 'JST PH 2-pin connector',
  category: 'connector',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 1),
  ],
  width: 2,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

export const JST_CONNECTOR_3: Footprint = {
  id: 'jst-3pin',
  name: 'JST 3-pin',
  description: 'JST PH 3-pin connector',
  category: 'connector',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 1),
    pin('p3', '3', 'Pin 3', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ SWITCHES ============

export const SWITCH_SPST_SLIDE: Footprint = {
  id: 'switch-spst-slide',
  name: 'SPST Slide Switch',
  description: 'Single-pole single-throw slide switch',
  category: 'switch',
  pins: [
    pin('p1', '1', 'Common', 0, 0),
    pin('p2', '2', 'Throw', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1.5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: false,
};

export const SWITCH_SPDT_SLIDE: Footprint = {
  id: 'switch-spdt-slide',
  name: 'SPDT Slide Switch',
  description: 'Single-pole double-throw slide switch',
  category: 'switch',
  pins: [
    pin('p1', '1', 'Throw A', 0, 0),
    pin('p2', '2', 'Common', 0, 1),
    pin('p3', '3', 'Throw B', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1.5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: false,
};

export const SWITCH_DIP_4: Footprint = {
  id: 'switch-dip-4',
  name: 'DIP Switch 4-position',
  description: '4-position DIP switch',
  category: 'switch',
  pins: [
    pin('p1', '1', 'Switch 1 A', 0, 0),
    pin('p2', '2', 'Switch 1 B', 0, 4),
    pin('p3', '3', 'Switch 2 A', 0, 1),
    pin('p4', '4', 'Switch 2 B', 0, 5),
    pin('p5', '5', 'Switch 3 A', 0, 2),
    pin('p6', '6', 'Switch 3 B', 0, 6),
    pin('p7', '7', 'Switch 4 A', 0, 3),
    pin('p8', '8', 'Switch 4 B', 0, 7),
  ],
  width: 8,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 8, height: 2 },
  supportedOrientations: [0, 180],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ PUSH BUTTONS ============

export const PUSH_BUTTON_6MM: Footprint = {
  id: 'push-button-6mm',
  name: 'Tactile Push Button 6mm',
  description: '6mm tactile push button, 4 pins',
  category: 'push-button',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 3),
    pin('p3', '3', 'Pin 3', 3, 0),
    pin('p4', '4', 'Pin 4', 3, 3),
  ],
  width: 4,
  height: 4,
  bodyOutline: { type: 'rectangle', width: 3, height: 3 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 3, col: 3 },
  isPolarized: false,
};

export const PUSH_BUTTON_12MM: Footprint = {
  id: 'push-button-12mm',
  name: 'Push Button 12mm',
  description: '12mm panel mount push button',
  category: 'push-button',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 5),
  ],
  width: 6,
  height: 1,
  bodyOutline: { type: 'circle', width: 5, height: 5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 5 },
  isPolarized: false,
};

// ============ POTENTIOMETERS ============

export const POTENTIOMETER_TRIMPOT: Footprint = {
  id: 'potentiometer-trimp',
  name: 'Trimmer Potentiometer',
  description: 'Small trimmer potentiometer',
  category: 'potentiometer',
  pins: [
    pin('p1', '1', 'Terminal 1', 0, 0),
    pin('p2', '2', 'Wiper', 0, 1),
    pin('p3', '3', 'Terminal 3', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: false,
};

export const POTENTIOMETER_PANEL_16MM: Footprint = {
  id: 'potentiometer-panel-16mm',
  name: 'Panel Potentiometer 16mm',
  description: '16mm panel mount potentiometer',
  category: 'potentiometer',
  pins: [
    pin('p1', '1', 'Terminal 1', 0, 0),
    pin('p2', '2', 'Wiper', 0, 2),
    pin('p3', '3', 'Terminal 3', 0, 4),
  ],
  width: 5,
  height: 1,
  bodyOutline: { type: 'circle', width: 4, height: 4 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 2 },
  isPolarized: false,
};

// ============ CRYSTALS / OSCILLATORS ============

export const CRYSTAL_HC49: Footprint = {
  id: 'crystal-hc49',
  name: 'Crystal HC-49',
  description: 'Standard HC-49 crystal',
  category: 'crystal',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'Pin 2', 0, 3),
  ],
  width: 4,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2.5, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 3 },
  isPolarized: false,
};

export const RESONATOR_3PIN: Footprint = {
  id: 'resonator-3pin',
  name: 'Ceramic Resonator',
  description: '3-pin ceramic resonator',
  category: 'crystal',
  pins: [
    pin('p1', '1', 'Pin 1', 0, 0),
    pin('p2', '2', 'GND', 0, 1),
    pin('p3', '3', 'Pin 3', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 2, height: 1 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: false,
};

// ============ VOLTAGE REGULATORS ============

export const REGULATOR_TO92: Footprint = {
  id: 'regulator-to92',
  name: 'Voltage Regulator TO-92',
  description: 'Linear voltage regulator in TO-92 package',
  category: 'voltage-regulator',
  pins: [
    pin('p1', '1', 'Input', 0, 0),
    pin('p2', '2', 'Ground', 0, 1),
    pin('p3', '3', 'Output', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'circle', width: 2, height: 2 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'flat', position: { row: 0, col: 1 }, size: 1 },
};

export const REGULATOR_TO220: Footprint = {
  id: 'regulator-to220',
  name: 'Voltage Regulator TO-220',
  description: 'Linear voltage regulator in TO-220 package (78xx/79xx)',
  category: 'voltage-regulator',
  pins: [
    pin('p1', '1', 'Input', 0, 0),
    pin('p2', '2', 'Ground', 0, 1),
    pin('p3', '3', 'Output', 0, 2),
  ],
  width: 3,
  height: 1,
  bodyOutline: { type: 'rectangle', width: 3, height: 1.5 },
  supportedOrientations: [0, 90, 180, 270],
  defaultOrientation: 0,
  pinSpacing: { row: 0, col: 1 },
  isPolarized: true,
  polarizationMark: { type: 'notch', position: { row: 0, col: 0 }, size: 1 },
};

// ============ CUSTOM ============

export function createCustomFootprint(
  id: string,
  name: string,
  description: string,
  pinDefinitions: { number: string; name: string; row: number; col: number }[],
  options?: Partial<Footprint>
): Footprint {
  const pins: Pin[] = pinDefinitions.map(p => 
    pin(`p${p.number}`, p.number, p.name, p.row, p.col)
  );
  
  const maxRow = Math.max(...pinDefinitions.map(p => p.row), 0);
  const maxCol = Math.max(...pinDefinitions.map(p => p.col), 0);
  
  return {
    id,
    name,
    description,
    category: 'custom',
    pins,
    width: maxCol + 1,
    height: maxRow + 1,
    bodyOutline: { type: 'rectangle', width: maxCol + 1, height: maxRow + 1 },
    supportedOrientations: [0, 90, 180, 270],
    defaultOrientation: 0,
    pinSpacing: { row: 1, col: 1 },
    isPolarized: false,
    ...options,
  };
}

// ============ REGISTRATION ============

export const ALL_STANDARD_FOOTPRINTS: Footprint[] = [
  RESISTOR_AXIAL,
  RESISTOR_AXIAL_SHORT,
  RESISTOR_SMD_0805,
  CAPACITOR_CERAMIC,
  CAPACITOR_ELECTROLYTIC,
  CAPACITOR_TANTALUM,
  LED_3MM,
  LED_5MM,
  DIODE_1N4148,
  DIODE_1N4007,
  DIODE_BRIDGE,
  TRANSISTOR_TO92_EBC,
  TRANSISTOR_TO92_CBE,
  TRANSISTOR_TO220,
  MOSFET_TO92,
  MOSFET_TO220,
  DIP_4, DIP_6, DIP_8, DIP_14, DIP_16, DIP_18, DIP_20, DIP_28, DIP_40,
  DIP_SOCKET_8, DIP_SOCKET_14, DIP_SOCKET_16, DIP_SOCKET_28, DIP_SOCKET_40,
  PIN_HEADER_1X2, PIN_HEADER_1X3, PIN_HEADER_1X4, PIN_HEADER_1X5,
  PIN_HEADER_1X6, PIN_HEADER_1X8, PIN_HEADER_1X10,
  PIN_HEADER_2X3, PIN_HEADER_2X4, PIN_HEADER_2X5,
  SCREW_TERMINAL_2, SCREW_TERMINAL_3, SCREW_TERMINAL_4,
  BARREL_JACK,
  JST_CONNECTOR_2, JST_CONNECTOR_3,
  SWITCH_SPST_SLIDE, SWITCH_SPDT_SLIDE, SWITCH_DIP_4,
  PUSH_BUTTON_6MM, PUSH_BUTTON_12MM,
  POTENTIOMETER_TRIMPOT, POTENTIOMETER_PANEL_16MM,
  CRYSTAL_HC49, RESONATOR_3PIN,
  REGULATOR_TO92, REGULATOR_TO220,
];

export function registerAllStandardFootprints(): void {
  for (const footprint of ALL_STANDARD_FOOTPRINTS) {
    registerFootprint(footprint);
  }
}

// Utility functions

export function findFootprint(id: string): Footprint | undefined {
  return ALL_STANDARD_FOOTPRINTS.find(f => f.id === id);
}

export function getFootprintsByCategory(category: ComponentCategory): Footprint[] {
  return ALL_STANDARD_FOOTPRINTS.filter(f => f.category === category);
}

export function searchFootprints(query: string): Footprint[] {
  const lowerQuery = query.toLowerCase();
  return ALL_STANDARD_FOOTPRINTS.filter(f => 
    f.id.toLowerCase().includes(lowerQuery) ||
    f.name.toLowerCase().includes(lowerQuery) ||
    f.description.toLowerCase().includes(lowerQuery) ||
    f.category.toLowerCase().includes(lowerQuery)
  );
}

export function getAllCategories(): ComponentCategory[] {
  const categories = new Set<ComponentCategory>();
  for (const f of ALL_STANDARD_FOOTPRINTS) {
    categories.add(f.category);
  }
  return Array.from(categories);
}

export type { Footprint, Pin, ComponentCategory } from './types';