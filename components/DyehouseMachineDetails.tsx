import React, { useState, useEffect } from 'react';
import { collection, getDocs, collectionGroup, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { CustomerSheet, OrderRow, DyeingBatch, FabricDefinition } from '../types';
import { X, Calendar, Package, User, FileText, Droplets } from 'lucide-react';

interface DyehouseMachineDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  dyehouseName: string;
  machineCapacity: number;
}

interface LinkedItem {
  clientId: string;
  clientName: string;
  orderId: string;
  orderReference?: string; // Order Reference
  fabric: string;
  fabricShortName?: string;
  color: string;
  colorHex?: string; // Added colorHex
  quantity: number; // Batch quantity (مطلوب)
  quantitySent?: number; // Total sent (raw + accessory)
  quantitySentRaw?: number;
  quantitySentAccessory?: number;
  receivedQuantity?: number;
  totalReceived?: number;
  plannedCapacity?: number;
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  notes?: string;
  status: 'Pending' | 'Sent' | 'Received';
  accessoryType?: string;
  batchGroupId?: string;
}

export const DyehouseMachineDetails: React.FC<DyehouseMachineDetailsProps> = ({
  isOpen,
  onClose,
  dyehouseName,
  machineCapacity
}) => {
  const [items, setItems] = useState<LinkedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchLinkedData();
    }
  }, [isOpen, dyehouseName, machineCapacity]);

  const fetchLinkedData = async () => {
    setLoading(true);
    setDebugLog([]); // Reset log
    const logs: string[] = [];
    logs.push(`Starting search for Dyehouse: "${dyehouseName}", Machine Capacity: "${machineCapacity}"`);

    try {
      // 1. Fetch Clients for Name Lookup
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        clientMap[doc.id] = data.name || 'Unknown Client';
      });
      logs.push(`Loaded ${Object.keys(clientMap).length} clients for lookup.`);

      // 1b. Fetch Fabrics for shortName Lookup
      const fabricsSnapshot = await getDocs(collection(db, 'fabrics'));
      const fabricMap: Record<string, string> = {};
      fabricsSnapshot.docs.forEach(doc => {
        const data = doc.data() as FabricDefinition;
        fabricMap[data.name] = data.shortName || data.name;
      });
      logs.push(`Loaded ${Object.keys(fabricMap).length} fabrics for lookup.`);

      // 2. Fetch All Orders (Subcollection)
      const ordersSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      logs.push(`Fetched ${ordersSnapshot.size} total orders from database.`);

      const foundItems: LinkedItem[] = [];
      const searchedClients = new Set<string>();
      const workingMatches: string[] = [];
      const failedMatches: string[] = [];
      const allScannedBatches: string[] = []; // NEW: Log every single batch
      
      let totalOrders = 0;

      ordersSnapshot.docs.forEach(doc => {
        const order = { id: doc.id, ...doc.data() } as OrderRow;
        totalOrders++;
        
        // Resolve Client Name
        const clientId = order.customerId || 'unknown'; 
        const clientName = clientMap[clientId] || 'Unknown Client';
        searchedClients.add(clientName);

        // Check if order is assigned to this dyehouse (optional, but good for context)
        // The main link is in the dyeingPlan
        
        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach((batch, batchIdx) => {
            // --- ENHANCED MATCHING LOGIC (Replicating ClientOrdersPage Filter) ---
            
            // 1. Resolve Dyehouse
            // The batch might have a specific dyehouse override, otherwise use order default
            const effectiveDyehouse = batch.dyehouse || order.dyehouse || '';
            
            // 2. Resolve Machine/Capacity
            // Match using plannedCapacity (the selected machine capacity) primarily
            const plannedCap = batch.plannedCapacity || 0;
            const batchQty = batch.quantity || 0;
            // Fallback: If batch has no machine, check order-level machine assignment
            const assignedMachine = batch.machine || order.dyehouseMachine || '';
            
            // Normalize for comparison
            const normDyehouse = effectiveDyehouse.trim().toLowerCase();
            const normTargetDyehouse = dyehouseName.trim().toLowerCase();
            const targetCapacityStr = String(machineCapacity);

            const isDyehouseMatch = normDyehouse === normTargetDyehouse;
            
            // Primary: match on plannedCapacity (selected machine)
            const isPlannedCapacityMatch = plannedCap === machineCapacity;
            // Fallback: quantity match or machine name match (legacy)
            const isQuantityMatch = batchQty === machineCapacity;
            const isMachineNameMatch = assignedMachine.toLowerCase().includes(targetCapacityStr);
            
            const isMatch = isDyehouseMatch && (isPlannedCapacityMatch || isQuantityMatch || isMachineNameMatch);

            // Calculate totals from events
            let totalSent = 0;
            if (batch.sentEvents && Array.isArray(batch.sentEvents) && batch.sentEvents.length > 0) {
              totalSent = batch.sentEvents.reduce((s: number, e: any) => s + (e.quantity || 0) + (e.accessorySent || 0), 0);
            } else {
              totalSent = (batch.quantitySentRaw || batch.quantitySent || 0) + (batch.quantitySentAccessory || 0);
            }

            const events = batch.receiveEvents || [];
            const totalReceivedRaw = events.reduce((s: number, e: any) => s + (e.quantityRaw || 0), 0) + (batch.receivedQuantity || 0);
            const totalReceivedAccessory = events.reduce((s: number, e: any) => s + (e.quantityAccessory || 0), 0);
            const totalReceived = totalReceivedRaw + totalReceivedAccessory;

            // LOG EVERY BATCH
            allScannedBatches.push(
              `[SCAN] Client: ${clientName} | Order: ${order.orderReference || order.id} | Dyehouse: "${effectiveDyehouse}" (Target: "${dyehouseName}") | PlannedCap: ${plannedCap} | Qty: ${batchQty} | Machine: "${assignedMachine}"`
            );

            if (isMatch) {
              const matchReason = isPlannedCapacityMatch ? 'PlannedCapacity Match' : (isQuantityMatch ? 'Qty Match' : 'Machine Name Match');
              const matchMsg = `[MATCH] Client: ${clientName} | Order: ${order.orderReference || order.id} | Color: ${batch.color} | PlannedCap: ${plannedCap} | Sent: ${totalSent} | Reason: ${matchReason}`;
              workingMatches.push(matchMsg);

              foundItems.push({
                clientId: clientId,
                clientName: clientName,
                orderId: order.id,
                orderReference: order.orderReference,
                fabric: order.material,
                fabricShortName: fabricMap[order.material] || order.material,
                color: batch.color,
                colorHex: batch.colorHex, // Mapped hex
                quantity: batch.quantity,
                quantitySent: totalSent,
                quantitySentRaw: batch.quantitySentRaw || batch.quantitySent,
                quantitySentAccessory: batch.quantitySentAccessory,
                receivedQuantity: batch.receivedQuantity,
                totalReceived: totalReceived,
                plannedCapacity: batch.plannedCapacity,
                dispatchNumber: batch.dispatchNumber,
                dateSent: batch.dateSent,
                formationDate: batch.formationDate,
                notes: batch.notes,
                // Prioritize explicit batch.status, falling back to calculation only if needed
                status: (totalSent > 0 && totalReceived / totalSent >= 0.89) || batch.status === 'received' ? 'Received' : 
                        (batch.status === 'sent' || batch.status === 'Sent') ? 'Sent' : 
                        'Pending',
                accessoryType: batch.accessoryType,
                batchGroupId: batch.batchGroupId
              });
            } else {
                // Log near misses
                if (isDyehouseMatch && !isPlannedCapacityMatch && !isQuantityMatch && !isMachineNameMatch) {
                   failedMatches.push(`[FAIL-CAPACITY] Client: ${clientName} | Order: ${order.orderReference || order.id} | Dyehouse OK | PlannedCap ${plannedCap} != ${machineCapacity} AND Qty ${batchQty} != ${machineCapacity}`);
                }
                if (!isDyehouseMatch && (isPlannedCapacityMatch || isQuantityMatch || isMachineNameMatch)) {
                   failedMatches.push(`[FAIL-DYEHOUSE] Client: ${clientName} | Order: ${order.orderReference || order.id} | Capacity OK | Dyehouse "${effectiveDyehouse}" != "${dyehouseName}"`);
                }
            }
          });
        }
      });

      logs.push(`Search Complete. Scanned ${totalOrders} orders.`);
      logs.push(`Searched Clients (${searchedClients.size}): ${Array.from(searchedClients).join(', ')}`);
      
      if (workingMatches.length > 0) {
        logs.push(`--- WORKING MATCHES (${workingMatches.length}) ---`);
        logs.push(...workingMatches);
      } else {
        logs.push(`--- NO WORKING MATCHES ---`);
      }

      if (failedMatches.length > 0) {
        logs.push(`--- FAILED MATCHES (Near Misses: ${failedMatches.length}) ---`);
        // Limit failed matches to avoid huge logs, but show more than before
        logs.push(...failedMatches.slice(0, 20));
        if (failedMatches.length > 20) logs.push(`... and ${failedMatches.length - 20} more failures.`);
      } else {
        logs.push(`--- NO RELEVANT FAILURES FOUND ---`);
      }

      // Add full scan log if no matches found to help debug "0 results"
      if (foundItems.length === 0) {
         logs.push(`--- FULL SCAN LOG (First 50 Batches) ---`);
         logs.push(...allScannedBatches.slice(0, 50));
      }
      
      setDebugLog(logs);
      setItems(foundItems);
    } catch (error) {
      console.error("Error fetching linked machine data:", error);
      setDebugLog(prev => [...prev, `Error: ${error}`]);
    } finally {
      setLoading(false);
    }
  };

  // Group items by Client -> Fabric
  const groupedItems = React.useMemo(() => {
    const groups: Record<string, { clientName: string, fabrics: Record<string, { fabricName: string, items: LinkedItem[] }> }> = {};

    items.forEach(item => {
      // 1. Client Group
      if (!groups[item.clientId]) {
        groups[item.clientId] = {
          clientName: item.clientName,
          fabrics: {}
        };
      }
      
      // 2. Fabric Group (Key by fabric name to merge same fabrics)
      const fabricKey = item.fabricShortName || item.fabric || 'Unknown Fabric';
      if (!groups[item.clientId].fabrics[fabricKey]) {
        groups[item.clientId].fabrics[fabricKey] = {
          fabricName: fabricKey,
          items: []
        };
      }

      groups[item.clientId].fabrics[fabricKey].items.push(item);
    });

    return groups;
  }, [items]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="p-2 bg-purple-100 text-purple-700 rounded-lg">
                <Droplets size={20} />
              </span>
              {dyehouseName}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-slate-500 text-sm">
               <span className="font-medium">Machine Capacity:</span>
               <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-bold">{machineCapacity} kg</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mb-3"></div>
              <p>Scanning orders...</p>
            </div>
          ) : items.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-16 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
               <Package size={48} className="mb-4 text-slate-300" />
               <p className="font-medium">No active batches found</p>
               <p className="text-sm">This machine is currently empty in the system.</p>
               
               {/* Debug Toggle */}
               <div className="mt-8 w-full max-w-md px-4">
                  <details className="text-xs text-left">
                    <summary className="cursor-pointer text-blue-500 hover:underline mb-2">View Debug Logs</summary>
                    <div className="bg-slate-900 text-slate-200 p-4 rounded font-mono h-48 overflow-auto whitespace-pre-wrap">
                      {debugLog.join('\n')}
                    </div>
                  </details>
               </div>
             </div>
          ) : (
            <div className="space-y-8">
              {Object.values(groupedItems).map((clientGroup, i) => (
                <div key={clientGroup.clientName + i} className="animate-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${i * 100}ms` }}>
                  
                  {/* Client Header */}
                  <div className="flex items-center gap-3 mb-4 pl-1">
                    <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm shadow-blue-200">
                      <User size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 border-b-2 border-blue-100 pb-1 pr-6">
                      {clientGroup.clientName}
                    </h3>
                  </div>

                  {/* Fabrics Grid */}
                  <div className="grid grid-cols-1 gap-4 pl-4 border-l-2 border-slate-100 ml-4">
                    {Object.values(clientGroup.fabrics).map((fabricGroup, j) => (
                      <div key={fabricGroup.fabricName + j} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        
                        {/* Fabric Header */}
                        <div className="bg-slate-50/80 border-b border-slate-100 px-4 py-3 flex justify-between items-center backdrop-blur-sm">
                          <h4 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            {fabricGroup.fabricName}
                          </h4>
                          <span className="text-xs font-medium text-slate-400 bg-white px-2 py-1 rounded border border-slate-100">
                            {fabricGroup.items.length} Batch{fabricGroup.items.length > 1 ? 'es' : ''}
                          </span>
                        </div>

                        {/* Batches List */}
                        <div className="divide-y divide-slate-100">
                          {fabricGroup.items.map((item, k) => (
                            <div key={k} className="p-4 hover:bg-slate-50/50 transition-colors group">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                  
                                  {/* Color & ID */}
                                  <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-3 mb-1">
                                      <div 
                                        className="w-4 h-4 rounded-full border border-slate-200 shadow-sm"
                                        style={{ backgroundColor: item.colorHex || 'white' }}
                                      ></div>
                                      <span className="font-bold text-slate-800 text-base">{item.color}</span>
                                      
                                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                          item.status === 'Received' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                          item.status === 'Sent' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                          'bg-amber-50 text-amber-700 border-amber-100'
                                        }`}>
                                          {item.status === 'Received' ? 'تم الاستلام' : item.status === 'Sent' ? 'تم الإرسال' : 'قيد الانتظار'}
                                      </span>

                                      {item.batchGroupId && (
                                        <span className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full shadow-sm" title={`Shared Load: ${item.batchGroupId}`}>
                                            Group
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 pl-7">
                                      <span>رقم الطلب:</span>
                                      <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">
                                        {item.orderReference || item.orderId.substring(0, 8)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Stats */}
                                  <div className="flex items-center gap-6">
                                    {/* Planned/Sent */}
                                    <div className="text-right">
                                      <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-0.5">
                                         {item.status === 'Pending' ? 'الكمية (مخطط)' : 'الكمية (تم الإرسال)'}
                                      </div>
                                      <div className="font-mono text-sm font-medium">
                                        {item.status === 'Pending' ? (
                                           <span className="text-slate-600">{item.plannedCapacity || item.quantity} kg</span>
                                        ) : (
                                           <span className="text-blue-600">{item.quantitySent} kg</span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Received if any */}
                                    {(item.totalReceived || 0) > 0 && (
                                      <div className="text-right border-l border-slate-100 pl-4 hidden sm:block">
                                        <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-0.5">تم الاستلام</div>
                                        <div className="font-mono text-sm font-medium text-emerald-600">
                                          {item.totalReceived} kg
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Date */}
                                    <div className="text-right border-l border-slate-100 pl-4 min-w-[100px] hidden sm:block">
                                      <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-0.5">التاريخ</div>
                                      <div className="text-xs text-slate-600 flex items-center justify-end gap-1">
                                        {item.dateSent || item.formationDate || '-'}
                                      </div>
                                    </div>

                                    {/* Dispatch # */}
                                    {item.dispatchNumber && (
                                       <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-600 border border-slate-200">
                                         #{item.dispatchNumber}
                                       </div>
                                    )}

                                  </div>
                                </div>
                                
                                {item.notes && (
                                  <div className="mt-2 ml-7 text-xs text-slate-400 italic bg-amber-50/50 p-2 rounded border border-amber-50/50">
                                    Note: {item.notes}
                                  </div>
                                )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
