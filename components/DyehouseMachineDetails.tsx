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
  quantity: number; // Batch quantity (مطلوب)
  quantitySent?: number; // Actual sent (مرسل)
  receivedQuantity?: number;
  plannedCapacity?: number;
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  notes?: string;
  status: 'Pending' | 'Sent' | 'Received';
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

            // LOG EVERY BATCH
            allScannedBatches.push(
              `[SCAN] Client: ${clientName} | Order: ${order.orderReference || order.id} | Dyehouse: "${effectiveDyehouse}" (Target: "${dyehouseName}") | PlannedCap: ${plannedCap} | Qty: ${batchQty} | Machine: "${assignedMachine}"`
            );

            if (isMatch) {
              const matchReason = isPlannedCapacityMatch ? 'PlannedCapacity Match' : (isQuantityMatch ? 'Qty Match' : 'Machine Name Match');
              const matchMsg = `[MATCH] Client: ${clientName} | Order: ${order.orderReference || order.id} | Color: ${batch.color} | PlannedCap: ${plannedCap} | Sent: ${batch.quantitySent || 0} | Reason: ${matchReason}`;
              workingMatches.push(matchMsg);

              foundItems.push({
                clientId: clientId,
                clientName: clientName,
                orderId: order.id,
                orderReference: order.orderReference,
                fabric: order.material,
                fabricShortName: fabricMap[order.material] || order.material,
                color: batch.color,
                quantity: batch.quantity,
                quantitySent: batch.quantitySent,
                receivedQuantity: batch.receivedQuantity,
                plannedCapacity: batch.plannedCapacity,
                dispatchNumber: batch.dispatchNumber,
                dateSent: batch.dateSent,
                formationDate: batch.formationDate,
                notes: batch.notes,
                status: batch.receivedQuantity ? 'Received' : (batch.dateSent ? 'Sent' : 'Pending')
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Droplets className="text-indigo-600" />
              {dyehouseName}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Machine Capacity: <span className="font-mono font-bold text-slate-700">{machineCapacity} kg</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-4">
              <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                <Package size={48} className="mx-auto mb-4 text-slate-300" />
                <p className="font-medium text-slate-600">No active batches found for this machine.</p>
                <p className="text-sm mt-1">Check the debug log below for details.</p>
              </div>
              
              {/* Debug Log */}
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 font-mono text-xs text-slate-600 overflow-x-auto">
                <h4 className="font-bold text-slate-700 mb-2 uppercase tracking-wider">Debug Log</h4>
                <div className="space-y-1">
                  {debugLog.map((log, i) => (
                    <div key={i} className={`
                      ${log.startsWith('[Miss]') ? 'text-amber-600' : ''}
                      ${log.startsWith('Error') ? 'text-red-600 font-bold' : ''}
                      ${log.startsWith('Found') ? 'text-blue-600' : ''}
                    `}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Group by Client? Or just list? Let's list for now with clear badges */}
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Client / Order</th>
                    <th className="px-4 py-3">Fabric / Color</th>
                    <th className="px-4 py-3 text-center">Sent</th>
                    <th className="px-4 py-3 text-center">Received</th>
                    <th className="px-4 py-3">Dispatch Info</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{item.clientName}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <FileText size={10} />
                          {item.orderReference || item.orderId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700 font-medium">{item.fabricShortName || item.fabric}</div>
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium mt-1">
                          <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                          {item.color}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-blue-600">
                        {item.quantitySent ? `${item.quantitySent} kg` : '-'}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-medium text-emerald-600">
                        {item.receivedQuantity ? `${item.receivedQuantity} kg` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {item.dispatchNumber ? (
                          <div className="text-xs">
                            <div className="font-medium text-slate-700">#{item.dispatchNumber}</div>
                            {item.notes && <div className="text-slate-400 italic truncate max-w-[150px]">{item.notes}</div>}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.dateSent && (
                          <div className="flex items-center gap-1">
                            <Calendar size={10} />
                            Sent: {item.dateSent}
                          </div>
                        )}
                        {item.formationDate && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Calendar size={10} />
                            Form: {item.formationDate}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          item.status === 'Received' ? 'bg-emerald-100 text-emerald-700' :
                          item.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
