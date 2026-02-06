import React, { useState, useEffect } from 'react';
import { FabricDefinition, FabricVariant } from '../types';
import { X, Copy, Search, Sparkles, AlertCircle, Plus, Trash2, Loader2, Zap } from 'lucide-react';
import { parseFabricName } from '../services/data';

interface FabricFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (fabric: Partial<FabricDefinition>) => Promise<void>;
  initialData?: FabricDefinition | null;
  machines: any[];
  highlightAddVariant?: boolean;
}

// Helper to normalize machine type
const getMachineCategory = (type: string = '') => {
  const t = type.toLowerCase();
  if (t.includes('single') || t.includes('jersey') || t.includes('fleece')) return 'Single Jersey';
  if (t.includes('double') || t.includes('rib') || t.includes('interlock')) return 'Double Jersey';
  return 'Other';
};

export const FabricFormModal: React.FC<FabricFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  machines,
  highlightAddVariant = false
}) => {
  const [isHighlighting, setIsHighlighting] = useState(false);

  // Handle highlight animation for Add Variant button
  useEffect(() => {
    if (isOpen && highlightAddVariant) {
      setIsHighlighting(true);
      const timer = setTimeout(() => setIsHighlighting(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, highlightAddVariant]);
  const [modalForm, setModalForm] = useState<{
    name: string;
    code: string;
    shortName: string;
    workCenters: string[];
    variants: FabricVariant[];
    avgProductionPerDay: number;
    machineOverrides: Record<string, number>;
  }>({ name: '', code: '', shortName: '', workCenters: [], variants: [], avgProductionPerDay: 0, machineOverrides: {} });
  
  const [machineSearch, setMachineSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setModalForm({
          name: initialData.name,
          code: initialData.code || '',
          shortName: initialData.shortName || '',
          workCenters: initialData.workCenters || [],
          variants: initialData.variants ? JSON.parse(JSON.stringify(initialData.variants)) : [],
          avgProductionPerDay: initialData.avgProductionPerDay || 0,
          machineOverrides: initialData.machineOverrides || {}
        });
        setShowOverrides(Object.keys(initialData.machineOverrides || {}).length > 0);
      } else {
        setModalForm({ name: '', code: '', shortName: '', workCenters: [], variants: [], avgProductionPerDay: 0, machineOverrides: {} });
        setShowOverrides(false);
      }
    }
  }, [isOpen, initialData]);

  const handleOdooPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      
      const { code, shortName } = parseFabricName(text);
      setModalForm(prev => ({
        ...prev,
        name: text,
        code,
        shortName
      }));
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  };

  const handleSave = async () => {
    if (!modalForm.name) return;
    setSaving(true);
    try {
      // Pass ID if editing
      await onSave({
        ...modalForm,
        id: initialData?.id
      });
      onClose();
    } catch (error) {
      console.error("Error saving fabric:", error);
    } finally {
      setSaving(false);
    }
  };

  const getFabricDNA = (workCenters: string[]) => {
    if (!workCenters || workCenters.length === 0) return { status: 'No Machines', groups: [] };
    
    const linkedMachines = machines.filter(m => workCenters.includes(m.machineName || m.name));
    if (linkedMachines.length === 0) return { status: 'No Machines', groups: [] };

    // Group by Type + Gauge
    const groupsMap = new Map<string, {
      id: string;
      type: string;
      gauge: string;
      brands: Set<string>;
      machines: any[];
    }>();

    linkedMachines.forEach(m => {
      const key = `${m.type}-${m.gauge}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          id: key,
          type: m.type,
          gauge: m.gauge,
          brands: new Set(),
          machines: []
        });
      }
      const group = groupsMap.get(key)!;
      group.machines.push(m);
      if (m.brand) group.brands.add(m.brand);
    });

    const groups = Array.from(groupsMap.values()).map(g => {
      const brandList = Array.from(g.brands);
      const brandName = brandList.length > 0 ? brandList.join(' & ') : 'Unknown Brand';
      const name = `${brandName} Group`;
      return {
        ...g,
        name,
        brandList
      };
    });

    // Check for conflicting types (Single vs Double)
    const categories = new Set(linkedMachines.map(m => getMachineCategory(m.type)));
    if (categories.has('Single Jersey') && categories.has('Double Jersey')) {
      return { status: 'Conflicting Types', groups };
    }

    if (groups.length > 1) {
      return { status: 'Multiple Groups', groups };
    }

    // Single Group Logic
    const group = groups[0];
    const subGroups = new Set(group.machines.map(m => `${m.dia}-${m.needles}`));
    
    const firstM = group.machines[0];
    const dna = {
      gauge: firstM.gauge,
      dia: firstM.dia,
      needles: firstM.needles,
      type: firstM.type
    };

    return { 
      status: subGroups.size === 1 ? 'Tier 1' : 'Tier 2', 
      groups: [group],
      dna,
      variants: subGroups.size
    };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="font-bold text-slate-800">
            {initialData ? 'Edit Fabric' : 'Add New Fabric'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* ODOO Copy Button */}
          <div className="flex justify-end">
            <button
              onClick={handleOdooPaste}
              className="text-xs flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Copy size={14} />
              Paste from ODOO
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Full Name (ODOO)</label>
            <textarea
              value={modalForm.name}
              onChange={(e) => {
                const val = e.target.value;
                const { code, shortName } = parseFabricName(val);
                setModalForm(prev => ({ ...prev, name: val, code, shortName }));
              }}
              className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-h-[80px]"
              placeholder="Paste full fabric name here..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Code</label>
              <input
                type="text"
                value={modalForm.code}
                onChange={(e) => setModalForm(prev => ({ ...prev, code: e.target.value }))}
                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Short Name</label>
              <input
                type="text"
                value={modalForm.shortName}
                onChange={(e) => setModalForm(prev => ({ ...prev, shortName: e.target.value }))}
                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
              />
            </div>
          </div>

          {/* Production Rate Section */}
          <div className="space-y-3 p-4 bg-amber-50/50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-amber-600" />
              <label className="text-xs font-bold text-amber-700 uppercase">Production Rate (kg/day)</label>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 mb-1 block">Default Rate (All Machines)</label>
                <input
                  type="number"
                  value={modalForm.avgProductionPerDay || ''}
                  onChange={(e) => setModalForm(prev => ({ ...prev, avgProductionPerDay: parseFloat(e.target.value) || 0 }))}
                  placeholder="e.g. 150"
                  className="w-full p-2 border border-amber-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                />
              </div>
              <div className="text-xs text-amber-600 max-w-[150px]">
                Used for scheduling & ETA calculations
              </div>
            </div>

            {/* Machine Exceptions */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowOverrides(!showOverrides)}
                className="text-xs text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"
              >
                <Plus size={12} className={`transition-transform ${showOverrides ? 'rotate-45' : ''}`} />
                {showOverrides ? 'Hide' : 'Add'} Machine Exceptions
              </button>
              
              {showOverrides && (
                <div className="mt-2 space-y-2 p-3 bg-white rounded-lg border border-amber-100">
                  <div className="text-[10px] text-slate-500 mb-2">
                    Override production rate for specific machines (faster/slower than default)
                  </div>
                  
                  {Object.entries(modalForm.machineOverrides).map(([machineId, rate]) => {
                    const machine = machines.find(m => String(m.id) === machineId || m.name === machineId);
                    return (
                      <div key={machineId} className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700 flex-1 truncate">
                          {machine?.name || machine?.machineName || machineId}
                        </span>
                        <input
                          type="number"
                          value={rate}
                          onChange={(e) => {
                            const newVal = parseFloat(e.target.value) || 0;
                            setModalForm(prev => ({
                              ...prev,
                              machineOverrides: { ...prev.machineOverrides, [machineId]: newVal }
                            }));
                          }}
                          className="w-20 p-1.5 text-xs border border-slate-200 rounded"
                          placeholder="kg/day"
                        />
                        <span className="text-[10px] text-slate-400">kg/day</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newOverrides = { ...modalForm.machineOverrides };
                            delete newOverrides[machineId];
                            setModalForm(prev => ({ ...prev, machineOverrides: newOverrides }));
                          }}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  
                  {/* Add New Override */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <select
                      className="flex-1 p-1.5 text-xs border border-slate-200 rounded"
                      onChange={(e) => {
                        const machineId = e.target.value;
                        if (machineId && !modalForm.machineOverrides[machineId]) {
                          setModalForm(prev => ({
                            ...prev,
                            machineOverrides: { ...prev.machineOverrides, [machineId]: prev.avgProductionPerDay || 100 }
                          }));
                        }
                        e.target.value = '';
                      }}
                      defaultValue=""
                    >
                      <option value="">+ Add machine exception...</option>
                      {machines
                        .filter(m => !modalForm.machineOverrides[String(m.id)] && !modalForm.machineOverrides[m.name])
                        .map(m => (
                          <option key={m.id} value={m.name || String(m.id)}>
                            {m.name || m.machineName} ({m.brand} - {m.type})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Linked Machines</label>
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
              <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                 <Search size={14} className="text-slate-400" />
                 <input 
                   type="text" 
                   placeholder="Search machines..." 
                   value={machineSearch}
                   onChange={e => setMachineSearch(e.target.value)}
                   className="w-full text-xs bg-transparent outline-none"
                 />
              </div>
              <div className="max-h-40 overflow-y-auto p-1 space-y-1">
                 {machines
                   .filter(m => (m.name || '').toLowerCase().includes(machineSearch.toLowerCase()))
                   .map((m, idx) => (
                     <label key={`${m.id}-${idx}`} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer transition-colors">
                       <input 
                         type="checkbox"
                         checked={modalForm.workCenters.includes(m.name)}
                         onChange={(e) => {
                           if (e.target.checked) {
                             if (!modalForm.workCenters.includes(m.name)) {
                                setModalForm(prev => ({...prev, workCenters: [...prev.workCenters, m.name]}));
                             }
                           } else {
                             setModalForm(prev => ({...prev, workCenters: prev.workCenters.filter(w => w !== m.name)}));
                           }
                         }}
                         className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                       />
                       <div className="flex flex-col">
                         <span className="text-xs font-medium text-slate-700">{m.name}</span>
                         <span className="text-[10px] text-slate-400">{m.brand} - {m.type}</span>
                       </div>
                     </label>
                 ))}
                 {machines.length === 0 && <div className="p-4 text-center text-xs text-slate-400">No machines found</div>}
              </div>
            </div>
            
            {/* Selected Chips */}
            <div className="flex flex-wrap gap-1 mt-2 min-h-[24px]">
              {Array.from(new Set(modalForm.workCenters)).map((wc, idx) => (
                <span key={`${wc}-${idx}`} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-[10px] font-bold border border-blue-100 flex items-center gap-1 animate-in fade-in zoom-in duration-200">
                  {wc}
                  <button onClick={() => setModalForm(prev => ({...prev, workCenters: prev.workCenters.filter(w => w !== wc)}))} className="hover:text-red-500 transition-colors"><X size={12}/></button>
                </span>
              ))}
            </div>
            
            {/* Live DNA Analysis */}
            {(() => {
               const wcs = modalForm.workCenters;
               if (wcs.length === 0) return null;
               
               const { status, groups, dna, variants } = getFabricDNA(wcs);
               
               return (
                 <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                   <div className="flex items-center gap-2 font-medium text-slate-700">
                     <Sparkles size={14} className="text-blue-500" />
                     <span>DNA Analysis</span>
                   </div>
                   
                   {status === 'No Machines' && (
                     <div className="text-slate-500 italic">No matching machines found in database.</div>
                   )}
                   
                   {groups.map((g, idx) => (
                     <div key={g.id} className="bg-white p-2 rounded border border-slate-200 shadow-sm">
                       <div className="flex justify-between items-start mb-1">
                         <div className="font-bold text-slate-800">{g.name}</div>
                         <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                           {g.gauge}G {g.type}
                         </span>
                       </div>
                       <div className="text-[10px] text-slate-500 mb-2">
                         Possible Machines:
                       </div>
                       <div className="flex flex-wrap gap-1">
                         {g.machines.map(m => (
                           <span key={m.id} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100 text-[10px]">
                             {m.machineName}
                           </span>
                         ))}
                       </div>
                     </div>
                   ))}
                   
                   {status === 'Multiple Groups' && (
                     <div className="text-amber-600 font-medium flex items-center gap-2 mt-2">
                       <AlertCircle size={12} />
                       Fabric has multiple production versions.
                     </div>
                   )}

                   {status === 'Conflicting Types' && (
                     <div className="text-red-600 font-bold flex items-center gap-2 mt-2 p-2 bg-red-50 rounded border border-red-100">
                       <AlertCircle size={16} />
                       <div>
                         <div>Logical Error Detected!</div>
                         <div className="text-[10px] font-normal">
                           Fabric is linked to both Single Jersey and Double Jersey machines. This is physically impossible. Please check your data.
                         </div>
                       </div>
                     </div>
                   )}
                 </div>
               );
            })()}
          </div>

          {/* Variants Section */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-500 uppercase">Variants & Composition</label>
              <button
                onClick={() => setModalForm(prev => ({
                  ...prev,
                  variants: [...prev.variants, { id: `v${Date.now()}`, yarns: [] }]
                }))}
                className={`text-xs flex items-center gap-1 font-medium px-2 py-1 rounded transition-all ${
                  isHighlighting 
                    ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400 ring-offset-1 animate-pulse shadow-lg scale-110' 
                    : 'text-blue-600 hover:text-blue-700'
                }`}
              >
                <Plus size={14} />
                Add Variant
              </button>
            </div>
            
            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
              {modalForm.variants.map((variant, vIdx) => (
                <div key={variant.id || vIdx} className="bg-slate-50 p-3 rounded-lg border border-slate-200 relative group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-slate-400">VARIANT {vIdx + 1}</span>
                    <button
                      onClick={() => setModalForm(prev => ({
                        ...prev,
                        variants: prev.variants.filter((_, i) => i !== vIdx)
                      }))}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {variant.yarns.map((yarn, yIdx) => (
                      <div key={`variant-${variant.id || vIdx}-yarn-${yIdx}`} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Yarn Name"
                          value={yarn.name}
                          onChange={(e) => {
                            const newVariants = [...modalForm.variants];
                            newVariants[vIdx].yarns[yIdx].name = e.target.value;
                            setModalForm(prev => ({ ...prev, variants: newVariants }));
                          }}
                          className="flex-1 p-1.5 text-xs border border-slate-200 rounded"
                        />
                        <input
                          type="number"
                          placeholder="%"
                          value={yarn.percentage}
                          onChange={(e) => {
                            const newVariants = [...modalForm.variants];
                            newVariants[vIdx].yarns[yIdx].percentage = parseFloat(e.target.value) || 0;
                            setModalForm(prev => ({ ...prev, variants: newVariants }));
                          }}
                          className="w-16 p-1.5 text-xs border border-slate-200 rounded"
                        />
                        <input
                          type="number"
                          placeholder="Scrap %"
                          value={yarn.scrapPercentage}
                          onChange={(e) => {
                            const newVariants = [...modalForm.variants];
                            newVariants[vIdx].yarns[yIdx].scrapPercentage = parseFloat(e.target.value) || 0;
                            setModalForm(prev => ({ ...prev, variants: newVariants }));
                          }}
                          className="w-16 p-1.5 text-xs border border-slate-200 rounded"
                        />
                        <button
                          onClick={() => {
                            const newVariants = [...modalForm.variants];
                            newVariants[vIdx].yarns = newVariants[vIdx].yarns.filter((_, i) => i !== yIdx);
                            setModalForm(prev => ({ ...prev, variants: newVariants }));
                          }}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const newVariants = [...modalForm.variants];
                        newVariants[vIdx].yarns.push({ name: '', percentage: 100, scrapPercentage: 0 });
                        setModalForm(prev => ({ ...prev, variants: newVariants }));
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"
                    >
                      <Plus size={12} /> Add Yarn
                    </button>
                  </div>
                </div>
              ))}
              {modalForm.variants.length === 0 && (
                <div className="text-center p-4 text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-lg">
                  No variants defined. Add one to specify yarn composition.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !modalForm.name}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {initialData ? 'Save Changes' : 'Create Fabric'}
          </button>
        </div>
      </div>
    </div>
  );
};
