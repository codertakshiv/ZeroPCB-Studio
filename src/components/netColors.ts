/**
 * Deterministic net colours.
 *
 * Shared by the board canvas, the schematic editor and the circuit panel so a
 * net keeps the same colour everywhere. Lives in its own module (rather than
 * in BoardCanvas) so component files only export components.
 */

const NET_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#eab308', // yellow
  '#a855f7', // purple
  '#f97316', // orange
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#f43f5e', // rose
  '#38bdf8', // sky
];

export function getNetColor(netNameOrId: string): string {
  let hash = 0;
  for (let i = 0; i < netNameOrId.length; i++) {
    hash = ((hash << 5) - hash + netNameOrId.charCodeAt(i)) | 0;
  }
  return NET_COLORS[Math.abs(hash) % NET_COLORS.length];
}
