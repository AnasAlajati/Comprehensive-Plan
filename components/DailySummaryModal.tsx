import React, { useState, useEffect } from 'react';
import { MachineRow, MachineStatus, OrderRow, FabricDefinition, Yarn, Client } from '../types';
import { parseFabricName } from '../services/data';
import { CheckCircle2, AlertTriangle, X, FileText } from 'lucide-react';
import { collectionGroup, onSnapshot, query, updateDoc, DocumentReference } from 'firebase/firestore';
import { db } from '../services/firebase';
import { FabricProductionOrderModal } from './FabricProductionOrderModal';
import { DataService } from '../services/dataService';

interface DailySummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  machines: MachineRow[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onNavigateToOrder?: (client: string, fabric?: string) => void;
}

export const DailySummaryModal: React.FC<DailySummaryModalProps> = ({
  isOpen,
  onClose,
  machines,
  selectedDate,
  onDateChange,
  onNavigateToOrder
}) => {
  const [ordersMap, setOrdersMap] = useState<Record<string, { data: OrderRow, ref: DocumentReference }>>({});
  const [yarns, setYarns] = useState<Yarn[]>([]);
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  
  const [prodModal, setProdModal] = useState<{
      isOpen: boolean;
      order: OrderRow | null;
      activeMachines: string[]; 
      plannedMachines: string[];
      ref?: DocumentReference;
      clientName?: string;
  }>({ isOpen: false, order: null, activeMachines: [], plannedMachines: [] });

  const handleUpdateOrder = async (ref: DocumentReference, updates: Partial<OrderRow>) => {
      try {
          await updateDoc(ref, updates);
      } catch (err) {
          console.error("Error updating order:", err);
      }
  };

  useEffect(() => {
    if (isOpen) {
        // Fetch Reference Data
        DataService.getFabrics().then(setFabrics);
        DataService.getYarns().then(setYarns);
        DataService.getClients().then(setClients);

        // Subscribe to Orders to sync "Printed" status in real-time
        const q = query(collectionGroup(db, 'orders'));
        const unsub = onSnapshot(q, (snapshot) => {
            const map: Record<string, { data: OrderRow, ref: DocumentReference }> = {};
            snapshot.docs.forEach(doc => {
                const data = doc.data() as OrderRow;
                // Extract customerId from path: CustomerSheets/CLIENT_ID/orders/ORDER_ID
                const pathSegments = doc.ref.path.split('/');
                const parentId = pathSegments.length >= 3 ? pathSegments[pathSegments.length - 3] : undefined;
                
                map[doc.id] = { 
                    data: { ...data, id: doc.id, customerId: data.customerId || parentId },
                    ref: doc.ref 
                };
            });
            setOrdersMap(map);
        });
        return () => unsub();
    }
  }, [isOpen]);

  // Helper to find linked order
  const findLinkedOrder = (plan: any) => {
      if (!plan) return null;
      // 1. Try explicit ID
      if (plan.orderId && ordersMap[plan.orderId]) {
          return ordersMap[plan.orderId];
      }
      // 2. Try Client/Fabric Match
      // Note: FuturePlanEntry uses 'client' in some places or 'orderName' 
      const planClient = plan.client || plan.orderName;
      if (!planClient || !plan.fabric) return null;

      const normalize = (s: string) => s.trim().toLowerCase();
      const targetClient = normalize(planClient);
      const targetFabric = normalize(plan.fabric);

      return Object.values(ordersMap).find(wrapper => {
         const o = wrapper.data;
         
         // Resolve Client Name
         let clientName = (o as any).customerName;
         if (!clientName && o.customerId) {
             const c = clients.find(cl => cl.id === o.customerId);
             if (c) clientName = c.name;
         }
         
         return clientName && normalize(clientName) === targetClient && 
                o.material && normalize(o.material) === targetFabric;
      });
  };

  if (!isOpen) return null;

  // 1. Filter Finished Machines
  const finishedMachines = machines.filter(m => 
    (Number(m.remainingMfg) || 0) === 0 && 
    (Number(m.dayProduction) || 0) > 0
  );

  // 2. Filter Low Stock Machines
  // Logic from send report: status === 'Working' && remaining < 100 && remaining > 0
  const lowStockMachines = machines.filter(m => 
    m.status === MachineStatus.WORKING && 
    (Number(m.remainingMfg) || 0) < 100 && 
    (Number(m.remainingMfg) || 0) > 0
  );

  const hasNoAlerts = finishedMachines.length === 0 && lowStockMachines.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              📊 Daily Summary
            </h2>
            <input 
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="px-2 py-1 bg-white border border-gray-300 rounded text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {hasNoAlerts && (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <CheckCircle2 size={48} className="mx-auto mb-3 text-emerald-400 opacity-50" />
              <p className="font-medium text-lg">All Good!</p>
              <p className="text-sm opacity-75">No finished orders or low stock alerts for today.</p>
            </div>
          )}

          {/* Finished Machines Section */}
          {finishedMachines.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={16} />
                Finished Production
                <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full">
                  {finishedMachines.length}
                </span>
              </h3>
              
              <div className="grid gap-3 sm:grid-cols-2">
                {finishedMachines.map((m) => {
                  const fabricName = m.material || m.fabric || 'Unknown';
                  const { shortName } = parseFabricName(fabricName);
                  const hasPlans = m.futurePlans && m.futurePlans.length > 0;
                  const nextPlan = hasPlans ? m.futurePlans[0] : null;
                  const { shortName: nextFabric } = nextPlan ? parseFabricName(nextPlan.fabric) : { shortName: '-' };
                  
                  const linkedWrapper = findLinkedOrder(nextPlan);

                  return (
                    <div key={m.id} className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-gray-800">{m.machineName}</div>
                        <div className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">Finished</div>
                      </div>
                      
                      <div className="space-y-1 text-sm">
                        <div className="flex flex-col w-full">
                          <span className="text-gray-500 text-xs mb-0.5">Finished:</span>
                          <span className="font-medium text-gray-900 break-words whitespace-normal text-right bg-white/50 px-1 rounded" dir="auto" title={fabricName}>{shortName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Client:</span>
                          <span className="font-medium text-gray-900">{m.client || '-'}</span>
                        </div>
                        
                        <div className="mt-2 pt-2 border-t border-emerald-100 flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-1">Next Up:</div>
                            {nextPlan ? (
                                <div 
                                className="font-medium text-emerald-800 cursor-pointer hover:underline hover:text-emerald-900 group"
                                onClick={() => {
                                    if (onNavigateToOrder) {
                                    onNavigateToOrder(nextPlan.client || '', nextPlan.fabric);
                                    }
                                }}
                                >
                                {nextFabric} <span className="text-emerald-600 group-hover:text-emerald-800">({nextPlan.client})</span>
                                </div>
                            ) : (
                                <div className="text-red-500 font-medium text-xs flex items-center gap-1">
                                <AlertTriangle size={12} /> No Plan Scheduled
                                </div>
                            )}
                          </div>
                          
                          {/* Print Production Order Button - Always Visible */}
                          {nextPlan && (
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (linkedWrapper) {
                                        // Calculate active machines for this fabric
                                        const active = machines
                                            .filter(m => m.material === linkedWrapper.data.material)
                                            .map(m => m.machineName);
                                        
                                        setProdModal({
                                            isOpen: true,
                                            order: linkedWrapper.data,
                                            ref: linkedWrapper.ref,
                                            activeMachines: active,
                                            plannedMachines: [],
                                            clientName: nextPlan.client
                                        });
                                    } else {
                                        // Not linked? Go to order page to fix/create
                                        if (onNavigateToOrder) {
                                           onNavigateToOrder(nextPlan.client || nextPlan.orderName || '', nextPlan.fabric);
                                        } else {
                                           alert("Order not found in system. Please go to Orders page to create it.");
                                        }
                                    }
                                }}
                                className={`ml-2 p-1.5 rounded-md transition-all flex items-center gap-1 flex-shrink-0 ${
                                    linkedWrapper?.data.isPrinted 
                                    ? "text-green-600 bg-green-50 hover:bg-green-100 border border-green-200" 
                                    : linkedWrapper
                                        ? "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 border border-transparent"
                                        : "text-slate-300 hover:text-blue-600 hover:bg-blue-50 border border-transparent dashed-border" // Unlinked state
                                }`}
                                title={
                                    linkedWrapper 
                                    ? (linkedWrapper.data.isPrinted 
                                        ? `Printed on ${linkedWrapper.data.printedAt ? new Date(linkedWrapper.data.printedAt!).toLocaleDateString('en-GB') : 'Unknown Date'}` 
                                        : "Print Production Order")
                                    : "Order not linked - Click to go to Orders Page"
                                }
                             >
                                <FileText className="w-4 h-4" />
                                {linkedWrapper?.data.isPrinted && (
                                    <span className="text-[10px] font-bold">
                                        Printed
                                    </span>
                                )}
                             </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Low Stock Alerts Section */}
          {lowStockMachines.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-amber-600 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle size={16} />
                Low Stock Alerts
                <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full">
                  {lowStockMachines.length}
                </span>
              </h3>
              
              <div className="grid gap-3 sm:grid-cols-2">
                {lowStockMachines.map((m) => {
                  const hasPlans = m.futurePlans && m.futurePlans.length > 0;
                  const nextPlan = hasPlans ? m.futurePlans[0] : null;
                  const { shortName: nextFabric } = nextPlan ? parseFabricName(nextPlan.fabric) : { shortName: '-' };

                  const linkedWrapper = findLinkedOrder(nextPlan);

                  return (
                    <div key={m.id} className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-gray-800">{m.machineName}</div>
                        <div className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-bold">
                          {m.remainingMfg} kg left
                        </div>
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex flex-col w-full">
                          <span className="text-gray-500 text-xs mb-0.5">Running:</span>
                          <span className="font-medium text-gray-900 break-words whitespace-normal text-right bg-white/50 px-1 rounded" dir="auto" title={m.fabric || m.material}>
                             {parseFabricName(m.fabric || m.material).shortName}
                          </span>
                        </div>

                        <div className="mt-2 pt-2 border-t border-amber-100 flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-1">Next Up:</div>
                            {nextPlan ? (
                                <div 
                                className="font-medium text-amber-900 cursor-pointer hover:underline hover:text-amber-950 group"
                                onClick={() => {
                                    if (onNavigateToOrder) {
                                    onNavigateToOrder(nextPlan.client || '', nextPlan.fabric);
                                    }
                                }}
                                >
                                {nextFabric} <span className="text-amber-700 group-hover:text-amber-900">({nextPlan.client})</span>
                                </div>
                            ) : (
                                <div className="text-red-500 font-medium text-xs flex items-center gap-1">
                                <AlertTriangle size={12} /> No Plan Scheduled
                                </div>
                            )}
                          </div>

                          {/* Print Production Order Button */}
                          {nextPlan && (
                             <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (linkedWrapper) {
                                        // Calculate active machines for this fabric
                                        const active = machines
                                            .filter(m => m.material === linkedWrapper.data.material)
                                            .map(m => m.machineName);
                                        
                                        setProdModal({
                                            isOpen: true,
                                            order: linkedWrapper.data,
                                            ref: linkedWrapper.ref,
                                            activeMachines: active,
                                            plannedMachines: [],
                                            clientName: nextPlan.client
                                        });
                                    } else {
                                        // Not linked? Go to order page to fix/create
                                        if (onNavigateToOrder) {
                                           onNavigateToOrder(nextPlan.client || nextPlan.orderName || '', nextPlan.fabric);
                                        } else {
                                           alert("Order not found in system. Please go to Orders page to create it.");
                                        }
                                    }
                                }}
                                className={`ml-2 p-1.5 rounded-md transition-all flex items-center gap-1 flex-shrink-0 ${
                                    linkedWrapper?.data.isPrinted 
                                    ? "text-green-600 bg-green-50 hover:bg-green-100 border border-green-200" 
                                    : linkedWrapper
                                        ? "text-slate-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent"
                                        : "text-slate-300 hover:text-blue-600 hover:bg-blue-50 border border-transparent dashed-border" // Unlinked state
                                }`}
                                title={
                                    linkedWrapper 
                                    ? (linkedWrapper.data.isPrinted 
                                        ? `Printed on ${linkedWrapper.data.printedAt ? new Date(linkedWrapper.data.printedAt!).toLocaleDateString('en-GB') : 'Unknown Date'}` 
                                        : "Print Production Order")
                                    : "Order not linked - Click to go to Orders Page"
                                }
                             >
                                <FileText className="w-4 h-4" />
                                {linkedWrapper?.data.isPrinted && (
                                    <span className="text-[10px] font-bold">
                                        Printed
                                    </span>
                                )}
                             </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hidden Debug Area for Troubleshooting */}
          <details className="pt-8 border-t border-gray-100">
            <summary className="text-[10px] text-gray-300 cursor-pointer hover:text-gray-500 select-none">Debug Data</summary>
            <div className="mt-2 p-2 bg-slate-100 rounded text-[10px] font-mono text-slate-600 overflow-x-auto">
              <div className="mb-2 font-bold">Total Machines: {machines.length}</div>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="py-1">ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Rem</th>
                    <th>Prod</th>
                    <th>IsFinished?</th>
                    <th>IsLow?</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.slice(0, 10).map(m => {
                    const rem = Number(m.remainingMfg) || 0;
                    const prod = Number(m.dayProduction) || 0;
                    const isFinished = rem === 0 && prod > 0;
                    const isLow = m.status === MachineStatus.WORKING && rem < 100 && rem > 0;
                    return (
                      <tr key={m.id} className="border-b border-gray-200">
                        <td className="py-1">{m.machineId || m.id}</td>
                        <td>{m.machineName}</td>
                        <td className={m.status === MachineStatus.WORKING ? 'text-green-600' : ''}>{m.status}</td>
                        <td>{m.remainingMfg}</td>
                        <td>{m.dayProduction}</td>
                        <td>{isFinished ? 'YES' : '-'}</td>
                        <td>{isLow ? 'YES' : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {machines.length > 10 && <div className="mt-2 italic">... and {machines.length - 10} more</div>}
            </div>
          </details>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium shadow-sm transition-colors"
          >
            Close
          </button>
        </div>

        {/* --- MODALS --- */}
        {prodModal.isOpen && prodModal.order && (
            <FabricProductionOrderModal
                isOpen={prodModal.isOpen}
                onClose={() => setProdModal({ ...prodModal, isOpen: false })}
                order={prodModal.order}
                clientName={prodModal.clientName || prodModal.order.customerName || 'Unknown'}
                fabric={fabrics.find(f => f.name === prodModal.order?.material)}
                activeMachines={prodModal.activeMachines}
                plannedMachines={prodModal.plannedMachines}
                allYarns={yarns}
                // Optional: Pass machines if modal uses them for specific logic, though not strict req
                onMarkPrinted={() => {
                    if (prodModal.ref) {
                        const now = new Date().toISOString();
                        handleUpdateOrder(prodModal.ref, { isPrinted: true, printedAt: now });
                        // Update local state optimistically or wait for snapshot
                        // Snapshot is fast enough usually.
                    }
                }}
            />
        )}
      </div>
    </div>
  );
};
