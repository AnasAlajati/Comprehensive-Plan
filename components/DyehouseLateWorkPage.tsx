import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { OrderRow, FabricDefinition, DyeingBatch } from '../types';
import { 
  Search, 
  AlertTriangle,
  AlertOctagon,
  Clock,
  Calendar,
  User,
  Package,
  Factory,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Flame,
  Eye,
  Box,
  PenBox,
  Ship,
  Check
} from 'lucide-react';

// Status Configuration
const DYEHOUSE_STEPS = [
  { id: 'STORE_RAW', label: 'مخزن مصبغة', shortLabel: 'مخزن', icon: Box, color: '#64748b' },
  { id: 'DYEING', label: 'صباغة', shortLabel: 'صباغة', icon: PenBox, color: '#7c3aed' },
  { id: 'FINISHING', label: 'تجهيز', shortLabel: 'تجهيز', icon: Factory, color: '#f59e0b' },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن', shortLabel: 'منتهي', icon: Ship, color: '#10b981' },
  { id: 'RECEIVED', label: 'مستلم', shortLabel: 'مستلم', icon: Check, color: '#3b82f6' }
] as const;

type DyehouseStatusType = 'STORE_RAW' | 'DYEING' | 'FINISHING' | 'STORE_FINISHED' | 'RECEIVED';

interface LateWorkItem {
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
  dyehouse: string;
  machine: string;
  plannedCapacity?: number;
  dispatchNumber?: string;
  dateSent?: string;
  formationDate?: string;
  dyehouseStatus?: DyehouseStatusType;
  dyehouseHistory?: any[];
  daysAfterFormation: number;
  urgencyLevel: 'attention' | 'urgent';
}

