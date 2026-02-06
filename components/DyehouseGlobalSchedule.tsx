import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { CustomerSheet, OrderRow, DyeingBatch, FabricDefinition } from '../types';
import { 
  Search, 
  Filter, 
  Calendar, 
  Download, 
  Upload,
  RefreshCw,
  Droplets,
  Factory,
  User,
  ArrowRight
} from 'lucide-react';
import XLSX from 'xlsx-js-style';
import { DyehouseImportModal } from './DyehouseImportModal';

interface GlobalBatchItem {
  id: string;
  clientId: string;
  clientName: string;
  orderId: string;
  orderReference?: string;
  fabric: string;
  fabricShortName?: string;
  fabricImageUrl?: string;
  color: string;
  colorHex?: string;
  quantity: number;
  quantitySent?: number;
  quantitySentRaw?: number;
  quantitySentAccessory?: number;
  receivedQuantity?: number;
  totalReceived?: number;
  dyehouse: string;
  machine: string; // Capacity
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  status: 'Draft' | 'Pending' | 'Sent' | 'Received';
  rawStatus?: 'draft' | 'pending' | 'sent' | 'received';
  notes?: string;
  accessoryType?: string;
}

export const DyehouseGlobalSchedule: React.FC = () => {
  const [batches, setBatches] = useState<GlobalBatchItem[]>([]);
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [filterDyehouse, setFilterDyehouse] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [filterStatus, setFilterStatus] = useState('Sent');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    fetchGlobalData();
  }, []);

  const fetchGlobalData = async () => {
    setLoading(true);
    try {
      // 0. Fetch Dyehouses Directory (Authoritative List)
      const dyehousesSnapshot = await getDocs(collection(db, 'dyehouses'));
      const dyehouseList = dyehousesSnapshot.docs.map(doc => doc.data().name).sort();
      setAllDyehouses(dyehouseList);

      // 1. Fetch Clients for Name Lookup
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        clientMap[doc.id] = data.name || 'Unknown Client';
      });

      // 1b. Fetch Fabrics for shortName and image Lookup
      const fabricsSnapshot = await getDocs(collection(db, 'fabrics'));
      const fabricMap: Record<string, { shortName: string; imageUrl?: string }> = {};
      fabricsSnapshot.docs.forEach(doc => {
        const data = doc.data() as FabricDefinition;
        fabricMap[data.name] = { 
          shortName: data.shortName || data.name,
          imageUrl: data.imageUrl
        };
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
              // Calculate total received from events
              const receiveEvents = batch.receiveEvents || [];
              const totalReceivedRaw = receiveEvents.reduce((s, e) => s + (e.quantityRaw || 0), 0) + (batch.receivedQuantity || 0);
              const totalReceivedAccessory = receiveEvents.reduce((s, e) => s + (e.quantityAccessory || 0), 0);
              const totalReceived = totalReceivedRaw + totalReceivedAccessory;
              
              // Calculate total sent from events or legacy fields
              const sentEvents = batch.sentEvents || [];
              const totalSentFromEvents = sentEvents.reduce((s, e) => s + (e.quantity || 0) + (e.accessorySent || 0), 0);
              const totalSentLegacy = (batch.quantitySentRaw || batch.quantitySent || 0) + (batch.quantitySentAccessory || 0);
              const totalSent = totalSentFromEvents > 0 ? totalSentFromEvents : totalSentLegacy;
              
              // Determine batch status (use stored status or calculate)
              const batchStatus = batch.status || 
                (totalSent > 0 && totalReceived / totalSent >= 0.89 ? 'received' : 
                 (batch.dateSent ? 'sent' : 
                  (batch.color && batch.quantity && batch.dyehouse && batch.plannedCapacity ? 'pending' : 'draft')));
              
              // Smart Dyehouse Display Logic
              const dyehouseName = batch.dyehouse || 
                                   (batch.colorApprovals && batch.colorApprovals.length > 0 ? batch.colorApprovals[0].dyehouseName : '') || 
                                   order.dyehouse || 
                                   'Unassigned';

              const machineName = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || order.dyehouseMachine || '');
              
              // Get fabric shortname and image - prefer from fabrics collection, fallback to parseFabricName
              const fabricInfo = fabricMap[order.material];
              const fabricShortName = fabricInfo?.shortName || parseFabricName(order.material).shortName || order.material;
              const fabricImageUrl = fabricInfo?.imageUrl;
              
              allBatches.push({
                id: `${order.id}-${idx}`,
                clientId: clientId,
                clientName: clientName,
                orderId: order.id,
                orderReference: order.orderReference,
                fabric: order.material,
                fabricShortName: fabricShortName,
                fabricImageUrl: fabricImageUrl,
                color: batch.color,
                colorHex: batch.colorHex,
                quantity: batch.quantity,
                quantitySent: totalSent,
                quantitySentRaw: batch.quantitySentRaw || batch.quantitySent,
                quantitySentAccessory: batch.quantitySentAccessory,
                receivedQuantity: batch.receivedQuantity,
                totalReceived: totalReceived,
                dyehouse: dyehouseName,
                machine: machineName,
                dispatchNumber: batch.dispatchNumber,
                dateSent: batch.dateSent,
                formationDate: batch.formationDate,
                status: batchStatus === 'received' ? 'Received' : 
                        batchStatus === 'sent' ? 'Sent' : 
                        batchStatus === 'pending' ? 'Pending' : 'Draft' as any,
                notes: batch.notes,
                rawStatus: batchStatus, // Keep original status for filtering
                accessoryType: batch.accessoryType
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
  // const uniqueDyehouses = useMemo(() => Array.from(new Set(batches.map(b => b.dyehouse))).sort(), [batches]); // Replaced by allDyehouses
  const uniqueClients = useMemo(() => Array.from(new Set(batches.map(b => b.clientName))).sort(), [batches]);

  // Filtered Data - Exclude drafts by default unless includeDrafts is true
  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      // Filter out drafts unless explicitly included
      if (!includeDrafts && (batch.rawStatus === 'draft' || batch.status === 'Draft')) {
        return false;
      }
      
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
  }, [batches, searchTerm, filterDyehouse, filterClient, filterStatus, includeDrafts]);

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
    const wb = XLSX.utils.book_new();
    wb.Workbook = {
        Views: [{ RTL: true }]
    };

    // Styles
    const baseStyle = { 
        font: { name: "Calibri", sz: 12 },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
        }
    };

    const headerStyle = {
        ...baseStyle,
        fill: { fgColor: { rgb: "B4C6E7" } }, // Blue-ish
        font: { ...baseStyle.font, bold: true }
    };
    
    // Headers colored specifically
    const headerGreenStyle = { ...headerStyle, fill: { fgColor: { rgb: "C6E0B4" } } }; // Received
    const headerDarkGreenStyle = { ...headerStyle, fill: { fgColor: { rgb: "548235" } }, font: { ...headerStyle.font, color: { rgb: "FFFFFF" } } }; // Remaining (Total only?)
    const headerPinkStyle = { ...headerStyle, fill: { fgColor: { rgb: "F8CBAD" } } }; // Wastage
    
    // Column Styles
    const yellowStyle = { ...baseStyle, fill: { fgColor: { rgb: "FFFF00" } } }; // Dispatch #
    const lightGreenStyle = { ...baseStyle, fill: { fgColor: { rgb: "E2EFDA" } } }; // Received
    const lightBlueStyle = { ...baseStyle, fill: { fgColor: { rgb: "DDEBF7" } } }; // Remaining
    const pinkStyle = { ...baseStyle, fill: { fgColor: { rgb: "FCE4D6" } } }; // Wastage
    const whiteStyle = { ...baseStyle };
    const machineAssignedStyle = { ... baseStyle, font: { bold: true }, fill: { fgColor: { rgb: "FFFFFF" } } }; // Just bold 1

    // Helper to format date consistent with image (YYYY-MM-DD)
    const extractDate = (dateStr?: string) => {
        if (!dateStr) return '';
        return new Date(dateStr).toISOString().split('T')[0];
    };

    if (sortedDyehouses.length === 0) {
        alert("No data to export");
        return;
    }

    sortedDyehouses.forEach(dyehouseName => {
        const batches = groupedBatches[dyehouseName];
        if (!batches || batches.length === 0) return;

        // 1. Identify Machines
        const machines: string[] = Array.from(new Set(batches.map(b => b.machine).filter((m): m is string => !!m)));
        // Sort Machines: Numeric descending (capacity), then string
        const sortedMachines: string[] = machines.sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            if (numA !== numB) return numB - numA; // Descending
            return a.localeCompare(b);
        });

        const machineCounts: Record<string, number> = {};
        sortedMachines.forEach(m => {
            machineCounts[m] = batches.filter(b => b.machine === m).length;
        });

        // 2. Prepare Data Rows
        // Columns Order (Adjusted for RTL - Column A is First in Array):
        // Dispatch | Date Sent | Days Raw | Formation Date | Days Form | Item | Color | Client | Quantity | Received | Remaining | Wastage | Machines...

        const dataRows = batches.map(batch => {
            const sentQty = batch.quantitySent || 0;
            const receivedQty = batch.receivedQuantity || 0;
            const remaining = sentQty - receivedQty;
            
            // Days calculations
            const daysRaw = batch.dateSent 
                ? Math.floor((new Date().getTime() - new Date(batch.dateSent).getTime()) / (1000 * 3600 * 24)) 
                : '';
            const daysFormation = batch.formationDate
                ? Math.floor((new Date().getTime() - new Date(batch.formationDate).getTime()) / (1000 * 3600 * 24))
                : '';

            const row: any[] = [];
            
            // Fixed Columns (Values) - REORDERED
            row.push({ v: batch.dispatchNumber || '', s: yellowStyle }); // Dispatch # (Col A)
            row.push({ v: extractDate(batch.dateSent), s: whiteStyle }); // Date Sent (Col B)
            row.push({ v: daysRaw, s: whiteStyle }); // Days Raw
            row.push({ v: extractDate(batch.formationDate), s: whiteStyle }); // Formation Date
            row.push({ v: daysFormation, s: whiteStyle }); // Days Formation
            row.push({ v: batch.fabricShortName || batch.fabric, s: { ...whiteStyle, alignment: { horizontal: "right", vertical: "center" } } }); // Item
            row.push({ v: batch.color, s: whiteStyle }); // Color
            row.push({ v: batch.clientName, s: whiteStyle }); // Client
            row.push({ v: sentQty, s: whiteStyle }); // Quantity
            row.push({ v: receivedQty, s: lightGreenStyle }); // Received
            row.push({ v: remaining, s: lightBlueStyle }); // Remaining
            row.push({ v: "100%", s: pinkStyle }); // Wastage Percentage

             // Machines (at the end of array -> Left side in RTL)
            sortedMachines.forEach(m => {
               row.push({ v: batch.machine === m ? 1 : '', s: machineAssignedStyle }); 
            });

            return row;
        });

        // 3. Calculate Totals for Header
        const totalRemaining = batches.reduce((sum, b) => sum + ((b.quantitySent || 0) - (b.receivedQuantity || 0)), 0);
        const totalReceived = batches.reduce((sum, b) => sum + (b.receivedQuantity || 0), 0);
        const totalQuantity = batches.reduce((sum, b) => sum + (b.quantitySent || 0), 0);

        // 4. Construct Header Rows
        const totalCols = sortedMachines.length + 12; // 12 fixed columns

        // Header 1 (Title)
        const headerRow1 = [{ v: dyehouseName, s: { ...headerStyle, font: { sz: 14, bold: true }, fill: { fgColor: { rgb: "FFFFFF" } } } }];
        for(let i=1; i<totalCols; i++) headerRow1.push({ v: "", s: headerStyle }); // Fill merge area
        
        // Header 2 (Totals & Counts)
        const headerRow2: any[] = [];
        // Spacers / Totals for fixed columns
        headerRow2.push({ v: "", s: headerStyle }); // Dispatch
        headerRow2.push({ v: extractDate(new Date().toISOString()), s: headerStyle }); // Date (Today)
        headerRow2.push({ v: "", s: headerStyle }); // Days Raw
        headerRow2.push({ v: "", s: headerStyle }); // Formation Date
        headerRow2.push({ v: "", s: headerStyle }); // Days Form
        headerRow2.push({ v: "", s: headerStyle }); // Item
        headerRow2.push({ v: "", s: headerStyle }); // Color
        headerRow2.push({ v: "", s: headerStyle }); // Client
        headerRow2.push({ v: totalQuantity, s: { ...headerStyle, fill: { fgColor: { rgb: "D9E1F2" } } } }); // Total Qty
        headerRow2.push({ v: totalReceived, s: { ...headerStyle, fill: { fgColor: { rgb: "DDEBF7" } } } }); // Total Received
        headerRow2.push({ v: totalRemaining, s: headerDarkGreenStyle }); // Total Remaining
        headerRow2.push({ v: "", s: headerPinkStyle }); // Wastage
        
        // Machine Counts
        sortedMachines.forEach(m => headerRow2.push({ v: machineCounts[m], s: headerStyle })); 

        // Header 3 (Labels)
        const headerRow3: any[] = [];
        headerRow3.push({ v: "الرساله", s: headerStyle });
        headerRow3.push({ v: "التاريخ", s: headerStyle }); 
        headerRow3.push({ v: "عدد ايام وجود الخام بالمصبغة", s: headerStyle });
        headerRow3.push({ v: "التشكيل", s: headerStyle });
        headerRow3.push({ v: "عدد الايام بعد التشكيل", s: headerStyle });
        headerRow3.push({ v: "الصنف", s: headerStyle });
        headerRow3.push({ v: "اللون", s: headerStyle });
        headerRow3.push({ v: "العميل", s: headerStyle });
        headerRow3.push({ v: "الكمية", s: headerStyle });
        headerRow3.push({ v: "المستلم", s: headerGreenStyle }); 
        headerRow3.push({ v: "المتبقي", s: { ...headerStyle, fill: { fgColor: { rgb: "C6E0B4" } } } });
        headerRow3.push({ v: "نسبة الهالك", s: headerPinkStyle });
        
        sortedMachines.forEach(m => headerRow3.push({ v: m, s: headerStyle }));

        // Combine
        const wsData = [
            headerRow1,
            headerRow2,
            headerRow3,
            ...dataRows
        ];

        // 5. Create Sheet
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 6. Set Merges (Title Row)
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

        // 7. Set Column Widths
        const wscols = [];
        // Fixed Cols
        wscols.push({ wch: 12 }); // Dispatch (A)
        wscols.push({ wch: 12 }); // Date Sent (B)
        wscols.push({ wch: 10 }); // Days Raw (C)
        wscols.push({ wch: 12 }); // Formation Date (D)
        wscols.push({ wch: 10 }); // Days Form (E)
        wscols.push({ wch: 40 }); // Item (F)
        wscols.push({ wch: 15 }); // Color (G)
        wscols.push({ wch: 15 }); // Client (H)
        wscols.push({ wch: 10 }); // Qty (I)
        wscols.push({ wch: 10 }); // Received (J)
        wscols.push({ wch: 10 }); // Remaining (K)
        wscols.push({ wch: 8 });  // Wastage (L)
        
        // Machine cols
        for(let i=0; i<sortedMachines.length; i++) wscols.push({ wch: 6 });

        ws['!cols'] = wscols;

        // 8. Set RTL View
        if (!ws['!views']) ws['!views'] = [];
        ws['!views'].push({ rightToLeft: true });

        // Add sheet
        // Sanitize sheet name
        const safeName = dyehouseName.replace(/[:\/?*\[\]\\]/g, "").substring(0, 31) || "Sheet";
        XLSX.utils.book_append_sheet(wb, ws, safeName);
    });

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
            {allDyehouses.map(d => <option key={d} value={d}>{d}</option>)}
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
            <option value="Draft">Draft</option>
            <option value="Pending">Pending</option>
            <option value="Sent">Sent</option>
            <option value="Received">Received</option>
          </select>

          {/* Include Drafts Toggle */}
          <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={includeDrafts}
              onChange={(e) => setIncludeDrafts(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-slate-600">اظهار المسودات</span>
          </label>

          <button 
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Upload size={16} />
            Import
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
             const machines: string[] = Array.from(new Set(dyehouseBatches.map(b => b.machine).filter((m): m is string => !!m)));
             
             // Sort Machines: Numeric descending, then string
             const sortedMachines: string[] = machines.sort((a, b) => {
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
                      Total: {dyehouseBatches.reduce((sum, b) => {
                        const sent = b.quantitySent || 0;
                        const received = b.totalReceived || 0;
                        const remaining = Math.max(0, sent - received);
                        return sum + remaining;
                      }, 0).toLocaleString()} kg
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
                                <th colSpan={12} className="px-4 py-2 bg-slate-50"></th>
                            </tr>
                            {/* Row 2: Headers */}
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold" dir="rtl">
                                {sortedMachines.map(m => (
                                    <th key={m} className="px-2 py-3 text-center border-r border-slate-200 w-16 bg-indigo-50 text-indigo-700">
                                        {m}
                                    </th>
                                ))}
                                <th className="px-4 py-3 w-20 text-center">الحالة</th>
                                <th className="px-4 py-3 w-20 text-center">هالك %</th>
                                <th className="px-4 py-3 w-24 text-center">متبقي</th>
                                <th className="px-4 py-3 w-24 text-center">مستلم</th>
                                <th className="px-4 py-3 w-24 text-center">مرسل</th>
                                <th className="px-4 py-3 w-32 text-right">العميل</th>
                                <th className="px-4 py-3 w-32 text-right">اللون</th>
                                <th className="px-4 py-3 w-48 text-right">الصنف</th>
                                <th className="px-4 py-3 w-28 text-center">ايام بعد التشكيل</th>
                                <th className="px-4 py-3 w-24 text-center">تاريخ التشكيل</th>
                                <th className="px-4 py-3 w-28 text-center">ايام بعد الارسال</th>
                                <th className="px-4 py-3 w-24 text-center">تاريخ الارسال</th>
                                <th className="px-4 py-3 w-32 text-center">رقم الاذن</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {dyehouseBatches.map((batch) => {
                                const daysAfterSent = batch.dateSent ? Math.floor((new Date().getTime() - new Date(batch.dateSent).getTime()) / (1000 * 3600 * 24)) : 0;
                                const daysAfterFormation = batch.formationDate ? Math.floor((new Date().getTime() - new Date(batch.formationDate).getTime()) / (1000 * 3600 * 24)) : 0;
                                const sentQty = batch.quantitySent || 0;
                                const receivedQty = batch.totalReceived || batch.receivedQuantity || 0;
                                const remaining = sentQty - receivedQty;
                                
                                // Format date to "12-Jan" format
                                const formatDate = (dateStr?: string) => {
                                    if (!dateStr) return '-';
                                    const date = new Date(dateStr);
                                    const day = date.getDate();
                                    const month = date.toLocaleString('en-US', { month: 'short' });
                                    return `${day}-${month}`;
                                };
                                
                                // Status styling
                                const statusConfig = {
                                    'Draft': { label: 'مسودة', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
                                    'Pending': { label: 'مخطط', bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
                                    'Sent': { label: 'مرسل', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
                                    'Received': { label: 'مستلم', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' }
                                };
                                const statusStyle = statusConfig[batch.status] || statusConfig['Pending'];
                                
                                return (
                                <tr key={batch.id} className="hover:bg-slate-50/80 transition-colors" dir="rtl">
                                    {/* Machine Columns */}
                                    {sortedMachines.map(m => (
                                        <td key={m} className="px-2 py-3 text-center border-r border-slate-100 bg-indigo-50/10">
                                            {batch.machine === m && (
                                                <span className="inline-block w-2 h-2 rounded-full bg-indigo-600"></span>
                                            )}
                                        </td>
                                    ))}
                                    
                                    {/* Status Column */}
                                    <td className="px-2 py-3 text-center">
                                        <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                                            {statusStyle.label}
                                        </span>
                                    </td>
                                    
                                    {/* Data Columns */}
                                    <td className="px-4 py-3 text-center text-slate-400">-</td>
                                    <td className="px-4 py-3 text-center font-mono text-slate-600">{remaining > 0 ? remaining.toLocaleString() : '-'}</td>
                                    <td className="px-4 py-3 text-center font-mono text-emerald-600">{receivedQty > 0 ? receivedQty.toLocaleString() : '-'}</td>
                                    <td className="px-4 py-3 text-center font-mono font-bold text-blue-600">{sentQty > 0 ? sentQty.toLocaleString() : '-'}</td>
                                    <td className="px-4 py-3 font-medium text-slate-700 text-right">{batch.clientName}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="text-slate-700">{batch.color}</span>
                                            <div 
                                                className="w-4 h-4 rounded-full border border-slate-300 shadow-sm"
                                                style={{ backgroundColor: batch.colorHex || '#e2e8f0' }}
                                                title={batch.colorHex || 'No color set'}
                                            ></div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {batch.fabricImageUrl && (
                                                <img 
                                                    src={batch.fabricImageUrl} 
                                                    alt={batch.fabricShortName}
                                                    className="w-8 h-8 object-cover rounded border border-slate-200 shadow-sm"
                                                />
                                            )}
                                            <span className="text-slate-600 text-xs font-medium">{batch.fabricShortName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center font-mono text-amber-600">{daysAfterFormation > 0 ? daysAfterFormation : '-'}</td>
                                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{formatDate(batch.formationDate)}</td>
                                    <td className="px-4 py-3 text-center font-mono text-slate-600">{daysAfterSent > 0 ? daysAfterSent : '-'}</td>
                                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{formatDate(batch.dateSent)}</td>
                                    <td className="px-4 py-3 text-center">
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

      <DyehouseImportModal 
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        dyehouses={allDyehouses}
        onImportComplete={() => {
            setShowImportModal(false);
            fetchGlobalData();
        }}
      />
    </div>
  );
};
