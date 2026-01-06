import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { OrderRow, CustomerSheet, FabricDefinition } from '../types';
import { 
  Search, 
  Download, 
  RefreshCw,
  FileBarChart,
  Filter,
  X,
  Package,
  Calendar,
  User,
  ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Detail item for breakdown
interface BalanceDetailItem {
  clientName: string;
  orderId: string;
  fabric: string;
  fabricShortName: string;
  color: string;
  dyehouse: string;
  sent: number;
  received: number;
  remaining: number;
  dateSent?: string;
  dispatchNumber?: string;
}

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
  
  // Store all detail items for drill-down
  const [allDetails, setAllDetails] = useState<BalanceDetailItem[]>([]);
  
  // Modal state for showing breakdown
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    title: string;
    items: BalanceDetailItem[];
    type: 'cell' | 'clientTotal' | 'dyehouseTotal' | 'grandTotal';
  } | null>(null);

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

      // 1b. Fetch Fabrics for shortName Lookup
      const fabricsSnapshot = await getDocs(collection(db, 'fabrics'));
      const fabricMap: Record<string, string> = {};
      fabricsSnapshot.docs.forEach(doc => {
        const data = doc.data() as FabricDefinition;
        fabricMap[data.name] = data.shortName || data.name;
      });

      // 2. Fetch All Orders
      const ordersSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      
      const balances: Record<string, Record<string, number>> = {}; // Client -> Dyehouse -> Amount
      const allDyehouses = new Set<string>();
      const detailItems: BalanceDetailItem[] = [];

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
              let remaining = sent - received;
              if (remaining < 0) remaining = 0;

              if (remaining > 0) {
                balances[clientName][dyehouse] = (balances[clientName][dyehouse] || 0) + remaining;
                
                // Store detail item
                detailItems.push({
                  clientName,
                  orderId: order.id,
                  fabric: order.material,
                  fabricShortName: fabricMap[order.material] || order.material,
                  color: batch.color,
                  dyehouse,
                  sent,
                  received,
                  remaining,
                  dateSent: batch.dateSent,
                  dispatchNumber: batch.dispatchNumber
                });
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
      setAllDetails(detailItems);

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

  // Click handlers for drill-down
  const handleCellClick = (clientName: string, dyehouse: string, value: number) => {
    if (value <= 0) return;
    const items = allDetails.filter(d => d.clientName === clientName && d.dyehouse === dyehouse);
    setDetailModal({
      isOpen: true,
      title: `${clientName} → ${dyehouse}`,
      items,
      type: 'cell'
    });
  };

  const handleClientTotalClick = (clientName: string, totalValue: number) => {
    if (totalValue <= 0) return;
    const items = allDetails.filter(d => d.clientName === clientName);
    setDetailModal({
      isOpen: true,
      title: `${clientName} - Total Balance`,
      items,
      type: 'clientTotal'
    });
  };

  const handleDyehouseTotalClick = (dyehouse: string, totalValue: number) => {
    if (totalValue <= 0) return;
    const items = allDetails.filter(d => d.dyehouse === dyehouse);
    setDetailModal({
      isOpen: true,
      title: `${dyehouse} - Total Balance`,
      items,
      type: 'dyehouseTotal'
    });
  };

  const handleGrandTotalClick = () => {
    if (columnTotals.grandTotal <= 0) return;
    setDetailModal({
      isOpen: true,
      title: 'Grand Total - All Balances',
      items: allDetails,
      type: 'grandTotal'
    });
  };

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
                        <td 
                          key={dh} 
                          className={`px-4 py-3 text-center font-mono border-r border-slate-100 ${
                            val > 0 
                              ? 'text-slate-700 font-medium cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 transition-colors' 
                              : 'text-slate-300'
                          }`}
                          onClick={() => handleCellClick(row.clientName, dh, val)}
                        >
                          {val > 0 ? val.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
                        </td>
                      );
                    })}
                    <td 
                      className="px-4 py-3 text-center font-bold font-mono text-slate-800 bg-yellow-50/30 border-l border-yellow-100 cursor-pointer hover:bg-yellow-100 transition-colors"
                      onClick={() => handleClientTotalClick(row.clientName, row.totalBalance)}
                    >
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
                    <td 
                      key={dh} 
                      className="px-4 py-3 text-center text-slate-800 border-t border-slate-300 font-mono cursor-pointer hover:bg-indigo-100 hover:text-indigo-800 transition-colors"
                      onClick={() => handleDyehouseTotalClick(dh, columnTotals.totals[dh])}
                    >
                      {columnTotals.totals[dh].toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  ))}
                  <td 
                    className="px-4 py-3 text-center text-slate-900 bg-yellow-100 border-t border-yellow-200 border-l border-yellow-200 font-mono text-base cursor-pointer hover:bg-yellow-200 transition-colors"
                    onClick={handleGrandTotalClick}
                  >
                    {columnTotals.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Detail Breakdown Modal */}
      {detailModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-slate-50 rounded-t-xl">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Package className="w-5 h-5 text-indigo-600" />
                  {detailModal.title}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {detailModal.items.length} batch{detailModal.items.length !== 1 ? 'es' : ''} • 
                  Total: <span className="font-bold text-indigo-600">
                    {detailModal.items.reduce((sum, i) => sum + i.remaining, 0).toLocaleString()} kg
                  </span>
                </p>
              </div>
              <button 
                onClick={() => setDetailModal(null)}
                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              {/* Summary Cards */}
              {(detailModal.type === 'dyehouseTotal' || detailModal.type === 'grandTotal') && (
                <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(() => {
                    // Group by client for totals
                    const byClient: Record<string, number> = {};
                    detailModal.items.forEach(item => {
                      byClient[item.clientName] = (byClient[item.clientName] || 0) + item.remaining;
                    });
                    return Object.entries(byClient)
                      .sort((a, b) => b[1] - a[1])
                      .map(([client, amount]) => (
                        <div key={client} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                          <div className="text-xs text-slate-500 font-medium">{client}</div>
                          <div className="text-lg font-bold text-slate-800">{amount.toLocaleString()} kg</div>
                        </div>
                      ));
                  })()}
                </div>
              )}

              {/* Detail Table */}
              <table className="w-full text-sm border-collapse">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-xs uppercase text-slate-500 font-semibold">
                    {(detailModal.type === 'dyehouseTotal' || detailModal.type === 'grandTotal') && (
                      <th className="px-3 py-2 text-left">Client</th>
                    )}
                    {(detailModal.type === 'clientTotal' || detailModal.type === 'grandTotal') && (
                      <th className="px-3 py-2 text-left">Dyehouse</th>
                    )}
                    <th className="px-3 py-2 text-left">Fabric</th>
                    <th className="px-3 py-2 text-left">Color</th>
                    <th className="px-3 py-2 text-center">Sent</th>
                    <th className="px-3 py-2 text-center">Received</th>
                    <th className="px-3 py-2 text-center bg-indigo-50 text-indigo-700">Remaining</th>
                    <th className="px-3 py-2 text-left">Date Sent</th>
                    <th className="px-3 py-2 text-left">Dispatch #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailModal.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      {(detailModal.type === 'dyehouseTotal' || detailModal.type === 'grandTotal') && (
                        <td className="px-3 py-2 font-medium text-slate-700">{item.clientName}</td>
                      )}
                      {(detailModal.type === 'clientTotal' || detailModal.type === 'grandTotal') && (
                        <td className="px-3 py-2 text-slate-600">{item.dyehouse}</td>
                      )}
                      <td className="px-3 py-2 text-slate-700 font-medium">{item.fabricShortName}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs">
                          {item.color}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-blue-600">{item.sent}</td>
                      <td className="px-3 py-2 text-center font-mono text-emerald-600">{item.received}</td>
                      <td className="px-3 py-2 text-center font-mono font-bold text-indigo-700 bg-indigo-50/50">
                        {item.remaining}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">
                        {item.dateSent || '-'}
                      </td>
                      <td className="px-3 py-2">
                        {item.dispatchNumber ? (
                          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                            {item.dispatchNumber}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-bold">
                  <tr>
                    <td colSpan={(detailModal.type === 'grandTotal' ? 4 : detailModal.type === 'cell' ? 2 : 3)} className="px-3 py-2 text-slate-700">
                      Total
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-blue-700">
                      {detailModal.items.reduce((sum, i) => sum + i.sent, 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-emerald-700">
                      {detailModal.items.reduce((sum, i) => sum + i.received, 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center font-mono font-bold text-indigo-800 bg-indigo-100">
                      {detailModal.items.reduce((sum, i) => sum + i.remaining, 0).toLocaleString()}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>

              {/* Calculation Explanation */}
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <div className="font-semibold mb-1">📊 How is this calculated?</div>
                <div className="text-amber-700">
                  <strong>Remaining Balance</strong> = Sent (مرسل) - Received (مستلم)
                  <br />
                  <span className="text-xs">Only batches that have been sent to the dyehouse are included.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
