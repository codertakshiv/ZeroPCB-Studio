/**
 * SchematicCanvas - EasyEDA-style circuit editor
 *
 * Components are drawn as schematic symbols. Click one pin, then another pin,
 * to draw a wire between them (creating/joining/merging nets). Drag symbols to
 * rearrange; right-click a pin to disconnect it. Wires follow orthogonal
 * (manhattan) paths like a real schematic editor.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { getFootprintById, Footprint } from '../footprints/types';
import {
  getSymbolLayout,
  getSymbolBodyBox,
  SCHEMATIC_UNIT as UNIT,
  SymbolLayout,
  SymbolPinLayout,
  getWirePoints,
  wirePointsToPath,
  Point,
} from '../schematic/symbols';
import { getNetColor } from './netColors';
import { useCursorZoom } from './useCursorZoom';
import { Net } from '../circuit/types';

interface SymbolModel {
  componentId: string;
  reference: string;
  value?: string;
  footprint?: Footprint;
  layout: SymbolLayout;
  pos: { x: number; y: number };
}

const u = (v: number) => v * UNIT;

export function SchematicCanvas() {
  const circuit = useAppStore(s => s.circuit);
  const positions = useAppStore(s => s.schematicPositions);
  const zoom = useAppStore(s => s.schematicZoom);
  const setSchematicZoom = useAppStore(s => s.setSchematicZoom);
  const selectedComponentIds = useAppStore(s => s.selectedComponentIds);
  const selectedNetId = useAppStore(s => s.selectedNetId);
  const ensurePositions = useAppStore(s => s.ensureSchematicPositions);
  const moveComponent = useAppStore(s => s.moveSchematicComponent);
  const connectPins = useAppStore(s => s.connectPins);
  const selectComponents = useAppStore(s => s.selectComponents);
  const selectNet = useAppStore(s => s.selectNet);
  const clearHighlights = useAppStore(s => s.clearHighlights);
  const pushHistory = useAppStore(s => s.pushHistory);
  const focusMode = useAppStore(s => s.focusMode);
  const setFocusMode = useAppStore(s => s.setFocusMode);

  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ componentId: string; pinId: string } | null>(null);
  const [pointerUnits, setPointerUnits] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; componentId: string; pinId: string } | null>(null);
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Symbol drag: one undo entry per drag, no matter how many symbols move
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origins: Map<string, { x: number; y: number }>;
    pushed: boolean;
  } | null>(null);
  // Rubber-band selection (left drag on empty sheet)
  const bandRef = useRef<{ startX: number; startY: number; clientX: number; clientY: number; additive: boolean } | null>(null);
  const bandRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  // Middle / right drag panning
  const panRef = useRef<{ scrollLeft: number; scrollTop: number; startX: number; startY: number; moved: boolean } | null>(null);

  // Auto-position components the first time they are shown
  useEffect(() => {
    ensurePositions();
  }, [ensurePositions, circuit.components.length]);
  
  // Wheel / pinch zoom, anchored at the cursor (padding is not scaled)
  useCursorZoom(scrollRef, zoom, setSchematicZoom, { min: 0.3, max: 2.5, unscaledPadding: 24 });

  // Cancel pending wire with Escape
  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pending]);

  const models = useMemo<SymbolModel[]>(() => {
    const list: SymbolModel[] = [];
    for (const comp of circuit.components) {
      const pos = positions.get(comp.id);
      if (!pos) continue;
      const footprint = getFootprintById(comp.footprintId);
      list.push({
        componentId: comp.id,
        reference: comp.reference,
        value: comp.value,
        footprint,
        layout: getSymbolLayout(footprint),
        pos,
      });
    }
    return list;
  }, [circuit.components, positions]);

  const pinPoint = useCallback((m: SymbolModel, pin: SymbolPinLayout) => ({
    x: m.pos.x + pin.x,
    y: m.pos.y + pin.y,
  }), []);

  const pinIndex = useMemo(() => {
    const map = new Map<string, { model: SymbolModel; pin: SymbolPinLayout; x: number; y: number }>();
    for (const m of models) {
      for (const pin of m.layout.pins) {
        const p = pinPoint(m, pin);
        map.set(`${m.componentId}:${pin.pinId}`, { model: m, pin, ...p });
      }
    }
    return map;
  }, [models, pinPoint]);

  /** `${componentId}:${pinId}` -> netId (from the circuit pin maps) */
  const pinNets = useMemo(() => {
    const map = new Map<string, string>();
    for (const comp of circuit.components) {
      for (const [pinId, netId] of comp.pins) {
        map.set(`${comp.id}:${pinId}`, netId);
      }
    }
    return map;
  }, [circuit.components]);

  // Wires: one orthogonal chain per net
  const wires = useMemo(() => {
    const out: {
      net: Net;
      color: string;
      points: { x: number; y: number }[];
      path: string;
      terminals: { x: number; y: number }[];
      junctions: { x: number; y: number }[];
      bridges: { x: number; y: number; horizontal: boolean }[];
    }[] = [];

    // ---- wire router ---------------------------------------------------
    // A leg that runs through a foreign pin looks connected, and a leg that
    // runs through a symbol body is unreadable. Every leg is therefore bowed
    // ("stadium" detour) around whatever it would cross, preferring the side
    // closest to the straight line.
    const CLEAR = 0.9; // clearance kept from a symbol body
    const PAD = 1;     // clearance kept from a crossed pin
    const JOG = 1.25;  // hop distance when only pins are in the way
    const TURN = 0.75; // distance of the entry/exit turn from the obstacle

    const boxes = models.map(m => {
      const b = getSymbolBodyBox(m.layout);
      return {
        left: m.pos.x + b.x,
        top: m.pos.y + b.y,
        right: m.pos.x + b.x + b.width,
        bottom: m.pos.y + b.y + b.height,
      };
    });
    const pinPoints = Array.from(pinIndex.values(), pin => ({ x: pin.x, y: pin.y }));
    // Completed nets are routing obstacles for later nets. Crossing them is
    // allowed, but running along the same line is avoided so colors stay clear.
    const reservedWireSegments: [Point, Point][] = [];

    /** Is the body box crossed by the axis-aligned segment a->b? */
    const crossesBox = (a: Point, b: Point, box: (typeof boxes)[number]) =>
      a.x === b.x
        ? a.x > box.left + 0.05 && a.x < box.right - 0.05 &&
          Math.max(a.y, b.y) > box.top + 0.05 && Math.min(a.y, b.y) < box.bottom - 0.05
        : a.y > box.top + 0.05 && a.y < box.bottom - 0.05 &&
          Math.max(a.x, b.x) > box.left + 0.05 && Math.min(a.x, b.x) < box.right - 0.05;

    /** Is a pin strictly inside the segment a->b? */
    const pinOnSegment = (pin: Point, a: Point, b: Point) =>
      a.x === b.x
        ? Math.abs(pin.x - a.x) < 0.05 && pin.y > Math.min(a.y, b.y) + 0.05 && pin.y < Math.max(a.y, b.y) - 0.05
        : Math.abs(pin.y - a.y) < 0.05 && pin.x > Math.min(a.x, b.x) + 0.05 && pin.x < Math.max(a.x, b.x) - 0.05;

    /** Route one straight leg, bowing around pins / bodies that lie on it */
    const routeLeg = (p: Point, q: Point): Point[] => {
      const horizontal = p.y === q.y;
      if (!horizontal && p.x !== q.x) return [p, q];

      const pinHits: Point[] = [];
      const wireBoxes: typeof boxes = [];
      const boxHits: typeof boxes = [];
      const pAlong = horizontal ? p.x : p.y;
      const qAlong = horizontal ? q.x : q.y;
      const lo = Math.min(pAlong, qAlong);
      const hi = Math.max(pAlong, qAlong);

      for (const [from, to] of reservedWireSegments) {
        if (horizontal && from.y === to.y && Math.abs(from.y - p.y) < 0.05) {
          if (Math.min(hi, Math.max(from.x, to.x)) - Math.max(lo, Math.min(from.x, to.x)) > 0.2) {
            wireBoxes.push({ left: Math.min(from.x, to.x), right: Math.max(from.x, to.x), top: from.y - 0.12, bottom: from.y + 0.12 });
          }
        } else if (!horizontal && from.x === to.x && Math.abs(from.x - p.x) < 0.05) {
          if (Math.min(hi, Math.max(from.y, to.y)) - Math.max(lo, Math.min(from.y, to.y)) > 0.2) {
            wireBoxes.push({ left: from.x - 0.12, right: from.x + 0.12, top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y) });
          }
        }
      }
      const routeBoxes = [...boxes, ...wireBoxes];

      if (horizontal) {
        for (const pin of pinPoints) {
          if (pin.y === p.y && pin.x > lo + 0.05 && pin.x < hi - 0.05) pinHits.push(pin);
        }
        for (const box of routeBoxes) {
          if (p.y <= box.top || p.y >= box.bottom) continue;
          if (Math.min(hi, box.right) - Math.max(lo, box.left) > 0.2) boxHits.push(box);
        }
      } else {
        for (const pin of pinPoints) {
          if (pin.x === p.x && pin.y > lo + 0.05 && pin.y < hi - 0.05) pinHits.push(pin);
        }
        for (const box of routeBoxes) {
          if (p.x <= box.left || p.x >= box.right) continue;
          if (Math.min(hi, box.bottom) - Math.max(lo, box.top) > 0.2) boxHits.push(box);
        }
      }

      if (pinHits.length === 0 && boxHits.length === 0) return [p, q];

      // Blocked span along the leg (entry / exit in travel order) plus the two
      // lanes that clear everything at once.
      const dir = qAlong >= pAlong ? 1 : -1;

      const nearEdges = [
        ...pinHits.map(t => (horizontal ? t.x : t.y) - PAD),
        ...boxHits.map(b => (horizontal ? b.left : b.top)),
      ];
      const farEdges = [
        ...pinHits.map(t => (horizontal ? t.x : t.y) + PAD),
        ...boxHits.map(b => (horizontal ? b.right : b.bottom)),
      ];
      const entry = dir > 0 ? Math.min(...nearEdges) : Math.max(...farEdges);
      const exit = dir > 0 ? Math.max(...farEdges) : Math.min(...nearEdges);

      const base = horizontal ? p.y : p.x;
      const laneLow = Math.min(
        ...pinHits.map(t => (horizontal ? t.y : t.x) - JOG),
        ...boxHits.map(b => (horizontal ? b.top : b.left) - CLEAR),
      );
      const laneHigh = Math.max(
        ...pinHits.map(t => (horizontal ? t.y : t.x) + JOG),
        ...boxHits.map(b => (horizontal ? b.bottom : b.right) + CLEAR),
      );
      const lanes = base - laneLow <= laneHigh - base ? [laneLow, laneHigh] : [laneHigh, laneLow];

      // Let the shoulders extend just beyond the blocked span. Clamping these
      // to the original leg kept them inside an overlapping wire at its ends.
      const t1 = entry - dir * TURN;
      const t2 = exit + dir * TURN;
      if (dir > 0 ? t2 <= t1 + 0.1 : t2 >= t1 - 0.1) return [p, q];

      for (const lane of lanes) {
        const a = horizontal ? { x: t1, y: p.y } : { x: p.x, y: t1 };
        const b = horizontal ? { x: t1, y: lane } : { x: lane, y: t1 };
        const c = horizontal ? { x: t2, y: lane } : { x: lane, y: t2 };
        const d = horizontal ? { x: t2, y: p.y } : { x: p.x, y: t2 };

        // Keep the detour only if it really clears every body and pin.
        const segments: [Point, Point][] = [[a, b], [b, c], [c, d]];
        const clean = segments.every(([s, e]) =>
          !routeBoxes.some(box => crossesBox(s, e, box)) && !pinPoints.some(pin => pinOnSegment(pin, s, e)),
        );
        if (clean) return [p, a, b, c, d, q];
      }

      return [p, q];
    };

    for (const net of circuit.nets) {
      const pts = net.pins
        .map(np => pinIndex.get(`${np.componentId}:${np.pinId}`))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      if (pts.length < 2) continue;

      // Chain pins left-to-right so multi-pin nets read as a bus
      const sorted = [...pts].sort((a, b) => (a.x - b.x) || (a.y - b.y));
      const all: { x: number; y: number }[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const base = getWirePoints({ x: sorted[i].x, y: sorted[i].y }, { x: sorted[i + 1].x, y: sorted[i + 1].y });
        for (let leg = 0; leg < base.length - 1; leg++) {
          for (const p of routeLeg(base[leg], base[leg + 1])) {
            if (all.length === 0 || all[all.length - 1].x !== p.x || all[all.length - 1].y !== p.y) {
              all.push(p);
            }
          }
        }
      }

      // Connection points along the chain: ends are solder terminals, pins
      // passed through mid-chain are junctions where wires really join.
      const pinAt = new Set(pts.map(p => `${p.x},${p.y}`));
      const terminals: { x: number; y: number }[] = [];
      const junctions: { x: number; y: number }[] = [];
      all.forEach((p, i) => {
        if (!pinAt.has(`${p.x},${p.y}`)) return;
        if (i === 0 || i === all.length - 1) terminals.push({ x: p.x, y: p.y });
        else junctions.push({ x: p.x, y: p.y });
      });

      out.push({
        net,
        color: net.color || getNetColor(net.name),
        points: all,
        path: wirePointsToPath(all.map(p => ({ x: u(p.x), y: u(p.y) }))),
        terminals,
        junctions,
        bridges: [],
      });

      for (let i = 0; i < all.length - 1; i++) {
        reservedWireSegments.push([all[i], all[i + 1]]);
      }
    }

    // A bridge is drawn on the later wire at each unavoidable orthogonal
    // crossing. The little hop makes clear that the nets cross without joining.
    for (let upper = 0; upper < out.length; upper++) {
      for (let lower = 0; lower < upper; lower++) {
        for (let i = 0; i < out[upper].points.length - 1; i++) {
          const a = out[upper].points[i];
          const b = out[upper].points[i + 1];
          const upperHorizontal = a.y === b.y;
          if (!upperHorizontal && a.x !== b.x) continue;
          for (let j = 0; j < out[lower].points.length - 1; j++) {
            const c = out[lower].points[j];
            const d = out[lower].points[j + 1];
            const lowerHorizontal = c.y === d.y;
            if (upperHorizontal === lowerHorizontal || (c.x !== d.x && c.y !== d.y)) continue;
            const horizontal = upperHorizontal ? [a, b] : [c, d];
            const vertical = upperHorizontal ? [c, d] : [a, b];
            const x = vertical[0].x;
            const y = horizontal[0].y;
            const insideHorizontal = x > Math.min(horizontal[0].x, horizontal[1].x) + 0.2 && x < Math.max(horizontal[0].x, horizontal[1].x) - 0.2;
            const insideVertical = y > Math.min(vertical[0].y, vertical[1].y) + 0.2 && y < Math.max(vertical[0].y, vertical[1].y) - 0.2;
            if (insideHorizontal && insideVertical && !out[upper].bridges.some(mark => Math.abs(mark.x - x) < 0.05 && Math.abs(mark.y - y) < 0.05)) {
              out[upper].bridges.push({ x, y, horizontal: upperHorizontal });
            }
          }
        }
      }
    }
    return out;
  }, [circuit.nets, pinIndex, models]);

  // Canvas bounds: the sheet chosen in the toolbar, extended by any symbol
  // dragged beyond it so content is never clipped.
  const canvasSize = useAppStore(s => s.schematicCanvasSize);
  const bounds = useMemo(() => {
    let minX = 0, minY = 0, maxX = canvasSize.w, maxY = canvasSize.h;
    for (const m of models) {
      // Wide margin: wires may bow around symbol bodies near the edges.
      minX = Math.min(minX, m.pos.x - 3.5);
      minY = Math.min(minY, m.pos.y - 3.5);
      maxX = Math.max(maxX, m.pos.x + m.layout.width + 3);
      maxY = Math.max(maxY, m.pos.y + m.layout.height + 3);
    }
    return { minX, minY, maxX, maxY };
  }, [models, canvasSize]);

  const viewW = (bounds.maxX - bounds.minX) * UNIT;
  const viewH = (bounds.maxY - bounds.minY) * UNIT;

  const clientToUnits = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x / UNIT, y: loc.y / UNIT };
  }, []);

  const handlePinClick = useCallback((e: React.MouseEvent, componentId: string, pinId: string) => {
    e.stopPropagation();
    if (!pending) {
      setPending({ componentId, pinId });
      return;
    }
    if (pending.componentId === componentId && pending.pinId === pinId) {
      setPending(null);
      return;
    }
    connectPins(pending, { componentId, pinId });
    setPending(null);
  }, [pending, connectPins]);

  const handleWireClick = useCallback((e: React.MouseEvent, netId: string) => {
    e.stopPropagation();
    selectNet(netId);
  }, [selectNet]);

  const handlePinContextMenu = useCallback((e: React.MouseEvent, componentId: string, pinId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, componentId, pinId });
  }, []);

  const handleSymbolPointerDown = useCallback((e: React.PointerEvent, m: SymbolModel) => {
    if (e.button !== 0) return;
    // A press that starts on a pin is a wiring click, not a symbol drag.
    // Starting a drag here would capture the pointer and retarget the click
    // to the symbol group, swallowing the pin's onClick - which made it
    // impossible to wire anything.
    if (e.target instanceof Element && e.target.closest('.sch-pin')) return;
    e.stopPropagation();

    // Pressing a symbol that is already selected drags the whole selection
    // (so a marquee selection moves together); pressing anywhere else grabs
    // just this symbol. Shift toggles membership without starting a move.
    let ids: string[];
    if (e.shiftKey) {
      ids = selectedComponentIds.has(m.componentId)
        ? [...selectedComponentIds].filter(id => id !== m.componentId)
        : [...selectedComponentIds, m.componentId];
      selectComponents([m.componentId], true);
    } else if (selectedComponentIds.has(m.componentId)) {
      ids = [...selectedComponentIds];
    } else {
      ids = [m.componentId];
      selectComponents([m.componentId]);
    }

    const units = clientToUnits(e.clientX, e.clientY);
    const origins = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const p = positions.get(id);
      if (p) origins.set(id, { x: p.x, y: p.y });
    }
    dragRef.current = { startX: units.x, startY: units.y, origins, pushed: false };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [clientToUnits, positions, selectComponents, selectedComponentIds]);

  /**
   * Mouse press on the empty sheet: left starts a rubber-band selection,
   * middle / right drag pans the sheet. Touch gestures are handled by
   * useCursorZoom (one finger pans, two fingers pinch).
   */
  const handleSurfacePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    // Pin presses wire, wire presses select the net - neither starts a band,
    // and neither may cancel a wire that is already pending.
    const onPart = e.target instanceof Element && e.target.closest('.sch-pin, .sch-wire');
    if (e.button === 0 && onPart) return;
    if (e.button === 2 && e.target instanceof Element && e.target.closest('.sch-pin')) return;
    if (e.button !== 0) e.preventDefault();

    if (e.button === 0) {
      // A press on the bare sheet (no part under the cursor) drops the old
      // selection right away - the marquee then defines the new one. A
      // pending wire is cancelled; shift keeps the selection for a union.
      if (!pending && !e.shiftKey) clearHighlights();
      setPending(null);
      const units = clientToUnits(e.clientX, e.clientY);
      bandRef.current = { startX: units.x, startY: units.y, clientX: e.clientX, clientY: e.clientY, additive: e.shiftKey };
    } else {
      panRef.current = {
        scrollLeft: scrollRef.current?.scrollLeft ?? 0,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    }
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [clientToUnits, pending, clearHighlights]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const units = clientToUnits(e.clientX, e.clientY);
    setPointerUnits(units);

    // Middle / right drag pans
    const pan = panRef.current;
    if (pan) {
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        pan.moved = true;
        setPanning(true);
      }
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollLeft = pan.scrollLeft - dx;
        scroller.scrollTop = pan.scrollTop - dy;
      }
      return;
    }

    // Rubber band
    const bandStart = bandRef.current;
    if (bandStart && Math.hypot(e.clientX - bandStart.clientX, e.clientY - bandStart.clientY) > 4) {
      const rect = { x1: bandStart.startX, y1: bandStart.startY, x2: units.x, y2: units.y };
      bandRectRef.current = rect;
      setBand(rect);
    }

    // Move the grabbed symbols (whole selection moves together)
    const drag = dragRef.current;
    if (!drag) return;
    const ddx = Math.round((units.x - drag.startX) * 2) / 2;
    const ddy = Math.round((units.y - drag.startY) * 2) / 2;
    if (!drag.pushed) {
      if (ddx === 0 && ddy === 0) return;
      pushHistory(); // one undo step per drag
      drag.pushed = true;
    }
    for (const [id, origin] of drag.origins) {
      moveComponent(id, { x: origin.x + ddx, y: origin.y + ddy });
    }
  }, [clientToUnits, moveComponent, pushHistory]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;

    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      setPanning(false);
      return;
    }

    const bandStart = bandRef.current;
    const rect = bandRectRef.current;
    bandRef.current = null;
    bandRectRef.current = null;
    setBand(null);
    if (!bandStart || !rect) return;

    // Marquee: grab every symbol whose body box meets the band
    const left = Math.min(rect.x1, rect.x2);
    const right = Math.max(rect.x1, rect.x2);
    const top = Math.min(rect.y1, rect.y2);
    const bottom = Math.max(rect.y1, rect.y2);
    const hits = models
      .filter(m =>
        m.pos.x < right &&
        m.pos.x + m.layout.width > left &&
        m.pos.y < bottom &&
        m.pos.y + m.layout.height > top,
      )
      .map(m => m.componentId);
    selectComponents(hits, bandStart.additive);
  }, [models, selectComponents]);

  const pendingPin = pending ? pinIndex.get(`${pending.componentId}:${pending.pinId}`) : null;

  return (
    <div className="relative w-full h-full select-none">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1">
        <button
          type="button"
          className="w-6 h-6 rounded-full border text-xs font-semibold shadow-sm"
          style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          aria-label="Toggle full-screen"
          onClick={() => setFocusMode(!focusMode)}
          title={focusMode ? 'Exit full-screen' : 'Enter full-screen (hides side panels)'}
        >
          {focusMode ? '⛶' : '⛶'}
        </button>
        <button
          type="button"
          className="w-6 h-6 rounded-full border text-xs font-semibold shadow-sm"
          style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          aria-label="Schematic help"
          aria-expanded={helpOpen}
          title="How to make a circuit schematic"
          onClick={() => setHelpOpen(open => !open)}
        >
          ?
        </button>
        {helpOpen && (
          <div className="absolute right-0 top-8 w-64 rounded-xl border p-3 shadow-xl text-xs leading-relaxed"
            style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
            <div className="font-semibold mb-1">Make a circuit schematic</div>
            <ol className="list-decimal pl-4 text-muted space-y-1">
              <li>Add parts from the Library panel.</li>
              <li>Click one pin, then another pin to connect them.</li>
              <li>Drag parts to arrange them; drag empty space to select several.</li>
              <li>Right-click a pin for connection options. Press Esc to cancel wiring.</li>
            </ol>
            <div className="mt-2 text-[10px] text-muted">Use the toolbar to zoom or expand the canvas.</div>
          </div>
        )}
      </div>
      {pending && (
        <div className="absolute top-3 left-3 z-10 rounded-full border px-2.5 py-1 text-[10px]"
          style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          Select another pin · Esc to cancel
        </div>
      )}
      <div
        ref={scrollRef}
        className="w-full h-full overflow-auto p-6"
        data-testid="schematic-scroller"
        style={{ touchAction: 'none', cursor: panning ? 'grabbing' : undefined }}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg
          ref={svgRef}
          viewBox={`${u(bounds.minX)} ${u(bounds.minY)} ${viewW} ${viewH}`}
          width={viewW * zoom}
          height={viewH * zoom}
          style={{ display: 'block', margin: '0 auto', background: 'var(--sch-bg)', borderRadius: 12, border: '1px solid var(--border)', cursor: 'crosshair' }}
          onContextMenu={(e) => e.preventDefault()}
          role="img"
          aria-label="Schematic editor"
          data-testid="schematic-canvas"
        >
          <defs>
            <pattern
              id="sch-grid"
              x={u(bounds.minX)}
              y={u(bounds.minY)}
              width={UNIT}
              height={UNIT}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${UNIT} 0 L 0 0 0 ${UNIT}`}
                fill="none"
                stroke="var(--sch-grid)"
                strokeWidth={1}
              />
            </pattern>
          </defs>
          <rect x={u(bounds.minX)} y={u(bounds.minY)} width={viewW} height={viewH} fill="url(#sch-grid)" />

          {/* Symbol bodies first ... */}
          {models.map(m => (
            <SymbolBodyView
              key={m.componentId}
              model={m}
              selected={selectedComponentIds.has(m.componentId)}
              onSymbolPointerDown={handleSymbolPointerDown}
            />
          ))}

          {/* ...wires above the bodies so they never vanish under a symbol... */}
          <g>
            {wires.map(wire => {
              const isSelected = selectedNetId === wire.net.id;
              const color = isSelected ? 'var(--accent)' : wire.color;
              const midIdx = Math.max(0, Math.floor((wire.points.length - 1) / 2));
              const a = wire.points[midIdx];
              const b = wire.points[midIdx + 1] ?? a;
              const labelX = u((a.x + b.x) / 2);
              const labelY = u((a.y + b.y) / 2) - 9;
              const labelW = wire.net.name.length * 6.4 + 14;
              return (
                <g key={wire.net.id}>
                  {/* Casing keeps crossing wires readable on the sheet */}
                  <path
                    className="sch-wire-casing"
                    d={wire.path}
                    strokeWidth={isSelected ? 8 : 7}
                    pointerEvents="none"
                  />
                  <path
                    d={wire.path}
                    className="sch-wire"
                    stroke={color}
                    strokeWidth={isSelected ? 3.4 : 2.8}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => handleWireClick(e, wire.net.id)}
                  />
                  {/* Connection dots are drawn above the pins (see below) */}
                  {/* Net name chip */}
                  <g transform={`translate(${labelX}, ${labelY})`} pointerEvents="none">
                    <rect
                      x={-labelW / 2}
                      y={-8}
                      width={labelW}
                      height={16}
                      rx={8}
                      fill="var(--sch-bg)"
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.95}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily="ui-monospace, monospace"
                      fill={color}
                    >
                      {wire.net.name}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* Bridge humps clarify crossings between separate nets. A plus/dot
              is reserved for a real junction, so these wires never look joined. */}
          <g pointerEvents="none">
            {wires.flatMap(wire => {
              const color = selectedNetId === wire.net.id ? 'var(--accent)' : wire.color;
              return wire.bridges.map((bridge, index) => {
                const x = u(bridge.x);
                const y = u(bridge.y);
                const radius = u(0.55);
                const lift = u(0.45);
                const d = bridge.horizontal
                  ? `M ${x - radius} ${y} Q ${x} ${y - lift} ${x + radius} ${y}`
                  : `M ${x} ${y - radius} Q ${x + lift} ${y} ${x} ${y + radius}`;
                return (
                  <g key={`${wire.net.id}-bridge-${index}`} className="sch-wire-bridge" data-testid="schematic-wire-bridge">
                    <path d={d} fill="none" stroke="var(--sch-bg)" strokeWidth={7} strokeLinecap="round" />
                    <path d={d} fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
                  </g>
                );
              });
            })}
          </g>

          {/* Pending wire preview */}
          {pendingPin && pointerUnits && (
            <line
              x1={u(pendingPin.x)}
              y1={u(pendingPin.y)}
              x2={u(pointerUnits.x)}
              y2={u(pointerUnits.y)}
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="6 5"
              pointerEvents="none"
            />
          )}

          {/* ...and pins on top so they stay clickable */}
          {models.map(m => (
            <SymbolPinsView
              key={m.componentId}
              model={m}
              pinNets={pinNets}
              selectedNetId={selectedNetId}
              pending={pending}
              onPinClick={handlePinClick}
              onPinContextMenu={handlePinContextMenu}
            />
          ))}

          {/* Connection dots above everything:
              a wired pin turns into the net's colour (junction dots bigger
              than plain wire ends), an unwired pin stays gold. */}
          <g>
            {wires.map(wire => {
              const color = selectedNetId === wire.net.id ? 'var(--accent)' : wire.color;
              return (
                <g key={`dots-${wire.net.id}`}>
                  {wire.terminals.map((p, i) => (
                    <circle
                      key={`t${i}`}
                      className="sch-terminal"
                      cx={u(p.x)}
                      cy={u(p.y)}
                      r={4}
                      fill={color}
                      pointerEvents="none"
                    />
                  ))}
                  {wire.junctions.map((p, i) => (
                    <circle
                      key={`j${i}`}
                      className="sch-junction"
                      cx={u(p.x)}
                      cy={u(p.y)}
                      r={6}
                      fill={color}
                      pointerEvents="none"
                    />
                  ))}
                </g>
              );
            })}
          </g>

          {/* Rubber-band selection rectangle */}
          {band && (
            <rect
              className="sch-band"
              x={u(Math.min(band.x1, band.x2))}
              y={u(Math.min(band.y1, band.y2))}
              width={u(Math.abs(band.x2 - band.x1))}
              height={u(Math.abs(band.y2 - band.y1))}
              pointerEvents="none"
            />
          )}
        </svg>

        {circuit.components.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-5 rounded-2xl border text-center max-w-sm"
              style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)' }}>
              <h3 className="font-semibold text-sm mb-1">Build your circuit here</h3>
              <p className="text-xs text-muted">
                Open the <span className="font-semibold" style={{ color: 'var(--accent)' }}>Library</span> tab on the left and click a part
                to add it to the schematic. Then click one pin and another pin to draw a wire.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Pin context menu */}
      {menu && (
        <PinContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ============ SYMBOL RENDERING ============

function SymbolBodyView({
  model,
  selected,
  onSymbolPointerDown,
}: {
  model: SymbolModel;
  selected: boolean;
  onSymbolPointerDown: (e: React.PointerEvent, m: SymbolModel) => void;
}) {
  const { layout, pos } = model;

  return (
    <g
      className={selected ? 'sch-selected' : undefined}
      transform={`translate(${u(pos.x)}, ${u(pos.y)})`}
      onPointerDown={(e) => onSymbolPointerDown(e, model)}
      style={{ cursor: 'grab' }}
    >
      {/* Selection halo */}
      {selected && (
        <rect
          x={-8}
          y={-8}
          width={u(layout.width) + 16}
          height={u(layout.height) + 16}
          rx={10}
          fill="var(--accent)"
          opacity={0.07}
          stroke="var(--accent)"
          strokeOpacity={0.35}
          strokeDasharray="4 4"
          pointerEvents="none"
        />
      )}

      {/* Invisible hit area: the whole symbol body is a grab handle. The
          artwork itself is pointer-events:none, so without this a press in
          the middle of a body would fall through to the sheet. */}
      <rect
        x={0}
        y={0}
        width={u(layout.width)}
        height={u(layout.height)}
        fill="transparent"
      />

      <SymbolBody layout={layout} />

      {/* Labels */}
      <text
        x={0}
        y={-10}
        fontSize={12}
        className="sch-canvas-text sch-label-ref"
        style={{ fill: selected ? 'var(--accent)' : 'var(--sch-label)' }}
      >
        {model.reference}
      </text>
      {model.value && (
        <text
          x={0}
          y={u(layout.height) + 16}
          fontSize={10}
          className="sch-canvas-text sch-label-value"
        >
          {model.value}
        </text>
      )}
    </g>
  );
}

/**
 * Pins are a separate top layer: wires are drawn above symbol bodies (so they
 * never disappear under a symbol), and pins must stay above the wires so the
 * pin dots are visible and clickable where a wire ends on them.
 */
function SymbolPinsView({
  model,
  pinNets,
  selectedNetId,
  pending,
  onPinClick,
  onPinContextMenu,
}: {
  model: SymbolModel;
  pinNets: Map<string, string>;
  selectedNetId: string | null;
  pending: { componentId: string; pinId: string } | null;
  onPinClick: (e: React.MouseEvent, componentId: string, pinId: string) => void;
  onPinContextMenu: (e: React.MouseEvent, componentId: string, pinId: string) => void;
}) {
  const { layout, pos } = model;

  return (
    <g transform={`translate(${u(pos.x)}, ${u(pos.y)})`}>
      {layout.pins.map(pin => {
        const key = `${model.componentId}:${pin.pinId}`;
        const netId = pinNets.get(key);
        const isPending = pending?.componentId === model.componentId && pending?.pinId === pin.pinId;
        const isSelectedNet = Boolean(netId && selectedNetId === netId);
        const px = u(pin.x);
        const py = u(pin.y);

        const numberPos = (() => {
          switch (pin.side) {
            case 'left': return { x: px + 6, y: py - 7, anchor: 'start' as const };
            case 'right': return { x: px - 6, y: py - 7, anchor: 'end' as const };
            case 'bottom': return { x: px + 6, y: py - 7, anchor: 'start' as const };
            default: return { x: px + 6, y: py + 14, anchor: 'start' as const };
          }
        })();

        return (
          <g
            key={key}
            className="sch-pin"
            onClick={(e) => onPinClick(e, model.componentId, pin.pinId)}
            onContextMenu={(e) => onPinContextMenu(e, model.componentId, pin.pinId)}
            style={{ cursor: 'crosshair' }}
          >
            {/* Large invisible hit area */}
            <circle className="sch-pin-hit" cx={px} cy={py} r={12} />
            {isSelectedNet && (
              <circle cx={px} cy={py} r={7} fill="none" stroke="var(--accent)" strokeWidth={1.5} pointerEvents="none" />
            )}
            {isPending && (
              <circle cx={px} cy={py} r={8} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" pointerEvents="none" />
            )}
            <circle className="sch-pin-dot" cx={px} cy={py} pointerEvents="none" />
            <text
              x={numberPos.x}
              y={numberPos.y}
              textAnchor={numberPos.anchor}
              fontSize={9}
              fontFamily="ui-monospace, monospace"
              fill="var(--text-muted)"
              pointerEvents="none"
            >
              {pin.number}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ============ SYMBOL BODIES ============

function SymbolBody({ layout }: { layout: SymbolLayout }) {
  const w = u(layout.width);
  const h = u(layout.height);
  const midY = h / 2;

  switch (layout.drawing) {
    case 'resistor':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(1.5)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(4.5)} y1={midY} x2={w} y2={midY} />
          <rect className="sch-symbol-body" x={u(1.5)} y={midY - u(0.9)} width={u(3)} height={u(1.8)} rx={3} pointerEvents="none" />
        </g>
      );
    case 'capacitor':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.6)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(3.4)} y1={midY} x2={w} y2={midY} />
          <line className="sch-symbol-detail" x1={u(2.6)} y1={midY - u(1.1)} x2={u(2.6)} y2={midY + u(1.1)} />
          <line className="sch-symbol-detail" x1={u(3.4)} y1={midY - u(1.1)} x2={u(3.4)} y2={midY + u(1.1)} />
        </g>
      );
    case 'polarized-capacitor':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.6)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(3.4)} y1={midY} x2={w} y2={midY} />
          <line className="sch-symbol-detail" x1={u(2.6)} y1={midY - u(1.1)} x2={u(2.6)} y2={midY + u(1.1)} />
          <path className="sch-symbol-detail" d={`M ${u(3.4)} ${midY - u(1.1)} A ${u(0.9)} ${u(0.9)} 0 0 0 ${u(3.4)} ${midY + u(1.1)}`} />
          <text x={u(2.1)} y={midY - u(1.3)} fontSize={11} fill="var(--danger)" fontFamily="monospace" pointerEvents="none">+</text>
        </g>
      );
    case 'diode':
    case 'led':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.4)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(3.6)} y1={midY} x2={w} y2={midY} />
          <path
            className="sch-symbol-body sch-symbol-fill-soft"
            d={`M ${u(2.4)} ${midY - u(1)} L ${u(3.6)} ${midY} L ${u(2.4)} ${midY + u(1)} Z`}
            pointerEvents="none"
          />
          <line className="sch-symbol-detail" x1={u(3.6)} y1={midY - u(1)} x2={u(3.6)} y2={midY + u(1)} />
          {layout.drawing === 'led' && (
            <g className="sch-symbol-detail">
              <line x1={u(4.1)} y1={midY - u(1.2)} x2={u(4.9)} y2={midY - u(1.9)} />
              <line x1={u(4.9)} y1={midY - u(1.9)} x2={u(4.55)} y2={midY - u(1.8)} />
              <line x1={u(4.9)} y1={midY - u(1.9)} x2={u(4.8)} y2={midY - u(1.55)} />
              <line x1={u(4.9)} y1={midY - u(0.8)} x2={u(5.7)} y2={midY - u(1.5)} />
              <line x1={u(5.7)} y1={midY - u(1.5)} x2={u(5.35)} y2={midY - u(1.4)} />
              <line x1={u(5.7)} y1={midY - u(1.5)} x2={u(5.6)} y2={midY - u(1.15)} />
            </g>
          )}
        </g>
      );
    case 'crystal':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.2)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(3.8)} y1={midY} x2={w} y2={midY} />
          <line className="sch-symbol-detail" x1={u(2.2)} y1={midY - u(1.1)} x2={u(2.2)} y2={midY + u(1.1)} />
          <line className="sch-symbol-detail" x1={u(3.8)} y1={midY - u(1.1)} x2={u(3.8)} y2={midY + u(1.1)} />
          <rect className="sch-symbol-body" x={u(2.6)} y={midY - u(0.8)} width={u(0.8)} height={u(1.6)} pointerEvents="none" />
        </g>
      );
    case 'potentiometer':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(5)} y1={midY} x2={w} y2={midY} />
          <rect className="sch-symbol-body" x={u(2)} y={midY - 9} width={u(3)} height={18} rx={3} pointerEvents="none" />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={h} x2={u(3.5)} y2={midY + 12} />
          <path className="sch-symbol-body sch-symbol-fill-soft" d={`M ${u(3.2)} ${midY + 12} L ${u(3.5)} ${midY + 4} L ${u(3.8)} ${midY + 12} Z`} pointerEvents="none" />
        </g>
      );
    case 'switch':
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.6)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(4.6)} y1={midY} x2={w} y2={midY} />
          <circle cx={u(2.6)} cy={midY} r={3} fill="var(--sch-symbol)" />
          <circle cx={u(4.6)} cy={midY} r={3} fill="var(--sch-symbol)" />
          <line className="sch-symbol-detail" x1={u(2.6)} y1={midY} x2={u(4.35)} y2={midY - 12} />
          <line className="sch-symbol-detail" x1={u(2.6)} y1={midY} x2={u(3.5)} y2={h} strokeDasharray="3 3" opacity={0.5} />
        </g>
      );
    case 'push-button': {
      const isFourPin = layout.pins.length === 4;
      if (!isFourPin) {
        return (
          <g>
            <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2)} y2={midY} />
            <line className="sch-symbol-detail" x1={u(4)} y1={midY} x2={w} y2={midY} />
            <line className="sch-symbol-detail" x1={u(2)} y1={midY} x2={u(2)} y2={u(1.3)} />
            <line className="sch-symbol-detail" x1={u(4)} y1={midY} x2={u(4)} y2={u(1.3)} />
            <line className="sch-symbol-detail" x1={u(1.2)} y1={u(1.1)} x2={u(4.8)} y2={u(1.1)} />
            <line className="sch-symbol-detail" x1={u(3)} y1={u(1.1)} x2={u(3)} y2={u(0.3)} />
          </g>
        );
      }
      return (
        <g>
          <line className="sch-symbol-detail" x1={0} y1={u(1.8)} x2={u(2)} y2={u(1.8)} />
          <line className="sch-symbol-detail" x1={0} y1={u(4.2)} x2={u(2)} y2={u(4.2)} />
          <line className="sch-symbol-detail" x1={w} y1={u(1.8)} x2={w - u(2)} y2={u(1.8)} />
          <line className="sch-symbol-detail" x1={w} y1={u(4.2)} x2={w - u(2)} y2={u(4.2)} />
          <line className="sch-symbol-detail" x1={u(2)} y1={u(1.8)} x2={u(2)} y2={u(4.2)} />
          <line className="sch-symbol-detail" x1={w - u(2)} y1={u(1.8)} x2={w - u(2)} y2={u(4.2)} />
          <circle className="sch-symbol-body" cx={w / 2} cy={midY} r={u(0.8)} pointerEvents="none" />
          <line className="sch-symbol-detail" x1={w / 2} y1={midY - u(0.8)} x2={w / 2} y2={midY - u(1.8)} />
        </g>
      );
    }
    case 'transistor':
      return (
        <g>
          <circle className="sch-symbol-body sch-symbol-fill-soft" cx={u(4)} cy={midY} r={u(2.2)} pointerEvents="none" />
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(3)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(3)} y1={midY - u(1.1)} x2={u(3)} y2={midY + u(1.1)} />
          <line className="sch-symbol-detail" x1={u(3)} y1={midY - u(0.5)} x2={u(5.4)} y2={u(1.8)} />
          <line className="sch-symbol-detail" x1={u(5.4)} y1={u(1.8)} x2={w} y2={u(1.8)} />
          <line className="sch-symbol-detail" x1={u(3)} y1={midY + u(0.5)} x2={u(5.4)} y2={u(4.2)} />
          <line className="sch-symbol-detail" x1={u(5.4)} y1={u(4.2)} x2={w} y2={u(4.2)} />
          <path
            className="sch-symbol-body"
            d={`M ${u(4.4)} ${u(3.5)} L ${u(5.2)} ${u(3.9)} L ${u(4.5)} ${u(4.15)} Z`}
            pointerEvents="none"
          />
        </g>
      );
    case 'mosfet':
      return (
        <g>
          <circle className="sch-symbol-body sch-symbol-fill-soft" cx={u(4)} cy={midY} r={u(2.2)} pointerEvents="none" />
          <line className="sch-symbol-detail" x1={0} y1={midY} x2={u(2.8)} y2={midY} />
          <line className="sch-symbol-detail" x1={u(2.8)} y1={midY - u(1.1)} x2={u(2.8)} y2={midY + u(1.1)} />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={midY - u(1.2)} x2={u(3.5)} y2={midY - u(0.5)} />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={midY - u(0.35)} x2={u(3.5)} y2={midY + u(0.35)} />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={midY + u(0.5)} x2={u(3.5)} y2={midY + u(1.2)} />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={midY - u(0.9)} x2={u(6)} y2={midY - u(0.9)} />
          <line className="sch-symbol-detail" x1={u(6)} y1={midY - u(0.9)} x2={w} y2={u(1.8)} />
          <line className="sch-symbol-detail" x1={u(3.5)} y1={midY + u(0.9)} x2={u(6)} y2={midY + u(0.9)} />
          <line className="sch-symbol-detail" x1={u(6)} y1={midY + u(0.9)} x2={w} y2={u(4.2)} />
        </g>
      );
    case 'dip':
    case 'header':
    case 'generic':
    case 'regulator': {
      const isDip = layout.drawing === 'dip';
      const bodyX = isDip ? u(1) : u(1.5);
      const bodyW = isDip ? u(layout.width - 2) : u(layout.width - 1.5);
      const bodyY = isDip ? u(0.5) : u(0.2);
      const bodyH = isDip ? h - u(1) : h - u(0.4);

      return (
        <g>
          {layout.drawing === 'regulator' && (
            <rect className="sch-symbol-body sch-symbol-fill-soft" x={u(2.5)} y={u(0.2)} width={u(3)} height={u(0.8)} rx={2} pointerEvents="none" />
          )}
          <rect className="sch-symbol-body" x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx={4} pointerEvents="none" />
          {isDip && (
            <circle cx={w / 2} cy={u(1.05)} r={4} fill="none" stroke="var(--sch-symbol)" strokeWidth={1.2} pointerEvents="none" />
          )}
          {/* Pin leads */}
          {layout.pins.map(pin => {
            const px = u(pin.x);
            const py = u(pin.y);
            if (pin.side === 'left') {
              return <line key={pin.pinId} className="sch-symbol-detail" x1={px} y1={py} x2={bodyX} y2={py} />;
            }
            if (pin.side === 'right') {
              return <line key={pin.pinId} className="sch-symbol-detail" x1={px} y1={py} x2={bodyX + bodyW} y2={py} />;
            }
            if (pin.side === 'bottom') {
              return <line key={pin.pinId} className="sch-symbol-detail" x1={px} y1={py} x2={px} y2={bodyY + bodyH} />;
            }
            return <line key={pin.pinId} className="sch-symbol-detail" x1={px} y1={py} x2={px} y2={bodyY} />;
          })}
          {/* Pin names for DIPs and headers */}
          {layout.pins.map(pin => {
            const py = u(pin.y);
            if (pin.side === 'left') {
              return (
                <text key={`n-${pin.pinId}`} x={bodyX + 6} y={py + 3.5} fontSize={9} fontFamily="ui-monospace, monospace" fill="var(--text-muted)" pointerEvents="none">
                  {shortPinName(pin.name)}
                </text>
              );
            }
            if (pin.side === 'right') {
              return (
                <text key={`n-${pin.pinId}`} x={bodyX + bodyW - 6} y={py + 3.5} fontSize={9} textAnchor="end" fontFamily="ui-monospace, monospace" fill="var(--text-muted)" pointerEvents="none">
                  {shortPinName(pin.name)}
                </text>
              );
            }
            return null;
          })}
        </g>
      );
    }
    default:
      return (
        <rect className="sch-symbol-body" x={0} y={0} width={w} height={h} rx={4} pointerEvents="none" />
      );
  }
}

function shortPinName(name: string): string {
  if (!name) return '';
  const cleaned = name.replace(/^(pin\s*)/i, '');
  return cleaned.length > 10 ? cleaned.slice(0, 9) + '…' : cleaned;
}

// ============ PIN CONTEXT MENU ============

function PinContextMenu({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; componentId: string; pinId: string };
  onClose: () => void;
}) {
  const circuit = useAppStore(s => s.circuit);
  const disconnectPin = useAppStore(s => s.disconnectPinFromNet);
  const removeNet = useAppStore(s => s.removeNet);

  const comp = circuit.components.find(c => c.id === menu.componentId);
  const netId = comp?.pins.get(menu.pinId);
  const net = netId ? circuit.nets.find(n => n.id === netId) : undefined;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-40 rounded-lg shadow-xl py-1 min-w-44 border"
        style={{ left: menu.x, top: menu.y, backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)' }}
      >
        <div className="px-3 py-1 text-[10px] text-muted border-b border-app">
          {comp?.reference} · pin {menu.pinId.replace(/^pin-/, '')}
        </div>
        {net && (
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover-bg"
            onClick={() => { disconnectPin(menu.componentId, menu.pinId); onClose(); }}
          >
            ✂ Disconnect from {net.name}
          </button>
        )}
        {net && (
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover-bg"
            onClick={() => { removeNet(net.id); onClose(); }}
            style={{ color: 'var(--danger)' }}
          >
            🗑 Delete net “{net.name}”
          </button>
        )}
        {!net && (
          <div className="px-3 py-1.5 text-[11px] text-muted">Not connected — click to start a wire</div>
        )}
      </div>
    </>
  );
}
