import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, collectionGroup, query, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { parseFabricName } from '../services/data';
import { OrderRow, FabricDefinition } from '../types';
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
  Send,
  Download,
  GitCommit,
  Filter
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type DyehouseStatusType = 'STORE_RAW' | 'DYEING' | 'FINISHING' | 'STORE_FINISHED' | 'RECEIVED';
type EventType = 'status' | 'sent' | 'received';

interface OrderMovementEvent {
  id: string;
  type: EventType;
  date: string;         // YYYY-MM-DD — used as bucket key
  sortKey: string;      // full ISO or date string for ordering within a day
  orderId: string;
  batchIdx: number;
  partialId?: string;
  clientName: string;
  clientId: string;
  fabric: string;
  fabricShortName?: string;
  color: string;
  colorHex?: string;
  dyehouse: string;
  machine: string;
  dispatchNumber?: string;
  orderReference?: string;
  // Status-change specific
  fromStatus?: DyehouseStatusType | 'NEW';
  toStatus?: DyehouseStatusType;
  changedBy?: string;
  // Sent specific
  quantitySent?: number;
  sentBy?: string;
  // Received specific
  quantityReceived?: number;
  receivedBy?: string;
  notes?: string;
}

interface DyehouseGroup {
  dyehouse: string;
  events: OrderMovementEvent[];
}

// ─── Status Config ─────────────────────────────────────────────────────────────

const DYEHOUSE_STEPS = [
  { id: 'STORE_RAW',      label: 'مخزن مصبغة', shortLabel: 'مخزن',   icon: Box,     bgColor: 'bg-slate-100',   textColor: 'text-slate-700',   borderColor: 'border-slate-300'   },
  { id: 'DYEING',         label: 'صباغة',       shortLabel: 'صباغة',  icon: PenBox,  bgColor: 'bg-purple-100',  textColor: 'text-purple-700',  borderColor: 'border-purple-300'  },
  { id: 'FINISHING',      label: 'تجهيز',       shortLabel: 'تجهيز',  icon: Factory, bgColor: 'bg-amber-100',   textColor: 'text-amber-700',   borderColor: 'border-amber-300'   },
  { id: 'STORE_FINISHED', label: 'منتهي مخزن',  shortLabel: 'منتهي',  icon: Ship,    bgColor: 'bg-emerald-100', textColor: 'text-emerald-700', borderColor: 'border-emerald-300' },
  { id: 'RECEIVED',       label: 'مستلم',       shortLabel: 'مستلم',  icon: Check,   bgColor: 'bg-blue-100',    textColor: 'text-blue-700',    borderColor: 'border-blue-300'    }
] as const;

const STATUS_NEW = { label: 'جديد', shortLabel: 'جديد', icon: Package, bgColor: 'bg-gray-100', textColor: 'text-gray-600', borderColor: 'border-gray-300' };

const getStatusConfig = (status?: DyehouseStatusType | 'NEW') => {
  if (!status || status === 'NEW') return STATUS_NEW;
  return DYEHOUSE_STEPS.find(s => s.id === status) || DYEHOUSE_STEPS[0];
};

// normalise any date string → YYYY-MM-DD
const toDateKey = (raw: string): string => raw.slice(0, 10);

// ─── Component ────────────────────────────────────────────────────────────────

