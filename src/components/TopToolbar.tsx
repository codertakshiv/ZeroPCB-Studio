/**
 * Top toolbar - project actions, mode toggles, undo/redo
 */

import React, { useState } from 'react';
import { useAppStore } from '../app/store';
import { saveStatusLabel } from '../storage/autosave';
import { Button } from './ui';

export function TopToolbar() {
  const projectMetadata = useAppStore(s => s.projectMetadata);
  const setProjectMetadata = useAppStore(s => s.setProjectMetadata);
  const theme = useAppStore(s => s.theme);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const history = useAppStore(s => s.history);
  const future = useAppStore(s => s.future);
  const isDirty = useAppStore(s => s.isDirty);
  const saveStatus = useAppStore(s => s.saveStatus);
  const saveStatusAt = useAppStore(s => s.saveStatusAt);
  const saveError = useAppStore(s => s.saveError);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(projectMetadata.name);
  
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;
  
  const commitName = () => {
    setProjectMetadata({ name: nameValue.trim() || 'Untitled Project' });
    setEditingName(false);
  };
  
  return (
    <header className="flex items-center gap-2.5 px-4 py-2 border-b border-app bg-panel">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mr-2">
        <img
          src="/favicon.svg"
          alt="ZeroPCB Studio logo"
          className="w-7 h-7 rounded-lg shadow-sm"
        />
        <span className="font-semibold text-sm hidden sm:inline tracking-tight">ZeroPCB Studio</span>
      </div>
      
      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
      
      {/* Project name */}
      {editingName ? (
        <input
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') setEditingName(false);
          }}
          autoFocus
          className="px-2 py-0.5 text-sm rounded border border-app bg-app text-app w-48"
        />
      ) : (
        <button
          className="px-2 py-0.5 text-sm rounded hover-bg text-app"
          onClick={() => { setNameValue(projectMetadata.name); setEditingName(true); }}
          title="Click to rename project"
        >
          {projectMetadata.name}
          {isDirty && <span className="text-amber-500 ml-1" title="Unsaved changes">•</span>}
        </button>
      )}
      
      <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
      
      {/* Undo/Redo */}
      <div className="flex gap-0.5">
        <Button size="sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</Button>
        <Button size="sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</Button>
      </div>
      
      <div className="flex-1" />
      
      {/* Quick actions are in the side panels for space efficiency */}
      <div className="hidden md:flex items-center gap-2 text-[10px] text-muted">
        <kbd className="px-1 rounded border border-app">Ctrl+Z</kbd> undo
        <kbd className="px-1 rounded border border-app">Del</kbd> delete
        <kbd className="px-1 rounded border border-app">R</kbd> rotate
        <kbd className="px-1 rounded border border-app">L</kbd> lock
      </div>
      
      {/* Autosave status - the project lives in this browser, nothing else */}
      <div
        className="flex items-center gap-1.5 text-[10px] text-muted"
        data-testid="autosave-indicator"
        title={saveError || 'Saved in this browser automatically - no account, no cloud'}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${saveStatus === 'saving' ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor:
              saveStatus === 'saving' ? 'var(--accent)'
              : saveStatus === 'saved' ? 'var(--text-muted)'
              : saveStatus === 'error' ? 'var(--danger)'
              : 'var(--border)',
          }}
        />
        <span className="hidden sm:inline" style={{ color: saveStatus === 'error' ? 'var(--danger)' : undefined }}>
          {saveStatusLabel(saveStatus, saveStatusAt, saveError)}
        </span>
      </div>
      
      {/* Theme toggle */}
      <Button size="sm" onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
        {theme === 'light' ? '🌙' : '☀️'}
      </Button>
    </header>
  );
}