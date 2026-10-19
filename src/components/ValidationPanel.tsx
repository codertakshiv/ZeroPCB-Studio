/**
 * Validation panel - electrical checks and issues
 */

import React from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button, Badge } from './ui';
import { ValidationIssue } from '../validation/types';
import { coordToLabel } from '../board/types';

export function ValidationPanel() {
  const validate = useAppStore(s => s.validate);
  const validationResult = useAppStore(s => s.validationResult);
  const isValidating = useAppStore(s => s.isValidating);
  const highlightCoordinates = useAppStore(s => s.highlightCoordinates);
  const clearHighlights = useAppStore(s => s.clearHighlights);
  const placedComponents = useAppStore(s => s.placedComponents);
  const circuit = useAppStore(s => s.circuit);
  
  const errorCount = validationResult?.issues.filter(i => i.severity === 'error').length || 0;
  const warningCount = validationResult?.issues.filter(i => i.severity === 'warning').length || 0;
  const infoCount = validationResult?.issues.filter(i => i.severity === 'info').length || 0;
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Electrical Validation">
        <Button
          variant="primary"
          onClick={validate}
          disabled={isValidating || placedComponents.length === 0}
          className="w-full"
        >
          {isValidating ? 'Validating...' : '✓ Validate Board'}
        </Button>
        
        <p className="text-[10px] text-muted mt-2">
          Checks connectivity graph, unconnected pins, short circuits, and routing continuity.
          Visual appearance alone is never used as proof of electrical correctness.
        </p>
        
        {placedComponents.length === 0 && (
          <p className="text-[10px] text-amber-600 mt-1">
            Place and route the circuit first.
          </p>
        )}
      </Panel>
      
      {validationResult && (
        <>
          <Panel title="Summary">
            <div className="flex items-center justify-center gap-3 py-1">
              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: errorCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {errorCount}
                </div>
                <div className="text-[10px] text-muted">Errors</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: 'var(--warning)' }}>{warningCount}</div>
                <div className="text-[10px] text-muted">Warnings</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-muted">{infoCount}</div>
                <div className="text-[10px] text-muted">Info</div>
              </div>
            </div>
            
            <div className="text-xs flex flex-col gap-0.5 mt-2">
              <div className="flex justify-between">
                <span className="text-muted">Pins connected</span>
                <span>{validationResult.stats.connectedPins} / {validationResult.stats.totalPins}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Complete nets</span>
                <span>{validationResult.stats.completeNets} / {validationResult.stats.totalNets}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Short circuits</span>
                <span className={validationResult.stats.shortCircuits > 0 ? 'text-red-500 font-bold' : ''}>
                  {validationResult.stats.shortCircuits}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Wire length</span>
                <span>{validationResult.stats.totalWireLength}</span>
              </div>
            </div>
            
            <div className="mt-2 text-center">
              <Badge variant={validationResult.isValid ? 'success' : 'error'}>
                {validationResult.isValid ? '✓ Electrically valid' : '✗ Issues found'}
              </Badge>
            </div>
          </Panel>
          
          {validationResult.issues.length > 0 && (
            <Panel title={`Issues (${validationResult.issues.length})`}>
              <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
                {validationResult.issues.map(issue => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    onHover={(coords) => {
                      if (coords.length > 0) highlightCoordinates(coords);
                    }}
                    onLeave={() => clearHighlights()}
                  />
                ))}
              </div>
            </Panel>
          )}
          
          <Panel title="Connectivity" defaultOpen={false}>
            <div className="flex flex-col gap-1 text-xs">
              {validationResult.connectivityGraph.components.map(comp => {
                const net = circuit.nets.find(n => n.id === comp.netId);
                return (
                  <div key={comp.netId} className="flex items-center justify-between">
                    <span className="truncate">{net?.name || comp.netId}</span>
                    <Badge variant={comp.isComplete ? 'success' : 'error'}>
                      {comp.isComplete ? 'connected' : `missing ${comp.missingPins.length}`}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  onHover,
  onLeave,
}: {
  issue: ValidationIssue;
  onHover: (coords: ValidationIssue['coordinates']) => void;
  onLeave: () => void;
}) {
  const colors = {
    error: { bg: 'bg-red-50 dark:bg-red-950', border: 'border-red-200 dark:border-red-900', text: 'text-red-700 dark:text-red-300' },
    warning: { bg: 'bg-amber-50 dark:bg-amber-950', border: 'border-amber-200 dark:border-amber-900', text: 'text-amber-700 dark:text-amber-300' },
    info: { bg: 'bg-blue-50 dark:bg-blue-950', border: 'border-blue-200 dark:border-blue-900', text: 'text-blue-700 dark:text-blue-300' },
  };
  
  const style = colors[issue.severity];
  
  return (
    <div
      className={`px-2 py-1.5 rounded border text-[10px] cursor-pointer ${style.bg} ${style.border}`}
      onMouseEnter={() => onHover(issue.coordinates)}
      onMouseLeave={onLeave}
    >
      <div className={`font-medium ${style.text}`}>
        {issue.type.replace(/-/g, ' ').toUpperCase()}
      </div>
      <div className="text-app mt-0.5">{issue.message}</div>
      {issue.coordinates.length > 0 && (
        <div className="text-muted mt-0.5 font-mono">
          {issue.coordinates.slice(0, 5).map(coordToLabel).join(', ')}
          {issue.coordinates.length > 5 && ` +${issue.coordinates.length - 5} more`}
        </div>
      )}
    </div>
  );
}