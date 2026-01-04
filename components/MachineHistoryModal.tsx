import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { X, Calendar, Package, User, Activity, ArrowRight } from 'lucide-react';

interface MachineHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machineId: string;
  machineName: string;
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
  status: string; // 'Completed' | 'Ongoing' | 'Interrupted'
}

export const MachineHistoryModal: React.FC<MachineHistoryModalProps> = ({
  isOpen,
  onClose,
  machineId,
  machineName,
}) => {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<ProductionRun[]>([]);

  useEffect(() => {
    if (isOpen && machineId) {
      fetchHistory();
    }
  }, [isOpen, machineId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // Fetch all daily logs for this machine
      // Structure: MachineSS/{machineId}/dailyLogs/{date}
      const logsRef = collection(db, 'MachineSS', machineId, 'dailyLogs');
      // We want to order by date. Since date is the document ID usually, or a field.
      // Based on DataService, it seems 'date' is the doc ID.
      // But let's assume there is a 'date' field or we sort manually.
      // Let's try to fetch all and sort in JS to be safe if indexes are missing.
      const snapshot = await getDocs(logsRef);
      
      const logs: DailyLog[] = snapshot.docs.map(doc => ({
        date: doc.id, // Assuming doc ID is YYYY-MM-DD
        ...doc.data()
      } as DailyLog));

      // Sort by date ascending (oldest first) to build timeline
      logs.sort((a, b) => a.date.localeCompare(b.date));

      // Group into Runs
      const groupedRuns: ProductionRun[] = [];
      let currentRun: ProductionRun | null = null;

      logs.forEach((log) => {
        // Skip days with no production/activity if needed, or treat as gaps?
        // For now, we include everything.
        
        // Normalize empty values
        const client = log.client || 'Unknown';
        const fabric = log.fabric || 'Unknown';
        const production = Number(log.dayProduction) || 0;

        if (!currentRun) {
          // Start first run
          currentRun = {
            id: `${log.date}-${client}-${fabric}`,
            startDate: log.date,
            endDate: log.date,
            client,
            fabric,
            totalProduction: production,
            daysCount: 1,
            avgProduction: production,
            status: 'Ongoing'
          };
        } else {
          // Check if matches current run
          const isSameRun = 
            log.client === currentRun.client && 
            log.fabric === currentRun.fabric;

          // Check for date continuity (optional, but good for "Runs")
          // If there is a huge gap, maybe split? 
          // For now, let's just group by Client/Fabric change.
          
          if (isSameRun) {
            currentRun.endDate = log.date;
            currentRun.totalProduction += production;
            currentRun.daysCount += 1;
            currentRun.avgProduction = currentRun.totalProduction / currentRun.daysCount;
          } else {
            // Close current run
            groupedRuns.push(currentRun);
            
            // Start new run
            currentRun = {
              id: `${log.date}-${client}-${fabric}`,
              startDate: log.date,
              endDate: log.date,
              client,
              fabric,
              totalProduction: production,
              daysCount: 1,
              avgProduction: production,
              status: 'Ongoing'
            };
          }
        }
      });

      if (currentRun) {
        groupedRuns.push(currentRun);
      }

      // Reverse to show newest first
      setRuns(groupedRuns.reverse());

    } catch (error) {
      console.error("Error fetching history:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
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
                    <div className="w-3 h-3 rounded-full bg-blue-600 ring-4 ring-white shadow-sm group-hover:scale-125 transition-transform"></div>
                  </div>

                  {/* Card */}
                  <div className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                    {/* Card Header */}
                    <div className="bg-slate-50/50 px-4 py-2 border-b border-slate-100 flex justify-between items-center">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Calendar size={14} />
                        <span>{formatDate(run.startDate)}</span>
                        <ArrowRight size={12} className="text-slate-400" />
                        <span>{formatDate(run.endDate)}</span>
                      </div>
                      <div className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
                        {run.daysCount} days
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                          <User size={12} /> Client
                        </div>
                        <div className="font-medium text-slate-800 truncate" title={run.client}>
                          {run.client}
                        </div>
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                          <Package size={12} /> Fabric
                        </div>
                        <div className="font-medium text-slate-800 truncate" title={run.fabric}>
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
                    </div>
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
