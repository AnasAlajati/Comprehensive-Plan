import React, { useState, useMemo, useEffect } from 'react';
import { Calendar, Filter, TrendingUp, Trash2, BarChart3, Download, PieChart, AlertCircle, Activity } from 'lucide-react';
import { MachineRow } from '../types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ProductionHistoryPageProps {
  machines: MachineRow[];
}

export const ProductionHistoryPage: React.FC<ProductionHistoryPageProps> = ({ machines }) => {
  // Default to current month
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(today.toISOString().split('T')[0]);
  const [showScrap, setShowScrap] = useState(true);
  const [externalData, setExternalData] = useState<Record<string, number>>({});
  const [loadingExternal, setLoadingExternal] = useState(false);

  // Fetch External Production History
  useEffect(() => {
    const fetchExternalHistory = async () => {
      setLoadingExternal(true);
      try {
        // Fetch all summaries (optimization: could filter by date if collection is large)
        const q = query(collection(db, 'DailySummaries'));
        const snapshot = await getDocs(q);
        const data: Record<string, number> = {};
        snapshot.forEach(doc => {
          const val = doc.data().externalProduction;
          if (val) data[doc.id] = Number(val);
        });
        setExternalData(data);
      } catch (error) {
        console.error("Error fetching external history:", error);
      } finally {
        setLoadingExternal(false);
      }
    };

    fetchExternalHistory();
  }, []);

  const stats = useMemo(() => {
    let totalWide = 0;
    let totalBous = 0;
    let totalExternal = 0;
    let totalScrap = 0;
    
    const scrapReasons: Record<string, number> = {};
    const dailyStats: Record<string, { wide: number; bous: number; external: number; scrap: number }> = {};

    // Initialize daily stats for the range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dateArray: string[] = [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dateArray.push(dateStr);
      dailyStats[dateStr] = { wide: 0, bous: 0, external: 0, scrap: 0 };
      
      // Add External Data
      const ext = externalData[dateStr] || 0;
      dailyStats[dateStr].external = ext;
      totalExternal += ext;
    }

    // Process Machines
    machines.forEach(machine => {
      const isBous = machine.type === 'BOUS';
      const logs = machine.dailyLogs || [];
      
      logs.forEach(log => {
        if (log.date >= startDate && log.date <= endDate) {
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          const reason = log.reason || 'Unspecified';

          if (isBous) {
            totalBous += prod;
            if (dailyStats[log.date]) dailyStats[log.date].bous += prod;
          } else {
            totalWide += prod;
            if (dailyStats[log.date]) dailyStats[log.date].wide += prod;
          }

          totalScrap += scrap;
          if (dailyStats[log.date]) dailyStats[log.date].scrap += scrap;

          // Aggregate Scrap Reasons
          if (scrap > 0) {
            scrapReasons[reason] = (scrapReasons[reason] || 0) + scrap;
          }
        }
      });
    });

    const daysCount = dateArray.length || 1;

    return {
      totalWide,
      totalBous,
      totalExternal,
      totalScrap,
      avgWide: totalWide / daysCount,
      avgBous: totalBous / daysCount,
      avgExternal: totalExternal / daysCount,
      scrapReasons: Object.entries(scrapReasons).sort((a, b) => b[1] - a[1]),
      dailyData: dateArray.map(date => ({ date, ...dailyStats[date] }))
    };
  }, [machines, startDate, endDate, externalData]);

  const handleQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  };

  const formatNumber = (num: number) => num.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 pb-20">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header & Controls */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 className="text-indigo-600" />
                Production Report
              </h1>
              <p className="text-slate-500 text-sm mt-1">Exclusive report showing averages and scrap analysis</p>
            </div>
            
            <div className="flex gap-2">
               <button onClick={() => handleQuickRange(7)} className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">Last 7 Days</button>
               <button onClick={() => handleQuickRange(30)} className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">Last 30 Days</button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-lg border border-slate-200 w-full md:w-auto">
              <div className="relative group flex-1">
                <label className="absolute -top-2 left-2 text-[10px] bg-slate-50 px-1 text-slate-500 font-bold">Start Date</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-transparent border-none text-slate-700 text-sm font-medium rounded-lg px-3 py-2 focus:ring-0 outline-none"
                />
              </div>
              <span className="text-slate-400">-</span>
              <div className="relative group flex-1">
                <label className="absolute -top-2 left-2 text-[10px] bg-slate-50 px-1 text-slate-500 font-bold">End Date</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-transparent border-none text-slate-700 text-sm font-medium rounded-lg px-3 py-2 focus:ring-0 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setShowScrap(!showScrap)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${
                  showScrap 
                    ? 'bg-red-50 border-red-200 text-red-700' 
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Trash2 size={16} />
                {showScrap ? 'Hide Scrap Analysis' : 'Show Scrap Analysis'}
              </button>
            </div>
          </div>
        </div>

        {/* Averages Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <TrendingUp size={48} />
            </div>
            <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Avg. Wide Production</h3>
            <div className="text-2xl font-bold text-slate-800">{formatNumber(stats.avgWide)} <span className="text-sm font-normal text-slate-400">kg/day</span></div>
            <div className="mt-2 text-xs text-emerald-600 font-medium bg-emerald-50 inline-block px-2 py-1 rounded">
              Total: {formatNumber(stats.totalWide)} kg
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Activity size={48} />
            </div>
            <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Avg. BOUS Production</h3>
            <div className="text-2xl font-bold text-slate-800">{formatNumber(stats.avgBous)} <span className="text-sm font-normal text-slate-400">kg/day</span></div>
            <div className="mt-2 text-xs text-blue-600 font-medium bg-blue-50 inline-block px-2 py-1 rounded">
              Total: {formatNumber(stats.totalBous)} kg
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Download size={48} />
            </div>
            <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Avg. External</h3>
            <div className="text-2xl font-bold text-slate-800">{formatNumber(stats.avgExternal)} <span className="text-sm font-normal text-slate-400">kg/day</span></div>
            <div className="mt-2 text-xs text-purple-600 font-medium bg-purple-50 inline-block px-2 py-1 rounded">
              Total: {formatNumber(stats.totalExternal)} kg
            </div>
          </div>

          <div className={`p-5 rounded-xl shadow-sm border relative overflow-hidden ${showScrap ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Trash2 size={48} className={showScrap ? 'text-red-600' : 'text-slate-400'} />
            </div>
            <h3 className={`${showScrap ? 'text-red-800' : 'text-slate-500'} text-xs font-bold uppercase tracking-wider mb-1`}>Total Scrap</h3>
            <div className={`text-2xl font-bold ${showScrap ? 'text-red-900' : 'text-slate-800'}`}>{formatNumber(stats.totalScrap)} <span className="text-sm font-normal opacity-60">kg</span></div>
            <div className="mt-2 text-xs opacity-75">
              {(stats.totalWide + stats.totalBous + stats.totalExternal) > 0 
                ? ((stats.totalScrap / (stats.totalWide + stats.totalBous + stats.totalExternal)) * 100).toFixed(2) 
                : 0}% of total output
            </div>
          </div>
        </div>

        {/* Scrap Analysis Section */}
        {showScrap && stats.scrapReasons.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
               <AlertCircle size={18} className="text-red-500" />
               Scrap Analysis by Reason
             </h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
               {stats.scrapReasons.map(([reason, amount], idx) => (
                 <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-xs">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-slate-700">{reason}</span>
                    </div>
                    <span className="text-sm font-bold text-slate-800">{formatNumber(amount)} kg</span>
                 </div>
               ))}
             </div>
          </div>
        )}

        {/* Detailed Report Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800">Daily Production Report</h3>
            <span className="text-xs text-slate-500">{stats.dailyData.length} days</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Wide (kg)</th>
                  <th className="px-4 py-3 text-right">BOUS (kg)</th>
                  <th className="px-4 py-3 text-right">External (kg)</th>
                  <th className="px-4 py-3 text-right font-bold bg-slate-100/50">Total (kg)</th>
                  {showScrap && <th className="px-4 py-3 text-right text-red-600">Scrap (kg)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.dailyData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No data found for the selected range.
                    </td>
                  </tr>
                ) : (
                  stats.dailyData.map((day) => (
                    <tr key={day.date} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {new Date(day.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{formatNumber(day.wide)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{formatNumber(day.bous)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{formatNumber(day.external)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-800 bg-slate-50/50">
                        {formatNumber(day.wide + day.bous + day.external)}
                      </td>
                      {showScrap && (
                        <td className="px-4 py-3 text-right font-mono text-red-600 bg-red-50/30">
                          {formatNumber(day.scrap)}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {stats.dailyData.length > 0 && (
                <tfoot className="bg-slate-50 font-bold text-slate-800 border-t border-slate-200">
                  <tr>
                    <td className="px-4 py-3">Grand Total</td>
                    <td className="px-4 py-3 text-right">{formatNumber(stats.totalWide)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(stats.totalBous)}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(stats.totalExternal)}</td>
                    <td className="px-4 py-3 text-right bg-slate-100/50">
                      {formatNumber(stats.totalWide + stats.totalBous + stats.totalExternal)}
                    </td>
                    {showScrap && <td className="px-4 py-3 text-right text-red-600">{formatNumber(stats.totalScrap)}</td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};
