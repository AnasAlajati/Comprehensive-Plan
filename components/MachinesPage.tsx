import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { MachineRow, FabricDefinition, MachineStatus } from '../types';
import { Settings, Box, Info, Search, X } from 'lucide-react';

interface MachinesPageProps {
  machines: MachineRow[];
}

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

export const MachinesPage: React.FC<MachinesPageProps> = ({ machines }) => {
  const [fabrics, setFabrics] = useState<FabricDefinition[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Related Fabrics Modal State
  const [viewingFabricsMachine, setViewingFabricsMachine] = useState<MachineRow | null>(null);
  const [relatedFabrics, setRelatedFabrics] = useState<FabricDefinition[]>([]);

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

  const handleUpdateMachine = async (machineId: number, field: keyof MachineRow, value: string | number) => {
    try {
      const docRef = doc(db, 'MachineSS', machineId.toString());
      await updateDoc(docRef, { [field]: value });
    } catch (err) {
      console.error(`Error updating machine ${machineId} field ${field}:`, err);
      alert('Failed to update machine.');
    }
  };

  const handleViewFabrics = (machine: MachineRow) => {
    const related = fabrics.filter(f => f.workCenters && f.workCenters.includes(machine.machineName));
    setRelatedFabrics(related);
    setViewingFabricsMachine(machine);
  };

  const sortedMachines = [...machines].sort((a, b) => (a.machineName || '').localeCompare(b.machineName || '', undefined, { numeric: true }));

  const filteredMachines = sortedMachines.filter(m => 
    (m.machineName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.brand || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.type || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

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

        {/* Table View */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
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
                          onSave={(val) => handleUpdateMachine(machine.id, 'dia', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.gauge || ''} 
                          onSave={(val) => handleUpdateMachine(machine.id, 'gauge', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.feeders || 0} 
                          type="number"
                          onSave={(val) => handleUpdateMachine(machine.id, 'feeders', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.needles || 0} 
                          type="number"
                          onSave={(val) => handleUpdateMachine(machine.id, 'needles', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.origin || ''} 
                          onSave={(val) => handleUpdateMachine(machine.id, 'origin', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.tubularOpen || 'Tubular'} 
                          type="select"
                          options={['Tubular', 'Open']}
                          onSave={(val) => handleUpdateMachine(machine.id, 'tubularOpen', val)} 
                        />
                      </td>
                      <td className="p-2">
                        <EditableCell 
                          value={machine.tracks || ''} 
                          onSave={(val) => handleUpdateMachine(machine.id, 'tracks', val)} 
                        />
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
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button onClick={() => setViewingFabricsMachine(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


