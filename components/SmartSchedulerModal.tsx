import React, { useState, useMemo } from 'react';
import { X, Sparkles, Factory, Cpu, Plus, Trash2, Calculator, ArrowRight, Check, AlertCircle, Zap } from 'lucide-react';
import { OrderRow, MachineSS, FabricDefinition } from '../types';
import { getFabricProductionRate } from '../services/data';

interface Allocation {
  id: string;
  type: 'internal' | 'external';
  // Internal
  machineId?: string;
  machineName?: string;
  machineType?: string;
  productionRate?: number;
  estimatedDays?: number;
  // External
  factoryId?: string;
  factoryName?: string;
  // Common
  quantity: number;
}

interface ExternalFactory {
  id: string;
  name: string;
}

interface SmartSchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  customerName: string;
  machines: MachineSS[];
  externalFactories: ExternalFactory[];
  fabricDefinitions: FabricDefinition[];
  onSave: (allocations: Allocation[]) => Promise<void>;
}

export const SmartSchedulerModal: React.FC<SmartSchedulerModalProps> = ({
  isOpen,
  onClose,
  order,
  customerName,
  machines,
  externalFactories,
  fabricDefinitions,
  onSave
}) => {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'internal' | 'external'>('internal');

  const totalQuantity = order.remainingQty || order.requiredQty || 0;
  const fabric = order.material || '';

  // Filter compatible machines
  const compatibleMachines = useMemo(() => {
    const fabricDef = fabricDefinitions.find(f => 
      f.name === fabric || f.shortName === fabric || fabric?.includes(f.shortName || '')
    );
    
    if (fabricDef?.workCenters && fabricDef.workCenters.length > 0) {
      return machines.filter(m => 
        fabricDef.workCenters.includes(m.name || m.machineName || '')
      );
    }
    return machines;
  }, [machines, fabric, fabricDefinitions]);

  const getProductionRate = (machineId: string) => {
    const machine = machines.find(m => m.id === machineId || String(m.machineid) === machineId);
    const fallback = machine?.avgProduction || machine?.dayProduction || 100;
    return getFabricProductionRate(fabric, machineId, fabricDefinitions, fallback);
  };

  const addInternalMachine = (machineId: string) => {
    if (allocations.some(a => a.type === 'internal' && a.machineId === machineId)) return;
    
    const machine = machines.find(m => m.id === machineId || String(m.machineid) === machineId);
    if (!machine) return;

    const rate = getProductionRate(machineId);
    const remaining = totalQuantity - allocations.reduce((sum, a) => sum + a.quantity, 0);
    const qty = Math.max(0, remaining);

    setAllocations(prev => [...prev, {
      id: `int-${Date.now()}`,
      type: 'internal',
      machineId,
      machineName: machine.name || machine.machineName || `Machine ${machine.machineid}`,
      machineType: machine.type || '',
      productionRate: rate,
      estimatedDays: qty > 0 ? Math.ceil(qty / rate) : 0,
      quantity: qty
    }]);
  };

  const addExternalFactory = (factoryId: string) => {
    if (allocations.some(a => a.type === 'external' && a.factoryId === factoryId)) return;
    
    const factory = externalFactories.find(f => f.id === factoryId);
    if (!factory) return;

    const remaining = totalQuantity - allocations.reduce((sum, a) => sum + a.quantity, 0);

    setAllocations(prev => [...prev, {
      id: `ext-${Date.now()}`,
      type: 'external',
      factoryId,
      factoryName: factory.name,
      quantity: Math.max(0, remaining)
    }]);
  };

  const updateQuantity = (id: string, qty: number) => {
    setAllocations(prev => prev.map(a => {
      if (a.id !== id) return a;
      const updated = { ...a, quantity: qty };
      if (a.type === 'internal' && a.productionRate) {
        updated.estimatedDays = qty > 0 ? Math.ceil(qty / a.productionRate) : 0;
      }
      return updated;
    }));
  };

  const removeAllocation = (id: string) => {
    setAllocations(prev => prev.filter(a => a.id !== id));
  };

  const splitEvenly = () => {
    if (allocations.length === 0) return;
    const perItem = Math.floor(totalQuantity / allocations.length);
    const remainder = totalQuantity % allocations.length;
    
    setAllocations(prev => prev.map((a, idx) => {
      const qty = perItem + (idx < remainder ? 1 : 0);
      const updated = { ...a, quantity: qty };
      if (a.type === 'internal' && a.productionRate) {
        updated.estimatedDays = qty > 0 ? Math.ceil(qty / a.productionRate) : 0;
      }
      return updated;
    }));
  };

  const totalAllocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
  const remaining = totalQuantity - totalAllocated;
  const internalQty = allocations.filter(a => a.type === 'internal').reduce((sum, a) => sum + a.quantity, 0);
  const externalQty = allocations.filter(a => a.type === 'external').reduce((sum, a) => sum + a.quantity, 0);
  const maxDays = Math.max(...allocations.filter(a => a.type === 'internal').map(a => a.estimatedDays || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(allocations);
      onClose();
    } catch (error) {
      console.error("Error saving:", error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-5 text-white">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">Smart Scheduler</h2>
              </div>
              <p className="text-slate-300 text-sm">{fabric} • {customerName}</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Summary Bar */}
          <div className="mt-4 grid grid-cols-5 gap-3 bg-slate-700/50 rounded-xl p-3">
            <div className="text-center">
              <div className="text-2xl font-bold">{totalQuantity.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400 uppercase">Total (kg)</div>
            </div>
            <div className="text-center border-l border-slate-600">
              <div className="text-2xl font-bold text-blue-400">{internalQty.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400 uppercase">Internal</div>
            </div>
            <div className="text-center border-l border-slate-600">
              <div className="text-2xl font-bold text-orange-400">{externalQty.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400 uppercase">External</div>
            </div>
            <div className="text-center border-l border-slate-600">
              <div className={`text-2xl font-bold ${remaining < 0 ? 'text-red-400' : remaining > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {remaining.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 uppercase">Remaining</div>
            </div>
            <div className="text-center border-l border-slate-600">
              <div className="text-2xl font-bold text-purple-400">{maxDays || '-'}</div>
              <div className="text-[10px] text-slate-400 uppercase">Est. Days</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('internal')}
            className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
              activeTab === 'internal' 
                ? 'border-blue-500 text-blue-600 bg-blue-50/50' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Internal Machines
            {allocations.filter(a => a.type === 'internal').length > 0 && (
              <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                {allocations.filter(a => a.type === 'internal').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('external')}
            className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
              activeTab === 'external' 
                ? 'border-orange-500 text-orange-600 bg-orange-50/50' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Factory className="w-4 h-4" />
            External Factories
            {allocations.filter(a => a.type === 'external').length > 0 && (
              <span className="bg-orange-100 text-orange-600 text-xs px-2 py-0.5 rounded-full">
                {allocations.filter(a => a.type === 'external').length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[50vh] overflow-y-auto">
          
          {/* Internal Tab */}
          {activeTab === 'internal' && (
            <div className="space-y-4">
              {/* Add Machine */}
              <div className="flex gap-2">
                <select
                  className="flex-1 p-2.5 border border-slate-200 rounded-lg text-sm bg-white"
                  onChange={(e) => { if (e.target.value) { addInternalMachine(e.target.value); e.target.value = ''; }}}
                  defaultValue=""
                >
                  <option value="">+ Add internal machine...</option>
                  {compatibleMachines
                    .filter(m => !allocations.some(a => a.type === 'internal' && a.machineId === (m.id || String(m.machineid))))
                    .map(m => (
                      <option key={m.id || m.machineid} value={m.id || String(m.machineid)}>
                        {m.name || m.machineName} ({m.brand} - {m.type})
                      </option>
                    ))}
                </select>
              </div>

              {/* Machine List */}
              {allocations.filter(a => a.type === 'internal').map((alloc, idx) => (
                <div key={alloc.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{alloc.machineName}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{alloc.machineType}</span>
                          <span className="text-slate-300">•</span>
                          <span className="flex items-center gap-1 text-amber-600">
                            <Zap className="w-3 h-3" />
                            {alloc.productionRate} kg/day
                          </span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removeAllocation(alloc.id)} className="text-slate-400 hover:text-red-500 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-500 uppercase font-medium">Quantity (kg)</label>
                      <input
                        type="number"
                        value={alloc.quantity}
                        onChange={(e) => updateQuantity(alloc.id, parseInt(e.target.value) || 0)}
                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm"
                        min={0}
                      />
                    </div>
                    <div className="text-center px-4">
                      <div className="text-xl font-bold text-purple-600">{alloc.estimatedDays}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Days</div>
                    </div>
                  </div>
                </div>
              ))}

              {allocations.filter(a => a.type === 'internal').length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <Cpu className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No internal machines selected</p>
                  <p className="text-xs mt-1">Use the dropdown above to add machines</p>
                </div>
              )}
            </div>
          )}

          {/* External Tab */}
          {activeTab === 'external' && (
            <div className="space-y-4">
              {/* Add Factory */}
              <div className="flex gap-2">
                <select
                  className="flex-1 p-2.5 border border-slate-200 rounded-lg text-sm bg-white"
                  onChange={(e) => { if (e.target.value) { addExternalFactory(e.target.value); e.target.value = ''; }}}
                  defaultValue=""
                >
                  <option value="">+ Add external factory...</option>
                  {externalFactories
                    .filter(f => !allocations.some(a => a.type === 'external' && a.factoryId === f.id))
                    .map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
              </div>

              {/* Factory List */}
              {allocations.filter(a => a.type === 'external').map((alloc, idx) => (
                <div key={alloc.id} className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center">
                        <Factory className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{alloc.factoryName}</div>
                        <div className="text-xs text-orange-600">External Production</div>
                      </div>
                    </div>
                    <button onClick={() => removeAllocation(alloc.id)} className="text-slate-400 hover:text-red-500 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-medium">Quantity (kg)</label>
                    <input
                      type="number"
                      value={alloc.quantity}
                      onChange={(e) => updateQuantity(alloc.id, parseInt(e.target.value) || 0)}
                      className="w-full mt-1 p-2 border border-orange-200 rounded-lg text-sm bg-white"
                      min={0}
                    />
                  </div>
                </div>
              ))}

              {allocations.filter(a => a.type === 'external').length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <Factory className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No external factories selected</p>
                  <p className="text-xs mt-1">Use the dropdown above to add factories</p>
                </div>
              )}

              {externalFactories.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                  <strong>Tip:</strong> Create external factories in Planning Schedule → External tab first.
                </div>
              )}
            </div>
          )}
        </div>

        {/* All Allocations Summary */}
        {allocations.length > 0 && (
          <div className="px-5 pb-3">
            <div className="bg-slate-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">All Allocations ({allocations.length})</span>
                <button onClick={splitEvenly} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                  <Calculator className="w-3 h-3" />
                  Split Evenly
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {allocations.map(a => (
                  <span 
                    key={a.id} 
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      a.type === 'internal' 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'bg-orange-100 text-orange-700'
                    }`}
                  >
                    {a.type === 'internal' ? a.machineName : a.factoryName}: {a.quantity.toLocaleString()} kg
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Warnings */}
        {remaining !== 0 && allocations.length > 0 && (
          <div className="px-5 pb-3">
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              remaining < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
            }`}>
              <AlertCircle className="w-4 h-4" />
              {remaining < 0 
                ? `Over-allocated by ${Math.abs(remaining).toLocaleString()} kg` 
                : `${remaining.toLocaleString()} kg not yet allocated`
              }
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-sm text-slate-500">
            {allocations.length} allocation{allocations.length !== 1 ? 's' : ''} configured
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={allocations.length === 0 || saving}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? 'Saving...' : (
                <>
                  <Check className="w-4 h-4" />
                  Apply Schedule
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
