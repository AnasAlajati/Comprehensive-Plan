import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { X, Calendar, Package, User, Activity, ArrowRight, PauseCircle, Clock, ChevronDown } from 'lucide-react';

interface MachineHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machineId: string;
  machineName: string;
  userRole?: 'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'factory_manager' | null;
}

interface DailyLog {
  date: string;
  client: string;
  fabric: string;
  dayProduction: number;
  status: string;
  remainingMfg?: number;
}

interface ProductionRun {
  id: string;
  startDate: string;
  endDate: string;
  client: string;
  fabric: string;
  totalProduction: number;
  daysCount: number;
  avgProduction: number;
  status: string;
  type: 'ACTIVE' | 'INACTIVE';
  logs?: DailyLog[];
}

export const MachineHistoryModal: React.FC<MachineHistoryModalProps> = ({
  isOpen,
  onClose,
  machineId,
  machineName,
  userRole,
}) => {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [expandedDebug, setExpandedDebug] = useState<string | null>(null);
  const isAdmin = userRole === 'admin';

  useEffect(() => {
    if (isOpen && machineId) {
      fetchHistory();
    }
  }, [isOpen, machineId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const logsRef = collection(db, 'MachineSS', machineId, 'dailyLogs');
      const snapshot = await getDocs(logsRef);
      
      const logs: DailyLog[] = snapshot.docs.map(doc => ({
        date: doc.id,
        ...doc.data()
      } as DailyLog));

      logs.sort((a, b) => a.date.localeCompare(b.date));

      const groupedRuns: ProductionRun[] = [];
      let currentRun: ProductionRun | null = null;

      logs.forEach((log) => {
        // Use EXACT values from the report - no trimming or normalization
        const client = log.client || 'Unknown';
        const fabric = log.fabric || 'Unknown';
        const production = Number(log.dayProduction || log.production || 0);

        // Determine if this is an inactive day (no real client/fabric data)
        const isInactiveDay = (!log.client || log.client === '' || log.client === 'Unknown') && 
                              (!log.fabric || log.fabric === '' || log.fabric === 'Unknown');
        const runType = isInactiveDay ? 'INACTIVE' : 'ACTIVE';

        if (!currentRun) {
          currentRun = {
            id: `${log.date}-${runType}`,
            startDate: log.date,
            endDate: log.date,
            client,
            fabric,
            totalProduction: production,
            daysCount: 1,
            avgProduction: production,
            status: isInactiveDay ? 'Idle' : 'Ongoing',
            type: runType,
            logs: [log]
          };
        } else {
          // Group if: same type AND (same client/fabric OR both inactive)
          const isSameType = currentRun.type === runType;
          const isSameClient = currentRun.client === client;
          const isSameFabric = currentRun.fabric === fabric;
          const shouldGroup = isSameType && (runType === 'INACTIVE' || (isSameClient && isSameFabric));

          if (shouldGroup) {
            currentRun.endDate = log.date;
            currentRun.totalProduction += production;
            currentRun.daysCount += 1;
            currentRun.avgProduction = currentRun.totalProduction / currentRun.daysCount;
            currentRun.logs?.push(log);
          } else {
            groupedRuns.push(currentRun);
            currentRun = {
              id: `${log.date}-${runType}`,
              startDate: log.date,
              endDate: log.date,
              client,
              fabric,
              totalProduction: production,
              daysCount: 1,
              avgProduction: production,
              status: isInactiveDay ? 'Idle' : 'Ongoing',
              type: runType,
              logs: [log]
            };
          }
        }
      });

      if (currentRun) {
        groupedRuns.push(currentRun);
      }

      setRuns(groupedRuns.reverse());

    } catch (error) {
      console.error("Error fetching history:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0 shadow-md">

          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Activity className="text-blue-400" />
              Production History
            </h2>
            <p className="text-slate-400 text-sm mt-0.5">
              Timeline for <span className="text-white font-medium">{machineName}</span>
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-500 font-medium">Loading history...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Package size={48} className="mx-auto mb-4 opacity-20" />
              <p>No production history found for this machine.</p>
            </div>
          ) : (
            <div className="relative space-y-6 pl-4">
              {/* Vertical Line */}
              <div className="absolute left-[27px] top-2 bottom-2 w-0.5 bg-slate-200"></div>

              {runs.map((run, idx) => (
                <div key={idx} className="relative flex gap-4 group">
                  {/* Timeline Dot */}
                  <div className="relative z-10 mt-1.5">
                    <div className={`w-3 h-3 rounded-full ring-4 ring-white shadow-sm group-hover:scale-125 transition-transform ${
                      run.type === 'INACTIVE' ? 'bg-slate-300' : 'bg-blue-600'
                    }`}></div>
                  </div>

                  {/* Card */}
                  <div className={`flex-1 rounded-lg border shadow-sm hover:shadow-md transition-shadow overflow-hidden ${
                    run.type === 'INACTIVE' 
                      ? 'bg-slate-50 border-slate-200 opacity-75' 
                      : 'bg-white border-slate-200'
                  }`}>
                    {/* Card Header */}
                    <div className={`px-4 py-2 border-b flex justify-between items-center ${
                      run.type === 'INACTIVE' ? 'bg-slate-100 border-slate-200' : 'bg-slate-50/50 border-slate-100'
                    }`}>
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Calendar size={14} className={run.type === 'INACTIVE' ? 'text-slate-400' : 'text-blue-500'} />
                        <span className={run.type === 'INACTIVE' ? 'text-slate-500' : 'text-slate-700'}>
                            {formatDate(run.startDate)}
                        </span>
                        {run.daysCount > 1 && (
                            <>
                                <ArrowRight size={12} className="text-slate-300" />
                                <span className={run.type === 'INACTIVE' ? 'text-slate-500' : 'text-slate-700'}>
                                    {formatDate(run.endDate)}
                                </span>
                            </>
                        )}
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded-full ${
                        run.type === 'INACTIVE' 
                          ? 'bg-slate-200 text-slate-500' 
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                         {run.type === 'INACTIVE' ? (
                             <span className="flex items-center gap-1"><PauseCircle size={10} /> Inactive</span>
                         ) : (
                             <span className="flex items-center gap-1"><Clock size={10} /> {run.daysCount} days</span>
                         )}
                      </div>
                    </div>

                    {/* Card Body */}
                    {run.type === 'INACTIVE' ? (
                       <div className="p-4 flex items-center justify-center text-slate-400 text-sm italic gap-2 h-20">
                           <PauseCircle size={16} />
                           Machine inactive for {run.daysCount} days
                       </div>
                    ) : (
                        <div className="p-4 grid grid-cols-2 gap-4">
                          <div className="col-span-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                              <User size={12} /> Client
                            </div>
                            <div className="font-medium text-slate-800 break-words leading-tight">
                              {run.client}
                            </div>
                          </div>
                          
                          <div className="col-span-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                              <Package size={12} /> Fabric
                            </div>
                            <div className="font-medium text-slate-800 break-words leading-tight">
                              {run.fabric}
                            </div>
                          </div>

                          <div className="col-span-2 pt-3 mt-1 border-t border-slate-100 flex justify-between items-end">
                            <div>
                              <div className="text-xs text-slate-400 mb-0.5">Avg. Daily</div>
                              <div className="font-mono font-medium text-slate-600">
                                {run.avgProduction.toFixed(1)} kg
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-400 mb-0.5">Total Production</div>
                              <div className="font-mono text-xl font-bold text-emerald-600">
                                {run.totalProduction.toLocaleString()} kg
                              </div>
                            </div>
                          </div>

                          {/* Admin Debug: Show days breakdown (collapsible) */}
                          {isAdmin && run.logs && run.logs.length > 0 && (
                            <div className="col-span-2 pt-3 mt-3 border-t border-amber-200">
                              <button
                                onClick={() => setExpandedDebug(expandedDebug === run.id ? null : run.id)}
                                className="flex items-center gap-1 text-xs font-medium text-amber-900 hover:text-amber-600 transition-colors"
                              >
                                <ChevronDown
                                  size={14}
                                  className={`transition-transform ${expandedDebug === run.id ? 'rotate-180' : ''}`}
                                />
                                📊 Debug
                              </button>
                              {expandedDebug === run.id && (
                                <div className="bg-amber-50/50 -mx-4 -mb-4 px-4 py-3 rounded-b mt-2">
                                  <div className="text-xs text-amber-800 space-y-1">
                                    <div className="flex items-start gap-2 mb-1">
                                      <span className="font-mono text-[11px]">{run.logs.map((log, i) => {
                                        const dateStr = log.date;
                                        let formatted = dateStr;
                                        try {
                                          const date = new Date(dateStr + 'T00:00:00Z');
                                          if (!isNaN(date.getTime())) {
                                            formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                                          }
                                        } catch (e) {
                                          // fallback to original date string
                                        }
                                        return (
                                          <span key={i}>
                                            {formatted}
                                            <span className="text-amber-600"> ({Number(log.dayProduction || 0).toFixed(1)}kg)</span>
                                            {i < run.logs!.length - 1 ? ' | ' : ''}
                                          </span>
                                        );
                                      })}</span>
                                    </div>
                                    <div className="text-[10px] text-amber-700 italic">
                                      (Slight name variations are not a problem - same client/fabric = same run)
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
};