export const DyehouseLateWorkPage: React.FC = () => {
  const [items, setItems] = useState<LateWorkItem[]>([]);
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDyehouse, setSelectedDyehouse] = useState<string>('all');
  const [filterUrgency, setFilterUrgency] = useState<'all' | 'attention' | 'urgent'>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

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

      const lateItems: LateWorkItem[] = [];

      snapshot.docs.forEach(docSnap => {
        const order = { id: docSnap.id, ...docSnap.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown Client';

        if (order.dyeingPlan && Array.isArray(order.dyeingPlan)) {
          order.dyeingPlan.forEach((batch, idx) => {
            if (batch.status !== 'sent') return;
            
            // Calculate days after formation
            if (!batch.formationDate) return;
            
            const formationDate = new Date(batch.formationDate);
            const now = new Date();
            const daysAfterFormation = Math.floor((now.getTime() - formationDate.getTime()) / (1000 * 60 * 60 * 24));
            
            // Only include items with 15+ days after formation
            if (daysAfterFormation < 15) return;
            
            // Check if not yet received (still in dyehouse process)
            const dyehouseStatus = batch.dyehouseStatus || 'STORE_RAW';
            if (dyehouseStatus === 'RECEIVED') return;
            
            // Calculate sent quantities
            const sentEvents = batch.sentEvents || [];
            const sentRaw = sentEvents.reduce((s: number, e: any) => s + (Number(e.quantity) || 0), 0) + (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
            const sentAcc = sentEvents.reduce((s: number, e: any) => s + (Number(e.accessorySent) || 0), 0) + (Number(batch.quantitySentAccessory) || 0);
            const totalSent = sentRaw + sentAcc;
            
            const dyehouseName = batch.dyehouse || order.dyehouse || 'Unassigned';
            const machineName = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || order.dyehouseMachine || '');
            
            lateItems.push({
              id: `${order.id}-${idx}`,
              orderId: order.id,
              batchIdx: idx,
              clientId: clientId,
              clientName: clientName,
              orderReference: order.orderReference,
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
              dateSent: batch.dateSent,
              formationDate: batch.formationDate,
              dyehouseStatus: dyehouseStatus as DyehouseStatusType,
              dyehouseHistory: batch.dyehouseHistory || [],
              daysAfterFormation: daysAfterFormation,
              urgencyLevel: daysAfterFormation >= 20 ? 'urgent' : 'attention'
            });
          });
        }
      });

      // Sort by days (most urgent first)
      lateItems.sort((a, b) => b.daysAfterFormation - a.daysAfterFormation);
      
      setItems(lateItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getStatusLabel = (status?: DyehouseStatusType) => {
    const step = DYEHOUSE_STEPS.find(s => s.id === status);
    return step?.label || 'غير محدد';
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (selectedDyehouse !== 'all' && item.dyehouse !== selectedDyehouse) return false;
      if (filterUrgency !== 'all' && item.urgencyLevel !== filterUrgency) return false;
      
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
  }, [items, selectedDyehouse, filterUrgency, searchTerm]);

  const stats = useMemo(() => {
    const total = filteredItems.length;
    const attention = filteredItems.filter(i => i.urgencyLevel === 'attention').length;
    const urgent = filteredItems.filter(i => i.urgencyLevel === 'urgent').length;
    const avgDays = total > 0 ? Math.round(filteredItems.reduce((sum, i) => sum + i.daysAfterFormation, 0) / total) : 0;
    return { total, attention, urgent, avgDays };
  }, [filteredItems]);

  const getStatusIndex = (status?: string) => {
    if (!status) return -1;
    return DYEHOUSE_STEPS.findIndex(s => s.id === status);
  };

  const TimelineStatus = ({ item }: { item: LateWorkItem }) => {
    const activeIndex = getStatusIndex(item.dyehouseStatus);
    const historyMap = new Map((item.dyehouseHistory || []).map(h => [h.status, h]));
    
    // Get the most recent history entry for "last modified by" info
    const lastHistoryEntry = (item.dyehouseHistory || [])
      .filter(h => h.updatedBy || h.modifiedBy)
      .sort((a, b) => {
        const dateA = new Date(a.lastModified || a.enteredAt || a.date);
        const dateB = new Date(b.lastModified || b.enteredAt || b.date);
        return dateB.getTime() - dateA.getTime();
      })[0];
    
    const lastModifiedBy = lastHistoryEntry?.modifiedBy || lastHistoryEntry?.updatedBy;
    const lastModifiedDate = lastHistoryEntry?.lastModified || lastHistoryEntry?.enteredAt;
    
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
                <div
                  key={step.id}
                  className="flex flex-col items-center group w-14"
                >
                  <div className="relative">
                    <div 
                      className={`
                        w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10
                        ${isActive 
                          ? 'bg-white border-indigo-500 text-indigo-600 ring-4 ring-indigo-50 scale-110' 
                          : isCompleted || isPast
                            ? 'bg-indigo-500 border-indigo-500 text-white' 
                            : 'bg-white border-slate-200 text-slate-300'
                        }
                      `}
                    >
                      {/* Always show the icon */}
                      <Icon size={20} strokeWidth={1.5} />
                    </div>
                    
                    {/* Small checkmark badge for completed steps */}
                    {(isCompleted || isPast) && !isActive && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                        <Check strokeWidth={3} size={12} className="text-white" />
                      </div>
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
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Last Modified By Info */}
        {lastModifiedBy && (
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-center gap-2 text-[9px] text-slate-400">
            <User size={10} />
            <span>آخر تعديل:</span>
            <span className="font-medium text-slate-500">{lastModifiedBy.split('@')[0]}</span>
            {lastModifiedDate && (
              <>
                <span>•</span>
                <span className="font-mono">{formatDate(lastModifiedDate)}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-purple-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Late */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-slate-100 rounded-xl">
              <Clock className="text-slate-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500">إجمالي المتأخر</p>
              <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            </div>
          </div>
        </div>

        {/* Attention Needed (15-19 days) */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-100 rounded-xl">
              <AlertTriangle className="text-amber-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-amber-700">يحتاج متابعة</p>
              <p className="text-2xl font-bold text-amber-800">{stats.attention}</p>
              <p className="text-xs text-amber-600">15-19 يوم</p>
            </div>
          </div>
        </div>

        {/* Very Urgent (20+ days) */}
        <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl border border-red-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 rounded-xl animate-pulse">
              <Flame className="text-red-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-red-700">عاجل جداً</p>
              <p className="text-2xl font-bold text-red-800">{stats.urgent}</p>
              <p className="text-xs text-red-600">20+ يوم</p>
            </div>
          </div>
        </div>

        {/* Average Days */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-xl">
              <Calendar className="text-purple-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500">متوسط الأيام</p>
              <p className="text-2xl font-bold text-slate-800">{stats.avgDays}</p>
              <p className="text-xs text-slate-500">يوم بعد التشكيل</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="بحث بالعميل، القماش، اللون..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-right"
                dir="rtl"
              />
            </div>
          </div>

          {/* Dyehouse Filter */}
          <div className="flex items-center gap-2">
            <Factory size={18} className="text-slate-400" />
            <select
              value={selectedDyehouse}
              onChange={(e) => setSelectedDyehouse(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
            >
              <option value="all">كل المصابغ</option>
              {allDyehouses.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Urgency Filter */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setFilterUrgency('all')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                filterUrgency === 'all' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setFilterUrgency('attention')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1 ${
                filterUrgency === 'attention' ? 'bg-amber-100 shadow text-amber-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <AlertTriangle size={14} />
              متابعة
            </button>
            <button
              onClick={() => setFilterUrgency('urgent')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1 ${
                filterUrgency === 'urgent' ? 'bg-red-100 shadow text-red-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Flame size={14} />
              عاجل
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500"></div>
          <span className="text-slate-600 font-medium">يحتاج متابعة (15-19 يوم)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-slate-600 font-medium">عاجل جداً (20+ يوم)</span>
        </div>
      </div>

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="text-emerald-600" size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">لا يوجد عمل متأخر!</h3>
          <p className="text-slate-500">جميع الأعمال ضمن الوقت المطلوب</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className={`bg-white rounded-xl border shadow-sm hover:shadow-md overflow-hidden transition-all relative ${
                item.urgencyLevel === 'urgent' 
                  ? 'border-slate-200 hover:border-red-200' 
                  : 'border-slate-200 hover:border-amber-200'
              }`}
            >
              {/* Accent Border */}
              <div className={`absolute top-0 bottom-0 right-0 w-1.5 ${
                item.urgencyLevel === 'urgent' ? 'bg-red-500' : 'bg-amber-500'
              }`} />

              {/* Main Row */}
              <div 
                className="p-4 cursor-pointer pr-6"
                onClick={() => toggleExpand(item.id)}
              >
                <div className="flex items-center gap-4">
                  {/* Urgency Indicator */}
                  <div className={`flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center border ${
                    item.urgencyLevel === 'urgent' 
                      ? 'bg-red-50 border-red-100 text-red-600' 
                      : 'bg-amber-50 border-amber-100 text-amber-600'
                  }`}>
                    {item.urgencyLevel === 'urgent' ? (
                      <Flame size={18} className="mb-0.5" />
                    ) : (
                      <AlertTriangle size={18} className="mb-0.5" />
                    )}
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-lg font-bold leading-none">{item.daysAfterFormation}</span>
                      <span className="text-[10px] font-medium">يوم</span>
                    </div>
                  </div>

                  {/* Main Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {/* Color Swatch */}
                      {item.colorHex && (
                        <div 
                          className="w-3.5 h-3.5 rounded-full border border-slate-200 flex-shrink-0 shadow-sm"
                          style={{ backgroundColor: item.colorHex }}
                        />
                      )}
                      <h3 className="font-bold text-slate-800 truncate text-base">
                        {item.fabricShortName || item.fabric}
                      </h3>
                      <span className="text-slate-400 font-medium">-</span>
                      <span className="text-slate-600 font-medium">{item.color}</span>
                    </div>
                    
                    <div className="flex items-center gap-5 text-sm text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <User size={14} className="text-slate-400" />
                        <span className="font-medium">{item.clientName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Package size={14} className="text-slate-400" />
                        <span className="font-medium">{item.quantitySent} كجم</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Factory size={14} className="text-slate-400" />
                        <span className="font-medium">{item.dyehouse}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    item.urgencyLevel === 'urgent'
                      ? 'bg-red-50 text-red-600 border-red-100'
                      : 'bg-amber-50 text-amber-600 border-amber-100'
                  }`}>
                    {item.urgencyLevel === 'urgent' ? 'عاجل جداً!' : 'يحتاج متابعة'}
                  </div>

                  {/* Expand Arrow */}
                  <div className="text-slate-400">
                    {expandedItems.has(item.id) ? (
                      <ChevronUp size={20} />
                    ) : (
                      <ChevronDown size={20} />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedItems.has(item.id) && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500 mb-1">تاريخ التشكيل</p>
                      <p className="font-medium text-slate-800">{formatDate(item.formationDate)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 mb-1">تاريخ الإرسال</p>
                      <p className="font-medium text-slate-800">{formatDate(item.dateSent)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 mb-1">الحالة الحالية</p>
                      <p className="font-medium text-slate-800">{getStatusLabel(item.dyehouseStatus)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 mb-1">الماكينة</p>
                      <p className="font-medium text-slate-800">{item.machine || '-'}</p>
                    </div>
                    {item.dispatchNumber && (
                      <div>
                        <p className="text-slate-500 mb-1">رقم الإرسالية</p>
                        <p className="font-medium text-slate-800">{item.dispatchNumber}</p>
                      </div>
                    )}
                    {item.orderReference && (
                      <div>
                        <p className="text-slate-500 mb-1">مرجع الطلب</p>
                        <p className="font-medium text-slate-800">{item.orderReference}</p>
                      </div>
                    )}
                  </div>

                  {/* Timeline indicator */}
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <TimelineStatus item={item} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
