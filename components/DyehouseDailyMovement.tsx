import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { OrderRow, FabricDefinition, DyeingBatch } from '../types';
import { 
  Calendar,
  ArrowRight,
  Factory,
  User,
  Package,
  Droplets,
  Box,
  PenBox,
  Ship,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  Activity,
  Clock,
  TrendingUp,
  Filter
} from 'lucide-react';

// Status Configuration - Same as Active Work
const DYEHOUSE_STEPS = [
  { id: 'STORE_RAW', label: 'مخزن مصبغة', shortLabel: 'مخزن', icon: Box, color: '#64748b', bgColor: 'bg-slate-100', textColor: 'text-slate-700', borderColor: 'border-slate-300' },
  { id: 'DYEING', label: 'صباغة', shortLabel: 'صباغة', icon: PenBox, color: '#7c3aed', bgColor: 'bg-purple-100', textColor: 'text-purple-700', borderColor: 'border-purple-300' },
  { id: 'FINISHING', label: 'تجهيز', shortLabel: 'تجهيز', icon: Factory, color: '#f59e0b', bgColor: 'bg-amber-100', textColor: 'text-amber-700', borderColor: 'border-amber-300' },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن', shortLabel: 'منتهي', icon: Ship, color: '#10b981', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700', borderColor: 'border-emerald-300' },
  { id: 'RECEIVED', label: 'مستلم', shortLabel: 'مستلم', icon: Check, color: '#3b82f6', bgColor: 'bg-blue-100', textColor: 'text-blue-700', borderColor: 'border-blue-300' }
] as const;

type DyehouseStatusType = 'STORE_RAW' | 'DYEING' | 'FINISHING' | 'STORE_FINISHED' | 'RECEIVED';

interface MovementItem {
  id: string;
  orderId: string;
  batchIdx: number;
  clientId: string;
  clientName: string;
  fabric: string;
  fabricShortName?: string;
  color: string;
  colorHex?: string;
  quantity: number;
  quantitySent: number;
  dyehouse: string;
  machine: string;
  plannedCapacity?: number;
  dispatchNumber?: string;
  // Movement specific
  fromStatus: DyehouseStatusType | 'NEW';
  toStatus: DyehouseStatusType;
  movementDate: string;
  updatedBy?: string;
}

interface DyehouseGroup {
  dyehouse: string;
  movements: MovementItem[];
  totalQuantity: number;
}

