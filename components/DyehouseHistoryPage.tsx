import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, collectionGroup, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import {
  TrendingUp, TrendingDown, BarChart2, ArrowDownCircle, ArrowUpCircle,
  AlertTriangle, Calendar, Factory, ChevronDown, ChevronRight, Info,
  Activity, Target, Clock, Layers
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProcessedBatch {
  id: string;
  orderId: string;
  customerName: string;
  fabricName: string;
  color: string;
  dyehouse: string;
  formationDate: string | null;
  dateSent: string | null;
  sentQtyRaw: number;
  receiveEvents: { date: string; qtyRaw: number; qtyAcc: number }[];
  totalReceivedRaw: number;
  scrapRaw: number;
  isComplete: boolean;
  // Computed
  daysInDyehouse: number | null; // null if not yet received
}

interface MonthStats {
  month: string; // "2025-11"
  label: string; // "Nov 2025"
  sentKg: number;
  receivedKg: number;
  scrapKg: number;
  scrapPct: number;
  batches: ProcessedBatch[];
  sentBatches: number;
  receivedBatches: number;
  completedDays: number[]; // days for completed batches in this month
  avgDays: number | null;
  openingStock: number; // filled in second pass
  closingStock: number; // filled in second pass
}

interface DyehouseMonthStats extends MonthStats {
  dyehouseName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getMonthKey = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key: string): string => {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const fmtKg = (n: number) => `${Math.round(n).toLocaleString()}kg`;

const calcOutlierThreshold = (days: number[]): number => {
  if (days.length < 4) return Infinity;
  const sorted = [...days].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return q3 + 1.5 * (q3 - q1);
};

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  userRole?: 'admin' | 'editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | null;
}

export const DyehouseHistoryPage: React.FC<Props> = ({ userRole }) => {
  const isAdmin = userRole === 'admin';

  const [allBatches, setAllBatches] = useState<ProcessedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDyehouse, setSelectedDyehouse] = useState<string>('ALL');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [showOutliersOnly, setShowOutliersOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'monthly' | 'dyehouses' | 'outliers'>('overview');
  const [calcModalData, setCalcModalData] = useState<{ label: string; batches: ProcessedBatch[]; dyehouse: string } | null>(null);

  // Load all orders via collectionGroup
  useEffect(() => {
    // First fetch customer names map
    let clientMap: Record<string, string> = {};
    const clientsPromise = getDocs(collection(db, 'CustomerSheets')).then((snap) => {
      snap.docs.forEach((d) => {
        clientMap[d.id] = (d.data() as any).name || 'Unknown';
      });
    }).catch(() => {});

    const unsub = onSnapshot(collectionGroup(db, 'orders'), async (snapshot) => {
      await clientsPromise; // ensure clientMap is ready
      const batches: ProcessedBatch[] = [];

      snapshot.docs.forEach((docSnap) => {
        const order = docSnap.data() as any;
        if (!order.dyeingPlan || !Array.isArray(order.dyeingPlan)) return;
        // Derive the customer ID from the Firestore path (CustomerSheets/{customerId}/orders/{orderId})
        const parentCustomerId = docSnap.ref.parent.parent?.id || order.customerId || '';

        order.dyeingPlan.forEach((batch: any) => {
          // Resolve dyehouse name
          const dyehouse =
            batch.dyehouse ||
            (batch.colorApprovals?.length ? batch.colorApprovals[0].dyehouseName : '') ||
            order.dyehouse ||
            '';
          if (!dyehouse) return;

          // Sent quantity
          let sentQtyRaw = 0;
          if (batch.sentEvents?.length) {
            sentQtyRaw = batch.sentEvents.reduce((s: number, e: any) => s + (e.quantity || 0), 0);
          } else {
            sentQtyRaw = batch.quantitySentRaw || batch.quantitySent || 0;
          }

          // Receive events
          const receiveEvents: { date: string; qtyRaw: number; qtyAcc: number }[] = (
            batch.receiveEvents || []
          ).map((e: any) => ({
            date: e.date || '',
            qtyRaw: e.quantityRaw || 0,
            qtyAcc: e.quantityAccessory || 0,
          }));

          const totalReceivedRaw =
            receiveEvents.reduce((s, e) => s + e.qtyRaw, 0) + (batch.receivedQuantity || 0);

          const scrapRaw = batch.scrapRaw || 0;

          // Is received / complete
          const remPct =
            sentQtyRaw > 0
              ? ((sentQtyRaw - totalReceivedRaw) / sentQtyRaw) * 100
              : 100;
          const isComplete =
            batch.isComplete === true ||
            scrapRaw > 0 ||
            (totalReceivedRaw > 0 && remPct <= 10);

          // Days in dyehouse (formationDate → last receiveEvent date)
          let daysInDyehouse: number | null = null;
          if (isComplete && batch.formationDate && receiveEvents.length > 0) {
            const lastRecvDate = receiveEvents
              .map((e) => e.date)
              .filter(Boolean)
              .sort()
              .at(-1);
            if (lastRecvDate) {
              const start = new Date(batch.formationDate).getTime();
              const end = new Date(lastRecvDate).getTime();
              const diff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
              if (diff >= 0) daysInDyehouse = diff;
            }
          }

          // Resolve sent date
          let dateSent: string | null = null;
          if (batch.sentEvents?.length) {
            dateSent = batch.sentEvents
              .map((e: any) => e.date)
              .filter(Boolean)
              .sort()[0] || null;
          } else {
            dateSent = batch.dateSent || null;
          }

          batches.push({
            id: batch.id || `${docSnap.id}-${Math.random()}`,
            orderId: docSnap.id,
            customerName: clientMap[parentCustomerId] || parentCustomerId || '—',
            fabricName: order.material || '—',
            color: batch.color || '—',
            dyehouse,
            formationDate: batch.formationDate || null,
            dateSent,
            sentQtyRaw,
            receiveEvents,
            totalReceivedRaw,
            scrapRaw,
            isComplete,
            daysInDyehouse,
          });
        });
      });

      setAllBatches(batches);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Derived Data ──────────────────────────────────────────────────────────

  const dyehouseNames = useMemo(() => {
    const names = new Set(allBatches.map((b) => b.dyehouse));
    return ['ALL', ...Array.from(names).sort()];
  }, [allBatches]);

  const filteredBatches = useMemo(() => {
    if (selectedDyehouse === 'ALL') return allBatches;
    return allBatches.filter((b) => b.dyehouse === selectedDyehouse);
  }, [allBatches, selectedDyehouse]);

  // Build month → stats map (based on sent date for "sent" and receive event date for "received")
  const monthStatsMap = useMemo(() => {
    const map = new Map<string, MonthStats>();

    const ensure = (mk: string) => {
      if (!map.has(mk)) {
        map.set(mk, {
          month: mk,
          label: monthLabel(mk),
          sentKg: 0,
          receivedKg: 0,
          scrapKg: 0,
          scrapPct: 0,
          batches: [],
          sentBatches: 0,
          receivedBatches: 0,
          completedDays: [],
          avgDays: null,
          openingStock: 0,
          closingStock: 0,
        });
      }
      return map.get(mk)!;
    };

    filteredBatches.forEach((b) => {
      // Register into sent month
      const sentMk = getMonthKey(b.dateSent);
      if (sentMk && b.sentQtyRaw > 0) {
        const s = ensure(sentMk);
        s.sentKg += b.sentQtyRaw;
        s.sentBatches += 1;
        s.batches.push(b);
      }

      // Register receive events into their respective months
      b.receiveEvents.forEach((ev) => {
        const recvMk = getMonthKey(ev.date);
        if (!recvMk) return;
        const s = ensure(recvMk);
        s.receivedKg += ev.qtyRaw;
        if (!s.batches.find((x) => x.id === b.id)) s.batches.push(b);
      });

      // Scrap: attribute to last receive event month
      if (b.isComplete && b.scrapRaw > 0) {
        const lastRecvDate = b.receiveEvents
          .map((e) => e.date)
          .filter(Boolean)
          .sort()
          .at(-1);
        const scrapMk = getMonthKey(lastRecvDate) || getMonthKey(b.dateSent);
        if (scrapMk) {
          const s = ensure(scrapMk);
          s.scrapKg += b.scrapRaw;
          s.receivedBatches += 1;
        }
      }

      // Days in dyehouse for completed
      if (b.isComplete && b.daysInDyehouse !== null) {
        const lastRecvDate = b.receiveEvents
          .map((e) => e.date)
          .filter(Boolean)
          .sort()
          .at(-1);
        const completedMk = getMonthKey(lastRecvDate) || getMonthKey(b.dateSent);
        if (completedMk) {
          ensure(completedMk).completedDays.push(b.daysInDyehouse);
        }
      }
    });

    // Compute scrap pct and avg days, then sort
    const sorted = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Second pass: opening / closing stock
    let runningStock = 0;
    sorted.forEach((ms) => {
      ms.openingStock = runningStock;
      ms.closingStock = runningStock + ms.sentKg - ms.receivedKg - ms.scrapKg;
      runningStock = ms.closingStock < 0 ? 0 : ms.closingStock;
      ms.scrapPct = ms.sentKg > 0 ? (ms.scrapKg / ms.sentKg) * 100 : 0;
      if (ms.completedDays.length > 0) {
        ms.avgDays = ms.completedDays.reduce((a, b) => a + b, 0) / ms.completedDays.length;
      }
    });

    return sorted;
  }, [filteredBatches]);

  // Per-dyehouse month stats: Record<dyehouseName, DyehouseMonthStats[]> sorted by month
  const dyehouseMonthMap = useMemo<Record<string, DyehouseMonthStats[]>>(() => {
    const raw: Record<string, Record<string, DyehouseMonthStats>> = {};

    const ensure = (dh: string, mk: string): DyehouseMonthStats => {
      if (!raw[dh]) raw[dh] = {};
      if (!raw[dh][mk]) {
        raw[dh][mk] = {
          dyehouseName: dh,
          month: mk,
          label: monthLabel(mk),
          sentKg: 0,
          receivedKg: 0,
          scrapKg: 0,
          scrapPct: 0,
          batches: [],
          sentBatches: 0,
          receivedBatches: 0,
          completedDays: [],
          avgDays: null,
          openingStock: 0,
          closingStock: 0,
        };
      }
      return raw[dh][mk];
    };

    allBatches.forEach((b) => {
      const dh = b.dyehouse;
      const sentMk = getMonthKey(b.dateSent);
      if (sentMk && b.sentQtyRaw > 0) {
        const s = ensure(dh, sentMk);
        s.sentKg += b.sentQtyRaw;
        s.sentBatches += 1;
      }
      b.receiveEvents.forEach((ev) => {
        const recvMk = getMonthKey(ev.date);
        if (!recvMk) return;
        ensure(dh, recvMk).receivedKg += ev.qtyRaw;
      });
      if (b.isComplete && b.scrapRaw > 0) {
        const lastRecvDate = b.receiveEvents.map((e) => e.date).filter(Boolean).sort().at(-1);
        const mk = getMonthKey(lastRecvDate) || getMonthKey(b.dateSent);
        if (mk) {
          const s = ensure(dh, mk);
          s.scrapKg += b.scrapRaw;
          s.receivedBatches += 1;
        }
      }
      if (b.isComplete && b.daysInDyehouse !== null) {
        const lastRecvDate = b.receiveEvents.map((e) => e.date).filter(Boolean).sort().at(-1);
        const mk = getMonthKey(lastRecvDate) || getMonthKey(b.dateSent);
        if (mk) {
          const s = ensure(dh, mk);
          s.completedDays.push(b.daysInDyehouse!);
          s.batches.push(b);
        }
      }
    });

    // Sort each dyehouse's months and compute opening/closing stock + averages
    const result: Record<string, DyehouseMonthStats[]> = {};
    Object.entries(raw).forEach(([dh, monthsObj]) => {
      let stock = 0;
      const sorted = Object.values(monthsObj).sort((a, b) => a.month.localeCompare(b.month));
      sorted.forEach((ms) => {
        ms.openingStock = stock;
        ms.closingStock = stock + ms.sentKg - ms.receivedKg - ms.scrapKg;
        stock = ms.closingStock < 0 ? 0 : ms.closingStock;
        ms.scrapPct = ms.sentKg > 0 ? (ms.scrapKg / ms.sentKg) * 100 : 0;
        if (ms.completedDays.length > 0) {
          ms.avgDays = ms.completedDays.reduce((a, b) => a + b, 0) / ms.completedDays.length;
        }
      });
      result[dh] = sorted;
    });

    return result;
  }, [allBatches]);

  // Outlier batches (across all dyehouses)
  const outlierBatches = useMemo(() => {
    const completed = allBatches.filter((b) => b.isComplete && b.daysInDyehouse !== null);
    const days = completed.map((b) => b.daysInDyehouse!);
    const threshold = calcOutlierThreshold(days);
    return completed
      .filter((b) => b.daysInDyehouse! > threshold)
      .sort((a, b) => b.daysInDyehouse! - a.daysInDyehouse!);
  }, [allBatches]);

  const allDays = useMemo(
    () => allBatches.filter((b) => b.daysInDyehouse !== null).map((b) => b.daysInDyehouse!),
    [allBatches]
  );
  const globalAvgDays = allDays.length
    ? allDays.reduce((a, b) => a + b, 0) / allDays.length
    : null;
  const globalOutlierThreshold = calcOutlierThreshold(allDays);

  const totalSentAll = filteredBatches.reduce((s, b) => s + b.sentQtyRaw, 0);
  const totalReceivedAll = filteredBatches.reduce((s, b) => s + b.totalReceivedRaw, 0);
  const totalScrapAll = filteredBatches.reduce((s, b) => s + b.scrapRaw, 0);
  const totalInDyehouse = Math.max(0, totalSentAll - totalReceivedAll - totalScrapAll);
  const globalScrapPct = totalSentAll > 0 ? (totalScrapAll / totalSentAll) * 100 : 0;

  const toggleMonth = (mk: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(mk) ? next.delete(mk) : next.add(mk);
      return next;
    });
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
        <AlertTriangle size={40} />
        <p className="text-lg font-medium">Admin access required</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
        <span>Loading dyehouse history…</span>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-slate-50 min-h-0">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BarChart2 size={22} className="text-indigo-500" />
              Dyehouse History
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Monthly analytics — sent, received, scrap & turnaround time
            </p>
          </div>

          {/* Dyehouse Filter */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-500">Dyehouse</label>
            <select
              value={selectedDyehouse}
              onChange={(e) => setSelectedDyehouse(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-indigo-300 outline-none"
            >
              {dyehouseNames.map((n) => (
                <option key={n} value={n}>{n === 'ALL' ? '🏭 All Dyehouses' : n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-slate-100 p-1 rounded-lg w-fit">
          {(['overview', 'monthly', 'dyehouses', 'outliers'] as const).map((tab) => {
            const icons: Record<string, React.ReactNode> = {
              overview: <Target size={14} />,
              monthly: <Calendar size={14} />,
              dyehouses: <Factory size={14} />,
              outliers: <AlertTriangle size={14} />,
            };
            const labels: Record<string, string> = {
              overview: 'Overview',
              monthly: 'Monthly Timeline',
              dyehouses: 'By Dyehouse',
              outliers: `Outliers (${outlierBatches.length})`,
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-white shadow text-indigo-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {icons[tab]}
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto p-6">

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                icon={<ArrowUpCircle size={20} className="text-blue-500" />}
                label="Total Sent"
                value={fmtKg(totalSentAll)}
                sub={`${filteredBatches.filter((b) => b.sentQtyRaw > 0).length} batches`}
                color="blue"
              />
              <SummaryCard
                icon={<ArrowDownCircle size={20} className="text-emerald-500" />}
                label="Total Received"
                value={fmtKg(totalReceivedAll)}
                sub={`${filteredBatches.filter((b) => b.totalReceivedRaw > 0).length} batches`}
                color="emerald"
              />
              <SummaryCard
                icon={<Layers size={20} className="text-amber-500" />}
                label="Currently In Dyehouse"
                value={fmtKg(totalInDyehouse)}
                sub="pending return"
                color="amber"
              />
              <SummaryCard
                icon={<AlertTriangle size={20} className="text-red-500" />}
                label="Total Scrap"
                value={fmtKg(totalScrapAll)}
                sub={`${globalScrapPct.toFixed(1)}% of sent`}
                color="red"
              />
            </div>

            {/* Avg Days Card */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={18} className="text-indigo-500" />
                  <span className="font-semibold text-slate-700">Turnaround Time</span>
                </div>
                {globalAvgDays !== null ? (
                  <div className="space-y-1">
                    <div className="text-4xl font-bold text-indigo-600">
                      {globalAvgDays.toFixed(1)}
                      <span className="text-base font-normal text-slate-400 ml-1">days</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Average dyehouse duration (formation → last receive)
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      Based on {allDays.length} completed batch{allDays.length !== 1 ? 'es' : ''}
                    </div>
                    <div className="text-xs text-amber-600 mt-1">
                      Outlier threshold: &gt;{globalOutlierThreshold === Infinity ? '—' : `${Math.round(globalOutlierThreshold)} days`}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">No completed batches yet</p>
                )}
              </div>

              {/* Avg days per month */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <Activity size={16} className="text-indigo-400" />
                  <span className="font-semibold text-slate-700 text-sm">Avg Days in Dyehouse — by Month</span>
                  {globalAvgDays !== null && (
                    <span className="ml-auto text-xs text-slate-400">overall avg: <span className="font-bold text-indigo-600">{globalAvgDays.toFixed(1)}d</span></span>
                  )}
                </div>
                {(() => {
                  const rows = [...monthStatsMap].filter((ms) => ms.avgDays !== null).reverse();
                  if (rows.length === 0) return <p className="text-slate-400 text-sm p-4">No completed batches yet</p>;
                  const maxAvg = Math.max(...rows.map((r) => r.avgDays!));
                  return (
                    <div className="overflow-y-auto max-h-52">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 text-slate-500 border-b border-slate-100">
                          <tr>
                            <th className="px-4 py-2 font-semibold text-left">Month</th>
                            <th className="px-4 py-2 font-semibold text-center">Batches</th>
                            <th className="px-4 py-2 font-semibold text-center">Min</th>
                            <th className="px-4 py-2 font-semibold text-center">Avg</th>
                            <th className="px-4 py-2 font-semibold text-center">Max</th>
                            <th className="px-4 py-2 font-semibold">Trend</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {rows.map((ms) => {
                            const aboveAvg = globalAvgDays !== null && ms.avgDays! > globalAvgDays * 1.2;
                            const minD = Math.min(...ms.completedDays);
                            const maxD = Math.max(...ms.completedDays);
                            const barPct = maxAvg > 0 ? (ms.avgDays! / maxAvg) * 100 : 0;
                            return (
                              <tr key={ms.month} className="hover:bg-slate-50">
                                <td className="px-4 py-2 font-semibold text-slate-700">{ms.label}</td>
                                <td className="px-4 py-2 text-center text-slate-400">{ms.completedDays.length}</td>
                                <td className="px-4 py-2 text-center font-mono text-emerald-600">{minD}d</td>
                                <td className="px-4 py-2 text-center">
                                  <span className={`font-bold font-mono ${aboveAvg ? 'text-red-500' : 'text-indigo-600'}`}>
                                    {ms.avgDays!.toFixed(1)}d
                                  </span>
                                  {aboveAvg && <span className="ml-1 text-red-400">↑</span>}
                                </td>
                                <td className="px-4 py-2 text-center font-mono text-amber-500">{maxD}d</td>
                                <td className="px-4 py-2">
                                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                                    <div
                                      className={`h-1.5 rounded-full ${aboveAvg ? 'bg-red-300' : 'bg-indigo-300'}`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Scrap by Dyehouse */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <TrendingDown size={18} className="text-red-400" />
                <span className="font-semibold text-slate-700">Scrap Rate by Dyehouse</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(Object.entries(dyehouseMonthMap) as [string, DyehouseMonthStats[]][]).map(([dh, months]) => {
                  const sent = months.reduce((s, m) => s + m.sentKg, 0);
                  const scrap = months.reduce((s, m) => s + m.scrapKg, 0);
                  const pct = sent > 0 ? (scrap / sent) * 100 : 0;
                  if (sent === 0) return null;
                  return (
                    <div key={dh} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-red-500">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{dh}</p>
                        <p className="text-xs text-slate-400">{fmtKg(scrap)} scrap / {fmtKg(sent)} sent</p>
                      </div>
                      <div className="ml-auto">
                        <div className="w-16 bg-slate-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${pct > 5 ? 'bg-red-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(pct * 5, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ════════════ MONTHLY TIMELINE TAB ════════════ */}
        {activeTab === 'monthly' && (
          <div className="space-y-3">
            {monthStatsMap.length === 0 && (
              <div className="text-center text-slate-400 py-16">No data found</div>
            )}
            {[...monthStatsMap].reverse().map((ms) => {
              const isExpanded = expandedMonths.has(ms.month);
              const outThresh = calcOutlierThreshold(ms.completedDays);
              const monthOutliers = filteredBatches.filter(
                (b) =>
                  b.isComplete &&
                  b.daysInDyehouse !== null &&
                  b.daysInDyehouse > outThresh &&
                  (() => {
                    const lastRecvDate = b.receiveEvents.map((e) => e.date).filter(Boolean).sort().at(-1);
                    return getMonthKey(lastRecvDate) === ms.month || getMonthKey(b.dateSent) === ms.month;
                  })()
              );

              return (
                <div
                  key={ms.month}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  {/* Month Header */}
                  <button
                    onClick={() => toggleMonth(ms.month)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                    )}

                    <div className="min-w-[90px]">
                      <p className="font-bold text-slate-800 text-base">{ms.label}</p>
                    </div>

                    {/* Mini stats row */}
                    <div className="flex flex-wrap gap-3 flex-1">
                      <MiniBadge
                        icon={<ArrowUpCircle size={13} className="text-blue-400" />}
                        label="Sent"
                        value={fmtKg(ms.sentKg)}
                        sub={`${ms.sentBatches} batches`}
                      />
                      <MiniBadge
                        icon={<ArrowDownCircle size={13} className="text-emerald-400" />}
                        label="Received"
                        value={fmtKg(ms.receivedKg)}
                        sub={`${ms.receivedBatches} completed`}
                      />
                      <MiniBadge
                        icon={<AlertTriangle size={13} className="text-red-400" />}
                        label="Scrap"
                        value={fmtKg(ms.scrapKg)}
                        sub={`${ms.scrapPct.toFixed(1)}%`}
                      />
                      {ms.avgDays !== null && (
                        <MiniBadge
                          icon={<Clock size={13} className="text-indigo-400" />}
                          label="Avg Days"
                          value={`${ms.avgDays.toFixed(1)}d`}
                          sub={`${ms.completedDays.length} finished`}
                        />
                      )}
                    </div>

                    {/* Stock flow */}
                    <div className="hidden lg:flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                      <span className="bg-slate-100 px-2 py-1 rounded font-mono">
                        Open {fmtKg(ms.openingStock)}
                      </span>
                      <span>→</span>
                      <span className={`bg-slate-100 px-2 py-1 rounded font-mono font-bold ${ms.closingStock > ms.openingStock ? 'text-amber-600' : 'text-emerald-600'}`}>
                        Close {fmtKg(Math.max(0, ms.closingStock))}
                      </span>
                    </div>

                    {monthOutliers.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0">
                        <AlertTriangle size={11} />
                        {monthOutliers.length} outlier{monthOutliers.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </button>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
                      {/* Stock summary */}
                      <div className="flex gap-3 mb-4 flex-wrap">
                        {[
                          { label: 'Opening Stock', value: fmtKg(ms.openingStock), color: 'bg-slate-100 text-slate-600' },
                          { label: '+ Sent this month', value: `+${fmtKg(ms.sentKg)}`, color: 'bg-blue-50 text-blue-700' },
                          { label: '− Received this month', value: `−${fmtKg(ms.receivedKg)}`, color: 'bg-emerald-50 text-emerald-700' },
                          { label: '− Scrap', value: `−${fmtKg(ms.scrapKg)}`, color: 'bg-red-50 text-red-600' },
                          { label: 'Closing Stock', value: fmtKg(Math.max(0, ms.closingStock)), color: 'bg-indigo-50 text-indigo-700 font-bold' },
                        ].map((item) => (
                          <div key={item.label} className={`${item.color} rounded-lg px-3 py-2 text-xs`}>
                            <div className="text-[10px] opacity-60">{item.label}</div>
                            <div className={`font-semibold text-sm ${item.color.includes('font-bold') ? 'font-bold' : ''}`}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Outlier batches in this month */}
                      {monthOutliers.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                            <AlertTriangle size={13} /> Outlier batches (high turnaround time)
                          </p>
                          <div className="space-y-1">
                            {monthOutliers.map((b) => (
                              <div
                                key={b.id}
                                className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"
                              >
                                <span className="text-xs font-medium text-slate-700">{b.color}</span>
                                <span className="text-xs text-slate-500">@ {b.dyehouse}</span>
                                <span className="ml-auto text-xs font-bold text-amber-700">
                                  {b.daysInDyehouse} days
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  (avg {ms.avgDays?.toFixed(1)}d)
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Batches table — grouped by customer → fabric */}
                      {(() => {
                        const received = ms.batches.filter((b) => b.isComplete);
                        if (received.length === 0) {
                          return (
                            <div className="text-center text-slate-400 py-6 text-xs border border-slate-200 rounded-lg">
                              No received batches this month
                            </div>
                          );
                        }

                        // Group: customer → fabric → batches
                        const byCustomer: Record<string, Record<string, ProcessedBatch[]>> = {};
                        received.forEach((b) => {
                          const cust = b.customerName || '—';
                          const fab = b.fabricName || '—';
                          if (!byCustomer[cust]) byCustomer[cust] = {};
                          if (!byCustomer[cust][fab]) byCustomer[cust][fab] = [];
                          byCustomer[cust][fab].push(b);
                        });

                        return (
                          <div className="space-y-4">
                            {Object.entries(byCustomer).sort(([a], [b]) => a.localeCompare(b)).map(([cust, fabrics]) => (
                              <div key={cust} className="rounded-lg border border-slate-200 overflow-hidden">
                                {/* Customer header */}
                                <div className="bg-slate-100 px-4 py-2 flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{cust}</span>
                                  <span className="text-[10px] text-slate-400">
                                    {Object.values(fabrics).flat().length} batch{Object.values(fabrics).flat().length !== 1 ? 'es' : ''}
                                  </span>
                                </div>

                                {/* Per-fabric sections */}
                                {Object.entries(fabrics).sort(([a], [b]) => a.localeCompare(b)).map(([fab, batches]) => {
                                  const totalSentF = batches.reduce((s, b) => s + b.sentQtyRaw, 0);
                                  const totalRecvF = batches.reduce((s, b) => s + b.totalReceivedRaw, 0);
                                  const totalScrapF = batches.reduce((s, b) => s + b.scrapRaw, 0);
                                  const days = batches.filter(b => b.daysInDyehouse !== null).map(b => b.daysInDyehouse!);
                                  const avgDaysF = days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
                                  return (
                                    <div key={fab}>
                                      {/* Fabric sub-header */}
                                      <div className="bg-indigo-50/60 border-t border-slate-100 px-4 py-1.5 flex items-center gap-3">
                                        <span className="text-xs font-semibold text-indigo-700">{fab}</span>
                                        <span className="text-[10px] text-slate-400">{batches.length} color{batches.length !== 1 ? 's' : ''}</span>
                                        <div className="ml-auto flex items-center gap-3 text-[11px]">
                                          <span className="text-blue-600 font-mono">{totalSentF.toFixed(1)} sent</span>
                                          <span className="text-emerald-600 font-mono">{totalRecvF.toFixed(1)} recv</span>
                                          {totalScrapF > 0 && <span className="text-red-500 font-mono">{totalScrapF.toFixed(1)} scrap</span>}
                                          {avgDaysF !== null && <span className="text-indigo-600 font-mono">{avgDaysF.toFixed(1)}d avg</span>}
                                        </div>
                                      </div>
                                      {/* Color rows */}
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-slate-50 text-slate-400 border-t border-slate-100">
                                            <th className="px-4 py-1.5 font-medium text-left">Color</th>
                                            <th className="px-4 py-1.5 font-medium">Dyehouse</th>
                                            <th className="px-4 py-1.5 font-medium">Tashkeel</th>
                                            <th className="px-4 py-1.5 font-medium text-teal-600">Received</th>
                                            <th className="px-4 py-1.5 font-medium text-right">Sent (kg)</th>
                                            <th className="px-4 py-1.5 font-medium text-right">Recv (kg)</th>
                                            <th className="px-4 py-1.5 font-medium text-right">Scrap (kg)</th>
                                            <th className="px-4 py-1.5 font-medium text-center">Days</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                          {batches.sort((a, b) => (a.color || '').localeCompare(b.color || '')).map((b) => {
                                            const isOutlier = b.daysInDyehouse !== null && outThresh !== Infinity && b.daysInDyehouse > outThresh;
                                            const lastRecvDate = b.receiveEvents.map((e) => e.date).filter(Boolean).sort().at(-1) || '—';
                                            return (
                                              <tr key={b.id} className={`hover:bg-slate-50 ${isOutlier ? 'bg-amber-50' : ''}`}>
                                                <td className="px-4 py-2 font-medium text-slate-700">{b.color}</td>
                                                <td className="px-4 py-2 text-slate-500 text-center">{b.dyehouse}</td>
                                                <td className="px-4 py-2 font-mono text-slate-500">{b.formationDate || '—'}</td>
                                                <td className="px-4 py-2 font-mono text-teal-600">{lastRecvDate}</td>
                                                <td className="px-4 py-2 text-right text-blue-600 font-mono">{b.sentQtyRaw > 0 ? b.sentQtyRaw.toFixed(1) : '—'}</td>
                                                <td className="px-4 py-2 text-right text-emerald-600 font-mono">{b.totalReceivedRaw > 0 ? b.totalReceivedRaw.toFixed(1) : '—'}</td>
                                                <td className="px-4 py-2 text-right text-red-500 font-mono">{b.scrapRaw > 0 ? b.scrapRaw.toFixed(1) : '—'}</td>
                                                <td className="px-4 py-2 text-center font-mono">
                                                  {b.daysInDyehouse !== null ? (
                                                    <span className={isOutlier ? 'text-amber-700 font-bold' : 'text-indigo-600'}>
                                                      {b.daysInDyehouse}{isOutlier && ' ⚠'}
                                                    </span>
                                                  ) : '—'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ════════════ BY DYEHOUSE TAB ════════════ */}
        {activeTab === 'dyehouses' && (
          <div className="space-y-6">
            {(Object.entries(dyehouseMonthMap) as [string, DyehouseMonthStats[]][])
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dh, months]) => {
                const totalSent = months.reduce((s, m) => s + m.sentKg, 0);
                const totalRecv = months.reduce((s, m) => s + m.receivedKg, 0);
                const totalScrap = months.reduce((s, m) => s + m.scrapKg, 0);
                const allDhDays = months.flatMap((m) => m.completedDays);
                const dhAvgDays = allDhDays.length
                  ? allDhDays.reduce((a, b) => a + b, 0) / allDhDays.length
                  : null;

                return (
                  <div
                    key={dh}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    {/* Dyehouse Header */}
                    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Factory size={18} className="text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-slate-800 text-base">{dh}</h3>
                        <p className="text-xs text-slate-400">{months.length} active months</p>
                      </div>
                      <div className="flex gap-4 text-center">
                        <div>
                          <p className="text-xs text-slate-400">Total Sent</p>
                          <p className="text-sm font-bold text-blue-600">{fmtKg(totalSent)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Total Received</p>
                          <p className="text-sm font-bold text-emerald-600">{fmtKg(totalRecv)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Total Scrap</p>
                          <p className="text-sm font-bold text-red-500">
                            {fmtKg(totalScrap)}
                            <span className="text-xs font-normal text-slate-400 ml-1">
                              ({totalSent > 0 ? ((totalScrap / totalSent) * 100).toFixed(1) : 0}%)
                            </span>
                          </p>
                        </div>
                        {dhAvgDays !== null && (
                          <div>
                            <p className="text-xs text-slate-400">Avg Days</p>
                            <p className="text-sm font-bold text-indigo-600">{dhAvgDays.toFixed(1)}d</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Monthly breakdown table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-right border-b border-slate-100">
                            <th className="px-4 py-2 font-semibold text-left">Month</th>
                            <th className="px-4 py-2 font-semibold">Opening Stock</th>
                            <th className="px-4 py-2 font-semibold text-blue-600">Sent</th>
                            <th className="px-4 py-2 font-semibold text-emerald-600">Received</th>
                            <th className="px-4 py-2 font-semibold text-red-500">Scrap</th>
                            <th className="px-4 py-2 font-semibold text-red-500">Scrap %</th>
                            <th className="px-4 py-2 font-semibold">Closing Stock</th>
                            <th className="px-4 py-2 font-semibold text-indigo-500">Avg Days</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {months.map((ms) => (
                            <tr key={ms.month} className="hover:bg-slate-50 text-right">
                              <td className="px-4 py-2.5 font-semibold text-slate-700 text-left">{ms.label}</td>
                              <td className="px-4 py-2.5 font-mono text-slate-500">{fmtKg(ms.openingStock)}</td>
                              <td className="px-4 py-2.5 font-mono font-bold text-blue-600">{ms.sentKg > 0 ? fmtKg(ms.sentKg) : '—'}</td>
                              <td className="px-4 py-2.5 font-mono font-bold text-emerald-600">{ms.receivedKg > 0 ? fmtKg(ms.receivedKg) : '—'}</td>
                              <td className="px-4 py-2.5 font-mono text-red-500">{ms.scrapKg > 0 ? fmtKg(ms.scrapKg) : '—'}</td>
                              <td className="px-4 py-2.5 font-mono text-slate-500">
                                {ms.scrapPct > 0 ? (
                                  <span className={ms.scrapPct > 5 ? 'text-red-600 font-bold' : 'text-slate-500'}>
                                    {ms.scrapPct.toFixed(1)}%
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-2.5 font-mono font-semibold text-slate-700">
                                {fmtKg(Math.max(0, ms.closingStock))}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-indigo-600">
                                {ms.avgDays !== null ? (
                                  <button
                                    onClick={() =>
                                      setCalcModalData({
                                        label: `${dh} - ${ms.label}`,
                                        batches: ms.batches.filter((b) => b.isComplete),
                                        dyehouse: dh,
                                      })
                                    }
                                    className="flex items-center justify-end gap-1 cursor-pointer hover:underline"
                                    title="Click to see calculation breakdown"
                                  >
                                    {ms.avgDays.toFixed(1)}d
                                    <span className="text-[10px] text-slate-400">({ms.completedDays.length})</span>
                                  </button>
                                ) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {/* Totals row */}
                        <tfoot>
                          <tr className="bg-slate-100 font-bold text-right border-t-2 border-slate-200">
                            <td className="px-4 py-2.5 text-left text-slate-700">Total</td>
                            <td className="px-4 py-2.5" />
                            <td className="px-4 py-2.5 font-mono text-blue-700">{fmtKg(totalSent)}</td>
                            <td className="px-4 py-2.5 font-mono text-emerald-700">{fmtKg(totalRecv)}</td>
                            <td className="px-4 py-2.5 font-mono text-red-600">{fmtKg(totalScrap)}</td>
                            <td className="px-4 py-2.5 font-mono text-slate-600">
                              {totalSent > 0 ? `${((totalScrap / totalSent) * 100).toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-4 py-2.5" />
                            <td className="px-4 py-2.5 font-mono text-indigo-700">
                              {dhAvgDays !== null ? `${dhAvgDays.toFixed(1)}d` : '—'}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}
            {Object.keys(dyehouseMonthMap).length === 0 && (
              <div className="text-center text-slate-400 py-16">No dyehouse data found</div>
            )}
          </div>
        )}

        {/* ════════════ OUTLIERS TAB ════════════ */}
        {activeTab === 'outliers' && (
          <div className="space-y-4">
            {/* Explanation */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
              <Info size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 space-y-1">
                <p className="font-semibold">What are outliers?</p>
                <p>
                  Batches where the dyehouse turnaround (formation → last receive) is significantly longer
                  than expected. We use <strong>IQR method</strong>: Q3 + 1.5 × (Q3 − Q1). These batches
                  inflate the average and may warrant investigation.
                </p>
                {globalOutlierThreshold !== Infinity && (
                  <p>
                    Current threshold: <strong>&gt;{Math.round(globalOutlierThreshold)} days</strong> (global avg:{' '}
                    {globalAvgDays?.toFixed(1)}d from {allDays.length} completed batches)
                  </p>
                )}
              </div>
            </div>

            {outlierBatches.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="font-semibold text-slate-600">No outliers detected</p>
                <p className="text-sm text-slate-400 mt-1">
                  {allDays.length < 4
                    ? 'Need at least 4 completed batches for outlier analysis'
                    : 'All completed batches are within normal range'}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 text-left border-b border-slate-200">
                      <th className="px-4 py-3 font-semibold">#</th>
                      <th className="px-4 py-3 font-semibold">Color</th>
                      <th className="px-4 py-3 font-semibold">Dyehouse</th>
                      <th className="px-4 py-3 font-semibold">Formation Date</th>
                      <th className="px-4 py-3 font-semibold">Sent Date</th>
                      <th className="px-4 py-3 font-semibold text-right">Sent (kg)</th>
                      <th className="px-4 py-3 font-semibold text-right">Scrap (kg)</th>
                      <th className="px-4 py-3 font-semibold text-right">Days ⚠</th>
                      <th className="px-4 py-3 font-semibold text-center">vs Avg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outlierBatches.map((b, idx) => {
                      const vsAvg = globalAvgDays !== null ? b.daysInDyehouse! - globalAvgDays : null;
                      return (
                        <tr key={b.id} className="hover:bg-amber-50 bg-amber-50/30">
                          <td className="px-4 py-3 text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{b.color}</td>
                          <td className="px-4 py-3 text-slate-600">{b.dyehouse}</td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-xs">{b.formationDate || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-xs">{b.dateSent || '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-blue-600">{b.sentQtyRaw > 0 ? b.sentQtyRaw.toFixed(1) : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-red-500">{b.scrapRaw > 0 ? b.scrapRaw.toFixed(1) : '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-amber-700 font-bold text-base">{b.daysInDyehouse}</span>
                            <span className="text-xs text-slate-400 ml-1">days</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {vsAvg !== null && (
                              <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                +{vsAvg.toFixed(0)}d
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ════════════ CALCULATION BREAKDOWN MODAL ════════════ */}
        {calcModalData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between mb-4 p-6 border-b border-slate-200 sticky top-0 bg-white">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">Average Days Calculation</h3>
                  <p className="text-xs text-slate-500 mt-1">{calcModalData.label}</p>
                </div>
                <button
                  onClick={() => setCalcModalData(null)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-6">
                {/* Summary stats */}
                <div className="mb-6">
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {(() => {
                      const days = calcModalData.batches
                        .filter((b) => b.daysInDyehouse !== null)
                        .map((b) => b.daysInDyehouse!);
                      const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
                      const sortedDays = [...days].sort((a, b) => a - b);
                      const median =
                        days.length % 2 === 0
                          ? (sortedDays[Math.floor(days.length / 2) - 1] + sortedDays[Math.floor(days.length / 2)]) / 2
                          : sortedDays[Math.floor(days.length / 2)];
                      return (
                        <>
                          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                            <div className="text-xs text-indigo-600 font-semibold">Average</div>
                            <div className="font-bold text-indigo-700 text-lg">{avgDays.toFixed(2)}d</div>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="text-xs text-blue-600 font-semibold">Minimum</div>
                            <div className="font-bold text-blue-700 text-lg">{Math.min(...days)}d</div>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                            <div className="text-xs text-emerald-600 font-semibold">Median</div>
                            <div className="font-bold text-emerald-700 text-lg">{median.toFixed(1)}d</div>
                          </div>
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <div className="text-xs text-orange-600 font-semibold">Maximum</div>
                            <div className="font-bold text-orange-700 text-lg">{Math.max(...days)}d</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Calculation formula */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <p className="text-xs text-slate-600 font-semibold mb-2">Calculation Formula:</p>
                    {(() => {
                      const completedBatches = calcModalData.batches.filter((b) => b.isComplete && b.daysInDyehouse !== null);
                      const days = completedBatches.map((b) => b.daysInDyehouse!);
                      const sum = days.reduce((a, b) => a + b, 0);
                      return (
                        <div className="text-sm font-mono text-slate-700 space-y-2">
                          <div>Sum: {days.join(' + ')} = {sum} days</div>
                          <div>÷ Count: {days.length} batches</div>
                          <div className="border-t border-slate-300 pt-2 font-bold text-indigo-700">
                            = {(sum / days.length).toFixed(2)} days (displayed as {(sum / days.length).toFixed(1)}d)
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Batches table */}
                <div className="mb-6">
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Completed Batches Details</h4>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                          <th className="px-3 py-2 text-left font-semibold">Customer</th>
                          <th className="px-3 py-2 text-left font-semibold">Fabric</th>
                          <th className="px-3 py-2 text-left font-semibold">Color</th>
                          <th className="px-3 py-2 text-left font-semibold">Tasheekh Date</th>
                          <th className="px-3 py-2 text-left font-semibold">Received Date</th>
                          <th className="px-3 py-2 text-right font-semibold">Days</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {calcModalData.batches
                          .filter((b) => b.isComplete)
                          .sort((a, b) => (b.daysInDyehouse ?? 0) - (a.daysInDyehouse ?? 0))
                          .map((batch) => {
                            const lastReceiveDate =
                              batch.receiveEvents.length > 0
                                ? batch.receiveEvents[batch.receiveEvents.length - 1].date
                                : null;
                            return (
                              <tr key={batch.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-700 font-medium">{batch.customerName || '—'}</td>
                                <td className="px-3 py-2 text-slate-600">{batch.fabricName || '—'}</td>
                                <td className="px-3 py-2 text-slate-600 font-semibold">{batch.color || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono">{batch.dateSent || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono">{lastReceiveDate || '—'}</td>
                                <td className="px-3 py-2 text-right">
                                  <span className="bg-indigo-100 text-indigo-700 font-bold px-2 py-1 rounded-md">
                                    {batch.daysInDyehouse ?? '—'}d
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-200 p-6 bg-slate-50 flex justify-end">
                <button
                  onClick={() => setCalcModalData(null)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-6 rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: 'blue' | 'emerald' | 'amber' | 'red';
}> = ({ icon, label, value, sub, color }) => {
  const bg: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    amber: 'bg-amber-50 border-amber-100',
    red: 'bg-red-50 border-red-100',
  };
  return (
    <div className={`${bg[color]} rounded-xl border p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
};

const MiniBadge: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}> = ({ icon, label, value, sub }) => (
  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5">
    {icon}
    <div>
      <span className="text-[10px] text-slate-400 block leading-none">{label}</span>
      <span className="text-xs font-bold text-slate-700">{value}</span>
      {sub && <span className="text-[10px] text-slate-400 ml-1">{sub}</span>}
    </div>
  </div>
);
