import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Factory, AlertCircle, Loader2, History, TrendingDown, AlertTriangle, PauseCircle, CheckCircle2, Bug, Globe, ArrowRightLeft, Trash2, ArrowRight, ArrowLeft } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { OrderRow, MachineSS } from '../types';

interface OrderProductionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  clientName: string;
  currentCustomerId?: string;
  machines: MachineSS[];
  seasonId?: string;
  seasonName?: string;
  forceOrderIdOnly?: boolean;
  userRole?: string | null;
  userName?: string;
  seasons?: { id: string; name: string }[];
  allCustomers?: { id: string; name: string; createdSeasonId?: string }[];
}

interface ProductionLog {
  id: string;
  date: string;
  machineName: string;
  dayProduction: number;
  remaining: number;
  scrap: number;
  reason?: string;
  isExternal?: boolean;
  logSeason?: string;
}

interface Transfer {
  id: string;
  fromOrderId: string;
  fromCustomerId: string;
  fromCustomerName: string;
  toOrderId: string;
  toCustomerId: string;
  toCustomerName: string;
  toFabric?: string;
  quantity: number;
  date: string;
  note: string;
  createdBy?: string;
}

interface CrossSeasonInfo {
  seasonLabel: string;
  machines: string[];
  totalProduced: number;
  logCount: number;
  dateRange: string;
}

interface Insight {
  type: 'gap' | 'low_production' | 'high_scrap' | 'good';
  message: string;
  date?: string;
  details?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────
const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-');
};

const machineColors = ['bg-blue-500','bg-violet-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-orange-500','bg-teal-500'];
const chipColors   = ['border-blue-200 bg-blue-50 text-blue-700','border-violet-200 bg-violet-50 text-violet-700','border-emerald-200 bg-emerald-50 text-emerald-700','border-amber-200 bg-amber-50 text-amber-700','border-rose-200 bg-rose-50 text-rose-700','border-cyan-200 bg-cyan-50 text-cyan-700'];

const SeasonBadge = ({ label }: { label: string }) => (
  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
    {label === 'Unknown Season' ? '2025 Summer Season' : label}
  </span>
);

// ─── MachineGroupedTable (defined OUTSIDE modal so identity is stable) ──────
const MachineGroupedTable: React.FC<{ logsMap: Map<string, ProductionLog[]> }> = ({ logsMap }) => (
  <div className="space-y-4">
    {Array.from(logsMap.entries()).map(([machineName, machineLogs], machineIdx) => {
      const machTotal = machineLogs.reduce((s, l) => s + l.dayProduction, 0);
      const isExt     = machineLogs[0]?.isExternal;
      const colorDot  = isExt ? 'bg-blue-500' : machineColors[machineIdx % machineColors.length];
      const dateRange = machineLogs.length > 1
        ? `${formatDate(machineLogs[machineLogs.length - 1].date)} – ${formatDate(machineLogs[0].date)}`
        : formatDate(machineLogs[0].date);
      return (
        <div key={machineName} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorDot}`} />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  {isExt ? <Globe className="w-3.5 h-3.5 text-blue-500" /> : <Factory className="w-3.5 h-3.5 text-slate-400" />}
                  {machineName}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 font-mono">{dateRange} · {machineLogs.length} day{machineLogs.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-slate-800">{machTotal.toLocaleString()} kg</div>
              <div className="text-xs text-slate-400">total produced</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase tracking-wide bg-white border-b border-slate-100">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-right font-medium">Produced</th>
                <th className="px-4 py-2.5 text-right font-medium">Remaining</th>
                <th className="px-4 py-2.5 text-right font-medium">Scrap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {machineLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-slate-600 text-sm">{formatDate(log.date)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold text-sm ${isExt ? 'text-blue-600' : 'text-emerald-600'}`}>{log.dayProduction.toLocaleString()} kg</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-500 text-sm">{log.remaining.toLocaleString()} kg</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">
                    {log.scrap > 0 ? <span className="text-red-500">{log.scrap} kg</span> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    })}
  </div>
);

