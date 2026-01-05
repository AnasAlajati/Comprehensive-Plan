import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { CustomerSheet, OrderRow, DyeingBatch } from '../types';
import { 
  Search, 
  Filter, 
  Calendar, 
  Download, 
  RefreshCw,
  Droplets,
  Factory,
  User,
  ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface GlobalBatchItem {
  id: string;
  clientId: string;
  clientName: string;
  orderId: string;
  orderReference?: string;
  fabric: string;
  color: string;
  quantity: number;
  receivedQuantity?: number;
  dyehouse: string;
  machine: string; // Capacity
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  status: 'Pending' | 'Sent' | 'Received';
  notes?: string;
}

export const DyehouseGlobalSchedule: React.FC = () => {
  const [batches, setBatches] = useState<GlobalBatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [filterDyehouse, setFilterDyehouse] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  useEffect(() => {
    fetchGlobalData();
  }, []);

  const fetchGlobalData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Clients for Name Lookup
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        clientMap[doc.id] = data.name || 'Unknown Client';
      });

      // 2. Fetch All Orders (Subcollection)
      const ordersSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const allBatches: GlobalBatchItem[] = [];

      ordersSnapshot.docs.forEach(doc => {
        const order = { id: doc.id, ...doc.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
            order.dyeingPlan.forEach((batch, idx) => {
              const dyehouseName = order.dyehouse || 'Unassigned';
              const machineName = batch.machine || order.dyehouseMachine || '';
              
              allBatches.push({
                id: `${order.id}-${idx}`,
                clientId: clientId,
                clientName: clientName,
                orderId: order.id,
                orderReference: order.orderReference,
                fabric: order.material,
                color: batch.color,
                quantity: batch.quantity,
                receivedQuantity: batch.receivedQuantity,
                dyehouse: dyehouseName,
                machine: machineName,
                dispatchNumber: batch.dispatchNumber,
                dateSent: batch.dateSent,
                formationDate: batch.formationDate,
                status: batch.receivedQuantity ? 'Received' : (batch.dateSent ? 'Sent' : 'Pending'),
                notes: batch.notes
              });
            });
          }
      });

      setBatches(allBatches);
    } catch (error) {
      console.error("Error fetching global schedule:", error);
    } finally {
      setLoading(false);
    }
  };

  // Derived Lists for Filters
  const uniqueDyehouses = useMemo(() => Array.from(new Set(batches.map(b => b.dyehouse))).sort(), [batches]);
  const uniqueClients = useMemo(() => Array.from(new Set(batches.map(b => b.clientName))).sort(), [batches]);

  // Filtered Data
  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      const matchesSearch = 
        batch.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        batch.fabric.toLowerCase().includes(searchTerm.toLowerCase()) ||
        batch.color.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (batch.dispatchNumber && batch.dispatchNumber.includes(searchTerm));

      const matchesDyehouse = filterDyehouse === 'All' || batch.dyehouse === filterDyehouse;
      const matchesClient = filterClient === 'All' || batch.clientName === filterClient;
      const matchesStatus = filterStatus === 'All' || batch.status === filterStatus;

      return matchesSearch && matchesDyehouse && matchesClient && matchesStatus;
    });
  }, [batches, searchTerm, filterDyehouse, filterClient, filterStatus]);

  // Group by Dyehouse
  const groupedBatches = useMemo(() => {
    const groups: Record<string, GlobalBatchItem[]> = {};
    filteredBatches.forEach(batch => {
      const dh = batch.dyehouse || 'Unassigned';
      if (!groups[dh]) groups[dh] = [];
      groups[dh].push(batch);
    });
    return groups;
  }, [filteredBatches]);

  const sortedDyehouses = useMemo(() => Object.keys(groupedBatches).sort(), [groupedBatches]);

  const exportToExcel = () => {
    const data = filteredBatches.map(b => ({
      'Client': b.clientName,
      'Order Ref': b.orderReference || b.orderId,
      'Fabric': b.fabric,
      'Color': b.color,
      'Quantity (kg)': b.quantity,
      'Dyehouse': b.dyehouse,
      'Machine': b.machine,
      'Dispatch #': b.dispatchNumber,
      'Date Sent': b.dateSent,
      'Formation Date': b.formationDate,
      'Status': b.status,
      'Notes': b.notes
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dyehouse Schedule");
    XLSX.writeFile(wb, "Dyehouse_Global_Schedule.xlsx");
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search orders, colors, dispatch..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <button onClick={fetchGlobalData} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex flex-wrap gap-3 w-full md:w-auto justify-end">
          <select 
            value={filterDyehouse} 
            onChange={(e) => setFilterDyehouse(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white outline-none"
          >
            <option value="All">All Dyehouses</option>
            {uniqueDyehouses.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <select 
            value={filterClient} 
            onChange={(e) => setFilterClient(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white outline-none"
          >
            <option value="All">All Clients</option>
            {uniqueClients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Sent">Sent</option>
            <option value="Received">Received</option>
          </select>

          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
          >
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="flex justify-center py-12">
           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : sortedDyehouses.length === 0 ? (
        <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
           No batches found matching your filters.
        </div>
      ) : (
        <div className="space-y-8">
           {sortedDyehouses.map(dyehouseName => {
             const dyehouseBatches = groupedBatches[dyehouseName];
             
             // Identify Unique Machines for this Dyehouse
             const machines = Array.from(new Set(dyehouseBatches.map(b => b.machine).filter(Boolean)));
             
             // Sort Machines: Numeric descending, then string
             const sortedMachines = machines.sort((a, b) => {
                 const numA = parseInt(a.replace(/\D/g, '')) || 0;
                 const numB = parseInt(b.replace(/\D/g, '')) || 0;
                 if (numA !== numB) return numB - numA; // Descending
                 return a.localeCompare(b);
             });

             // Calculate Counts per Machine
             const machineCounts: Record<string, number> = {};
             sortedMachines.forEach(m => {
                 machineCounts[m] = dyehouseBatches.filter(b => b.machine === m).length;
             });

             return (
             <div key={dyehouseName} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                {/* Dyehouse Header */}
                <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-700 rounded-lg border border-slate-600 shadow-sm">
                         <Factory className="text-indigo-400 w-5 h-5" />
                      </div>
                      <div>
                         <h3 className="font-bold text-lg text-white">{dyehouseName}</h3>
                         <p className="text-xs text-slate-400">{dyehouseBatches.length} Active Batches</p>
                      </div>
                   </div>
                   <div className="text-sm font-medium text-slate-300 bg-slate-700 px-3 py-1 rounded-full border border-slate-600">
                      Total: {dyehouseBatches.reduce((sum, b) => sum + (b.quantity || 0), 0).toLocaleString()} kg
                   </div>
                </div>

                {/* Matrix Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead>
                            {/* Row 1: Machine Counts */}
                            <tr className="bg-indigo-50/50 border-b border-indigo-100">
                                {sortedMachines.map(m => (
                                    <th key={m} className="px-2 py-2 text-center border-r border-indigo-100 w-16">
                                        <span className="text-xs font-bold text-indigo-600">{machineCounts[m]}</span>
                                    </th>
                                ))}
                                <th colSpan={11} className="px-4 py-2 bg-slate-50"></th>
                            </tr>
                            {/* Row 2: Headers */}
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold">
                                {sortedMachines.map(m => (
                                    <th key={m} className="px-2 py-3 text-center border-r border-slate-200 w-16 bg-indigo-50 text-indigo-700">
                                        {m}
                                    </th>
                                ))}
                                <th className="px-4 py-3 w-20 text-center">Waste %</th>
                                <th className="px-4 py-3 w-24 text-right">Remaining</th>
                                <th className="px-4 py-3 w-24 text-right">Received</th>
                                <th className="px-4 py-3 w-24 text-right">Quantity</th>
                                <th className="px-4 py-3 w-32">Customer</th>
                                <th className="px-4 py-3 w-32">Color</th>
                                <th className="px-4 py-3 w-48">Item</th>
                                <th className="px-4 py-3 w-24 text-center">Days (Form)</th>
                                <th className="px-4 py-3 w-24 text-center">Formation</th>
                                <th className="px-4 py-3 w-24 text-center">Days (Dye)</th>
                                <th className="px-4 py-3 w-24 text-center">Date</th>
                                <th className="px-4 py-3 w-32 text-right">Dispatch #</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {dyehouseBatches.map((batch) => {
                                const daysInDye = batch.dateSent ? Math.floor((new Date().getTime() - new Date(batch.dateSent).getTime()) / (1000 * 3600 * 24)) : 0;
                                const remaining = batch.quantity - (batch.receivedQuantity || 0);
                                
                                return (
                                <tr key={batch.id} className="hover:bg-slate-50/80 transition-colors">
                                    {/* Machine Columns */}
                                    {sortedMachines.map(m => (
                                        <td key={m} className="px-2 py-3 text-center border-r border-slate-100 bg-indigo-50/10">
                                            {batch.machine === m && (
                                                <span className="inline-block w-2 h-2 rounded-full bg-indigo-600"></span>
                                            )}
                                        </td>
                                    ))}
                                    
                                    {/* Data Columns */}
                                    <td className="px-4 py-3 text-center text-slate-400">-</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{remaining > 0 ? remaining.toLocaleString() : '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono text-emerald-600">{batch.receivedQuantity ? batch.receivedQuantity.toLocaleString() : '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">{batch.quantity.toLocaleString()}</td>
                                    <td className="px-4 py-3 font-medium text-slate-700">{batch.clientName}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300"></div>
                                            <span className="text-slate-700">{batch.color}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 text-xs">{batch.fabric}</td>
                                    <td className="px-4 py-3 text-center text-slate-500">-</td>
                                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{batch.formationDate || '-'}</td>
                                    <td className="px-4 py-3 text-center font-mono text-slate-600">{daysInDye > 0 ? daysInDye : '-'}</td>
                                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{batch.dateSent || '-'}</td>
                                    <td className="px-4 py-3 text-right">
                                        {batch.dispatchNumber ? (
                                            <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded text-xs">
                                                {batch.dispatchNumber}
                                            </span>
                                        ) : '-'}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
             </div>
             );
           })}
        </div>
      )}
    </div>
  );
};
