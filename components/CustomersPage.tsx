import React, { useMemo, useState } from 'react';
import { MachineRow, PlanItem } from '../types';
import { recalculateSchedule, addDays } from '../services/data';

interface CustomersPageProps {
  machines: MachineRow[];
}

interface ClientWork {
  clientName: string;
  activeMachines: {
    machine: MachineRow;
    currentOrder: {
      fabric: string;
      remaining: number;
      dayProduction: number;
      status: string;
    };
  }[];
  scheduledPlans: {
    machineName: string;
    plan: PlanItem;
  }[];
  finishedOrders: {
    fabric: string;
    machineName: string;
    endDate: string;
    client: string;
    quantity: number;
  }[];
  totalRemaining: number;
  totalDailyProduction: number;
  totalScheduledQuantity: number;
  totalFinishedQuantity: number;
}

export const CustomersPage: React.FC<CustomersPageProps> = ({ machines }) => {
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const today = new Date().toISOString().split('T')[0];

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refresh delay to give user feedback
    setTimeout(() => {
        setRefreshKey(prev => prev + 1);
        setIsRefreshing(false);
    }, 800);
  };

  const { clientData, grandTotalRemaining, grandTotalProduction, activeOrdersCount, grandTotalScheduled, grandTotalFinished } = useMemo(() => {
    const data: Record<string, ClientWork> = {};
    let gTotalRemaining = 0;
    let gTotalProduction = 0;
    let gActiveOrders = 0;
    let gTotalScheduled = 0;
    let gTotalFinished = 0;

    // Helper to ensure client bucket exists
    const ensureClientBucket = (clientName: string) => {
        if (!data[clientName]) {
            data[clientName] = {
                clientName: clientName,
                activeMachines: [],
                scheduledPlans: [],
                finishedOrders: [],
                totalRemaining: 0,
                totalDailyProduction: 0,
                totalScheduledQuantity: 0,
                totalFinishedQuantity: 0
            };
        }
    };

    // 1. Process Active Machines & History
    machines.forEach(machine => {
      const client = (machine.client && machine.client !== '-') ? machine.client : 'Unknown';
      
      // --- Active Machines Logic ---
      // Only add to Active if remaining > 0. If 0, it goes to Finished.
      if ((machine.remainingMfg || 0) > 0) {
          ensureClientBucket(client);
          data[client].activeMachines.push({
            machine,
            currentOrder: {
              fabric: machine.material,
              remaining: machine.remainingMfg,
              dayProduction: machine.dayProduction,
              status: machine.status
            }
          });

          data[client].totalRemaining += (machine.remainingMfg || 0);
          data[client].totalDailyProduction += (machine.dayProduction || 0);
          
          gTotalRemaining += (machine.remainingMfg || 0);
          gTotalProduction += (machine.dayProduction || 0);
          gActiveOrders++;
      }

      // --- Finished Orders Logic (History + Current 0) ---
      const logs = machine.dailyLogs || [];
      // Sort by date ascending to trace runs
      const sortedLogs = [...logs].sort((a: any, b: any) => a.date.localeCompare(b.date));
      
      let currentRun: { client: string; fabric: string; lastRemaining: number; date: string; totalProduced: number } | null = null;

      sortedLogs.forEach((log: any) => {
          // Check if run changed (Client or Fabric changed)
          if (!currentRun || currentRun.client !== log.client || currentRun.fabric !== log.fabric) {
              // Previous run ended. Check if it finished (remaining <= 0)
              if (currentRun && (Number(currentRun.lastRemaining) || 0) <= 0) {
                   const runClient = currentRun.client || 'Unknown';
                   ensureClientBucket(runClient);
                   // Avoid duplicates if possible (simple check: same machine, same fabric, same date)
                   const exists = data[runClient].finishedOrders.some(o => 
                       o.machineName === machine.machineName && 
                       o.fabric === currentRun!.fabric && 
                       o.endDate === currentRun!.date
                   );
                   if (!exists) {
                       data[runClient].finishedOrders.push({
                           fabric: currentRun.fabric,
                           machineName: machine.machineName,
                           endDate: currentRun.date,
                           client: runClient,
                           quantity: currentRun.totalProduced
                       });
                       data[runClient].totalFinishedQuantity += currentRun.totalProduced;
                       gTotalFinished += currentRun.totalProduced;
                   }
              }
              // Start new run
              currentRun = {
                  client: log.client,
                  fabric: log.fabric,
                  lastRemaining: log.remainingMfg,
                  date: log.date,
                  totalProduced: Number(log.dayProduction) || 0
              };
          } else {
              // Continue run
              currentRun.lastRemaining = log.remainingMfg;
              currentRun.date = log.date;
              currentRun.totalProduced += (Number(log.dayProduction) || 0);
          }
      });

      // Check the final run (which might be the current active state)
      // If the machine is currently active with 0 remaining, it falls here.
      if (currentRun && (Number(currentRun.lastRemaining) || 0) <= 0) {
           const runClient = currentRun.client || 'Unknown';
           ensureClientBucket(runClient);
           const exists = data[runClient].finishedOrders.some(o => 
               o.machineName === machine.machineName && 
               o.fabric === currentRun!.fabric && 
               o.endDate === currentRun!.date
           );
           if (!exists) {
               data[runClient].finishedOrders.push({
                   fabric: currentRun.fabric,
                   machineName: machine.machineName,
                   endDate: currentRun.date,
                   client: runClient,
                   quantity: currentRun.totalProduced
               });
               data[runClient].totalFinishedQuantity += currentRun.totalProduced;
               gTotalFinished += currentRun.totalProduced;
           }
      }

      // 2. Process Future Plans
      // "Order" in Schedule == "Client"
      const calculatedPlans = recalculateSchedule(machine.futurePlans || [], machine);
      
      calculatedPlans.forEach(plan => {
          if (plan.type === 'SETTINGS') return;

          // If plan has an orderName, that IS the client. 
          // If not, it defaults to the machine's current client (or Unknown if that's missing too)
          let targetClient = plan.client || plan.orderName || client;
          
          // Clean up target client name
          if (!targetClient || targetClient === '-') targetClient = 'Unknown';

          ensureClientBucket(targetClient);

          data[targetClient].scheduledPlans.push({
              machineName: machine.machineName,
              plan: plan
          });
          
          data[targetClient].totalScheduledQuantity += (plan.quantity || 0);
          gTotalScheduled += (plan.quantity || 0);
      });
    });

    // Filter out empty Unknown if it has no data
    if (data['Unknown'] && 
        data['Unknown'].activeMachines.length === 0 && 
        data['Unknown'].scheduledPlans.length === 0) {
        delete data['Unknown'];
    }

    return {
        clientData: Object.values(data).sort((a, b) => a.clientName.localeCompare(b.clientName)),
        grandTotalRemaining: gTotalRemaining,
        grandTotalProduction: gTotalProduction,
        activeOrdersCount: gActiveOrders,
        grandTotalScheduled: gTotalScheduled,
        grandTotalFinished: gTotalFinished
    };
  }, [machines, refreshKey]);

  return (
    <div className="p-4 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Customers Overview</h2>
            <div className="text-sm text-slate-500">
                Showing active work and schedules for {machines.length} machines
            </div>
        </div>
        
        <div className="flex gap-4 flex-wrap">
            <button 
                onClick={handleRefresh}
                className={`px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 font-medium hover:text-blue-600 hover:border-blue-300 transition-all flex items-center gap-2 ${isRefreshing ? 'ring-2 ring-blue-100' : ''}`}
            >
                <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Active Orders</div>
                <div className="text-xl font-bold text-blue-600">{activeOrdersCount}</div>
            </div>
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Remaining</div>
                <div className="text-xl font-bold text-slate-800">{grandTotalRemaining.toLocaleString()} <span className="text-sm text-slate-400 font-normal">kg</span></div>
            </div>
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Scheduled</div>
                <div className="text-xl font-bold text-purple-600">{grandTotalScheduled.toLocaleString()} <span className="text-sm text-slate-400 font-normal">kg</span></div>
            </div>
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Pending</div>
                <div className="text-xl font-bold text-orange-600">{(grandTotalRemaining + grandTotalScheduled).toLocaleString()} <span className="text-sm text-slate-400 font-normal">kg</span></div>
            </div>
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Finished</div>
                <div className="text-xl font-bold text-emerald-600">{grandTotalFinished.toLocaleString()} <span className="text-sm text-slate-400 font-normal">kg</span></div>
            </div>
        </div>
      </div>

      {clientData.map(client => (
        <div key={client.clientName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md">
            {/* Header */}
            <div 
              className="p-4 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => setExpandedClient(expandedClient === client.clientName ? null : client.clientName)}
            >
                <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm
                        ${client.clientName === 'Unknown' ? 'bg-slate-400' : 'bg-blue-600'}`}>
                        {client.clientName.substring(0, 2).toUpperCase()}
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">{client.clientName}</h3>
                    <span className="px-2 py-1 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-full">
                        {client.activeMachines.length} Active
                    </span>
                    {client.scheduledPlans.length > 0 && (
                        <span className="px-2 py-1 bg-purple-50 border border-purple-200 text-purple-600 text-xs font-bold rounded-full">
                            {client.scheduledPlans.length} Scheduled
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-6 text-sm ml-auto">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Active Rem.</span>
                        <span className="font-bold text-slate-700">{client.totalRemaining.toLocaleString()} kg</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Scheduled</span>
                        <span className="font-bold text-purple-600">{client.totalScheduledQuantity.toLocaleString()} kg</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Pending</span>
                        <span className="font-bold text-orange-600">{(client.totalRemaining + client.totalScheduledQuantity).toLocaleString()} kg</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Finished</span>
                        <span className="font-bold text-emerald-600">{client.totalFinishedQuantity.toLocaleString()} kg</span>
                    </div>
                    <div className={`p-2 rounded-full bg-slate-200 text-slate-600 transform transition-transform duration-200 ${expandedClient === client.clientName ? 'rotate-180' : ''}`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Content */}
            {expandedClient === client.clientName && (
                <div className="p-6 animate-fadeIn space-y-8">
                    
                    {/* Active Production Section */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            Active Production
                        </h4>
                        {client.activeMachines.length > 0 ? (
                            <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3 w-1/6">Fabric</th>
                                            <th className="px-4 py-3 w-1/6">Machine</th>
                                            <th className="px-4 py-3 w-1/6">Status</th>
                                            <th className="px-4 py-3 text-right">Remaining</th>
                                            <th className="px-4 py-3 text-right">Daily Prod</th>
                                            <th className="px-4 py-3 text-center">Start</th>
                                            <th className="px-4 py-3 text-center">End (Est.)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {client.activeMachines.map((item) => {
                                            const dailyRate = item.currentOrder.dayProduction > 0 ? item.currentOrder.dayProduction : (item.machine.avgProduction || 1);
                                            const daysLeft = item.currentOrder.remaining > 0 ? Math.ceil(item.currentOrder.remaining / dailyRate) : 0;
                                            const endDate = daysLeft > 0 ? addDays(today, daysLeft) : '-';

                                            return (
                                            <tr key={item.machine.id} className="hover:bg-slate-50/50">
                                                <td className="px-4 py-3 font-medium text-slate-800">{item.currentOrder.fabric}</td>
                                                <td className="px-4 py-3 text-slate-600">{item.machine.machineName}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                                                        ${item.currentOrder.status === 'Working' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>
                                                        {item.currentOrder.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{item.currentOrder.remaining.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">{item.currentOrder.dayProduction}</td>
                                                <td className="px-4 py-3 text-center text-xs text-emerald-600 font-bold">Active</td>
                                                <td className="px-4 py-3 text-center text-xs font-mono text-slate-500">{endDate}</td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400 italic pl-4">No active machines.</div>
                        )}
                    </div>

                    {/* Finished Orders Section */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                            Finished Orders (History)
                        </h4>
                        {client.finishedOrders.length > 0 ? (
                            <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3 w-1/5">Fabric</th>
                                            <th className="px-4 py-3 w-1/5">Machine</th>
                                            <th className="px-4 py-3 w-1/5 text-right">Quantity</th>
                                            <th className="px-4 py-3 w-1/5 text-center">Finished Date</th>
                                            <th className="px-4 py-3 w-1/5 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {client.finishedOrders.sort((a,b) => b.endDate.localeCompare(a.endDate)).map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/30">
                                                <td className="px-4 py-3 font-medium text-slate-600 line-through decoration-slate-400">{item.fabric}</td>
                                                <td className="px-4 py-3 text-slate-500">{item.machineName}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">{item.quantity.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-center font-mono text-slate-500">{item.endDate}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600">
                                                        ✓ DONE
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400 italic pl-4">No finished orders found.</div>
                        )}
                    </div>

                    {/* Scheduled Orders Section */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                            Scheduled Orders (Future)
                        </h4>
                        {client.scheduledPlans.length > 0 ? (
                            <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3 w-1/6">Fabric</th>
                                            <th className="px-4 py-3 w-1/6">Machine</th>
                                            <th className="px-4 py-3 w-1/6">Client (Order)</th>
                                            <th className="px-4 py-3 text-right">Quantity</th>
                                            <th className="px-4 py-3 text-right">Daily Prod</th>
                                            <th className="px-4 py-3 text-center">Start</th>
                                            <th className="px-4 py-3 text-center">End</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {client.scheduledPlans.sort((a,b) => (a.plan.startDate || '').localeCompare(b.plan.startDate || '')).map((item, idx) => (
                                            <tr key={idx} className="hover:bg-purple-50/30">
                                                <td className="px-4 py-3 font-medium text-slate-800">{item.plan.fabric}</td>
                                                <td className="px-4 py-3 text-slate-600">{item.machineName}</td>
                                                <td className="px-4 py-3 text-blue-600 font-medium">{item.plan.orderName || '-'}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{item.plan.quantity.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">{item.plan.productionPerDay}</td>
                                                <td className="px-4 py-3 text-center font-mono text-purple-700 font-bold">{item.plan.startDate}</td>
                                                <td className="px-4 py-3 text-center font-mono text-slate-500">{item.plan.endDate}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400 italic pl-4">No scheduled orders found.</div>
                        )}
                    </div>

                </div>
            )}
        </div>
      ))}
      
      {clientData.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200 border-dashed">
              <div className="text-slate-400 mb-2">No active customers found for this date</div>
              <div className="text-xs text-slate-300">Try selecting a different date or adding machine data</div>
          </div>
      )}
    </div>
  );
};