// ─── Main component ──────────────────────────────────────────────────────────
export const OrderProductionHistoryModal: React.FC<OrderProductionHistoryModalProps> = ({
  isOpen, onClose, order, clientName,
  currentCustomerId = '', machines,
  seasonId, seasonName,
  forceOrderIdOnly = false,
  userRole, userName = '',
  seasons = [], allCustomers = [],
}) => {
  const [logs, setLogs]                         = useState<ProductionLog[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [totalProduction, setTotalProduction]   = useState(0);
  const [debugInfo, setDebugInfo]               = useState<string[]>([]);
  const [crossSeasonInfo, setCrossSeasonInfo]   = useState<CrossSeasonInfo[]>([]);
  const [crossSeasonLogs, setCrossSeasonLogs]   = useState<ProductionLog[]>([]);
  const [expandedCrossSeasons, setExpandedCrossSeasons] = useState<Set<string>>(new Set());
  const [legacyLogs, setLegacyLogs]             = useState<ProductionLog[]>([]);
  const [showLegacy, setShowLegacy]             = useState(false);
  const [showDebug, setShowDebug]               = useState(false);
  const [showInsights, setShowInsights]         = useState(false);

  // Transfer state
  const [transfers, setTransfers]               = useState<Transfer[]>([]);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [targetSeasonId, setTargetSeasonId]     = useState(seasonId || '');
  const [targetCustomerId, setTargetCustomerId] = useState('');
  const [targetOrderId, setTargetOrderId]       = useState('');
  const [transferQty, setTransferQty]           = useState('');
  const [transferDate, setTransferDate]         = useState(new Date().toISOString().split('T')[0]);
  const [transferNote, setTransferNote]         = useState('');
  const [targetCustomerOrders, setTargetCustomerOrders] = useState<any[]>([]);
  const [loadingTargetOrders, setLoadingTargetOrders]   = useState(false);
  const [targetOrderProduced, setTargetOrderProduced]   = useState<number | null>(null);
  const [loadingTargetProduced, setLoadingTargetProduced] = useState(false);
  const [savingTransfer, setSavingTransfer]     = useState(false);

  const canTransfer = userRole === 'admin' || userRole === 'daily_planner';

  // ── fetch on open ──
  useEffect(() => {
    if (isOpen && order) {
      setShowLegacy(false);
      setShowTransferForm(false);
      resetTransferForm();
      fetchLogs();
      fetchTransfers();
    }
  }, [isOpen, order, machines]);

  const resetTransferForm = () => {
    setTargetSeasonId(seasonId || '');
    setTargetCustomerId('');
    setTargetOrderId('');
    setTransferQty('');
    setTransferDate(new Date().toISOString().split('T')[0]);
    setTransferNote('');
    setTargetCustomerOrders([]);
    setTargetOrderProduced(null);
  };

  const fetchTransfers = async () => {
    if (!order?.id) return;
    try {
      const [fromSnap, toSnap] = await Promise.all([
        getDocs(query(collection(db, 'productionTransfers'), where('fromOrderId', '==', order.id))),
        getDocs(query(collection(db, 'productionTransfers'), where('toOrderId',   '==', order.id))),
      ]);
      const seen = new Set<string>();
      const result: Transfer[] = [];
      [...fromSnap.docs, ...toSnap.docs].forEach(d => {
        if (!seen.has(d.id)) { seen.add(d.id); result.push({ id: d.id, ...d.data() } as Transfer); }
      });
      setTransfers(result);
    } catch (err) { console.error('fetchTransfers', err); }
  };

  // ── fetch target customer orders when customer changes ──
  useEffect(() => {
    if (!targetCustomerId) { setTargetCustomerOrders([]); setTargetOrderId(''); setTargetOrderProduced(null); return; }
    setLoadingTargetOrders(true);
    setTargetOrderProduced(null);
    getDocs(collection(db, 'CustomerSheets', targetCustomerId, 'orders'))
      .then(snap => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setTargetCustomerOrders(orders);
        // auto-select same fabric
        const match = orders.find((o: any) =>
          (o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase()
        );
        setTargetOrderId(match ? (match as any).id : '');
      })
      .catch(() => setTargetCustomerOrders([]))
      .finally(() => setLoadingTargetOrders(false));
  }, [targetCustomerId]);

  // ── fetch produced qty for selected target order ──
  useEffect(() => {
    if (!targetOrderId) { setTargetOrderProduced(null); return; }
    setLoadingTargetProduced(true);
    // scan machine logs for this orderId
    Promise.all(
      machines.map(m =>
        getDocs(collection(db, 'MachineSS', String((m as any).firestoreId || (m as any).id || ''), 'dailyLogs'))
          .then(snap => snap.docs.map(d => d.data()))
          .catch(() => [] as any[])
      )
    ).then(allMachineLogs => {
      let total = 0;
      allMachineLogs.flat().forEach((log: any) => {
        if (log.orderId === targetOrderId) total += Number(log.dayProduction) || 0;
        (log.extraSessions || []).forEach((s: any) => {
          if (s.orderId === targetOrderId) total += Number(s.dayProduction) || 0;
        });
      });
      // also external
      return getDocs(query(collection(db, 'externalProduction'), where('orderId', '==', targetOrderId)))
        .then(snap => {
          snap.docs.forEach(d => { total += Number(d.data().receivedQty) || 0; });
          setTargetOrderProduced(total);
        });
    }).catch(() => setTargetOrderProduced(null))
      .finally(() => setLoadingTargetProduced(false));
  }, [targetOrderId]);

  // ── save transfer ──
  const handleSaveTransfer = async () => {
    if (!transferQty || !targetCustomerId || !targetOrderId) return;
    setSavingTransfer(true);
    try {
      const targetCustomer = allCustomers.find(c => c.id === targetCustomerId);
      const targetOrder    = targetCustomerOrders.find((o: any) => o.id === targetOrderId);
      await addDoc(collection(db, 'productionTransfers'), {
        fromOrderId:      order.id,
        fromCustomerId:   currentCustomerId,
        fromCustomerName: clientName,
        fromFabric:       order.material || '',
        toOrderId:        targetOrderId,
        toCustomerId:     targetCustomerId,
        toCustomerName:   targetCustomer?.name || '',
        toFabric:         (targetOrder as any)?.material || '',
        quantity:         Number(transferQty),
        date:             transferDate,
        note:             transferNote,
        createdBy:        userName,
        createdAt:        serverTimestamp(),
      });
      setShowTransferForm(false);
      resetTransferForm();
      await fetchTransfers();
    } catch (err) { console.error('saveTransfer', err); }
    finally { setSavingTransfer(false); }
  };

  const handleDeleteTransfer = async (transferId: string) => {
    if (!window.confirm('Delete this transfer? The production numbers will revert.')) return;
    try {
      await deleteDoc(doc(db, 'productionTransfers', transferId));
      await fetchTransfers();
    } catch (err) { console.error('deleteTransfer', err); }
  };

  // ── derived totals ──
  const outgoingTotal = transfers.filter(t => t.fromOrderId === order.id).reduce((s, t) => s + t.quantity, 0);
  const incomingTotal = transfers.filter(t => t.toOrderId   === order.id).reduce((s, t) => s + t.quantity, 0);
  const netProduced   = totalProduction - outgoingTotal + incomingTotal;

  const filteredTargetCustomers = useMemo(() =>
    allCustomers.filter(c =>
      c.id !== currentCustomerId &&
      (!targetSeasonId || (c as any).createdSeasonId === targetSeasonId)
    ),
    [targetSeasonId, allCustomers, currentCustomerId]
  );

  const fabricMatch = useMemo(() => {
    if (!targetCustomerId || targetCustomerOrders.length === 0) return null;
    return targetCustomerOrders.find((o: any) =>
      (o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase()
    ) || null;
  }, [targetCustomerId, targetCustomerOrders, order.material]);

  const selectedTargetOrder = useMemo(() =>
    targetCustomerOrders.find((o: any) => o.id === targetOrderId) || null,
    [targetCustomerOrders, targetOrderId]
  );

  // ── production log fetching ──
  const fetchLogs = async () => {
    setLoading(true);
    const debug: string[] = [];
    const isReOrder = forceOrderIdOnly || !!order.reorderOfId;
    debug.push(isReOrder ? `[ReOrder] Searching by Order ID: "${order.id}"` : `Client: "${clientName}", Fabric: "${order.material}"`);
    debug.push(`Machines: ${machines.length}${seasonId ? `, Season: "${seasonName || seasonId}"` : ''}`);
    try {
      const logsData: ProductionLog[]      = [];
      const crossSeasonLogsData: ProductionLog[] = [];
      const legacyLogsData: ProductionLog[] = [];
      const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
      const targetClient = normalize(clientName);
      const targetFabric = normalize(order.material);

      const logSeasonMatches = (logClientSeason?: string) => {
        if (!seasonId && !seasonName) return true;
        if (!logClientSeason) return false;
        return logClientSeason === seasonId || logClientSeason === seasonName;
      };

      const machineEntries = machines.map((m: any) => ({
        id:   String(m.firestoreId || m.id || ''),
        name: m.name || m.machineName || String(m.id || ''),
      })).filter(m => m.id);

      const allSubDocs = await Promise.all(
        machineEntries.map(m =>
          getDocs(collection(db, 'MachineSS', m.id, 'dailyLogs'))
            .then(snap => snap.docs.map(d => ({ data: d.data(), machineName: m.name, docId: d.id })))
            .catch(() => [])
        )
      );

      allSubDocs.flat().forEach(({ data: log, machineName, docId }) => {
        const logClient      = normalize(log.client);
        const logFabric      = normalize(log.fabric);
        const hasOrderId     = !!log.orderId;
        const isOrderIdMatch = log.orderId === order.id;
        const isLegacyMatch  = !isReOrder && !hasOrderId
          && ((logClient === targetClient && logFabric === targetFabric)
            || (log.client === clientName && log.fabric === order.material));

        if (isReOrder ? isOrderIdMatch : (isOrderIdMatch || isLegacyMatch)) {
          const entry: ProductionLog = {
            id: `${machineName}-${log.date}-${docId}`,
            date: log.date, machineName,
            dayProduction: Number(log.dayProduction) || 0,
            remaining: Number(log.remainingMfg)    || 0,
            scrap:     Number(log.scrap)           || 0,
            reason: log.note || '', isExternal: false,
            logSeason: log.clientSeason || undefined,
          };
          if (isLegacyMatch) legacyLogsData.push(entry);
          else if (logSeasonMatches(log.clientSeason)) logsData.push(entry);
          else crossSeasonLogsData.push(entry);
        }

        ((log.extraSessions || []) as any[]).forEach((session: any, sIdx: number) => {
          const sClient       = normalize(session.client || '');
          const sFabric       = normalize(session.fabric || '');
          const sHasOrderId   = !!session.orderId;
          const sOrderIdMatch = session.orderId === order.id;
          const sIsLegacy     = !isReOrder && !sHasOrderId
            && ((sClient === targetClient && sFabric === targetFabric)
              || (session.client === clientName && session.fabric === order.material));
          if (sOrderIdMatch || sIsLegacy) {
            const e: ProductionLog = {
              id: `${machineName}-${log.date}-${docId}-s${sIdx}`,
              date: log.date, machineName,
              dayProduction: Number(session.dayProduction) || 0,
              remaining: Number(session.remainingMfg)     || 0,
              scrap: 0, reason: '', isExternal: false,
              logSeason: session.clientSeason || log.clientSeason || undefined,
            };
            if (sIsLegacy) legacyLogsData.push(e);
            else if (logSeasonMatches(session.clientSeason || log.clientSeason)) logsData.push(e);
            else crossSeasonLogsData.push(e);
          }
        });
      });

      debug.push(`Sub-logs: ${allSubDocs.flat().length} total, ${logsData.length} matched.`);

      try {
        const extQ = isReOrder
          ? query(collection(db, 'externalProduction'), where('orderId', '==', order.id))
          : query(collection(db, 'externalProduction'), where('client', '==', clientName));
        const extDocs = await getDocs(extQ);
        extDocs.forEach(d => {
          const data = d.data();
          if (isReOrder || normalize(data.fabric) === targetFabric) {
            const e: ProductionLog = {
              id: d.id, date: data.date, machineName: data.factory || 'External',
              dayProduction: Number(data.receivedQty) || 0,
              remaining:     Number(data.remainingQty) || 0,
              scrap: Number(data.scrap) || Number(data.scrapQty) || 0,
              reason: data.notes || '', isExternal: true,
              logSeason: data.clientSeason || undefined,
            };
            const extOk = !data.clientSeason || logSeasonMatches(data.clientSeason);
            if (extOk) logsData.push(e); else crossSeasonLogsData.push(e);
          }
        });
        debug.push(`External: ${extDocs.size} records.`);
      } catch (err) { debug.push(`External error: ${err}`); }

      if (crossSeasonLogsData.length > 0) {
        const seasonMap = new Map<string, { machines: Set<string>; totalProduced: number; count: number; dates: string[] }>();
        crossSeasonLogsData.forEach(log => {
          const label = log.logSeason || '2025 Summer Season';
          if (!seasonMap.has(label)) seasonMap.set(label, { machines: new Set(), totalProduced: 0, count: 0, dates: [] });
          const e = seasonMap.get(label)!;
          e.machines.add(log.machineName); e.totalProduced += log.dayProduction; e.count++; e.dates.push(log.date);
        });
        const crossInfo: CrossSeasonInfo[] = [];
        seasonMap.forEach((val, key) => {
          const sorted = val.dates.sort();
          crossInfo.push({ seasonLabel: key, machines: Array.from(val.machines), totalProduced: val.totalProduced, logCount: val.count,
            dateRange: sorted.length > 1 ? `${formatDate(sorted[0])} – ${formatDate(sorted[sorted.length-1])}` : formatDate(sorted[0]) });
        });
        setCrossSeasonInfo(crossInfo);
        setCrossSeasonLogs(crossSeasonLogsData);
      } else { setCrossSeasonInfo([]); setCrossSeasonLogs([]); }

      logsData.sort((a, b) => b.date.localeCompare(a.date));
      legacyLogsData.sort((a, b) => b.date.localeCompare(a.date));
      setLogs(logsData);
      setLegacyLogs(legacyLogsData);
      setTotalProduction(logsData.reduce((s, l) => s + l.dayProduction, 0));
      setDebugInfo(debug);
    } catch (error) {
      setDebugInfo([`Error: ${error}`]);
    } finally { setLoading(false); }
  };

  // ── memo ──
  const groupedByMachine = useMemo(() => {
    const map = new Map<string, ProductionLog[]>();
    logs.forEach(log => { if (!map.has(log.machineName)) map.set(log.machineName, []); map.get(log.machineName)!.push(log); });
    map.forEach(arr => arr.sort((a, b) => b.date.localeCompare(a.date)));
    return new Map([...map.entries()].sort(([,a],[,b]) => b.reduce((s,l)=>s+l.dayProduction,0) - a.reduce((s,l)=>s+l.dayProduction,0)));
  }, [logs]);

  const crossSeasonByMachine = useMemo(() => {
    const map = new Map<string, Map<string, ProductionLog[]>>();
    crossSeasonLogs.forEach(log => {
      const sk = log.logSeason || '2025 Summer Season';
      if (!map.has(sk)) map.set(sk, new Map());
      const mm = map.get(sk)!;
      if (!mm.has(log.machineName)) mm.set(log.machineName, []);
      mm.get(log.machineName)!.push(log);
    });
    map.forEach(mm => mm.forEach(arr => arr.sort((a,b) => b.date.localeCompare(a.date))));
    return map;
  }, [crossSeasonLogs]);

  const toggleCrossSeason = (label: string) =>
    setExpandedCrossSeasons(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  const lastWorkingInfo = useMemo(() =>
    logs.length === 0 ? null : { date: formatDate(logs[0].date), remaining: logs[0].remaining },
    [logs]);

  const insights = useMemo(() => {
    if (logs.length < 2) return [];
    const results: Insight[] = [];
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const avg = sorted.reduce((s, l) => s + l.dayProduction, 0) / sorted.length;
    for (let i = 1; i < sorted.length; i++) {
      const diff = Math.ceil(Math.abs(new Date(sorted[i].date).getTime() - new Date(sorted[i-1].date).getTime()) / 86400000);
      if (diff > 2) results.push({ type: 'gap', message: `Production stopped for ${diff-1} days`, date: `${sorted[i-1].date} to ${sorted[i].date}`, details: 'Potential machine downtime or material shortage' });
    }
    sorted.forEach(log => {
      if (log.dayProduction < avg * 0.6 && log.dayProduction > 0) results.push({ type: 'low_production', message: 'Low Production Detected', date: log.date, details: `${log.dayProduction} kg (Avg: ${Math.round(avg)} kg)` });
      if (log.scrap > 20) results.push({ type: 'high_scrap', message: 'High Scrap Event', date: log.date, details: `${log.scrap} kg scrap recorded` });
    });
    if (results.length === 0) results.push({ type: 'good', message: 'Smooth Production Run', details: 'No significant gaps or issues detected' });
    return results;
  }, [logs]);

  const narrative = useMemo(() => {
    if (logs.length === 0) return null;
    const sorted = [...logs].sort((a,b) => a.date.localeCompare(b.date));
    const gaps = insights.filter(i => i.type === 'gap');
    const low  = insights.filter(i => i.type === 'low_production');
    const scr  = insights.filter(i => i.type === 'high_scrap');
    let txt = `Production started on ${sorted[0].date} and last ran on ${sorted[sorted.length-1].date}. `;
    if (gaps.length) txt += `It faced ${gaps.length} stoppage${gaps.length>1?'s':''}. `;
    else txt += `It ran consistently without major interruptions. `;
    if (low.length && scr.length) txt += `It struggled with both low production (${low.length} days) and high scrap (${scr.length} days). `;
    else if (low.length) txt += `There were ${low.length} days where production dropped significantly. `;
    else if (scr.length) txt += `Scrap levels were high on ${scr.length} occasions. `;
    else txt += `Performance was generally stable.`;
    return txt;
  }, [logs, insights]);

  if (!isOpen) return null;

  const machineList  = Array.from(groupedByMachine.keys());
  const machineCount = machineList.length;

  // Transfer qty to go to target after this transfer (for preview)
  const afterTransferProduced = targetOrderProduced !== null && transferQty
    ? targetOrderProduced + Number(transferQty)
    : null;

  // ── render ──
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-slate-50 to-white rounded-t-2xl flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <History className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <h2 className="text-base font-bold text-slate-800">Production History</h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">{clientName}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-600 font-medium truncate max-w-xs">{order.material}</span>
              {(seasonName || seasonId) && <><span className="text-slate-300">·</span><SeasonBadge label={seasonName || seasonId || ''} /></>}
            </div>
          </div>
          <button onClick={onClose} className="ml-4 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm">Scanning production data…</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">

              {/* ── no logs state ── */}
              {logs.length === 0 && (
                <>
                  {crossSeasonInfo.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <History className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-800">Not produced in the current season</div>
                          <div className="text-xs text-slate-500 mt-0.5">Found production records from a different season — expand below to view.</div>
                        </div>
                      </div>
                      {crossSeasonInfo.map((info, idx) => {
                        const label = info.seasonLabel === 'Unknown Season' ? '2025 Summer Season' : info.seasonLabel;
                        const isExp = expandedCrossSeasons.has(info.seasonLabel);
                        return (
                          <div key={idx} className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="px-4 py-3 bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-3 flex-wrap">
                                <SeasonBadge label={label} />
                                <span className="text-sm font-bold text-amber-900">{info.totalProduced.toLocaleString()} kg total</span>
                              </div>
                              <button onClick={() => toggleCrossSeason(info.seasonLabel)} className="text-xs font-semibold px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-lg transition-colors">
                                {isExp ? 'Hide' : 'View Details'} <span className={`inline-block transition-transform ${isExp?'rotate-180':''}`}>▼</span>
                              </button>
                            </div>
                            {isExp && <div className="p-4 bg-white border-t border-amber-100"><MachineGroupedTable logsMap={crossSeasonByMachine.get(info.seasonLabel) || new Map()} /></div>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                        <AlertCircle className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-sm font-medium text-slate-500">No production logs found for this order.</p>
                    </div>
                  )}
                </>
              )}

              {/* ── stat cards ── */}
              {logs.length > 0 && (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    {/* Total Produced */}
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl p-4">
                      <div className="text-xs text-blue-600 font-semibold uppercase tracking-wider mb-1">Total Produced</div>
                      <div className="text-2xl font-bold text-blue-900">{netProduced.toLocaleString()}<span className="text-sm font-normal text-blue-500 ml-1">kg</span></div>
                      {(outgoingTotal > 0 || incomingTotal > 0) ? (
                        <div className="text-xs text-blue-600/70 mt-1 space-y-0.5">
                          <div>Raw: {totalProduction.toLocaleString()} kg</div>
                          {outgoingTotal > 0 && <div className="text-red-500">Transferred out: −{outgoingTotal.toLocaleString()} kg</div>}
                          {incomingTotal > 0 && <div className="text-emerald-600">Transferred in: +{incomingTotal.toLocaleString()} kg</div>}
                        </div>
                      ) : (
                        <div className="text-xs text-blue-600/70 mt-1">{logs.length} production days</div>
                      )}
                    </div>
                    {/* Last Active */}
                    <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 border border-violet-200 rounded-xl p-4">
                      <div className="text-xs text-violet-600 font-semibold uppercase tracking-wider mb-1">Last Active</div>
                      <div className="text-2xl font-bold text-violet-900">{lastWorkingInfo?.date || '—'}</div>
                      <div className="text-xs text-violet-600/70 mt-1">{lastWorkingInfo?.remaining != null ? `${lastWorkingInfo.remaining.toLocaleString()} kg remaining` : ' '}</div>
                    </div>
                    {/* Avg/Day */}
                    <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200 rounded-xl p-4">
                      <div className="text-xs text-emerald-600 font-semibold uppercase tracking-wider mb-1">Avg / Day</div>
                      <div className="text-2xl font-bold text-emerald-900">{Math.round(totalProduction / logs.length).toLocaleString()}<span className="text-sm font-normal text-emerald-500 ml-1">kg</span></div>
                      {machineCount > 1 && <div className="text-xs text-emerald-600/70 mt-1">{machineCount} machines</div>}
                    </div>
                  </div>

                  {/* Machine chips */}
                  {machineCount > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {machineList.map((name, idx) => {
                        const ml = groupedByMachine.get(name)!;
                        const mt = ml.reduce((s,l) => s+l.dayProduction, 0);
                        const cls = ml[0]?.isExternal ? 'border-blue-200 bg-blue-50 text-blue-700' : chipColors[idx % chipColors.length];
                        return (
                          <div key={name} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${cls}`}>
                            <span className={`w-2 h-2 rounded-full ${machineColors[idx % machineColors.length]}`} />
                            {name} · {mt.toLocaleString()} kg
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Legacy */}
                  {legacyLogs.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-semibold text-slate-600">Legacy match found</span>
                          <span className="text-xs text-slate-400">— {legacyLogs.reduce((s,l)=>s+l.dayProduction,0).toLocaleString()} kg (not counted)</span>
                        </div>
                        <button onClick={() => setShowLegacy(p => !p)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">
                          {showLegacy ? 'Hide' : 'View Details'}
                        </button>
                      </div>
                      {showLegacy && (
                        <div className="p-4 bg-white border-t border-slate-100">
                          <MachineGroupedTable logsMap={(() => {
                            const m = new Map<string,ProductionLog[]>();
                            legacyLogs.forEach(l => { if(!m.has(l.machineName)) m.set(l.machineName,[]); m.get(l.machineName)!.push(l); });
                            return m;
                          })()} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cross-season */}
                  {crossSeasonInfo.length > 0 && (
                    <div className="border border-amber-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-semibold text-amber-900">Also produced in other seasons</span>
                        </div>
                        <button onClick={() => toggleCrossSeason('__cross_banner__')} className="text-xs font-semibold text-amber-700 border border-amber-300 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors">
                          {expandedCrossSeasons.has('__cross_banner__') ? 'Hide' : 'View Details'}
                        </button>
                      </div>
                      {expandedCrossSeasons.has('__cross_banner__') && (
                        <div className="p-4 bg-white border-t border-amber-100 space-y-4">
                          {crossSeasonInfo.map((info, idx) => {
                            const label = info.seasonLabel === 'Unknown Season' ? '2025 Summer Season' : info.seasonLabel;
                            return (
                              <div key={idx}>
                                <div className="flex items-center gap-2 mb-2"><SeasonBadge label={label} /><span className="text-xs text-slate-500">{info.totalProduced.toLocaleString()} kg · {info.dateRange}</span></div>
                                <MachineGroupedTable logsMap={crossSeasonByMachine.get(info.seasonLabel) || new Map()} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Main logs */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                      <Factory className="w-4 h-4 text-slate-400" />
                      Production Logs{machineCount > 1 ? ` · ${machineCount} Machines` : ''}
                    </h3>
                    <MachineGroupedTable logsMap={groupedByMachine} />
                  </div>
                </>
              )}

              {/* ── Transfers display ── inlined to avoid identity change */}
              {transfers.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-bold text-slate-700">Production Transfers</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {transfers.filter(t => t.fromOrderId === order.id).map(t => (
                      <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-red-50/40 hover:bg-red-50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <ArrowRight className="w-3.5 h-3.5 text-red-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-red-700">Transferred to {t.toCustomerName}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}{t.createdBy ? ` · by ${t.createdBy}` : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                          <span className="font-mono font-bold text-red-600 text-sm">−{t.quantity.toLocaleString()} kg</span>
                          {canTransfer && (
                            <button onClick={() => handleDeleteTransfer(t.id)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded" title="Delete transfer"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </div>
                    ))}
                    {transfers.filter(t => t.toOrderId === order.id).map(t => (
                      <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                            <ArrowLeft className="w-3.5 h-3.5 text-emerald-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-emerald-700">Transferred from {t.fromCustomerName}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}{t.createdBy ? ` · by ${t.createdBy}` : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                          <span className="font-mono font-bold text-emerald-600 text-sm">+{t.quantity.toLocaleString()} kg</span>
                          {canTransfer && (
                            <button onClick={() => handleDeleteTransfer(t.id)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded" title="Delete transfer"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Transfer form — inlined (no nested component) ── */}
              {showTransferForm && canTransfer && (
                <div className="rounded-2xl border border-orange-200 overflow-hidden shadow-sm">
                  {/* Form header */}
                  <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <ArrowRightLeft className="w-4 h-4 text-orange-600" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800">Transfer Production</div>
                        <div className="text-xs text-slate-500 mt-0.5">Move quantity from this order to another customer</div>
                      </div>
                    </div>
                    <button onClick={() => { setShowTransferForm(false); resetTransferForm(); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white/80 rounded-lg transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 space-y-5 bg-white">
                    {/* Source info strip */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Source</div>
                      <div className="h-4 w-px bg-slate-200" />
                      <span className="text-xs font-semibold text-slate-700">{clientName}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-600 truncate max-w-xs">{order.material}</span>
                      <div className="ml-auto text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                        {netProduced.toLocaleString()} kg produced
                      </div>
                    </div>

                    {/* Steps */}
                    <div className="space-y-4">
                      {/* Season */}
                      <div className="grid grid-cols-12 gap-3 items-start">
                        <div className="col-span-1 flex justify-center pt-2.5">
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-700">1</div>
                        </div>
                        <div className="col-span-11">
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Target Season</label>
                          <select
                            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                            value={targetSeasonId}
                            onChange={e => { setTargetSeasonId(e.target.value); setTargetCustomerId(''); setTargetOrderId(''); setTargetCustomerOrders([]); setTargetOrderProduced(null); }}
                          >
                            <option value="">All seasons</option>
                            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Customer */}
                      <div className="grid grid-cols-12 gap-3 items-start">
                        <div className="col-span-1 flex justify-center pt-2.5">
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-700">2</div>
                        </div>
                        <div className="col-span-11">
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Target Customer</label>
                          <select
                            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                            value={targetCustomerId}
                            onChange={e => { setTargetCustomerId(e.target.value); setTargetOrderId(''); setTargetOrderProduced(null); }}
                          >
                            <option value="">Select customer…</option>
                            {filteredTargetCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>

                          {/* Fabric match banner */}
                          {targetCustomerId && !loadingTargetOrders && (
                            <div className={`mt-2 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium ${fabricMatch ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                              {fabricMatch
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />}
                              <span>
                                Fabric <strong>"{order.material}"</strong>{' '}
                                {fabricMatch
                                  ? 'found in this customer\'s orders — production will be added to it.'
                                  : 'not found in this customer\'s orders. Select the order to transfer to manually.'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Order */}
                      {targetCustomerId && (
                        <div className="grid grid-cols-12 gap-3 items-start">
                          <div className="col-span-1 flex justify-center pt-2.5">
                            <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-700">3</div>
                          </div>
                          <div className="col-span-11">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Target Order</label>
                            {loadingTargetOrders ? (
                              <div className="flex items-center gap-2 text-sm text-slate-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading orders…</div>
                            ) : (
                              <select
                                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                                value={targetOrderId}
                                onChange={e => setTargetOrderId(e.target.value)}
                              >
                                <option value="">Select order…</option>
                                {targetCustomerOrders.map((o: any) => {
                                  const isSameFabric = (o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase();
                                  return (
                                    <option key={o.id} value={o.id}>
                                      {o.material || 'Unknown fabric'}
                                      {o.requiredQty ? ` · ${Number(o.requiredQty).toLocaleString()} kg ordered` : ''}
                                      {isSameFabric ? ' ✓ Same fabric' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            )}

                            {/* Target order production summary */}
                            {targetOrderId && selectedTargetOrder && (
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <div className="flex flex-col items-center px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                                  <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Ordered</span>
                                  <span className="text-sm font-bold text-slate-700">
                                    {selectedTargetOrder.customerOrderedQty
                                      ? Number(selectedTargetOrder.customerOrderedQty).toLocaleString()
                                      : Number(selectedTargetOrder.requiredQty || 0).toLocaleString()} kg
                                  </span>
                                </div>
                                <div className="flex flex-col items-center px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                                  <span className="text-[10px] text-blue-600 uppercase tracking-wide font-semibold mb-0.5">Currently Produced</span>
                                  {loadingTargetProduced ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-blue-400 mt-0.5" />
                                  ) : (
                                    <span className="text-sm font-bold text-blue-700">
                                      {targetOrderProduced !== null ? `${targetOrderProduced.toLocaleString()} kg` : '—'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-col items-center px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                                  <span className="text-[10px] text-emerald-600 uppercase tracking-wide font-semibold mb-0.5">After Transfer</span>
                                  <span className="text-sm font-bold text-emerald-700">
                                    {afterTransferProduced !== null ? `${afterTransferProduced.toLocaleString()} kg` : '—'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Quantity + Date */}
                      <div className="grid grid-cols-12 gap-3 items-start">
                        <div className="col-span-1 flex justify-center pt-2.5">
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-700">4</div>
                        </div>
                        <div className="col-span-11 grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Quantity (kg)</label>
                            <input
                              type="number"
                              min="1"
                              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                              placeholder="e.g. 3000"
                              value={transferQty}
                              onChange={e => setTransferQty(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Date</label>
                            <input
                              type="date"
                              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                              value={transferDate}
                              onChange={e => setTransferDate(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Note */}
                      <div className="grid grid-cols-12 gap-3 items-start">
                        <div className="col-span-1" />
                        <div className="col-span-11">
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">Note <span className="font-normal text-slate-400 normal-case">(optional)</span></label>
                          <input
                            type="text"
                            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                            placeholder="Reason for transfer…"
                            value={transferNote}
                            onChange={e => setTransferNote(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Footer buttons */}
                    <div className="flex justify-end gap-2.5 pt-1 border-t border-slate-100">
                      <button
                        onClick={() => { setShowTransferForm(false); resetTransferForm(); }}
                        className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveTransfer}
                        disabled={savingTransfer || !transferQty || !targetCustomerId || !targetOrderId}
                        className="px-5 py-2.5 text-sm font-bold text-white bg-orange-600 rounded-xl hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors shadow-sm shadow-orange-200"
                      >
                        {savingTransfer
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                          : <><ArrowRightLeft className="w-4 h-4" /> Confirm Transfer</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Insights */}
              {insights.length > 0 && logs.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button onClick={() => setShowInsights(p => !p)} className="w-full px-4 py-3 bg-slate-50 flex items-center justify-between hover:bg-slate-100 transition-colors text-left">
                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      Production Insights
                      <span className="text-xs font-normal text-slate-400">({insights.length} observation{insights.length !== 1 ? 's' : ''})</span>
                    </span>
                    <span className={`text-slate-400 transition-transform ${showInsights ? 'rotate-180' : ''}`}>▼</span>
                  </button>
                  {showInsights && (
                    <div className="p-4 space-y-3 bg-white">
                      {narrative && <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 leading-relaxed"><span className="font-semibold text-slate-800">Summary: </span>{narrative}</div>}
                      <div className="grid gap-2">
                        {insights.map((insight, idx) => (
                          <div key={idx} className={`p-3 rounded-lg border flex items-start gap-3 ${insight.type === 'gap' ? 'bg-amber-50 border-amber-200 text-amber-900' : insight.type === 'low_production' ? 'bg-orange-50 border-orange-200 text-orange-900' : insight.type === 'high_scrap' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                            <div className={`mt-0.5 p-1 rounded-full ${insight.type === 'gap' ? 'bg-amber-100 text-amber-600' : insight.type === 'low_production' ? 'bg-orange-100 text-orange-600' : insight.type === 'high_scrap' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {insight.type === 'gap' ? <PauseCircle size={14} /> : insight.type === 'low_production' ? <TrendingDown size={14} /> : insight.type === 'high_scrap' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                            </div>
                            <div>
                              <div className="font-semibold text-sm">{insight.message}</div>
                              <div className="text-xs opacity-75 mt-0.5">{insight.date && <span className="font-mono mr-2">{formatDate(insight.date)}:</span>}{insight.details}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Debug */}
              <div>
                <button onClick={() => setShowDebug(p => !p)} className="text-xs text-slate-300 hover:text-slate-500 flex items-center gap-1 transition-colors">
                  <Bug size={10} /> {showDebug ? 'Hide' : 'Show'} debug info
                </button>
                {showDebug && (
                  <div className="mt-2 bg-slate-100 border border-slate-200 p-3 rounded-lg text-[10px] font-mono text-slate-500 space-y-0.5">
                    {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex items-center justify-between gap-3">
          <div>
            {canTransfer && !showTransferForm && (
              <button
                onClick={() => setShowTransferForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transfer Production
              </button>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm">
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
