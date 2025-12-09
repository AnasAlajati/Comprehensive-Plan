import React, { useState, useEffect, useCallback } from 'react';
import { DataService } from '../services/dataService';
import { CustomerOrder, MachineRow, PlanItem } from '../types';
import { ChevronDown, ChevronRight, Package, AlertCircle, Activity, Calendar, Plus } from 'lucide-react';
import { AddOrderModal } from './AddOrderModal';

interface FabricStatus {
  fabricName: string;
  orderReference: string; // NEW: Order Reference
  totalPlanned: number;
  currentRemaining: number;
  activeMachines: string[];
  plannedMachines: string[];
  plans: {
    machineName: string;
    startDate: string;
    quantity: number;
    remaining: number;
    status: string;
  }[];
}

export const OrderSSPage: React.FC = () => {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [ordersData, machinesData] = await Promise.all([
        DataService.getCustomerOrders(),
        DataService.getMachinesFromMachineSS()
      ]);
      setOrders(ordersData);
      setMachines(machinesData);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleClient = (clientName: string) => {
    setExpandedClient(expandedClient === clientName ? null : clientName);
  };

  // Helper to aggregate real-time status for a specific client and fabric
  const getFabricStatus = (clientName: string, fabricName: string, storedReference?: string): FabricStatus => {
    // Use stored reference if available, otherwise generate fallback
    const fabricInitials = fabricName.split(/[\s-]+/).map((w: string) => w[0]).join('');
    const orderReference = storedReference || `${clientName}-${fabricInitials}`;

    const status: FabricStatus = {
      fabricName,
      orderReference,
      totalPlanned: 0,
      currentRemaining: 0,
      activeMachines: [],
      plannedMachines: [],
      plans: []
    };

    machines.forEach(machine => {
      // Check Active Status (Daily Logs / Current State)
      const isWorking = machine.status === 'Working';
      const isClientMatch = machine.client === clientName;
      const isFabricMatch = machine.material === fabricName;

      if (isWorking && isClientMatch && isFabricMatch) {
        // Fallback for machine name: machineName -> name -> id
        const name = machine.machineName || machine.name || `Machine ${machine.id}`;
        status.activeMachines.push(name);
        status.currentRemaining += Number(machine.remainingMfg) || 0;
        
        status.plans.push({
          machineName: name,
          startDate: 'Now',
          quantity: Number(machine.dayProduction) || 0, // Showing daily prod as "qty" context for active
          remaining: Number(machine.remainingMfg) || 0,
          status: 'Active'
        });
      }

      // Check Future Plans
      if (machine.futurePlans) {
        machine.futurePlans.forEach(plan => {
          if (plan.client === clientName && plan.fabric === fabricName) {
            status.totalPlanned += Number(plan.quantity) || 0;
            const name = machine.machineName || machine.name || `Machine ${machine.id}`;
            status.plannedMachines.push(name);
            
            // If not already counted in active (avoid double counting if plan is current)
            // Simple check: if plan start date is in future
            status.plans.push({
              machineName: name,
              startDate: plan.startDate || 'Pending',
              quantity: Number(plan.quantity) || 0,
              remaining: Number(plan.remaining) || 0,
              status: 'Planned'
            });
          }
        });
      }
    });

    // Deduplicate machine names
    status.activeMachines = Array.from(new Set(status.activeMachines));
    status.plannedMachines = Array.from(new Set(status.plannedMachines));

    return status;
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading orders...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">OrderSS - Client Orders</h1>
          <div className="text-sm text-slate-500">
            Live Data from {machines.length} Machines
          </div>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Order</span>
        </button>
      </div>
      
      <div className="space-y-4">
        {orders.map((order) => (
          <div key={order.customerName} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <button 
              onClick={() => toggleClient(order.customerName)}
              className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                {expandedClient === order.customerName ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                <span className="font-bold text-lg text-slate-700">Client: {order.customerName}</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                  {order.fabrics.length} Fabrics
                </span>
              </div>
            </button>
            
            {expandedClient === order.customerName && (
              <div className="p-4 border-t border-slate-200 bg-white">
                {order.fabrics.length === 0 ? (
                  <div className="text-center py-4 text-slate-400 italic">No fabrics ordered yet.</div>
                ) : (
                  <div className="grid gap-6">
                    {order.fabrics.map((fabric, idx) => {
                      const liveStatus = getFabricStatus(order.customerName, fabric.fabricName, fabric.orderReference);
                      
                      return (
                        <div key={idx} className="rounded-xl border border-slate-200 overflow-hidden">
                          {/* Fabric Header */}
                          <div className="bg-slate-50/50 p-3 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                                <Package className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-slate-800 text-lg">{fabric.fabricName}</h4>
                                    <span className="text-xs font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded border border-slate-300" title="Order Reference">
                                        {liveStatus.orderReference}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                   {liveStatus.activeMachines.length > 0 && (
                                     <span className="flex items-center gap-1 text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full" title={liveStatus.activeMachines.join(', ')}>
                                       <Activity className="w-3 h-3" /> Active on: {liveStatus.activeMachines.join(', ')}
                                     </span>
                                   )}
                                   {liveStatus.plannedMachines.length > 0 && (
                                     <span className="flex items-center gap-1 text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full" title={liveStatus.plannedMachines.join(', ')}>
                                       <Calendar className="w-3 h-3" /> Planned on: {liveStatus.plannedMachines.join(', ')}
                                     </span>
                                   )}
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-6 text-right">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Total Planned</div>
                                    <div className="font-bold text-slate-700 text-lg">{liveStatus.totalPlanned.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span></div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Live Remaining</div>
                                    <div className={`font-bold text-lg ${liveStatus.currentRemaining > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                      {liveStatus.currentRemaining.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
                                    </div>
                                </div>
                            </div>
                          </div>

                          {/* Detailed Plans Table */}
                          {liveStatus.plans.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-medium text-xs uppercase tracking-wider">
                                  <tr>
                                    <th className="px-4 py-2">Machine</th>
                                    <th className="px-4 py-2">Status</th>
                                    <th className="px-4 py-2">Start Date</th>
                                    <th className="px-4 py-2 text-right">Qty (kg)</th>
                                    <th className="px-4 py-2 text-right">Remaining (kg)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {liveStatus.plans.map((plan, pIdx) => (
                                    <tr key={pIdx} className="hover:bg-slate-50/50">
                                      <td className="px-4 py-2 font-medium text-slate-700">{plan.machineName}</td>
                                      <td className="px-4 py-2">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${plan.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                          {plan.status}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-slate-500">{plan.startDate}</td>
                                      <td className="px-4 py-2 text-right font-mono text-slate-600">{plan.quantity}</td>
                                      <td className="px-4 py-2 text-right font-mono font-bold text-slate-700">{plan.remaining}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-3 text-center text-xs text-slate-400 italic bg-slate-50/30">
                              No active plans or production for this fabric.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {orders.length === 0 && (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No client orders found in OrderSS.</p>
            </div>
        )}
      </div>

      <AddOrderModal 
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onOrderAdded={() => {
          fetchData();
          setIsAddModalOpen(false);
        }}
        existingClients={orders.map(o => o.customerName)}
      />
    </div>
  );
};

