/**
 * Placement panel - optimization controls
 */

import React from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button, Select, Badge } from './ui';
import { PlacementMode, OptimizationIntensity, PlacementWeights } from '../placement/types';

export function PlacementPanel() {
  const placementConfig = useAppStore(s => s.placementConfig);
  const setPlacementConfig = useAppStore(s => s.setPlacementConfig);
  const setPlacementMode = useAppStore(s => s.setPlacementMode);
  const setOptimizationIntensity = useAppStore(s => s.setOptimizationIntensity);
  const runPlacement = useAppStore(s => s.runPlacement);
  const isOptimizing = useAppStore(s => s.isOptimizing);
  const placementResult = useAppStore(s => s.placementResult);
  const placementProposal = useAppStore(s => s.placementProposal);
  const acceptPlacementProposal = useAppStore(s => s.acceptPlacementProposal);
  const rejectPlacementProposal = useAppStore(s => s.rejectPlacementProposal);
  const placedComponents = useAppStore(s => s.placedComponents);
  const circuit = useAppStore(s => s.circuit);
  const lockedCount = placedComponents.filter(c => c.locked).length;
  
  const updateWeight = (key: keyof typeof placementConfig.weights, value: number) => {
    setPlacementConfig({
      weights: { ...placementConfig.weights, [key]: value },
    });
  };
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Auto-Placement">
        <div className="flex flex-col gap-2">
          <Select
            label="Optimization mode"
            value={placementConfig.mode}
            onChange={(v) => setPlacementMode(v as PlacementMode)}
            options={[
              { value: 'min-wire', label: 'Minimum wire length' },
              { value: 'max-neatness', label: 'Maximum neatness' },
              { value: 'balanced', label: 'Balanced (recommended)' },
            ]}
          />
          
          <Select
            label="Optimization intensity"
            value={placementConfig.intensity}
            onChange={(v) => setOptimizationIntensity(v as OptimizationIntensity)}
            options={[
              { value: 'fast', label: 'Fast (fewer candidates)' },
              { value: 'standard', label: 'Standard' },
              { value: 'thorough', label: 'Thorough (slower)' },
            ]}
          />
          
          <Button
            variant="primary"
            onClick={() => runPlacement()}
            disabled={isOptimizing || circuit.components.length === 0}
            className="w-full"
          >
            {isOptimizing ? 'Optimizing...' : '▶ Run Auto-Placement'}
          </Button>
          
          {lockedCount > 0 && (
            <p className="text-[10px] text-muted">
              {lockedCount} locked component(s) will keep their positions.
            </p>
          )}
        </div>
      </Panel>

      {placementProposal && (
        <Panel title="Review placement changes">
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-muted">These positions will change only if you apply this proposal. Locked components stay fixed.</p>
            <div className="max-h-40 overflow-auto flex flex-col gap-1">
              {placementProposal.placedComponents.filter(component => {
                const original = placedComponents.find(current => current.id === component.id);
                return !original || original.position.row !== component.position.row || original.position.col !== component.position.col || original.orientation !== component.orientation;
              }).map(component => {
                const original = placedComponents.find(current => current.id === component.id);
                const position = `row ${component.position.row + 1}, col ${component.position.col + 1}`;
                return (
                  <div key={component.id} className="rounded border border-app px-2 py-1">
                    <strong>{component.reference}</strong>{' '}
                    {original ? `(${original.position.row + 1}, ${original.position.col + 1}) → ` : 'unplaced → '}
                    {position}{component.orientation !== original?.orientation ? `, ${component.orientation}°` : ''}
                  </div>
                );
              })}
            </div>
            {!placementProposal.success && <p className="text-amber-600">This proposal leaves {placementProposal.unplacedComponents.length} component(s) unplaced.</p>}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={acceptPlacementProposal}>Apply proposal</Button>
              <Button className="flex-1" onClick={rejectPlacementProposal}>Reject</Button>
            </div>
          </div>
        </Panel>
      )}
      
      <Panel title="Optimization Weights" defaultOpen={false}>
        <WeightsEditor weights={placementConfig.weights} onChange={updateWeight} />
      </Panel>
      
      {placementResult && (
        <Panel title="Last Placement Result">
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Status</span>
              <Badge variant={placementResult.success ? 'success' : 'error'}>
                {placementResult.success ? 'Success' : 'Incomplete'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Placed</span>
              <span>{placementResult.placedComponents.length} / {placementResult.placedComponents.length + placementResult.unplacedComponents.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Iterations</span>
              <span>{placementResult.iterations}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Time</span>
              <span>{placementResult.timeMs}ms</span>
            </div>
            
            {placementResult.errors.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {placementResult.errors.map((err, i) => (
                  <div key={i} className="text-[10px] px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function WeightsEditor({
  weights,
  onChange,
}: {
  weights: PlacementWeights;
  onChange: (key: keyof PlacementWeights, value: number) => void;
}) {
  const labels: Record<keyof PlacementWeights, string> = {
    wireLength: 'Wire length',
    bends: 'Fewer bends',
    crossings: 'Fewer crossings',
    footprintSpacing: 'Component spacing',
    edgeClearance: 'Edge clearance',
    componentGrouping: 'Component grouping',
    alignment: 'Grid alignment',
  };
  
  return (
    <div className="flex flex-col gap-2">
      {(Object.entries(weights) as [keyof PlacementWeights, number][]).map(([key, value]) => (
        <label key={key} className="flex items-center gap-2">
          <span className="text-[10px] text-muted w-28 shrink-0">{labels[key] || key}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={value}
            onChange={(e) => onChange(key, parseFloat(e.target.value))}
            className="flex-1"
          />
          <span className="text-[10px] font-mono w-8 text-right">{value.toFixed(1)}</span>
        </label>
      ))}
    </div>
  );
}
