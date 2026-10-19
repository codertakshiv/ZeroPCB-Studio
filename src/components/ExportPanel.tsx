/**
 * Export panel - all export operations
 */

import React, { useState } from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button } from './ui';
import { renderBoardSVG } from '../exporters/svg';
import { 
  exportBOMCSV, 
  exportCoordinateListCSV, 
  exportJumperListCSV, 
  exportTrackCutListCSV,
  exportNetlistCSV,
} from '../exporters/csv';
import { downloadTextFile, downloadBlob, svgToPNG, printHTML, sanitizeFilename } from '../exporters/download';
import { generatePrintableGuide } from '../exporters/print';
import { createProjectFile, serializeProject, deserializeProject } from '../exporters/types';
import { getStorage } from '../storage/types';
import {
  LOCAL_PROJECT_ID,
  buildStoredProject,
  persistedSliceOf,
  saveStatusLabel,
  storedToLoadPayload,
} from '../storage/autosave';
import { coordToLabel } from '../board/types';

export function ExportPanel() {
  const board = useAppStore(s => s.board);
  const boardConfig = useAppStore(s => s.boardConfig);
  const components = useAppStore(s => s.placedComponents);
  const routes = useAppStore(s => s.routes);
  const nets = useAppStore(s => s.circuit.nets);
  const circuit = useAppStore(s => s.circuit);
  const validationResult = useAppStore(s => s.validationResult);
  const assemblyGuide = useAppStore(s => s.assemblyGuide);
  const projectMetadata = useAppStore(s => s.projectMetadata);
  const markSaved = useAppStore(s => s.markSaved);
  const loadProject = useAppStore(s => s.loadProject);
  const resetProject = useAppStore(s => s.resetProject);
  const saveStatus = useAppStore(s => s.saveStatus);
  const saveStatusAt = useAppStore(s => s.saveStatusAt);
  const saveError = useAppStore(s => s.saveError);
  const setSaveStatus = useAppStore(s => s.setSaveStatus);
  
  const [exporting, setExporting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const baseName = sanitizeFilename(projectMetadata.name || circuit.name || 'zeropcb-project');
  
  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };
  
  const requireLayout = (): boolean => {
    if (components.length === 0) {
      flash('⚠ Place components first — exports must reflect a real layout.');
      return false;
    }
    return true;
  };
  
  const exportSVG = (side: 'component' | 'solder') => {
    if (!requireLayout()) return;
    const svg = renderBoardSVG(board, components, routes, nets, {
      side,
      title: `${projectMetadata.name || circuit.name} — ${side === 'component' ? 'Component Side' : 'Solder Side'}`,
      scaleBar: true,
    });
    downloadTextFile(svg, `${baseName}-${side}.svg`, 'image/svg+xml');
    flash(`✓ Exported ${side} side SVG`);
  };
  
  const exportPNG = async (side: 'component' | 'solder') => {
    if (!requireLayout()) return;
    setExporting(`png-${side}`);
    try {
      const svg = renderBoardSVG(board, components, routes, nets, {
        side,
        title: `${projectMetadata.name || circuit.name} — ${side === 'component' ? 'Component Side' : 'Solder Side'}`,
        scaleBar: true,
      });
      const blob = await svgToPNG(svg, 2);
      downloadBlob(blob, `${baseName}-${side}.png`);
      flash(`✓ Exported ${side} side PNG`);
    } catch (e) {
      flash(`✗ PNG export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setExporting(null);
    }
  };
  
  const exportProjectJSON = () => {
    const project = createProjectFile(board, circuit, components, routes, nets, {
      name: projectMetadata.name,
      version: projectMetadata.version,
    });
    project.validation = validationResult || undefined;
    project.assemblyGuide = assemblyGuide || undefined;
    project.schematicPositions = useAppStore.getState().schematicPositions;
    project.schematicCanvasSize = useAppStore.getState().schematicCanvasSize;
    project.routingPreference = useAppStore.getState().routingConfig.preference;
    
    downloadTextFile(serializeProject(project), `${baseName}.json`, 'application/json');
    markSaved();
    flash('✓ Exported project JSON');
  };
  
  const importProjectJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = deserializeProject((e.target?.result as string) || '');
        if (!project) {
          flash('✗ Invalid project file: missing required fields');
          return;
        }
        
        loadProject({
          board: project.board,
          boardConfig: project.board.config,
          circuit: project.circuit,
          placedComponents: project.components,
          routes: project.routes,
          projectMetadata: project.metadata,
          schematicPositions: project.schematicPositions,
          schematicCanvasSize: project.schematicCanvasSize,
        });
        flash('✓ Project loaded');
      } catch (err) {
        flash(`✗ Failed to parse project: ${err instanceof Error ? err.message : 'invalid JSON'}`);
      }
    };
    reader.readAsText(file);
  };
  
  const saveToIndexedDB = async () => {
    setSaveStatus('saving');
    try {
      const storage = await getStorage();
      // Same slot the autosave uses: one local project per browser
      const existing = await storage.getProject(LOCAL_PROJECT_ID);
      const stored = buildStoredProject(persistedSliceOf(useAppStore.getState()), {
        id: LOCAL_PROJECT_ID,
        createdAt: existing?.createdAt,
      });
      
      await storage.saveProject(stored);
      markSaved();
      setSaveStatus('saved');
      flash('✓ Saved to browser storage');
    } catch (e) {
      setSaveStatus('error', e instanceof Error ? e.message : 'browser storage unavailable');
      flash(`✗ Save failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };
  
  const loadFromIndexedDB = async () => {
    try {
      const storage = await getStorage();
      const projects = await storage.getAllProjects();
      
      if (projects.length === 0) {
        flash('No saved projects found');
        return;
      }
      
      const mostRecent = projects.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      
      loadProject(storedToLoadPayload(mostRecent));
      setSaveStatus('saved');
      flash(`✓ Loaded "${mostRecent.metadata.name}"`);
    } catch (e) {
      flash(`✗ Load failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };
  
  const exportPrintableGuide = () => {
    if (!requireLayout()) return;
    
    const componentSVG = renderBoardSVG(board, components, routes, nets, {
      side: 'component', scaleBar: false, pxPerMm: 2.5, title: undefined,
    });
    const solderSVG = renderBoardSVG(board, components, routes, nets, {
      side: 'solder', scaleBar: false, pxPerMm: 2.5, title: undefined,
    });
    
    // Auto-generate guide if missing
    let guide = assemblyGuide;
    if (!guide) {
      useAppStore.getState().generateGuide();
      guide = useAppStore.getState().assemblyGuide;
    }
    
    if (!guide) {
      flash('✗ Could not generate assembly guide');
      return;
    }
    
    const html = generatePrintableGuide(guide, board, components, nets, routes, {
      pageSize: 'A4',
      orientation: 'portrait',
      projectName: projectMetadata.name || circuit.name,
      includeComponentSideSVG: componentSVG,
      includeSolderSideSVG: solderSVG,
      includeCoverPage: true,
    });
    
    printHTML(html, `${projectMetadata.name} — Assembly Guide`);
    flash('✓ Opened print dialog (choose "Save as PDF")');
  };
  
  const exportChecklistPrint = () => {
    if (!assemblyGuide) {
      useAppStore.getState().generateGuide();
    }
    const guide = useAppStore.getState().assemblyGuide;
    if (!guide) {
      flash('✗ Generate the assembly guide first');
      return;
    }
    
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${projectMetadata.name} — Soldering Checklist</title>
<style>
@page { size: A4 portrait; margin: 15mm; }
body { font-family: -apple-system, sans-serif; font-size: 10pt; }
h1 { font-size: 16pt; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.5pt solid #888; padding: 3pt 5pt; text-align: left; font-size: 9pt; }
.check { width: 14pt; height: 14pt; border: 1pt solid #333; }
</style></head><body>
<h1>${projectMetadata.name} — Soldering Checklist</h1>
<p>Board: ${boardConfig.name} · ${boardConfig.dimensions.rows}×${boardConfig.dimensions.cols} holes</p>
<table>
<thead><tr><th style="width:8%">✓</th><th style="width:8%">Step</th><th>Operation</th><th style="width:22%">Coordinates</th></tr></thead>
<tbody>
${guide.steps.map(step => `<tr><td><div class="check"></div></td><td>${step.order + 1}</td><td>${escapeHtml(step.description)}</td><td>${step.coordinates.map(coordToLabel).join(' ')}</td></tr>`).join('')}
</tbody></table>
</body></html>`;
    
    printHTML(html, `${projectMetadata.name} — Checklist`);
  };
  
  return (
    <div className="flex flex-col gap-3">
      {message && (
        <div className="px-2 py-1.5 rounded text-xs" style={{ backgroundColor: 'var(--selected-bg)' }}>
          {message}
        </div>
      )}
      
      <Panel title="Diagrams">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => exportSVG('component')}>SVG: Top</Button>
          <Button size="sm" onClick={() => exportSVG('solder')}>SVG: Solder</Button>
          <Button size="sm" onClick={() => exportPNG('component')} disabled={exporting !== null}>
            {exporting === 'png-component' ? '...' : 'PNG: Top'}
          </Button>
          <Button size="sm" onClick={() => exportPNG('solder')} disabled={exporting !== null}>
            {exporting === 'png-solder' ? '...' : 'PNG: Solder'}
          </Button>
        </div>
      </Panel>
      
      <Panel title="Lists (CSV)">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => {
            if (!requireLayout()) return;
            downloadTextFile(exportBOMCSV(components), `${baseName}-bom.csv`, 'text/csv');
            flash('✓ Exported BOM');
          }}>BOM</Button>
          <Button size="sm" onClick={() => {
            if (!requireLayout()) return;
            downloadTextFile(exportNetlistCSV(nets, components), `${baseName}-netlist.csv`, 'text/csv');
            flash('✓ Exported netlist');
          }}>Netlist</Button>
          <Button size="sm" onClick={() => {
            downloadTextFile(
              exportCoordinateListCSV(board, components, routes, nets),
              `${baseName}-coordinates.csv`, 'text/csv'
            );
            flash('✓ Exported pad & connection list');
          }}>Pad List</Button>
          <Button size="sm" onClick={() => {
            if (!requireLayout()) return;
            downloadTextFile(
              exportJumperListCSV(routes, nets, boardConfig.dimensions.holePitchMm),
              `${baseName}-jumpers.csv`, 'text/csv'
            );
            flash('✓ Exported jumper cutting list');
          }}>Jumpers</Button>
          {boardConfig.type === 'stripboard' && (
            <Button size="sm" onClick={() => {
              downloadTextFile(
                exportTrackCutListCSV(board, nets),
                `${baseName}-track-cuts.csv`, 'text/csv'
              );
              flash('✓ Exported track cut list');
            }} className="col-span-2">Track Cut List</Button>
          )}
        </div>
      </Panel>
      
      <Panel title="Assembly Guide">
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="sm" onClick={exportPrintableGuide}>
            🖨 Export PDF Guide (Print)
          </Button>
          <Button size="sm" onClick={exportChecklistPrint}>
            🖨 Printable Checklist
          </Button>
          <p className="text-[10px] text-muted">
            Uses your browser's print dialog — choose "Save as PDF" as the printer.
            Includes board diagrams, BOM, and all assembly steps on A4.
          </p>
        </div>
      </Panel>
      
      <Panel title="Project File">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={exportProjectJSON}>Export JSON</Button>
          <label className="rounded font-medium px-3 py-1.5 text-sm border border-app bg-panel text-app hover-bg cursor-pointer text-center">
            Import JSON
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importProjectJSON(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </Panel>
      
      <Panel title="Browser Storage" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={saveToIndexedDB}>💾 Save</Button>
          <Button size="sm" onClick={loadFromIndexedDB}>📂 Load</Button>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[10px]" data-testid="save-status">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${saveStatus === 'saving' ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor:
                saveStatus === 'saving' ? 'var(--accent)'
                : saveStatus === 'saved' ? 'var(--text-muted)'
                : saveStatus === 'error' ? 'var(--danger)'
                : 'var(--border)',
            }}
          />
          <span
            className="truncate"
            title={saveError || undefined}
            style={{ color: saveStatus === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}
          >
            {saveStatusLabel(saveStatus, saveStatusAt, saveError)}
          </span>
        </div>
        <p className="text-[10px] text-muted mt-1">
          Changes save themselves to this browser (IndexedDB) and come back
          after a refresh. No account required.
        </p>
      </Panel>
      
      <Panel title="Danger Zone" defaultOpen={false}>
        <Button
          size="sm"
          variant="danger"
          className="w-full"
          onClick={() => {
            if (confirm('Reset the entire project? This cannot be undone.')) {
              resetProject();
            }
          }}
        >
          Reset Project
        </Button>
      </Panel>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
