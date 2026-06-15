import React, { useState, useEffect, useMemo } from 'react';
import { X, Factory, AlertCircle, Loader2, History, TrendingDown, AlertTriangle, PauseCircle, CheckCircle2, Bug, Globe, ArrowRightLeft, Trash2, Plus, ArrowRight, ArrowLeft } from 'lucide-react';
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

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-');
};

export const OrderProductionHistoryModal: React.FC<OrderProductionHistoryModalProps> = ({
  isOpen,
  onClose,
  order,
  clientName,
  currentCustomerId = '',
  machines,
  seasonId,
  seasonName,
  forceOrderIdOnly = false,
  userRole,
  userName = '',
  seasons = [],
  allCustomers = [],
}) => {
  const [logs, setLogs] = useState<ProductionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalProduction, setTotalProduction] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [crossSeasonInfo, setCrossSeasonInfo] = useState<CrossSeasonInfo[]>([]);
  const [crossSeasonLogs, setCrossSeasonLogs] = useState<ProductionLog[]>([]);
  const [expandedCrossSeasons, setExpandedCrossSeasons] = useState<Set<string>>(new Set());
  const [legacyLogs, setLegacyLogs] = useState<ProductionLog[]>([]);
  const [showLegacy, setShowLegacy] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  // Transfers state
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({
    quantity: '',
    targetSeasonId: seasonId || '',
    targetCustomerId: '',
    targetOrderId: '',
    date: new Date().toISOString().split('T')[0],
    note: '',
  });
  const [targetCustomerOrders, setTargetCustomerOrders] = useState<any[]>([]);
  const [loadingTargetOrders, setLoadingTargetOrders] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);

  const canTransfer = userRole === 'admin' || userRole === 'daily_planner';

  useEffect(() => {
    if (isOpen && order) {
      setShowLegacy(false);
      setShowTransferForm(false);
      fetchLogs();
      fetchTransfers();
    }
  }, [isOpen, order, machines]);

  const fetchTransfers = async () => {
    if (!order?.id) return;
    try {
      const [fromSnap, toSnap] = await Promise.all([
        getDocs(query(collection(db, 'productionTransfers'), where('fromOrderId', '==', order.id))),
        getDocs(query(collection(db, 'productionTransfers'), where('toOrderId', '==', order.id))),
      ]);
      const seen = new Set<string>();
      const result: Transfer[] = [];
      [...fromSnap.docs, ...toSnap.docs].forEach(d => {
        if (!seen.has(d.id)) { seen.add(d.id); result.push({ id: d.id, ...d.data() } as Transfer); }
      });
      setTransfers(result);
    } catch (err) {
      console.error('Error fetching transfers', err);
    }
  };

  // When target customer changes, fetch their orders
  useEffect(() => {
    if (!transferForm.targetCustomerId) { setTargetCustomerOrders([]); return; }
    setLoadingTargetOrders(true);
    getDocs(collection(db, 'CustomerSheets', transferForm.targetCustomerId, 'orders'))
      .then(snap => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setTargetCustomerOrders(orders);
        // Auto-select the order with the same fabric if it exists
        const match = orders.find((o: any) =>
          (o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase()
        );
        if (match) {
          setTransferForm(prev => ({ ...prev, targetOrderId: (match as any).id }));
        } else {
          setTransferForm(prev => ({ ...prev, targetOrderId: '' }));
        }
      })
      .catch(() => setTargetCustomerOrders([]))
      .finally(() => setLoadingTargetOrders(false));
  }, [transferForm.targetCustomerId]);

  const handleSaveTransfer = async () => {
    if (!transferForm.quantity || !transferForm.targetCustomerId || !transferForm.targetOrderId) return;
    setSavingTransfer(true);
    try {
      const targetCustomer = allCustomers.find(c => c.id === transferForm.targetCustomerId);
      const targetOrder = targetCustomerOrders.find((o: any) => o.id === transferForm.targetOrderId);
      await addDoc(collection(db, 'productionTransfers'), {
        fromOrderId: order.id,
        fromCustomerId: currentCustomerId,
        fromCustomerName: clientName,
        fromFabric: order.material || '',
        toOrderId: transferForm.targetOrderId,
        toCustomerId: transferForm.targetCustomerId,
        toCustomerName: targetCustomer?.name || '',
        toFabric: (targetOrder as any)?.material || '',
        quantity: Number(transferForm.quantity),
        date: transferForm.date,
        note: transferForm.note,
        createdBy: userName,
        createdAt: serverTimestamp(),
      });
      setShowTransferForm(false);
      setTransferForm({
        quantity: '',
        targetSeasonId: seasonId || '',
        targetCustomerId: '',
        targetOrderId: '',
        date: new Date().toISOString().split('T')[0],
        note: '',
      });
      setTargetCustomerOrders([]);
      await fetchTransfers();
    } catch (err) {
      console.error('Error saving transfer', err);
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleDeleteTransfer = async (transferId: string) => {
    if (!window.confirm('Delete this transfer? The production numbers will revert.')) return;
    try {
      await deleteDoc(doc(db, 'productionTransfers', transferId));
      await fetchTransfers();
    } catch (err) {
      console.error('Error deleting transfer', err);
    }
  };

  // Net produced = raw logs - outgoing transfers + incoming transfers
  const outgoingTotal = transfers.filter(t => t.fromOrderId === order.id).reduce((s, t) => s + t.quantity, 0);
  const incomingTotal = transfers.filter(t => t.toOrderId === order.id).reduce((s, t) => s + t.quantity, 0);
  const netProduced = totalProduction - outgoingTotal + incomingTotal;

  // Customers filtered by selected target season
  const filteredTargetCustomers = useMemo(() => {
    if (!transferForm.targetSeasonId) return allCustomers.filter(c => c.id !== currentCustomerId);
    return allCustomers.filter(c => c.createdSeasonId === transferForm.targetSeasonId && c.id !== currentCustomerId);
  }, [transferForm.targetSeasonId, allCustomers, currentCustomerId]);

  // Does the selected target customer have this fabric in their orders?
  const fabricMatch = useMemo(() => {
    if (!transferForm.targetCustomerId || targetCustomerOrders.length === 0) return null;
    return targetCustomerOrders.find((o: any) =>
      (o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase()
    ) || null;
  }, [transferForm.targetCustomerId, targetCustomerOrders, order.material]);

  const fetchLogs = async () => {
    setLoading(true);
    const debug: string[] = [];
    const isReOrder = forceOrderIdOnly || !!order.reorderOfId;
    if (isReOrder) {
      debug.push(`[ReOrder] Searching by Order ID only: "${order.id}"`);
    } else {
      debug.push(`Searching for Client: "${clientName}"`);
      debug.push(`Searching for Fabric: "${order.material}"`);
    }
    debug.push(`Total Machines Scanned: ${machines.length}`);
    if (seasonId) debug.push(`Season Filter: "${seasonName || seasonId}"`);

    try {
      const logsData: ProductionLog[] = [];
      const crossSeasonLogsData: ProductionLog[] = [];
      const legacyLogsData: ProductionLog[] = [];
      const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
      const targetClient = normalize(clientName);
      const targetFabric = normalize(order.material);

      const logSeasonMatches = (logClientSeason: string | undefined) => {
        if (!seasonId && !seasonName) return true;
        if (!logClientSeason) return false;
        return logClientSeason === seasonId || logClientSeason === seasonName;
      };

      const machineEntries: Array<{ id: string; name: string }> = machines.map((m: any) => ({
        id: String(m.firestoreId || m.id || ''),
        name: m.name || m.machineName || String(m.id || '')
      })).filter(m => m.id);

      const allSubDocs = await Promise.all(
        machineEntries.map(m =>
          getDocs(collection(db, 'MachineSS', m.id, 'dailyLogs'))
            .then(snap => snap.docs.map(d => ({ data: d.data(), machineName: m.name, docId: d.id })))
            .catch(() => [])
        )
      );

      allSubDocs.flat().forEach(({ data: log, machineName, docId }) => {
        const logClient = normalize(log.client);
        const logFabric = normalize(log.fabric);
        const hasOrderId = !!log.orderId;
        const isOrderIdMatch = log.orderId === order.id;
        const isLegacyMatch = !isReOrder && !hasOrderId
          && ((logClient === targetClient && logFabric === targetFabric) ||
              (log.client === clientName && log.fabric === order.material));

        if (isReOrder ? isOrderIdMatch : (isOrderIdMatch || isLegacyMatch)) {
          const entry: ProductionLog = {
            id: `${machineName}-${log.date}-${docId}`,
            date: log.date,
            machineName,
            dayProduction: Number(log.dayProduction) || 0,
            remaining: Number(log.remainingMfg) || 0,
            scrap: Number(log.scrap) || 0,
            reason: log.note || '',
            isExternal: false,
            logSeason: log.clientSeason || undefined
          };
          if (isLegacyMatch) {
            legacyLogsData.push(entry);
          } else if (logSeasonMatches(log.clientSeason)) {
            logsData.push(entry);
          } else {
            crossSeasonLogsData.push(entry);
          }
        }

        ((log.extraSessions || []) as any[]).forEach((session: any, sIdx: number) => {
          const sessionClient = normalize(session.client || '');
          const sessionFabric = normalize(session.fabric || '');
          const sessionHasOrderId = !!session.orderId;
          const sessionIsOrderIdMatch = session.orderId === order.id;
          const sessionIsLegacy = !isReOrder && !sessionHasOrderId
            && ((sessionClient === targetClient && sessionFabric === targetFabric) ||
                (session.client === clientName && session.fabric === order.material));
          if (sessionIsOrderIdMatch || sessionIsLegacy) {
            const sessionEntry: ProductionLog = {
              id: `${machineName}-${log.date}-${docId}-s${sIdx}`,
              date: log.date,
              machineName,
              dayProduction: Number(session.dayProduction) || 0,
              remaining: Number(session.remainingMfg) || 0,
              scrap: 0,
              reason: '',
              isExternal: false,
              logSeason: session.clientSeason || log.clientSeason || undefined
            };
            if (sessionIsLegacy) {
              legacyLogsData.push(sessionEntry);
            } else if (logSeasonMatches(session.clientSeason || log.clientSeason)) {
              logsData.push(sessionEntry);
            } else {
              crossSeasonLogsData.push(sessionEntry);
            }
          }
        });
      });

      const totalScanned = allSubDocs.reduce((sum, arr) => sum + arr.length, 0);
      debug.push(`Sub-collections scanned: ${totalScanned} logs across ${machineEntries.length} machines, ${logsData.length} matched.`);

      try {
        const extQuery = isReOrder
          ? query(collection(db, 'externalProduction'), where('orderId', '==', order.id))
          : query(collection(db, 'externalProduction'), where('client', '==', clientName));
        const extDocs = await getDocs(extQuery);
        extDocs.forEach(doc => {
          const data = doc.data();
          if (isReOrder || normalize(data.fabric) === targetFabric) {
            const entry: ProductionLog = {
              id: doc.id,
              date: data.date,
              machineName: data.factory || 'External',
              dayProduction: Number(data.receivedQty) || 0,
              remaining: Number(data.remainingQty) || 0,
              scrap: Number(data.scrap) || Number(data.scrapQty) || 0,
              reason: data.notes || '',
              isExternal: true,
              logSeason: data.clientSeason || undefined
            };
            const extSeasonOk = !data.clientSeason || logSeasonMatches(data.clientSeason);
            if (extSeasonOk) logsData.push(entry);
            else crossSeasonLogsData.push(entry);
          }
        });
        debug.push(`Found ${extDocs.size} external records.`);
      } catch (err) {
        debug.push("Error fetching external logs: " + err);
      }

      if (crossSeasonLogsData.length > 0) {
        const seasonMap = new Map<string, { machines: Set<string>; totalProduced: number; count: number; dates: string[] }>();
        crossSeasonLogsData.forEach(log => {
          const label = log.logSeason || '2025 Summer Season';
          if (!seasonMap.has(label)) seasonMap.set(label, { machines: new Set(), totalProduced: 0, count: 0, dates: [] });
          const entry = seasonMap.get(label)!;
          entry.machines.add(log.machineName);
          entry.totalProduced += log.dayProduction;
          entry.count++;
          entry.dates.push(log.date);
        });
        const crossInfo: CrossSeasonInfo[] = [];
        seasonMap.forEach((val, key) => {
          const sorted = val.dates.sort();
          crossInfo.push({
            seasonLabel: key,
            machines: Array.from(val.machines),
            totalProduced: val.totalProduced,
            logCount: val.count,
            dateRange: sorted.length > 1 ? `${formatDate(sorted[0])} – ${formatDate(sorted[sorted.length - 1])}` : formatDate(sorted[0])
          });
        });
        setCrossSeasonInfo(crossInfo);
        setCrossSeasonLogs(crossSeasonLogsData);
      } else {
        setCrossSeasonInfo([]);
        setCrossSeasonLogs([]);
      }

      logsData.sort((a, b) => b.date.localeCompare(a.date));
      legacyLogsData.sort((a, b) => b.date.localeCompare(a.date));
      setLogs(logsData);
      setLegacyLogs(legacyLogsData);
      setTotalProduction(logsData.reduce((sum, log) => sum + log.dayProduction, 0));
      setDebugInfo(debug);
    } catch (error) {
      console.error("Error fetching production history:", error);
      setDebugInfo([`Error: ${error}`]);
    } finally {
      setLoading(false);
    }
  };

  const groupedByMachine = useMemo(() => {
    if (logs.length === 0) return new Map<string, ProductionLog[]>();
    const map = new Map<string, ProductionLog[]>();
    logs.forEach(log => {
      if (!map.has(log.machineName)) map.set(log.machineName, []);
      map.get(log.machineName)!.push(log);
    });
    map.forEach(arr => arr.sort((a, b) => b.date.localeCompare(a.date)));
    return new Map([...map.entries()].sort(([, a], [, b]) =>
      b.reduce((s, l) => s + l.dayProduction, 0) - a.reduce((s, l) => s + l.dayProduction, 0)
    ));
  }, [logs]);

  const crossSeasonByMachine = useMemo(() => {
    const map = new Map<string, Map<string, ProductionLog[]>>();
    crossSeasonLogs.forEach(log => {
      const seasonKey = log.logSeason || '2025 Summer Season';
      if (!map.has(seasonKey)) map.set(seasonKey, new Map());
      const machineMap = map.get(seasonKey)!;
      if (!machineMap.has(log.machineName)) machineMap.set(log.machineName, []);
      machineMap.get(log.machineName)!.push(log);
    });
    map.forEach(mm => mm.forEach(arr => arr.sort((a, b) => b.date.localeCompare(a.date))));
    return map;
  }, [crossSeasonLogs]);

  const toggleCrossSeason = (label: string) => {
    setExpandedCrossSeasons(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const lastWorkingInfo = useMemo(() => {
    if (logs.length === 0) return null;
    return { date: formatDate(logs[0].date), remaining: logs[0].remaining };
  }, [logs]);

  const insights = useMemo(() => {
    if (logs.length < 2) return [];
    const results: Insight[] = [];
    const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const avgProd = sortedLogs.reduce((sum, l) => sum + l.dayProduction, 0) / sortedLogs.length;
    for (let i = 1; i < sortedLogs.length; i++) {
      const diffDays = Math.ceil(Math.abs(new Date(sortedLogs[i].date).getTime() - new Date(sortedLogs[i-1].date).getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 2) results.push({ type: 'gap', message: `Production stopped for ${diffDays - 1} days`, date: `${sortedLogs[i-1].date} to ${sortedLogs[i].date}`, details: 'Potential machine downtime or material shortage' });
    }
    sortedLogs.forEach(log => {
      if (log.dayProduction < avgProd * 0.6 && log.dayProduction > 0) results.push({ type: 'low_production', message: 'Low Production Detected', date: log.date, details: `${log.dayProduction}kg (Avg: ${Math.round(avgProd)}kg)` });
      if (log.scrap > 20) results.push({ type: 'high_scrap', message: 'High Scrap Event', date: log.date, details: `${log.scrap}kg scrap recorded` });
    });
    if (results.length === 0) results.push({ type: 'good', message: 'Smooth Production Run', details: 'No significant gaps or issues detected' });
    return results;
  }, [logs]);

  const narrative = useMemo(() => {
    if (logs.length === 0) return null;
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = insights.filter(i => i.type === 'gap');
    const low = insights.filter(i => i.type === 'low_production');
    const scrap = insights.filter(i => i.type === 'high_scrap');
    let text = `Production started on ${sorted[0].date} and last ran on ${sorted[sorted.length - 1].date}. `;
    if (gaps.length > 0) text += `It faced ${gaps.length} stoppages. `;
    else text += `It ran consistently without major interruptions. `;
    if (low.length > 0 && scrap.length > 0) text += `It struggled with both low production (${low.length} days) and high scrap (${scrap.length} days). `;
    else if (low.length > 0) text += `There were ${low.length} days where production dropped significantly. `;
    else if (scrap.length > 0) text += `Scrap levels were high on ${scrap.length} occasions. `;
    else text += `Performance was generally stable.`;
    return text;
  }, [logs, insights]);

  if (!isOpen) return null;

  const machineCount = groupedByMachine.size;
  const isMultiMachine = machineCount > 1;
  const machineColors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500'];
  const machineList = Array.from(groupedByMachine.keys());

  const SeasonBadge = ({ label }: { label: string }) => (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
      {label === 'Unknown Season' ? '2025 Summer Season' : label}
    </span>
  );

  const MachineGroupedTable = ({ logsMap }: { logsMap: Map<string, ProductionLog[]> }) => (
    <div className="space-y-4">
      {Array.from(logsMap.entries()).map(([machineName, machineLogs], machineIdx) => {
        const machTotal = machineLogs.reduce((s, l) => s + l.dayProduction, 0);
        const isExt = machineLogs[0]?.isExternal;
        const colorClass = isExt ? 'bg-blue-500' : machineColors[machineIdx % machineColors.length];
        const dateRange = machineLogs.length > 1
          ? `${formatDate(machineLogs[machineLogs.length - 1].date)} – ${formatDate(machineLogs[0].date)}`
          : formatDate(machineLogs[0].date);
        return (
          <div key={machineName} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorClass}`} />
                <div>
                  <div className="flex items-center gap-2">
                    {isExt ? (
                      <span className="flex items-center gap-1.5 text-sm font-bold text-blue-700"><Globe className="w-3.5 h-3.5" /> {machineName}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><Factory className="w-3.5 h-3.5 text-slate-500" /> {machineName}</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono">{dateRange} · {machineLogs.length} day{machineLogs.length !== 1 ? 's' : ''}</div>
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
                {machineLogs.map((log) => (
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

  // Transfer form UI
  const TransferForm = () => (
    <div className="border border-orange-200 rounded-xl overflow-hidden bg-orange-50/30">
      <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-orange-600" />
          <span className="text-sm font-bold text-orange-900">Transfer Production to Another Customer</span>
        </div>
        <button onClick={() => setShowTransferForm(false)} className="text-orange-400 hover:text-orange-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-3">
        {/* Step 1: Season */}
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">1. Target Season</label>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
            value={transferForm.targetSeasonId}
            onChange={e => setTransferForm(prev => ({ ...prev, targetSeasonId: e.target.value, targetCustomerId: '', targetOrderId: '' }))}
          >
            <option value="">All seasons</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Step 2: Customer */}
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">2. Target Customer</label>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
            value={transferForm.targetCustomerId}
            onChange={e => setTransferForm(prev => ({ ...prev, targetCustomerId: e.target.value, targetOrderId: '' }))}
          >
            <option value="">Select customer...</option>
            {filteredTargetCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Fabric match indicator */}
        {transferForm.targetCustomerId && !loadingTargetOrders && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${fabricMatch ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            {fabricMatch ? (
              <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> Fabric <strong>"{order.material}"</strong> found in this customer's orders — production will be added to it.</>
            ) : (
              <><AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" /> Fabric <strong>"{order.material}"</strong> not found in this customer's orders. Select the order to transfer to manually.</>
            )}
          </div>
        )}

        {/* Step 3: Order */}
        {transferForm.targetCustomerId && (
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">3. Target Order</label>
            {loadingTargetOrders ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading orders...</div>
            ) : (
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                value={transferForm.targetOrderId}
                onChange={e => setTransferForm(prev => ({ ...prev, targetOrderId: e.target.value }))}
              >
                <option value="">Select order...</option>
                {targetCustomerOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.material || 'Unknown fabric'}{o.requiredQty ? ` · ${Number(o.requiredQty).toLocaleString()} kg` : ''}
                    {(o.material || '').trim().toLowerCase() === (order.material || '').trim().toLowerCase() ? ' ✓ Same fabric' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Quantity + Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">Quantity (kg)</label>
            <input
              type="number"
              min="1"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
              placeholder="e.g. 3000"
              value={transferForm.quantity}
              onChange={e => setTransferForm(prev => ({ ...prev, quantity: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">Date</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
              value={transferForm.date}
              onChange={e => setTransferForm(prev => ({ ...prev, date: e.target.value }))}
            />
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1">Note (optional)</label>
          <input
            type="text"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
            placeholder="Reason for transfer..."
            value={transferForm.note}
            onChange={e => setTransferForm(prev => ({ ...prev, note: e.target.value }))}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setShowTransferForm(false)} className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button
            onClick={handleSaveTransfer}
            disabled={savingTransfer || !transferForm.quantity || !transferForm.targetCustomerId || !transferForm.targetOrderId}
            className="px-4 py-2 text-sm font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {savingTransfer ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><ArrowRightLeft className="w-4 h-4" /> Confirm Transfer</>}
          </button>
        </div>
      </div>
    </div>
  );

  // Transfers display section
  const TransfersSection = () => {
    if (transfers.length === 0) return null;
    const outgoing = transfers.filter(t => t.fromOrderId === order.id);
    const incoming = transfers.filter(t => t.toOrderId === order.id);
    return (
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-bold text-slate-700">Production Transfers</span>
        </div>
        <div className="divide-y divide-slate-100">
          {outgoing.map(t => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-red-50/40 hover:bg-red-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-3 h-3 text-red-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-red-700">
                    → Transfer to {t.toCustomerName}
                    {t.toFabric && t.toFabric !== order.material && <span className="text-red-500 font-normal ml-1">({t.toFabric})</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}{t.createdBy ? ` · by ${t.createdBy}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                <span className="font-mono font-bold text-red-600 text-sm">−{t.quantity.toLocaleString()} kg</span>
                {canTransfer && (
                  <button onClick={() => handleDeleteTransfer(t.id)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors" title="Delete transfer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {incoming.map(t => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <ArrowLeft className="w-3 h-3 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-emerald-700">
                    ← Transfer from {t.fromCustomerName}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}{t.createdBy ? ` · by ${t.createdBy}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                <span className="font-mono font-bold text-emerald-600 text-sm">+{t.quantity.toLocaleString()} kg</span>
                {canTransfer && (
                  <button onClick={() => handleDeleteTransfer(t.id)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors" title="Delete transfer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

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
              {(seasonName || seasonId) && (
                <><span className="text-slate-300">·</span><SeasonBadge label={seasonName || seasonId || ''} /></>
              )}
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
              <p className="text-sm">Scanning production data...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-6 space-y-4">
              {crossSeasonInfo.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <History className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-800">Not produced in the current season</div>
                      <div className="text-xs text-slate-500 mt-0.5">Found production records from a different season — expand below to view details.</div>
                    </div>
                  </div>
                  {crossSeasonInfo.map((info, idx) => {
                    const label = info.seasonLabel === 'Unknown Season' ? '2025 Summer Season' : info.seasonLabel;
                    const isExpanded = expandedCrossSeasons.has(info.seasonLabel);
                    const machineMapForSeason = crossSeasonByMachine.get(info.seasonLabel) || new Map();
                    return (
                      <div key={idx} className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 flex-wrap">
                            <SeasonBadge label={label} />
                            <span className="text-sm font-bold text-amber-900">{info.totalProduced.toLocaleString()} kg total</span>
                          </div>
                          <button onClick={() => toggleCrossSeason(info.seasonLabel)} className="ml-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-lg transition-colors">
                            {isExpanded ? 'Hide' : 'View Details'} <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                          </button>
                        </div>
                        {isExpanded && <div className="p-4 bg-white border-t border-amber-100"><MachineGroupedTable logsMap={machineMapForSeason} /></div>}
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

              {/* Transfers even with no logs */}
              {transfers.length > 0 && (
                <div className="mt-4"><TransfersSection /></div>
              )}

              <div className="mt-2">
                <button onClick={() => setShowDebug(p => !p)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
                  <Bug size={11} /> {showDebug ? 'Hide' : 'Show'} debug info
                </button>
                {showDebug && (
                  <div className="mt-2 bg-slate-100 border border-slate-200 p-3 rounded-lg text-[10px] font-mono text-slate-500 space-y-0.5">
                    {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl p-4">
                  <div className="text-xs text-blue-600 font-semibold uppercase tracking-wider mb-1">Total Produced</div>
                  <div className="text-2xl font-bold text-blue-900">
                    {netProduced.toLocaleString()}
                    <span className="text-sm font-normal text-blue-500 ml-1">kg</span>
                  </div>
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

                <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 border border-violet-200 rounded-xl p-4">
                  <div className="text-xs text-violet-600 font-semibold uppercase tracking-wider mb-1">Last Active</div>
                  <div className="text-2xl font-bold text-violet-900">{lastWorkingInfo?.date || '—'}</div>
                  <div className="text-xs text-violet-600/70 mt-1">
                    {lastWorkingInfo?.remaining != null ? `${lastWorkingInfo.remaining.toLocaleString()} kg remaining` : ' '}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200 rounded-xl p-4">
                  <div className="text-xs text-emerald-600 font-semibold uppercase tracking-wider mb-1">Avg / Day</div>
                  <div className="text-2xl font-bold text-emerald-900">
                    {Math.round(totalProduction / logs.length).toLocaleString()}
                    <span className="text-sm font-normal text-emerald-500 ml-1">kg</span>
                  </div>
                  {isMultiMachine && <div className="text-xs text-emerald-600/70 mt-1">{machineCount} machines</div>}
                </div>
              </div>

              {/* Machine chips */}
              {isMultiMachine && (
                <div className="flex flex-wrap gap-2">
                  {machineList.map((name, idx) => {
                    const mLogs = groupedByMachine.get(name)!;
                    const mTotal = mLogs.reduce((s, l) => s + l.dayProduction, 0);
                    const colorClass = mLogs[0]?.isExternal ? 'border-blue-200 bg-blue-50 text-blue-700' :
                      ['border-blue-200 bg-blue-50 text-blue-700', 'border-violet-200 bg-violet-50 text-violet-700', 'border-emerald-200 bg-emerald-50 text-emerald-700', 'border-amber-200 bg-amber-50 text-amber-700', 'border-rose-200 bg-rose-50 text-rose-700', 'border-cyan-200 bg-cyan-50 text-cyan-700'][idx % 6];
                    return (
                      <div key={name} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${colorClass}`}>
                        <span className={`w-2 h-2 rounded-full ${machineColors[idx % machineColors.length]}`} />
                        {name} · {mTotal.toLocaleString()} kg
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legacy logs */}
              {legacyLogs.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-slate-600">Legacy match found</span>
                      <span className="text-xs text-slate-400">— {legacyLogs.reduce((s, l) => s + l.dayProduction, 0).toLocaleString()} kg (not counted)</span>
                    </div>
                    <button onClick={() => setShowLegacy(p => !p)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">
                      {showLegacy ? 'Hide' : 'View Details'}
                    </button>
                  </div>
                  {showLegacy && (
                    <div className="p-4 bg-white border-t border-slate-100">
                      <MachineGroupedTable logsMap={(() => {
                        const m = new Map<string, ProductionLog[]>();
                        legacyLogs.forEach(l => { if (!m.has(l.machineName)) m.set(l.machineName, []); m.get(l.machineName)!.push(l); });
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
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
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
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Factory className="w-4 h-4 text-slate-400" />
                  Production Logs{isMultiMachine ? ` · ${machineCount} Machines` : ''}
                </h3>
                <MachineGroupedTable logsMap={groupedByMachine} />
              </div>

              {/* Transfers */}
              <TransfersSection />

              {/* Transfer form */}
              {showTransferForm && canTransfer && <TransferForm />}

              {/* Insights */}
              {insights.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button onClick={() => setShowInsights(p => !p)} className="w-full px-4 py-3 bg-slate-50 flex items-center justify-between hover:bg-slate-100 transition-colors text-left">
                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      Production Insights
                      <span className="text-xs font-normal text-slate-400">({insights.length} observation{insights.length !== 1 ? 's' : ''})</span>
                    </span>
                    <span className={`text-slate-400 transition-transform duration-200 ${showInsights ? 'rotate-180' : ''}`}>▼</span>
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
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transfer Production
              </button>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
