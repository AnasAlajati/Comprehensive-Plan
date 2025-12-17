import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Search, Package, MapPin, AlertCircle, CheckCircle2 } from 'lucide-react';
import { YarnService } from '../services/yarnService';
import { DataService } from '../services/dataService';
import { YarnInventoryItem, YarnAllocation } from '../types';

interface AllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  clientName: string;
  fabricName: string;
  requiredQuantity: number;
  currentAllocations?: YarnAllocation[];
  onSave: () => void;
}

export const AllocationModal: React.FC<AllocationModalProps> = ({
  isOpen,
  onClose,
  orderId,
  clientName,
  fabricName,
  requiredQuantity,
  currentAllocations = [],
  onSave
}) => {
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [allocations, setAllocations] = useState<Map<string, number>>(new Map()); // Key: Inventory ID, Value: Allocated Qty
  const [saving, setSaving] = useState(false);

  // Initialize allocations from props
  useEffect(() => {
    if (isOpen) {
      fetchInventory();
      // Note: We can't easily map back existing allocations to inventory IDs if we didn't store the ID.
      // But we added yarnId to YarnAllocation type.
      const initialMap = new Map<string, number>();
      currentAllocations.forEach(alloc => {
        if (alloc.yarnId) {
          initialMap.set(alloc.yarnId, alloc.quantityAllocated);
        }
      });
      setAllocations(initialMap);
      
      // Pre-fill search with fabric name parts to help find relevant yarn
      // e.g. "Cotton Jersey" -> "Cotton"
      const firstWord = fabricName.split(' ')[0];
      if (firstWord) setSearchTerm(firstWord);
    }
  }, [isOpen, fabricName, currentAllocations]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      // Optimize: If we have a fabric name, try to search for it first?
      // But user might want to search for anything.
      // Let's stick to getAllInventory for now but maybe we can cache it in parent?
      // Or just rely on the fact that it's not THAT big yet.
      // If it is slow, we should implement pagination or search-on-type.
      
      // For now, let's just fetch.
      const items = await YarnService.getAllInventory();
      setInventory(items);
    } catch (error) {
      console.error("Error fetching inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter inventory based on search term
  const filteredInventory = useMemo(() => {
    let result = inventory;
    
    if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        result = result.filter(item => 
          item.yarnName.toLowerCase().includes(lowerTerm) || 
          item.lotNumber.toLowerCase().includes(lowerTerm) ||
          item.location?.toLowerCase().includes(lowerTerm)
        );
    }

    // Sort by relevance: Exact matches first, then starts with, then includes
    // Also sort by location to group same lots together visually
    return result.sort((a, b) => {
        // Primary: Match score
        // Secondary: Name
        // Tertiary: Lot
        // Quaternary: Location
        const nameA = a.yarnName.toLowerCase();
        const nameB = b.yarnName.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;

        const lotA = a.lotNumber.toLowerCase();
        const lotB = b.lotNumber.toLowerCase();
        if (lotA < lotB) return -1;
        if (lotA > lotB) return 1;
        
        return (a.location || '').localeCompare(b.location || '');
    });
  }, [inventory, searchTerm]);

  const handleQuantityChange = (itemId: string, qty: number, max: number) => {
    if (qty < 0) return;
    // Allow allocating more than max? Usually no.
    // But maybe they want to over-allocate? Let's cap at max for safety, or just warn.
    // Let's cap at max available for now.
    const safeQty = Math.min(qty, max);
    
    const newMap = new Map(allocations);
    if (safeQty > 0) {
      newMap.set(itemId, safeQty);
    } else {
      newMap.delete(itemId);
    }
    setAllocations(newMap);
  };

  const totalAllocated = useMemo(() => {
    let total = 0;
    allocations.forEach(qty => total += qty);
    return total;
  }, [allocations]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convert map to array of YarnAllocation
      const newAllocations: YarnAllocation[] = [];
      
      allocations.forEach((qty, itemId) => {
        const item = inventory.find(i => i.id === itemId);
        if (item) {
          newAllocations.push({
            yarnId: item.id,
            yarnName: item.yarnName,
            lotNumber: item.lotNumber,
            location: item.location || 'Unknown',
            quantityAllocated: qty,
            allocatedAt: new Date().toISOString()
          });
        }
      });

      await DataService.updateOrderAllocations(orderId, fabricName, newAllocations);
      onSave();
      onClose();
    } catch (error) {
      console.error("Error saving allocations:", error);
      alert("Failed to save allocations.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-6 h-6 text-indigo-600" />
              Allocate Yarn
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Order: <span className="font-medium text-slate-700">{clientName}</span> • Fabric: <span className="font-medium text-slate-700">{fabricName}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-white flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search yarn by name, lot, or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>
          <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Required</div>
              <div className="font-bold text-slate-700">{requiredQuantity.toLocaleString()} kg</div>
            </div>
            <div className="h-8 w-px bg-slate-200"></div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Allocated</div>
              <div className={`font-bold ${totalAllocated >= requiredQuantity ? 'text-emerald-600' : 'text-amber-600'}`}>
                {totalAllocated.toLocaleString()} kg
              </div>
            </div>
          </div>
        </div>

        {/* Inventory List */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">
          {loading ? (
            <div className="text-center py-12 text-slate-400">Loading inventory...</div>
          ) : filteredInventory.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No yarn found matching "{searchTerm}"</div>
          ) : (
            <div className="space-y-3">
              {filteredInventory.map((item, idx) => {
                const itemId = item.id || `fallback-${idx}`;
                const allocated = allocations.get(itemId) || 0;
                const isAllocated = allocated > 0;
                
                return (
                  <div 
                    key={itemId} 
                    className={`bg-white border rounded-xl p-4 transition-all ${isAllocated ? 'border-indigo-500 shadow-md ring-1 ring-indigo-500/20' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm'}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-slate-800">{item.yarnName}</h4>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-mono rounded border border-slate-200">
                            Lot: {item.lotNumber}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-bold rounded border flex items-center gap-1 ${item.location?.includes('صاله') ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                            <MapPin className="w-3 h-3" />
                            {item.location || 'Unknown'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span>
                            Available: <span className="font-medium text-slate-700">{item.quantity.toLocaleString()} kg</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end">
                          <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">Allocate (kg)</label>
                          <div className="flex items-center gap-2">
                             <button 
                                onClick={() => handleQuantityChange(itemId, item.quantity, item.quantity)}
                                className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded transition-colors"
                                title="Allocate Max"
                             >
                                MAX
                             </button>
                             <input
                                type="number"
                                min="0"
                                max={item.quantity}
                                value={allocated || ''}
                                onChange={(e) => handleQuantityChange(itemId, parseFloat(e.target.value) || 0, item.quantity)}
                                className={`w-24 px-2 py-1.5 text-right font-mono font-bold border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${isAllocated ? 'border-indigo-500 text-indigo-700 bg-indigo-50' : 'border-slate-200 text-slate-700'}`}
                                placeholder="0"
                                onClick={(e) => e.stopPropagation()}
                             />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <AlertCircle className="w-4 h-4" />
            <span>Allocating yarn reserves it for this order.</span>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Confirm Allocation
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
