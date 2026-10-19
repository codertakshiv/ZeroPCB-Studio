/**
 * Cursor-anchored zoom and touch gestures for a scrollable canvas.
 *
 * - Mouse wheel zooms around the pointer: the hole / symbol under the cursor
 *   stays put instead of the view jumping to the centre.
 * - On touch screens one finger pans the canvas and two fingers pinch-zoom
 *   around the pinch midpoint.
 * - Middle mouse button pans too (wired up by the caller through `getPan`).
 *
 * The canvas is a normal scroll container; zoom is applied by the caller
 * (transform scale or svg size) and this hook compensates the scroll offset so
 * the anchor point never drifts.
 */

import { useEffect, useRef } from 'react';

export interface CursorZoomOptions {
  /** Zoom limits (defaults 0.25..4) */
  min?: number;
  max?: number;
  /** Content translate that is part of the zoomed layout (board pan offsets) */
  getPan?: () => { x: number; y: number };
  /**
   * Padding that sits inside the scroll container but is *not* scaled by the
   * zoom (the schematic sheet has unscaled padding around the svg).
   */
  unscaledPadding?: number;
  enabled?: boolean;
}

export function useCursorZoom(
  containerRef: React.RefObject<HTMLElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
  options: CursorZoomOptions = {}
) {
  const { min = 0.25, max = 4, getPan, unscaledPadding = 0, enabled = true } = options;

  // Native listeners read the latest values through refs
  const zoomRef = useRef(zoom);
  const setZoomRef = useRef(setZoom);
  const getPanRef = useRef(getPan);
  zoomRef.current = zoom;
  setZoomRef.current = setZoom;
  getPanRef.current = getPan;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const clamp = (v: number) => Math.max(min, Math.min(max, v));
    let applied = zoomRef.current;

    /** Zoom so the content point under (clientX, clientY) stays pinned. */
    const zoomAt = (target: number, clientX: number, clientY: number) => {
      const next = clamp(target);
      if (Math.abs(next - applied) < 1e-4) return;
      const prev = applied;
      const pan = getPanRef.current ? getPanRef.current() : { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const contentX = (container.scrollLeft + cx - pan.x - unscaledPadding) / prev;
      const contentY = (container.scrollTop + cy - pan.y - unscaledPadding) / prev;

      applied = next;
      zoomRef.current = next;
      setZoomRef.current(next);

      // Restore the scroll once React has committed the new size
      requestAnimationFrame(() => {
        container.scrollLeft = contentX * next + pan.x + unscaledPadding - cx;
        container.scrollTop = contentY * next + pan.y + unscaledPadding - cy;
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0018);
      zoomAt(zoomRef.current * factor, e.clientX, e.clientY);
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    // --- Touch: one finger pans, two fingers pinch ---
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; zoom: number } | null = null;
    let panPointer: { id: number; x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        panPointer = null;
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
      } else if (pointers.size === 1) {
        panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 0) {
          zoomAt(pinch.zoom * (distance / pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        return;
      }

      if (panPointer && panPointer.id === e.pointerId) {
        container.scrollLeft -= e.clientX - panPointer.x;
        container.scrollTop -= e.clientY - panPointer.y;
        panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (panPointer?.id === e.pointerId) panPointer = null;
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
    };
    // getPan is read through a ref on purpose (changes every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, enabled, min, max, unscaledPadding]);
}
