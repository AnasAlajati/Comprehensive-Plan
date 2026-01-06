import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  query,
  where,
  getDocs,
  collectionGroup
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { Dyehouse, DyehouseMachine, CustomerSheet } from '../types';
import { DyehouseMachineDetails } from './DyehouseMachineDetails';
import { DyehouseGlobalSchedule } from './DyehouseGlobalSchedule';
import { DyehouseBalanceReport } from './DyehouseBalanceReport';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  Factory, 
  Package, 
  Settings,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  FileBarChart
} from 'lucide-react';

export const DyehouseDirectoryPage: React.FC = () => {
  const [dyehouses, setDyehouses] = useState<Dyehouse[]>([]);
  const [inventoryStats, setInventoryStats] = useState<Record<string, number>>({});
  const [discoveredLocations, setDiscoveredLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newDyehouseName, setNewDyehouseName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Dyehouse | null>(null);
  
  // New State
  const [viewMode, setViewMode] = useState<'directory' | 'global' | 'balance'>('directory');
  const [selectedMachine, setSelectedMachine] = useState<{ dyehouse: string, capacity: number } | null>(null);
  const [machineCounts, setMachineCounts] = useState<Record<string, number>>({});

  // Fetch Dyehouses
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dyehouses'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Dyehouse));
      setDyehouses(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Fetch Inventory Stats & Discover Locations
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dyehouse_inventory'), (snapshot) => {
       const stats: Record<string, number> = {};
       const locations = new Set<string>();
       
       snapshot.docs.forEach(doc => {
         const data = doc.data();
         const location = data.location || 'Unknown';
         stats[location] = (stats[location] || 0) + (Number(data.quantity) || 0);
         if (location !== 'Unknown') {
           locations.add(location);
         }
       });
       
       setInventoryStats(stats);
       setDiscoveredLocations(Array.from(locations));
    });
    return () => unsub();
  }, []);

  // Calculate Machine Counts
  useEffect(() => {
    const unsub = onSnapshot(query(collectionGroup(db, 'orders')), (snapshot) => {
      const counts: Record<string, number> = {};
      
      snapshot.docs.forEach(doc => {
        const order = doc.data() as any; // OrderRow

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
            order.dyeingPlan.forEach((batch: any) => {
              // Skip drafts - only count pending, sent, received
              const batchStatus = batch.status || 'draft';
              if (batchStatus === 'draft') return;
              
              // Determine Dyehouse (Batch override > Order default)
              const dyehouseName = batch.dyehouse || order.dyehouse || '';
              if (!dyehouseName) return;

              // Determine Machine Capacities this batch belongs to
              // Primary: plannedCapacity (explicit machine selection)
              const capacitiesToIncrement = new Set<string>();

              // 1. Planned Capacity (Explicit Machine Selection) - Primary
              if (batch.plannedCapacity) {
                  capacitiesToIncrement.add(String(batch.plannedCapacity));
              }
              // 2. Machine Name Match (Legacy fallback)
              else {
                  const rawMachine = batch.machine || order.dyehouseMachine || '';
                  const machineCapacityFromText = String(rawMachine).replace(/[^0-9]/g, '');
                  
                  if (machineCapacityFromText) {
                      capacitiesToIncrement.add(machineCapacityFromText);
                  }
              }
              
              capacitiesToIncrement.forEach(cap => {
                const key = `${dyehouseName}-${cap}`;
                counts[key] = (counts[key] || 0) + 1;
              });
            });
          }
      });
      
      setMachineCounts(counts);
    });
    return () => unsub();
  }, []);

  // Combine registered dyehouses with discovered ones
  const allDyehouses = React.useMemo(() => {
    const registeredNames = new Set(dyehouses.map(d => d.name));
    const discovered = discoveredLocations
      .filter(loc => !registeredNames.has(loc))
      .map(loc => ({
        id: `temp-${loc}`,
        name: loc,
        machines: [] as DyehouseMachine[],
        isDiscovered: true // Flag to identify auto-detected locations
      }));
    
    return [...dyehouses, ...discovered].sort((a, b) => a.name.localeCompare(b.name));
  }, [dyehouses, discoveredLocations]);


  const handleAddDyehouse = async () => {
    if (!newDyehouseName.trim()) return;
    try {
      await addDoc(collection(db, 'dyehouses'), {
        name: newDyehouseName,
        machines: []
      });
      setNewDyehouseName('');
      setIsAdding(false);
    } catch (error) {
      console.error("Error adding dyehouse:", error);
    }
  };

  const handleDeleteDyehouse = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this dyehouse?')) return;
    try {
      await deleteDoc(doc(db, 'dyehouses', id));
    } catch (error) {
      console.error("Error deleting dyehouse:", error);
    }
  };

  const startEditing = (dyehouse: Dyehouse) => {
    setEditingId(dyehouse.id);
    setEditForm({ ...dyehouse });
  };

  const saveEditing = async () => {
    if (!editForm || !editingId) return;
    try {
      if (editingId.startsWith('temp-')) {
        // Create new dyehouse from discovered location
        await addDoc(collection(db, 'dyehouses'), {
          name: editForm.name,
          machines: editForm.machines
        });
      } else {
        // Update existing dyehouse
        await updateDoc(doc(db, 'dyehouses', editingId), {
          name: editForm.name,
          machines: editForm.machines
        });
      }
      setEditingId(null);
      setEditForm(null);
    } catch (error) {
      console.error("Error updating dyehouse:", error);
    }
  };

  const addMachineToForm = () => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      machines: [...(editForm.machines || []), { capacity: 0, count: 1 }]
    });
  };

  const updateMachineInForm = (index: number, field: keyof DyehouseMachine, value: number) => {
    if (!editForm || !editForm.machines) return;
    const newMachines = [...editForm.machines];
    newMachines[index] = { ...newMachines[index], [field]: value };
    setEditForm({ ...editForm, machines: newMachines });
  };

  const removeMachineFromForm = (index: number) => {
    if (!editForm || !editForm.machines) return;
    const newMachines = editForm.machines.filter((_, i) => i !== index);
    setEditForm({ ...editForm, machines: newMachines });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Factory className="text-purple-600" />
            Dyehouse Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage dyehouses, capacities, and view global schedules</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button 
              onClick={() => setViewMode('directory')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'directory' ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutGrid size={16} />
              Directory
            </button>
            <button 
              onClick={() => setViewMode('global')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'global' ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List size={16} />
              Global Schedule
            </button>
            <button 
              onClick={() => setViewMode('balance')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'balance' ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <FileBarChart size={16} />
              Balance Report
            </button>
          </div>

          {viewMode === 'directory' && (
            <button
              onClick={() => setIsAdding(true)}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-sm"
            >
              <Plus size={18} />
              Add Dyehouse
            </button>
          )}
        </div>
      </div>

      {/* Add Modal/Inline Form */}
      {isAdding && viewMode === 'directory' && (
        <div className="bg-white border-b border-slate-200 px-6 py-4 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3 max-w-md">
            <input
              autoFocus
              type="text"
              placeholder="Dyehouse Name..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
              value={newDyehouseName}
              onChange={(e) => setNewDyehouseName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDyehouse()}
            />
            <button
              onClick={handleAddDyehouse}
              className="bg-emerald-600 text-white p-2 rounded-lg hover:bg-emerald-700"
            >
              <Save size={18} />
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="bg-slate-200 text-slate-600 p-2 rounded-lg hover:bg-slate-300"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {viewMode === 'global' ? (
          <DyehouseGlobalSchedule />
        ) : viewMode === 'balance' ? (
          <DyehouseBalanceReport />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allDyehouses.map((dyehouse) => (
              <div key={dyehouse.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow ${dyehouse.id.startsWith('temp-') ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200'}`}>
                {editingId === dyehouse.id && editForm ? (
                // Edit Mode
                <div className="p-4 space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-slate-700">
                      {dyehouse.id.startsWith('temp-') ? 'Configure New Dyehouse' : 'Edit Dyehouse'}
                    </h3>
                    <div className="flex gap-2">
                      <button onClick={saveEditing} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Save size={18} /></button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 hover:bg-slate-50 p-1 rounded"><X size={18} /></button>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-medium text-slate-500">Machines (Vessels)</label>
                      <button onClick={addMachineToForm} className="text-xs text-purple-600 font-bold hover:underline">+ Add Machine</button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {(editForm.machines || []).map((machine, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-100">
                          <div className="flex-1">
                            <span className="text-[10px] text-slate-400 uppercase">Capacity (kg)</span>
                            <input
                              type="number"
                              value={machine.capacity}
                              onChange={(e) => updateMachineInForm(idx, 'capacity', Number(e.target.value))}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                            />
                          </div>
                          <div className="w-20">
                            <span className="text-[10px] text-slate-400 uppercase">Count</span>
                            <input
                              type="number"
                              value={machine.count}
                              onChange={(e) => updateMachineInForm(idx, 'count', Number(e.target.value))}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                            />
                          </div>
                          <button onClick={() => removeMachineFromForm(idx)} className="text-red-400 hover:text-red-600 mt-4">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                      {(!editForm.machines || editForm.machines.length === 0) && (
                        <div className="text-center py-4 text-slate-400 text-xs italic border border-dashed border-slate-200 rounded">
                          No machines defined
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                // View Mode
                <>
                  <div className="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-slate-800">{dyehouse.name}</h3>
                        {dyehouse.id.startsWith('temp-') && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase rounded tracking-wide">
                            Discovered
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                          <Package size={12} />
                          Stock: {(inventoryStats[dyehouse.name] || 0).toLocaleString()} kg
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditing(dyehouse)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                        <Edit2 size={16} />
                      </button>
                      {!dyehouse.id.startsWith('temp-') && (
                        <button onClick={() => handleDeleteDyehouse(dyehouse.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                      <Settings size={12} />
                      Machine Configuration
                    </h4>
                    
                    {dyehouse.machines && dyehouse.machines.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {dyehouse.machines.map((machine, idx) => {
                          const countKey = `${dyehouse.name}-${machine.capacity}`;
                          const itemCount = machineCounts[countKey] || 0;
                          
                          return (
                            <button 
                              key={idx} 
                              onClick={() => setSelectedMachine({ dyehouse: dyehouse.name, capacity: machine.capacity })}
                              className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm hover:border-purple-300 hover:ring-1 hover:ring-purple-200 transition-all"
                            >
                              <span className="font-mono font-bold text-slate-700">
                                {machine.capacity}kg
                                {itemCount > 0 && (
                                  <span className="ml-1 text-purple-600">({itemCount})</span>
                                )}
                              </span>
                              {machine.count > 1 && (
                                <span className="ml-2 px-1.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">
                                  x{machine.count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-slate-400 text-sm italic py-2">
                        {dyehouse.id.startsWith('temp-') ? 'Click edit to configure machines' : 'No machines configured. Click edit to add.'}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          
          {/* Empty State */}
          {!loading && allDyehouses.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              <Factory size={48} className="mb-4 text-slate-300" />
              <p className="text-lg font-medium">No Dyehouses Found</p>
              <p className="text-sm">Add your first dyehouse to start tracking capacity.</p>
              <button
                onClick={() => setIsAdding(true)}
                className="mt-4 text-purple-600 font-bold hover:underline"
              >
                + Add Dyehouse
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Machine Details Modal */}
      {selectedMachine && (
        <DyehouseMachineDetails
          isOpen={!!selectedMachine}
          onClose={() => setSelectedMachine(null)}
          dyehouseName={selectedMachine.dyehouse}
          machineCapacity={selectedMachine.capacity}
        />
      )}
    </div>
  );
};
