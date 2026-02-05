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
  writeBatch,
  collectionGroup
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
  Trash2,
  ArrowRight
} from 'lucide-react';

import { YarnService } from '../services/yarnService';
import { YarnInventoryItem, Yarn, OrderRow } from '../types';

interface GroupedYarn {
  name: string;
  totalQuantity: number;
  totalAllocated: number;
  netAvailable: number;
  lots: YarnInventoryItem[];
  isFavorite: boolean;
}

interface YarnInventoryPageProps {
  userRole?: 'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'factory_manager' | null;
}

export const YarnInventoryPage: React.FC<YarnInventoryPageProps> = ({ userRole }) => {
  // Viewer role is read-only
  const isReadOnly = userRole === 'viewer';
  
  const [inventory, setInventory] = useState<YarnInventoryItem[]>([]);
  const [masterYarns, setMasterYarns] = useState<Yarn[]>([]); // NEW: To check for unlinked items
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
    discrepancies: any[]; // NEW: For robust detection of Plan vs Reality
    unchanged: number;
    duplicates: number;
    isOpen: boolean;
  }>({ added: [], updated: [], discrepancies: [], unchanged: 0, duplicates: 0, isOpen: false });
  
  const [previewTab, setPreviewTab] = useState<'all' | 'allocated' | 'analysis'>('all');

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
      const [items, yarns] = await Promise.all([
          YarnService.getAllInventory(),
          YarnService.getAllYarns()
      ]);
      setInventory(items);
      setMasterYarns(yarns);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

        // 1. Fetch Existing Inventory
        const existingSnapshot = await getDocs(collection(db, 'yarn_inventory'));
        const existingMap = new Map<string, YarnInventoryItem>(); // Key: Name-Lot-Location
        const unknownLocationMap = new Map<string, YarnInventoryItem[]>(); 
        const itemsByLotMap = new Map<string, YarnInventoryItem[]>(); // Key: Name-Lot (for Split detection)

        existingSnapshot.docs.forEach(doc => {
            const data = doc.data() as YarnInventoryItem;
            const name = (data.yarnName || '').trim().toLowerCase();
            const lot = (data.lotNumber || '').trim().toLowerCase();
            const loc = data.location ? data.location.trim().toLowerCase() : 'unknown';
            
            const fullKey = `${name}-${lot}-${loc}`;
            existingMap.set(fullKey, { ...data, id: doc.id });

            const lotKey = `${name}-${lot}`;
            
            if (loc === 'unknown') {
                const list = unknownLocationMap.get(lotKey) || [];
                list.push({ ...data, id: doc.id });
                unknownLocationMap.set(lotKey, list);
            }

            const byLotList = itemsByLotMap.get(lotKey) || [];
            byLotList.push({ ...data, id: doc.id });
            itemsByLotMap.set(lotKey, byLotList);
        });

        // 2. Fetch Active Orders for Allocation Context
        // We fetch ALL orders here to avoid "Index Required" errors with complex queries.
        // Given the scale, fetching all orders once per import is acceptable.
        const activeOrderIds = new Set<string>();
        existingSnapshot.docs.forEach(doc => {
            const data = doc.data() as YarnInventoryItem;
            data.allocations?.forEach(a => activeOrderIds.add(a.orderId));
        });

        const ordersQuery = query(collectionGroup(db, 'orders'));
        const ordersSnap = await getDocs(ordersQuery);
        const ordersMap = new Map<string, OrderRow>();
        ordersSnap.forEach(d => {
             const data = d.data() as OrderRow;
             ordersMap.set(d.id, { id: d.id, ...data });
        });

        const toAdd: any[] = [];
        const toUpdate: any[] = [];
        const discrepancies: any[] = []; // NEW: Tracking Logic
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
          if (firstCol.startsWith('BU/')) {
            currentSectionLocation = firstCol;
            lastYarnName = ''; 
            continue; 
          }

          const lotNumber = String(row[1] || '').trim();
          const quantity = parseFloat(row[2]);
          if (!lotNumber || isNaN(quantity)) continue;

          let yarnName = firstCol;
          if (!yarnName && lastYarnName) yarnName = lastYarnName;
          if (!yarnName) continue; 
          lastYarnName = yarnName;

          let location = String(row[3] || '').trim();
          if (!location) location = currentSectionLocation || 'Unknown';

          const key = `${yarnName.toLowerCase()}-${lotNumber.toLowerCase()}-${location.toLowerCase()}`;
          const lotKey = `${yarnName.toLowerCase()}-${lotNumber.toLowerCase()}`;
          
          if (processedKeys.has(key)) { fileDuplicatesCount++; continue; }
          processedKeys.add(key);

          let existingItem = existingMap.get(key);

          // Matching Logic
          if (!existingItem) {
             const unknowns = unknownLocationMap.get(lotKey);
             if (unknowns && unknowns.length > 0) {
                 existingItem = unknowns.shift();
             }
          }

          if (existingItem) {
            // Update Logic
            const qtyChanged = Math.abs(existingItem.quantity - quantity) > 0.01;
            const locChanged = existingItem.location !== location;
            
            // Calculate Total Allocated for this existing item
            // Enrich allocations with Order Details
            const currentAllocations = (existingItem.allocations || []).map(alloc => {
                const order = ordersMap.get(alloc.orderId);
                return {
                    ...alloc,
                    _orderDetails: order ? {
                        material: order.material,
                        quantity: order.requiredQty || 0,
                        remaining: order.remainingQty || 0,
                        clientName: alloc.clientName // Use persisted client name or could fetch from parent collection if structure allowed
                    } : null
                };
            });
            const totalAllocated = currentAllocations.reduce((sum, a) => sum + (a.quantity || 0), 0);

            // ROBUSTNESS LOGIC: Detect Plan vs Reality Discrepancies
            // Calculate actual consumption from the file (Old - New)
            // If Old < New, consumption is negative (increase/return), which we ignore for this check
            const actualConsumption = Math.max(0, existingItem.quantity - quantity);
            
            // 1. Stale Allocation (Ghost Plan): Allocated but NOT Consumed
            // Threshold: Allocated > 10kg, Consumption < 2kg (allowing for minor scale diffs)
            if (totalAllocated > 10 && actualConsumption < 2) {
                discrepancies.push({
                    type: 'stale',
                    yarnName,
                    lotNumber,
                    allocations: currentAllocations,
                    allocated: totalAllocated,
                    consumption: actualConsumption,
                    reason: "Allocated stock was not touched. Possible Lot Swap."
                });
            }
            
            // 2. Ghost Consumption (Unplanned Usage): Consumed but NOT Allocated
            // Threshold: Allocated == 0, Consumption > 10kg
            else if (totalAllocated === 0 && actualConsumption > 10) {
                discrepancies.push({
                    type: 'ghost',
                    yarnName,
                    lotNumber,
                    consumption: actualConsumption,
                    reason: "Stock consumed without allocation. Possible Lot Swap target."
                });
            }
            
            // 3. Significant Deviation: Consumption differs greatly from Allocation
            // Threshold: Diff > 20% and at least 10kg
            else if (totalAllocated > 0) {
                const diff = Math.abs(totalAllocated - actualConsumption);
                if (diff > 10 && diff > (totalAllocated * 0.2)) {
                     discrepancies.push({
                        type: 'deviation',
                        yarnName,
                        lotNumber,
                        allocated: totalAllocated,
                        consumption: actualConsumption,
                        reason: actualConsumption > totalAllocated 
                             ? "Consumed more than allocated." 
                             : "Consumed less than allocated."
                    });
                }
            }

            if (qtyChanged || locChanged) {
              toUpdate.push({
                id: existingItem.id,
                yarnName,
                lotNumber,
                oldQuantity: existingItem.quantity,
                newQuantity: quantity,
                oldLocation: existingItem.location,
                newLocation: location,
                allocations: currentAllocations, // Pass existing allocations to preview
                totalAllocated: totalAllocated
              });
            } else {
              unchangedCount++;
            }
          } else {
            // New Item
            toAdd.push({
              yarnName,
              lotNumber,
              quantity,
              location
            });
          }
        }

        setImportPreview({
            added: toAdd,
            updated: toUpdate,
            discrepancies: discrepancies, // NEW
            unchanged: unchangedCount,
            duplicates: fileDuplicatesCount,
            isOpen: true
        });
        
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

          const commitBatch = async () => {
              if (batchCount > 0) {
                  await batch.commit();
                  batchCount = 0;
              }
          }

          // Process Adds
          for (const item of importPreview.added) {
              const ref = doc(collection(db, 'yarn_inventory'));
              batch.set(ref, {
                  yarnName: item.yarnName,
                  lotNumber: item.lotNumber,
                  quantity: item.quantity,
                  location: item.location,
                  allocations: [],
                  lastUpdated: new Date().toISOString()
              });
              batchCount++;
              if (batchCount >= MAX_BATCH_SIZE) await commitBatch();
          }

          // Process Updates
          for (const item of importPreview.updated) {
              const ref = doc(db, 'yarn_inventory', item.id);
              const updates: any = {
                  quantity: item.newQuantity,
                  location: item.newLocation, // Ensure location is synced
                  lastUpdated: new Date().toISOString()
              };
              
              batch.update(ref, updates);
              batchCount++;
              if (batchCount >= MAX_BATCH_SIZE) await commitBatch();
          }
          
          if (batchCount > 0) await batch.commit();

          alert(`Import Successful!\nAdded: ${importPreview.added.length}\nUpdated: ${importPreview.updated.length}`);
          setImportPreview(prev => ({ ...prev, isOpen: false }));
          fetchInventory();

      } catch (error) {
          console.error("Error saving import:", error);
          alert("Failed to save changes.");
      } finally {
          setImporting(false);
      }
  };

  // Identify Unlinked Yarns
  const unlinkedYarns = useMemo(() => {
      if (inventory.length === 0 || masterYarns.length === 0) return [];
      
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const masterNames = new Set(masterYarns.map(y => normalize(y.name)));
      
      const missing = new Set<string>();
      inventory.forEach(item => {
          const normName = normalize(item.yarnName);
          if (!masterNames.has(normName)) {
              missing.add(item.yarnName); // Keep original name for creation
          }
      });
      
      return Array.from(missing).sort();
  }, [inventory, masterYarns]);

  const handleLinkAll = async () => {
      if (!confirm(`This will create ${unlinkedYarns.length} new Master Yarns. Continue?`)) return;
      
      setLoading(true);
      try {
          let createdCount = 0;
          for (const name of unlinkedYarns) {
              await YarnService.addYarn(name);
              createdCount++;
          }
          
          // Refresh Master List
          const yarns = await YarnService.getAllYarns();
          setMasterYarns(yarns);
          
          alert(`Successfully created ${createdCount} new Master Yarns!`);
      } catch (e) {
          console.error(e);
          alert("Error creating yarns: " + e);
      } finally {
          setLoading(false);
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
            
            {/* Unlinked Yarns Banner */}
            {unlinkedYarns.length > 0 && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between shadow-sm gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-amber-100 rounded-full text-amber-600 mt-0.5">
                            <AlertCircle className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-amber-800">Missing Master Definitions</h3>
                            <p className="text-sm text-amber-700 mt-1">
                                Found <span className="font-bold">{unlinkedYarns.length}</span> yarn types in inventory that are not in the Master Yarn List.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                                {unlinkedYarns.slice(0, 5).map(name => (
                                    <span key={name} className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                                        {name}
                                    </span>
                                ))}
                                {unlinkedYarns.length > 5 && (
                                    <span className="text-[10px] px-2 py-0.5 text-amber-600">
                                        +{unlinkedYarns.length - 5} more...
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleLinkAll}
                        disabled={loading}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium text-sm shadow-sm flex items-center gap-2 whitespace-nowrap transition-colors"
                    >
                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Link All ({unlinkedYarns.length})
                    </button>
                </div>
            )}

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
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
                <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
                            Inventory Import Preview
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">Review changes before syncing to database</p>
                    </div>
                    <button onClick={() => setImportPreview(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <X className="w-6 h-6 text-slate-400" />
                    </button>
                </div>

                <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2 gap-4">
                     <button
                        onClick={() => setPreviewTab('all')}
                        className={`pb-3 px-1 text-sm font-medium transition-colors relative ${
                            previewTab === 'all' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                        }`}
                     >
                        Overview
                        {previewTab === 'all' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />}
                     </button>
                     <button
                        onClick={() => setPreviewTab('allocated')}
                        className={`pb-3 px-1 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                            previewTab === 'allocated' ? 'text-amber-600' : 'text-slate-500 hover:text-slate-700'
                        }`}
                     >
                        Yarns with Allocations
                        {importPreview.updated.some(i => i.totalAllocated > 0) && (
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        )}
                        {previewTab === 'allocated' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-600 rounded-t-full" />}
                     </button>
                     <button
                        onClick={() => setPreviewTab('analysis')}
                        className={`pb-3 px-1 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                            previewTab === 'analysis' ? 'text-purple-600' : 'text-slate-500 hover:text-slate-700'
                        }`}
                     >
                        Smart Analysis
                        {importPreview.discrepancies.length > 0 && (
                            <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                                {importPreview.discrepancies.length}
                            </span>
                        )}
                        {previewTab === 'analysis' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full" />}
                     </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto flex-1 bg-slate-50/30">
                    
                    {/* Stats Grid */}
                    {previewTab === 'analysis' && (
                        <div className="space-y-6">
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex gap-3 text-purple-900 text-sm">
                                <div className="bg-purple-100 p-2 rounded-full h-fit">
                                    <Star className="w-5 h-5 text-purple-600" />
                                </div>
                                <div>
                                    <p className="font-bold mb-1 text-lg">Intelligent Reconciliation</p>
                                    <p className="opacity-90 leading-relaxed">
                                        The system has analyzed usage patterns to detect where Reality diverged from the Plan.
                                        <br/>
                                        Use these insights to identify <strong>Lot Swaps</strong> (Planned Lot A, used Lot B) or <strong>Ghost Consumption</strong>.
                                    </p>
                                </div>
                            </div>

                            {importPreview.discrepancies.length === 0 ? (
                                <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
                                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-200" />
                                    <p>No significant planning discrepancies detected.</p>
                                    <p className="text-xs text-slate-400 mt-1">Reality matches the Allocation Plan closely.</p>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {importPreview.discrepancies.map((item, idx) => (
                                        <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
                                            {/* Status Strip */}
                                            <div className={`w-full md:w-2 ${
                                                item.type === 'stale' ? 'bg-amber-400' : 
                                                item.type === 'ghost' ? 'bg-rose-500' : 'bg-blue-400'
                                            }`} />
                                            
                                            <div className="p-4 flex-1">
                                                <div className="flex items-start justify-between mb-2">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-bold text-slate-800 text-lg">{item.yarnName}</h4>
                                                            <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">
                                                                {item.lotNumber}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            {item.type === 'stale' && (
                                                                <span className="text-[10px] uppercase font-bold tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                                                    Stale Plan
                                                                </span>
                                                            )}
                                                            {item.type === 'ghost' && (
                                                                <span className="text-[10px] uppercase font-bold tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">
                                                                    Ghost Usage
                                                                </span>
                                                            )}
                                                            {item.type === 'deviation' && (
                                                                <span className="text-[10px] uppercase font-bold tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                                                    Deviation
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Impact Metric */}
                                                    <div className="text-right">
                                                        <div className="text-xs text-slate-400 uppercase font-bold">Unaccounted Diff</div>
                                                        <div className="text-xl font-mono font-bold text-slate-700">
                                                            {Math.abs((item.consumption || 0) - (item.allocated || 0)).toFixed(1)} kg
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 text-sm grid grid-cols-2 gap-4 my-3">
                                                    <div>
                                                        <span className="text-slate-400 text-xs uppercase block">Allocated (Plan)</span>
                                                        <span className="font-bold text-slate-700">{(item.allocated || 0).toLocaleString()} kg</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-400 text-xs uppercase block">Consumed (Reality)</span>
                                                        <span className="font-bold text-slate-700">{(item.consumption || 0).toLocaleString()} kg</span>
                                                    </div>
                                                </div>

                                                <p className="text-sm text-slate-600 bg-slate-50/50 italic border-l-2 border-slate-300 pl-3 py-1">
                                                    " {item.reason} "
                                                </p>
                                                
                                                {/* Action Suggestion */}
                                                {item.type === 'stale' && (
                                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                                        <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                                                            <AlertCircle className="w-3 h-3" />
                                                            Recommendation: Verify if this lot was swapped at the machine. The allocation might need to move.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {previewTab === 'all' && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Package className="w-12 h-12 text-emerald-600" />
                                </div>
                                <div className="text-3xl font-bold text-emerald-600 mb-1">{importPreview.added.length}</div>
                                <div className="text-xs font-bold text-emerald-800 uppercase tracking-widest opacity-70">New Items</div>
                            </div>
                            
                            <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <RefreshCw className="w-12 h-12 text-blue-600" />
                                </div>
                                <div className="text-3xl font-bold text-blue-600 mb-1">{importPreview.updated.length}</div>
                                <div className="text-xs font-bold text-blue-800 uppercase tracking-widest opacity-70">to Update</div>
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                                <div className="text-3xl font-bold text-slate-600 mb-1">{importPreview.unchanged}</div>
                                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest opacity-70">Unchanged</div>
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-orange-100 shadow-sm relative overflow-hidden">
                                <div className="text-3xl font-bold text-orange-600 mb-1">{importPreview.duplicates}</div>
                                <div className="text-xs font-bold text-orange-800 uppercase tracking-widest opacity-70">Duplicates</div>
                            </div>
                        </div>
                    )}

                    {previewTab === 'all' && importPreview.updated.length > 0 && (
                        <div>
                            <h3 className="flex items-center gap-2 font-bold text-slate-700 mb-3 text-sm uppercase tracking-wider">
                                <List className="w-4 h-4" />
                                All Modification Details
                            </h3>
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ring-1 ring-slate-100">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50/50 text-slate-500 font-medium text-xs uppercase border-b border-slate-100">
                                        <tr>
                                            <th className="px-5 py-3">Yarn / Lot</th>
                                            <th className="px-5 py-3 text-right">Old Qty</th>
                                            <th className="px-5 py-3 text-center"></th>
                                            <th className="px-5 py-3 text-right">New Qty</th>
                                            <th className="px-5 py-3">Location</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {importPreview.updated.slice(0, 50).map((item, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-5 py-3">
                                                    <div className="font-bold text-slate-700">{item.yarnName}</div>
                                                    <div className="text-xs text-slate-400 font-mono mt-0.5">{item.lotNumber}</div>
                                                </td>
                                                <td className="px-5 py-3 text-right text-slate-400 font-mono line-through decoration-slate-300">
                                                    {item.oldQuantity.toLocaleString()}
                                                </td>
                                                <td className="px-1 py-3 text-center text-slate-300">
                                                    <ArrowRight className="w-3 h-3 mx-auto" />
                                                </td>
                                                <td className="px-5 py-3 text-right font-mono font-bold text-indigo-600">
                                                    {item.newQuantity.toLocaleString()}
                                                </td>
                                                <td className="px-5 py-3 text-xs">
                                                    {item.oldLocation !== item.newLocation ? (
                                                        <div className="flex flex-col">
                                                            <span className="text-slate-400 line-through text-[10px]">{item.oldLocation}</span>
                                                            <span className="text-emerald-600 font-medium mt-0.5 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 w-fit">
                                                                {item.newLocation}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-500">{item.newLocation}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        {importPreview.updated.length > 50 && (
                                            <tr>
                                                <td colSpan={5} className="px-5 py-3 text-center text-xs text-slate-400 italic bg-slate-50/30">
                                                    ...and {importPreview.updated.length - 50} more updates hidden
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {previewTab === 'allocated' && (
                        <div className="space-y-4">
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-amber-800 text-sm">
                                <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-600" />
                                <div>
                                    <p className="font-bold mb-1">Impact Analysis</p>
                                    <p className="opacity-90">
                                        These items have active allocations (reserved for Orders). 
                                        Verify that the <strong>New Available Stock</strong> is sufficient to cover these reserves.
                                        If 'New Qty' is less than 'Allocated', you have a stock deficit.
                                    </p>
                                </div>
                            </div>

                            {importPreview.updated.filter(i => (i.totalAllocated || 0) > 0).length === 0 ? (
                                <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
                                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-slate-200" />
                                    <p>No allocated items are being modified in this import.</p>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {importPreview.updated
                                        .filter(i => (i.totalAllocated || 0) > 0)
                                        .sort((a,b) => (b.totalAllocated || 0) - (a.totalAllocated || 0))
                                        .map((item, idx) => {
                                            const deficit = (item.totalAllocated || 0) > item.newQuantity;
                                            const coverage = Math.min(100, (item.newQuantity / (item.totalAllocated || 1)) * 100);
                                            
                                            return (
                                                <div key={idx} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${deficit ? 'border-red-200 ring-4 ring-red-50' : 'border-slate-200'}`}>
                                                    <div className="p-4 flex flex-col md:flex-row gap-6 items-start md:items-center">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <h4 className="font-bold text-slate-800">{item.yarnName}</h4>
                                                                <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">
                                                                    {item.lotNumber}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-4 text-sm mt-2">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">New Stock</span>
                                                                    <span className="font-mono font-bold text-slate-700 text-lg">{item.newQuantity.toLocaleString()}</span>
                                                                </div>
                                                                <div className="h-8 w-px bg-slate-100 mx-2"></div>
                                                                <div className="flex flex-col">
                                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Allocated</span>
                                                                    <span className="font-mono font-medium text-slate-600 text-lg">{item.totalAllocated.toLocaleString()}</span>
                                                                </div>
                                                                
                                                                {deficit && (
                                                                    <div className="ml-auto bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold border border-red-200 flex items-center gap-1">
                                                                        <AlertCircle className="w-3 h-3" />
                                                                        Deficit: {(item.totalAllocated - item.newQuantity).toFixed(1)} kg
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="w-full md:w-64 flex flex-col gap-1.5 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                            <div className="flex justify-between text-xs font-medium">
                                                                <span className={deficit ? 'text-red-600' : 'text-slate-500'}>Allocation Coverage</span>
                                                                <span className={deficit ? 'text-red-700 font-bold' : 'text-indigo-600 font-bold'}>
                                                                    {coverage.toFixed(0)}%
                                                                </span>
                                                            </div>
                                                            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                <div 
                                                                    className={`h-full rounded-full ${deficit ? 'bg-red-500' : 'bg-indigo-500'}`}
                                                                    style={{ width: `${coverage}%` }} 
                                                                />
                                                            </div>
                                                            <p className="text-[10px] text-slate-400 leading-tight mt-1">
                                                                {deficit 
                                                                    ? "Warning: Physical stock is lower than allocated amount." 
                                                                    : "Allocations are fully covered by new stock level."}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Allocation Details Summary - ENHANCED */}
                                                    {item.allocations && item.allocations.length > 0 && (
                                                        <div className="bg-slate-50/50 px-4 py-3 border-t border-slate-100 text-xs">
                                                            <div className="space-y-2">
                                                                {item.allocations.map((a: any, k: number) => {
                                                                    const orderDetails = a._orderDetails;
                                                                    const isDeficit = orderDetails && orderDetails.remaining < a.quantity;
                                                                    const suggestedAmt = isDeficit ? orderDetails.remaining : a.quantity;
                                                                    
                                                                    return (
                                                                        <div key={k} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded bg-white border border-slate-200 shadow-sm">
                                                                            <div className="flex items-center gap-2">
                                                                                <div className="font-bold text-slate-700 w-24 truncate" title={a.clientName}>
                                                                                    {a.clientName || 'Unknown Client'}
                                                                                </div>
                                                                                <div className="w-px h-3 bg-slate-200"></div>
                                                                                <div className="flex flex-col">
                                                                                    <span className="font-medium text-indigo-700">
                                                                                        {orderDetails?.material || a.fabricName || 'Unknown Fabric'}
                                                                                    </span>
                                                                                    <span className="text-[10px] text-slate-400">
                                                                                        Reserved: {new Date(a.timestamp).toLocaleDateString()}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            <div className="flex items-center gap-3 text-[11px] bg-slate-50 px-2 py-1 rounded border border-slate-100 ml-auto sm:ml-0 w-full sm:w-auto justify-between sm:justify-start">
                                                                                <div title="Current Allocation">
                                                                                    <span className="text-slate-400 block sm:inline mr-1">Allocated:</span>
                                                                                    <span className="font-bold text-slate-700">{Number(a.quantity).toFixed(1)}kg</span>
                                                                                </div>
                                                                                
                                                                                {orderDetails && (
                                                                                    <>
                                                                                        <div className="w-px h-3 bg-slate-200 hidden sm:block"></div>
                                                                                        <div title="Total Order Qty">
                                                                                            <span className="text-slate-400 block sm:inline mr-1">Ordered:</span>
                                                                                            <span className="font-mono text-slate-600">{Number(orderDetails.quantity).toFixed(1)}kg</span>
                                                                                        </div>
                                                                                        <div className="w-px h-3 bg-slate-200 hidden sm:block"></div>
                                                                                        <div title="Remaining to Produce">
                                                                                            <span className="text-slate-400 block sm:inline mr-1">Remaining:</span>
                                                                                            <span className={`font-mono font-bold ${orderDetails.remaining <= 0 ? 'text-green-600' : 'text-amber-600'}`}>
                                                                                                {Number(orderDetails.remaining).toFixed(1)}kg
                                                                                            </span>
                                                                                        </div>
                                                                                    </>
                                                                                )}
                                                                            </div>

                                                                            {/* Suggestion / Status */}
                                                                            {orderDetails && orderDetails.remaining < a.quantity && (
                                                                                <div className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-100 whitespace-nowrap">
                                                                                    <AlertCircle className="w-3 h-3" />
                                                                                    <span>
                                                                                        Over-allocated!
                                                                                        <span className="hidden sm:inline"> (Req: {orderDetails.remaining.toFixed(1)})</span>
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                        </div>
                    )}

                </div>
                
                <div className="px-6 py-4 bg-white border-t border-slate-200 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                    <div className="text-xs text-slate-400 hidden sm:block">
                        <strong>Note:</strong> Import will only update Quantities & Locations. Allocations are preserved.
                    </div>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setImportPreview(prev => ({ ...prev, isOpen: false }))}
                            className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-all hover:shadow-sm"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={confirmImport}
                            disabled={importing}
                            className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-70 disabled:hover:translate-y-0 disabled:shadow-none"
                        >
                            {importing ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Processing Import...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="w-5 h-5" />
                                    Confirm Update
                                </>
                            )}
                        </button>
                    </div>
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
