import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { OrderRow, FabricDefinition, DyeingBatch } from '../types';
import { 
  Search, 
  RefreshCw,
  Factory,
  User,
  Package,
  Calendar,
  Clock,
  Droplets,
  Box,
  PenBox,
  Ship,
  Check,
  ChevronDown,
  Eye,
  Layers
} from 'lucide-react';

// Status Configuration - Clean professional colors
const DYEHOUSE_STEPS = [
  { id: 'STORE_RAW', label: 'مخزن مصبغة', shortLabel: 'مخزن', icon: Box, color: '#64748b' },
  { id: 'DYEING', label: 'صباغة', shortLabel: 'صباغة', icon: PenBox, color: '#7c3aed' },
  { id: 'FINISHING', label: 'تجهيز', shortLabel: 'تجهيز', icon: Factory, color: '#f59e0b' },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن', shortLabel: 'منتهي', icon: Ship, color: '#10b981' },
  { id: 'RECEIVED', label: 'مستلم', shortLabel: 'مستلم', icon: Check, color: '#3b82f6' }
] as const;

type DyehouseStatusType = 'STORE_RAW' | 'DYEING' | 'FINISHING' | 'STORE_FINISHED' | 'RECEIVED';

interface ActiveWorkItem {
  id: string;
  orderId: string;
  batchIdx: number;
  clientId: string;
  clientName: string;
  orderReference?: string;
  fabric: string;
  fabricShortName?: string;
  color: string;
  colorHex?: string;
  quantity: number;
  quantitySent: number;
  quantitySentRaw: number;
  quantitySentAccessory: number;
  totalReceived: number;
  totalReceivedRaw: number;
  totalReceivedAccessory: number;
  dyehouse: string;
  machine: string;
  plannedCapacity?: number;
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  status: 'draft' | 'pending' | 'sent' | 'received';
  dyehouseStatus?: DyehouseStatusType;
  dyehouseStatusDate?: string;
  dyehouseHistory?: any[];
  notes?: string;
  accessoryType?: string;
  batch: DyeingBatch;
}

interface FabricGroup {
  fabric: string;
  fabricShortName: string;
  clientName: string;
  clientId: string;
  orderReference?: string;
  items: ActiveWorkItem[];
  totalSent: number;
  totalReceived: number;
  totalRemaining: number;
  machine: string;
  plannedCapacity?: number;
}

