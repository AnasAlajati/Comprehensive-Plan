import React, { useMemo } from 'react';
import { MachineRow, MachineStatus } from '../types';
import { BarChart3, Clock, AlertCircle, CheckCircle2, Package } from 'lucide-react';

interface OrderFulfillmentPageProps {
  machines: MachineRow[];
}

interface ClientStatus {
  clientName: string;
  activeMachines: number;
  activeRemaining: number;
  currentDailyRate: number;
  plannedBatches: number;
  plannedQuantity: number;
  fabrics: Set<string>;
}

export const OrderFulfillmentPage: React.FC<OrderFulfillmentPageProps> = ({ machines }) => {
  
  const clientData = useMemo(() => {
    const data: Record<string, ClientStatus> = {};

    const getOrCreate = (client: string) => {
      if (!client || client === '-') return null;
      if (!data[client]) {
        data[client] = {
          clientName: client,
          activeMachines: 0,
          activeRemaining: 0,
          currentDailyRate: 0,
          plannedBatches: 0,
          plannedQuantity: 0,
          fabrics: new Set()
        };
      }
      return data[client];
    };

    // Process Active Machines
    machines.forEach(machine => {
      if (machine.status === MachineStatus.WORKING && machine.client) {
        const entry = getOrCreate(machine.client);
        if (entry) {
          entry.activeMachines += 1;
          entry.activeRemaining += (machine.remainingMfg || 0);
          entry.currentDailyRate += (machine.dayProduction || 0);
          if (machine.material) entry.fabrics.add(machine.material);
        }
      }

      // Process Future Plans
      if (machine.futurePlans) {
        machine.futurePlans.forEach(plan => {
          if (plan.client) {
            const entry = getOrCreate(plan.client);
            if (entry) {
              entry.plannedBatches += 1;
              entry.plannedQuantity += (plan.quantity || 0);
              if (plan.fabric) entry.fabrics.add(plan.fabric);
            }
          }
        });
      }
    });

    return Object.values(data).sort((a, b) => b.activeRemaining - a.activeRemaining);
  }, [machines]);

  const totalActiveRemaining = clientData.reduce((acc, c) => acc + c.activeRemaining, 0);
  const totalPlannedQuantity = clientData.reduce((acc, c) => acc + c.plannedQuantity, 0);

  return (
    <div className="space-y-6 p-6 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-8 h-8 text-blue-600" />
            Order Fulfillment Tracker
          </h1>
          <p className="text-slate-500">Real-time tracking of active and planned production by client</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="text-sm text-slate-500">Total Active WIP</div>
            <div className="text-2xl font-bold text-blue-600">{totalActiveRemaining.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="text-sm text-slate-500">Total Planned</div>
            <div className="text-2xl font-bold text-purple-600">{totalPlannedQuantity.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {clientData.map((client) => {
          const totalWork = client.activeRemaining + client.plannedQuantity;
          const activePercentage = totalWork > 0 ? (client.activeRemaining / totalWork) * 100 : 0;
          const daysToFinishActive = client.currentDailyRate > 0 
            ? Math.ceil(client.activeRemaining / client.currentDailyRate) 
            : 0;

          return (
            <div key={client.clientName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{client.clientName}</h3>
                    <div className="flex gap-2 mt-2">
                      {Array.from(client.fabrics).slice(0, 3).map(fabric => (
                        <span key={fabric} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md font-medium">
                          {fabric}
                        </span>
                      ))}
                      {client.fabrics.size > 3 && (
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md font-medium">
                          +{client.fabrics.size - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-500">Total Pipeline</div>
                    <div className="text-2xl font-bold text-slate-800">{totalWork.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-blue-700 flex items-center gap-1">
                      <Clock className="w-4 h-4" /> In Progress: {client.activeRemaining.toLocaleString()} kg
                    </span>
                    <span className="font-medium text-purple-700 flex items-center gap-1">
                      <Package className="w-4 h-4" /> Planned: {client.plannedQuantity.toLocaleString()} kg
                    </span>
                  </div>
                  <div className="h-4 bg-slate-100 rounded-full overflow-hidden flex">
                    <div 
                      className="h-full bg-blue-500 relative group" 
                      style={{ width: `${activePercentage}%` }}
                    >
                        <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                    <div 
                      className="h-full bg-purple-400" 
                      style={{ width: `${100 - activePercentage}%` }}
                    ></div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Active Machines</span>
                    <span className="text-lg font-bold text-slate-700">{client.activeMachines}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Current Speed</span>
                    <span className="text-lg font-bold text-emerald-600">{client.currentDailyRate.toLocaleString()} <span className="text-xs text-slate-400">kg/day</span></span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Est. Completion (Active)</span>
                    <span className={`text-lg font-bold ${daysToFinishActive > 7 ? 'text-amber-600' : 'text-slate-700'}`}>
                      {client.activeMachines > 0 ? (
                        <>~{daysToFinishActive} days</>
                      ) : (
                        <span className="text-slate-400 text-sm">Not Running</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Future Batches</span>
                    <span className="text-lg font-bold text-purple-600">{client.plannedBatches}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {clientData.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-slate-200 border-dashed">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-600">No active or planned orders found</h3>
            <p className="text-slate-400">Add machines or plans to see fulfillment data.</p>
          </div>
        )}
      </div>
    </div>
  );
};
