import React, { useState, useEffect, useMemo } from 'react';
import { doc, updateDoc, arrayUnion, deleteField, getDocs, collection, onSnapshot, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { MachineRow, CustomerSheet, OrderRow, FabricDefinition, MachineStatus, OrderFabric, YarnInventoryItem } from '../types';
import { Wrench, Search, Calendar, Plus, History, AlertCircle, Briefcase, X, ArrowRight, Layers, User, Clock, CheckCircle2 } from 'lucide-react';
import { MachineMaintenanceModal } from './MachineMaintenanceModal';

// Helper to calculate end date based on remaining quantity and daily production
const calculateEndDate = (remaining: number, dayProduction: number): string => {
  if (!dayProduction || dayProduction <= 0 || !remaining || remaining <= 0) return '-';
  const daysNeeded = Math.ceil(remaining / dayProduction);
  const startDate = new Date(); // Use today as start
  startDate.setDate(startDate.getDate() + daysNeeded);
  // Format: "13-Jan"
  const dateStr = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return dateStr.replace(' ', '-');
};

interface MaintenancePageProps {
  machines: MachineRow[];
}

// Local helper type for flattening the efficient search structure
interface FlattenedOrder {
  clientName: string;
  order: OrderRow;
}

export const MaintenancePage: React.FC<MaintenancePageProps> = ({ machines: initialMachines }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [maintenanceMachine, setMaintenanceMachine] = useState<MachineRow | null>(null);
  const [maintenanceInitialView, setMaintenanceInitialView] = useState<'form' | 'history'>('form');
  
  // Internal Machine State (Source of Truth)
  const [machines, setMachines] = useState<MachineRow[]>(initialMachines);

  const activeDate = useMemo(() => {
    if (machines.length === 0) return null;
    const dates = machines
      .map(m => m.lastLogDate)
      .filter((d): d is string => !!d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return dates.length > 0 ? dates[0] : null;
  }, [machines]);

  // Job View State
  const [showJobsView, setShowJobsView] = useState(false);
  const [viewingJob, setViewingJob] = useState<MachineRow | null>(null); // Still useful for details if needed
  const [activeOrders, setActiveOrders] = useState<FlattenedOrder[]>([]);
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [yarnMap, setYarnMap] = useState<Record<string, string>>({}); // id -> name
  const [lotMap, setLotMap] = useState<Record<string, string>>({}); // Lot -> name

  useEffect(() => {
    // 1. Fetch Context (Orders/Fabrics/Yarns)
    fetchContextData();

    // 2. Subscribe to MachineSS directly to get REAL-TIME status ignoring App.tsx date filters
    const unsubMachines = onSnapshot(collection(db, 'MachineSS'), (snapshot) => {
       const mappedMachines = snapshot.docs.map(doc => {
          const data = doc.data();
          // Prioritize lastLogData for status if available (Latest Snapshot)
          const activeLog = data.lastLogData || {};
          
          return {
             id: doc.id,
             firestoreId: doc.id,
             ...data,
             machineName: data.name || data.machineName || '', // Fix: Map name to machineName
             brand: data.brand || '', // Ensure brand is mapped
             // Ensure status reflects the LAST LOGGED state, not "No Order" from a date mismatch
             status: activeLog.status || data.status || MachineStatus.NO_ORDER,
             client: activeLog.client || data.client || '',
             material: activeLog.fabric || data.material || '',
             lastLogDate: data.lastLogDate || activeLog.date || null
          } as MachineRow;
       });
       // Sort by logic if needed (usually alphabetical or numeric ID)
       const sorted = mappedMachines.sort((a, b) => {
          // Try numeric sort first
          const numA = parseInt(String(a.id).replace(/\D/g, ''));
          const numB = parseInt(String(b.id).replace(/\D/g, ''));
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return String(a.machineName).localeCompare(String(b.machineName));
       });
       setMachines(sorted);
    });

    return () => unsubMachines();
  }, []);

  const fetchContextData = async () => {
    try {
      // Updated to fetch CustomerSheets (for client names), YarnInventory, Fabrics
      // AND fetch all orders using collectionGroup (Super Search) to reach into subcollections.
      const [sheetsSnap, fabricsSnap, yarnsSnap, ordersSnap] = await Promise.all([
        getDocs(collection(db, 'CustomerSheets')),
        getDocs(collection(db, 'FabricSS')),
        getDocs(collection(db, 'YarnInventory')),
        getDocs(query(collectionGroup(db, 'orders')))
      ]);

      // Create a map of Client ID -> Client Name
      const clientMap = new Map<string, string>();
      sheetsSnap.docs.forEach(doc => {
          const data = doc.data() as CustomerSheet;
          if (doc.id && data.name) {
              clientMap.set(doc.id, data.name);
          }
      });

      // Flatten Orders from the sub-collection fetch
      const flatOrders: FlattenedOrder[] = [];
      ordersSnap.docs.forEach(doc => {
        const orderData = doc.data() as OrderRow;
        // Determine Client Name from parent doc ID
        const clientId = doc.ref.parent.parent?.id;
        const clientName = clientId ? (clientMap.get(clientId) || 'Unknown') : 'Unknown';

        flatOrders.push({
          clientName: clientName,
          order: { ...orderData, id: doc.id } // Ensure ID preserves the doc ID
        });
      });
      setActiveOrders(flatOrders);

      // Build Yarn Map
      const yMap: Record<string, string> = {};
      const lMap: Record<string, string> = {};
      yarnsSnap.docs.forEach(doc => {
        const data = doc.data() as YarnInventoryItem & { name?: string, yarnId?: string }; // Safety casting
        // Map both doc ID and internal yarnId if present
        // Prefer yarnName, then name, then ID
        const nameToUse = data.yarnName || data.name || doc.id;
        
        yMap[doc.id] = nameToUse;
        if (data.yarnId) yMap[data.yarnId] = nameToUse;
        if (data.lotNumber) lMap[data.lotNumber] = nameToUse;
      });
      setYarnMap(yMap);
      setLotMap(lMap);

      setFabrics(fabricsSnap.docs.map(d => ({ id: d.id, ...d.data() } as FabricDefinition)));
    } catch (e) {
      console.error("Error fetching context:", e);
    }
  };

  const filteredMachines = machines.filter(m => 
    (m.machineName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.brand || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSaveMaintenance = async (machineId: string, date: string, notes: string) => {
    try {
      const docRef = doc(db, 'MachineSS', machineId);
      // Create record
      const record = {
        id: crypto.randomUUID(),
        date,
        notes,
        createdAt: new Date().toISOString()
      };

      await updateDoc(docRef, {
        lastMaintenance: { date, notes },
        maintenanceHistory: arrayUnion(record)
      });
    } catch (err) {
      console.error("Error saving maintenance:", err);
      throw err;
    }
  };

  const handleUpdateMaintenanceLog = async (machineId: string, logId: string, date: string, notes: string) => {
    try {
      const machine = machines.find(m => (m.firestoreId === machineId) || (m.id.toString() === machineId));
      if (!machine || !machine.maintenanceHistory) return;

      const updatedHistory = machine.maintenanceHistory.map(log => {
        if (log.id === logId) {
          return { ...log, date, notes };
        }
        return log;
      });
      
      // Sanitize history to remove undefined values
      const sanitizedHistory = updatedHistory.map(h => {
          const clean: any = {
              id: h.id,
              date: h.date,
              notes: h.notes || '',
              createdAt: h.createdAt || new Date().toISOString()
          };
          if (h.technician !== undefined && h.technician !== null) {
              clean.technician = h.technician;
          }
          return clean;
      });

      const sorted = [...sanitizedHistory].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      let newLast = null;
      if (sorted.length > 0) {
        const top = sorted[0];
        newLast = { 
            date: top.date, 
            notes: top.notes
        };
        if (top.technician) {
            (newLast as any).technician = top.technician;
        }
      }

      const targetDocId = machine.firestoreId || machineId;

      const docRef = doc(db, 'MachineSS', targetDocId);
      
      const updates: any = {
        maintenanceHistory: sanitizedHistory
      };
      
      if (newLast) {
          updates.lastMaintenance = newLast;
      } else {
          updates.lastMaintenance = deleteField();
      }

      await updateDoc(docRef, updates);
    } catch (err) {
      console.error("Error editing log:", err);
      alert('Failed to update log');
      throw err;
    }
  };

  const handleDeleteMaintenanceLog = async (machineId: string, logId: string) => {
    try {
      // Find machine by ID matching either firestoreId OR id (as string)
      const machine = machines.find(m => (m.firestoreId === machineId) || (m.id.toString() === machineId));
      
      if (!machine || !machine.maintenanceHistory) {
          console.error("Machine not found for delete log:", machineId); 
          return;
      }

      const updatedHistory = machine.maintenanceHistory.filter(log => log.id !== logId);

      // Sanitize history to remove undefined values
      const sanitizedHistory = updatedHistory.map(h => {
          const clean: any = {
              id: h.id,
              date: h.date,
              notes: h.notes || '',
              createdAt: h.createdAt || new Date().toISOString()
          };
          if (h.technician !== undefined && h.technician !== null) {
              clean.technician = h.technician;
          }
          return clean;
      });

      const sorted = [...sanitizedHistory].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      let newLast = null;
      if (sorted.length > 0) {
         const top = sorted[0];
         newLast = { 
            date: top.date, 
            notes: top.notes
         };
         if (top.technician) {
            (newLast as any).technician = top.technician;
         }
      }

      // Ensure we use the correct Firestore ID if we found it via internal ID
      const targetDocId = machine.firestoreId || machineId;

      const docRef = doc(db, 'MachineSS', targetDocId);
      
      const updates: any = { maintenanceHistory: sanitizedHistory };
      
      if (newLast) {
        updates.lastMaintenance = newLast;
      } else {
        updates.lastMaintenance = deleteField();
      }
      
      await updateDoc(docRef, updates);
    } catch (err) {
      console.error("Error deleting log:", err);
      alert('Failed to delete log');
      throw err;
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
             <div className="p-3 bg-orange-100 rounded-xl text-orange-600">
                <Wrench size={32} />
             </div>
             <div>
                Maintenance Logs
                {activeDate && (
                  <span className="ml-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm font-bold border border-blue-100 align-middle">
                    <Calendar size={14} />
                    Active Day: {new Date(activeDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                )}
             </div>
          </h1>
          <p className="text-slate-500 mt-1">Track repairs and service history for all machines</p>
        </div>

        <div className="relative w-full sm:w-auto flex gap-2 items-center">
           <button
              onClick={() => setShowJobsView(!showJobsView)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-sm ${
                 showJobsView 
                  ? 'bg-slate-800 text-white shadow-slate-200' 
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
           >
              <Briefcase size={18} className={showJobsView ? 'text-blue-300' : 'text-slate-400'} />
              Current Jobs
           </button>

           <div className="relative flex-1 sm:w-72">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
             <input 
               type="text" 
               placeholder="Search machines..." 
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
             />
           </div>
        </div>
      </div>

      {showJobsView ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
           {filteredMachines.filter(m => m.status === MachineStatus.WORKING || m.status === MachineStatus.UNDER_OP || showJobsView).map(machine => {
              const endDate = calculateEndDate(machine.remainingMfg, machine.dayProduction);
              
              // Find Yarn Allocations Logic
              // Normalize strings for comparison
              const searchClient = (machine.client || '').trim().toLowerCase();
              const searchMaterial = (machine.material || '').trim().toLowerCase();
              const machineIdStr = String(machine.id);
              const machineName = (machine.machineName || '').trim().toLowerCase();

              // --- ENHANCED ORDER MATCHING LOGIC ---
              
              let matchType: 'DIRECT_LINK' | 'FUZZY_MATCH' | 'NONE' = 'NONE';
              let activeContext: FlattenedOrder | undefined;
              let debugInfo = "";
              let logs: string[] = [];

              // STRATEGY 1: Direct Machine Assignment (Strict)
              // We check if any active order is explicitly assigned to this machine name
              if (matchType === 'NONE') {
                 activeContext = activeOrders.find(ctx => {
                    const assignedMachine = (ctx.order.machine || '').trim().toLowerCase();
                    return assignedMachine === machineName || assignedMachine === machine.id.toString().toLowerCase();
                 });

                 if (activeContext) {
                    matchType = 'DIRECT_LINK';
                    debugInfo = `Linked via Machine: ${activeContext.order.machine}`;
                    logs.push(`✅ Linked via Machine: ${activeContext.order.machine}`);
                 }
              }

              // STRATEGY 2: Fuzzy Text Matching (Client + Fabric)
              if (matchType === 'NONE' && (searchClient || searchMaterial)) {
                 logs.push(`🔍 Searching Client: '${searchClient}'`);
                 
                 // 2a. Filter by Client first
                 const clientMatches = activeOrders.filter(ctx => 
                    ctx.clientName.toLowerCase() === searchClient
                 );

                 logs.push(`📋 Found ${clientMatches.length} orders for client`);

                 if (clientMatches.length > 0) {
                     logs.push(`🧵 Searching Fabric: '${searchMaterial}'`);

                     // 2b. Find best fabric match within client's orders
                     const bestMatch = clientMatches.find((ctx, idx) => {
                        const ordFab = (ctx.order.material || '').toLowerCase();
                        // Exact or partial match
                        const match = ordFab === searchMaterial || ordFab.includes(searchMaterial) || searchMaterial.includes(ordFab);
                        // Log first 5 checks to avoid spam
                        if (idx < 5) logs.push(`  • Checking: '${ordFab}' -> ${match ? '✅' : '❌'}`);
                        return match;
                     });

                     if (bestMatch) {
                        activeContext = bestMatch;
                        matchType = 'FUZZY_MATCH';
                        debugInfo = "Matched via Name (Client+Fabric)";
                        logs.push("✅ Fabric Match Found!");
                     } else {
                        // Fallback: Just take the first valid order for this client if we can't match specific fabric
                        debugInfo = `Client found (${clientMatches.length}), Fabric Mismatch`;
                        logs.push("❌ No matching fabric found in client orders");
                     }
                 } else {
                    debugInfo = "Client not found in Sheets";
                    logs.push("❌ Client Name not found in active sheets");
                 }
              }

              // Prepare Yarn Data
              // OrderRow.yarnAllocations is Record<string, YarnAllocationItem[]>
              const allocMap = activeContext?.order.yarnAllocations || {};
              const allocEntries = Object.entries(allocMap);
              const hasOrderAllocations = allocEntries.length > 0;
              
              // Fabric Standard Definition Fallback (if no allocations)
              const standardDef = !hasOrderAllocations ? fabrics.find(f => {
                 const targetName = activeContext ? activeContext.order.material.toLowerCase() : searchMaterial;
                 const fName = f.name.toLowerCase();
                 const sName = (f.shortName || '').toLowerCase();
                 return fName === targetName || sName === targetName;
              }) : null;

              return (
                 <div key={machine.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative flex flex-col h-full group">
                    {/* Status Strip */}
                    <div className={`h-1.5 w-full ${
                        machine.status === MachineStatus.WORKING ? 'bg-green-500' : 
                        machine.status === MachineStatus.UNDER_OP ? 'bg-amber-500' : 'bg-slate-200'
                    }`} />
                    
                    {/* Debug Overlay - Hover Only */}
                    <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                         <div className="group/tooltip relative">
                            <div className={`text-[9px] px-1.5 py-0.5 rounded cursor-help shadow-sm opacity-90 transition-opacity font-bold flex items-center gap-1 ${
                               matchType === 'DIRECT_LINK' ? 'bg-blue-600 text-white' :
                               matchType === 'FUZZY_MATCH' ? 'bg-amber-500 text-white' :
                               'bg-slate-700 text-slate-300'
                            }`}>
                               DEBUG {matchType === 'DIRECT_LINK' && '★'}
                            </div>
                            
                            {/* Detailed Log Info */}
                            <div className="hidden group-hover/tooltip:block absolute right-0 top-full mt-1 w-64 md:w-80 bg-slate-800/95 backdrop-blur text-slate-200 text-[10px] p-2 rounded-lg shadow-xl z-50 border border-slate-700">
                                <div className="font-bold text-white border-b border-slate-600 pb-1 mb-1.5 flex justify-between items-center">
                                   <span>Diagnostics</span>
                                   <span className="text-[9px] font-mono text-slate-400">{machine.id}</span>
                                </div>
                                <div className="space-y-1.5 font-mono text-[9px]">
                                   {/* Match Status */}
                                   <div className="bg-slate-900/50 p-1.5 rounded border border-slate-700">
                                      <div className="flex justify-between mb-1">
                                         <span className="text-slate-400">Match Type:</span>
                                         <span className={matchType === 'NONE' ? 'text-red-400' : 'text-green-400 font-bold'}>{matchType}</span>
                                      </div>
                                      {/* Detailed Logs */}
                                      <div className="text-slate-400 space-y-0.5 mt-2 pt-2 border-t border-slate-700/50">
                                         {logs.length > 0 ? logs.map((log, i) => (
                                            <div key={i} className="leading-tight break-words">{log}</div>
                                         )) : <div className="italic text-slate-600">No logs generated</div>}
                                      </div>
                                   </div>

                                   {/* Data Comparison */}
                                   <div className="grid grid-cols-[30px_1fr] gap-x-2">

                                      <span className="text-slate-500">M.Cli:</span>
                                      <span className={activeContext ? 'text-green-300' : 'text-orange-300'}>{machine.client || '-'}</span>
                                      
                                      <span className="text-slate-500">M.Fab:</span>
                                      <span className={activeContext ? 'text-green-300' : 'text-orange-300'}>{machine.material || '-'}</span>
                                   </div>

                                   {/* Result Info */}
                                   {activeContext && (
                                     <div className="border-t border-slate-700 pt-1 mt-1">
                                        <div className="flex justify-between">
                                           <span className="text-slate-400">Ord Client:</span>
                                           <span>{activeContext.clientName}</span>
                                        </div>
                                        <div className="flex justify-between">
                                           <span className="text-slate-400">Allocations:</span>
                                           <span className={hasOrderAllocations ? 'text-blue-300' : 'text-slate-500'}>
                                              {hasOrderAllocations ? `${allocEntries.length} lots` : 'None linked'}
                                           </span>
                                        </div>
                                     </div>
                                   )}
                                </div>
                            </div>
                         </div>
                    </div>

                    <div className="p-3 sm:p-4 flex-1 flex flex-col">
                       <div className="flex justify-between items-start mb-2 sm:mb-3">
                          <div className="flex-1 min-w-0">
                             <h3 className="font-bold text-base sm:text-lg text-slate-800 truncate" title={machine.machineName}>{machine.machineName}</h3>
                             <div className="text-xs text-slate-400 font-medium truncate">{machine.brand}</div>
                             <div className="flex items-center gap-2 mt-0.5 sm:mt-1 flex-wrap">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                                    machine.status === MachineStatus.WORKING ? 'bg-green-100 text-green-700' : 
                                    machine.status === MachineStatus.UNDER_OP ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                                }`}>
                                   {machine.status}
                                </span>
                             </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                             <div className="text-[9px] sm:text-xs text-slate-400 font-bold uppercase mb-0.5">Finish / Rem:</div>
                             <div className="font-mono font-bold text-xs sm:text-sm text-slate-700 bg-slate-50 px-1.5 py-1 rounded border border-slate-100 text-center">
                                <div>{endDate}</div>
                                <div className="text-[10px] text-blue-600 border-t border-slate-200 mt-0.5 pt-0.5 font-bold" title="Remaining Quantity (Daily Plan)">
                                   {machine.remainingMfg ? `${Number(machine.remainingMfg).toFixed(0)}kg` : '-'}
                                </div>
                             </div>
                          </div>
                       </div>


                       <div className="grid grid-cols-2 gap-2 mb-3 sm:mb-4">
                          <div className="p-2 bg-slate-50 rounded border border-slate-100 overflow-hidden">
                             <div className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase mb-0.5 sm:mb-1">Client</div>
                             <div className="font-bold text-xs sm:text-sm text-slate-700 truncate" title={machine.client}>{machine.client || '-'}</div>
                          </div>
                          <div className="p-2 bg-slate-50 rounded border border-slate-100 overflow-hidden flex flex-col justify-center">
                             <div className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase mb-0.5 sm:mb-1">Fabric</div>
                             {(() => {
                                 const relatedFabric = fabrics.find(f => f.name === machine.material);
                                 const displayFabric = relatedFabric?.shortName || machine.material || '-';
                                 return (
                                     <div className="font-bold text-xs sm:text-sm text-slate-700 whitespace-normal break-words leading-tight" title={machine.material}>
                                        {displayFabric}
                                     </div>
                                 );
                             })()}
                          </div>
                       </div>

                       {/* Yarn Section */}
                       <div className="border-t border-slate-100 pt-2 sm:pt-3 mt-auto">
                          <div className="flex items-center justify-between mb-2">
                             <div className="text-[10px] sm:text-xs font-bold text-slate-500 flex items-center gap-1">
                                <Layers size={12} className="text-orange-400" /> Yarn
                             </div>
                             {hasOrderAllocations && (
                                <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 rounded font-medium">Linked</span>
                             )}
                          </div>
                          
                          <div className="space-y-2 min-h-[60px] max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                             {hasOrderAllocations ? (
                                allocEntries.map(([yarnId, items], idx) => {
                                   // Advanced Resolution Strategy
                                   // 1. Try Map (ID -> Name)
                                   let resolvedName = yarnMap[yarnId];

                                   // 2. RECIPE LOOKUP (The "Orders Page" Strategy)
                                   // If we don't know the name from Inventory, look up the Fabric Definition (Recipe)
                                   // The ID might be valid but just missing from the loaded inventory list.
                                   if (!resolvedName && activeContext) {
                                       const fabricDef = fabrics.find(f => f.name === activeContext.order.material);
                                       if (fabricDef && fabricDef.variants) {
                                           // Check all variants for this yarnId
                                           for (const v of fabricDef.variants) {
                                               const foundYarn = v.yarns.find(y => y.yarnId === yarnId);
                                               if (foundYarn) {
                                                   resolvedName = foundYarn.name;
                                                   break;
                                               }
                                           }
                                       }
                                   }
                                   
                                   // 3. Fallback: Check if the allocation item itself has a saved name (denormalized)
                                   //    or Try Lot Map (Lot Number -> Name)
                                   if (!resolvedName && items.length > 0) {
                                       const firstItem = items[0] as any;
                                       if (firstItem.yarnName) resolvedName = firstItem.yarnName;
                                       
                                       if (!resolvedName && firstItem.lotNumber) {
                                           resolvedName = lotMap[firstItem.lotNumber];
                                       }
                                   }

                                    // 4. Last Resort: Show ID but truncated to be less ugly, or just ID
                                   const isUnresolved = !resolvedName;
                                   if (!resolvedName) resolvedName = yarnId;

                                   const lots = items.map(i => i.lotNumber).join(', ');
                                   const totalQty = items.reduce((acc, i) => acc + i.quantity, 0);

                                   // Helper to get potential names from Fabric Recipe
                                   const getPotentialNames = () => {
                                       if (!activeContext?.order?.material) return [];
                                       const fabricDef = fabrics.find(f => f.name === activeContext.order.material);
                                       if (!fabricDef?.variants) return [];
                                       const names = new Set<string>();
                                       fabricDef.variants.forEach(v => v.yarns.forEach(y => names.add(y.name)));
                                       return Array.from(names);
                                   };
                                   const possibleNames = isUnresolved ? getPotentialNames() : [];

                                   return (
                                     <div key={idx} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm relative group hover:border-blue-300 transition-colors">
                                        {/* Yarn Name */}
                                        <div className="font-bold text-xs text-slate-800 mb-2 leading-snug break-words border-b border-slate-100 pb-1.5 relative">
                                            {resolvedName}
                                            {isUnresolved && (
                                                <div className="mt-1 text-[9px] text-red-600 bg-red-50 p-1.5 rounded border border-red-200 font-mono break-all relative z-10">
                                                    <div className="font-bold mb-1">⚠️ Unresolved ID</div>
                                                    <div className="mb-1">ID: {yarnId}</div>
                                                    
                                                    {possibleNames.length > 0 && (
                                                        <div className="mb-1 p-1 bg-white border border-red-100 rounded">
                                                            <span className="font-semibold block mb-1">Select Correct Yarn (Link ID):</span>
                                                            <ul className="list-none mt-0 space-y-1">
                                                                {possibleNames.map((n, i) => (
                                                                    <li key={i} className="truncate">
                                                                        <button
                                                                            onClick={async (e) => {
                                                                                e.stopPropagation();
                                                                                if (!confirm(`Are you sure this allocation (ID: ${yarnId}) is actually "${n}"? This will update the Fabric Definition.`)) return;
                                                                                
                                                                                try {
                                                                                    // 1. Find Fabric ID
                                                                                    const fabricDef = fabrics.find(f => f.name === activeContext?.order?.material);
                                                                                    if (!fabricDef?.id) throw new Error('Fabric not found');

                                                                                    // 2. Update the Fabric Definition to include this yarnId
                                                                                    const updatedVariants = fabricDef.variants.map(v => ({
                                                                                        ...v,
                                                                                        yarns: v.yarns.map(y => {
                                                                                            if (y.name === n) {
                                                                                                return { ...y, yarnId: yarnId };
                                                                                            }
                                                                                            return y;
                                                                                        })
                                                                                    }));

                                                                                    await updateDoc(doc(db, 'FabricSS', fabricDef.id), {
                                                                                        variants: updatedVariants
                                                                                    });

                                                                                    alert('Success! Fabric updated. Please refresh the page.');
                                                                                    window.location.reload();
                                                                                } catch (err) {
                                                                                    console.error(err);
                                                                                    alert('Failed to update: ' + err);
                                                                                }
                                                                            }}
                                                                            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1 rounded w-full text-left"
                                                                        >
                                                                            👉 {n}
                                                                        </button>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}

                                                    <button 
                                                        className="mt-1 text-blue-600 underline cursor-pointer hover:text-blue-800 text-[9px]"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            console.log('DEBUG UNRESOLVED:', { 
                                                                yarnId, 
                                                                possibleNames,
                                                                inventoryCount: Object.keys(yarnMap).length,
                                                                fabric: fabrics.find(f => f.name === activeContext?.order?.material)
                                                            });
                                                        }}
                                                    >
                                                        Log Details to Console
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="flex items-end justify-between gap-2">
                                            {/* Lot Numbers */}
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Lot / Batch</span>
                                                <span className="text-[10px] font-mono text-slate-600 whitespace-normal break-words bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 block w-full leading-tight" title={lots}>
                                                    {lots}
                                                </span>
                                            </div>

                                            {/* Quantity Badge */}
                                            <div className="flex flex-col items-end shrink-0">
                                                 <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Allocated</span>
                                                 <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 shadow-sm">
                                                    {Number(totalQty).toFixed(2)} kg
                                                 </span>
                                            </div>
                                        </div>
                                     </div>
                                   );
                                })
                             ) : standardDef ? (
                                standardDef.variants[0]?.yarns.map((yarn, idx) => (
                                   <div key={idx} className="flex justify-between items-center text-[10px] sm:text-xs p-1.5 rounded border border-dashed border-slate-200">
                                      <div className="font-medium text-slate-500">{yarn.name}</div>
                                      <div className="text-slate-400">{yarn.percentage}%</div>
                                   </div>
                                ))
                             ) : (
                                <div className="text-center py-2 text-[10px] sm:text-xs text-slate-400 italic">
                                   {activeContext ? (
                                      <span className="text-orange-400">No Allocations Linked</span>
                                   ) : (
                                      <span>No yarn data</span>
                                   )}
                                   <div className="text-[9px] mt-1 text-red-300">
                                      {!activeContext ? 'Active Ord not found' : 'No alloc list'}
                                   </div>
                                </div>
                             )}
                          </div>
                       </div>
                    </div>
                 </div>
              );
           })}
        </div>
      ) : (
      /* Grid of Machines */
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
        {filteredMachines.map(machine => {
           const historyCount = (machine.maintenanceHistory || []).length;
           const lastMaintenance = machine.lastMaintenance;

           return (
             <div key={machine.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-all group">
                <div className="p-3 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start gap-2 sm:gap-0">
                  <div>
                    <h3 className="font-bold text-base sm:text-lg text-slate-800 line-clamp-1" title={machine.machineName}>{machine.machineName}</h3>
                    <div className="text-xs sm:text-sm text-slate-500 font-medium line-clamp-1">{machine.brand}</div>
                  </div>
                  {historyCount > 0 ? (
                    <span className="bg-blue-100 text-blue-700 text-[10px] sm:text-xs font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-lg whitespace-nowrap">
                      {historyCount} Rec
                    </span>
                  ) : (
                    <span className="bg-slate-100 text-slate-500 text-[10px] sm:text-xs font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-lg whitespace-nowrap">
                      No Rec
                    </span>
                  )}
                </div>

                <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                   {/* Last Maintenance Status */}
                   {lastMaintenance ? (
                     <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 sm:p-4">
                        <div className="text-[10px] sm:text-xs font-bold text-orange-800 uppercase tracking-wider mb-1 or-mb-2 flex items-center gap-1 sm:gap-2">
                           <Calendar size={12} className="sm:w-3.5 sm:h-3.5" /> <span className="hidden sm:inline">Last Service</span><span className="sm:hidden">Last</span>
                        </div>
                        <div className="font-bold text-slate-800 text-sm sm:text-lg mb-1">
                           {new Date(lastMaintenance.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit'})}
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600 line-clamp-2">
                           {lastMaintenance.notes}
                        </p>
                     </div>
                   ) : (
                     <div className="bg-slate-50 border border-slate-200 border-dashed rounded-xl p-4 sm:p-8 flex flex-col items-center justify-center text-slate-400 gap-1 sm:gap-2">
                        <AlertCircle size={20} className="sm:w-6 sm:h-6 opacity-50" />
                        <span className="text-xs sm:text-sm font-medium text-center">No logs</span>
                     </div>
                   )}

                   {/* Actions */}
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      <button 
                         onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('history'); }}
                         className={`py-2 px-2 sm:py-2.5 sm:px-4 rounded-xl font-bold text-xs sm:text-sm border flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
                            historyCount > 0 
                             ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm' 
                             : 'bg-slate-50 border-transparent text-slate-300 cursor-not-allowed'
                         }`}
                         disabled={historyCount === 0}
                      >
                         <History size={14} className="sm:w-4 sm:h-4" /> History
                      </button>
                      
                      <button 
                         onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('form'); }}
                         className="py-2 px-2 sm:py-2.5 sm:px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-orange-200 flex items-center justify-center gap-1.5 sm:gap-2 transition-all"
                      >
                         <Plus size={16} strokeWidth={3} className="sm:w-[18px] sm:h-[18px]" /> Log
                      </button>
                   </div>
                </div>
             </div>
           );
        })}
      </div>
      )}

      {filteredMachines.length === 0 && (
         <div className="text-center py-20 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <Search className="mx-auto text-slate-300 mb-4" size={48} />
            <h3 className="text-lg font-bold text-slate-500">No machines found</h3>
            <p className="text-slate-400">Try adjusting your search term</p>
         </div>
      )}



      {/* Maintenance Modal */}
      {maintenanceMachine && (
        <MachineMaintenanceModal
          isOpen={!!maintenanceMachine}
          onClose={() => setMaintenanceMachine(null)}
          machine={maintenanceMachine}
          initialView={maintenanceInitialView}
          onSave={handleSaveMaintenance}
          onUpdateLog={handleUpdateMaintenanceLog}
          onDelete={handleDeleteMaintenanceLog}
        />
      )}
    </div>
  );
};