export const DyehouseActiveWorkPage: React.FC = () => {
  const [items, setItems] = useState<ActiveWorkItem[]>([]);
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedDyehouse, setSelectedDyehouse] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<DyehouseStatusType | 'All'>('All');
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    
    const fetchDyehouses = async () => {
      const snapshot = await getDocs(collection(db, 'dyehouses'));
      const list = snapshot.docs.map(doc => doc.data().name as string).sort();
      setAllDyehouses(list);
      if (list.length > 0 && !selectedDyehouse) {
        setSelectedDyehouse(list[0]);
      }
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

      const allItems: ActiveWorkItem[] = [];

      snapshot.docs.forEach(docSnap => {
        const order = { id: docSnap.id, ...docSnap.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach((batch, idx) => {
            if (batch.status !== 'sent') return;
            
            // Calculate sent quantities (same logic as ClientOrdersPage)
            const sentEvents = batch.sentEvents || [];
            const sentRaw = sentEvents.reduce((s, e) => s + (Number(e.quantity) || 0), 0) + (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
            const sentAcc = sentEvents.reduce((s, e) => s + (Number(e.accessorySent) || 0), 0) + (Number(batch.quantitySentAccessory) || 0);
            const totalSent = sentRaw + sentAcc;
            
            // Calculate received quantities (same logic as ClientOrdersPage)
            const receiveEvents = batch.receiveEvents || [];
            const recRaw = receiveEvents.reduce((s, e) => s + (Number(e.quantityRaw) || 0), 0) + (Number(batch.receivedQuantity) || 0);
            const recAcc = receiveEvents.reduce((s, e) => s + (Number(e.quantityAccessory) || 0), 0);
            const totalReceived = recRaw + recAcc;
            
            const dyehouseName = batch.dyehouse || order.dyehouse || 'Unassigned';
            const machineName = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || order.dyehouseMachine || '');
            
            allItems.push({
              id: `${order.id}-${idx}`,
              orderId: order.id,
              batchIdx: idx,
              clientId: clientId,
              clientName: clientName,
              orderReference: order.orderReference,
              fabric: order.material,
              fabricShortName: fabricMap[order.material] || order.material,
              color: batch.color,
              colorHex: batch.colorHex,
              quantity: batch.quantity,
              quantitySent: totalSent,
              quantitySentRaw: sentRaw,
              quantitySentAccessory: sentAcc,
              totalReceived: totalReceived,
              totalReceivedRaw: recRaw,
              totalReceivedAccessory: recAcc,
              dyehouse: dyehouseName,
              machine: machineName,
              plannedCapacity: batch.plannedCapacity,
              dispatchNumber: batch.dispatchNumber,
              dateSent: batch.dateSent,
              formationDate: batch.formationDate,
              status: batch.status || 'draft',
              dyehouseStatus: batch.dyehouseStatus,
              dyehouseStatusDate: batch.dyehouseStatusDate,
              dyehouseHistory: batch.dyehouseHistory,
              notes: batch.notes,
              accessoryType: batch.accessoryType,
              batch: batch
            });
          });
        }
      });

      setItems(allItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (!selectedDyehouse || item.dyehouse !== selectedDyehouse) return false;
      if (filterStatus !== 'All' && item.dyehouseStatus !== filterStatus) return false;
      
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch = 
          item.clientName.toLowerCase().includes(search) ||
          item.fabric.toLowerCase().includes(search) ||
          item.color.toLowerCase().includes(search) ||
          (item.dispatchNumber && item.dispatchNumber.toLowerCase().includes(search)) ||
          (item.orderReference && item.orderReference.toLowerCase().includes(search));
        if (!matchesSearch) return false;
      }
      
      return true;
    });
  }, [items, selectedDyehouse, filterStatus, searchTerm]);

  // Group items by fabric for multi-color display
  const fabricGroups = useMemo(() => {
    const groups: Record<string, FabricGroup> = {};
    
    filteredItems.forEach(item => {
      const key = `${item.clientId}-${item.fabric}-${item.orderId}`;
      
      if (!groups[key]) {
        groups[key] = {
          fabric: item.fabric,
          fabricShortName: item.fabricShortName || item.fabric,
          clientName: item.clientName,
          clientId: item.clientId,
          orderReference: item.orderReference,
          items: [],
          totalSent: 0,
          totalReceived: 0,
          totalRemaining: 0,
          machine: item.machine,
          plannedCapacity: item.plannedCapacity
        };
      }
      
      groups[key].items.push(item);
      groups[key].totalSent += item.quantitySent;
      groups[key].totalReceived += item.totalReceived;
      groups[key].totalRemaining += Math.max(0, item.quantitySent - item.totalReceived);
      
      // Use the largest machine
      if (item.plannedCapacity && (!groups[key].plannedCapacity || item.plannedCapacity > groups[key].plannedCapacity)) {
        groups[key].plannedCapacity = item.plannedCapacity;
        groups[key].machine = item.machine;
      }
    });
    
    return Object.values(groups).sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [filteredItems]);

  const statusGroups = useMemo(() => {
    const groups: Record<string, ActiveWorkItem[]> = {};
    DYEHOUSE_STEPS.forEach(step => {
      groups[step.id] = filteredItems.filter(item => item.dyehouseStatus === step.id);
    });
    groups['UNSET'] = filteredItems.filter(item => !item.dyehouseStatus);
    return groups;
  }, [filteredItems]);

  const stats = useMemo(() => {
    const totalItems = filteredItems.length;
    const totalQuantity = filteredItems.reduce((sum, item) => sum + (item.quantitySent || 0), 0);
    const inDyeing = statusGroups['DYEING']?.length || 0;
    const inFinishing = statusGroups['FINISHING']?.length || 0;
    const inStore = (statusGroups['STORE_RAW']?.length || 0) + (statusGroups['STORE_FINISHED']?.length || 0);
    
    return { totalItems, totalQuantity, inDyeing, inFinishing, inStore };
  }, [filteredItems, statusGroups]);

  const handleStatusChange = async (item: ActiveWorkItem, newStatus: DyehouseStatusType) => {
    setUpdatingItemId(item.id);
    try {
      const orderSnapshot = await getDocs(query(collectionGroup(db, 'orders')));
      const orderDoc = orderSnapshot.docs.find(d => d.id === item.orderId);
      
      if (!orderDoc) {
        console.error('Order not found');
        return;
      }
      
      const orderData = orderDoc.data() as OrderRow;
      const newDyeingPlan = [...(orderData.dyeingPlan || [])];
      
      const today = new Date().toISOString().split('T')[0];
      const existingHistory = newDyeingPlan[item.batchIdx]?.dyehouseHistory || [];
      
      const existingEntryIndex = existingHistory.findIndex((h: any) => h.status === newStatus);
      let newHistory = [...existingHistory];
      
      if (existingEntryIndex === -1) {
        newHistory.push({
          status: newStatus,
          date: today,
          updatedBy: auth.currentUser?.email || 'Unknown'
        });
      }
      
      newDyeingPlan[item.batchIdx] = {
        ...newDyeingPlan[item.batchIdx],
        dyehouseStatus: newStatus,
        dyehouseStatusDate: today,
        dyehouseHistory: newHistory
      };
      
      await updateDoc(orderDoc.ref, {
        dyeingPlan: newDyeingPlan
      });
      
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingItemId(null);
    }
  };

  const calculateDays = (dateStr?: string) => {
    if (!dateStr) return null;
    const sent = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusIndex = (status?: DyehouseStatusType) => {
    if (!status) return -1;
    return DYEHOUSE_STEPS.findIndex(s => s.id === status);
  };

  // Timeline Status Component (like the first image)
  const TimelineStatus = ({ item, onStatusChange }: { item: ActiveWorkItem, onStatusChange: (status: DyehouseStatusType) => void }) => {
    const activeIndex = getStatusIndex(item.dyehouseStatus);
    const historyMap = new Map((item.dyehouseHistory || []).map(h => [h.status, h]));
    
    return (
      <div className="py-4 px-3">
        {/* Progress Line Background */}
        <div className="relative">
          <div className="absolute top-6 left-8 right-8 h-0.5 bg-slate-200 rounded-full" />
          
          {/* Progress Line Active */}
          <div 
            className="absolute top-6 left-8 h-0.5 bg-indigo-500 rounded-full transition-all duration-500" 
            style={{ 
              width: activeIndex >= 0 ? `calc(${(activeIndex / (DYEHOUSE_STEPS.length - 1)) * 100}% - 32px)` : '0%' 
            }}
          />
          
          <div className="relative flex justify-between items-start">
            {DYEHOUSE_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = item.dyehouseStatus === step.id;
              const isCompleted = historyMap.has(step.id);
              const isPast = activeIndex > idx;
              
              return (
                <button
                  key={step.id}
                  onClick={() => onStatusChange(step.id)}
                  className="flex flex-col items-center group w-14"
                >
                  <div 
                    className={`
                      w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10
                      ${isActive 
                        ? 'bg-white border-indigo-500 text-indigo-600 ring-4 ring-indigo-50 scale-110' 
                        : isCompleted || isPast
                          ? 'bg-indigo-500 border-indigo-500 text-white' 
                          : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400'
                      }
                    `}
                  >
                    {(isCompleted || isPast) && !isActive ? (
                      <Check strokeWidth={3} size={18} />
                    ) : (
                      <Icon size={20} strokeWidth={1.5} />
                    )}
                  </div>
                  
                  <span className={`mt-2 text-[10px] font-semibold text-center leading-tight ${
                    isActive ? 'text-indigo-700' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                  }`}>
                    {step.shortLabel}
                  </span>
                  
                  {historyMap.has(step.id) && (
                    <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                      {formatDate(historyMap.get(step.id)?.date).slice(0, 5)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 -m-6 min-h-[calc(100vh-200px)]">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Droplets className="text-indigo-600" />
              Dyehouse Active Work
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">وضع جوا المصبغة - Live tracking</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Factory className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={selectedDyehouse}
                onChange={(e) => setSelectedDyehouse(e.target.value)}
                className="pl-10 pr-8 py-2 border border-slate-200 rounded-lg bg-white shadow-sm font-medium text-slate-700 appearance-none cursor-pointer min-w-[180px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              >
                <option value="">اختر المصبغة</option>
                {allDyehouses.map(dh => (
                  <option key={dh} value={dh}>{dh}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            </div>
          </div>
        </div>
      </div>

      {selectedDyehouse ? (
        <>
          {/* Stats */}
          <div className="px-6 py-3 bg-white border-b border-slate-200">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-slate-800">{stats.totalItems}</span>
                <span className="text-xs text-slate-500">أصناف</span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-indigo-600">{stats.totalQuantity.toLocaleString()}</span>
                <span className="text-xs text-slate-500">كجم</span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  <span className="text-slate-600">{stats.inDyeing} صباغة</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-slate-600">{stats.inFinishing} تجهيز</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-slate-600">{stats.inStore} مخزن</span>
                </span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="بحث..."
                className="w-full pl-9 pr-4 py-1.5 border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as DyehouseStatusType | 'All')}
              className="px-3 py-1.5 border border-slate-200 rounded-md bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">كل الحالات</option>
              {DYEHOUSE_STEPS.map(step => (
                <option key={step.id} value={step.id}>{step.label}</option>
              ))}
            </select>

            {(statusGroups['UNSET']?.length || 0) > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">
                <Eye size={12} />
                {statusGroups['UNSET']?.length} بدون وضع
              </span>
            )}
          </div>

          {/* Cards Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {fabricGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Package size={48} strokeWidth={1} />
                <p className="mt-4 text-lg">لا توجد أصناف في هذه المصبغة</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {fabricGroups.map(group => {
                  const hasMultipleColors = group.items.length > 1;
                  
                  return (
                    <div 
                      key={`${group.clientId}-${group.fabric}`}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                    >
                      {/* Card Header */}
                      <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Machine Badge - Prominent */}
                            {group.plannedCapacity && (
                              <div className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm">
                                {group.plannedCapacity}kg
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                                <Layers size={14} className="text-indigo-500" />
                                {group.fabricShortName}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                <User size={10} />
                                {group.clientName}
                              </div>
                            </div>
                          </div>
                          
                          {group.orderReference && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                              {group.orderReference}
                            </span>
                          )}
                        </div>

                        {/* Totals Row */}
                        <div className="flex items-center gap-4 mt-3 pt-2 border-t border-slate-100">
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-slate-700">{group.totalSent}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wide">مرسل</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-emerald-600">{group.totalReceived}</div>
                            <div className="text-[10px] text-emerald-500 uppercase tracking-wide">مستلم</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-lg font-bold text-amber-600">{group.totalRemaining}</div>
                            <div className="text-[10px] text-amber-500 uppercase tracking-wide">متبقي</div>
                          </div>
                        </div>
                      </div>

                      {/* Colors Section */}
                      <div className={`divide-y divide-slate-100 ${hasMultipleColors ? 'bg-slate-50/50' : ''}`}>
                        {group.items.map((item, colorIdx) => {
                          const days = calculateDays(item.dateSent);
                          const remaining = item.quantitySent - item.totalReceived;
                          
                          return (
                            <div 
                              key={item.id}
                              className={`${updatingItemId === item.id ? 'opacity-50 pointer-events-none' : ''}`}
                            >
                              {/* Color Header */}
                              <div className="px-4 py-2 flex items-center justify-between bg-white">
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-4 h-4 rounded-full border-2 shadow-inner flex-shrink-0"
                                    style={{ 
                                      backgroundColor: item.colorHex || '#94a3b8',
                                      borderColor: item.colorHex || '#64748b'
                                    }}
                                  />
                                  <span className="font-semibold text-slate-700 text-sm">{item.color}</span>
                                  
                                  {item.dispatchNumber && (
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono">
                                      #{item.dispatchNumber}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-slate-600 font-medium">{item.quantitySent}</span>
                                  <span className="text-emerald-600 font-medium">{item.totalReceived}</span>
                                  <span className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {remaining > 0 ? `-${remaining}` : '✓'}
                                  </span>
                                  {days !== null && (
                                    <span className={`flex items-center gap-0.5 ${
                                      days > 14 ? 'text-red-500' : days > 7 ? 'text-amber-500' : 'text-slate-400'
                                    }`}>
                                      <Clock size={10} />
                                      {days}d
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Timeline Status */}
                              <TimelineStatus 
                                item={item}
                                onStatusChange={(status) => handleStatusChange(item, status)}
                              />
                              
                              {/* Notes */}
                              {item.notes && (
                                <div className="px-4 py-1.5 bg-amber-50 text-xs text-amber-700 border-t border-amber-100">
                                  📝 {item.notes}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-20">
          <Factory size={64} strokeWidth={1} />
          <p className="mt-4 text-xl font-medium">اختر مصبغة للبدء</p>
          <p className="text-sm mt-2">Select a dyehouse to view active work</p>
        </div>
      )}
    </div>
  );
};
