import React, { useState, useMemo, useEffect } from 'react';
import { Calendar, Filter, TrendingUp, Trash2, BarChart3, Download, PieChart, AlertCircle, Activity, ChevronDown, Layers } from 'lucide-react';
import { MachineRow } from '../types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ProductionHistoryPageProps {
  machines: MachineRow[];
}

const ExpandableStatCard = ({ 
  title, 
  total, 
  color, 
  icon: Icon, 
  data, 
  dataKey 
}: { 
  title: string, 
  total: number, 
  color: string, 
  icon: any, 
  data: any[], 
  dataKey: 'wide' | 'bous' | 'external' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Map color names to specific tailwind classes
  const colorClasses = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', ring: 'ring-purple-100' },
  };
  
  const styles = colorClasses[color as keyof typeof colorClasses] || colorClasses.emerald;

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200 ${isOpen ? `ring-2 ${styles.ring}` : ''}`}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-lg ${styles.bg} ${styles.text}`}>
            <Icon size={24} />
          </div>
          <div className="text-left">
            <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider">{title}</h3>
            <div className="text-2xl font-bold text-slate-800">{total.toLocaleString()} <span className="text-sm font-normal text-slate-400">kg</span></div>
          </div>
        </div>
        <div className={`transform transition-transform ${isOpen ? 'rotate-180' : ''} text-slate-400`}>
          <ChevronDown size={20} />
        </div>
      </button>
      
      {isOpen && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Production</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((day) => (
                  <tr key={day.date} className="hover:bg-slate-100/50">
                    <td className="px-4 py-2 font-medium text-slate-600">
                      {new Date(day.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">
                      {day[dataKey].toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

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

    const fullTotal = totalWide + totalBous + totalExternal;
    const scrapPercentage = fullTotal > 0 ? (totalScrap / fullTotal) * 100 : 0;

    return {
      totalWide,
      totalBous,
      totalExternal,
      totalScrap,
      fullTotal,
      scrapPercentage,
      avgWide: totalWide / daysCount,
      avgBous: totalBous / daysCount,
      avgExternal: totalExternal / daysCount,
      scrapReasons: Object.entries(scrapReasons).sort((a, b) => b[1] - a[1]),
      dailyData: dateArray.map(date => ({ date, ...dailyStats[date] })).reverse()
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
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Header & Controls */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 className="text-indigo-600" />
                Production Report
              </h1>
              <p className="text-slate-500 text-sm mt-1">Overview of production metrics and scrap analysis</p>
            </div>
            
            <div className="flex gap-2">
               <button onClick={() => handleQuickRange(7)} className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">Last 7 Days</button>
               <button onClick={() => handleQuickRange(30)} className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">Last 30 Days</button>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-lg border border-slate-200">
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
        </div>

        {/* Grand Total Card */}
        <div className="bg-slate-900 text-white p-6 rounded-xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Layers size={120} />
          </div>
          <div className="relative z-10 flex justify-between items-end">
            <div>
              <h2 className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Full Total Production</h2>
              <div className="text-4xl font-bold">{formatNumber(stats.fullTotal)} <span className="text-lg font-normal text-slate-500">kg</span></div>
            </div>
            <div className="text-right">
              <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Scrap</h3>
              <div className="text-xl font-bold text-red-400">{formatNumber(stats.totalScrap)} <span className="text-sm font-normal text-slate-500">kg</span></div>
              <div className="text-xs text-slate-500 mt-1">{stats.scrapPercentage.toFixed(2)}% of total</div>
            </div>
          </div>
        </div>

        {/* Expandable Detail Cards */}
        <div className="space-y-4">
          <ExpandableStatCard 
            title="Total Wide Production" 
            total={stats.totalWide} 
            color="emerald" 
            icon={TrendingUp} 
            data={stats.dailyData}
            dataKey="wide"
          />
          
          <ExpandableStatCard 
            title="Total External Production" 
            total={stats.totalExternal} 
            color="purple" 
            icon={Download} 
            data={stats.dailyData}
            dataKey="external"
          />

          <ExpandableStatCard 
            title="Total BOUS Production" 
            total={stats.totalBous} 
            color="blue" 
            icon={Activity} 
            data={stats.dailyData}
            dataKey="bous"
          />
        </div>

        {/* Scrap Analysis Section */}
        {stats.scrapReasons.length > 0 && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
               <AlertCircle size={18} className="text-red-500" />
               Scrap Analysis by Reason
             </h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      </div>
    </div>
  );
};
