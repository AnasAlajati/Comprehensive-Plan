
import React, { useState, useMemo, useEffect } from 'react';
import { MachineRow, MachineStatus } from '../types';
import { DataService } from '../services/dataService';

export const IdleMachineMonitor: React.FC = () => {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Default target date: 7 days from now
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  
  const [targetDate, setTargetDate] = useState<string>(defaultDate.toISOString().split('T')[0]);

  useEffect(() => {
    const fetchMachines = async () => {
      try {
        setLoading(true);
        const data = await DataService.getMachinesFromMachineSS();
        // Map MachineSS format to MachineRow format if necessary, or ensure types are compatible
        // MachineSS has similar structure but we need to ensure compatibility
        const mappedMachines: MachineRow[] = data.map((m: any) => ({
          id: m.id,
          machineName: m.name,
          brand: m.brand,
          type: m.type,
          status: m.status,
          dayProduction: m.lastLogData?.dayProduction || 0,
          remainingMfg: m.lastLogData?.remainingMfg || 0, // Note: remainingMfg might need to be calculated or fetched from last log
          futurePlans: m.futurePlans,
          material: m.lastLogData?.fabric || '',
          client: m.lastLogData?.client || '',
          avgProduction: m.avgProduction,
          scrap: m.lastLogData?.scrap || 0,
          reason: m.lastLogData?.reason || '',
          orderIndex: m.orderIndex
        }));
        setMachines(mappedMachines);
      } catch (error) {
        console.error("Error fetching machines for idle monitor:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMachines();
  }, []);

  // Helper: Calculate exactly when a machine becomes free
  const getMachineFreeDate = (machine: MachineRow): string => {
    const today = new Date();
    let totalDaysRemaining = 0;

    // 1. Current Work
    if (machine.status === MachineStatus.WORKING && machine.dayProduction > 0) {
      totalDaysRemaining += Math.ceil(machine.remainingMfg / machine.dayProduction);
    }

    // 2. Future Plans
    if (machine.futurePlans) {
      machine.futurePlans.forEach(plan => {
        totalDaysRemaining += plan.days || 0;
      });
    }

    if (totalDaysRemaining === 0) return new Date().toISOString().split('T')[0];
    
    // Add days to today
    const freeDate = new Date(today);
    freeDate.setDate(freeDate.getDate() + totalDaysRemaining);
    return freeDate.toISOString().split('T')[0];
  };

  const forecast = useMemo(() => {
    // 1. Exclude BOUS
    const relevantMachines = machines.filter(m => m.type !== 'BOUS');

    const freeList: Array<{ machine: MachineRow, freeDate: string }> = [];
    const busyList: Array<{ machine: MachineRow, freeDate: string }> = [];

    relevantMachines.forEach(machine => {
      const freeDate = getMachineFreeDate(machine);
      
      // Compare dates string to string (YYYY-MM-DD) works for ISO format
      if (freeDate <= targetDate) {
        freeList.push({ machine, freeDate });
      } else {
        busyList.push({ machine, freeDate });
      }
    });

    const total = relevantMachines.length;
    const freePercentage = total > 0 ? (freeList.length / total) * 100 : 0;
    const busyPercentage = total > 0 ? (busyList.length / total) * 100 : 0;

    return { freeList, busyList, total, freePercentage, busyPercentage };
  }, [machines, targetDate]);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      
      {/* Header & Date Picker */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-6">
         <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <span className="text-3xl">📅</span>
                Factory Availability Forecast
            </h2>
            <p className="text-slate-500">Analyze workload and machine availability for a specific future date.</p>
         </div>

         <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200">
            <span className="text-xs font-bold uppercase text-slate-400">Target Date:</span>
            <input 
              type="date" 
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="bg-white border border-slate-300 rounded px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
            />
         </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-slate-800 rounded-xl p-6 text-white shadow-lg">
         <div className="flex justify-between items-end mb-2">
            <div>
                <h3 className="text-lg font-bold">Factory Load on {new Date(targetDate).toLocaleDateString()}</h3>
                <p className="text-slate-400 text-sm">Excluding 'BOUS' machines</p>
            </div>
            <div className="text-right">
                <span className="text-3xl font-bold text-emerald-400">{Math.round(forecast.freePercentage)}%</span>
                <span className="text-sm text-slate-400 block">will be Free</span>
            </div>
         </div>

         {/* Progress Bar */}
         <div className="w-full h-4 bg-slate-700 rounded-full overflow-hidden flex">
            <div 
                className="h-full bg-emerald-500 transition-all duration-500 flex items-center justify-center text-[9px] font-bold text-emerald-900" 
                style={{ width: `${forecast.freePercentage}%` }}
            >
                {forecast.freePercentage > 10 && 'FREE'}
            </div>
            <div 
                className="h-full bg-indigo-500 transition-all duration-500 flex items-center justify-center text-[9px] font-bold text-white" 
                style={{ width: `${forecast.busyPercentage}%` }}
            >
                {forecast.busyPercentage > 10 && 'BUSY'}
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* FREE Column */}
        <div className="space-y-4">
            <div className="flex items-center justify-between bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                <h3 className="font-bold text-emerald-900 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                    Free by {targetDate}
                </h3>
                <span className="bg-white text-emerald-700 font-bold px-2 py-1 rounded text-xs shadow-sm">
                    {forecast.freeList.length} Machines
                </span>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
                {forecast.freeList.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 italic">No machines will be free by this date.</div>
                ) : (
                    forecast.freeList.map(({ machine, freeDate }) => (
                        <div key={machine.id} className="bg-white border-l-4 border-emerald-400 p-4 rounded shadow-sm flex justify-between items-center hover:shadow-md transition-shadow">
                            <div>
                                <h4 className="font-bold text-slate-700">{machine.machineName}</h4>
                                <span className="text-xs text-slate-400">{machine.brand} • {machine.type}</span>
                            </div>
                            <div className="text-right">
                                <span className="block text-[10px] text-slate-400 uppercase">Free Since</span>
                                <span className="text-sm font-bold text-emerald-600">{freeDate}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

        {/* BUSY Column */}
        <div className="space-y-4">
            <div className="flex items-center justify-between bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                    Busy after {targetDate}
                </h3>
                <span className="bg-white text-indigo-700 font-bold px-2 py-1 rounded text-xs shadow-sm">
                    {forecast.busyList.length} Machines
                </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
                 {forecast.busyList.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 italic">No machines are busy after this date.</div>
                ) : (
                    forecast.busyList.map(({ machine, freeDate }) => (
                        <div key={machine.id} className="bg-white border-l-4 border-indigo-400 p-4 rounded shadow-sm flex justify-between items-center hover:shadow-md transition-shadow opacity-75">
                            <div>
                                <h4 className="font-bold text-slate-700">{machine.machineName}</h4>
                                <span className="text-xs text-slate-400">{machine.brand} • {machine.type}</span>
                            </div>
                            <div className="text-right">
                                <span className="block text-[10px] text-slate-400 uppercase">Busy Until</span>
                                <span className="text-sm font-bold text-indigo-600">{freeDate}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

      </div>

    </div>
  );
};