export const DyehouseOrdersMovementPage: React.FC = () => {
  // Pre-bucketed map: YYYY-MM-DD → events[]   (built once per snapshot)
  const [dateBucket, setDateBucket] = useState<Map<string, OrderMovementEvent[]>>(new Map());
  const [allDyehouses, setAllDyehouses] = useState<string[]>([]);
  const [allUsers, setAllUsers]         = useState<string[]>([]);
  const [loading, setLoading]           = useState(true);

  // Filters (all O(1) or O(events for today) — no re-scan of all orders)
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedDyehouse, setSelectedDyehouse] = useState('');
  const [selectedUser, setSelectedUser]         = useState('');
  const [selectedType, setSelectedType]         = useState<EventType | 'all'>('all');
  const [searchTerm, setSearchTerm]             = useState('');
  const [expandedDyehouses, setExpandedDyehouses] = useState<Set<string>>(new Set());

  // ── Data Fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);

    // Dyehouse list (one-time)
    getDocs(collection(db, 'dyehouses')).then(snap => {
      setAllDyehouses(snap.docs.map(d => d.data().name as string).sort());
    });

    const unsubscribe = onSnapshot(query(collectionGroup(db, 'orders')), async (snapshot) => {
      // ── reference lookups (O(clients) + O(fabrics)) ──
      const [clientsSnap, fabricsSnap] = await Promise.all([
        getDocs(collection(db, 'CustomerSheets')),
        getDocs(collection(db, 'fabrics'))
      ]);

      const clientMap: Record<string, string> = {};
      clientsSnap.docs.forEach(d => { clientMap[d.id] = d.data().name || 'Unknown'; });

      const fabricMap: Record<string, string> = {};
      fabricsSnap.docs.forEach(d => {
        const fd = d.data() as FabricDefinition;
        fabricMap[fd.name] = fd.shortName || fd.name;
      });

      // ── single pass: O(orders × batches × events) ──
      const bucket = new Map<string, OrderMovementEvent[]>();
      const userSet = new Set<string>();

      const push = (dateKey: string, event: OrderMovementEvent) => {
        if (!bucket.has(dateKey)) bucket.set(dateKey, []);
        bucket.get(dateKey)!.push(event);
        if (event.changedBy) userSet.add(event.changedBy);
        if (event.sentBy)    userSet.add(event.sentBy);
        if (event.receivedBy) userSet.add(event.receivedBy);
      };

      snapshot.docs.forEach(docSnap => {
        const order = { id: docSnap.id, ...docSnap.data() } as OrderRow;
        const clientId = order.customerId || 'unknown';
        const clientName = clientMap[clientId] || 'Unknown';
        const fabricShortName = parseFabricName(order.material).shortName || order.material;

        if (!order.dyeingPlan || !Array.isArray(order.dyeingPlan)) return;

        order.dyeingPlan.forEach((batch, bIdx) => {
          const dyehouse = batch.dyehouse || (order as any).dyehouse || 'Unassigned';
          const machine  = batch.plannedCapacity ? `${batch.plannedCapacity}kg` : (batch.machine || (order as any).dyehouseMachine || '');

          const base = {
            orderId: order.id,
            batchIdx: bIdx,
            clientId,
            clientName,
            fabric: order.material,
            fabricShortName,
            color: batch.color,
            colorHex: batch.colorHex,
            dyehouse,
            machine,
            dispatchNumber: batch.dispatchNumber,
            orderReference: (order as any).orderReference,
          };

          // ── 1. dyehouseHistory (status changes) ──────────────────────────
          const processHistory = (history: any[], partialId?: string) => {
            const sorted = [...history].sort((a, b) =>
              new Date(a.date || a.enteredAt || 0).getTime() -
              new Date(b.date || b.enteredAt || 0).getTime()
            );
            sorted.forEach((entry, i) => {
              const rawDate = entry.date || entry.enteredAt;
              if (!rawDate) return;
              const dateKey = toDateKey(rawDate);
              const changedBy: string | undefined =
                (entry.updatedBy || entry.modifiedBy || '').split('@')[0] || undefined;
              const fromStatus: DyehouseStatusType | 'NEW' =
                i === 0 ? 'NEW' : sorted[i - 1].status;

              push(dateKey, {
                id: `${order.id}-${bIdx}-${partialId ?? ''}-hist-${entry.status}-${rawDate}`,
                type: 'status',
                date: dateKey,
                sortKey: rawDate,
                ...base,
                partialId,
                fromStatus,
                toStatus: entry.status,
                changedBy,
              });
            });
          };

          if (batch.dyehouseHistory?.length) processHistory(batch.dyehouseHistory);
          batch.partials?.forEach(p => {
            if (p.dyehouseHistory?.length) processHistory(p.dyehouseHistory, p.id);
          });

          // ── 2. sentEvents (physical dispatch to dyehouse) ─────────────────
          (batch.sentEvents || []).forEach(ev => {
            if (!ev.date) return;
            const dateKey = toDateKey(ev.date);
            const sentBy = (ev.sentBy || '').split('@')[0] || undefined;
            push(dateKey, {
              id: `${order.id}-${bIdx}-sent-${ev.id}`,
              type: 'sent',
              date: dateKey,
              sortKey: ev.date,
              ...base,
              quantitySent: (Number(ev.quantity) || 0) + (Number(ev.accessorySent) || 0),
              sentBy,
              notes: ev.notes,
            });
          });

          // ── 3. receiveEvents (physical returns from dyehouse) ─────────────
          (batch.receiveEvents || []).forEach(ev => {
            if (!ev.date) return;
            const dateKey = toDateKey(ev.date);
            const receivedBy = (ev.receivedBy || '').split('@')[0] || undefined;
            push(dateKey, {
              id: `${order.id}-${bIdx}-recv-${ev.id}`,
              type: 'received',
              date: dateKey,
              sortKey: ev.date,
              ...base,
              quantityReceived: (Number(ev.quantityRaw) || 0) + (Number(ev.quantityAccessory) || 0),
              receivedBy,
              notes: ev.notes,
            });
          });
        });
      });

      setDateBucket(bucket);
      setAllUsers([...userSet].filter(Boolean).sort());
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // ── Derived view (O(events-for-day) only) ────────────────────────────────────
  const todayEvents = useMemo<OrderMovementEvent[]>(() => {
    const raw = dateBucket.get(selectedDate) || [];
    return raw
      .filter(ev => {
        if (selectedDyehouse && ev.dyehouse !== selectedDyehouse) return false;
        if (selectedType !== 'all' && ev.type !== selectedType) return false;
        const actor = ev.changedBy || ev.sentBy || ev.receivedBy || '';
        if (selectedUser && actor !== selectedUser) return false;
        if (searchTerm) {
          const s = searchTerm.toLowerCase();
          if (
            !ev.clientName.toLowerCase().includes(s) &&
            !ev.fabric.toLowerCase().includes(s) &&
            !ev.color.toLowerCase().includes(s) &&
            !(ev.dispatchNumber || '').toLowerCase().includes(s) &&
            !(ev.orderReference || '').toLowerCase().includes(s)
          ) return false;
        }
        return true;
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [dateBucket, selectedDate, selectedDyehouse, selectedType, selectedUser, searchTerm]);

  const dyehouseGroups = useMemo<DyehouseGroup[]>(() => {
    const groups: Record<string, OrderMovementEvent[]> = {};
    todayEvents.forEach(ev => {
      if (!groups[ev.dyehouse]) groups[ev.dyehouse] = [];
      groups[ev.dyehouse].push(ev);
    });
    return Object.entries(groups)
      .map(([dyehouse, events]) => ({ dyehouse, events }))
      .sort((a, b) => a.dyehouse.localeCompare(b.dyehouse));
  }, [todayEvents]);

  const stats = useMemo(() => {
    const statusChanges = todayEvents.filter(e => e.type === 'status').length;
    const sentCount     = todayEvents.filter(e => e.type === 'sent').length;
    const receivedCount = todayEvents.filter(e => e.type === 'received').length;
    const totalSentKg   = todayEvents.filter(e => e.type === 'sent').reduce((s, e) => s + (e.quantitySent || 0), 0);
    const totalRecvKg   = todayEvents.filter(e => e.type === 'received').reduce((s, e) => s + (e.quantityReceived || 0), 0);
    const uniqueUsers   = new Set(todayEvents.map(e => e.changedBy || e.sentBy || e.receivedBy).filter(Boolean)).size;
    return { total: todayEvents.length, statusChanges, sentCount, receivedCount, totalSentKg, totalRecvKg, uniqueUsers };
  }, [todayEvents]);

  // Auto-expand all groups when date changes
  useEffect(() => {
    setExpandedDyehouses(new Set(dyehouseGroups.map(g => g.dyehouse)));
  }, [dyehouseGroups.length, selectedDate]);

  const toggleGroup = (name: string) => {
    setExpandedDyehouses(prev => {
      const s = new Set(prev);
      s.has(name) ? s.delete(name) : s.add(name);
      return s;
    });
  };

  const formatDisplayDate = (d: string) =>
    new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // ── Render ──────────────────────────────────────────────────────────────────

const EventTypeBadge: React.FC<{ type: EventType }> = ({ type }) => {
  if (type === 'sent') return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 border border-green-200 text-green-700 text-xs font-bold whitespace-nowrap">
      <Send size={11} />
      إرسال
    </div>
  );
  if (type === 'received') return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold whitespace-nowrap">
      <Download size={11} />
      استلام
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold whitespace-nowrap">
      <GitCommit size={11} />
      تغيير حالة
    </div>
  );
};

const EventRow: React.FC<{ ev: OrderMovementEvent }> = ({ ev }) => {
    const actor = ev.changedBy || ev.sentBy || ev.receivedBy;

    return (
      <div className="px-4 py-3 hover:bg-slate-50/60 transition-colors flex items-center gap-3 flex-wrap lg:flex-nowrap">
        {/* Color dot */}
        <div
          className="w-3.5 h-3.5 rounded-full border border-slate-200 shadow-sm shrink-0"
          style={{ backgroundColor: ev.colorHex || '#cbd5e1' }}
        />

        {/* Event type badge */}
        <EventTypeBadge type={ev.type} />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold text-slate-800 truncate">{ev.color || '—'}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-600 truncate">{ev.fabricShortName || ev.fabric}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500 flex items-center gap-1 truncate">
              <User size={11} className="shrink-0" />
              {ev.clientName}
            </span>
            {ev.dispatchNumber && (
              <span className="text-xs text-slate-400 font-mono truncate">#{ev.dispatchNumber}</span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
            {ev.machine && (
              <span className="flex items-center gap-1">
                <Droplets size={10} />
                {ev.machine}
              </span>
            )}
            {ev.type === 'sent' && ev.quantitySent != null && (
              <span className="text-green-600 font-medium">{ev.quantitySent} كجم مرسل</span>
            )}
            {ev.type === 'received' && ev.quantityReceived != null && (
              <span className="text-blue-600 font-medium">{ev.quantityReceived} كجم مستلم</span>
            )}
            {ev.partialId && (
              <span className="text-amber-500 font-medium">جزء تجريبي</span>
            )}
            {ev.notes && (
              <span className="text-slate-400 italic truncate max-w-xs">{ev.notes}</span>
            )}
          </div>
        </div>

        {/* Status transition (status events only) */}
        {ev.type === 'status' && ev.fromStatus && ev.toStatus && (() => {
          const from = getStatusConfig(ev.fromStatus);
          const to   = getStatusConfig(ev.toStatus);
          const FromIcon = from.icon;
          const ToIcon   = to.icon;
          return (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${from.bgColor} border ${from.borderColor}`}>
                <FromIcon size={12} className={from.textColor} />
                <span className={`text-xs font-medium ${from.textColor}`}>{from.shortLabel}</span>
              </div>
              <ArrowRight size={14} className="text-slate-400" />
              <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${to.bgColor} border ${to.borderColor}`}>
                <ToIcon size={12} className={to.textColor} />
                <span className={`text-xs font-medium ${to.textColor}`}>{to.shortLabel}</span>
              </div>
            </div>
          );
        })()}

        {/* Actor */}
        {actor && (
          <div className="shrink-0 flex items-center gap-1 text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
            <User size={10} />
            {actor}
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 justify-between">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-sm">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">حركة الطلبات اليومية</h2>
              <p className="text-xs text-slate-400">إرسال · استلام · تغييرات الحالة</p>
            </div>
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date */}
            <div className="relative">
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="pr-9 pl-3 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-purple-400 outline-none text-sm"
              />
            </div>

            {/* Dyehouse */}
            <select
              value={selectedDyehouse}
              onChange={e => setSelectedDyehouse(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-purple-400 outline-none"
            >
              <option value="">كل المصابغ</option>
              {allDyehouses.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Event type */}
            <div className="flex bg-slate-100 p-1 rounded-lg gap-0.5">
              {(['all', 'status', 'sent', 'received'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    selectedType === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t === 'all' ? 'الكل' : t === 'status' ? 'تغيير حالة' : t === 'sent' ? 'إرسال' : 'استلام'}
                </button>
              ))}
            </div>

            {/* User */}
            {allUsers.length > 0 && (
              <select
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-purple-400 outline-none"
              >
                <option value="">كل المستخدمين</option>
                {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="بحث..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pr-9 pl-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-purple-400 outline-none w-44"
                dir="rtl"
              />
            </div>
          </div>
        </div>

        {/* Date label */}
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 border-t border-slate-100 pt-3">
          <Clock className="w-4 h-4 text-purple-500" />
          {formatDisplayDate(selectedDate)}
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm text-center">
          <p className="text-xs text-slate-400 font-medium mb-1">إجمالي الأحداث</p>
          <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
        </div>
        <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-3 shadow-sm text-center">
          <p className="text-xs text-indigo-500 font-medium mb-1 flex items-center justify-center gap-1"><GitCommit size={11} /> تغيير حالة</p>
          <p className="text-2xl font-bold text-indigo-700">{stats.statusChanges}</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-3 shadow-sm text-center">
          <p className="text-xs text-green-600 font-medium mb-1 flex items-center justify-center gap-1"><Send size={11} /> إرساليات</p>
          <p className="text-2xl font-bold text-green-700">{stats.sentCount}</p>
          {stats.totalSentKg > 0 && <p className="text-xs text-green-500 mt-0.5">{stats.totalSentKg.toLocaleString()} كجم</p>}
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 shadow-sm text-center">
          <p className="text-xs text-blue-600 font-medium mb-1 flex items-center justify-center gap-1"><Download size={11} /> استلامات</p>
          <p className="text-2xl font-bold text-blue-700">{stats.receivedCount}</p>
          {stats.totalRecvKg > 0 && <p className="text-xs text-blue-500 mt-0.5">{stats.totalRecvKg.toLocaleString()} كجم</p>}
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm text-center">
          <p className="text-xs text-slate-400 font-medium mb-1 flex items-center justify-center gap-1"><Factory size={11} /> مصابغ</p>
          <p className="text-2xl font-bold text-slate-700">{dyehouseGroups.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm text-center">
          <p className="text-xs text-slate-400 font-medium mb-1 flex items-center justify-center gap-1"><User size={11} /> مستخدمين</p>
          <p className="text-2xl font-bold text-slate-700">{stats.uniqueUsers}</p>
        </div>
      </div>

      {/* Empty state */}
      {dyehouseGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <Activity className="w-14 h-14 text-slate-200 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-slate-500">لا توجد حركة في هذا اليوم</h3>
          <p className="text-sm text-slate-400 mt-1">جرّب تاريخاً مختلفاً أو عدّل الفلاتر</p>
        </div>
      )}

      {/* Dyehouse Groups */}
      {dyehouseGroups.map(group => (
        <div key={group.dyehouse} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Group header */}
          <button
            onClick={() => toggleGroup(group.dyehouse)}
            className="w-full px-4 py-3 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between hover:from-indigo-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Factory className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-right">
                <h3 className="font-bold text-slate-800 text-sm">{group.dyehouse}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-400">{group.events.length} حدث</span>
                  {group.events.filter(e => e.type === 'sent').length > 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      {group.events.filter(e => e.type === 'sent').length} إرسال
                    </span>
                  )}
                  {group.events.filter(e => e.type === 'received').length > 0 && (
                    <span className="text-xs text-blue-600 font-medium">
                      {group.events.filter(e => e.type === 'received').length} استلام
                    </span>
                  )}
                  {group.events.filter(e => e.type === 'status').length > 0 && (
                    <span className="text-xs text-indigo-600 font-medium">
                      {group.events.filter(e => e.type === 'status').length} تغيير حالة
                    </span>
                  )}
                </div>
              </div>
            </div>
            {expandedDyehouses.has(group.dyehouse)
              ? <ChevronUp className="w-4 h-4 text-slate-400" />
              : <ChevronDown className="w-4 h-4 text-slate-400" />
            }
          </button>

          {/* Events list */}
          {expandedDyehouses.has(group.dyehouse) && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {group.events.map(ev => <EventRow key={ev.id} ev={ev} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
