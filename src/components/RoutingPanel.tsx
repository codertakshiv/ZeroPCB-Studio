/**
 * Routing panel - routing controls and results
 */

import React from 'react';
import { useAppStore } from '../app/store';
import { Panel, Button, Badge, Select } from './ui';

export function RoutingPanel() {
  const routingConfig = useAppStore(s => s.routingConfig);
  const setRoutingConfig = useAppStore(s => s.setRoutingConfig);
  const runRouting = useAppStore(s => s.runRouting);
  const isOptimizing = useAppStore(s => s.isOptimizing);
  const routingResult = useAppStore(s => s.routingResult);
  const routes = useAppStore(s => s.routes);
  const lockedRouteIds = useAppStore(s => s.lockedRouteIds);
  const lockRoute = useAppStore(s => s.lockRoute);
  const placedComponents = useAppStore(s => s.placedComponents);
  const selectNet = useAppStore(s => s.selectNet);
  const circuit = useAppStore(s => s.circuit);
  const boardConfig = useAppStore(s => s.boardConfig);
  
  const totalWireMm = routes.reduce((sum, r) => sum + r.length * boardConfig.dimensions.holePitchMm, 0);
  
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Auto-Routing">
        <div className="flex flex-col gap-2">
          <Select
            label="Routing preference"
            value={routingConfig.preference}
            onChange={value => setRoutingConfig({ preference: value as typeof routingConfig.preference })}
            options={[
              { value: 'minimum-jumpers', label: 'Minimum jumpers' },
              { value: 'minimum-wire', label: 'Minimum wire length' },
              { value: 'clean', label: 'Clean routing' },
              { value: 'balanced', label: 'Balanced' },
            ]}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={routingConfig.allowSolderSide}
              onChange={(e) => setRoutingConfig({ allowSolderSide: e.target.checked })}
            />
            Route on solder side
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={routingConfig.allowComponentSide}
              onChange={(e) => setRoutingConfig({ allowComponentSide: e.target.checked })}
            />
            Route on component side
          </label>
          {boardConfig.type === 'stripboard' && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={routingConfig.allowStripRouting}
                onChange={(e) => setRoutingConfig({ allowStripRouting: e.target.checked })}
              />
              Use copper strips
            </label>
          )}
          
          <Button
            variant="primary"
            onClick={() => runRouting()}
            disabled={isOptimizing || placedComponents.length === 0}
            className="w-full"
          >
            {isOptimizing ? 'Routing...' : '▶ Route All Nets (A*)'}
          </Button>
          
          {placedComponents.length === 0 && (
            <p className="text-[10px] text-muted">
              Place components before routing.
            </p>
          )}
        </div>
      </Panel>
      
      {routingResult && (
        <Panel title="Routing Result">
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Routed nets</span>
              <Badge variant={routingResult.unroutedNets.length === 0 ? 'success' : 'warning'}>
                {routingResult.stats.routedNets} / {routingResult.stats.routedNets + routingResult.stats.unroutedNets}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Total wire</span>
              <span>{(routingResult.stats.totalWireLength * boardConfig.dimensions.holePitchMm).toFixed(0)}mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Jumpers</span>
              <span>{routingResult.stats.jumperCount} · {(routingResult.stats.jumperLength * boardConfig.dimensions.holePitchMm).toFixed(0)}mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Total bends</span>
              <span>{routingResult.stats.totalBends}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Crossings</span>
              <span>{routingResult.stats.totalCrossings}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Time</span>
              <span>{routingResult.stats.timeMs}ms</span>
            </div>
            
            {routingResult.errors.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {routingResult.errors.map((err, i) => (
                  <div key={i} className="text-[10px] px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}
      
      {routes.length > 0 && (
        <Panel title={`Routes (${routes.length})`}>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {routes.map(route => {
              const net = circuit.nets.find(n => n.id === route.netId);
              const isLocked = lockedRouteIds.has(route.id);
              
              return (
                <div
                  key={route.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded border border-app hover-bg cursor-pointer text-xs"
                  onClick={() => selectNet(route.netId)}
                >
                  <span className="flex-1 truncate font-medium">{net?.name || route.netId}</span>
                  <span className="text-[10px] text-muted">
                    {(route.length * boardConfig.dimensions.holePitchMm).toFixed(0)}mm
                  </span>
                  {route.manual && <Badge variant="info">manual</Badge>}
                  <button
                    className="text-[10px] px-1 rounded border border-app"
                    title={isLocked ? 'Unlock route' : 'Lock route (preserved on re-route)'}
                    onClick={(e) => {
                      e.stopPropagation();
                      lockRoute(route.id, !isLocked);
                    }}
                  >
                    {isLocked ? '🔒' : '🔓'}
                  </button>
                </div>
              );
            })}
          </div>
          
          <p className="text-[10px] text-muted mt-2">
            Total: {totalWireMm.toFixed(0)}mm of wire across {routes.length} route(s).
            Locked routes are preserved when re-running routing.
          </p>
        </Panel>
      )}
    </div>
  );
}
