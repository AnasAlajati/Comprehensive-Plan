import React from 'react';
import { MachineRow, MachineStatus } from '../types';
import { parseFabricName } from '../services/data';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface DailySummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machines: MachineRow[];
}

export const DailySummaryModal: React.FC<DailySummaryModalProps> = ({
  isOpen,
  onClose,
  machines
}) => {
  if (!isOpen) return null;

  // 1. Filter Finished Machines
  const finishedMachines = machines.filter(m => 
    (Number(m.remainingMfg) || 0) === 0 && 
    (Number(m.dayProduction) || 0) > 0
  );

  // 2. Filter Low Stock Machines
  // Logic from send report: status === 'Working' && remaining < 100 && remaining > 0
  const lowStockMachines = machines.filter(m => 
    m.status === MachineStatus.WORKING && 
    (Number(m.remainingMfg) || 0) < 100 && 
    (Number(m.remainingMfg) || 0) > 0
  );

  const hasNoAlerts = finishedMachines.length === 0 && lowStockMachines.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            📊 Daily Summary
          </h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {hasNoAlerts && (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <CheckCircle2 size={48} className="mx-auto mb-3 text-emerald-400 opacity-50" />
              <p className="font-medium text-lg">All Good!</p>
              <p className="text-sm opacity-75">No finished orders or low stock alerts for today.</p>
            </div>
          )}

          {/* Finished Machines Section */}
          {finishedMachines.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={16} />
                Finished Production
                <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full">
                  {finishedMachines.length}
                </span>
              </h3>
              
              <div className="grid gap-3 sm:grid-cols-2">
                {finishedMachines.map((m) => {
                  const fabricName = m.material || m.fabric || 'Unknown';
                  const { shortName } = parseFabricName(fabricName);
                  const hasPlans = m.futurePlans && m.futurePlans.length > 0;
                  const nextPlan = hasPlans ? m.futurePlans[0] : null;
                  const { shortName: nextFabric } = nextPlan ? parseFabricName(nextPlan.fabric) : { shortName: '-' };

                  return (
                    <div key={m.id} className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-gray-800">{m.machineName}</div>
                        <div className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">Finished</div>
                      </div>
                      
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Finished:</span>
                          <span className="font-medium text-gray-900" title={fabricName}>{shortName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Client:</span>
                          <span className="font-medium text-gray-900">{m.client || '-'}</span>
                        </div>
                        
                        <div className="mt-2 pt-2 border-t border-emerald-100">
                          <div className="text-xs text-gray-500 mb-1">Next Up:</div>
                          {nextPlan ? (
                            <div className="font-medium text-emerald-800">
                              {nextFabric} <span className="text-emerald-600">({nextPlan.client})</span>
                            </div>
                          ) : (
                            <div className="text-red-500 font-medium text-xs flex items-center gap-1">
                              <AlertTriangle size={12} /> No Plan Scheduled
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Low Stock Alerts Section */}
          {lowStockMachines.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-amber-600 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle size={16} />
                Low Stock Alerts
                <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full">
                  {lowStockMachines.length}
                </span>
              </h3>
              
              <div className="grid gap-3 sm:grid-cols-2">
                {lowStockMachines.map((m) => {
                  const hasPlans = m.futurePlans && m.futurePlans.length > 0;
                  const nextPlan = hasPlans ? m.futurePlans[0] : null;
                  const { shortName: nextFabric } = nextPlan ? parseFabricName(nextPlan.fabric) : { shortName: '-' };

                  return (
                    <div key={m.id} className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-gray-800">{m.machineName}</div>
                        <div className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-bold">
                          {m.remainingMfg} kg left
                        </div>
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Running:</span>
                          <span className="font-medium text-gray-900 truncate max-w-[120px]" title={m.fabric || m.material}>
                             {parseFabricName(m.fabric || m.material).shortName}
                          </span>
                        </div>

                        <div className="mt-2 pt-2 border-t border-amber-100">
                          <div className="text-xs text-gray-500 mb-1">Next Up:</div>
                          {nextPlan ? (
                            <div className="font-medium text-amber-900">
                              {nextFabric} <span className="text-amber-700">({nextPlan.client})</span>
                            </div>
                          ) : (
                            <div className="text-red-500 font-medium text-xs flex items-center gap-1">
                              <AlertTriangle size={12} /> No Plan Scheduled
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium shadow-sm transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
