import React, { useState, useEffect } from 'react';
import { Fabric, Yarn, YarnComponent, YarnInventoryItem, YarnAllocationItem, FabricDefinition } from '../types';
import { Plus, Trash2, Save, Calculator, X, AlertCircle, Package, Check, MapPin, ChevronDown, CheckCircle2, Search as SearchIcon } from 'lucide-react';
import { DataService } from '../services/dataService';
import { YarnService } from '../services/yarnService';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

interface FabricDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  fabric: FabricDefinition;
  orderQuantity: number;
  allYarns: Yarn[];
  onUpdateFabric: (fabricId: string, updates: Partial<FabricDefinition>) => Promise<void>;
  onAddYarn: (name: string) => Promise<string>; // Returns new yarn ID
  orderId?: string;
  customerId?: string;
  customerName?: string;
  existingAllocations?: Record<string, YarnAllocationItem[]>;
  onUpdateOrderAllocations?: (orderId: string, allocations: Record<string, YarnAllocationItem[]>) => Promise<void>;
  onUpdateOrderVariant?: (variantId: string) => Promise<void>;
  variantId?: string;
}

const normalizeAllocations = (input: Record<string, any>): Record<string, YarnAllocationItem[]> => {
    if (!input) return {};
    const safe: Record<string, YarnAllocationItem[]> = {};
    Object.entries(input).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            safe[key] = value;
        } else if (typeof value === 'string') {
            safe[key] = [{
                lotNumber: value,
                quantity: 0,
                allocatedAt: new Date().toISOString()
            }];
        }
    });
    return safe;
};

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
  onUpdateOrderAllocations,
  variantId
}) => {
  const [composition, setComposition] = useState<any[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [isEditingVariant, setIsEditingVariant] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'composition' | 'allocations'>('composition');

  // Inventory State
  const [inventoryMap, setInventoryMap] = useState<Map<string, YarnInventoryItem[]>>(new Map());
  const [allocations, setAllocations] = useState<Record<string, YarnAllocationItem[]>>(() => normalizeAllocations(existingAllocations || {})); 
  const [prevAllocations, setPrevAllocations] = useState<Record<string, YarnAllocationItem[]>>({}); // To track changes for inventory updates
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({}); // yarnId -> inventoryYarnName
  const [isSearchingInventory, setIsSearchingInventory] = useState<string | null>(null); // yarnId being searched
  const [inventorySearchResults, setInventorySearchResults] = useState<string[]>([]); // List of yarn names
  const [inventorySearchTerm, setInventorySearchTerm] = useState('');
  const [persistentMappings, setPersistentMappings] = useState<Record<string, string>>({}); // sourceName -> targetName
  const [inventoryYarnNames, setInventoryYarnNames] = useState<string[]>([]);

  useEffect(() => {
    const fetchInventoryNames = async () => {
        try {
            // Fetch all inventory items to get unique names
            // Note: This might be heavy if inventory is huge, but necessary for full list
            const snapshot = await getDocs(collection(db, 'yarn_inventory'));
            const names = new Set<string>();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                // Ensure we capture the name exactly as is, trimming only whitespace
                if (data.yarnName && typeof data.yarnName === 'string') {
                    names.add(data.yarnName.trim());
                }
            });
            setInventoryYarnNames(Array.from(names).sort());
        } catch (e) {
            console.error("Error fetching inventory names:", e);
        }
    };
    if (isOpen) {
        fetchInventoryNames();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && fabric) {
        let initialComposition: any[] = [];
        let vId: string | null = null;

        if (variantId && fabric.variants) {
            const v = fabric.variants.find(v => v.id === variantId);
            if (v) {
                vId = v.id;
                initialComposition = v.yarns || [];
            }
        }
        
        // Fallback or default if no specific variant found/requested
        if (!initialComposition.length) {
            if (fabric.variants && fabric.variants.length > 0) {
                vId = fabric.variants[0].id;
                initialComposition = fabric.variants[0].yarns || [];
            } else if (fabric.yarnComposition) {
                vId = null; // Legacy
                initialComposition = fabric.yarnComposition;
            }
        }

        // Auto-link yarnId if missing but name matches an existing yarn
        const resolvedComposition = initialComposition.map(comp => {
            if (!comp.yarnId && comp.name) {
                console.log(`[AutoLink] Trying to link: "${comp.name}"`);
                
                // 1. Try Strict/Trimmed Match
                let matchingYarn = allYarns.find(y => y.name.toLowerCase().trim() === comp.name.toLowerCase().trim());
                
                // 2. Try Robust Match (Ignore spaces and special chars)
                if (!matchingYarn) {
                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
                    const target = normalize(comp.name);
                    console.log(`[AutoLink] Normalized Target: "${target}"`);
                    
                    matchingYarn = allYarns.find(y => {
                        const normY = normalize(y.name);
                        if (normY === target) return true;
                        // Debug: Log close matches?
                        if (normY.includes(target) || target.includes(normY)) {
                            console.log(`[AutoLink] Close match found but not exact: "${y.name}" -> "${normY}"`);
                        }
                        return false;
                    });
                }

                if (matchingYarn) {
                    console.log(`[AutoLink] SUCCESS: Linked to "${matchingYarn.name}" (${matchingYarn.id})`);
                    return { ...comp, yarnId: matchingYarn.id };
                } else {
                    console.log(`[AutoLink] FAILED: No match found for "${comp.name}"`);
                }
            }
            return comp;
        });

        setActiveVariantId(vId);
        setComposition(resolvedComposition);
    }
    if (isOpen && existingAllocations) {
        const safeAllocations = normalizeAllocations(existingAllocations);
        setAllocations(safeAllocations);
        setPrevAllocations(JSON.parse(JSON.stringify(safeAllocations))); // Deep copy
    } else if (isOpen) {
        setAllocations({});
        setPrevAllocations({});
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
      if (!isOpen || !composition || composition.length === 0) return;
      if (!orderId) return; // Only fetch if in order context

      setLoadingInventory(true);
      const map = new Map<string, YarnInventoryItem[]>();
      
      try {
        // Collect all potential names to query (Exact + Loose Matches)
        const namesToQuery = new Set<string>();

        composition.forEach(c => {
            // 1. Check manual session mapping
            if (c.yarnId && manualMapping[c.yarnId]) {
                namesToQuery.add(manualMapping[c.yarnId]);
                return;
            }
            
            const y = allYarns.find(y => y.id === c.yarnId);
            
            if (y) {
                // 2. Check persistent mapping
                if (persistentMappings[y.name]) {
                    namesToQuery.add(persistentMappings[y.name]);
                    return;
                }
                // 3. Default: Add exact name
                namesToQuery.add(y.name);
                
                // 4. Add Loose/Robust Matches from Inventory List
                const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
                const target = normalize(y.name);
                
                inventoryYarnNames.forEach(invName => {
                    if (normalize(invName) === target) {
                        namesToQuery.add(invName);
                    }
                });
            } else if (c.name) {
                // Fallback: Use component name directly if yarnId is missing
                namesToQuery.add(c.name);
                
                const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
                const target = normalize(c.name);

                inventoryYarnNames.forEach(invName => {
                    if (normalize(invName) === target) {
                        namesToQuery.add(invName);
                    }
                });
            }
        });

        const uniqueNames = Array.from(namesToQuery);

        if (uniqueNames.length > 0) {
            // Chunk queries if > 10 (Firestore limit)
            const chunks = [];
            for (let i = 0; i < uniqueNames.length; i += 10) {
                chunks.push(uniqueNames.slice(i, i + 10));
            }

            for (const chunk of chunks) {
                const q = query(collection(db, 'yarn_inventory'), where('yarnName', 'in', chunk));
                const snapshot = await getDocs(q);
                snapshot.docs.forEach(doc => {
                    const item = { id: doc.id, ...doc.data() } as YarnInventoryItem;
                    
                    // Find which yarnId this inventory item belongs to
                    composition.forEach(comp => {
                        // Try to find yarn by ID, or fallback to name matching if ID is missing
                        const y = allYarns.find(y => y.id === comp.yarnId);
                        
                        let match = false;
                        
                        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');

                        if (y) {
                            // Strict Match
                            if (y.name === item.yarnName) match = true;
                            // Loose Match
                            if (y.name.toLowerCase().trim() === item.yarnName.toLowerCase().trim()) match = true;
                            // Robust Match
                            if (normalize(y.name) === normalize(item.yarnName)) match = true;
                            // Persistent Mapping
                            if (persistentMappings[y.name] === item.yarnName) match = true;
                        } else if (comp.name) {
                            // Fallback: Match by component name directly if yarnId is missing
                            if (comp.name === item.yarnName) match = true;
                            if (comp.name.toLowerCase().trim() === item.yarnName.toLowerCase().trim()) match = true;
                            // Robust Match
                            if (normalize(comp.name) === normalize(item.yarnName)) match = true;
                        }

                        // Manual Mapping
                        if (comp.yarnId && manualMapping[comp.yarnId] === item.yarnName) match = true;

                        if (match) {
                            // Use yarnId if available, otherwise we can't map it to a specific component ID yet
                            // But wait, the map key IS the yarnId. If comp.yarnId is missing, we can't store it in the map keyed by yarnId.
                            // However, we just auto-resolved yarnId in useEffect. So comp.yarnId SHOULD be present if the yarn exists.
                            // If it's still missing, it means the yarn doesn't exist in 'yarns' collection.
                            // In that case, we can't really allocate inventory to it until it's created/linked.
                            
                            if (comp.yarnId) {
                                const list = map.get(comp.yarnId) || [];
                                if (!list.find(i => i.id === item.id)) {
                                    list.push(item);
                                    map.set(comp.yarnId, list);
                                }
                            }
                        }
                    });
                });
            }
        }
        setInventoryMap(map);
        
        // Attempt to migrate legacy lotNumber allocations to IDs if possible
        if (existingAllocations) {
            const newAllocations = { ...existingAllocations };
            let changed = false;
            Object.entries(existingAllocations).forEach(([yarnId, val]) => {
                // If value looks like a lot number (not a long ID), try to find it
                // This is a heuristic. IDs are usually 20 chars. Lot numbers are usually shorter.
                const items = map.get(yarnId);
                if (items) {
                    const match = items.find(i => i.lotNumber === val);
                    if (match) {
                        newAllocations[yarnId] = match.id!;
                        changed = true;
                    }
                }
            });
            if (changed) setAllocations(newAllocations);
        }

      } catch (err) {
        console.error("Error fetching inventory:", err);
      } finally {
        setLoadingInventory(false);
      }
    };

    fetchInventory();
  }, [isOpen, composition, allYarns, orderId, manualMapping, persistentMappings, inventoryYarnNames]);

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


  const handleUpdateAllocations = (yarnId: string, newAllocations: YarnAllocationItem[]) => {
    setAllocations(prev => ({ ...prev, [yarnId]: newAllocations }));
  };

  const saveAllocationsInternal = async () => {
    if (!orderId || !customerId || !onUpdateOrderAllocations) return;
    
    try {
        // 1. Update Order
        await onUpdateOrderAllocations(orderId, allocations);

        // 2. Update Inventory
        // Identify all Lot IDs that need to be touched (both added and removed)
        const lotsToUpdate = new Set<string>();
        
        // Add current lots
        Object.values(allocations).flat().forEach(a => {
            if (a.lotId) lotsToUpdate.add(a.lotId);
        });
        
        // Add previous lots (to handle removals)
        Object.values(prevAllocations).flat().forEach(a => {
            if (a.lotId) lotsToUpdate.add(a.lotId);
        });

        const updates: Promise<void>[] = [];

        for (const lotId of lotsToUpdate) {
            updates.push((async () => {
                try {
                    const itemRef = doc(db, 'yarn_inventory', lotId);
                    const docSnap = await getDoc(itemRef);
                    
                    if (!docSnap.exists()) return;
                    
                    const data = docSnap.data();
                    const currentAllocations = data.allocations || [];
                    
                    // Filter out allocations for THIS order and THIS fabric
                    // We replace all allocations for this specific context
                    const otherAllocations = currentAllocations.filter((a: any) => 
                        !(a.orderId === orderId && a.fabricName === fabric.name)
                    );
                    
                    // Find new allocations for this lot from our current state
                    const newAllocationsForLot: any[] = [];
                    Object.values(allocations).flat().forEach(a => {
                        if (a.lotId === lotId) {
                            newAllocationsForLot.push({
                                orderId,
                                customerId,
                                clientName: customerName || 'Unknown Client',
                                fabricName: fabric.name,
                                quantity: a.quantity,
                                timestamp: new Date().toISOString()
                            });
                        }
                    });
                    
                    await updateDoc(itemRef, {
                        allocations: [...otherAllocations, ...newAllocationsForLot]
                    });
                } catch (e) {
                    console.error(`Error updating lot ${lotId}:`, e);
                }
            })());
        }
        
        await Promise.all(updates);
        
        // Update prevAllocations to match current
        setPrevAllocations(JSON.parse(JSON.stringify(allocations)));
        
    } catch (err) {
        console.error("Error saving allocations:", err);
        throw err;
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

  const handleSaveAll = async () => {
    if (Math.abs(totalPercentage - 100) > 0.1 && composition.length > 0) {
        if (!confirm(`Total percentage is ${totalPercentage}%. Do you want to save anyway?`)) {
            return;
        }
    }

    setIsSaving(true);
    setError(null);
    try {
      // 1. Save Composition
      // Ensure numbers are saved as numbers
      const cleanComposition = composition.map(c => ({
        ...c,
        percentage: parseFloat(c.percentage) || 0,
        scrapPercentage: parseFloat(c.scrapPercentage) || 0
      }));

      if (activeVariantId && fabric.variants) {
          // Update specific variant
          const updatedVariants = fabric.variants.map(v => {
              if (v.id === activeVariantId) {
                  return { ...v, yarns: cleanComposition };
              }
              return v;
          });
          await onUpdateFabric(fabric.id!, { variants: updatedVariants });
      } else {
          // Legacy update
          await onUpdateFabric(fabric.id!, { yarnComposition: cleanComposition });
      }

      // 2. Save Allocations (if applicable)
      if (orderId && customerId && onUpdateOrderAllocations) {
          await saveAllocationsInternal();
      }

      onClose();
    } catch (err) {
      console.error("Error saving all:", err);
      setError("Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get yarn name by ID
  const getYarnName = (id: string, name?: string) => {
    if (!id) return name || 'Unknown Yarn';
    return allYarns.find(y => y.id === id)?.name || name || id;
  };

  const handleSaveVariant = async () => {
    if (!fabric.id || !onUpdateOrderVariant) return;
    
    setIsSaving(true);
    try {
      const newVariantId = crypto.randomUUID();
      const newVariant = {
        id: newVariantId,
        yarns: composition
      };
      
      // Update Fabric
      const fabricRef = doc(db, 'Fabrics', fabric.id);
      await updateDoc(fabricRef, {
        variants: arrayUnion(newVariant)
      });
      
      // Update Order
      await onUpdateOrderVariant(newVariantId);
      
      setActiveVariantId(newVariantId);
      setIsEditingVariant(false);
    } catch (e) {
       console.error(e);
       setError('Failed to create variant');
    } finally {
       setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between mb-4">
            <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                Yarn Composition & Allocation
                </h2>
                <p className="text-sm text-slate-500">
                Fabric: <span className="font-medium text-slate-700">{fabric.name}</span>
                </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200">
            <button
                onClick={() => setActiveTab('composition')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'composition' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
                Composition
            </button>
            {orderId && (
                <button
                    onClick={() => setActiveTab('allocations')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'allocations' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Allocations
                </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          
          {/* Order Context Summary (Always Visible) */}
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

          {activeTab === 'composition' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                {/* Variant Selector */}
                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">Variant:</span>
                        {fabric.variants && fabric.variants.length > 0 ? (
                            <select 
                                value={activeVariantId || ''}
                                disabled={isEditingVariant}
                                onChange={(e) => {
                                    const vId = e.target.value;
                                    setActiveVariantId(vId);
                                    const v = fabric.variants.find(v => v.id === vId);
                                    if (v) setComposition(v.yarns || []);
                                }}
                                className="text-sm p-1.5 border border-slate-300 rounded bg-white max-w-xs outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {fabric.variants.map((v, idx) => (
                                    <option key={v.id} value={v.id}>
                                        Variant {idx + 1}: {v.yarns.map(y => `${y.percentage}% ${y.name}`).join(', ')}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span className="text-sm text-slate-400 italic">No variants defined</span>
                        )}
                    </div>
                    
                    {!isEditingVariant ? (
                        <button
                            onClick={() => {
                                setIsEditingVariant(true);
                                if (composition.length === 0) {
                                    setComposition([{ yarnId: '', percentage: 100, scrapPercentage: 0 }]);
                                }
                            }}
                            className="text-sm bg-white text-blue-600 px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 font-medium flex items-center gap-1 shadow-sm"
                        >
                            <Plus size={14} /> New Variant
                        </button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSaveVariant}
                                disabled={isSaving}
                                className="text-sm bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700 font-medium flex items-center gap-1 shadow-sm"
                            >
                                <Save size={14} /> Save as New Variant
                            </button>
                            <button
                                onClick={() => {
                                    setIsEditingVariant(false);
                                    if (activeVariantId) {
                                        const v = fabric.variants.find(v => v.id === activeVariantId);
                                        if (v) setComposition(v.yarns || []);
                                    }
                                }}
                                className="text-sm text-slate-500 hover:text-slate-700 px-2"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
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
                            value={comp.yarnId || comp.name} 
                            yarns={allYarns}
                            inventoryYarnNames={inventoryYarnNames}
                            disabled={!isEditingVariant}
                            onChange={(val) => {
                                const selectedYarn = allYarns.find(y => y.id === val);
                                const newComp = [...composition];
                                newComp[index] = { 
                                    ...newComp[index], 
                                    yarnId: val,
                                    name: selectedYarn ? selectedYarn.name : newComp[index].name
                                };
                                setComposition(newComp);
                            }}
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
                            disabled={!isEditingVariant}
                            value={comp.percentage}
                            onChange={(e) => handleUpdateRow(index, 'percentage', e.target.value)}
                            className={`w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-right focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm ${!isEditingVariant ? 'bg-slate-100 text-slate-500' : ''}`}
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
                            disabled={!isEditingVariant}
                            value={comp.scrapPercentage || 0}
                            onChange={(e) => handleUpdateRow(index, 'scrapPercentage', e.target.value)}
                            className={`w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-right focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm text-orange-600 ${!isEditingVariant ? 'bg-slate-100 text-slate-500' : ''}`}
                        />
                        <span className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                        </div>

                        {/* Calculated Weight */}
                        <div className="col-span-2 text-right font-mono text-slate-700 font-medium">
                        {requiredWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                        </div>

                        {/* Delete */}
                        <div className="col-span-1 text-center">
                        {isEditingVariant && (
                            <button 
                                onClick={() => handleRemoveRow(index)}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                        </div>
                    </div>
                    )})}

                    {composition.length === 0 && (
                    <div className="text-center py-8 text-slate-400 italic border-2 border-dashed border-slate-200 rounded-lg">
                        No yarns defined yet. Add a yarn to start.
                    </div>
                    )}

                    {isEditingVariant && (
                        <button
                        onClick={handleAddRow}
                        className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 font-medium"
                        >
                        <Plus className="w-4 h-4" />
                        Add Yarn Component
                        </button>
                    )}
                </div>
            </div>
          )}

          {activeTab === 'allocations' && orderId && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 mb-4">
                    <h3 className="text-sm font-bold text-indigo-800 flex items-center gap-2 mb-2">
                        <Package className="w-4 h-4" />
                        Allocation Instructions
                    </h3>
                    <p className="text-xs text-indigo-600">
                        Allocate specific inventory lots to each yarn component. The system will automatically deduct these quantities from inventory upon saving.
                    </p>
                </div>
                
                {loadingInventory ? (
                    <div className="text-center py-12 text-slate-500">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                        Loading inventory data...
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
                            <div className="col-span-3">Yarn</div>
                            <div className="col-span-2 text-right">Required</div>
                            <div className="col-span-7">Select Lot</div>
                        </div>
                        
                        {composition.map((comp, index) => {
                            const baseWeight = (orderQuantity * (comp.percentage || 0)) / 100;
                            const scrapFactor = 1 + ((comp.scrapPercentage || 0) / 100);
                            const requiredWeight = baseWeight * scrapFactor;
                            const yarnName = getYarnName(comp.yarnId, comp.name);
                            const lots = comp.yarnId ? (inventoryMap.get(comp.yarnId) || []) : [];
                            
                            return (
                                <div key={index} className="grid grid-cols-12 gap-4 items-start bg-white p-3 rounded-md border border-slate-200 shadow-sm">
                                    <div className="col-span-3 font-medium text-slate-700 pt-1">
                                        {yarnName}
                                        {comp.yarnId && manualMapping[comp.yarnId] && (
                                            <div className="text-[10px] text-indigo-600 font-normal">
                                                Mapped to: {manualMapping[comp.yarnId]}
                                            </div>
                                        )}
                                        {!comp.yarnId && (
                                            <div className="text-[10px] text-red-500 font-bold flex items-center gap-1 mt-1">
                                                <AlertCircle size={10} />
                                                Unlinked Yarn
                                            </div>
                                        )}
                                    </div>
                                    <div className="col-span-9 relative">
                                        {!comp.yarnId ? (
                                            <div className="flex flex-col gap-2">
                                                <div className="p-3 bg-red-50 border border-red-100 rounded text-xs text-red-600 flex items-center gap-2">
                                                    <AlertCircle size={14} />
                                                    Please select a valid yarn in the Composition tab to enable allocation.
                                                </div>
                                                
                                                {/* Quick Fix for Inventory Match */}
                                                {(() => {
                                                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
                                                    const target = normalize(comp.name || '');
                                                    const inventoryMatch = inventoryYarnNames.find(n => normalize(n) === target);
                                                    
                                                    if (inventoryMatch) {
                                                        return (
                                                            <button
                                                                onClick={async () => {
                                                                    if (confirm(`Create Master Yarn for "${inventoryMatch}"?`)) {
                                                                        try {
                                                                            const newId = await onAddYarn(inventoryMatch);
                                                                            // Update local composition state to link immediately
                                                                            const newComp = [...composition];
                                                                            newComp[index] = { ...newComp[index], yarnId: newId };
                                                                            setComposition(newComp);
                                                                        } catch (e) {
                                                                            alert("Failed to create yarn: " + e);
                                                                        }
                                                                    }
                                                                }}
                                                                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center justify-center gap-2 shadow-sm"
                                                            >
                                                                <CheckCircle2 size={14} />
                                                                Fix: Create Master Yarn from Stock
                                                            </button>
                                                        );
                                                    }
                                                    return null;
                                                })()}

                                                {/* DEBUG TOOL */}
                                                <div className="p-2 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono text-slate-600">
                                                    <div className="font-bold mb-1">DEBUG INFO:</div>
                                                    <div>Raw Name: "{comp.name}"</div>
                                                    <div>Normalized: "{comp.name?.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '')}"</div>
                                                    <div>Master Yarns Loaded: {allYarns.length}</div>
                                                    
                                                    <div className="mt-2 font-bold">Potential Candidates in Master List:</div>
                                                    {(() => {
                                                        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
                                                        const target = normalize(comp.name || '');
                                                        // Find anything that shares the first 5 chars or is included
                                                        const candidates = allYarns.filter(y => {
                                                            const normY = normalize(y.name);
                                                            return normY.includes(target) || target.includes(normY) || (target.length > 4 && normY.startsWith(target.substring(0, 5)));
                                                        }).slice(0, 5);

                                                        // Check Inventory List as well
                                                        const inventoryMatch = inventoryYarnNames.find(n => normalize(n) === target);

                                                        return (
                                                            <>
                                                                {inventoryMatch && (
                                                                    <div className="mb-2 p-1 bg-green-50 border border-green-200 rounded text-green-700">
                                                                        <strong>Found in Inventory!</strong><br/>
                                                                        "{inventoryMatch}" exists in stock but is missing from the Master Yarn List. You must create it to link it.
                                                                    </div>
                                                                )}
                                                                
                                                                {candidates.length === 0 ? (
                                                                    <div>No close matches found in Master List.</div>
                                                                ) : (
                                                                    candidates.map(c => (
                                                                        <div key={c.id} className="border-t border-slate-200 mt-1 pt-1">
                                                                            <div>Name: "{c.name}"</div>
                                                                            <div>Norm: "{normalize(c.name)}"</div>
                                                                            <div className="text-red-500">
                                                                                Match: {normalize(c.name) === target ? "YES (Why didn't it link?)" : "NO"}
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        ) : isSearchingInventory === comp.yarnId ? (
                                            <div className="absolute inset-0 z-10 bg-white border border-indigo-300 rounded-md shadow-lg flex flex-col min-h-[150px]">
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
                                            <YarnAllocationManager
                                                yarnId={comp.yarnId}
                                                yarnName={yarnName}
                                                requiredQty={requiredWeight}
                                                allocations={Array.isArray(allocations[comp.yarnId]) ? allocations[comp.yarnId] : []}
                                                availableLots={lots}
                                                onUpdate={(newAllocations) => handleUpdateAllocations(comp.yarnId, newAllocations)}
                                                onFindInventory={() => setIsSearchingInventory(comp.yarnId)}
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
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
              onClick={handleSaveAll}
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Internal Yarn Allocation Manager Component
const YarnAllocationManager: React.FC<{
  yarnId: string;
  yarnName: string;
  requiredQty: number;
  allocations: YarnAllocationItem[];
  availableLots: YarnInventoryItem[];
  onUpdate: (newAllocations: YarnAllocationItem[]) => void;
  onFindInventory: () => void;
}> = ({ yarnId, yarnName, requiredQty, allocations, availableLots, onUpdate, onFindInventory }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [qtyToAllocate, setQtyToAllocate] = useState<number>(0);

  // Defensive check: Ensure allocations is an array
  const safeAllocations = Array.isArray(allocations) ? allocations : [];

  const totalAllocated = safeAllocations.reduce((sum, a) => sum + (a.quantity || 0), 0);
  const remaining = Math.max(0, requiredQty - totalAllocated);

  // Recommendation Logic
  const recommendedLotIds = React.useMemo(() => {
    if (remaining <= 0) return new Set<string>();

    // Calculate true available for each lot (considering DB allocations + current session allocations)
    const lotAvailability = availableLots.map(lot => {
        const allocatedDb = (lot.allocations || []).reduce((sum, a) => sum + (a.quantity || 0), 0);
        // Also subtract what we've already allocated in this session for THIS yarn requirement
        // (Wait, safeAllocations are already "allocated" in our view, so they reduce 'remaining'.
        //  But if we have multiple allocations from the SAME lot in this list, we should account for that?
        //  Actually, safeAllocations are what we have *already* decided to take.
        //  So the lot's available quantity for *further* allocation is:
        //  Total - DB_Allocated - (Sum of safeAllocations for this lot)
        const allocatedSession = safeAllocations
            .filter(a => a.lotId === lot.id)
            .reduce((sum, a) => sum + (a.quantity || 0), 0);
            
        return {
            id: lot.id,
            available: Math.max(0, (lot.quantity || 0) - allocatedDb - allocatedSession)
        };
    });

    // 1. Check for single lot sufficiency
    const sufficientLots = lotAvailability.filter(l => l.available >= remaining);
    if (sufficientLots.length > 0) {
        // Recommend the one with the MOST available quantity (to keep large lots? or smallest sufficient to clear fragmentation?
        // User said: "recommond the lot with most avaialble quantity"
        sufficientLots.sort((a, b) => b.available - a.available);
        return new Set([sufficientLots[0].id]);
    }

    // 2. Split Recommendation
    // Sort by available descending
    lotAvailability.sort((a, b) => b.available - a.available);
    
    const recommended = new Set<string>();
    let currentSum = 0;
    
    for (const lot of lotAvailability) {
        if (lot.available <= 0) continue;
        recommended.add(lot.id);
        currentSum += lot.available;
        if (currentSum >= remaining) break;
    }
    
    return recommended;
  }, [availableLots, safeAllocations, remaining]);

  const handleAdd = () => {
    if (!selectedLotId || qtyToAllocate <= 0) return;
    
    const lot = availableLots.find(l => l.id === selectedLotId);
    if (!lot) return;

    const newAllocation: YarnAllocationItem = {
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      quantity: qtyToAllocate,
      allocatedAt: new Date().toISOString()
    };

    onUpdate([...safeAllocations, newAllocation]);
    setIsAdding(false);
    setSelectedLotId('');
    setQtyToAllocate(0);
  };

  const handleRemove = (index: number) => {
    const newAllocations = [...safeAllocations];
    newAllocations.splice(index, 1);
    onUpdate(newAllocations);
  };

  return (
    <div className="w-full bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
      {/* Header / Progress */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Allocation Status</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${remaining === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {remaining === 0 ? 'COMPLETE' : 'PENDING'}
                </span>
            </div>
            <div className="text-right">
                <span className="font-mono font-bold text-slate-800">{totalAllocated.toFixed(1)}</span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-slate-500">{requiredQty.toFixed(1)} kg</span>
            </div>
        </div>
        
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div 
            className={`h-full transition-all duration-500 ${remaining === 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${Math.min(100, (totalAllocated / requiredQty) * 100)}%` }}
            />
        </div>
      </div>

      {/* Allocations List */}
      {safeAllocations.length > 0 && (
        <div className="mb-3 space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">Allocated Lots</div>
            {safeAllocations.map((alloc, idx) => (
            <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs group hover:border-indigo-200 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="font-medium text-slate-700">{alloc.lotNumber}</span>
                    </div>
                    <span className="text-slate-300">|</span>
                    <span className="font-mono text-slate-600">{alloc.quantity} kg</span>
                </div>
                <button 
                onClick={() => handleRemove(idx)}
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-all opacity-0 group-hover:opacity-100"
                title="Remove Allocation"
                >
                <X className="w-3.5 h-3.5" />
                </button>
            </div>
            ))}
        </div>
      )}

      {/* Actions */}
      {!isAdding ? (
        <div className="flex gap-2">
            <button 
                onClick={() => setIsAdding(true)}
                disabled={remaining <= 0}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-indigo-300 rounded text-xs font-medium text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
                <Plus className="w-3.5 h-3.5" />
                Allocate Lot
            </button>
            <button
                onClick={onFindInventory}
                className="px-3 py-1.5 border border-slate-200 rounded text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-all"
                title="Search Inventory"
            >
                <SearchIcon className="w-3.5 h-3.5" />
            </button>
        </div>
      ) : (
        <div className="bg-indigo-50/50 border border-indigo-100 rounded p-2 animate-in slide-in-from-top-1">
          <div className="mb-2">
            <label className="block text-[10px] text-indigo-900 font-bold mb-1">Select Lot from Inventory</label>
            <div className="relative">
                <select 
                className="w-full text-xs border border-indigo-200 rounded pl-2 pr-8 py-1.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white appearance-none"
                value={selectedLotId}
                onChange={(e) => {
                    setSelectedLotId(e.target.value);
                    // Auto-fill remaining qty if possible
                    const lot = availableLots.find(l => l.id === e.target.value);
                    if (lot) {
                        const allocatedDb = (lot.allocations || []).reduce((sum, a) => sum + (a.quantity || 0), 0);
                        const allocatedSession = safeAllocations
                            .filter(a => a.lotId === lot.id)
                            .reduce((sum, a) => sum + (a.quantity || 0), 0);
                        const available = Math.max(0, (lot.quantity || 0) - allocatedDb - allocatedSession);
                        setQtyToAllocate(Math.min(remaining, available));
                    }
                }}
                >
                <option value="">-- Select Available Lot --</option>
                {availableLots
                  .map(lot => {
                    const allocatedDb = (lot.allocations || []).reduce((sum, a) => sum + (a.quantity || 0), 0);
                    const allocatedSession = safeAllocations
                        .filter(a => a.lotId === lot.id)
                        .reduce((sum, a) => sum + (a.quantity || 0), 0);
                    const available = Math.max(0, (lot.quantity || 0) - allocatedDb - allocatedSession);
                    return { lot, available };
                  })
                  .sort((a, b) => b.available - a.available)
                  .map(({ lot, available }) => {
                    const isRecommended = recommendedLotIds.has(lot.id);
                    const locationDisplay = lot.location ? `[${lot.location}] ` : '';

                    return (
                    <option key={lot.id} value={lot.id} disabled={available <= 0} className={isRecommended ? "font-bold text-indigo-700 bg-indigo-50" : ""}>
                    {isRecommended ? "★ " : ""}{locationDisplay}{lot.lotNumber} — {available.toFixed(1)} kg avail. {isRecommended ? "(Recommended)" : ""}
                    </option>
                    );
                })}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-indigo-400 pointer-events-none" />
            </div>
          </div>
          
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-indigo-900 font-bold mb-1">Quantity to Allocate</label>
              <div className="relative">
                <input 
                    type="number" 
                    className="w-full text-xs border border-indigo-200 rounded pl-2 pr-6 py-1.5 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                    value={qtyToAllocate}
                    onChange={(e) => setQtyToAllocate(Number(e.target.value))}
                    min={0}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">kg</span>
              </div>
            </div>
            <button 
              onClick={handleAdd}
              disabled={!selectedLotId || qtyToAllocate <= 0}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 disabled:opacity-50 shadow-sm shadow-indigo-200"
            >
              Confirm
            </button>
            <button 
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Internal Yarn Selector Component
const YarnSelector: React.FC<{
  value: string;
  yarns: Yarn[];
  inventoryYarnNames: string[];
  onChange: (val: string) => void;
  onAddYarn: (name: string) => Promise<string>;
  disabled?: boolean;
}> = ({ value, yarns, inventoryYarnNames, onChange, onAddYarn, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Find current yarn name
  // If value is an ID, find the yarn. If value is a name, use it directly.
  const currentYarn = yarns.find(y => y.id === value);
  const displayName = currentYarn ? currentYarn.name : (value || 'Select Yarn...');

  // Build Unified Options List
  const options = React.useMemo(() => {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const term = normalize(search);
      
      const results: { name: string, source: 'yarn' | 'inventory' | 'both', id?: string }[] = [];
      const seenNames = new Set<string>();

      // 1. Add Inventory Items (Priority)
      inventoryYarnNames.forEach(name => {
          const normalizedName = normalize(name);
          
          // Use a more lenient search: check if term is included in name OR name is included in term
          if (!term || normalizedName.includes(term)) {
              const normalized = name.toLowerCase().trim();
              
              // Check if this inventory name matches an existing yarn
              // We use a strict match for linking, but lenient for display
              const existingYarn = yarns.find(y => normalize(y.name) === normalizedName);
              
              results.push({
                  name: name,
                  source: existingYarn ? 'both' : 'inventory',
                  id: existingYarn?.id
              });
              seenNames.add(normalized);
          }
      });

      // 2. Add remaining Yarns that weren't in inventory
      // RESTORED: We need to show yarns from FabricSS even if they are not in inventory yet,
      // so the user can see what was imported from Excel.
      yarns.forEach(y => {
          const normalizedName = normalize(y.name);
          if (!term || normalizedName.includes(term)) {
              const normalized = y.name.toLowerCase().trim();
              if (!seenNames.has(normalized)) {
                  results.push({
                      name: y.name,
                      source: 'yarn',
                      id: y.id
                  });
                  seenNames.add(normalized);
              }
          }
      });
      
      return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [search, inventoryYarnNames, yarns]);

  const handleSelect = async (option: { name: string, source: string, id?: string }) => {
    if (option.id) {
        // Existing Yarn
        onChange(option.id);
        setIsOpen(false);
        setSearch('');
    } else {
        // Inventory Item (needs creation)
        setLoading(true);
        try {
            const newId = await onAddYarn(option.name);
            onChange(newId);
            setIsOpen(false);
            setSearch('');
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }
  };

  const handleCreateNew = async () => {
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
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 bg-white border border-slate-200 rounded-md transition-colors flex items-center justify-between ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100' : 'cursor-pointer hover:border-blue-400'}`}
      >
        <span className={!value ? 'text-slate-400' : 'text-slate-700'}>{displayName}</span>
      </div>

      {isOpen && !disabled && (
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
            {options.map((opt, idx) => (
              <div
                key={`${opt.name}-${idx}`}
                onClick={() => handleSelect(opt)}
                className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm text-slate-700 flex items-center justify-between group"
              >
                <span>{opt.name}</span>
                {(opt.source === 'inventory' || opt.source === 'both') && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        In Inventory
                    </span>
                )}
              </div>
            ))}

            {search && !options.some(o => o.name.toLowerCase() === search.toLowerCase()) && (
              <div
                onClick={handleCreateNew}
                className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm text-emerald-600 font-medium border-t border-slate-100"
              >
                {loading ? 'Creating...' : `+ Create New "${search}"`}
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

const RichLotSelector: React.FC<{
    value: string;
    lots: YarnInventoryItem[];
    onChange: (val: string) => void;
}> = ({ value, lots, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const selectedLot = lots.find(l => l.id === value);

    return (
        <div className="relative">
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md cursor-pointer hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500/20 transition-all flex items-center justify-between group"
            >
                {selectedLot ? (
                    <div className="flex items-center gap-2 overflow-hidden">
                        <span className="font-bold text-slate-700 text-sm truncate">Lot: {selectedLot.lotNumber}</span>
                        <span className="text-xs text-slate-400">|</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${selectedLot.location?.includes('صاله') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                            <MapPin className="w-2.5 h-2.5" />
                            {selectedLot.location || 'Unknown'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono ml-1">({selectedLot.quantity}kg)</span>
                    </div>
                ) : (
                    <span className="text-slate-400 text-sm italic">-- Select Lot --</span>
                )}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute z-50 top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                        {lots.map(lot => (
                            <div 
                                key={lot.id}
                                onClick={() => {
                                    onChange(lot.id!);
                                    setIsOpen(false);
                                }}
                                className={`px-3 py-2.5 border-b border-slate-50 cursor-pointer transition-colors flex items-center justify-between group ${value === lot.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                            >
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-bold text-sm ${value === lot.id ? 'text-indigo-700' : 'text-slate-700'}`}>
                                            Lot: {lot.lotNumber}
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${lot.location?.includes('صاله') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                            <MapPin className="w-2.5 h-2.5" />
                                            {lot.location || 'Unknown'}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                        ID: {lot.id?.substring(0, 6)}...
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className={`font-mono font-bold text-sm ${value === lot.id ? 'text-indigo-600' : 'text-slate-600'}`}>
                                        {lot.quantity.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
