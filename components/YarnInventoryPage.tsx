import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  doc, 
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { 
  Upload, 
  FileSpreadsheet, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2,
  Package,
  Filter,
  Star,
  ChevronRight,
  X,
  LayoutGrid,
  List
} from 'lucide-react';

import { YarnService } from '../services/yarnService';
import { QueryDocumentSnapshot } from 'firebase/firestore';

interface YarnInventoryItem {
  id: string;
  yarnName: string;
  lotNumber: string;
  quantity: number;
  lastUpdated: string;
  allocations?: {
    orderId: string;
    customerId: string;
    clientName?: string;
    fabricName: string;
    quantity: number;
    timestamp: string;
  }[];
}

interface GroupedYarn {
  name: string;
  totalQuantity: number;
  lots: YarnInventoryItem[];
  isFavorite: boolean;
}

export const YarnInventoryPage: React.FC = () => {
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState({ totalKg: 0, uniqueYarns: 0, lowStock: 0 });
  
  // New State for UI enhancements
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedYarn, setSelectedYarn] = useState<GroupedYarn | null>(null);
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid');
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
        fetchInventory(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    // Load favorites
    const savedFavs = localStorage.getItem('yarn_favorites');
    if (savedFavs) {
      setFavorites(new Set(JSON.parse(savedFavs)));
    }
  }, []);

  useEffect(() => {
    // Calculate stats
    const totalKg = inventory.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueYarns = new Set(inventory.map(i => i.yarnName)).size;
    const lowStock = inventory.filter(i => i.quantity < 50).length; // Arbitrary threshold
    setStats({ totalKg, uniqueYarns, lowStock });
  }, [inventory]);

  const toggleFavorite = (e: React.MouseEvent, yarnName: string) => {
    e.stopPropagation();
    const newFavs = new Set(favorites);
    if (newFavs.has(yarnName)) {
      newFavs.delete(yarnName);
    } else {
      newFavs.add(yarnName);
    }
    setFavorites(newFavs);
    localStorage.setItem('yarn_favorites', JSON.stringify(Array.from(newFavs)));
  };

  const groupedInventory = useMemo(() => {
    const groups = new Map<string, GroupedYarn>();
    
    inventory.forEach(item => {
      // Filter logic is now server-side, but we keep this for safety if needed
      // or if we want to filter within the page (e.g. by lot number if not searched)
      // But for now, let's assume inventory contains what we want.

      const existing = groups.get(item.yarnName);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.lots.push(item);
      } else {
        groups.set(item.yarnName, {
          name: item.yarnName,
          totalQuantity: item.quantity,
          lots: [item],
          isFavorite: favorites.has(item.yarnName)
        });
      }
    });

    return Array.from(groups.values()).sort((a, b) => {
      // Sort by Favorite first
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      // Then by Name
      return a.name.localeCompare(b.name);
    });
  }, [inventory, favorites]);

  const fetchInventory = async (reset = false) => {
    setLoading(true);
    try {
      let newItems: YarnInventoryItem[] = [];
      let newLastDoc = null;

      if (searchTerm) {
          // Search mode
          newItems = await YarnService.searchInventory(searchTerm, 50);
          setHasMore(false); // Search doesn't support pagination yet in this simple impl
      } else {
          // Pagination mode
          const result = await YarnService.getInventoryPage(50, reset ? undefined : (lastDoc || undefined));
          newItems = result.items;
          newLastDoc = result.lastDoc;
          setHasMore(!!newLastDoc);
      }

      if (reset) {
          setInventory(newItems);
      } else {
          setInventory(prev => [...prev, ...newItems]);
      }
      setLastDoc(newLastDoc);
    } catch (error) {
      console.error("Error fetching inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        // Data starts at row 3 (index 2)
        // Column A (0): Yarn Name
        // Column B (1): Lot/Serial
        // Column C (2): Quantity
        
        const batch = writeBatch(db);
        let batchCount = 0;
        const MAX_BATCH_SIZE = 450; // Firestore limit is 500

        // Get existing inventory to check for updates
        const existingSnapshot = await getDocs(collection(db, 'yarn_inventory'));
        const existingMap = new Map<string, YarnInventoryItem>();
        existingSnapshot.docs.forEach(doc => {
            const data = doc.data() as YarnInventoryItem;
            // Create a unique key for Yarn + Lot
            const key = `${data.yarnName.trim().toLowerCase()}-${data.lotNumber.trim().toLowerCase()}`;
            existingMap.set(key, { ...data, id: doc.id });
        });

        let updatesCount = 0;
        let addsCount = 0;

        // Process rows starting from index 2
        for (let i = 2; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length < 3) continue;

          const yarnName = String(row[0] || '').trim();
          const lotNumber = String(row[1] || '').trim();
          const quantity = parseFloat(row[2]);

          if (!yarnName || isNaN(quantity)) continue;

          const key = `${yarnName.toLowerCase()}-${lotNumber.toLowerCase()}`;
          const existingItem = existingMap.get(key);

          if (existingItem) {
            // Update if quantity changed
            if (Math.abs(existingItem.quantity - quantity) > 0.01) {
              const ref = doc(db, 'yarn_inventory', existingItem.id);
              batch.update(ref, {
                quantity,
                lastUpdated: new Date().toISOString()
              });
              batchCount++;
              updatesCount++;
            }
          } else {
            // Add new
            const ref = doc(collection(db, 'yarn_inventory'));
            batch.set(ref, {
              yarnName,
              lotNumber,
              quantity,
              lastUpdated: new Date().toISOString()
            });
            batchCount++;
            addsCount++;
          }

          // Commit batch if full
          if (batchCount >= MAX_BATCH_SIZE) {
            await batch.commit();
            batchCount = 0;
          }
        }

        // Commit remaining
        if (batchCount > 0) {
          await batch.commit();
        }

        alert(`Import Complete!\nAdded: ${addsCount}\nUpdated: ${updatesCount}`);
        fetchInventory();
        
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';

      } catch (error) {
        console.error("Error parsing excel:", error);
        alert("Error importing file. Please check the format.");
      } finally {
        setImporting(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50/50">
      
      {/* Header - Floating Style */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex flex-col gap-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-6 h-6 text-indigo-600" />
              Yarn Inventory
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage yarn stock levels and lots</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button 
                    onClick={() => setViewType('grid')}
                    className={`p-1.5 rounded-md transition-all ${viewType === 'grid' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
                <button 
                    onClick={() => setViewType('list')}
                    className={`p-1.5 rounded-md transition-all ${viewType === 'list' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    <List className="w-4 h-4" />
                </button>
            </div>

            <button 
              onClick={fetchInventory} 
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            
            <div className="relative">
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileUpload}
                className="hidden"
                ref={fileInputRef}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium disabled:opacity-50"
              >
                {importing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    Import Excel
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Search & Stats Bar */}
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by yarn name or lot number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm shadow-sm"
                />
            </div>
            
            <div className="flex gap-6 text-sm">
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Total Stock:</span>
                    <span className="font-bold text-slate-800">{stats.totalKg.toLocaleString()} kg</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Unique Yarns:</span>
                    <span className="font-bold text-slate-800">{stats.uniqueYarns}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Low Stock:</span>
                    <span className={`font-bold ${stats.lowStock > 0 ? 'text-orange-600' : 'text-slate-800'}`}>{stats.lowStock}</span>
                </div>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto w-full">
            
            {viewType === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupedInventory.map((group) => (
                        <div 
                            key={group.name}
                            onClick={() => setSelectedYarn(group)}
                            className={`bg-white rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${
                                group.isFavorite 
                                    ? 'border-indigo-200 shadow-md shadow-indigo-100' 
                                    : 'border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200'
                            }`}
                        >
                            <div className="p-5">
                                <div className="flex justify-between items-start mb-3">
                                    <h3 className="font-bold text-slate-800 text-lg leading-tight pr-6 break-words">
                                        {group.name}
                                    </h3>
                                    <button 
                                        onClick={(e) => toggleFavorite(e, group.name)}
                                        className={`absolute top-4 right-4 p-1 rounded-full transition-colors ${
                                            group.isFavorite ? 'text-yellow-400 hover:text-yellow-500' : 'text-slate-300 hover:text-yellow-400'
                                        }`}
                                    >
                                        <Star className={`w-5 h-5 ${group.isFavorite ? 'fill-current' : ''}`} />
                                    </button>
                                </div>
                                
                                <div className="flex items-end justify-between mt-4">
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Available</p>
                                        <p className="text-2xl font-bold text-indigo-600 font-mono">
                                            {group.totalQuantity.toLocaleString()} <span className="text-sm text-slate-400 font-normal">kg</span>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Lots</p>
                                        <p className="text-lg font-bold text-slate-700">{group.lots.length}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-50 px-5 py-2 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 group-hover:bg-indigo-50/50 transition-colors">
                                <span>Click to view details</span>
                                <ChevronRight className="w-4 h-4" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 font-semibold text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3 border-b border-slate-200">Yarn Name</th>
                                <th className="px-6 py-3 border-b border-slate-200 text-right">Total Quantity</th>
                                <th className="px-6 py-3 border-b border-slate-200 text-center">Lots</th>
                                <th className="px-6 py-3 border-b border-slate-200 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {groupedInventory.map((group) => (
                                <tr key={group.name} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedYarn(group)}>
                                    <td className="px-6 py-4 font-medium text-slate-800 flex items-center gap-2">
                                        <button 
                                            onClick={(e) => toggleFavorite(e, group.name)}
                                            className={`${group.isFavorite ? 'text-yellow-400' : 'text-slate-300 hover:text-yellow-400'}`}
                                        >
                                            <Star className={`w-4 h-4 ${group.isFavorite ? 'fill-current' : ''}`} />
                                        </button>
                                        {group.name}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-indigo-600">
                                        {group.totalQuantity.toLocaleString()} kg
                                    </td>
                                    <td className="px-6 py-4 text-center text-slate-600">
                                        {group.lots.length}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button className="text-indigo-600 hover:text-indigo-800 font-medium text-xs">View Lots</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {groupedInventory.length === 0 && !loading && (
                <div className="text-center py-20">
                    <div className="bg-slate-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Package className="w-10 h-10 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">No inventory found</h3>
                    <p className="text-slate-500 mt-1">Import an Excel file or adjust your search filters.</p>
                </div>
            )}

            {hasMore && !searchTerm && groupedInventory.length > 0 && (
                <div className="mt-8 text-center">
                    <button 
                        onClick={() => fetchInventory(false)}
                        disabled={loading}
                        className="px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors shadow-sm disabled:opacity-50"
                    >
                        {loading ? 'Loading...' : 'Load More'}
                    </button>
                </div>
            )}
        </div>
      </div>

      {/* Yarn Details Modal */}
      {selectedYarn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            {selectedYarn.name}
                            {selectedYarn.isFavorite && <Star className="w-5 h-5 text-yellow-400 fill-current" />}
                        </h2>
                        <p className="text-sm text-slate-500">
                            Total Stock: <span className="font-bold text-slate-700">{selectedYarn.totalQuantity.toLocaleString()} kg</span> across {selectedYarn.lots.length} lots
                        </p>
                    </div>
                    <button onClick={() => setSelectedYarn(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <X className="w-6 h-6 text-slate-400" />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                            <tr>
                                <th className="px-6 py-3">Lot Number</th>
                                <th className="px-6 py-3 text-right">Quantity (kg)</th>
                                <th className="px-6 py-3">Allocations</th>
                                <th className="px-6 py-3 text-right">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {selectedYarn.lots.sort((a,b) => b.quantity - a.quantity).map((lot) => {
                                const allocatedTotal = lot.allocations?.reduce((sum, a) => sum + (a.quantity || 0), 0) || 0;
                                const availableQty = lot.quantity - allocatedTotal;
                                
                                return (
                                <tr key={lot.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-slate-700 font-mono align-top">{lot.lotNumber}</td>
                                    <td className="px-6 py-4 text-right font-mono align-top">
                                        <div className="font-bold text-indigo-600">{lot.quantity.toLocaleString()}</div>
                                        {allocatedTotal > 0 && (
                                            <div className="text-xs text-emerald-600 mt-1 font-bold bg-emerald-50 px-1 rounded inline-block" title="Available after allocations">
                                                Rem: {availableQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 align-top">
                                        {lot.allocations && lot.allocations.length > 0 ? (
                                            <div className="space-y-1">
                                                {lot.allocations.map((alloc, i) => (
                                                    <div key={i} className="text-xs bg-slate-50 text-slate-700 px-2 py-1 rounded border border-slate-200">
                                                        <div className="font-bold truncate text-indigo-700">
                                                            {alloc.clientName || 'Unknown'} - {alloc.fabricName}
                                                        </div>
                                                        <div className="flex items-center justify-between mt-0.5">
                                                            <span className="font-mono font-medium text-slate-600">
                                                                Use: {(alloc.quantity || 0).toFixed(1)} kg
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {new Date(alloc.timestamp).toLocaleDateString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400 italic bg-slate-50 px-2 py-1 rounded">No Allocations</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-400 text-xs align-top">
                                        {new Date(lot.lastUpdated).toLocaleDateString()}
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
                
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                    <button 
                        onClick={() => setSelectedYarn(null)}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
