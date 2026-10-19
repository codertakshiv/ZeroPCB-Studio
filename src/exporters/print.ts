/**
 * Printable document export (assembly guide) - print-ready HTML
 * with @media print rules for A4 portrait/landscape.
 */

import { AssemblyGuide, AssemblyStep } from '../soldering/types';
import { BoardState, coordToLabel } from '../board/types';
import { PlacedComponent } from '../footprints/types';
import { Net } from '../circuit/types';
import { Route } from '../routing/types';

/**
 * Inline brand mark for the printed guide.
 * Mirrors `public/favicon.svg` (kept inline so it renders in the print window,
 * which has no access to the app's static assets).
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="40" height="40">
  <rect x="0" y="0" width="32" height="32" rx="7" fill="#000000"/>
  <g fill="#2e2e2e">
    <circle cx="8" cy="8" r="1.8"/><circle cx="16" cy="8" r="1.8"/><circle cx="24" cy="8" r="1.8"/>
    <circle cx="8" cy="16" r="1.8"/><circle cx="24" cy="16" r="1.8"/>
    <circle cx="8" cy="24" r="1.8"/><circle cx="16" cy="24" r="1.8"/><circle cx="24" cy="24" r="1.8"/>
  </g>
  <path d="M16 8 L16 16 L24 16 L24 24" fill="none" stroke="#f2f2f2" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#f2f2f2">
    <circle cx="16" cy="8" r="3.2"/>
    <circle cx="16" cy="16" r="3.2"/>
    <circle cx="24" cy="24" r="3.2"/>
  </g>
</svg>`;

export interface PrintOptions {
  pageSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  projectName: string;
  includeComponentSideSVG?: string;
  includeSolderSideSVG?: string;
  includeCoverPage: boolean;
}

export function generatePrintableGuide(
  guide: AssemblyGuide,
  board: BoardState,
  components: PlacedComponent[],
  nets: Net[],
  routes: Route[],
  options: PrintOptions
): string {
  const pageCss = options.pageSize === 'A4'
    ? (options.orientation === 'portrait' ? '210mm 297mm' : '297mm 210mm')
    : (options.orientation === 'portrait' ? '8.5in 11in' : '11in 8.5in');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(options.projectName)} — Assembly Guide</title>
<style>
  @page { size: ${pageCss}; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 10pt;
    color: #111;
    margin: 0;
    line-height: 1.4;
  }
  h1 { font-size: 18pt; margin: 0 0 4pt 0; }
  h2 { font-size: 13pt; margin: 14pt 0 6pt 0; border-bottom: 1.5pt solid #2563eb; padding-bottom: 2pt; }
  h3 { font-size: 11pt; margin: 10pt 0 4pt 0; }
  .cover { page-break-after: always; text-align: center; padding-top: 40mm; }
  .cover h1 { font-size: 26pt; }
  .cover .cover-logo { margin-bottom: 8pt; }
  .cover .meta { color: #555; margin-top: 8pt; }
  .legend { display: flex; gap: 12pt; justify-content: center; margin: 10pt 0; font-size: 9pt; }
  .legend span { display: inline-flex; align-items: center; gap: 3pt; }
  .swatch { display: inline-block; width: 10pt; height: 10pt; border: 0.5pt solid #333; }
  .diagrams { display: flex; gap: 8mm; justify-content: center; page-break-after: always; margin-top: 6mm; }
  .diagram-box { text-align: center; }
  .diagram-box svg { max-width: 130mm; height: auto; }
  .diagram-box .caption { font-size: 9pt; font-weight: bold; margin-top: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  th, td { border: 0.5pt solid #999; padding: 3pt 4pt; text-align: left; font-size: 9pt; }
  th { background: #eef; font-weight: 600; }
  .step { display: flex; gap: 6pt; margin-bottom: 6pt; page-break-inside: avoid; }
  .step-check { width: 12pt; height: 12pt; border: 1pt solid #333; flex-shrink: 0; margin-top: 1pt; }
  .step-body { flex: 1; }
  .step-title { font-weight: 600; }
  .step-meta { color: #555; font-size: 8.5pt; margin-top: 1pt; }
  .coords { font-family: ui-monospace, Consolas, monospace; background: #f3f4f6; padding: 0 3pt; border-radius: 2pt; }
  .note { background: #fef3c7; border-left: 3pt solid #d97706; padding: 4pt 6pt; margin: 6pt 0; font-size: 9pt; }
  .checklist-row { display: flex; gap: 6pt; align-items: flex-start; margin-bottom: 3pt; }
  .badge { display: inline-block; border: 0.5pt solid #666; border-radius: 2pt; padding: 0 3pt; font-size: 8pt; margin-right: 3pt; }
  .footer { margin-top: 10pt; border-top: 0.5pt solid #999; padding-top: 4pt; font-size: 8pt; color: #666; }
  @media print {
    .no-print { display: none; }
  }
</style>
</head>
<body>
${options.includeCoverPage ? `
<div class="cover">
  <div class="cover-logo">${LOGO_SVG}</div>
  <h1>${escapeHtml(options.projectName)}</h1>
  <p class="meta">Zero PCB Soldering Assembly Guide</p>
  <p class="meta">Board: ${escapeHtml(board.config.name)} — ${board.config.dimensions.rows}×${board.config.dimensions.cols} holes @ ${board.config.dimensions.holePitchMm}mm pitch</p>
  <p class="meta">${components.length} components · ${nets.length} nets · ${routes.length} routed connections</p>
  <p class="meta">Generated: ${new Date().toLocaleString()}</p>
  <div class="legend">
    <span><span class="swatch" style="background:#181c20"></span> Component body</span>
    <span><span class="swatch" style="background:#d7b348"></span> Copper pad / pin</span>
    <span><span class="swatch" style="background:#dc2626"></span> Track cut</span>
  </div>
  <div class="note" style="max-width: 120mm; margin: 10mm auto;">
    This guide was generated from a validated board layout. Follow each step in order.
    Tick each checkbox as you complete it. Coordinates use row letters (A, B, C…) and
    column numbers (1, 2, 3…), referring to holes as seen from the COMPONENT side.
  </div>
</div>` : ''}

${options.includeComponentSideSVG || options.includeSolderSideSVG ? `
<h2>Board Diagrams</h2>
<div class="diagrams">
  ${options.includeComponentSideSVG ? `<div class="diagram-box">${options.includeComponentSideSVG}<div class="caption">Component side (top view)</div></div>` : ''}
  ${options.includeSolderSideSVG ? `<div class="diagram-box">${options.includeSolderSideSVG}<div class="caption">Solder side (mirrored view)</div></div>` : ''}
</div>
` : ''}

<h2>Bill of Materials</h2>
${renderBOMTable(components)}

<h2>Assembly Steps (${guide.steps.length} total · est. ${Math.round(guide.estimatedTotalTimeSeconds / 60)} min)</h2>
${(() => {
  const groups = groupStepsByPhase(guide.steps);
  return groups.map(group => `
    <h3>${escapeHtml(group.title)}</h3>
    ${group.steps.map(step => renderStep(step)).join('')}
  `).join('');
})()}

<h2>Final Inspection Checklist</h2>
<div>
  <div class="checklist-row"><div class="step-check"></div><div>No solder bridges between adjacent pads or strips</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>All polarized components (LEDs, electrolytic caps, diodes, ICs) oriented correctly</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>All jumper wires soldered on both ends on the correct side</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>No cold solder joints (shiny, smooth solder fillets)</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>Continuity verified with multimeter on every net</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>No unintended shorts between adjacent nets</div></div>
  <div class="checklist-row"><div class="step-check"></div><div>Board cleaned of flux residue</div></div>
</div>

<div class="footer">
  Generated by ZeroPCB Studio — all coordinates verified against the board layout.
  Net names: ${nets.map(n => escapeHtml(n.name)).join(', ')}
</div>
</body>
</html>`;
}

function renderStep(step: AssemblyStep): string {
  const typeLabels: Record<string, string> = {
    'place-component': 'PLACE',
    'solder-pin': 'SOLDER',
    'install-jumper': 'JUMPER',
    'cut-track': 'CUT TRACK',
    'add-bridge': 'BRIDGE',
    'verify-connection': 'VERIFY',
    'inspect': 'INSPECT',
  };
  
  return `
<div class="step">
  <div class="step-check"></div>
  <div class="step-body">
    <div class="step-title"><span class="badge">${typeLabels[step.type] || step.type}</span> ${escapeHtml(step.description)}</div>
    ${step.detailedDescription ? `<div class="step-meta">${escapeHtml(step.detailedDescription)}</div>` : ''}
    ${step.coordinates.length > 0 ? `<div class="step-meta">Pads: ${step.coordinates.map(c => `<span class="coords">${coordToLabel(c)}</span>`).join(' → ')}</div>` : ''}
    ${step.tools && step.tools.length > 0 ? `<div class="step-meta">Tools: ${step.tools.map(t => escapeHtml(t)).join(', ')}</div>` : ''}
  </div>
</div>`;
}

interface StepGroup {
  title: string;
  steps: AssemblyStep[];
}

function groupStepsByPhase(steps: AssemblyStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  
  const phases: { key: string; title: string; types: string[] }[] = [
    { key: 'components', title: 'Phase 1: Component Placement', types: ['place-component'] },
    { key: 'soldering', title: 'Phase 2: Solder Component Pins', types: ['solder-pin'] },
    { key: 'jumpers', title: 'Phase 3: Install Jumper Wires', types: ['install-jumper'] },
    { key: 'tracks', title: 'Phase 4: Track Cuts & Bridges', types: ['cut-track', 'add-bridge'] },
    { key: 'verification', title: 'Phase 5: Verification', types: ['verify-connection', 'inspect'] },
  ];
  
  for (const phase of phases) {
    const phaseSteps = steps.filter(s => phase.types.includes(s.type));
    if (phaseSteps.length > 0) {
      groups.push({ title: phase.title, steps: phaseSteps });
    }
  }
  
  return groups;
}

function renderBOMTable(components: PlacedComponent[]): string {
  const groups = new Map<string, { refs: string[]; value: string; footprint: string }>();
  
  for (const comp of components) {
    const key = `${comp.footprintId}|${comp.value || ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.refs.push(comp.reference);
    } else {
      groups.set(key, {
        refs: [comp.reference],
        value: comp.value || '',
        footprint: comp.footprint.name,
      });
    }
  }
  
  const rows = Array.from(groups.values()).map(g => `
    <tr>
      <td>${g.refs.sort().map(r => escapeHtml(r)).join(', ')}</td>
      <td>${escapeHtml(g.value)}</td>
      <td>${escapeHtml(g.footprint)}</td>
      <td style="text-align:center">${g.refs.length}</td>
    </tr>
  `).join('');
  
  return `
<table>
  <thead>
    <tr><th>References</th><th>Value</th><th>Footprint</th><th>Qty</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}