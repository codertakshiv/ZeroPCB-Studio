/**
 * Board setup panel - configure board dimensions, type, and properties
 */

import React from 'react';
import { useAppStore } from '../app/store';
import { BoardType, coordToLabel } from '../board/types';
import { BOARD_APPEARANCES, getPcbPalette, BoardAppearance, DEFAULT_BOARD_APPEARANCE } from '../board/appearance';
import { Panel, Input, Select, Button } from './ui';

export function BoardSetupPanel() {
  const boardConfig = useAppStore(s => s.boardConfig);
  const setBoardConfig = useAppStore(s => s.setBoardConfig);
  const setBoardDimensions = useAppStore(s => s.setBoardDimensions);
  
  const { dimensions } = boardConfig;
  
  const applyStandardPreset = (preset: 'perfboard-5x7' | 'perfboard-7x9' | 'perfboard-10x15' | 'stripboard-4x6' | 'stripboard-10x30') => {
    switch (preset) {
      case 'perfboard-5x7':
        setBoardConfig({
          type: 'perfboard',
          name: 'Perfboard 5x7cm',
          dimensions: {
            rows: 30, cols: 20, holePitchMm: 2.54,
            widthMm: 50.8, heightMm: 76.2,
            marginTopMm: 1.27, marginBottomMm: 1.27, marginLeftMm: 1.27, marginRightMm: 1.27,
          },
        });
        break;
      case 'perfboard-7x9':
        setBoardConfig({
          type: 'perfboard',
          name: 'Perfboard 7x9cm',
          dimensions: {
            rows: 35, cols: 27, holePitchMm: 2.54,
            widthMm: 68.58, heightMm: 88.9,
            marginTopMm: 1.27, marginBottomMm: 1.27, marginLeftMm: 1.27, marginRightMm: 1.27,
          },
        });
        break;
      case 'perfboard-10x15':
        setBoardConfig({
          type: 'perfboard',
          name: 'Perfboard 10x15cm',
          dimensions: {
            rows: 58, cols: 38, holePitchMm: 2.54,
            widthMm: 96.52, heightMm: 147.32,
            marginTopMm: 1.27, marginBottomMm: 1.27, marginLeftMm: 1.27, marginRightMm: 1.27,
          },
        });
        break;
      case 'stripboard-4x6':
        setBoardConfig({
          type: 'stripboard',
          name: 'Stripboard 4x6cm',
          stripDirection: 'horizontal',
          dimensions: {
            rows: 15, cols: 24, holePitchMm: 2.54,
            widthMm: 60.96, heightMm: 38.1,
            marginTopMm: 1.27, marginBottomMm: 1.27, marginLeftMm: 1.27, marginRightMm: 1.27,
          },
        });
        break;
      case 'stripboard-10x30':
        setBoardConfig({
          type: 'stripboard',
          name: 'Stripboard 10x30 holes',
          stripDirection: 'horizontal',
          dimensions: {
            rows: 10, cols: 30, holePitchMm: 2.54,
            widthMm: 76.2, heightMm: 25.4,
            marginTopMm: 1.27, marginBottomMm: 1.27, marginLeftMm: 1.27, marginRightMm: 1.27,
          },
        });
        break;
    }
  };
  
  const updateDimension = (key: keyof typeof dimensions, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return;
    setBoardDimensions({ [key]: num });
  };
  
  // Board size = hole grid span + margins (same derivation the store applies)
  const computedWidth = (dimensions.cols - 1) * dimensions.holePitchMm + dimensions.marginLeftMm + dimensions.marginRightMm;
  const computedHeight = (dimensions.rows - 1) * dimensions.holePitchMm + dimensions.marginTopMm + dimensions.marginBottomMm;
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Standard Boards">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => applyStandardPreset('perfboard-5x7')}>Perf 5x7cm</Button>
          <Button size="sm" onClick={() => applyStandardPreset('perfboard-7x9')}>Perf 7x9cm</Button>
          <Button size="sm" onClick={() => applyStandardPreset('perfboard-10x15')}>Perf 10x15cm</Button>
          <Button size="sm" onClick={() => applyStandardPreset('stripboard-4x6')}>Strip 4x6cm</Button>
          <Button size="sm" onClick={() => applyStandardPreset('stripboard-10x30')}>Strip 10x30</Button>
        </div>
      </Panel>
      
      <Panel title="Board Type">
        <Select
          value={boardConfig.type}
          onChange={(v) => setBoardConfig({ type: v as BoardType })}
          options={[
            { value: 'perfboard', label: 'Perfboard (isolated pads)' },
            { value: 'stripboard', label: 'Stripboard (copper strips)' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {boardConfig.type === 'stripboard' && (
          <Select
            value={boardConfig.stripDirection || 'horizontal'}
            onChange={(v) => setBoardConfig({ stripDirection: v as 'horizontal' | 'vertical' })}
            options={[
              { value: 'horizontal', label: 'Horizontal strips' },
              { value: 'vertical', label: 'Vertical strips' },
            ]}
            label="Strip Direction"
            className="mt-2"
          />
        )}
      </Panel>
      
      <Panel title="Board Finish">
        <div className="flex flex-wrap gap-2">
          {BOARD_APPEARANCES.map(appearance => {
            const palette = getPcbPalette(appearance);
            const isActive = (boardConfig.appearance || DEFAULT_BOARD_APPEARANCE) === appearance;
            return (
              <button
                key={appearance}
                onClick={() => setBoardConfig({ appearance: appearance as BoardAppearance })}
                title={`${palette.label} soldermask`}
                aria-pressed={isActive}
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border transition-colors"
                style={{
                  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: isActive ? 'var(--selected-bg)' : 'transparent',
                  minWidth: 52,
                }}
              >
                <span
                  className="w-7 h-7 rounded-md relative"
                  style={{ backgroundColor: palette.maskTop, border: `1px solid ${palette.edge}` }}
                >
                  <span
                    className="absolute rounded-full"
                    style={{
                      width: 10, height: 10,
                      left: '50%', top: '50%',
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: palette.pad,
                      boxShadow: `inset 0 0 0 2px ${palette.hole}`,
                    }}
                  />
                </span>
                <span className="text-[10px]" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {palette.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted mt-2">
          Soldermask color — exported SVG/PNG and the assembly guide use the same finish.
        </p>
      </Panel>
      
      <Panel title="Dimensions">
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Rows"
            type="number"
            value={dimensions.rows}
            onChange={(v) => updateDimension('rows', v)}
            min={1}
            max={100}
          />
          <Input
            label="Columns"
            type="number"
            value={dimensions.cols}
            onChange={(v) => updateDimension('cols', v)}
            min={1}
            max={100}
          />
          <Input
            label="Hole pitch (mm)"
            type="number"
            value={dimensions.holePitchMm}
            onChange={(v) => updateDimension('holePitchMm', v)}
            min={0.5}
            max={10}
            step={0.01}
          />
        </div>
        
        <div className="text-xs text-muted mt-2">
          Physical size: {computedWidth.toFixed(1)} × {computedHeight.toFixed(1)} mm
          {' '}({dimensions.rows * dimensions.cols} holes)
        </div>
      </Panel>
      
      <Panel title="Margins (mm)" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Top" type="number" value={dimensions.marginTopMm} onChange={(v) => updateDimension('marginTopMm', v)} min={0} step={0.5} />
          <Input label="Bottom" type="number" value={dimensions.marginBottomMm} onChange={(v) => updateDimension('marginBottomMm', v)} min={0} step={0.5} />
          <Input label="Left" type="number" value={dimensions.marginLeftMm} onChange={(v) => updateDimension('marginLeftMm', v)} min={0} step={0.5} />
          <Input label="Right" type="number" value={dimensions.marginRightMm} onChange={(v) => updateDimension('marginRightMm', v)} min={0} step={0.5} />
        </div>
      </Panel>
      
      <Panel title="Mounting Holes" defaultOpen={false}>
        <div className="text-xs text-muted">
          {boardConfig.mountingHoles.length} mounting holes configured at corners.
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {boardConfig.mountingHoles.map(mh => (
            <span key={mh.id} className="text-[10px] px-1.5 py-0.5 rounded border border-app font-mono">
              {coordToLabel(mh)}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}