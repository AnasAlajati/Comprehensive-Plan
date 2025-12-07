
import React, { useState, useEffect } from 'react';
import { MachineRow, MachineStatus } from '../types';
import { DataService } from '../services/dataService';

export const MaintenanceDashboard: React.FC = () => {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const fetchMachines = async () => {
      try {
        setLoading(true);
        const data = await DataService.getMachinesFromMachineSS();
        const mappedMachines: MachineRow[] = data.map((m: any) => ({
          id: m.id,
          machineName: m.name,
          brand: m.brand,
          type: m.type,
          status: m.status,
          dayProduction: m.lastLogData?.dayProduction || 0,
          remainingMfg: m.lastLogData?.remainingMfg || 0,
          futurePlans: m.futurePlans,
          material: m.lastLogData?.fabric || '',
          client: m.lastLogData?.client || '',
          avgProduction: m.avgProduction,
          scrap: m.lastLogData?.scrap || 0,
          reason: m.lastLogData?.reason || '',
          customStatusNote: m.lastLogData?.status === 'Other' ? m.lastLogData?.customStatusNote : '',
          orderIndex: m.orderIndex
        }));
        setMachines(mappedMachines);
      } catch (error) {
        console.error("Error fetching machines for maintenance dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMachines();
  }, []);

  // 1. Get Machines currently in "Qalb" (Changeover) or "Under Operation"
  const activeChangeovers = machines.filter(m => m.status === MachineStatus.QALB);
  const underOperation = machines.filter(m => m.status === MachineStatus.UNDER_OP);

  // 2. Get Future Scheduled Changeovers with Context (From -> To)
  const scheduledChangeovers = machines.flatMap(machine => {
    const plans = machine.futurePlans || [];
    
    return plans.map((plan, index) => {
      if (plan.type !== 'SETTINGS') return null;

      // Determine "From" Context
      let fromContext = { fabric: 'Unknown', order: 'Unknown' };
      if (index === 0) {
        // First plan, so "From" is the current machine status
        fromContext = { 
          fabric: machine.material || 'Idle', 
          order: machine.client || '-' 
        };
      } else {
        // "From" is the previous plan
        const prev = plans[index - 1];
        fromContext = { 
          fabric: prev.fabric || 'Unknown', 
          order: prev.orderName || '-' 
        };
      }

      // Determine "To" Context
      let toContext = { fabric: 'End of Queue', order: '-', quantity: 0 };
      if (index < plans.length - 1) {
        const next = plans[index + 1];
        toContext = { 
          fabric: next.fabric, 
          order: next.orderName || '-',
          quantity: next.quantity
        };
      }

      return {
        ...plan,
        machineId: machine.id,
        machineName: machine.machineName,
        brand: machine.brand,
        machineType: machine.type,
        from: fromContext,
        to: toContext
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  const upcoming = scheduledChangeovers.filter(e => e.startDate >= today);

  const renderActiveCard = (machine: MachineRow, isQalb: boolean) => (
    <div key={machine.id} className={`p-4 rounded-xl border-l-4 shadow-sm flex flex-col justify-between h-full ${isQalb ? 'bg-purple-50 border-purple-500' : 'bg-amber-50 border-amber-500'}`}>
       <div>
         <div className="flex justify-between items-start mb-2">
            <h4 className="font-bold text-slate-800 text-lg">{machine.machineName}</h4>
            <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${isQalb ? 'bg-purple-200 text-purple-800' : 'bg-amber-200 text-amber-800'}`}>
                {isQalb ? 'قلب (Changeover)' : 'تحت التشغيل'}
            </span>
         </div>
         <p className="text-xs text-slate-500 font-mono mb-3">{machine.brand} • {machine.type}</p>
         
         <div className="bg-white/60 p-2 rounded text-sm text-slate-700">
            {machine.customStatusNote ? (
                <span className="italic">"{machine.customStatusNote}"</span>
            ) : (
                <span className="opacity-50">No notes provided</span>
            )}
         </div>
       </div>
       {isQalb && machine.futurePlans && machine.futurePlans[0] && (
           <div className="mt-3 pt-3 border-t border-purple-200/50">
               <span className="text-[10px] uppercase font-bold text-purple-400">Next Order:</span>
               <div className="text-xs font-semibold text-slate-700 truncate">
                   {machine.futurePlans[0].fabric || 'Unknown Fabric'}
               </div>
           </div>
       )}
    </div>
  );

  const renderScheduledCard = (event: typeof scheduledChangeovers[0], isToday: boolean) => (
    <div key={`${event.machineId}-${event.startDate}`} className={`flex flex-col sm:flex-row gap-4 p-4 rounded-lg border ${isToday ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-300' : 'bg-white border-slate-200 shadow-sm'}`}>
      
      {/* Date & Machine Info */}
      <div className="flex sm:flex-col items-center sm:w-24 gap-4 sm:gap-2 border-b sm:border-b-0 sm:border-r border-slate-100 pb-2 sm:pb-0 sm:pr-4">
        <div className={`flex flex-col items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-lg ${isToday ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}>
            <span className="text-[10px] sm:text-xs font-bold uppercase">{new Date(event.startDate || '').toLocaleString('default', { month: 'short' })}</span>
            <span className="text-lg sm:text-xl font-bold">{new Date(event.startDate || '').getDate()}</span>
        </div>
        <div className="text-left sm:text-center">
            <div className="font-bold text-slate-800 leading-tight">{event.machineName}</div>
            <div className="text-[10px] text-slate-400">{event.machineType}</div>
        </div>
      </div>
      
      {/* Transition Details */}
      <div className="flex-1 space-y-3">
        {/* From -> To Visual */}
        <div className="flex items-center gap-2 text-sm">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded p-2 relative group">
                <span className="text-[9px] uppercase font-bold text-slate-400 absolute -top-2 left-2 bg-white px-1">From</span>
                <div className="font-semibold text-slate-700 truncate" title={event.from.fabric}>{event.from.fabric}</div>
                <div className="text-xs text-slate-500">Order: {event.from.order}</div>
            </div>
            
            <div className="text-slate-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </div>

            <div className="flex-1 bg-indigo-50 border border-indigo-100 rounded p-2 relative group">
                <span className="text-[9px] uppercase font-bold text-indigo-400 absolute -top-2 left-2 bg-white px-1">To</span>
                <div className="font-semibold text-indigo-900 truncate" title={event.to.fabric}>{event.to.fabric}</div>
                <div className="text-xs text-indigo-600">
                    Order: {event.to.order} {event.to.quantity > 0 && <span className="opacity-75">• {event.to.quantity}kg</span>}
                </div>
            </div>
        </div>

        <div className="flex justify-between items-center text-xs">
             <div className="bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-100 font-medium">
                ⏱ Duration: {event.days} Days
             </div>
             {event.notes && (
                 <span className="text-slate-500 italic truncate max-w-[200px]" title={event.notes}>
                     Note: "{event.notes}"
                 </span>
             )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-10">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-700 p-6 rounded-xl text-white shadow-lg">
         <h2 className="text-2xl font-bold flex items-center gap-2">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Changeover & Setup Dashboard (جدول القلب)
         </h2>
         <p className="opacity-90">Monitor active machine transitions and upcoming schedule changes.</p>
      </div>

      {/* SECTION 1: ACTIVE NOW */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
            <span className="w-2 h-6 bg-purple-500 rounded-full"></span>
            Active Now (الحالي)
        </h3>
        
        {activeChangeovers.length === 0 && underOperation.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 p-6 rounded-lg text-center text-slate-400">
                No machines are currently in Changeover (قلب) or Under Operation.
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeChangeovers.map(m => renderActiveCard(m, true))}
                {underOperation.map(m => renderActiveCard(m, false))}
            </div>
        )}
      </div>

      {/* SECTION 2: SCHEDULED */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
         <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
            <span className="w-2 h-6 bg-indigo-500 rounded-full"></span>
            Scheduled Changeovers (المجدول)
         </h3>

         {upcoming.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border border-dashed border-slate-300">
                <p className="text-slate-400">No future changeovers scheduled.</p>
            </div>
         ) : (
            <div className="space-y-4">
                {upcoming.map(event => renderScheduledCard(event, event.startDate === today))}
            </div>
         )}
      </div>

    </div>
  );
};
