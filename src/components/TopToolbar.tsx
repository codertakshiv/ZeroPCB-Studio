/** Compact application toolbar. */

import React, { useState } from 'react';
import { Check, ChevronDown, Download, LockKeyhole, Menu, Moon, Redo2, Route, Save, Sun, Undo2, WandSparkles } from 'lucide-react';
import type { WorkspaceStage } from '../app/stages';
import { useAppStore } from '../app/store';
import { saveStatusLabel } from '../storage/autosave';
import { Button } from './ui';

type Props = {
  onRunPlacement: () => void;
  onRunRouting: () => void;
  onCheck: () => void;
  onOpenStage: (stage: WorkspaceStage) => void;
  onToggleInputs: () => void;
  onToggleInspector: () => void;
};

export function TopToolbar({ onRunPlacement, onRunRouting, onCheck, onOpenStage, onToggleInputs, onToggleInspector }: Props) {
  const projectMetadata = useAppStore(s => s.projectMetadata);
  const setProjectMetadata = useAppStore(s => s.setProjectMetadata);
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const canUndo = useAppStore(s => s.history.length > 0);
  const canRedo = useAppStore(s => s.future.length > 0);
  const isDirty = useAppStore(s => s.isDirty);
  const saveStatus = useAppStore(s => s.saveStatus);
  const saveStatusAt = useAppStore(s => s.saveStatusAt);
  const saveError = useAppStore(s => s.saveError);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(projectMetadata.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const commitName = () => { setProjectMetadata({ name: nameValue.trim() || 'Untitled Project' }); setEditingName(false); };

  return (
    <header className="app-toolbar flex items-center gap-2 px-3 py-1.5 border-b border-app bg-panel">
      <button className="mobile-toolbar-button" onClick={onToggleInputs} title="Components" aria-label="Open components"><Menu size={17} /></button>
      <div className="flex items-center gap-2 shrink-0">
        <img src="/favicon.svg" alt="ZeroPCB Studio" className="w-6 h-6" />
        <span className="font-semibold text-sm hidden sm:inline">ZeroPCB Studio</span>
      </div>
      <span className="toolbar-divider" />
      {editingName ? <input aria-label="Project name" autoFocus value={nameValue} onChange={e => setNameValue(e.target.value)}
        onBlur={commitName} onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
        className="w-36 min-w-0 bg-app border border-app rounded px-2 py-1 text-xs" /> :
        <button className="max-w-40 truncate px-1 py-1 text-xs hover-bg rounded" title="Rename project" onClick={() => { setNameValue(projectMetadata.name); setEditingName(true); }}>
          {projectMetadata.name}{isDirty && <span className="ml-1 text-amber-400">•</span>}
        </button>}
      <div className="flex gap-1">
        <Button size="sm" className="toolbar-icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={15} /></Button>
        <Button size="sm" className="toolbar-icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></Button>
      </div>
      <div className="flex-1" />
      <div className="autosave-status" data-testid="autosave-indicator" title={saveError || 'Saved automatically in this browser'}>
        <span className={`save-dot ${saveStatus === 'saving' ? 'saving' : ''}`} data-state={saveStatus} />
        <span className="hidden sm:inline">{saveStatusLabel(saveStatus, saveStatusAt, saveError)}</span>
      </div>
      <Button size="sm" variant="primary" className="toolbar-action" onClick={onRunPlacement} title="Arrange components; review any proposed moves"><WandSparkles size={14} /><span>Auto-arrange</span></Button>
      <Button size="sm" onClick={onRunRouting} title="Route connected nets"><Route size={14} /><span className="toolbar-label">Route</span></Button>
      <Button size="sm" onClick={onCheck} title="Validate the board"><Check size={14} /><span className="toolbar-label">Check</span></Button>
      <div className="toolbar-menu-wrap">
        <Button size="sm" onClick={() => setMenuOpen(!menuOpen)} title="Project tools"><ChevronDown size={15} /><span className="toolbar-label">More</span></Button>
        {menuOpen && <>
          <button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="toolbar-menu">
            <button onClick={() => { onOpenStage('export'); setMenuOpen(false); }}><Save size={14} />Project save, load & export</button>
            <button onClick={() => { onOpenStage('assembly'); setMenuOpen(false); }}><Download size={14} />Assembly guide</button>
            <button onClick={() => { toggleTheme(); setMenuOpen(false); }}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}Switch theme</button>
          </div>
        </>}
      </div>
      <button className="mobile-toolbar-button" onClick={onToggleInspector} title="Inspector" aria-label="Open inspector"><LockKeyhole size={16} /></button>
    </header>
  );
}
