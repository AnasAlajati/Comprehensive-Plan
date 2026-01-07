import React, { useState, useEffect, useMemo } from 'react';
import { X, Calendar, Factory, AlertCircle, Loader2, History, TrendingDown, AlertTriangle, PauseCircle, CheckCircle2, Bug } from 'lucide-react';
import { OrderRow, MachineSS } from '../types';

interface OrderProductionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  clientName: string;
  machines: MachineSS[];
}

interface ProductionLog {
  id: string;
  date: string;
  machineName: string;
  dayProduction: number;
  remaining: number; // NEW: Remaining quantity for that day
  scrap: number;
  reason?: string;
}

interface Insight {
  type: 'gap' | 'low_production' | 'high_scrap' | 'good';
  message: string;
  date?: string;
  details?: string;
}

// Helper for "13-Jan" format
const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const str = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return str.replace(' ', '-');
};

export const OrderProductionHistoryModal: React.FC<OrderProductionHistoryModalProps> = ({
  isOpen,
  onClose,
  order,
  clientName,
  machines
}) => {
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalProduction, setTotalProduction] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && order) {
      fetchLogs();
    }
  }, [isOpen, order, machines]);

  const fetchLogs = async () => {
    setLoading(true);
    const debug: string[] = [];
    debug.push(`Searching for Client: "${clientName}"`);
    debug.push(`Searching for Fabric: "${order.material}"`);
    debug.push(`Total Machines Scanned: ${machines.length}`);

    try {
      const logsData: ProductionLog[] = [];
      const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
      const targetClient = normalize(clientName);
      const targetFabric = normalize(order.material);
      
      // Track what we find for debugging
      const fabricFoundOnClients = new Set<string>();
      const fabricFoundOnMachines = new Set<string>();
      let totalLogsWithFabric = 0;
      
      machines.forEach(machine => {
          if (!machine.dailyLogs || !Array.isArray(machine.dailyLogs)) return;
          
          machine.dailyLogs.forEach((log, idx) => {
              const logClient = normalize(log.client);
              const logFabric = normalize(log.fabric);
              
              // Track if fabric matches (even if client doesn't)
              if (logFabric === targetFabric || (log.fabric && normalize(log.fabric) === targetFabric)) {
                  totalLogsWithFabric++;
                  fabricFoundOnClients.add(log.client || 'Unknown');
                  fabricFoundOnMachines.add(machine.name || 'Unknown');
              }

              const isMatch = (logClient === targetClient && logFabric === targetFabric) ||
                              (log.client === clientName && log.fabric === order.material); // Fallback to exact match

              if (isMatch) {
                  logsData.push({
                      id: `${machine.name}-${log.date}-${idx}`,
                      date: log.date,
                      machineName: machine.name,
                      dayProduction: Number(log.dayProduction) || 0,
                      remaining: Number(log.remainingMfg) || 0, // Capture remaining
                      scrap: Number(log.scrap) || 0,
                      reason: log.note || ''
                  });
              }
          });
      });

      debug.push(`Found ${logsData.length} matching logs.`);
      
      // Add helpful debug info if no matches but fabric exists elsewhere
      if (logsData.length === 0 && totalLogsWithFabric > 0) {
          debug.push(`---`);
          debug.push(`⚠️ This fabric was found ${totalLogsWithFabric} times but for DIFFERENT clients:`);
          debug.push(`Clients with this fabric: ${Array.from(fabricFoundOnClients).join(', ')}`);
          debug.push(`Machines that produced it: ${Array.from(fabricFoundOnMachines).join(', ')}`);
      }

      // Sort by date descending for display
      logsData.sort((a, b) => b.date.localeCompare(a.date));
      
      setLogs(logsData);
      setTotalProduction(logsData.reduce((sum, log) => sum + log.dayProduction, 0));
      setDebugInfo(debug);

    } catch (error) {
      console.error("Error fetching production history:", error);
      debug.push(`Error: ${error}`);
      setDebugInfo(debug);
    } finally {
      setLoading(false);
    }
  };

  // Group Logs by Production Run (Gap > 14 days)
  const groupedLogs = useMemo(() => {
    if (logs.length === 0) return [];
    
    const groups: { title: string; logs: ProductionLog[] }[] = [];
    let currentGroup: ProductionLog[] = [];
    
    // Logs are already sorted descending (Newest first)
    for (let i = 0; i < logs.length; i++) {
      const currentLog = logs[i];
      
      if (currentGroup.length === 0) {
        currentGroup.push(currentLog);
      } else {
        const prevLog = currentGroup[currentGroup.length - 1];
        const prevDate = new Date(prevLog.date);
        const currDate = new Date(currentLog.date);
        const diffTime = Math.abs(prevDate.getTime() - currDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // If gap is large, start a new group (Previous Run)
        if (diffDays > 14) {
           // Close current group
           const startDate = currentGroup[currentGroup.length - 1].date;
           const endDate = currentGroup[0].date;
           const year = new Date(endDate).getFullYear();
           const month = new Date(endDate).toLocaleString('default', { month: 'short' });
           
           groups.push({
             title: groups.length === 0 ? 'Current Production Run' : `Previous Run (${month} ${year})`,
             logs: currentGroup
           });
           
           // Start new group
           currentGroup = [currentLog];
        } else {
           currentGroup.push(currentLog);
        }
      }
    }
    
    // Push the last group
    if (currentGroup.length > 0) {
        const endDate = currentGroup[0].date;
        const year = new Date(endDate).getFullYear();
        const month = new Date(endDate).toLocaleString('default', { month: 'short' });
        groups.push({
            title: groups.length === 0 ? 'Current Production Run' : `Previous Run (${month} ${year})`,
            logs: currentGroup
        });
    }
    
    return groups;
  }, [logs]);

  // Last Working Date Info
  const lastWorkingInfo = useMemo(() => {
      if (logs.length === 0) return null;
      const latestLog = logs[0]; // Already sorted descending
      return {
          date: formatDate(latestLog.date),
          remaining: latestLog.remaining
      };
  }, [logs]);

  // Analyze Abnormalities
  const insights = useMemo(() => {
    if (logs.length < 2) return [];
    
    const results: Insight[] = [];
    
    // Sort ascending for analysis
    const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate Stats
    const avgProd = sortedLogs.reduce((sum, l) => sum + l.dayProduction, 0) / sortedLogs.length;
    const lowProdThreshold = avgProd * 0.6; // 60% of average
    
    // 1. Check for Gaps (Stoppages)
    for (let i = 1; i < sortedLogs.length; i++) {
      const prev = new Date(sortedLogs[i-1].date);
      const curr = new Date(sortedLogs[i].date);
      const diffTime = Math.abs(curr.getTime() - prev.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      
      if (diffDays > 2) {
        results.push({
          type: 'gap',
          message: `Production stopped for ${diffDays - 1} days`,
          date: `${sortedLogs[i-1].date} to ${sortedLogs[i].date}`,
          details: 'Potential machine downtime or material shortage'
        });
      }
    }

    // 2. Check for Low Production & High Scrap
    sortedLogs.forEach(log => {
      if (log.dayProduction < lowProdThreshold && log.dayProduction > 0) {
        results.push({
          type: 'low_production',
          message: 'Low Production Detected',
          date: log.date,
          details: `${log.dayProduction}kg (Avg: ${Math.round(avgProd)}kg)`
        });
      }

      if (log.scrap > 20) { // Hard threshold for now, could be percentage
        results.push({
          type: 'high_scrap',
          message: 'High Scrap Event',
          date: log.date,
          details: `${log.scrap}kg scrap recorded`
        });
      }
    });

    // 3. Good Streak
    if (results.length === 0) {
        results.push({
            type: 'good',
            message: 'Smooth Production Run',
            details: 'No significant gaps or issues detected'
        });
    }

    return results;
  }, [logs]);

  const narrative = useMemo(() => {
      if (logs.length === 0) return null;
      const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
      const start = sorted[0].date;
      const end = sorted[sorted.length - 1].date;
      
      const gaps = insights.filter(i => i.type === 'gap');
      const low = insights.filter(i => i.type === 'low_production');
      const scrap = insights.filter(i => i.type === 'high_scrap');
      
      let text = `Production started on ${start} and last ran on ${end}. `;
      
      if (gaps.length > 0) {
          text += `It faced ${gaps.length} stoppages, including a long break around ${gaps[0].date?.split(' to ')[0]}. `;
      } else {
          text += `It ran consistently without major interruptions. `;
      }
      
      if (low.length > 0 && scrap.length > 0) {
          text += `However, it struggled with both low production (${low.length} days) and high scrap (${scrap.length} days). `;
      } else if (low.length > 0) {
          text += `There were ${low.length} days where production dropped significantly. `;
      } else if (scrap.length > 0) {
          text += `Scrap levels were high on ${scrap.length} occasions. `;
      } else {
          text += `Performance was generally stable.`;
      }
      
      return text;
  }, [logs, insights]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Production History & Insights
            </h2>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <span className="font-medium text-slate-700">{clientName}</span>
              <span className="text-slate-300">•</span>
              <span className="font-medium text-slate-700">{order.material}</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Debug Info (Hidden by default, visible on hover or if empty) */}
          {(logs.length === 0 || loading) && (
             <div className="bg-slate-100 p-2 rounded text-[10px] font-mono text-slate-500 mb-4">
                <div className="font-bold mb-1 flex items-center gap-1"><Bug size={10}/> Debug Info:</div>
                {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
             </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p>Analyzing production data...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              <AlertCircle className="w-10 h-10 mb-3 text-slate-300" />
              <p>No production logs found for this order.</p>
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <div className="text-xs text-blue-600 font-medium uppercase tracking-wider">Total Produced</div>
                  <div className="text-2xl font-bold text-blue-900 mt-1">
                    {totalProduction.toLocaleString()} <span className="text-sm font-normal text-blue-600/70">kg</span>
                  </div>
                </div>
                
                {/* Last Working Date Header */}
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
                  <div className="text-xs text-purple-600 font-medium uppercase tracking-wider">Last Working Date</div>
                  <div className="flex flex-col">
                      <div className="text-xl font-bold text-purple-900 mt-1">
                        {lastWorkingInfo?.date || '-'}
                      </div>
                      <div className="text-xs text-purple-700 mt-0.5">
                        Remaining: <span className="font-bold">{lastWorkingInfo?.remaining?.toLocaleString() || 0} kg</span>
                      </div>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                  <div className="text-xs text-emerald-600 font-medium uppercase tracking-wider">Avg / Day</div>
                  <div className="text-2xl font-bold text-emerald-900 mt-1">
                    {Math.round(totalProduction / logs.length).toLocaleString()} <span className="text-sm font-normal text-emerald-600/70">kg</span>
                  </div>
                </div>
              </div>

              {/* AI Insights Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  Production Anomalies
                </h3>
                
                {/* Narrative */}
                {narrative && (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm text-slate-700 leading-relaxed">
                        <span className="font-semibold text-slate-900">Summary: </span>
                        {narrative}
                    </div>
                )}

                <div className="grid gap-3">
                  {insights.map((insight, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3 rounded-lg border flex items-start gap-3 ${
                        insight.type === 'gap' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                        insight.type === 'low_production' ? 'bg-orange-50 border-orange-200 text-orange-900' :
                        insight.type === 'high_scrap' ? 'bg-red-50 border-red-200 text-red-900' :
                        'bg-emerald-50 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      <div className={`mt-0.5 p-1 rounded-full ${
                        insight.type === 'gap' ? 'bg-amber-100 text-amber-600' :
                        insight.type === 'low_production' ? 'bg-orange-100 text-orange-600' :
                        insight.type === 'high_scrap' ? 'bg-red-100 text-red-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>
                        {insight.type === 'gap' ? <PauseCircle size={16} /> :
                         insight.type === 'low_production' ? <TrendingDown size={16} /> :
                         insight.type === 'high_scrap' ? <AlertTriangle size={16} /> :
                         <CheckCircle2 size={16} />}
                      </div>
                      <div>
                        <div className="font-bold text-sm">{insight.message}</div>
                        <div className="text-xs opacity-80 mt-0.5">
                          {insight.date && <span className="font-mono mr-2">{formatDate(insight.date)}:</span>}
                          {insight.details}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed Logs Table (Grouped) */}
              <div className="space-y-6">
                {groupedLogs.map((group, groupIdx) => (
                    <div key={groupIdx}>
                        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-400" />
                            {group.title}
                        </h3>
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 w-32">Date</th>
                                <th className="px-4 py-3">Machine</th>
                                <th className="px-4 py-3 text-right">Production</th>
                                <th className="px-4 py-3 text-right">Remaining</th>
                                <th className="px-4 py-3 text-right">Scrap</th>
                            </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                            {group.logs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-mono text-slate-600 flex items-center gap-2">
                                    <Calendar className="w-3 h-3 text-slate-400" />
                                    {formatDate(log.date)}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                    <Factory className="w-3 h-3 text-slate-400" />
                                    <span className="font-medium text-slate-700">{log.machineName}</span>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">
                                    {log.dayProduction.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-600">
                                    {log.remaining.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-red-500">
                                    {log.scrap > 0 ? log.scrap : '-'}
                                </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
