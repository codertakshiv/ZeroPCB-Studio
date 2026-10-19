/**
 * Assembly panel - step-by-step soldering guide
 */

import React, { useMemo } from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button, Badge } from './ui';
import { AssemblyStep } from '../soldering/types';
import { coordToLabel } from '../board/types';

export function AssemblyPanel() {
  const assemblyGuide = useAppStore(s => s.assemblyGuide);
  const assemblyProgress = useAppStore(s => s.assemblyProgress);
  const generateGuide = useAppStore(s => s.generateGuide);
  const updateAssemblyProgress = useAppStore(s => s.updateAssemblyProgress);
  const setCurrentStep = useAppStore(s => s.setCurrentStep);
  const highlightCoordinates = useAppStore(s => s.highlightCoordinates);
  const clearHighlights = useAppStore(s => s.clearHighlights);
  const placedComponents = useAppStore(s => s.placedComponents);
  const validationResult = useAppStore(s => s.validationResult);
  const routingResult = useAppStore(s => s.routingResult);
  const [groupBy, setGroupBy] = React.useState<'sequence' | 'component' | 'net' | 'side'>('sequence');
  
  const completedCount = assemblyProgress?.completedStepIds.size || 0;
  const totalCount = assemblyGuide?.steps.length || 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  
  const currentStep = useMemo(() => {
    if (!assemblyGuide || !assemblyProgress) return null;
    const idx = assemblyProgress.currentStepIndex;
    return assemblyGuide.steps[idx] || null;
  }, [assemblyGuide, assemblyProgress]);
  
  React.useEffect(() => {
    if (currentStep && currentStep.highlightedCoords.length > 0) {
      highlightCoordinates(currentStep.highlightedCoords);
    }
    return () => clearHighlights();
  }, [currentStep, highlightCoordinates, clearHighlights]);
  
  const hasErrors = validationResult && !validationResult.isValid;
  const hasUnroutedNets = (routingResult?.unroutedNets.length ?? 0) > 0;
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Assembly Guide">
        <Button
          variant="primary"
          onClick={generateGuide}
          disabled={placedComponents.length === 0}
          className="w-full"
        >
          {assemblyGuide ? '↻ Regenerate Guide' : '▶ Generate Assembly Guide'}
        </Button>
        
        {hasErrors && (
          <div className="mt-2 px-2 py-1 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            ⚠ Board has validation errors. The guide reflects the current layout,
            but fix validation issues before soldering.
          </div>
        )}

        {!validationResult && (
          <div className="mt-2 px-2 py-1 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            Run Check before soldering so board validation status is current.
          </div>
        )}

        {hasUnroutedNets && (
          <div className="mt-2 px-2 py-1 rounded text-[10px] bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
            Routing is incomplete: {routingResult?.unroutedNets.length} net(s) remain unrouted. Resolve these before soldering.
          </div>
        )}
        
        {placedComponents.length === 0 && (
          <p className="text-[10px] text-muted mt-1">
            Place components to generate a guide.
          </p>
        )}
      </Panel>
      
      {assemblyGuide && assemblyProgress && (
        <>
          <Panel title="Progress">
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
              <div
                className="h-full transition-all"
                style={{ width: `${progressPercent}%`, backgroundColor: 'var(--success)' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>{completedCount} / {totalCount} steps</span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
            <div className="text-[10px] text-muted mt-1">
              Est. time remaining: {Math.round((assemblyGuide.estimatedTotalTimeSeconds * (1 - progressPercent / 100)) / 60)} min
            </div>
            
            <div className="flex gap-1 mt-2">
              <select
                className="text-[10px] px-1 py-0.5 rounded border border-app bg-app text-app flex-1"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              >
                <option value="sequence">Group: Sequence</option>
                <option value="component">Group: Component</option>
                <option value="net">Group: Net</option>
                <option value="side">Group: Side</option>
              </select>
            </div>
          </Panel>
          
          {currentStep && (
            <Panel title="Current Step">
              <StepCard
                step={currentStep}
                isCurrent={true}
                completed={assemblyProgress.completedStepIds.has(currentStep.id)}
                onToggle={(completed) => updateAssemblyProgress(currentStep.id, completed)}
              />
              
              <div className="flex gap-1 mt-2">
                <Button
                  size="sm"
                  onClick={() => setCurrentStep(Math.max(0, assemblyProgress.currentStepIndex - 1))}
                  disabled={assemblyProgress.currentStepIndex === 0}
                  className="flex-1"
                >
                  ← Prev
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    updateAssemblyProgress(currentStep.id, true);
                    if (assemblyProgress.currentStepIndex < totalCount - 1) {
                      setCurrentStep(assemblyProgress.currentStepIndex + 1);
                    }
                  }}
                  className="flex-1"
                >
                  Done ✓
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCurrentStep(Math.min(totalCount - 1, assemblyProgress.currentStepIndex + 1))}
                  disabled={assemblyProgress.currentStepIndex >= totalCount - 1}
                  className="flex-1"
                >
                  Next →
                </Button>
              </div>
            </Panel>
          )}
          
          <Panel title="All Steps" defaultOpen={false}>
            <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
              {assemblyGuide.steps.map((step, idx) => {
                const isCompleted = assemblyProgress.completedStepIds.has(step.id);
                const isCurrent = idx === assemblyProgress.currentStepIndex;
                
                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-1.5 px-2 py-1 rounded cursor-pointer text-xs ${isCurrent ? 'selected' : 'hover-bg'}`}
                    onClick={() => {
                      setCurrentStep(idx);
                      if (step.highlightedCoords.length > 0) {
                        highlightCoordinates(step.highlightedCoords);
                      }
                    }}
                    onMouseEnter={() => {
                      if (step.highlightedCoords.length > 0) {
                        highlightCoordinates(step.highlightedCoords);
                      }
                    }}
                    onMouseLeave={() => clearHighlights()}
                  >
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateAssemblyProgress(step.id, e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className={`flex-1 ${isCompleted ? 'line-through opacity-60' : ''}`}>
                      <span className="font-mono text-[10px] text-muted mr-1">{idx + 1}.</span>
                      {step.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
          
          {completedCount === totalCount && totalCount > 0 && (
            <Panel title="Final Inspection">
              <div className="text-xs flex flex-col gap-1">
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  <span>No solder bridges between adjacent pads</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  <span>All polarized components oriented correctly</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  <span>No cold solder joints</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  <span>Continuity verified on all nets</span>
                </label>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function StepCard({
  step,
  isCurrent,
  completed,
  onToggle,
}: {
  step: AssemblyStep;
  isCurrent: boolean;
  completed: boolean;
  onToggle: (completed: boolean) => void;
}) {
  const typeIcons: Record<string, string> = {
    'place-component': '📦',
    'solder-pin': '🔥',
    'install-jumper': '🔌',
    'cut-track': '✂️',
    'add-bridge': '🌉',
    'verify-connection': '🔍',
    'inspect': '👁️',
  };
  
  return (
    <div className={`px-2 py-2 rounded border ${isCurrent ? 'border-2' : 'border-app'}`}
      style={isCurrent ? { borderColor: 'var(--accent)' } : {}}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={completed}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="text-xs font-medium">
            {typeIcons[step.type] || '•'} {step.description}
          </div>
          {step.detailedDescription && (
            <div className="text-[10px] text-muted mt-1">{step.detailedDescription}</div>
          )}
          
          <div className="flex flex-wrap gap-1 mt-1.5">
            {step.componentRef && <Badge variant="info">{step.componentRef}</Badge>}
            {step.netName && <Badge>{step.netName}</Badge>}
            {step.wireLength && <Badge variant="warning">{step.wireLength}mm wire</Badge>}
            {step.wireSide && <Badge>{step.wireSide} side</Badge>}
            {step.tools && step.tools.map(tool => (
              <Badge key={tool}>{tool}</Badge>
            ))}
          </div>
          
          {step.coordinates.length > 0 && (
            <div className="text-[10px] font-mono text-muted mt-1">
              Pads: {step.coordinates.map(coordToLabel).join(' → ')}
            </div>
          )}
          
          {step.notes && (
            <div className="text-[10px] text-amber-600 mt-1">Note: {step.notes}</div>
          )}
        </div>
      </div>
    </div>
  );
}
