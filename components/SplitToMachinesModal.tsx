import React, { useState, useMemo, useEffect } from 'react';
import { X, Split, Calculator, Factory, Zap, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PlanItem, MachineSS, FabricDefinition } from '../types';
import { getFabricProductionRate } from '../services/data';

interface MachineAllocation {
  machineId: string;
  machineName: string;
  machineType: string;
  quantity: number;
  productionRate: number;
  estimatedDays: number;
}

interface SplitToMachinesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (allocations: MachineAllocation[], splitGroupId: string) => Promise<void>;
  fabric: string;
  client: string;
  totalQuantity: number;
  orderId?: string;
  orderReference?: string;
  machines: MachineSS[];
  fabricDefinitions: FabricDefinition[];
  existingAllocations?: MachineAllocation[];
}

export const SplitToMachinesModal: React.FC<SplitToMachinesModalProps> = ({
  isOpen,
  onClose,
  onSave,
  fabric,
  client,
  totalQuantity,
  orderId,
  orderReference,
  machines,
  fabricDefinitions,
  existingAllocations
}) => {
  const [allocations, setAllocations] = useState<MachineAllocation[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState('');

  // Filter machines that can run this fabric (based on workCenters if defined)
  const compatibleMachines = useMemo(() => {
    const fabricDef = fabricDefinitions.find(f => 
      f.name === fabric || f.shortName === fabric || fabric?.includes(f.shortName || '')
    );
    
    if (fabricDef?.workCenters && fabricDef.workCenters.length > 0) {
      return machines.filter(m => 
        fabricDef.workCenters.includes(m.name || m.machineName || '')
      );
    }
    
    // If no workCenters defined, show all machines
    return machines;
  }, [machines, fabric, fabricDefinitions]);

  // Initialize allocations
  useEffect(() => {
    if (isOpen) {
      if (existingAllocations && existingAllocations.length > 0) {
        setAllocations(existingAllocations);
      } else {
        setAllocations([]);
      }
    }
  }, [isOpen, existingAllocations]);

  const calculateRate = (machineId: string) => {
    const machine = machines.find(m => m.id === machineId || String(m.machineid) === machineId);
    const machineFallback = machine?.avgProduction || machine?.dayProduction || 100;
    return getFabricProductionRate(fabric, machineId, fabricDefinitions, machineFallback);
  };

  const addMachine = () => {
    if (!selectedMachineId) return;
    
    const machine = machines.find(m => m.id === selectedMachineId || String(m.machineid) === selectedMachineId);
    if (!machine) return;
    
    // Check if already added
    if (allocations.some(a => a.machineId === selectedMachineId)) return;

    const rate = calculateRate(selectedMachineId);
    const remainingQty = totalQuantity - allocations.reduce((sum, a) => sum + a.quantity, 0);
    const defaultQty = Math.min(remainingQty, Math.ceil(totalQuantity / (allocations.length + 1)));

    setAllocations(prev => [...prev, {
      machineId: selectedMachineId,
      machineName: machine.name || machine.machineName || `Machine ${machine.machineid}`,
      machineType: machine.type || '',
      quantity: defaultQty,
      productionRate: rate,
      estimatedDays: Math.ceil(defaultQty / rate)
    }]);
    
    setSelectedMachineId('');
  };

  const updateQuantity = (index: number, qty: number) => {
    setAllocations(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        quantity: qty,
        estimatedDays: Math.ceil(qty / updated[index].productionRate)
      };
      return updated;
    });
  };

  const removeAllocation = (index: number) => {
    setAllocations(prev => prev.filter((_, i) => i !== index));
  };

  const splitEvenly = () => {
    if (allocations.length === 0) return;
    
    const perMachine = Math.floor(totalQuantity / allocations.length);
    const remainder = totalQuantity % allocations.length;
    
    setAllocations(prev => prev.map((alloc, idx) => {
      const qty = perMachine + (idx < remainder ? 1 : 0);
      return {
        ...alloc,
        quantity: qty,
        estimatedDays: Math.ceil(qty / alloc.productionRate)
      };
    }));
  };

  const totalAllocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
  const remaining = totalQuantity - totalAllocated;
  const maxDays = Math.max(...allocations.map(a => a.estimatedDays), 0);
  const isValid = allocations.length > 0 && remaining >= 0;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const splitGroupId = `split-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await onSave(allocations, splitGroupId);
      onClose();
    } catch (error) {
      console.error("Error saving split:", error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 text-white">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Split size={24} />
              <div>
                <h3 className="font-bold text-lg">Split to Multiple Machines</h3>
                <p className="text-indigo-100 text-sm">{fabric} • {client}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Summary Card */}
          <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-indigo-600">{totalQuantity.toLocaleString()}</div>
                <div className="text-xs text-indigo-500">Total Qty (kg)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-600">{totalAllocated.toLocaleString()}</div>
                <div className="text-xs text-emerald-500">Allocated</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${remaining < 0 ? 'text-red-600' : remaining > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {remaining.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500">Remaining</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{maxDays || '-'}</div>
                <div className="text-xs text-purple-500">Est. Days</div>
              </div>
            </div>
          </div>

          {/* Add Machine */}
          <div className="flex gap-2">
            <select
              value={selectedMachineId}
              onChange={(e) => setSelectedMachineId(e.target.value)}
              className="flex-1 p-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value="">Select a machine to add...</option>
              {compatibleMachines
                .filter(m => !allocations.some(a => a.machineId === (m.id || String(m.machineid))))
                .map(m => (
                  <option key={m.id || m.machineid} value={m.id || String(m.machineid)}>
                    {m.name || m.machineName} ({m.brand} - {m.type})
                  </option>
                ))}
            </select>
            <button
              onClick={addMachine}
              disabled={!selectedMachineId}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Plus size={16} />
              Add
            </button>
          </div>

          {/* Allocations List */}
          {allocations.length > 0 ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="font-medium text-slate-700">Machine Allocations</h4>
                <button
                  onClick={splitEvenly}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                >
                  <Calculator size={14} />
                  Split Evenly
                </button>
              </div>
              
              {allocations.map((alloc, idx) => (
                <div key={alloc.machineId} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-medium text-slate-800">{alloc.machineName}</span>
                        <span className="text-xs text-slate-400">{alloc.machineType}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        <Zap size={12} className="text-amber-500" />
                        {alloc.productionRate} kg/day
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={alloc.quantity}
                        onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 0)}
                        className="w-24 p-2 border border-slate-200 rounded text-sm text-right"
                        min={0}
                      />
                      <span className="text-xs text-slate-400">kg</span>
                    </div>
                    
                    <div className="text-center w-16">
                      <div className="text-sm font-bold text-purple-600">{alloc.estimatedDays}</div>
                      <div className="text-[10px] text-slate-400">days</div>
                    </div>
                    
                    <button
                      onClick={() => removeAllocation(idx)}
                      className="text-slate-400 hover:text-red-500 p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <Factory size={48} className="mx-auto mb-2 opacity-50" />
              <p>Add machines to split this order</p>
            </div>
          )}

          {/* Warnings */}
          {remaining < 0 && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
              <AlertCircle size={16} />
              <span className="text-sm">Over-allocated by {Math.abs(remaining).toLocaleString()} kg</span>
            </div>
          )}
          
          {remaining > 0 && allocations.length > 0 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
              <AlertCircle size={16} />
              <span className="text-sm">{remaining.toLocaleString()} kg not yet allocated</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            {allocations.length} machine{allocations.length !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isValid || saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <Split size={16} />
                  Create Split Plans
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
