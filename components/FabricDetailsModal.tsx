import React, { useState, useEffect } from 'react';
import { Fabric, Yarn, YarnComponent, YarnInventoryItem } from '../types';
import { Plus, Trash2, Save, Calculator, X, AlertCircle, Package, Check } from 'lucide-react';
import { DataService } from '../services/dataService';
import { YarnService } from '../services/yarnService';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebase';

interface FabricDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  fabric: Fabric;
  orderQuantity: number;
  allYarns: Yarn[];
  onUpdateFabric: (fabricId: string, updates: Partial<Fabric>) => Promise<void>;
  onAddYarn: (name: string) => Promise<string>; // Returns new yarn ID
  orderId?: string;
  customerId?: string;
  customerName?: string;
  existingAllocations?: Record<string, string>;
  onUpdateOrderAllocations?: (orderId: string, allocations: Record<string, string>) => Promise<void>;
}

export const FabricDetailsModal: React.FC<FabricDetailsModalProps> = ({
  isOpen,
  onClose,
  fabric,
  orderQuantity,
  allYarns,
  onUpdateFabric,
  onAddYarn,
  orderId,
  customerId,
  customerName,
  existingAllocations,
  onUpdateOrderAllocations
}) => {
  const [composition, setComposition] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inventory State
  const [inventoryMap, setInventoryMap] = useState<Map<string, YarnInventoryItem[]>>(new Map());
  const [allocations, setAllocations] = useState<Record<string, string>>(existingAllocations || {}); // yarnId -> lotNumber
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({}); // yarnId -> inventoryYarnName
  const [isSearchingInventory, setIsSearchingInventory] = useState<string | null>(null); // yarnId being searched
  const [inventorySearchResults, setInventorySearchResults] = useState<string[]>([]); // List of yarn names
  const [inventorySearchTerm, setInventorySearchTerm] = useState('');
  const [persistentMappings, setPersistentMappings] = useState<Record<string, string>>({}); // sourceName -> targetName

  useEffect(() => {
    if (isOpen && fabric) {
      setComposition(fabric.yarnComposition || []);
    }
    if (isOpen && existingAllocations) {
        setAllocations(existingAllocations);
    }
    // Load persistent mappings
    if (isOpen) {
        YarnService.getMappings().then(mappings => {
            const map: Record<string, string> = {};
            Object.values(mappings).forEach(m => {
                map[m.sourceName] = m.targetYarnName;
            });
            setPersistentMappings(map);
        });
    }
  }, [isOpen, fabric, existingAllocations]);

  // Fetch Inventory for relevant yarns
  useEffect(() => {
    const fetchInventory = async () => {
      if (!isOpen || !fabric || !fabric.yarnComposition || fabric.yarnComposition.length === 0) return;
      if (!orderId) return; // Only fetch if in order context

      setLoadingInventory(true);
      const map = new Map<string, YarnInventoryItem[]>();
      
      try {
        const yarnNames = fabric.yarnComposition.map(c => {
            // 1. Check manual session mapping
            if (manualMapping[c.yarnId]) return manualMapping[c.yarnId];
            
            // 2. Check persistent mapping
            const y = allYarns.find(y => y.id === c.yarnId);
            if (y && persistentMappings[y.name]) return persistentMappings[y.name];

            // 3. Default to yarn name
            return y ? y.name : null;
        }).filter(Boolean) as string[];

        if (yarnNames.length > 0) {
            // Chunk queries if > 10 (Firestore limit)
            const chunks = [];
            // Deduplicate names to avoid unnecessary queries
            const uniqueNames = Array.from(new Set(yarnNames));
            
            for (let i = 0; i < uniqueNames.length; i += 10) {
                chunks.push(uniqueNames.slice(i, i + 10));
            }

            for (const chunk of chunks) {
                const q = query(collection(db, 'yarn_inventory'), where('yarnName', 'in', chunk));
                const snapshot = await getDocs(q);
                snapshot.docs.forEach(doc => {
                    const item = { id: doc.id, ...doc.data() } as YarnInventoryItem;
                    
                    // Find which yarnId this inventory item belongs to
                    // It could match by name OR by manual mapping OR persistent mapping
                    
                    // Check all yarns in composition
                    fabric.yarnComposition.forEach(comp => {
                        const y = allYarns.find(y => y.id === comp.yarnId);
                        if (!y) return;

                        let match = false;
                        // Direct match
                        if (y.name === item.yarnName) match = true;
                        // Manual match
                        if (manualMapping[comp.yarnId] === item.yarnName) match = true;
                        // Persistent match
                        if (persistentMappings[y.name] === item.yarnName) match = true;

                        if (match) {
                            const list = map.get(comp.yarnId) || [];
                            // Avoid duplicates if multiple rules match
                            if (!list.find(i => i.id === item.id)) {
                                list.push(item);
                                map.set(comp.yarnId, list);
                            }
                        }
                    });
                });
            }
        }
        setInventoryMap(map);
      } catch (err) {
        console.error("Error fetching inventory:", err);
      } finally {
        setLoadingInventory(false);
      }
    };

    fetchInventory();
  }, [isOpen, fabric, allYarns, orderId, manualMapping, persistentMappings]);

  const handleSearchInventory = async (term: string) => {
    setInventorySearchTerm(term);
    if (term.length < 2) {
        setInventorySearchResults([]);
        return;
    }
    
    try {
        const items = await YarnService.searchInventory(term);
        const names = new Set<string>();
        items.forEach(i => names.add(i.yarnName));
        setInventorySearchResults(Array.from(names));
    } catch (e) {
        console.error(e);
    }
  };

  const handleSelectInventoryMapping = async (yarnId: string, inventoryName: string) => {
    // Update local state immediately
    setManualMapping(prev => ({ ...prev, [yarnId]: inventoryName }));
    setIsSearchingInventory(null);
    setInventorySearchTerm('');

    // Save persistent mapping
    const y = allYarns.find(y => y.id === yarnId);
    if (y) {
        try {
            await YarnService.saveMapping(y.name, 'unknown_id', inventoryName);
            setPersistentMappings(prev => ({ ...prev, [y.name]: inventoryName }));
        } catch (e) {
            console.error("Failed to save persistent mapping", e);
        }
    }
  };


  const handleAllocationChange = (yarnId: string, lotNumber: string) => {
    setAllocations(prev => ({ ...prev, [yarnId]: lotNumber }));
  };

  const handleSaveAllocations = async () => {
    if (!orderId || !customerId || !onUpdateOrderAllocations) return;
    
    setIsSaving(true);
    try {
        // 1. Update Order
        await onUpdateOrderAllocations(orderId, allocations);

        // 2. Update Inventory (Tagging)
        const updates = Object.entries(allocations).map(async ([yarnId, lotNumber]) => {
            const items = inventoryMap.get(yarnId);
            const item = items?.find(i => i.lotNumber === lotNumber);
            
            // Calculate quantity for this specific yarn
            const comp = composition.find(c => c.yarnId === yarnId);
            let allocatedQty = 0;
            if (comp) {
                 const baseWeight = (orderQuantity * (parseFloat(comp.percentage) || 0)) / 100;
                 const scrapFactor = 1 + ((parseFloat(comp.scrapPercentage) || 0) / 100);
                 allocatedQty = baseWeight * scrapFactor;
            }
            
            // Ensure valid number
            if (isNaN(allocatedQty)) allocatedQty = 0;

            if (item) {
                const allocationEntry = {
                    orderId,
                    customerId,
                    clientName: customerName || 'Unknown Client',
                    fabricName: fabric.name,
                    quantity: allocatedQty,
                    timestamp: new Date().toISOString()
                };
                const itemRef = doc(db, 'yarn_inventory', item.id);
                await updateDoc(itemRef, {
                    allocations: arrayUnion(allocationEntry)
                });
            }
        });
        
        await Promise.all(updates);
        alert("Allocations saved successfully!");
    } catch (err) {
        console.error("Error saving allocations:", err);
        setError("Failed to save allocations.");
    } finally {
        setIsSaving(false);
    }
  };

  if (!isOpen || !fabric) return null;

  const totalPercentage = composition.reduce((sum, item) => sum + (parseFloat(item.percentage) || 0), 0);
  
  // Calculate total yarn needed including scrap
  const totalYarnNeeded = composition.reduce((sum, comp) => {
    const baseWeight = (orderQuantity * (parseFloat(comp.percentage) || 0)) / 100;
    const scrapFactor = 1 + ((parseFloat(comp.scrapPercentage) || 0) / 100);
    return sum + (baseWeight * scrapFactor);
  }, 0);

  const handleAddRow = () => {
    setComposition([...composition, { yarnId: '', percentage: 0, scrapPercentage: 0 }]);
  };

  const handleRemoveRow = (index: number) => {
    const newComp = [...composition];
    newComp.splice(index, 1);
    setComposition(newComp);
  };

  const handleUpdateRow = (index: number, field: keyof YarnComponent, value: any) => {
    const newComp = [...composition];
    newComp[index] = { ...newComp[index], [field]: value };
    setComposition(newComp);
  };

  const handleSave = async () => {
    if (Math.abs(totalPercentage - 100) > 0.1 && composition.length > 0) {
        if (!confirm(`Total percentage is ${totalPercentage}%. Do you want to save anyway?`)) {
            return;
        }
    }

    setIsSaving(true);
    setError(null);
    try {
      // Ensure numbers are saved as numbers
      const cleanComposition = composition.map(c => ({
        ...c,
        percentage: parseFloat(c.percentage) || 0,
        scrapPercentage: parseFloat(c.scrapPercentage) || 0
      }));
      await onUpdateFabric(fabric.id!, { yarnComposition: cleanComposition });
      onClose();
    } catch (err) {
      console.error("Error saving fabric composition:", err);
      setError("Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get yarn name by ID
  const getYarnName = (id: string) => {
    return allYarns.find(y => y.id === id)?.name || id;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-600" />
              Yarn Composition
            </h2>
            <p className="text-sm text-slate-500">
              Fabric: <span className="font-medium text-slate-700">{fabric.name}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          
          {/* Order Context */}
          <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-100 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Order Quantity</span>
              <div className="text-2xl font-bold text-blue-900">{orderQuantity.toLocaleString()} <span className="text-sm font-normal text-blue-600">kg</span></div>
            </div>
            <div className="text-right">
               <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Total Yarn Needed</span>
               <div className="text-2xl font-bold text-blue-900">
                 {totalYarnNeeded.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-blue-600">kg</span>
               </div>
            </div>
          </div>

          {/* Composition Table */}
          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
              <div className="col-span-5">Yarn Type</div>
              <div className="col-span-2 text-right">Percentage</div>
              <div className="col-span-2 text-right">Scrap %</div>
              <div className="col-span-2 text-right">Required (kg)</div>
              <div className="col-span-1"></div>
            </div>

            {composition.map((comp, index) => {
              const baseWeight = (orderQuantity * (comp.percentage || 0)) / 100;
              const scrapFactor = 1 + ((comp.scrapPercentage || 0) / 100);
              const requiredWeight = baseWeight * scrapFactor;

              return (
              <div key={index} className="grid grid-cols-12 gap-4 items-center bg-slate-50 p-2 rounded-md border border-slate-200 group hover:border-blue-300 transition-colors">
                
                {/* Yarn Selector */}
                <div className="col-span-5">
                  <YarnSelector 
                    value={comp.yarnId} 
                    yarns={allYarns}
                    onChange={(val) => handleUpdateRow(index, 'yarnId', val)}
                    onAddYarn={onAddYarn}
                  />
                </div>

                {/* Percentage Input */}
                <div className="col-span-2 relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={comp.percentage}
                    onChange={(e) => handleUpdateRow(index, 'percentage', e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-right focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                  <span className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                </div>

                {/* Scrap Percentage Input */}
                <div className="col-span-2 relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={comp.scrapPercentage || 0}
                    onChange={(e) => handleUpdateRow(index, 'scrapPercentage', e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-right focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm text-orange-600"
                  />
                  <span className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                </div>

                {/* Calculated Weight */}
                <div className="col-span-2 text-right font-mono text-slate-700 font-medium">
                  {requiredWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                </div>

                {/* Delete */}
                <div className="col-span-1 text-center">
                  <button 
                    onClick={() => handleRemoveRow(index)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )})}

            {composition.length === 0 && (
              <div className="text-center py-8 text-slate-400 italic border-2 border-dashed border-slate-200 rounded-lg">
                No yarns defined yet. Add a yarn to start.
              </div>
            )}

            <button
              onClick={handleAddRow}
              className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Yarn Component
            </button>
          </div>

          {/* Yarn Allocation Section (Order Specific) */}
          {orderId && (
            <div className="mt-8 border-t border-slate-200 pt-6">
                <h3 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5 text-indigo-600" />
                    Yarn Allocation (Order Specific)
                </h3>
                
                {loadingInventory ? (
                    <div className="text-center py-4 text-slate-500">Loading inventory data...</div>
                ) : (
                    <div className="space-y-3">
                        <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
                            <div className="col-span-4">Yarn</div>
                            <div className="col-span-2 text-right">Required</div>
                            <div className="col-span-6">Select Lot</div>
                        </div>
                        
                        {composition.map((comp, index) => {
                            const baseWeight = (orderQuantity * (comp.percentage || 0)) / 100;
                            const scrapFactor = 1 + ((comp.scrapPercentage || 0) / 100);
                            const requiredWeight = baseWeight * scrapFactor;
                            const yarnName = getYarnName(comp.yarnId);
                            const lots = inventoryMap.get(comp.yarnId) || [];
                            
                            return (
                                <div key={index} className="grid grid-cols-12 gap-4 items-center bg-indigo-50/50 p-3 rounded-md border border-indigo-100">
                                    <div className="col-span-4 font-medium text-slate-700">
                                        {yarnName}
                                        {manualMapping[comp.yarnId] && (
                                            <div className="text-[10px] text-indigo-600 font-normal">
                                                Mapped to: {manualMapping[comp.yarnId]}
                                            </div>
                                        )}
                                    </div>
                                    <div className="col-span-2 text-right font-mono text-slate-700">
                                        {requiredWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                    </div>
                                    <div className="col-span-6 relative">
                                        {isSearchingInventory === comp.yarnId ? (
                                            <div className="absolute inset-0 z-10 bg-white border border-indigo-300 rounded-md shadow-lg flex flex-col">
                                                <div className="flex items-center border-b border-slate-100 p-1">
                                                    <input 
                                                        autoFocus
                                                        className="flex-1 px-2 py-1 text-sm outline-none"
                                                        placeholder="Search inventory..."
                                                        value={inventorySearchTerm}
                                                        onChange={(e) => handleSearchInventory(e.target.value)}
                                                    />
                                                    <button onClick={() => setIsSearchingInventory(null)} className="p-1 text-slate-400 hover:text-slate-600">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                <div className="flex-1 overflow-y-auto max-h-40 bg-white">
                                                    {inventorySearchResults.map(name => (
                                                        <div 
                                                            key={name}
                                                            onClick={() => handleSelectInventoryMapping(comp.yarnId, name)}
                                                            className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-slate-700"
                                                        >
                                                            {name}
                                                        </div>
                                                    ))}
                                                    {inventorySearchResults.length === 0 && inventorySearchTerm.length > 1 && (
                                                        <div className="px-3 py-2 text-xs text-slate-400 italic">No matches found</div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                {lots.length > 0 ? (
                                                    <select 
                                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                        value={allocations[comp.yarnId] || ''}
                                                        onChange={(e) => handleAllocationChange(comp.yarnId, e.target.value)}
                                                    >
                                                        <option value="">-- Select Lot --</option>
                                                        {lots.map(lot => (
                                                            <option key={lot.id} value={lot.lotNumber}>
                                                                Lot: {lot.lotNumber} (Qty: {lot.quantity}kg)
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-red-500">No stock found.</span>
                                                        <button 
                                                            onClick={() => setIsSearchingInventory(comp.yarnId)}
                                                            className="text-xs text-indigo-600 hover:underline font-medium"
                                                        >
                                                            Find in Inventory
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                
                <div className="mt-4 flex justify-end">
                    <button 
                        onClick={handleSaveAllocations}
                        disabled={isSaving}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                        {isSaving ? 'Saving...' : <><Check className="w-4 h-4" /> Save Allocations</>}
                    </button>
                </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className={`flex items-center gap-2 text-sm font-medium ${Math.abs(totalPercentage - 100) < 0.1 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {Math.abs(totalPercentage - 100) >= 0.1 && <AlertCircle className="w-4 h-4" />}
            Total: {totalPercentage.toFixed(1)}%
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
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : (
                <>
                  <Save className="w-4 h-4" />
                  Save Composition
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Internal Yarn Selector Component
const YarnSelector: React.FC<{
  value: string;
  yarns: Yarn[];
  onChange: (val: string) => void;
  onAddYarn: (name: string) => Promise<string>;
}> = ({ value, yarns, onChange, onAddYarn }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Find current yarn name
  const currentYarn = yarns.find(y => y.id === value);
  const displayName = currentYarn ? currentYarn.name : (value || 'Select Yarn...');

  const filteredYarns = yarns.filter(y => 
    y.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!search) return;
    setLoading(true);
    try {
      const newId = await onAddYarn(search);
      onChange(newId);
      setIsOpen(false);
      setSearch('');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md cursor-pointer hover:border-blue-400 transition-colors flex items-center justify-between"
      >
        <span className={!value ? 'text-slate-400' : 'text-slate-700'}>{displayName}</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-hidden flex flex-col">
          <input
            autoFocus
            type="text"
            className="w-full p-2 border-b border-slate-100 outline-none text-sm"
            placeholder="Search or create..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="overflow-y-auto flex-1">
            {filteredYarns.map(y => (
              <div
                key={y.id}
                onClick={() => {
                  onChange(y.id!);
                  setIsOpen(false);
                }}
                className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm text-slate-700"
              >
                {y.name}
              </div>
            ))}
            {search && !filteredYarns.some(y => y.name.toLowerCase() === search.toLowerCase()) && (
              <div
                onClick={handleCreate}
                className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm text-emerald-600 font-medium border-t border-slate-100"
              >
                {loading ? 'Creating...' : `+ Create "${search}"`}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Overlay to close */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
};
