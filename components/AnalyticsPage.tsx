import React, { useMemo, useState } from 'react';
import { MachineRow } from '../types';
import { BarChart3, TrendingUp, AlertTriangle, ArrowUp, ArrowDown, Filter } from 'lucide-react';

interface AnalyticsPageProps {
  machines: MachineRow[];
}

interface PerformanceMetric {
  name: string;
  totalProduction: number;
  totalScrap: number;
  logCount: number;
  avgSpeed: number;
  scrapRate: number;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ machines }) => {
  const [activeTab, setActiveTab] = useState<'fabric' | 'client'>('fabric');

  const analyticsData = useMemo(() => {
    const fabricStats: Record<string, { prod: number; scrap: number; count: number; speedSum: number }> = {};
    const clientStats: Record<string, { prod: number; scrap: number; count: number; speedSum: number }> = {};

    machines.forEach(machine => {
      if (machine.dailyLogs) {
        machine.dailyLogs.forEach(log => {
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          
          // Fabric Stats
          if (log.fabric) {
            if (!fabricStats[log.fabric]) fabricStats[log.fabric] = { prod: 0, scrap: 0, count: 0, speedSum: 0 };
            fabricStats[log.fabric].prod += prod;
            fabricStats[log.fabric].scrap += scrap;
            fabricStats[log.fabric].count += 1;
            fabricStats[log.fabric].speedSum += prod;
          }

          // Client Stats
          if (log.client) {
            if (!clientStats[log.client]) clientStats[log.client] = { prod: 0, scrap: 0, count: 0, speedSum: 0 };
            clientStats[log.client].prod += prod;
            clientStats[log.client].scrap += scrap;
            clientStats[log.client].count += 1;
            clientStats[log.client].speedSum += prod;
          }
        });
      }
    });

    const processStats = (stats: typeof fabricStats): PerformanceMetric[] => {
      return Object.entries(stats).map(([name, data]) => ({
        name,
        totalProduction: data.prod,
        totalScrap: data.scrap,
        logCount: data.count,
        avgSpeed: data.count > 0 ? Math.round(data.speedSum / data.count) : 0,
        scrapRate: (data.prod + data.scrap) > 0 ? (data.scrap / (data.prod + data.scrap)) * 100 : 0
      })).sort((a, b) => b.totalProduction - a.totalProduction); // Default sort by volume
    };

    return {
      fabrics: processStats(fabricStats),
      clients: processStats(clientStats)
    };
  }, [machines]);

  const currentData = activeTab === 'fabric' ? analyticsData.fabrics : analyticsData.clients;

  // Top Performers (Speed) - Filter out low volume to avoid outliers
  const topSpeed = [...currentData].filter(d => d.logCount > 5).sort((a, b) => b.avgSpeed - a.avgSpeed).slice(0, 3);
  
  // High Scrap - Filter out low volume
  const highScrap = [...currentData].filter(d => d.logCount > 5).sort((a, b) => b.scrapRate - a.scrapRate).slice(0, 3);

  return (
    <div className="space-y-6 p-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-blue-600" />
            Performance Analytics
          </h1>
          <p className="text-slate-500">Analyze profitability and efficiency by {activeTab}</p>
        </div>
        
        <div className="bg-white p-1 rounded-lg border border-slate-200 flex">
          <button
            onClick={() => setActiveTab('fabric')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'fabric' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Fabric Analysis
          </button>
          <button
            onClick={() => setActiveTab('client')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'client' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Client Analysis
          </button>
        </div>
      </div>

      {/* Insights Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            Fastest Runners (Avg Speed)
          </h3>
          <div className="space-y-4">
            {topSpeed.map((item, idx) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                  <span className="font-medium text-slate-700">{item.name}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-emerald-600">{item.avgSpeed} kg/day</div>
                  <div className="text-xs text-slate-400">{item.logCount} runs</div>
                </div>
              </div>
            ))}
            {topSpeed.length === 0 && <div className="text-slate-400 italic text-sm">Not enough data</div>}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Highest Scrap Rates
          </h3>
          <div className="space-y-4">
            {highScrap.map((item, idx) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                  <span className="font-medium text-slate-700">{item.name}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-amber-600">{item.scrapRate.toFixed(1)}%</div>
                  <div className="text-xs text-slate-400">{item.totalScrap} kg lost</div>
                </div>
              </div>
            ))}
            {highScrap.length === 0 && <div className="text-slate-400 italic text-sm">Not enough data</div>}
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Detailed Performance Report</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-medium">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3 text-right">Total Volume (kg)</th>
                <th className="px-6 py-3 text-right">Avg Speed (kg/day)</th>
                <th className="px-6 py-3 text-right">Total Scrap (kg)</th>
                <th className="px-6 py-3 text-right">Scrap Rate</th>
                <th className="px-6 py-3 text-center">Samples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentData.map((row) => (
                <tr key={row.name} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3 font-medium text-slate-700">{row.name}</td>
                  <td className="px-6 py-3 text-right text-slate-600">{row.totalProduction.toLocaleString()}</td>
                  <td className="px-6 py-3 text-right font-mono text-blue-600">{row.avgSpeed}</td>
                  <td className="px-6 py-3 text-right text-slate-600">{row.totalScrap}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                      row.scrapRate > 5 ? 'bg-red-100 text-red-700' : 
                      row.scrapRate > 2 ? 'bg-amber-100 text-amber-700' : 
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {row.scrapRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-3 text-center text-slate-400 text-xs">{row.logCount}</td>
                </tr>
              ))}
              {currentData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                    No data available for analysis.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
