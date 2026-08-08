import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ActivityLog } from '../services/activityService';
import { getCairoDateString } from '../services/timeTrackingService';
import {
  Activity, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw,
  UserPlus, UserMinus, Plus, RotateCcw, Trash2, Package, Calendar
} from 'lucide-react';

// ─── Event styling, keyed by "entityType:action" ────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: React.FC<any>; label: string; color: string; bg: string; border: string }> = {
  'client:create': { icon: UserPlus,  label: 'عميل جديد',    color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  'client:delete': { icon: UserMinus, label: 'حذف عميل',     color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200' },
  'order:create':  { icon: Plus,      label: 'طلب جديد',     color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  'order:reorder': { icon: RotateCcw, label: 'إعادة طلب',    color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  'order:update':  { icon: Package,   label: 'تحديث الطلب',  color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  'order:delete':  { icon: Trash2,    label: 'حذف طلب',      color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200' },
};

const FALLBACK_CONFIG = { icon: Activity, label: '', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};

// Shift a Y-M-D calendar-date string by `delta` days (no timezone math needed —
// treated as a plain calendar unit, matching the Cairo-day strings it's fed).
const shiftDateString = (dateStr: string, delta: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};

// ─── Page ────────────────────────────────────────────────────────────────────

export function OrdersMovementPage({ userRole }: { userRole: string }) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => getCairoDateString());

  const isAdmin = userRole === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    // Single equality filter ('in' on one field) — no orderBy, no composite
    // index required. Sorted and day-filtered client-side below.
    const q = query(collection(db, 'activityLogs'), where('entityType', 'in', ['order', 'client']));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
      setLoading(false);
    }, (err) => {
      console.warn('OrdersMovementPage activityLogs listener error:', err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isAdmin]);

  const dayLogs = useMemo(() => {
    return logs
      .filter(l => {
        const d = toDate(l.timestamp);
        return d ? getCairoDateString(d) === selectedDate : false;
      })
      .sort((a, b) => (toDate(b.timestamp)?.getTime() || 0) - (toDate(a.timestamp)?.getTime() || 0));
  }, [logs, selectedDate]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    dayLogs.forEach(l => {
      const key = `${l.entityType}:${l.action}`;
      c[key] = (c[key] || 0) + 1;
    });
    return c;
  }, [dayLogs]);

  const todayStr = getCairoDateString();
  const isToday = selectedDate === todayStr;

  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-3">
        <AlertTriangle size={40} className="opacity-30" />
        <p className="font-semibold">هذه الصفحة متاحة للمدير فقط</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5 tracking-tight">
            <Activity size={22} className="text-indigo-600" /> حركة الطلبات
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            كل طلب جديد، إعادة طلب، تعديل كمية، أو حذف — من قام به ومتى
          </p>
        </div>

        {/* Day navigator */}
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
          <button onClick={() => setSelectedDate(d => shiftDateString(d, -1))}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" title="اليوم السابق">
            <ChevronRight size={18} />
          </button>
          <div className="flex items-center gap-2.5">
            <Calendar size={15} className="text-slate-400" />
            <input type="date" value={selectedDate} max={todayStr}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="text-sm font-bold text-slate-700 border-none outline-none bg-transparent" />
            {isToday && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">اليوم</span>
            )}
          </div>
          <button onClick={() => setSelectedDate(d => shiftDateString(d, 1))} disabled={isToday}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="اليوم التالي">
            <ChevronLeft size={18} />
          </button>
        </div>

        {/* Summary counts */}
        {!loading && dayLogs.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(counts).map(([key, n]) => {
              const cfg = EVENT_CONFIG[key] || FALLBACK_CONFIG;
              const Icon = cfg.icon;
              return (
                <span key={key} className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                  <Icon size={12} /> {n} {cfg.label || key}
                </span>
              );
            })}
          </div>
        )}

        {/* Feed */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 gap-2">
            <RefreshCw size={18} className="animate-spin" /> جاري التحميل...
          </div>
        ) : dayLogs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-16 flex flex-col items-center text-slate-400 gap-3">
            <Activity size={36} className="opacity-30" />
            <p className="font-medium">لا توجد حركة في هذا اليوم</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayLogs.map(log => {
              const key = `${log.entityType}:${log.action}`;
              const cfg = EVENT_CONFIG[key] || { ...FALLBACK_CONFIG, label: log.action };
              const Icon = cfg.icon;
              const ts = toDate(log.timestamp);
              return (
                <div key={log.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className={`p-2 rounded-lg shrink-0 ${cfg.bg} ${cfg.color}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                        {cfg.label}
                      </span>
                      <span className="font-semibold text-slate-800 truncate">{log.entityName}</span>
                    </div>
                    {log.details && <p className="text-xs text-slate-500 mt-0.5">{log.details}</p>}
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs font-mono font-semibold text-slate-600">
                      {ts ? ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">{log.userName || log.userEmail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
