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
import { DyehouseActiveWorkPage } from './DyehouseActiveWorkPage';
import { DyehouseLateWorkPage } from './DyehouseLateWorkPage';
import { DyehouseDailyMovement } from './DyehouseDailyMovement';
import { DyehouseHistoryPage } from './DyehouseHistoryPage';
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
  FileBarChart,
  Droplets,
  AlertTriangle,
  Activity,
  BarChart2
} from 'lucide-react';

interface DyehouseDirectoryPageProps {
  userRole?: 'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | null;
}

export const DyehouseDirectoryPage: React.FC<DyehouseDirectoryPageProps> = ({ userRole }) => {
  // Allowed roles to edit: admin, dyehouse_colors_manager
  const canEdit = userRole && ['admin', 'dyehouse_colors_manager'].includes(userRole);
  
  const [dyehouses, setDyehouses] = useState<Dyehouse[]>([]);
  // const [inventoryStats, setInventoryStats] = useState<Record<string, number>>({});
  // const [discoveredLocations, setDiscoveredLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newDyehouseName, setNewDyehouseName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Dyehouse | null>(null);
  
  // New State
  const [viewMode, setViewMode] = useState<'directory' | 'global' | 'balance' | 'active-work' | 'late-work' | 'daily-movement' | 'history'>('directory');
  const [selectedMachine, setSelectedMachine] = useState<{ dyehouse: string, capacity: number } | null>(null);
  const [machineCounts, setMachineCounts] = useState<Record<string, { sent: number, planned: number }>>({});
  const [dyehouseStock, setDyehouseStock] = useState<Record<string, number>>({});
  
  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string; name: string; input: string } | null>(null);

  // Fetch Dyehouses
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dyehouses'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Dyehouse));
      setDyehouses(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);


  /* 
  // Inventory Stats & Discovery Logic Removed upon request
  // This blocked logic previously auto-discovered locations from inventory data
  */


  // Calculate Machine Counts and Stock
  useEffect(() => {
    const unsub = onSnapshot(query(collectionGroup(db, 'orders')), (snapshot) => {
      // Use map with Sets to handle grouping by batchGroupId
      const countsMap: Record<string, { sentCmds: Set<string>, plannedCmds: Set<string> }> = {};
      const stock: Record<string, number> = {};
      
      snapshot.docs.forEach(doc => {
        const order = doc.data() as any; // OrderRow

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
            order.dyeingPlan.forEach((batch: any, bIdx: number) => {
              // Smart Dyehouse Display Logic (same as Balance Report)
              const dyehouseName = batch.dyehouse || 
                                   (batch.colorApprovals && batch.colorApprovals.length > 0 ? batch.colorApprovals[0].dyehouseName : '') || 
                                   order.dyehouse || 
                                   '';
              if (!dyehouseName) return;

              // --- Stock Calculation Logic (same as DyehouseBalanceReport) ---
              let totalSent = 0;
              if (batch.sentEvents && Array.isArray(batch.sentEvents) && batch.sentEvents.length > 0) {
                 totalSent = batch.sentEvents.reduce((s: number, e: any) => s + (e.quantity || 0) + (e.accessorySent || 0), 0);
              } else {
                 totalSent = (batch.quantitySentRaw || batch.quantitySent || 0) + (batch.quantitySentAccessory || 0);
              }
              
              if (batch.dateSent || totalSent > 0) {
                 const events = batch.receiveEvents || [];
                 const totalReceivedRaw = events.reduce((s: number, e: any) => s + (e.quantityRaw || 0), 0) + (batch.receivedQuantity || 0);
                 const totalReceivedAccessory = events.reduce((s: number, e: any) => s + (e.quantityAccessory || 0), 0);
                 const totalReceived = totalReceivedRaw + totalReceivedAccessory;

                 let remaining = totalSent - totalReceived;
                 if (remaining < 0) remaining = 0;

                 if (remaining > 0) {
                   stock[dyehouseName] = (stock[dyehouseName] || 0) + remaining;
                 }
              }

              // --- Machine Count Logic ---
              // Only count "Busy" status (Pending/Planned and Sent). Exclude Received/Draft.
              const batchStatus = batch.status || 'draft';
              if (batchStatus === 'draft' || batchStatus === 'received') return;

              // Determine Unique ID for grouping (batchGroupId or docId-batchId)
              const uniqueId = batch.batchGroupId || (batch.id ? `${doc.id}-${batch.id}` : `${doc.id}-${bIdx}`);

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
                if (!countsMap[key]) countsMap[key] = { sentCmds: new Set(), plannedCmds: new Set() };
                
                if (batchStatus === 'sent') {
                    countsMap[key].sentCmds.add(uniqueId);
                } else {
                    // Assume 'pending' or others are 'planned'
                    countsMap[key].plannedCmds.add(uniqueId);
                }
              });
            });
          }
      });
      
      // Convert Sets to counts
      const counts: Record<string, { sent: number, planned: number }> = {};
      Object.entries(countsMap).forEach(([key, val]) => {
          counts[key] = {
              sent: val.sentCmds.size,
              planned: val.plannedCmds.size
          };
      });

      setMachineCounts(counts);
      setDyehouseStock(stock);
    });
    return () => unsub();
  }, []);

  // Combine registered dyehouses with discovered ones
  const allDyehouses = React.useMemo(() => {
    // Only return registered dyehouses, ignore discovered locations
    return [...dyehouses].sort((a, b) => a.name.localeCompare(b.name));
  }, [dyehouses]);


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
    // Find the dyehouse name to show in the modal
    const dyehouse = dyehouses.find(d => d.id === id);
    if (!dyehouse) return;
    
    // Open delete confirmation modal
    setDeleteConfirmation({ id, name: dyehouse.name, input: '' });
  };

  const confirmAndDeleteDyehouse = async () => {
    if (!deleteConfirmation) return;
    
    // Check if input matches "DELETE"
    if (deleteConfirmation.input.toUpperCase() !== 'DELETE') {
      alert('Please type "DELETE" to confirm deletion');
      return;
    }
    
    try {
      await deleteDoc(doc(db, 'dyehouses', deleteConfirmation.id));
      setDeleteConfirmation(null);
    } catch (error) {
      console.error("Error deleting dyehouse:", error);
      alert('Error deleting dyehouse');
    }
  };

  const startEditing = (dyehouse: Dyehouse) => {
    setEditingId(dyehouse.id);
    setEditForm({ ...dyehouse });
  };

  const saveEditing = async () => {
    if (!editForm || !editingId) return;
    try {
      // Update existing dyehouse
      await updateDoc(doc(db, 'dyehouses', editingId), {
        name: editForm.name,
        machines: editForm.machines
      });
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
            <button 
              onClick={() => setViewMode('active-work')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'active-work' ? 'bg-white shadow text-cyan-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Droplets size={16} />
              Active Work
            </button>
            <button 
              onClick={() => setViewMode('late-work')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'late-work' ? 'bg-white shadow text-red-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <AlertTriangle size={16} />
              Late Work
            </button>
            <button 
              onClick={() => setViewMode('daily-movement')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'daily-movement' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Activity size={16} />
              Daily Movement
            </button>
            {userRole === 'admin' && (
              <button 
                onClick={() => setViewMode('history')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'history' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <BarChart2 size={16} />
                History
              </button>
            )}
          </div>

          {viewMode === 'directory' && (
            <button
              onClick={() => canEdit && setIsAdding(true)}
              disabled={!canEdit}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-sm ${!canEdit ? 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-60' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
              title={!canEdit ? 'You do not have permission to add dyehouses' : ''}
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
          <DyehouseBalanceReport userRole={userRole} />
        ) : viewMode === 'active-work' ? (
          <DyehouseActiveWorkPage userRole={userRole} />
        ) : viewMode === 'late-work' ? (
          <DyehouseLateWorkPage />
        ) : viewMode === 'daily-movement' ? (
          <DyehouseDailyMovement />
        ) : viewMode === 'history' ? (
          <DyehouseHistoryPage userRole={userRole} />
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
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200">
                           <Package size={12} />
                           Stock: {(dyehouseStock[dyehouse.name] || 0).toLocaleString()} kg
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => canEdit && startEditing(dyehouse)}
                        disabled={!canEdit}
                        className={`p-1.5 rounded transition-colors ${!canEdit ? 'text-slate-300 cursor-not-allowed opacity-60' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        title={!canEdit ? 'You do not have permission to edit' : ''}
                        onMouseEnter={(e) => {
                          if (!canEdit) {
                            e.currentTarget.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2732%27 height=%2732%27%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%2710%27 fill=%27%23ef4444%27/%3E%3C/svg%3E") 16 16, auto';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!canEdit) {
                            e.currentTarget.style.cursor = 'not-allowed';
                          }
                        }}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => canEdit && handleDeleteDyehouse(dyehouse.id)}
                        disabled={!canEdit}
                        className={`p-1.5 rounded transition-colors ${!canEdit ? 'text-slate-300 cursor-not-allowed opacity-60' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                        title={!canEdit ? 'You do not have permission to delete' : ''}
                        onMouseEnter={(e) => {
                          if (!canEdit) {
                            e.currentTarget.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2732%27 height=%2732%27%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%2710%27 fill=%27%23ef4444%27/%3E%3C/svg%3E") 16 16, auto';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!canEdit) {
                            e.currentTarget.style.cursor = 'not-allowed';
                          }
                        }}
                      >
                          <Trash2 size={16} />
                      </button>
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
                          const itemStats = machineCounts[countKey] || { sent: 0, planned: 0 };
                          const totalActive = itemStats.sent + itemStats.planned;
                          
                          return (
                            <button 
                              key={idx} 
                              onClick={() => setSelectedMachine({ dyehouse: dyehouse.name, capacity: machine.capacity })}
                              className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm hover:border-purple-300 hover:ring-1 hover:ring-purple-200 transition-all gap-2"
                            >
                              <span className="font-mono font-bold text-slate-700">
                                {machine.capacity}kg
                              </span>
                              
                              {totalActive > 0 && (
                                <div className="flex gap-1 text-xs font-medium">
                                  {itemStats.sent > 0 && (
                                    <span className="text-purple-600 bg-purple-50 px-1.5 rounded border border-purple-100">
                                      {itemStats.sent} Sent
                                    </span>
                                  )}
                                  {itemStats.planned > 0 && (
                                    <span className="text-orange-600 bg-orange-50 px-1.5 rounded border border-orange-100">
                                      {itemStats.planned} Planned
                                    </span>
                                  )}
                                </div>
                              )}

                              {machine.count > 1 && (
                                <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full font-medium">
                                  x{machine.count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-slate-400 text-sm italic py-2">
                        No machines configured. Click edit to add.
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
                onClick={() => canEdit && setIsAdding(true)}
                disabled={!canEdit}
                className={`mt-4 font-bold ${!canEdit ? 'text-slate-300 cursor-not-allowed opacity-60' : 'text-purple-600 hover:underline'}`}
                title={!canEdit ? 'You do not have permission to add dyehouses' : ''}
              >
                + Add Dyehouse
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-red-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Delete Dyehouse</h2>
            </div>
            
            <p className="text-slate-600 mb-4">
              You are about to permanently delete <span className="font-bold text-red-600">"{deleteConfirmation.name}"</span>. This action cannot be undone.
            </p>
            
            <p className="text-slate-500 text-sm mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
              To confirm, please type <span className="font-mono font-bold text-red-600">DELETE</span> below:
            </p>
            
            <input
              autoFocus
              type="text"
              value={deleteConfirmation.input}
              onChange={(e) => setDeleteConfirmation({ ...deleteConfirmation, input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && deleteConfirmation.input.toUpperCase() === 'DELETE') {
                  confirmAndDeleteDyehouse();
                }
              }}
              placeholder='Type "DELETE"'
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none mb-6 font-mono"
            />
            
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmation(null)}
                className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAndDeleteDyehouse}
                disabled={deleteConfirmation.input.toUpperCase() !== 'DELETE'}
                className={`flex-1 px-4 py-2 font-medium rounded-lg transition-colors ${
                  deleteConfirmation.input.toUpperCase() === 'DELETE'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-50'
                }`}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

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
