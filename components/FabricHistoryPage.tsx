import React, { useState, useMemo, useEffect } from 'react';
import { MachineRow } from '../types';
import { collectionGroup, getDocs, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { 
  Search, 
  ChevronRight, 
  Calendar, 
  User, 
  Factory, 
  History,
  Loader2,
  Layers,
  ChevronDown,
  ChevronUp,
  ArrowRight
} from 'lucide-react';

interface FabricHistoryPageProps {
  machines: MachineRow[];
}

interface FabricStats {
  name: string;
  totalProduction: number;
  totalScrap: number;
  lastProduced: string;
  firstProduced: string;
  clientBreakdown: Record<string, number>;
  machineBreakdown: Record<string, number>;
  logs: {
    date: string;
    machine: string;
    client: string;
    quantity: number;
    scrap: number;
  }[];
}

export const FabricHistoryPage: React.FC<FabricHistoryPageProps> = ({ machines }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFabric, setSelectedFabric] = useState<FabricStats | null>(null);
  const [allLogs, setAllLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // State for expanding a customer to see their daily logs
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);

  // Fetch all history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Fetch all daily logs from all machines
        const q = query(collectionGroup(db, 'dailyLogs'));
        const snapshot = await getDocs(q);
        const logs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        setAllLogs(logs);
      } catch (err) {
        console.error("Error fetching history:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  // Aggregate Data
  const fabricStats = useMemo(() => {
    const stats: Record<string, FabricStats> = {};

    // Use fetched logs instead of machines prop
    allLogs.forEach(log => {
      if (!log.fabric || !log.dayProduction) return;
      
      const fabricName = log.fabric.trim();
      if (!stats[fabricName]) {
        stats[fabricName] = {
          name: fabricName,
          totalProduction: 0,
          totalScrap: 0,
          lastProduced: log.date,
          firstProduced: log.date,
          clientBreakdown: {},
          machineBreakdown: {},
          logs: []
        };
      }

      const entry = stats[fabricName];
      const qty = Number(log.dayProduction);
      const scrap = Number(log.scrap || 0);

      // Totals
      entry.totalProduction += qty;
      entry.totalScrap += scrap;

      // Dates
      if (log.date > entry.lastProduced) entry.lastProduced = log.date;
      if (log.date < entry.firstProduced) entry.firstProduced = log.date;

      // Client Breakdown
      const client = log.client ? log.client.trim() : 'Unknown';
      entry.clientBreakdown[client] = (entry.clientBreakdown[client] || 0) + qty;

      // Machine Breakdown
      // Try to find machine name from ID if name is missing in log
      let machineName = log.machineName || log.machine || 'Unknown';
      if (machineName === 'Unknown' && log.machineId) {
         const m = machines.find(m => String(m.id) === String(log.machineId));
         if (m) machineName = m.machineName || m.brand;
      }
      
      entry.machineBreakdown[machineName] = (entry.machineBreakdown[machineName] || 0) + qty;

      // Logs
      entry.logs.push({
        date: log.date,
        machine: machineName,
        client: client,
        quantity: qty,
        scrap: scrap
      });
    });

    // Sort logs by date desc
    Object.values(stats).forEach(s => {
      s.logs.sort((a, b) => b.date.localeCompare(a.date));
    });

    return Object.values(stats).sort((a, b) => b.totalProduction - a.totalProduction);
  }, [allLogs, machines]);

  const filteredFabrics = fabricStats.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p>Loading complete history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <History className="w-6 h-6 text-blue-600" />
            Fabric History
          </h1>
          <p className="text-slate-500 mt-1">
            Production analysis by fabric type
          </p>
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search fabrics..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {selectedFabric ? (
        // Detail View
        <div className="space-y-6">
          <button 
            onClick={() => {
                setSelectedFabric(null);
                setExpandedCustomer(null);
            }}
            className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-medium"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to Fabrics
          </button>

          {/* Fabric Header Card */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                        <Layers className="w-6 h-6" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">{selectedFabric.name}</h2>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        First: {selectedFabric.firstProduced}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <ArrowRight className="w-4 h-4" />
                        Last: {selectedFabric.lastProduced}
                    </span>
                </div>
            </div>
            <div className="flex gap-8">
                <div className="text-right">
                    <div className="text-sm text-slate-500 font-medium uppercase tracking-wider">Total Production</div>
                    <div className="text-3xl font-bold text-slate-900">
                        {selectedFabric.totalProduction.toLocaleString()}
                        <span className="text-lg font-normal text-slate-400 ml-1">kg</span>
                    </div>
                </div>
                <div className="text-right border-l border-slate-100 pl-8">
                    <div className="text-sm text-slate-500 font-medium uppercase tracking-wider">Total Scrap</div>
                    <div className="text-3xl font-bold text-red-600">
                        {selectedFabric.totalScrap.toLocaleString()}
                        <span className="text-lg font-normal text-red-300 ml-1">kg</span>
                    </div>
                </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Customer Breakdown (Main Focus) */}
            <div className="lg:col-span-2 space-y-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-600" />
                    Production by Customer
                </h3>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="divide-y divide-slate-100">
                        {Object.entries(selectedFabric.clientBreakdown)
                            .sort((a, b) => b[1] - a[1])
                            .map(([clientName, quantity]) => {
                                const isExpanded = expandedCustomer === clientName;
                                const clientLogs = selectedFabric.logs.filter(l => l.client === clientName);
                                const maxVal = Math.max(...Object.values(selectedFabric.clientBreakdown));
                                const percent = (quantity / maxVal) * 100;

                                return (
                                    <div key={clientName} className="group transition-colors hover:bg-slate-50">
                                        {/* Customer Row */}
                                        <div 
                                            onClick={() => setExpandedCustomer(isExpanded ? null : clientName)}
                                            className="p-4 cursor-pointer flex items-center gap-4"
                                        >
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="font-bold text-slate-700">{clientName}</span>
                                                    <span className="font-mono font-bold text-slate-900">{quantity.toLocaleString()} kg</span>
                                                </div>
                                                {/* Progress Bar */}
                                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${percent}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="text-slate-400">
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                        </div>

                                        {/* Expanded Details (Daily Logs) */}
                                        {isExpanded && (
                                            <div className="bg-slate-50 border-t border-slate-100 p-4 animate-in slide-in-from-top-2">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Daily Production Logs</h4>
                                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                    <table className="w-full text-sm text-left">
                                                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                                            <tr>
                                                                <th className="px-4 py-2">Date</th>
                                                                <th className="px-4 py-2">Machine</th>
                                                                <th className="px-4 py-2 text-right">Quantity</th>
                                                                <th className="px-4 py-2 text-right">Scrap</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {clientLogs.map((log, idx) => (
                                                                <tr key={idx} className="hover:bg-slate-50">
                                                                    <td className="px-4 py-2 font-mono text-slate-600">{log.date}</td>
                                                                    <td className="px-4 py-2 text-slate-600">{log.machine}</td>
                                                                    <td className="px-4 py-2 text-right font-mono font-medium text-blue-600">{log.quantity.toLocaleString()}</td>
                                                                    <td className="px-4 py-2 text-right font-mono text-red-500">{log.scrap > 0 ? log.scrap : '-'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </div>

            {/* Right Column: Machine Stats */}
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Factory className="w-5 h-5 text-purple-600" />
                    Machine Performance
                </h3>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <div className="space-y-4">
                        {Object.entries(selectedFabric.machineBreakdown)
                            .sort((a, b) => b[1] - a[1])
                            .map(([machineName, quantity], idx) => {
                                const maxVal = Math.max(...Object.values(selectedFabric.machineBreakdown));
                                const percent = (quantity / maxVal) * 100;
                                return (
                                    <div key={machineName} className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-xs">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="font-medium text-slate-700">{machineName}</span>
                                                <span className="font-mono text-slate-600">{quantity.toLocaleString()}</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div 
                                                    className="h-full bg-purple-500 rounded-full"
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </div>
          </div>

        </div>
      ) : (
        // List View (Cards)
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFabrics.map((fabric) => (
            <div 
              key={fabric.name}
              onClick={() => setSelectedFabric(fabric)}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <Layers className="w-6 h-6" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-900">
                    {fabric.totalProduction.toLocaleString()}
                    <span className="text-sm font-normal text-slate-400 ml-1">kg</span>
                  </div>
                </div>
              </div>
              
              <h3 className="text-lg font-bold text-slate-800 mb-3 group-hover:text-blue-600 transition-colors">
                {fabric.name}
              </h3>

              <div className="space-y-2.5 text-sm text-slate-500 border-t border-slate-100 pt-3">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-2 text-slate-400">
                    <User className="w-4 h-4" />
                    Top Client
                  </span>
                  <span className="font-medium text-slate-700 truncate max-w-[120px]">
                    {Object.entries(fabric.clientBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-2 text-slate-400">
                    <Calendar className="w-4 h-4" />
                    Last Run
                  </span>
                  <span className="font-mono text-slate-700">{fabric.lastProduced}</span>
                </div>
              </div>
            </div>
          ))}
          
          {filteredFabrics.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-300" />
              </div>
              <p>No fabrics found matching "{searchTerm}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
