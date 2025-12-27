import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  collection, 
  getDocs, 
  getDoc,
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
  List,
  ChevronDown,
  Trash2
} from 'lucide-react';

import { YarnService } from '../services/yarnService';
import { YarnInventoryItem } from '../types';

interface GroupedYarn {
  name: string;
  totalQuantity: number;
  totalAllocated: number;
  netAvailable: number;
  lots: YarnInventoryItem[];
  isFavorite: boolean;
}

export const YarnInventoryPage: React.FC = () => {
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<{
      totalKg: number;
      totalAllocated: number; // NEW
      totalRemaining: number; // NEW
      uniqueYarns: number;
      lowStock: number;
      locationTotals: Record<string, number>;
  }>({ totalKg: 0, totalAllocated: 0, totalRemaining: 0, uniqueYarns: 0, lowStock: 0, locationTotals: {} });
  
  // New State for UI enhancements
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedYarn, setSelectedYarn] = useState<GroupedYarn | null>(null);
  const [showLocationOthers, setShowLocationOthers] = useState(false);
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid');
  const [lastImportedDate, setLastImportedDate] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string>('All');
  
  // Import Preview State
  const [importPreview, setImportPreview] = useState<{
    added: any[];
    updated: any[];
    unchanged: number;
    duplicates: number;
    isOpen: boolean;
  }>({ added: [], updated: [], unchanged: 0, duplicates: 0, isOpen: false });

  useEffect(() => {
    fetchInventory();
  }, []);

  useEffect(() => {
    // Load favorites
    const savedFavs = localStorage.getItem('yarn_favorites');
    if (savedFavs) {
      setFavorites(new Set(JSON.parse(savedFavs)));
    }
  }, []);

  useEffect(() => {
    // Calculate stats
    let totalKg = 0;
    let totalAllocated = 0;
    const uniqueYarns = new Set<string>();
    let lowStock = 0;
    const locationTotals: Record<string, number> = {};

    inventory.forEach(item => {
        totalKg += item.quantity;
        uniqueYarns.add(item.yarnName);
        if (item.quantity < 50) lowStock++;

        // Calculate allocated for this item
        const itemAllocated = item.allocations?.reduce((sum, a) => sum + a.quantity, 0) || 0;
        totalAllocated += itemAllocated;

        const loc = item.location || 'Unknown';
        locationTotals[loc] = (locationTotals[loc] || 0) + item.quantity;
    });

    const totalRemaining = totalKg - totalAllocated;

    setStats({ totalKg, totalAllocated, totalRemaining, uniqueYarns: uniqueYarns.size, lowStock, locationTotals });

    // Calculate Last Imported Date
    if (inventory.length > 0) {
        const dates = inventory.map(i => new Date(i.lastUpdated).getTime());
        const maxDate = new Date(Math.max(...dates));
        setLastImportedDate(maxDate.toLocaleString());
    }
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
    
    // Filter inventory based on search term AND location (Client-side)
    const filteredInventory = inventory.filter(item => {
        // Location Filter
        if (locationFilter !== 'All' && item.location !== locationFilter) {
            return false;
        }

        // Search Filter
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            item.yarnName.toLowerCase().includes(term) || 
            item.lotNumber.toLowerCase().includes(term)
        );
    });

    filteredInventory.forEach(item => {
      const itemAllocated = item.allocations?.reduce((sum, a) => sum + a.quantity, 0) || 0;
      const existing = groups.get(item.yarnName);
      
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.totalAllocated += itemAllocated;
        existing.netAvailable = existing.totalQuantity - existing.totalAllocated;
        existing.lots.push(item);
      } else {
        groups.set(item.yarnName, {
          name: item.yarnName,
          totalQuantity: item.quantity,
          totalAllocated: itemAllocated,
          netAvailable: item.quantity - itemAllocated,
          lots: [item],
          isFavorite: favorites.has(item.yarnName)
        });
      }
    });

    return Array.from(groups.values()).sort((a, b) => {
      // Sort by Favorite first
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      
      // Sort by Has Allocations (desc)
      const aHasAlloc = a.totalAllocated > 0;
      const bHasAlloc = b.totalAllocated > 0;
      if (aHasAlloc && !bHasAlloc) return -1;
      if (!aHasAlloc && bHasAlloc) return 1;

      // Then by Name
      return a.name.localeCompare(b.name);
    });
  }, [inventory, favorites, searchTerm, locationFilter]);

  // Extract unique locations for filter
  const uniqueLocations = useMemo(() => {
      const locs = new Set<string>();
      inventory.forEach(item => {
          if (item.location) locs.add(item.location);
      });
      return Array.from(locs).sort();
  }, [inventory]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const items = await YarnService.getAllInventory();
      setInventory(items);
    } catch (error) {
      console.error("Error fetching inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllocation = async (inventoryItem: YarnInventoryItem, allocationIndex: number) => {
    if (!confirm("Are you sure you want to remove this allocation? This will also update the order.")) return;

    const allocation = inventoryItem.allocations![allocationIndex];
    const { customerId, orderId } = allocation;

    try {
        // 1. Update Inventory (Remove from array)
        const newAllocations = [...(inventoryItem.allocations || [])];
        newAllocations.splice(allocationIndex, 1);
        
        await updateDoc(doc(db, 'yarn_inventory', inventoryItem.id), {
            allocations: newAllocations
        });

        // 2. Update Order
        const customerRef = doc(db, 'CustomerSheets', customerId);
        const customerSnap = await getDoc(customerRef);
        
        if (customerSnap.exists()) {
            const customerData = customerSnap.data();
            let orders = customerData.orders || [];
            let orderIndex = orders.findIndex((o: any) => o.id === orderId);
            
            // Helper to clean allocations
            const cleanAllocations = (currentAllocations: any) => {
                const newYarnAllocations = { ...currentAllocations };
                let changed = false;
                Object.keys(newYarnAllocations).forEach(yarnKey => {
                    const allocs = newYarnAllocations[yarnKey] as any[];
                    // Filter out the allocation that matches this lotId
                    const filtered = allocs.filter(a => a.lotId !== inventoryItem.id);
                    if (filtered.length !== allocs.length) {
                        newYarnAllocations[yarnKey] = filtered;
                        changed = true;
                    }
                });
                return changed ? newYarnAllocations : null;
            };

            if (orderIndex !== -1) {
                // Found in main array
                const order = orders[orderIndex];
                if (order.yarnAllocations) {
                    const newAllocations = cleanAllocations(order.yarnAllocations);
                    if (newAllocations) {
                        orders[orderIndex] = { ...order, yarnAllocations: newAllocations };
                        await updateDoc(customerRef, { orders });
                    }
                }
            } else {
                // Check subcollection
                const orderRef = doc(db, 'CustomerSheets', customerId, 'orders', orderId);
                const orderSnap = await getDoc(orderRef);
                if (orderSnap.exists()) {
                    const order = orderSnap.data();
                    if (order.yarnAllocations) {
                        const newAllocations = cleanAllocations(order.yarnAllocations);
                        if (newAllocations) {
                            await updateDoc(orderRef, { yarnAllocations: newAllocations });
                        }
                    }
                }
            }
        }

        // Refresh Inventory
        fetchInventory();
        // Update selected yarn view if open
        if (selectedYarn) {
            // We need to update the selectedYarn state manually or re-fetch
            // Since fetchInventory updates 'inventory', and 'groupedInventory' depends on it,
            // we just need to make sure 'selectedYarn' is refreshed.
            // Actually, selectedYarn is a separate state object. We should update it or close it.
            // Let's try to update it by finding the new group from the new inventory.
            // But fetchInventory is async.
            // For now, let's just close it or let the user reopen, OR better:
            // We can update the local state of selectedYarn to reflect the change immediately.
            
            const updatedLots = selectedYarn.lots.map(l => {
                if (l.id === inventoryItem.id) {
                    return { ...l, allocations: newAllocations };
                }
                return l;
            });
            
            const totalAllocated = updatedLots.reduce((sum, l) => sum + (l.allocations?.reduce((s, a) => s + a.quantity, 0) || 0), 0);
            
            setSelectedYarn({
                ...selectedYarn,
                lots: updatedLots,
                totalAllocated,
                netAvailable: selectedYarn.totalQuantity - totalAllocated
            });
        }

    } catch (e) {
        console.error("Error deleting allocation:", e);
        alert("Failed to remove allocation.");
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

        // Get existing inventory to check for updates
        const existingSnapshot = await getDocs(collection(db, 'yarn_inventory'));
        const existingMap = new Map<string, YarnInventoryItem>(); // Key: Name-Lot-Location
        const unknownLocationMap = new Map<string, YarnInventoryItem[]>(); // Key: Name-Lot -> [Items with unknown loc]

        existingSnapshot.docs.forEach(doc => {
            const data = doc.data() as YarnInventoryItem;
            const name = data.yarnName.trim().toLowerCase();
            const lot = data.lotNumber.trim().toLowerCase();
            const loc = data.location ? data.location.trim().toLowerCase() : 'unknown';
            
            const fullKey = `${name}-${lot}-${loc}`;
            existingMap.set(fullKey, { ...data, id: doc.id });

            if (loc === 'unknown') {
                const lotKey = `${name}-${lot}`;
                const list = unknownLocationMap.get(lotKey) || [];
                list.push({ ...data, id: doc.id });
                unknownLocationMap.set(lotKey, list);
            }
        });

        const toAdd: any[] = [];
        const toUpdate: any[] = [];
        let unchangedCount = 0;
        let fileDuplicatesCount = 0;
        const processedKeys = new Set<string>();

        // Process rows starting from index 2
        let currentSectionLocation = '';
        let lastYarnName = '';

        for (let i = 2; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length === 0) continue;

          const firstCol = String(row[0] || '').trim();
          
          // Check for Header Row (starts with "BU/")
          if (firstCol.startsWith('BU/')) {
            currentSectionLocation = firstCol;
            lastYarnName = ''; // Reset yarn name on section change
            continue; 
          }

          // Normal Row Processing
          const lotNumber = String(row[1] || '').trim();
          const quantity = parseFloat(row[2]);

          if (!lotNumber || isNaN(quantity)) continue;

          // Handle Yarn Name (Fill Down for merged cells)
          let yarnName = firstCol;
          if (!yarnName && lastYarnName) {
              yarnName = lastYarnName;
          }
          
          if (!yarnName) continue; // Still no yarn name? Skip.
          lastYarnName = yarnName; // Update last seen

          // Handle Location
          // Priority: Column D -> Section Header -> 'Unknown'
          let location = String(row[3] || '').trim();
          if (!location) {
              location = currentSectionLocation || 'Unknown';
          }

          // Unique Key now includes Location to allow same lot in multiple locations
          const key = `${yarnName.toLowerCase()}-${lotNumber.toLowerCase()}-${location.toLowerCase()}`;
          
          // Check for duplicates within the file itself
          if (processedKeys.has(key)) {
            fileDuplicatesCount++;
            continue; 
          }
          processedKeys.add(key);

          let existingItem = existingMap.get(key);

          // If no exact match (Name+Lot+Loc), try to find an unclaimed 'Unknown' location item to migrate
          if (!existingItem) {
             const lotKey = `${yarnName.toLowerCase()}-${lotNumber.toLowerCase()}`;
             const unknowns = unknownLocationMap.get(lotKey);
             if (unknowns && unknowns.length > 0) {
                 existingItem = unknowns.shift(); // Take one and remove it from pool
                 // We found a match to migrate!
             }
          }

          if (existingItem) {
            // Update if quantity OR location changed
            const qtyChanged = Math.abs(existingItem.quantity - quantity) > 0.01;
            const locChanged = existingItem.location !== location;

            if (qtyChanged || locChanged) {
              toUpdate.push({
                id: existingItem.id,
                yarnName,
                lotNumber,
                oldQuantity: existingItem.quantity,
                newQuantity: quantity,
                oldLocation: existingItem.location,
                newLocation: location
              });
            } else {
              unchangedCount++;
            }
          } else {
            // Add new
            toAdd.push({
              yarnName,
              lotNumber,
              quantity,
              location
            });
          }
        }

        // Open Preview Modal instead of writing immediately
        setImportPreview({
            added: toAdd,
            updated: toUpdate,
            unchanged: unchangedCount,
            duplicates: fileDuplicatesCount,
            isOpen: true
        });
        
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

  const confirmImport = async () => {
      setImporting(true);
      try {
          const batch = writeBatch(db);
          let batchCount = 0;
          const MAX_BATCH_SIZE = 450;

          // Process Adds
          for (const item of importPreview.added) {
              const ref = doc(collection(db, 'yarn_inventory'));
              batch.set(ref, {
                  yarnName: item.yarnName,
                  lotNumber: item.lotNumber,
                  quantity: item.quantity,
                  location: item.location,
                  lastUpdated: new Date().toISOString()
              });
              batchCount++;
              if (batchCount >= MAX_BATCH_SIZE) { await batch.commit(); batchCount = 0; }
          }

          // Process Updates
          for (const item of importPreview.updated) {
              const ref = doc(db, 'yarn_inventory', item.id);
              batch.update(ref, {
                  quantity: item.newQuantity,
                  location: item.newLocation,
                  lastUpdated: new Date().toISOString()
              });
              batchCount++;
              if (batchCount >= MAX_BATCH_SIZE) { await batch.commit(); batchCount = 0; }
          }

          if (batchCount > 0) await batch.commit();

          setImportPreview(prev => ({ ...prev, isOpen: false }));
          fetchInventory();
          alert("Inventory updated successfully!");

      } catch (error) {
          console.error("Error committing import:", error);
          alert("Error saving changes to database.");
      } finally {
          setImporting(false);
      }
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
            <div className="flex flex-col">
                <p className="text-slate-500 text-sm mt-1">Manage yarn stock levels and lots</p>
                {lastImportedDate && (
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        Inventory date fetched from: <span className="font-medium text-slate-600">{lastImportedDate}</span>
                    </p>
                )}
            </div>
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

            <div className="relative min-w-[200px]">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="w-full pl-10 pr-8 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm shadow-sm appearance-none cursor-pointer"
                >
                    <option value="All">All Locations</option>
                    {uniqueLocations.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            </div>
            
            <div className="flex flex-wrap gap-4 text-sm items-center">
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                    <span className="text-slate-500">Total Stock:</span>
                    <span className="font-bold text-slate-800">{stats.totalKg.toLocaleString()} kg</span>
                </div>

                <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 shadow-sm">
                    <span className="text-emerald-600 font-medium">Net Available:</span>
                    <span className="font-bold text-emerald-700">{stats.totalRemaining.toLocaleString()} kg</span>
                </div>
                
                {/* Priority Locations */}
                {Object.entries(stats.locationTotals)
                    .filter(([loc]) => loc.includes('مخزن صرف صاله الانتاج') || loc.includes('مخزن الخيوط'))
                    .map(([loc, qty]) => (
                    <div key={loc} className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                        <span className="text-slate-500 text-xs uppercase tracking-wider">{loc.replace('BU/', '')}:</span>
                        <span className="font-bold text-indigo-600">{qty.toLocaleString()} kg</span>
                    </div>
                ))}

                {/* Others Dropdown */}
                {(() => {
                    const otherLocations = Object.entries(stats.locationTotals)
                        .filter(([loc]) => !loc.includes('مخزن صرف صاله الانتاج') && !loc.includes('مخزن الخيوط'));
                    
                    if (otherLocations.length === 0) return null;

                    const otherTotal = otherLocations.reduce((sum, [_, qty]) => sum + qty, 0);

                    return (
                        <div className="relative">
                            <button 
                                onClick={() => setShowLocationOthers(!showLocationOthers)}
                                className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
                            >
                                <span className="text-slate-500 text-xs uppercase tracking-wider">Others:</span>
                                <span className="font-bold text-slate-700">{otherTotal.toLocaleString()} kg</span>
                                <ChevronDown className="w-3 h-3 text-slate-400" />
                            </button>

                            {showLocationOthers && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowLocationOthers(false)} />
                                    <div className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-20 p-2 max-h-60 overflow-y-auto">
                                        {otherLocations.map(([loc, qty]) => (
                                            <div key={loc} className="flex justify-between items-center p-2 hover:bg-slate-50 rounded text-xs">
                                                <span className="text-slate-600">{loc.replace('BU/', '')}</span>
                                                <span className="font-mono font-bold text-indigo-600">{qty.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })()}

                <div className="h-4 w-px bg-slate-300 mx-2 hidden md:block"></div>

                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Unique Yarns:</span>
                    <span className="font-bold text-slate-800">{stats.uniqueYarns}</span>
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
                                        <div className="mb-1">
                                            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Total Stock</p>
                                            <p className="text-sm font-bold text-slate-600 font-mono">
                                                {group.totalQuantity.toLocaleString()} kg
                                            </p>
                                        </div>
                                        {group.totalAllocated > 0 && (
                                            <div>
                                                <p className="text-xs text-emerald-600 uppercase font-bold tracking-wider">Net Available</p>
                                                <p className={`text-2xl font-bold font-mono ${group.netAvailable <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                    {group.netAvailable.toLocaleString()} <span className={`text-sm font-normal ${group.netAvailable <= 0 ? 'text-red-400' : 'text-emerald-400'}`}>kg</span>
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right flex flex-col items-end">
                                        {group.netAvailable <= 0 && group.totalAllocated > 0 && (
                                            <div className="mb-2 inline-block px-2 py-1 bg-red-100 text-red-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                                                Fully Allocated
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Lots</p>
                                            <p className="text-lg font-bold text-slate-700">{group.lots.length}</p>
                                        </div>
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
                                <th className="px-6 py-3 border-b border-slate-200 text-right">Total Stock</th>
                                <th className="px-6 py-3 border-b border-slate-200 text-right">Net Available</th>
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
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-600">
                                        {group.totalQuantity.toLocaleString()} kg
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-emerald-600">
                                        {group.netAvailable.toLocaleString()} kg
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
        </div>
      </div>

      {/* Import Preview Modal */}
      {importPreview.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
                            Import Preview
                        </h2>
                        <p className="text-sm text-slate-500">Review changes before applying</p>
                    </div>
                    <button onClick={() => setImportPreview(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <X className="w-6 h-6 text-slate-400" />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                            <div className="text-2xl font-bold text-emerald-600">{importPreview.added.length}</div>
                            <div className="text-xs font-medium text-emerald-800 uppercase tracking-wide">New Items</div>
                        </div>
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center">
                            <div className="text-2xl font-bold text-blue-600">{importPreview.updated.length}</div>
                            <div className="text-xs font-medium text-blue-800 uppercase tracking-wide">Updates</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                            <div className="text-2xl font-bold text-slate-600">{importPreview.unchanged}</div>
                            <div className="text-xs font-medium text-slate-800 uppercase tracking-wide">Unchanged</div>
                        </div>
                        <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 text-center">
                            <div className="text-2xl font-bold text-orange-600">{importPreview.duplicates}</div>
                            <div className="text-xs font-medium text-orange-800 uppercase tracking-wide">Duplicates</div>
                        </div>
                    </div>

                    {importPreview.updated.length > 0 && (
                        <div>
                            <h3 className="font-bold text-slate-800 mb-2 text-sm uppercase tracking-wide">Updates Preview</h3>
                            <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden max-h-60 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-100 text-slate-500 font-medium text-xs uppercase">
                                        <tr>
                                            <th className="px-4 py-2">Yarn / Lot</th>
                                            <th className="px-4 py-2 text-right">Old Qty</th>
                                            <th className="px-4 py-2 text-right">New Qty</th>
                                            <th className="px-4 py-2">Location</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {importPreview.updated.slice(0, 50).map((item, i) => (
                                            <tr key={i}>
                                                <td className="px-4 py-2">
                                                    <div className="font-medium text-slate-700">{item.yarnName}</div>
                                                    <div className="text-xs text-slate-500 font-mono">{item.lotNumber}</div>
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-500 line-through">{item.oldQuantity}</td>
                                                <td className="px-4 py-2 text-right font-bold text-blue-600">{item.newQuantity}</td>
                                                <td className="px-4 py-2 text-xs">
                                                    {item.oldLocation !== item.newLocation ? (
                                                        <span className="text-blue-600 font-medium">{item.newLocation}</span>
                                                    ) : (
                                                        <span className="text-slate-400">{item.newLocation}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        {importPreview.updated.length > 50 && (
                                            <tr>
                                                <td colSpan={4} className="px-4 py-2 text-center text-xs text-slate-500 italic">
                                                    ...and {importPreview.updated.length - 50} more updates
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                    <button 
                        onClick={() => setImportPreview(prev => ({ ...prev, isOpen: false }))}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={confirmImport}
                        disabled={importing}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm flex items-center gap-2"
                    >
                        {importing ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Importing...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4" />
                                Confirm Import
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
      )}

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
                                <th className="px-6 py-3">Lot Number / Location</th>
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
                                    <td className="px-6 py-4 font-medium text-slate-700 font-mono align-top">
                                        {lot.lotNumber}
                                        {lot.location && (
                                            <div className="mt-1 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 inline-block ml-2">
                                                {lot.location}
                                            </div>
                                        )}
                                    </td>
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
                                                    <div key={i} className="text-xs bg-slate-50 text-slate-700 px-2 py-1 rounded border border-slate-200 flex justify-between items-start group/alloc">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold truncate text-indigo-700" title={`${alloc.clientName || 'Unknown'} - ${alloc.fabricName}`}>
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
                                                        <button 
                                                            onClick={() => handleDeleteAllocation(lot, i)}
                                                            className="ml-2 p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover/alloc:opacity-100 transition-all"
                                                            title="Remove Allocation"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
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
