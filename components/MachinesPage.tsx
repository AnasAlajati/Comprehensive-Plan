import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion, deleteField } from 'firebase/firestore';
import { db } from '../services/firebase';
import { MachineRow, FabricDefinition, MachineStatus } from '../types';
import { Settings, Box, Info, Search, X, Layers, List, AlertTriangle, CheckCircle2, Wrench, Calendar, Plus } from 'lucide-react';
import { MachineMaintenanceModal } from './MachineMaintenanceModal';

interface MachinesPageProps {
  machines: MachineRow[];
}

// Helper to normalize machine type
const getMachineCategory = (type: string = '') => {
  const t = type.toLowerCase();
  if (t.includes('single') || t.includes('jersey') || t.includes('fleece')) return 'Single Jersey';
  if (t.includes('double') || t.includes('rib') || t.includes('interlock')) return 'Double Jersey';
  return 'Other';
};

const EditableCell = ({ 
  value, 
  onSave, 
  type = 'text', 
  className = '',
  options = [] as string[]
}: { 
  value: string | number; 
  onSave: (val: string | number) => void; 
  type?: 'text' | 'number' | 'select';
  className?: string;
  options?: string[];
}) => {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    if (localValue !== value) {
      onSave(localValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  if (type === 'select') {
    return (
      <select
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          onSave(e.target.value);
        }}
        className={`w-full bg-transparent border-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 text-sm ${className}`}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 text-sm transition-all ${className}`}
    />
  );
};

// Helper to calculate engineering differences
const getEngineeringAdvice = (baseNeedles: number, targetNeedles: number) => {
  if (baseNeedles === targetNeedles) return null;
  
  const diff = targetNeedles - baseNeedles;
  const percent = ((diff / baseNeedles) * 100).toFixed(1);
  const isWider = diff > 0;
  
  return {
    diff,
    percent,
    message: isWider 
      ? `Fabric will be ${percent}% WIDER.` 
      : `Fabric will be ${Math.abs(Number(percent))}% NARROWER.`,
    advice: isWider
      ? "Use Stenter to compact width. GSM may decrease if not adjusted."
      : "Use Stenter to stretch width. GSM may increase if not adjusted."
  };
};

export const MachinesPage: React.FC<MachinesPageProps> = ({ machines }) => {
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all'); // 'all', 'single', 'double'
  const [viewMode, setViewMode] = useState<'list' | 'groups'>('list');
  
  // Related Fabrics Modal State
  const [viewingFabricsMachine, setViewingFabricsMachine] = useState<MachineRow | null>(null);
  const [relatedFabrics, setRelatedFabrics] = useState<FabricDefinition[]>([]);

  // Maintenance Modal State
  const [maintenanceMachine, setMaintenanceMachine] = useState<MachineRow | null>(null);
  const [maintenanceInitialView, setMaintenanceInitialView] = useState<'form' | 'history'>('form');

  useEffect(() => {
    fetchAllFabrics();
  }, []);

  const fetchAllFabrics = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'FabricSS'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FabricDefinition));
      setFabrics(data);
    } catch (err) {
      console.error("Error fetching fabrics:", err);
    }
  };

  const handleUpdateMachine = async (machineId: string, field: keyof MachineRow, value: string | number) => {
    try {
      const docRef = doc(db, 'MachineSS', machineId);
      await updateDoc(docRef, { [field]: value });
    } catch (err) {
      console.error(`Error updating machine ${machineId} field ${field}:`, err);
      alert('Failed to update machine.');
    }
  };

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

  const handleViewFabrics = (machine: MachineRow) => {
    const related = fabrics.filter(f => f.workCenters && f.workCenters.includes(machine.machineName));
    setRelatedFabrics(related);
    setViewingFabricsMachine(machine);
  };

  const sortedMachines = [...machines].sort((a, b) => (a.machineName || '').localeCompare(b.machineName || '', undefined, { numeric: true }));

  const filteredMachines = sortedMachines.filter(m => {
    const matchesSearch = (m.machineName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.brand || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.type || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;

    if (filterType === 'all') return true;
    const cat = getMachineCategory(m.type).toLowerCase();
    if (filterType === 'single') return cat.includes('single');
    if (filterType === 'double') return cat.includes('double');
    return true;
  });

  // Grouping Logic
  const machineGroups = useMemo(() => {
    const groups: Record<string, {
      id: string;
      type: string;
      gauge: string;
      subGroups: Record<string, {
        id: string;
        dia: string;
        needles: number;
        machines: MachineRow[];
      }>
    }> = {};

    filteredMachines.forEach(machine => {
      if (machine.type === 'BOUS') return; // Ignore BOUS

      const category = getMachineCategory(machine.type);
      const gauge = machine.gauge || 'Unknown';
      const dia = machine.dia || 'Unknown';
      const needles = machine.needles || 0;

      const groupId = `${category}-${gauge}`;
      const subGroupId = `${dia}-${needles}`;

      if (!groups[groupId]) {
        groups[groupId] = {
          id: groupId,
          type: category,
          gauge: gauge,
          subGroups: {}
        };
      }

      if (!groups[groupId].subGroups[subGroupId]) {
        groups[groupId].subGroups[subGroupId] = {
          id: subGroupId,
          dia: dia,
          needles: needles,
          machines: []
        };
      }

      groups[groupId].subGroups[subGroupId].machines.push(machine);
    });

    // Sort machines within subgroups by Brand (to keep "Brothers" together)
    Object.values(groups).forEach(group => {
      Object.values(group.subGroups).forEach(sub => {
        sub.machines.sort((a, b) => (a.brand || '').localeCompare(b.brand || ''));
      });
    });

    return groups;
  }, [filteredMachines]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="text-slate-600" />
              Machines Directory
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage machine specifications and view linked fabrics</p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <List size={16} />
                List
              </button>
              <button
                onClick={() => setViewMode('groups')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'groups' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Layers size={16} />
                Groups
              </button>
            </div>

            <div className="relative flex items-center gap-2">
               {/* Filter Dropdown */}
               <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 <option value="all">All Types</option>
                 <option value="single">Single Jersey</option>
                 <option value="double">Double (Rib/Interlock)</option>
               </select>

              <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Search machines..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        {viewMode === 'list' ? (
          <>
          {/* Mobile Card View (For Maintenance Focus) */}
          <div className="block md:hidden space-y-3">
             {filteredMachines.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-xl text-slate-400 border border-slate-200">
                    No machines found
                </div>
             ) : filteredMachines.map(machine => (
                 <div key={machine.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3">
                     <div className="flex justify-between items-start">
                         <div>
                             <h3 className="font-bold text-lg text-slate-800">{machine.machineName}</h3>
                             <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                 <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{machine.brand}</span>
                                 <span>•</span>
                                 <span>{machine.type}</span>
                             </div>
                         </div>
                         <div className={`px-2 py-1 rounded-full text-xs font-bold ${
                            machine.status === MachineStatus.WORKING ? 'bg-green-100 text-green-700' :
                            machine.status === MachineStatus.UNDER_OP ? 'bg-yellow-100 text-yellow-700' :
                            machine.status === MachineStatus.NO_ORDER ? 'bg-slate-100 text-slate-600' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {machine.status}
                         </div>
                     </div>

                     <div className="mt-2">
                          {/* Maintenance Display Card */}
                          {machine.lastMaintenance ? (
                            <div className="bg-orange-50/60 border border-orange-100 p-4 rounded-xl mb-3">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="text-[10px] font-bold text-orange-800/60 uppercase tracking-widest mb-0.5">Last Maintenance</div>
                                        <div className="text-2xl font-bold text-slate-800 tracking-tight">
                                           {new Date(machine.lastMaintenance.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('form'); }}
                                        className="p-2 bg-orange-100 hover:bg-orange-200 rounded-lg text-orange-700 transition-colors"
                                    >
                                        <Wrench size={20} />
                                    </button>
                                </div>
                                
                                <div className="p-3 bg-white/80 rounded-lg border border-orange-100 shadow-sm mb-4">
                                   <p className="text-sm text-slate-700 leading-relaxed font-medium">
                                     {machine.lastMaintenance.notes}
                                   </p>
                                </div>
                                
                                {/* Recent Activity Section */}
                                {(machine.maintenanceHistory || []).length > 1 && (
                                    <div className="space-y-3">
                                        <div className="text-[10px] font-bold text-orange-400 uppercase tracking-widest px-1">Recent Activity</div>
                                        <div className="space-y-2">
                                            {[...(machine.maintenanceHistory || [])]
                                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                                .slice(1, 4) // Show up to 3 previous logs
                                                .map((hist, idx) => (
                                                    <div key={idx} className="flex gap-3 items-center p-2.5 bg-white rounded-lg border border-orange-100 shadow-sm">
                                                        <div className="shrink-0 flex flex-col items-center justify-center bg-orange-50 px-2 py-1 rounded border border-orange-100 min-w-[50px]">
                                                            <span className="text-[10px] font-bold text-orange-400 uppercase leading-none">
                                                                {new Date(hist.date).toLocaleDateString(undefined, {month: 'short'})}
                                                            </span>
                                                            <span className="text-sm font-bold text-orange-700 leading-none mt-0.5">
                                                                {new Date(hist.date).toLocaleDateString(undefined, {day: 'numeric'})}
                                                            </span>
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs text-slate-600 line-clamp-1 leading-relaxed font-medium">
                                                                {hist.notes}
                                                            </p>
                                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                                {hist.technician || 'Technician'} • {new Date(hist.createdAt || hist.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    </div>
                                )}
                            </div>
                          ) : (
                             <div className="bg-slate-50 border border-slate-200 border-dashed p-6 rounded-xl flex flex-col items-center justify-center gap-2 mb-3">
                                <Wrench size={24} className="text-slate-300" />
                                <span className="text-sm font-medium text-slate-400">No maintenance history</span>
                             </div>
                          )}

                          {/* Action Buttons Row */}
                          <div className="grid grid-cols-2 gap-3">
                              {(machine.maintenanceHistory || []).length > 0 && (
                                  <button 
                                    onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('history'); }}
                                    className="col-span-1 py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 rounded-xl font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2"
                                  >
                                      <Calendar size={16} />
                                      View History ({machine.maintenanceHistory?.length})
                                  </button>
                              )}
                              
                              <button 
                                onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('form'); }}
                                className={`${(machine.maintenanceHistory || []).length > 0 ? 'col-span-1' : 'col-span-2'} py-3 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2`}
                              >
                                 <Plus size={18} strokeWidth={3} />
                                 Add Log
                              </button>
                          </div>
                     </div>
                 </div>
             ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-xs">
                  <tr>
                    <th className="p-4 border-b border-slate-200 w-32">Machine Name</th>
                    <th className="p-4 border-b border-slate-200 w-32">Status</th>
                    <th className="p-4 border-b border-slate-200 w-32">Brand</th>
                    <th className="p-4 border-b border-slate-200 w-32">Type</th>
                    <th className="p-4 border-b border-slate-200 w-24">Dia</th>
                    <th className="p-4 border-b border-slate-200 w-24">Gauge</th>
                    <th className="p-4 border-b border-slate-200 w-24">Feeders</th>
                    <th className="p-4 border-b border-slate-200 w-24">Needles</th>
                    <th className="p-4 border-b border-slate-200 w-32">Origin</th>
                    <th className="p-4 border-b border-slate-200 w-32">Tubular/Open</th>
                    <th className="p-4 border-b border-slate-200 w-24">Tracks</th>
                    <th className="p-4 border-b border-slate-200 text-center w-32">Maintenance</th>
                    <th className="p-4 border-b border-slate-200 text-center w-32">Linked Fabrics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMachines.length === 0 ? (
                    <tr><td colSpan={12} className="p-8 text-center text-slate-400">No machines found</td></tr>
                  ) : filteredMachines.map(machine => {
                    const linkedCount = fabrics.filter(f => f.workCenters?.includes(machine.machineName)).length;
                    return (
                      <tr key={machine.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="p-4 font-bold text-slate-800">{machine.machineName}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            machine.status === MachineStatus.WORKING ? 'bg-green-100 text-green-700' :
                            machine.status === MachineStatus.UNDER_OP ? 'bg-yellow-100 text-yellow-700' :
                            machine.status === MachineStatus.NO_ORDER ? 'bg-slate-100 text-slate-600' :
                            machine.status === MachineStatus.OUT_OF_SERVICE ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {machine.status}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">{machine.brand}</td>
                        <td className="p-4 text-slate-600">{machine.type}</td>
                        
                        {/* Editable Cells */}
                        <td className="p-2">
                          <EditableCell 
                            value={machine.dia || ''} 
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'dia', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.gauge || ''} 
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'gauge', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.feeders || 0} 
                            type="number"
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'feeders', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.needles || 0} 
                            type="number"
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'needles', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.origin || ''} 
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'origin', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.tubularOpen || 'Tubular'} 
                            type="select"
                            options={['Tubular', 'Open']}
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'tubularOpen', val)} 
                          />
                        </td>
                        <td className="p-2">
                          <EditableCell 
                            value={machine.tracks || ''} 
                            onSave={(val) => handleUpdateMachine(machine.firestoreId || machine.id.toString(), 'tracks', val)} 
                          />
                        </td>
                        
                        {/* Maintenance */}
                        <td className="p-2 text-center">
                          <button
                            onClick={() => { setMaintenanceMachine(machine); setMaintenanceInitialView('form'); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 mx-auto ${
                              machine.lastMaintenance 
                                ? 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100'
                                : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100 hover:text-slate-600'
                            }`}
                          >
                            <Wrench size={12} />
                            {machine.lastMaintenance ? (
                              <span className="font-mono">{new Date(machine.lastMaintenance.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                            ) : (
                              'Log'
                            )}
                          </button>
                        </td>

                        <td className="p-4 text-center">
                          <button 
                            onClick={() => handleViewFabrics(machine)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              linkedCount > 0 
                                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' 
                                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            {linkedCount} Fabrics
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        ) : (
          /* Groups View */
          <div className="space-y-8">
            {Object.values(machineGroups).map(group => (
              <div key={group.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${group.type === 'Single Jersey' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      <Layers size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">{group.type}</h2>
                      <p className="text-sm text-slate-500 font-medium">Gauge: {group.gauge}</p>
                    </div>
                  </div>

                  {/* Engineering Analysis Section */}
                  {Object.values(group.subGroups).length > 1 && (
                    <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
                      <div className="font-bold flex items-center gap-2 mb-1">
                        <Info size={14} />
                        Engineering Analysis (Needle Differences)
                      </div>
                      <div className="space-y-1 pl-5">
                        {(() => {
                          const subGroups = Object.values(group.subGroups).sort((a, b) => a.needles - b.needles);
                          const base = subGroups[0];
                          return subGroups.slice(1).map(target => {
                            const advice = getEngineeringAdvice(base.needles, target.needles);
                            if (!advice) return null;
                            return (
                              <div key={target.id} className="flex gap-2">
                                <span className="font-mono font-semibold">{base.needles}N → {target.needles}N:</span>
                                <span>{advice.message} <span className="opacity-75">({advice.advice})</span></span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {Object.values(group.subGroups).map(sub => (
                    <div key={sub.id} className="border border-slate-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                        <span className="font-bold text-slate-700 text-sm">{sub.dia}" Diameter</span>
                        <span className="text-xs font-mono bg-white px-2 py-1 rounded border border-slate-200 text-slate-500">
                          {sub.needles} Needles
                        </span>
                      </div>
                      
                      <div className="divide-y divide-slate-100">
                        {sub.machines.map(machine => (
                          <div key={machine.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${
                                machine.status === MachineStatus.WORKING ? 'bg-green-500' : 
                                machine.status === MachineStatus.QALB ? 'bg-purple-500' : 'bg-slate-300'
                              }`} />
                              <div>
                                <div className="font-bold text-slate-800 text-sm">{machine.machineName}</div>
                                <div className="text-xs text-slate-500">{machine.brand}</div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                {machine.tracks && (
                                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200" title="Tracks">
                                        {machine.tracks}T
                                    </span>
                                )}
                                <button 
                                    onClick={() => handleViewFabrics(machine)}
                                    className="text-slate-400 hover:text-blue-600"
                                    title="View Fabrics"
                                >
                                    <Box size={14} />
                                </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Compatibility Warning for this Sub-Group */}
                      <div className="bg-yellow-50 p-2 text-[10px] text-yellow-800 border-t border-yellow-100 flex items-start gap-1.5">
                        <CheckCircle2 size={12} className="mt-0.5 text-yellow-600" />
                        <span>
                          <strong>Tier 1 & 2 Compatible:</strong> All machines in this box can share fabrics (check Brand differences).
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            {Object.keys(machineGroups).length === 0 && (
               <div className="text-center p-12 text-slate-400">
                  <Info size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium">No machines found</p>
               </div>
            )}
          </div>
        )}
      </div>

      {/* Related Fabrics Modal */}
      {viewingFabricsMachine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Box className="text-purple-600" size={18} />
                Fabrics Linked to {viewingFabricsMachine.machineName}
                <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs">
                  {relatedFabrics.length}
                </span>
              </h3>
              <button onClick={() => setViewingFabricsMachine(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {relatedFabrics.length > 0 ? (
                <div className="grid grid-cols-2 gap-4">
                  {relatedFabrics.map(fabric => (
                    <div key={fabric.id} className="p-4 border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors">
                      <div className="font-bold text-slate-800 mb-1">{fabric.shortName || fabric.name}</div>
                      <div className="text-xs text-slate-500 mb-3 font-mono bg-slate-100 inline-block px-1 rounded">{fabric.code}</div>
                      
                      <div className="space-y-2">
                        {fabric.variants?.map((v, i) => (
                          <div key={i} className="text-xs bg-white border border-slate-200 p-2 rounded">
                            <div className="font-semibold text-slate-400 mb-1">VARIANT {i + 1}</div>
                            {v.yarns.map((y, idx) => (
                              <div key={idx} className="flex justify-between text-slate-600">
                                <span>{y.name}</span>
                                <span className="font-medium">{y.percentage}%</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-12 text-slate-400">
                  <Info size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium">No fabrics linked</p>
                  <p className="text-sm mt-1">Go to the Fabrics page to map Work Centers to this machine.</p>
                </div>
              )}
            </div>
          </div>
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