export const DyehouseDailyMovement: React.FC = () => {
  const [allItems, setAllItems] = useState<MovementItem[]>([]);
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedDyehouse, setSelectedDyehouse] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDyehouses, setExpandedDyehouses] = useState<Set<string>>(new Set());

  // Fetch all data
  useEffect(() => {
    setLoading(true);
    
    const fetchDyehouses = async () => {
      const snapshot = await getDocs(collection(db, 'dyehouses'));
      const list = snapshot.docs.map(doc => doc.data().name as string).sort();
      setAllDyehouses(list);
    };
    fetchDyehouses();

    const unsubscribe = onSnapshot(query(collectionGroup(db, 'orders')), async (snapshot) => {
      const clientsSnapshot = await getDocs(collection(db, 'CustomerSheets'));
      const clientMap: Record<string, string> = {};
      clientsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        clientMap[doc.id] = data.name || 'Unknown Client';
      });

      const fabricsSnapshot = await getDocs(collection(db, 'fabrics'));
      const fabricMap: Record<string, string> = {};
      fabricsSnapshot.docs.forEach(doc => {
        const data = doc.data() as FabricDefinition;
        fabricMap[data.name] = data.shortName || data.name;
      });

      const movements: MovementItem[] = [];

      snapshot.docs.forEach(docSnap => {
        const order = { id: docSnap.id, ...docSnap.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach((batch, idx) => {
            // Only look at batches with dyehouseHistory
            if (!batch.dyehouseHistory || !Array.isArray(batch.dyehouseHistory)) return;
            
            const dyehouseName = batch.dyehouse || order.dyehouse || 'Unassigned';
            const machineName = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || order.dyehouseMachine || '');
            
            // Calculate sent quantities
            const sentEvents = batch.sentEvents || [];
            const sentRaw = sentEvents.reduce((s: number, e: any) => s + (Number(e.quantity) || 0), 0) + (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
            const sentAcc = sentEvents.reduce((s: number, e: any) => s + (Number(e.accessorySent) || 0), 0) + (Number(batch.quantitySentAccessory) || 0);
            const totalSent = sentRaw + sentAcc;

            // Process history to find movements
            const history = batch.dyehouseHistory as any[];
            
            // Sort history by date to ensure proper ordering
            const sortedHistory = [...history].sort((a, b) => {
              const dateA = new Date(a.date || a.enteredAt || '').getTime();
              const dateB = new Date(b.date || b.enteredAt || '').getTime();
              return dateA - dateB;
            });

            sortedHistory.forEach((entry, entryIdx) => {
              const entryDate = entry.date || entry.enteredAt;
              if (!entryDate) return;
              
              // Determine "from" status (previous status or NEW if first entry)
              let fromStatus: DyehouseStatusType | 'NEW' = 'NEW';
              if (entryIdx > 0) {
                fromStatus = sortedHistory[entryIdx - 1].status;
              }
              
              movements.push({
                id: `${order.id}-${idx}-${entry.status}-${entryDate}`,
                orderId: order.id,
                batchIdx: idx,
                clientId: clientId,
                clientName: clientName,
                fabric: order.material,
                fabricShortName: parseFabricName(order.material).shortName || order.material,
                color: batch.color,
                colorHex: batch.colorHex,
                quantity: batch.quantity,
                quantitySent: totalSent,
                dyehouse: dyehouseName,
                machine: machineName,
                plannedCapacity: batch.plannedCapacity,
                dispatchNumber: batch.dispatchNumber,
                fromStatus: fromStatus,
                toStatus: entry.status,
                movementDate: entryDate,
                updatedBy: entry.updatedBy || entry.modifiedBy
              });
            });
          });
        }
      });

      setAllItems(movements);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter items by selected date
  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      // Date filter (must match selected date)
      if (item.movementDate !== selectedDate) return false;
      
      // Dyehouse filter
      if (selectedDyehouse && item.dyehouse !== selectedDyehouse) return false;
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch = 
          item.clientName.toLowerCase().includes(search) ||
          item.fabric.toLowerCase().includes(search) ||
          item.color.toLowerCase().includes(search) ||
          (item.dispatchNumber && item.dispatchNumber.toLowerCase().includes(search));
        if (!matchesSearch) return false;
      }
      
      return true;
    });
  }, [allItems, selectedDate, selectedDyehouse, searchTerm]);

  // Group items by dyehouse
  const dyehouseGroups = useMemo(() => {
    const groups: Record<string, DyehouseGroup> = {};
    
    filteredItems.forEach(item => {
      if (!groups[item.dyehouse]) {
        groups[item.dyehouse] = {
          dyehouse: item.dyehouse,
          movements: [],
          totalQuantity: 0
        };
      }
      groups[item.dyehouse].movements.push(item);
      groups[item.dyehouse].totalQuantity += item.quantitySent || item.quantity;
    });
    
    return Object.values(groups).sort((a, b) => a.dyehouse.localeCompare(b.dyehouse));
  }, [filteredItems]);

  // Stats
  const stats = useMemo(() => {
    const totalMovements = filteredItems.length;
    const totalQuantity = filteredItems.reduce((sum, item) => sum + (item.quantitySent || item.quantity || 0), 0);
    const uniqueClients = new Set(filteredItems.map(i => i.clientId)).size;
    const dyehousesActive = new Set(filteredItems.map(i => i.dyehouse)).size;
    
    // Count by status transition type
    const toDyeing = filteredItems.filter(i => i.toStatus === 'DYEING').length;
    const toFinishing = filteredItems.filter(i => i.toStatus === 'FINISHING').length;
    const toReceived = filteredItems.filter(i => i.toStatus === 'RECEIVED').length;
    
    return { totalMovements, totalQuantity, uniqueClients, dyehousesActive, toDyeing, toFinishing, toReceived };
  }, [filteredItems]);

  const getStatusConfig = (status: DyehouseStatusType | 'NEW') => {
    if (status === 'NEW') {
      return { label: 'جديد', shortLabel: 'جديد', icon: Package, color: '#6b7280', bgColor: 'bg-gray-100', textColor: 'text-gray-600', borderColor: 'border-gray-300' };
    }
    return DYEHOUSE_STEPS.find(s => s.id === status) || DYEHOUSE_STEPS[0];
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ar-EG', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const toggleDyehouseExpanded = (dyehouse: string) => {
    const newSet = new Set(expandedDyehouses);
    if (newSet.has(dyehouse)) {
      newSet.delete(dyehouse);
    } else {
      newSet.add(dyehouse);
    }
    setExpandedDyehouses(newSet);
  };

  // Expand all by default when data loads
  useEffect(() => {
    if (dyehouseGroups.length > 0) {
      setExpandedDyehouses(new Set(dyehouseGroups.map(g => g.dyehouse)));
    }
  }, [dyehouseGroups.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg shadow-sm">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Daily Dyehouse Movement</h2>
              <p className="text-sm text-slate-500">Track all status changes across dyehouses</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Picker */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 outline-none text-sm font-medium"
              />
            </div>

            {/* Dyehouse Filter */}
            <select
              value={selectedDyehouse}
              onChange={(e) => setSelectedDyehouse(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 outline-none text-sm"
            >
              <option value="">All Dyehouses</option>
              {allDyehouses.map(dh => (
                <option key={dh} value={dh}>{dh}</option>
              ))}
            </select>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search client, fabric, color..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 outline-none text-sm w-64"
              />
            </div>
          </div>
        </div>

        {/* Date Display */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-700">
            <Clock className="w-5 h-5 text-purple-500" />
            {formatDate(selectedDate)}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Movements</div>
          <div className="text-2xl font-bold text-slate-800">{stats.totalMovements}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Quantity</div>
          <div className="text-2xl font-bold text-slate-800">{stats.totalQuantity.toLocaleString()}<span className="text-sm font-normal text-slate-400 ml-1">kg</span></div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Clients</div>
          <div className="text-2xl font-bold text-slate-800">{stats.uniqueClients}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Dyehouses</div>
          <div className="text-2xl font-bold text-slate-800">{stats.dyehousesActive}</div>
        </div>
        <div className="bg-purple-50 rounded-lg border border-purple-200 p-3 shadow-sm">
          <div className="text-xs text-purple-600 font-medium flex items-center gap-1"><PenBox size={12} /> To Dyeing</div>
          <div className="text-2xl font-bold text-purple-700">{stats.toDyeing}</div>
        </div>
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 shadow-sm">
          <div className="text-xs text-amber-600 font-medium flex items-center gap-1"><Factory size={12} /> To Finishing</div>
          <div className="text-2xl font-bold text-amber-700">{stats.toFinishing}</div>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 shadow-sm">
          <div className="text-xs text-blue-600 font-medium flex items-center gap-1"><Check size={12} /> Received</div>
          <div className="text-2xl font-bold text-blue-700">{stats.toReceived}</div>
        </div>
      </div>

      {/* Empty State */}
      {dyehouseGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <Activity className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-600">No movements on this date</h3>
          <p className="text-sm text-slate-400 mt-1">Try selecting a different date or adjusting your filters</p>
        </div>
      )}

      {/* Dyehouse Groups */}
      {dyehouseGroups.map(group => (
        <div key={group.dyehouse} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Group Header */}
          <button
            onClick={() => toggleDyehouseExpanded(group.dyehouse)}
            className="w-full px-4 py-3 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between hover:from-slate-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Factory className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-slate-800">{group.dyehouse}</h3>
                <p className="text-xs text-slate-500">{group.movements.length} movements • {group.totalQuantity.toLocaleString()} kg</p>
              </div>
            </div>
            {expandedDyehouses.has(group.dyehouse) ? (
              <ChevronUp className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            )}
          </button>

          {/* Group Content */}
          {expandedDyehouses.has(group.dyehouse) && (
            <div className="border-t border-slate-100">
              {/* Movement Items */}
              <div className="divide-y divide-slate-100">
                {group.movements.map((item, idx) => {
                  const fromConfig = getStatusConfig(item.fromStatus);
                  const toConfig = getStatusConfig(item.toStatus);
                  const FromIcon = fromConfig.icon;
                  const ToIcon = toConfig.icon;

                  return (
                    <div 
                      key={item.id} 
                      className="px-4 py-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {/* Color Indicator */}
                        <div 
                          className="w-4 h-4 rounded-full border-2 border-white shadow-sm shrink-0"
                          style={{ backgroundColor: item.colorHex || '#cbd5e1' }}
                        />

                        {/* Main Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800">{item.color || 'No Color'}</span>
                            <span className="text-xs text-slate-400">•</span>
                            <span className="text-sm text-slate-600">{item.fabricShortName}</span>
                            <span className="text-xs text-slate-400">•</span>
                            <span className="text-sm text-slate-500 flex items-center gap-1">
                              <User size={12} />
                              {item.clientName}
                            </span>
                          </div>
                          
                          {/* Quantity & Machine */}
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Package size={10} />
                              {item.quantitySent || item.quantity} kg
                            </span>
                            {item.machine && (
                              <span className="flex items-center gap-1">
                                <Droplets size={10} />
                                {item.machine}
                              </span>
                            )}
                            {item.dispatchNumber && (
                              <span>#{item.dispatchNumber}</span>
                            )}
                          </div>
                        </div>

                        {/* Status Transition Visual */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* From Status */}
                          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${fromConfig.bgColor} border ${fromConfig.borderColor}`}>
                            <FromIcon size={14} className={fromConfig.textColor} />
                            <span className={`text-xs font-medium ${fromConfig.textColor}`}>
                              {fromConfig.shortLabel}
                            </span>
                          </div>

                          {/* Arrow */}
                          <div className="flex items-center">
                            <ArrowRight className="w-5 h-5 text-slate-400" />
                          </div>

                          {/* To Status */}
                          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${toConfig.bgColor} border ${toConfig.borderColor} ring-2 ring-offset-1`} style={{ '--tw-ring-color': toConfig.color } as any}>
                            <ToIcon size={14} className={toConfig.textColor} />
                            <span className={`text-xs font-medium ${toConfig.textColor}`}>
                              {toConfig.shortLabel}
                            </span>
                          </div>
                        </div>

                        {/* Updated By */}
                        {item.updatedBy && (
                          <div className="text-[10px] text-slate-400 shrink-0 hidden lg:block">
                            by {item.updatedBy.split('@')[0]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
