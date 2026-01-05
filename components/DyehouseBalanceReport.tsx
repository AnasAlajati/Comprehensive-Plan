import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { OrderRow, CustomerSheet } from '../types';
import { 
  Search, 
  Download, 
  RefreshCw,
  FileBarChart,
  Filter
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface BalanceEntry {
  clientName: string;
  dyehouseBalances: Record<string, number>;
  totalBalance: number;
}

export const DyehouseBalanceReport: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BalanceEntry[]>([]);
  const [dyehouses, setDyehouses] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [hideZeroRows, setHideZeroRows] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Clients for Name Lookup
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const d = doc.data();
        clientMap[doc.id] = d.name || 'Unknown Client';
      });

      // 2. Fetch All Orders
      const ordersSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      
      const balances: Record<string, Record<string, number>> = {}; // Client -> Dyehouse -> Amount
      const allDyehouses = new Set<string>();

      ordersSnapshot.docs.forEach(doc => {
        const order = doc.data() as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (!balances[clientName]) {
          balances[clientName] = {};
        }

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach(batch => {
            // Only count if sent
            if (batch.dateSent || batch.quantitySent) {
              const dyehouse = batch.dyehouse || 'Unassigned';
              allDyehouses.add(dyehouse);

              const sent = batch.quantitySent || 0;
              const received = batch.receivedQuantity || 0;
              
              // Calculate remaining balance in dyehouse
              // Logic: If I sent 100 and received 80, 20 is still there.
              // If I sent 100 and received 100, 0 is there.
              let remaining = sent - received;
              if (remaining < 0) remaining = 0; // Should not happen ideally

              if (remaining > 0) {
                balances[clientName][dyehouse] = (balances[clientName][dyehouse] || 0) + remaining;
              }
            }
          });
        }
      });

      // Convert to Array
      const result: BalanceEntry[] = Object.entries(balances).map(([client, dhMap]) => {
        const total = Object.values(dhMap).reduce((sum, val) => sum + val, 0);
        return {
          clientName: client,
          dyehouseBalances: dhMap,
          totalBalance: total
        };
      });

      // Sort Dyehouses alphabetically
      const sortedDyehouses = Array.from(allDyehouses).sort();

      setData(result);
      setDyehouses(sortedDyehouses);

    } catch (error) {
      console.error("Error fetching balance report:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    return data.filter(item => {
      const matchesSearch = item.clientName.toLowerCase().includes(searchTerm.toLowerCase());
      const hasBalance = !hideZeroRows || item.totalBalance > 0;
      return matchesSearch && hasBalance;
    }).sort((a, b) => b.totalBalance - a.totalBalance); // Sort by total balance descending
  }, [data, searchTerm, hideZeroRows]);

  // Calculate Column Totals
  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    dyehouses.forEach(dh => totals[dh] = 0);
    let grandTotal = 0;

    filteredData.forEach(row => {
      dyehouses.forEach(dh => {
        totals[dh] += (row.dyehouseBalances[dh] || 0);
      });
      grandTotal += row.totalBalance;
    });

    return { totals, grandTotal };
  }, [filteredData, dyehouses]);

  const exportToExcel = () => {
    const exportData = filteredData.map(row => {
      const rowData: any = { 'Client': row.clientName };
      dyehouses.forEach(dh => {
        rowData[dh] = row.dyehouseBalances[dh] || 0;
      });
      rowData['Total'] = row.totalBalance;
      return rowData;
    });

    // Add Totals Row
    const totalsRow: any = { 'Client': 'TOTAL' };
    dyehouses.forEach(dh => {
      totalsRow[dh] = columnTotals.totals[dh];
    });
    totalsRow['Total'] = columnTotals.grandTotal;
    exportData.push(totalsRow);

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dyehouse Balance");
    XLSX.writeFile(wb, "Dyehouse_Balance_Report.xlsx");
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center shrink-0">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="p-2 bg-yellow-100 text-yellow-700 rounded-lg">
            <FileBarChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Dyehouse Balance Report</h2>
            <p className="text-xs text-slate-500">Track fabric stock remaining at dyehouses</p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search clients..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-48"
            />
          </div>

          <button 
            onClick={() => setHideZeroRows(!hideZeroRows)}
            className={`p-2 rounded-lg border transition-colors ${
              hideZeroRows 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'
            }`}
            title={hideZeroRows ? "Show all clients" : "Hide clients with 0 balance"}
          >
            <Filter size={18} />
          </button>

          <button onClick={fetchData} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>

          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-bold text-slate-700 border-b border-slate-200 bg-slate-50 min-w-[200px]">
                    Client / Dyehouse
                  </th>
                  {dyehouses.map(dh => (
                    <th key={dh} className="px-4 py-3 font-bold text-slate-700 border-b border-slate-200 text-center min-w-[100px] bg-slate-50">
                      {dh}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-bold text-slate-800 border-b border-slate-200 text-center min-w-[120px] bg-yellow-50 border-l border-yellow-100">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredData.map((row) => (
                  <tr key={row.clientName} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-700 border-r border-slate-100">
                      {row.clientName}
                    </td>
                    {dyehouses.map(dh => {
                      const val = row.dyehouseBalances[dh] || 0;
                      return (
                        <td key={dh} className={`px-4 py-3 text-center font-mono border-r border-slate-100 ${val > 0 ? 'text-slate-700 font-medium' : 'text-slate-300'}`}>
                          {val > 0 ? val.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center font-bold font-mono text-slate-800 bg-yellow-50/30 border-l border-yellow-100">
                      {row.totalBalance.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 sticky bottom-0 z-10 font-bold shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                <tr>
                  <td className="px-4 py-3 text-slate-800 border-t border-slate-300">
                    TOTAL
                  </td>
                  {dyehouses.map(dh => (
                    <td key={dh} className="px-4 py-3 text-center text-slate-800 border-t border-slate-300 font-mono">
                      {columnTotals.totals[dh].toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center text-slate-900 bg-yellow-100 border-t border-yellow-200 border-l border-yellow-200 font-mono text-base">
                    {columnTotals.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
