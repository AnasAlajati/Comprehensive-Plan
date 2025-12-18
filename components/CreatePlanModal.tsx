import React, { useState, useEffect, useMemo } from 'react';
import { OrderRow, MachineRow, PlanItem, MachineStatus } from '../types';
import { DataService } from '../services/dataService';
import { recalculateSchedule } from '../services/data';
import { X, Save, Loader, Calendar, Clock, AlertCircle, CheckCircle2, Factory, Users } from 'lucide-react';

interface CreatePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  customerName: string;
}

export const CreatePlanModal: React.FC<CreatePlanModalProps> = ({
  isOpen,
  onClose,
  order,
  customerName
}) => {
  const [machines, setMachines] = useState<any[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadMachines();
    }
  }, [isOpen]);

  const loadMachines = async () => {
    setLoading(true);
    try {
      const data = await DataService.getMachinesFromMachineSS();
      setMachines(data);
    } catch (err) {
      console.error("Failed to load machines", err);
    } finally {
      setLoading(false);
    }
  };

  const selectedMachine = useMemo(() => {
    return machines.find(m => m.id === selectedMachineId || m.firestoreId === selectedMachineId);
  }, [machines, selectedMachineId]);

  const handleSave = async () => {
    if (!selectedMachineId || !selectedMachine) return;
    setSaving(true);
    try {
      const newPlan: PlanItem = {
        type: 'PRODUCTION',
        fabric: order.material,
        productionPerDay: selectedMachine.avgProduction || 150,
        quantity: order.requiredQty,
        days: 0, // Will be calculated
        startDate: '', // Will be calculated
        endDate: '', // Will be calculated
        remaining: order.requiredQty,
        client: customerName,
        orderName: '', // Optional
        orderReference: order.id, // Link back to order
        notes: order.notes || ''
      };

      const currentPlans = selectedMachine.futurePlans || [];
      const updatedPlans = [...currentPlans, newPlan];
      
      const machineRow: MachineRow = {
        ...selectedMachine,
        dayProduction: Number(selectedMachine.dayProduction) || 0,
        avgProduction: Number(selectedMachine.avgProduction) || 0,
        remainingMfg: Number(selectedMachine.remainingMfg) || 0
      };

      const recalculated = recalculateSchedule(updatedPlans, machineRow);

      await DataService.updateMachineInMachineSS(selectedMachine.firestoreId || selectedMachine.id, {
        futurePlans: recalculated,
        lastUpdated: new Date().toISOString()
      });

      onClose();
      // Ideally show a toast here, but alert is fine for now
    } catch (err) {
      console.error("Failed to create plan", err);
      alert("Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              Schedule Order
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Assign <span className="font-medium text-slate-700">{order.material}</span> ({order.requiredQty} kg) for <span className="font-medium text-slate-700">{customerName}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left Panel: Selection & Info */}
          <div className="w-full md:w-1/3 p-6 border-r border-slate-100 bg-slate-50/30 overflow-y-auto">
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Select Machine</label>
              {loading ? (
                <div className="flex items-center text-slate-500 text-sm p-3 bg-white border rounded-lg">
                  <Loader className="animate-spin mr-2" size={16} /> Loading machines...
                </div>
              ) : (
                <div className="relative">
                  <Factory className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <select
                    value={selectedMachineId}
                    onChange={(e) => setSelectedMachineId(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm shadow-sm appearance-none"
                  >
                    <option value="">-- Choose a Machine --</option>
                    {machines.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name || `Machine ${m.id}`} ({m.brand} - {m.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {selectedMachine && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Current Status</h3>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-600">Status</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      selectedMachine.status === 'Working' ? 'bg-emerald-100 text-emerald-700' :
                      selectedMachine.status === 'Stopped' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {selectedMachine.status || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-600">Current Fabric</span>
                    <span className="text-sm font-medium text-slate-800">{selectedMachine.material || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Remaining</span>
                    <span className="text-sm font-medium text-slate-800">{selectedMachine.remainingMfg?.toLocaleString() || 0} kg</span>
                  </div>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">New Plan Preview</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-blue-700">Quantity:</span>
                      <span className="font-medium text-blue-900">{order.requiredQty} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-blue-700">Est. Duration:</span>
                      <span className="font-medium text-blue-900">
                        {Math.ceil(order.requiredQty / (selectedMachine.avgProduction || 150))} days
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Schedule Visualization */}
          <div className="w-full md:w-2/3 p-6 overflow-y-auto bg-white">
            <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              Machine Schedule
            </h3>
            
            {!selectedMachine ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 min-h-[300px]">
                <Factory className="w-12 h-12 mb-3 opacity-20" />
                <p>Select a machine to view its schedule</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Current Job */}
                {selectedMachine.status === 'Working' && (
                  <div className="relative pl-6 border-l-2 border-emerald-500 pb-6">
                    <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm"></div>
                    <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-emerald-900 text-sm">Currently Running</span>
                        <span className="text-xs text-emerald-600 font-medium">Now</span>
                      </div>
                      <div className="text-sm text-emerald-800">{selectedMachine.material}</div>
                      <div className="text-xs text-emerald-600 mt-1">
                        Client: {selectedMachine.client} • Remaining: {selectedMachine.remainingMfg} kg
                      </div>
                    </div>
                  </div>
                )}

                {/* Future Plans */}
                {selectedMachine.futurePlans?.length > 0 ? (
                  selectedMachine.futurePlans.map((plan: PlanItem, idx: number) => (
                    <div key={idx} className="relative pl-6 border-l-2 border-slate-200 pb-6 last:border-l-0 last:pb-0">
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-slate-300 shadow-sm"></div>
                      <div className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-slate-800 text-sm">{plan.fabric}</span>
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {plan.startDate} — {plan.endDate}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-slate-500 mt-2">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> {plan.client}
                          </span>
                          <span className="font-mono font-medium text-slate-600">
                            {plan.quantity} kg
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-slate-400 text-sm bg-slate-50 rounded-lg border border-dashed border-slate-200">
                    No future plans scheduled
                  </div>
                )}

                {/* New Plan Placeholder */}
                <div className="relative pl-6 border-l-2 border-blue-300 border-dashed pt-2">
                  <div className="absolute -left-[9px] top-2 w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm animate-pulse"></div>
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 border-dashed">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-blue-900 text-sm">New Plan: {order.material}</span>
                      <span className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-0.5 rounded-full">
                        Next Available Slot
                      </span>
                    </div>
                    <div className="text-xs text-blue-700 mt-1">
                      Client: {customerName} • Quantity: {order.requiredQty} kg
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-slate-600 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 rounded-lg transition-all text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedMachineId || saving}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center shadow-sm hover:shadow transition-all text-sm font-medium"
          >
            {saving ? <Loader className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
            Confirm & Add to Schedule
          </button>
        </div>
      </div>
    </div>
  );
};
