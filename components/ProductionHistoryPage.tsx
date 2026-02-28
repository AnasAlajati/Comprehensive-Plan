import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calendar, Trash2, BarChart3, Factory, ChevronDown, ChevronUp, Download, RefreshCw, X, Info, FileText, ArrowLeft, AlertTriangle, TrendingUp, Package, BarChart2, LayoutGrid, List, ShoppingCart, Users, Edit2, Check } from 'lucide-react';
import { MachineRow, Season } from '../types';
import { collection, getDocs, query, where, documentId, addDoc, serverTimestamp, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DataService } from '../services/dataService';

interface ProductionHistoryPageProps {
  machines: MachineRow[];
  userRole?: 'admin' | 'schedule_editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | 'daily_planner' | null;
}

interface ExternalEntry {
  id: string;
  date: string;
  factory: string;
  client: string;
  fabric: string;
  receivedQty: number;
}

interface FabricPurchase {
  id: string;
  name: string;
  type: 'kham' | 'jahez';
  purchaseDate: string;
  quantity: number;
  timestamp: any;
}

export const ProductionHistoryPage: React.FC<ProductionHistoryPageProps> = ({ machines, userRole }) => {
  const canEditFabric = userRole === 'admin' || userRole === 'daily_planner';
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 6);
  
  const [startDate, setStartDate] = useState<string>(lastWeek.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(today.toISOString().split('T')[0]);
  const [externalEntries, setExternalEntries] = useState<ExternalEntry[]>([]);
  const [dailySummaries, setDailySummaries] = useState<Record<string, { hallScrap?: number; labScrap?: number }>>({});
  const [loading, setLoading] = useState(false);
  const [showExternalDetails, setShowExternalDetails] = useState(false);
  const [showScrapDetails, setShowScrapDetails] = useState(false);
  const [view, setView] = useState<'main' | 'scrap' | 'production' | 'fabric' | 'workers' | 'clients'>('main');
  const [scrapYear, setScrapYear] = useState<string>(new Date().getFullYear().toString());
  // ─── Client Orders State ───
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [clientOrdersLoading, setClientOrdersLoading] = useState(false);
  interface ClientOrderSummary {
    clientId: string;
    clientCode: string;
    realName: string;
    orderDates: string[];
    totalRequired: number;
    totalManufactured: number;
    totalRemaining: number;
    totalDeliveries: number;
    deliveryRemaining: number;
  }
  const [clientOrderRows, setClientOrderRows] = useState<ClientOrderSummary[]>([]);
  const [clientRealNames, setClientRealNames] = useState<Record<string, string>>({});
  const [editingRealNameId, setEditingRealNameId] = useState<string | null>(null);
  const [editingRealNameValue, setEditingRealNameValue] = useState<string>('');
  const [workerScrapPeriod, setWorkerScrapPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [workerScrapYear, setWorkerScrapYear] = useState<string>(new Date().getFullYear().toString());
  const [workerScrapMonth, setWorkerScrapMonth] = useState<string>(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [prodYear, setProdYear] = useState<string>(new Date().getFullYear().toString());
  const [deliveryOverrides, setDeliveryOverrides] = useState<Record<string, number>>({});
  const [editingDeliveryMonth, setEditingDeliveryMonth] = useState<string | null>(null);
  const [editingDeliveryValue, setEditingDeliveryValue] = useState<string>('');
  const [prodDeliveries, setProdDeliveries] = useState<{ date: string; qty: number }[]>([]);
  const [prodYearLoading, setProdYearLoading] = useState(false);
  const [scrapDailySummaries, setScrapDailySummaries] = useState<Record<string, { hallScrap?: number; labScrap?: number }>>({});
  const [excludedDays, setExcludedDays] = useState<Set<string>>(new Set());
  const [showDaySelector, setShowDaySelector] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [fabricPurchases, setFabricPurchases] = useState<FabricPurchase[]>([]);
  const [fabricLoading, setFabricLoading] = useState(false);
  const [showFabricModal, setShowFabricModal] = useState(false);
  const [fabricYear, setFabricYear] = useState<string>(new Date().getFullYear().toString());
  const [fabricForm, setFabricForm] = useState({ name: '', type: 'kham' as 'kham' | 'jahez', purchaseDate: new Date().toISOString().split('T')[0], quantity: 0 });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch External Entries
        const qExternal = query(collection(db, 'externalProduction'));
        const snapshotExternal = await getDocs(qExternal);
        const entries: ExternalEntry[] = [];
        snapshotExternal.forEach(doc => {
          const data = doc.data();
          entries.push({
            id: doc.id,
            date: data.date,
            factory: data.factory,
            client: data.client,
            fabric: data.fabric,
            receivedQty: Number(data.receivedQty) || 0
          });
        });
        setExternalEntries(entries);

        // Fetch Daily Summaries for Scrap
        // We fetch a bit more range to be safe or just all relevant
        // Since where(documentId()) range queries can be tricky with string dates if not careful, 
        // asking for all might be safer if dataset small, but let's try strict range
        const qSummaries = query(
          collection(db, 'DailySummaries'), 
          where(documentId(), '>=', startDate), 
          where(documentId(), '<=', endDate)
        );
        const snapshotSummaries = await getDocs(qSummaries);
        const summaries: Record<string, { hallScrap?: number; labScrap?: number }> = {};
        snapshotSummaries.forEach(doc => {
           summaries[doc.id] = doc.data();
        });
        setDailySummaries(summaries);

      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDate]); // Re-fetch when date changes to get correct daily summaries range

  // Fetch daily summaries for the scrap year independently
  useEffect(() => {
    const fetchScrapYearSummaries = async () => {
      try {
        const yearStart = `${scrapYear}-01-01`;
        const yearEnd = `${scrapYear}-12-31`;
        const q = query(
          collection(db, 'DailySummaries'),
          where(documentId(), '>=', yearStart),
          where(documentId(), '<=', yearEnd)
        );
        const snap = await getDocs(q);
        const summaries: Record<string, { hallScrap?: number; labScrap?: number }> = {};
        snap.forEach(doc => { summaries[doc.id] = doc.data(); });
        setScrapDailySummaries(summaries);
      } catch (e) {
        console.error('Error fetching scrap year summaries:', e);
      }
    };
    fetchScrapYearSummaries();
  }, [scrapYear]);

  // Fetch delivery overrides for selected year
  useEffect(() => {
    // Fetch seasons once
    const fetchSeasons = async () => {
      try {
        const snap = await getDocs(collection(db, 'Seasons'));
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as Season));
        setSeasons(loaded);
        const active = loaded.find(s => s.isActive);
        if (active) setSelectedSeasonId(active.id);
        else if (loaded.length > 0) setSelectedSeasonId(loaded[0].id);
      } catch (e) { console.error('Error fetching seasons:', e); }
    };
    fetchSeasons();
    // Fetch real names
    const fetchRealNames = async () => {
      try {
        const snap = await getDocs(collection(db, 'ClientRealNames'));
        const map: Record<string, string> = {};
        snap.forEach(d => { map[d.id] = d.data().name || ''; });
        setClientRealNames(map);
      } catch (e) { console.error('Error fetching real names:', e); }
    };
    fetchRealNames();
  }, []);

  // Fetch client orders when season changes
  useEffect(() => {
    if (!selectedSeasonId) return;
    const fetchClientOrders = async () => {
      setClientOrdersLoading(true);
      try {
        const customersSnap = await getDocs(collection(db, 'CustomerSheets'));
        const clientMap: Record<string, { clientId: string; clientCode: string; orderDates: string[]; totalRequired: number; totalManufactured: number; totalRemaining: number; totalDeliveries: number }> = {};
        await Promise.all(customersSnap.docs.map(async (customerDoc) => {
          const customerData = customerDoc.data();
          const clientCode = customerData.name || customerData.shortName || customerDoc.id;
          const ordersSnap = await getDocs(collection(db, 'CustomerSheets', customerDoc.id, 'orders'));
          ordersSnap.docs.forEach(orderDoc => {
            const o = orderDoc.data();
            const orderSeasonId = o.seasonId || '';
            const orderSeasonName = o.seasonName || '';
            const selectedSeason = seasons.find(s => s.id === selectedSeasonId);
            const matchesSeason = orderSeasonId === selectedSeasonId ||
              (selectedSeason && orderSeasonName === selectedSeason.name);
            if (!matchesSeason) return;
            const cid = customerDoc.id;
            if (!clientMap[cid]) clientMap[cid] = { clientId: cid, clientCode, orderDates: [], totalRequired: 0, totalManufactured: 0, totalRemaining: 0, totalDeliveries: 0 };
            if (o.orderReceiptDate) clientMap[cid].orderDates.push(o.orderReceiptDate);
            clientMap[cid].totalRequired += Number(o.requiredQty) || 0;
            clientMap[cid].totalManufactured += Number(o.manufacturedQty) || 0;
            clientMap[cid].totalRemaining += Number(o.remainingQty) || 0;
            // Sum delivery events from dyeingPlan batches
            let deliveries = Number(o.batchDeliveries) || 0;
            (o.dyeingPlan || []).forEach((batch: any) => {
              (batch.deliveryEvents || []).forEach((ev: any) => {
                deliveries += Number(ev.quantityColorDelivered) || 0;
              });
            });
            clientMap[cid].totalDeliveries += deliveries;
          });
        }));
        const rows = Object.values(clientMap)
          .map(r => ({ ...r, deliveryRemaining: Math.max(0, r.totalRequired - r.totalDeliveries) }))
          .sort((a, b) => b.totalRequired - a.totalRequired);
        setClientOrderRows(rows);
      } catch (e) { console.error('Error fetching client orders:', e); }
      finally { setClientOrdersLoading(false); }
    };
    fetchClientOrders();
  }, [selectedSeasonId, seasons]);

  const handleSaveRealName = async (clientId: string, name: string) => {
    try {
      await setDoc(doc(db, 'ClientRealNames', clientId), { name, updatedAt: new Date().toISOString() });
      setClientRealNames(prev => ({ ...prev, [clientId]: name }));
    } catch (e) { console.error('Error saving real name:', e); }
    setEditingRealNameId(null);
  };

  // Fetch delivery overrides for selected year
  useEffect(() => {
    const fetchOverrides = async () => {
      try {
        const snap = await getDocs(collection(db, 'DeliveryOverrides'));
        const overrides: Record<string, number> = {};
        snap.forEach(d => {
          if (d.id.startsWith(prodYear)) overrides[d.id] = d.data().amount;
        });
        setDeliveryOverrides(overrides);
      } catch (e) { console.error('Error fetching delivery overrides:', e); }
    };
    fetchOverrides();
  }, [prodYear]);

  const handleSaveDeliveryOverride = async (month: string, value: string) => {
    const num = parseFloat(value);
    if (value.trim() === '' || isNaN(num)) {
      // Clear override — revert to auto
      try { await deleteDoc(doc(db, 'DeliveryOverrides', month)); } catch {}
      setDeliveryOverrides(prev => { const n = { ...prev }; delete n[month]; return n; });
    } else {
      try { await setDoc(doc(db, 'DeliveryOverrides', month), { amount: num, updatedAt: new Date().toISOString() }); } catch {}
      setDeliveryOverrides(prev => ({ ...prev, [month]: num }));
    }
    setEditingDeliveryMonth(null);
  };

  // Fetch all customer deliveries for the selected prodYear
  useEffect(() => {
    const fetchProdDeliveries = async () => {
      setProdYearLoading(true);
      try {
        const yearStart = `${prodYear}-01-01`;
        const yearEnd = `${prodYear}-12-31`;
        const customersSnap = await getDocs(collection(db, 'CustomerSheets'));
        const allDeliveries: { date: string; qty: number }[] = [];
        await Promise.all(customersSnap.docs.map(async (customerDoc) => {
          const ordersSnap = await getDocs(collection(db, 'CustomerSheets', customerDoc.id, 'orders'));
          ordersSnap.docs.forEach(orderDoc => {
            const data = orderDoc.data();
            (data.dyeingPlan || []).forEach((batch: any) => {
              (batch.deliveryEvents || []).forEach((ev: any) => {
                if (ev.date >= yearStart && ev.date <= yearEnd) {
                  allDeliveries.push({ date: ev.date, qty: Number(ev.quantityColorDelivered) || 0 });
                }
              });
            });
          });
        }));
        setProdDeliveries(allDeliveries);
      } catch (e) {
        console.error('Error fetching production year deliveries:', e);
      } finally {
        setProdYearLoading(false);
      }
    };
    fetchProdDeliveries();
  }, [prodYear]);

  // Fetch fabric purchases for the selected year
  useEffect(() => {
    const fetchFabricPurchases = async () => {
      setFabricLoading(true);
      try {
        const yearStart = `${fabricYear}-01-01`;
        const yearEnd = `${fabricYear}-12-31`;
        const q = query(
          collection(db, 'FabricPurchases'),
          where('purchaseDate', '>=', yearStart),
          where('purchaseDate', '<=', yearEnd)
        );
        const snap = await getDocs(q);
        const purchases: FabricPurchase[] = [];
        snap.forEach(doc => {
          const data = doc.data();
          purchases.push({
            id: doc.id,
            name: data.name,
            type: data.type,
            purchaseDate: data.purchaseDate,
            quantity: Number(data.quantity) || 0,
            timestamp: data.timestamp
          });
        });
        setFabricPurchases(purchases);
      } catch (e) {
        console.error('Error fetching fabric purchases:', e);
      } finally {
        setFabricLoading(false);
      }
    };
    fetchFabricPurchases();
  }, [fabricYear]);

  const autoDetectOffDays = () => {
    const newExcluded = new Set<string>();
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      let dayTotal = 0;
      
      machines.forEach(machine => {
        const logs = machine.dailyLogs || [];
        logs.forEach(log => {
          if (log.date === dateStr) {
            dayTotal += Number(log.dayProduction) || 0;
          }
        });
      });
      
      if (dayTotal === 0) {
        newExcluded.add(dateStr);
      }
    }
    setExcludedDays(newExcluded);
  };

  const stats = useMemo(() => {
    let totalWide = 0;
    let totalBous = 0;
    let totalScrap = 0;
    
    const scrapReasons: Record<string, number> = {};
    const dailyStats: Record<string, { wide: number; bous: number; scrap: number; external: number }> = {};
    const dateArray: string[] = [];
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dateArray.push(dateStr);
      dailyStats[dateStr] = { wide: 0, bous: 0, scrap: 0, external: 0 };
      
      // Add daily summary scrap (Hall + Lab)
      const summary = dailySummaries[dateStr];
      if (summary) {
        if (summary.hallScrap) {
           dailyStats[dateStr].scrap += Number(summary.hallScrap);
           totalScrap += Number(summary.hallScrap);
           scrapReasons['سقط الصالة'] = (scrapReasons['سقط الصالة'] || 0) + Number(summary.hallScrap);
        }
        if (summary.labScrap) {
           dailyStats[dateStr].scrap += Number(summary.labScrap);
           totalScrap += Number(summary.labScrap);
           scrapReasons['سقط المعمل'] = (scrapReasons['سقط المعمل'] || 0) + Number(summary.labScrap);
        }
      }
    }

    machines.forEach(machine => {
      const isBous = machine.type === 'BOUS';
      const logs = machine.dailyLogs || [];
      
      logs.forEach(log => {
        if (log.date >= startDate && log.date <= endDate) {
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          const reason = log.reason || 'غير محدد';

          if (isBous) {
            totalBous += prod;
            if (dailyStats[log.date]) dailyStats[log.date].bous += prod;
          } else {
            totalWide += prod;
            if (dailyStats[log.date]) dailyStats[log.date].wide += prod;
          }

          totalScrap += scrap;
          if (dailyStats[log.date]) dailyStats[log.date].scrap += scrap;

          if (scrap > 0) {
            scrapReasons[reason] = (scrapReasons[reason] || 0) + scrap;
          }
        }
      });
    });

    const externalByFactory: Record<string, number> = {};
    let totalExternal = 0;

    externalEntries.forEach(entry => {
      if (entry.date >= startDate && entry.date <= endDate) {
        const qty = entry.receivedQty;
        externalByFactory[entry.factory] = (externalByFactory[entry.factory] || 0) + qty;
        totalExternal += qty;
        if (dailyStats[entry.date]) dailyStats[entry.date].external += qty;
      }
    });

    const workingDays = dateArray.filter(d => !excludedDays.has(d)).length || 1;
    const avgWide = totalWide / workingDays;
    const scrapPercent = totalWide > 0 ? (totalScrap / totalWide) * 100 : 0;

    return {
      totalWide,
      totalBous,
      totalExternal,
      totalScrap,
      totalInternal: totalWide + totalBous,
      grandTotal: totalWide + totalBous + totalExternal,
      avgWide,
      scrapPercent,
      workingDays,
      totalDays: dateArray.length,
      externalByFactory: Object.entries(externalByFactory).sort((a, b) => b[1] - a[1]),
      scrapReasons: Object.entries(scrapReasons).sort((a, b) => b[1] - a[1]),
      dailyData: dateArray.map(date => ({ date, ...dailyStats[date], excluded: excludedDays.has(date) }))
    };
  }, [machines, startDate, endDate, externalEntries, excludedDays, dailySummaries]);

  // ─── Monthly Scrap Report ───────────────────────────────────────────────────
  const scrapStats = useMemo(() => {
    const yearStart = `${scrapYear}-01-01`;
    const yearEnd = `${scrapYear}-12-31`;
    const monthMap: Record<string, {
      production: number;
      scrapByReason: Record<string, number>;
      workingDays: Set<string>;
    }> = {};
    const allReasons = new Set<string>();

    machines.forEach(machine => {
      if (machine.type === 'BOUS') return; // wide machines only for production base
      const logs = machine.dailyLogs || [];
      logs.forEach((log: any) => {
        if (log.date >= yearStart && log.date <= yearEnd) {
          const month = log.date.substring(0, 7);
          if (!monthMap[month]) monthMap[month] = { production: 0, scrapByReason: {}, workingDays: new Set() };
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          monthMap[month].production += prod;
          if (prod > 0) monthMap[month].workingDays.add(log.date);
          if (scrap > 0) {
            const reason = (log.reason || 'غير محدد').trim();
            allReasons.add(reason);
            monthMap[month].scrapByReason[reason] = (monthMap[month].scrapByReason[reason] || 0) + scrap;
          }
        }
      });
    });

    // Also add hall/lab scrap from daily summaries
    const yearStart2 = `${scrapYear}-01-01`;
    const yearEnd2 = `${scrapYear}-12-31`;
    Object.entries(scrapDailySummaries).forEach(([date, summary]: [string, any]) => {
      if (date >= yearStart2 && date <= yearEnd2) {
        const month = date.substring(0, 7);
        if (!monthMap[month]) monthMap[month] = { production: 0, scrapByReason: {}, workingDays: new Set() };
        if (summary.hallScrap) {
          const label = 'سقط الصالة';
          allReasons.add(label);
          monthMap[month].scrapByReason[label] = (monthMap[month].scrapByReason[label] || 0) + Number(summary.hallScrap);
        }
        if (summary.labScrap) {
          const label = 'سقط المعمل';
          allReasons.add(label);
          monthMap[month].scrapByReason[label] = (monthMap[month].scrapByReason[label] || 0) + Number(summary.labScrap);
        }
      }
    });

    const reasons = Array.from(allReasons);
    const sortedMonths = Object.keys(monthMap).sort();

    // Sort reasons by total descending
    const reasonGrandTotal: Record<string, number> = {};
    reasons.forEach(r => {
      reasonGrandTotal[r] = sortedMonths.reduce((s, m) => s + (monthMap[m].scrapByReason[r] || 0), 0);
    });
    reasons.sort((a, b) => reasonGrandTotal[b] - reasonGrandTotal[a]);

    const rows = sortedMonths.map(month => {
      const data = monthMap[month];
      const totalScrap = Object.values(data.scrapByReason).reduce((a, b) => a + b, 0);
      const d = new Date(month + '-02');
      const monthName = d.toLocaleDateString('ar-EG', { month: 'long' });
      const yearName = d.getFullYear().toString();
      return {
        month,
        monthName,
        yearName,
        production: data.production,
        totalScrap,
        scrapByReason: data.scrapByReason,
        workingDays: data.workingDays.size,
        scrapPercent: data.production > 0 ? (totalScrap / data.production) * 100 : 0,
      };
    });

    const totals = {
      production: rows.reduce((a, r) => a + r.production, 0),
      totalScrap: rows.reduce((a, r) => a + r.totalScrap, 0),
      workingDays: rows.reduce((a, r) => a + r.workingDays, 0),
      byReason: reasonGrandTotal,
    };

    return { rows, reasons, totals };
  }, [machines, scrapYear, scrapDailySummaries]);

  // ─── Worker Scrap Analytics ────────────────────────────────────────────────
  const workerStats = useMemo(() => {
    const isMonthly = workerScrapPeriod === 'monthly';
    const rangeStart = isMonthly
      ? `${workerScrapYear}-${workerScrapMonth}-01`
      : `${workerScrapYear}-01-01`;
    const rangeEnd = isMonthly
      ? (() => { const d = new Date(Number(workerScrapYear), Number(workerScrapMonth), 0); return d.toISOString().split('T')[0]; })()
      : `${workerScrapYear}-12-31`;

    const workerMap: Record<string, number> = {};
    let total = 0;

    machines.forEach(machine => {
      (machine.dailyLogs || []).forEach((log: any) => {
        if (log.date >= rangeStart && log.date <= rangeEnd) {
          const scrap = Number(log.scrap) || 0;
          if (scrap > 0 && log.workerResponsible) {
            const worker = (log.workerResponsible as string).trim();
            workerMap[worker] = (workerMap[worker] || 0) + scrap;
            total += scrap;
          }
        }
      });
    });

    const rows = Object.entries(workerMap)
      .map(([name, scrap]) => ({ name, scrap }))
      .sort((a, b) => b.scrap - a.scrap);

    return { rows, total, rangeStart, rangeEnd };
  }, [machines, workerScrapPeriod, workerScrapYear, workerScrapMonth]);

  // ─── Yearly Production & Delivery Report ──────────────────────────────────
  const prodStats = useMemo(() => {
    const yearStart = `${prodYear}-01-01`;
    const yearEnd = `${prodYear}-12-31`;

    const monthKeys = Array.from({ length: 12 }, (_, i) => `${prodYear}-${String(i + 1).padStart(2, '0')}`);

    const byMonth: Record<string, {
      wide: number; bous: number; external: number;
      scrap: number; deliveries: number; workingDays: Set<string>;
    }> = {};
    monthKeys.forEach(m => {
      byMonth[m] = { wide: 0, bous: 0, external: 0, scrap: 0, deliveries: 0, workingDays: new Set() };
    });

    // Machine production & scrap
    machines.forEach(machine => {
      (machine.dailyLogs || []).forEach((log: any) => {
        if (log.date >= yearStart && log.date <= yearEnd) {
          const m = log.date.substring(0, 7);
          if (!byMonth[m]) return;
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          if (machine.type === 'BOUS') {
            byMonth[m].bous += prod;
          } else {
            byMonth[m].wide += prod;
            if (prod > 0) byMonth[m].workingDays.add(log.date);
          }
          byMonth[m].scrap += scrap;
        }
      });
    });

    // Hall/lab scrap from daily summaries (scrapDailySummaries already covers prodYear if same year, else use separate fetch)
    // We reuse scrapDailySummaries since it covers scrapYear; if prodYear === scrapYear they match.
    // For simplicity we compute scrap from machine logs above which is the main source.

    // External production
    externalEntries.forEach(e => {
      if (e.date >= yearStart && e.date <= yearEnd) {
        const m = e.date.substring(0, 7);
        if (byMonth[m]) byMonth[m].external += e.receivedQty || 0;
      }
    });

    // Customer deliveries
    prodDeliveries.forEach(d => {
      const m = d.date.substring(0, 7);
      if (byMonth[m]) byMonth[m].deliveries += d.qty;
    });

    const rows = monthKeys.map((m, idx) => {
      const data = byMonth[m];
      const date = new Date(m + '-02');
      const monthName = date.toLocaleDateString('ar-EG', { month: 'long' });
      const totalProduction = data.wide + data.bous + data.external;
      const netProduction = data.wide + data.external; // without bous/منفعة
      return {
        month: m,
        monthName,
        idx: idx + 1,
        wide: data.wide,
        bous: data.bous,
        external: data.external,
        scrap: data.scrap,
        deliveries: data.deliveries,
        totalProduction,
        netProduction,
        workingDays: data.workingDays.size,
      };
    }).filter(r => r.totalProduction > 0 || r.deliveries > 0);

    const totals = {
      wide: rows.reduce((a, r) => a + r.wide, 0),
      bous: rows.reduce((a, r) => a + r.bous, 0),
      external: rows.reduce((a, r) => a + r.external, 0),
      scrap: rows.reduce((a, r) => a + r.scrap, 0),
      deliveries: rows.reduce((a, r) => a + r.deliveries, 0),
      totalProduction: rows.reduce((a, r) => a + r.totalProduction, 0),
      netProduction: rows.reduce((a, r) => a + r.netProduction, 0),
      workingDays: rows.reduce((a, r) => a + r.workingDays, 0),
    };

    return { rows, totals };
  }, [machines, prodYear, externalEntries, prodDeliveries]);

  // ─── Fabric Purchase Report ──────────────────────────────────────────────
  const fabricStats = useMemo(() => {
    const kham: FabricPurchase[] = [];
    const jahez: FabricPurchase[] = [];
    let khamTotal = 0;
    let jahezTotal = 0;

    fabricPurchases.forEach(fabric => {
      if (fabric.type === 'kham') {
        kham.push(fabric);
        khamTotal += fabric.quantity;
      } else {
        jahez.push(fabric);
        jahezTotal += fabric.quantity;
      }
    });

    // Sort by purchase date descending
    kham.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
    jahez.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());

    return {
      kham,
      jahez,
      totals: {
        khamTotal,
        jahezTotal,
        grandTotal: khamTotal + jahezTotal,
        khamCount: kham.length,
        jahezCount: jahez.length,
        totalCount: kham.length + jahez.length
      }
    };
  }, [fabricPurchases]);

  const yearlyTotal = useMemo(() => {
    const startYear = "2026-01-01"; 
    const todayStr = new Date().toISOString().split('T')[0];
    
    let total = 0;

    // Machines
    machines.forEach(m => {
        m.dailyLogs?.forEach(log => {
            if (log.date >= startYear && log.date <= todayStr) {
                total += Number(log.dayProduction) || 0;
            }
        })
    });

    // External
    externalEntries.forEach(e => {
        if (e.date >= startYear && e.date <= todayStr) {
            total += e.receivedQty || 0;
        }
    });

    return total;
  }, [machines, externalEntries]);

  const handleQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
    setExcludedDays(new Set());
  };

  const toggleExcludeDay = (date: string) => {
    const newSet = new Set(excludedDays);
    if (newSet.has(date)) {
      newSet.delete(date);
    } else {
      newSet.add(date);
    }
    setExcludedDays(newSet);
  };

  const handleDeleteFabricPurchase = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الشراء؟')) return;
    try {
      await deleteDoc(doc(db, 'FabricPurchases', id));
      setFabricPurchases(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error('Error deleting fabric purchase:', e);
      alert('حدث خطأ أثناء الحذف');
    }
  };

  const handleAddFabricPurchase = async () => {
    if (!fabricForm.name || fabricForm.quantity <= 0) {
      alert('الرجاء إدخال اسم القماش وكمية صحيحة');
      return;
    }
    try {
      await addDoc(collection(db, 'FabricPurchases'), {
        name: fabricForm.name,
        type: fabricForm.type,
        purchaseDate: fabricForm.purchaseDate,
        quantity: Number(fabricForm.quantity),
        timestamp: serverTimestamp()
      });
      setShowFabricModal(false);
      setFabricForm({ name: '', type: 'kham', purchaseDate: new Date().toISOString().split('T')[0], quantity: 0 });
      // Refresh the list
      const yearStart = `${fabricYear}-01-01`;
      const yearEnd = `${fabricYear}-12-31`;
      const q = query(
        collection(db, 'FabricPurchases'),
        where('purchaseDate', '>=', yearStart),
        where('purchaseDate', '<=', yearEnd)
      );
      const snap = await getDocs(q);
      const purchases: FabricPurchase[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        purchases.push({
          id: doc.id,
          name: data.name,
          type: data.type,
          purchaseDate: data.purchaseDate,
          quantity: Number(data.quantity) || 0,
          timestamp: data.timestamp
        });
      });
      setFabricPurchases(purchases);
    } catch (e) {
      console.error('Error adding fabric purchase:', e);
      alert('حدث خطأ أثناء إضافة شراء القماش');
    }
  };

  const fmt = (num: number) => num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtDay = (d: string) => new Date(d).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });

  const exportCSV = () => {
    const rows = [
      ['التاريخ', 'العريض', 'البوص', 'خارجي', 'المجموع'],
      ...stats.dailyData.map(d => [d.date, d.wide, d.bous, d.external, d.wide + d.bous + d.external]),
      ['المجموع', stats.totalWide, stats.totalBous, stats.totalExternal, stats.grandTotal]
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقرير-الانتاج-${startDate}-${endDate}.csv`;
    a.click();
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    setIsGeneratingPdf(true);
    let clone: HTMLElement | null = null;
    
    try {
      // Clone the element to render it properly for capture
      clone = printRef.current.cloneNode(true) as HTMLElement;
      
      // Reset styles to ensure visibility for capture
      // We place it fixed at 0,0 but behind everything (z-index -1) or just transparently on top if needed.
      // Since we need it to be painted, we shouldn't hide it with visibility: hidden. 
      // z-index: -9999 usually works if background is distinct, but let's try just appending it.
      // FetchDataPage uses a clone.
      clone.style.display = 'block';
      clone.style.position = 'fixed';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '-9999'; 
      clone.style.width = '210mm';
      clone.style.minHeight = '297mm';
      clone.style.backgroundColor = '#ffffff';

      document.body.appendChild(clone);
      
      // Wait for layout to settle (simulating FetchDataPage logic)
      await new Promise(resolve => setTimeout(resolve, 300));

      const dataUrl = await toJpeg(clone, {
        quality: 0.95,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
      });
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (pdf.internal.pageSize.getHeight());
      
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgWidth = imgProps.width;
      const imgHeight = imgProps.height;
      
      const ratio = imgWidth / imgHeight;
      
      const finalPdfWidth = pdfWidth;
      const finalPdfHeight = pdfWidth / ratio;
      
      pdf.addImage(dataUrl, 'JPEG', 0, 0, finalPdfWidth, finalPdfHeight);
      pdf.save(`تقرير-الانتاج-${startDate}-${endDate}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('حدث خطأ أثناء إنشاء ملف PDF');
    } finally {
      // Cleanup
      if (clone && document.body.contains(clone)) {
        document.body.removeChild(clone);
      }
      setIsGeneratingPdf(false);
    }
  };

// Styles for Pdf Report Rows
const PdfRow = ({ label, value, bg = '#fff' }: { label: string, value: string | number, bg?: string }) => (
  <div style={{ display: 'flex', borderBottom: '2px solid #000', backgroundColor: bg }}>
    <div style={{ 
      width: '35%', 
      padding: '8px', 
      textAlign: 'center', 
      fontWeight: 'bold', 
      borderRight: '2px solid #000',
      fontSize: '14px'
    }}>
      {value}
    </div>
    <div style={{ 
      width: '65%', 
      padding: '8px', 
      textAlign: 'right', 
      fontWeight: 'bold', 
      fontSize: '14px',
      backgroundColor: '#e6f3ff' // Light blue similar to image
    }}>
      {label}
    </div>
  </div>
);

  return (
    <div className="min-h-screen bg-slate-50 pb-20" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">تقرير الانتاج المجمع</h1>
                <p className="text-sm text-slate-500 font-medium">
                  {new Date(startDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })} 
                  <span className="mx-2">-</span>
                  {new Date(endDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
              {/* Quick Range Buttons */}
              <div className="flex items-center gap-2">
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => handleQuickRange(d)}
                    className="hidden sm:block px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-200">
                    {d} يوم
                  </button>
                ))}
              </div>
              
              <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
              
              {/* Tab Navigation */}
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button 
                  onClick={() => setView('main')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'main' 
                      ? 'bg-white shadow text-indigo-600' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <LayoutGrid size={16} />
                  تقرير الانتاج
                </button>
                <button 
                  onClick={() => setView('scrap')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'scrap' 
                      ? 'bg-white shadow text-red-600' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Trash2 size={16} />
                  تقرير السقط
                </button>
                <button 
                  onClick={() => setView('production')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'production' 
                      ? 'bg-white shadow text-indigo-600' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <TrendingUp size={16} />
                  الانتاج والتسليمات
                </button>
                <button 
                  onClick={() => setView('fabric')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'fabric' 
                      ? 'bg-white shadow text-blue-600' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <ShoppingCart size={16} />
                  شراء الأقمشة
                </button>
                <button 
                  onClick={() => setView('workers')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'workers' 
                      ? 'bg-white shadow text-green-700' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <BarChart2 size={16} />
                  سقط العمال
                </button>
                <button 
                  onClick={() => setView('clients')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === 'clients' 
                      ? 'bg-white shadow text-teal-700' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Users size={16} />
                  طلبيات العملاء
                </button>
              </div>
              
              <div className="h-6 w-px bg-slate-200"></div>
              
              {/* Export Buttons */}
              <div className="flex items-center gap-2">
                <button onClick={exportCSV}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-2 shadow-sm">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>اكسيل</span>
                </button>
                <button onClick={generatePDF} disabled={isGeneratingPdf}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors flex items-center gap-2 shadow-sm disabled:opacity-60">
                  {isGeneratingPdf ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Date Range */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center bg-white rounded-md border border-slate-300 shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-l border-slate-300">
                <Calendar className="w-4 h-4 text-slate-500" />
              </div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm focus:outline-none focus:ring-0 px-3 py-1.5 w-36 cursor-pointer" />
              <div className="w-px h-8 bg-slate-300"></div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm focus:outline-none focus:ring-0 px-3 py-1.5 w-36 cursor-pointer" />
            </div>
            <button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 300); }}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors border border-transparent hover:border-indigo-100">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {view === 'production' && (
        <div className="max-w-full mx-auto px-4 py-6" dir="rtl">
          {/* Title Bar */}
          <div className="mb-4 bg-slate-800 rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <h2 className="text-white text-xl font-bold tracking-wide">الانتاج والتسليمات السنوي</h2>
            </div>
            <div className="flex items-center gap-2">
              {prodYearLoading && <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />}
              <span className="text-slate-400 text-sm">السنة:</span>
              <select
                value={prodYear}
                onChange={e => setProdYear(e.target.value)}
                className="bg-slate-700 text-white text-sm font-semibold border border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer hover:bg-slate-600 transition-colors"
              >
                {Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString()).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs font-bold tracking-wider">
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 36 }}>#</th>
                    <th className="px-4 py-3 text-right border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 90 }}>الشهر</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 75 }}>أيام التشغيل</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 100 }}>المكن العريض</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 90 }}>البوص</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap bg-orange-50/50 text-orange-700" style={{ minWidth: 100 }}>الخارجي</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 100 }}>اجمالي الانتاج</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap bg-red-50/50 text-red-700" style={{ minWidth: 90 }}>السقط</th>
                    <th className="px-4 py-3 text-center border-b border-slate-200 whitespace-nowrap bg-indigo-50/50 text-indigo-700" style={{ minWidth: 120 }}>صافي تسليمات العملاء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prodStats.rows.map((row) => (
                    <tr key={row.month} className="transition-colors hover:bg-slate-50/80 bg-white">
                      <td className="px-4 py-3 text-center text-slate-400 font-medium border-l border-slate-100">{row.idx}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-700 border-l border-slate-100">{row.monthName}</td>
                      <td className="px-4 py-3 text-center text-slate-500 border-l border-slate-100 tabular-nums">{row.workingDays}</td>
                      <td className="px-4 py-3 text-center font-medium text-slate-700 border-l border-slate-100 tabular-nums">{row.wide > 0 ? row.wide.toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-4 py-3 text-center font-medium text-slate-700 border-l border-slate-100 tabular-nums">{row.bous > 0 ? row.bous.toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-4 py-3 text-center font-medium text-orange-700 border-l border-slate-100 bg-orange-50/20 tabular-nums">{row.external > 0 ? row.external.toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-4 py-3 text-center font-bold text-slate-800 border-l border-slate-100 tabular-nums">{row.totalProduction.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center font-medium text-red-600 border-l border-slate-100 bg-red-50/20 tabular-nums">{row.scrap > 0 ? row.scrap.toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-4 py-3 text-center font-bold text-indigo-700 bg-indigo-50/20 tabular-nums">
                        {editingDeliveryMonth === row.month ? (
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              autoFocus
                              type="number"
                              value={editingDeliveryValue}
                              onChange={e => setEditingDeliveryValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveDeliveryOverride(row.month, editingDeliveryValue);
                                if (e.key === 'Escape') setEditingDeliveryMonth(null);
                              }}
                              placeholder="0"
                              className="w-24 px-2 py-1 text-sm border border-indigo-400 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                            <button onClick={() => handleSaveDeliveryOverride(row.month, editingDeliveryValue)} className="p-1 text-green-600 hover:text-green-800" title="حفظ">✓</button>
                            <button onClick={() => setEditingDeliveryMonth(null)} className="p-1 text-slate-400 hover:text-slate-600" title="إلغاء">✕</button>
                          </div>
                        ) : (() => {
                          const isManual = deliveryOverrides[row.month] !== undefined;
                          const effective = isManual ? deliveryOverrides[row.month] : row.deliveries;
                          return (
                            <div
                              className="flex items-center justify-center gap-1.5 cursor-pointer group"
                              onClick={() => { setEditingDeliveryMonth(row.month); setEditingDeliveryValue(String(effective || '')); }}
                              title="اضغط للتعديل"
                            >
                              <span>{effective > 0 ? effective.toLocaleString() : <span className="text-slate-300">-</span>}</span>
                              {isManual
                                ? <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold">يدوي</span>
                                : <span className="text-xs bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-medium opacity-0 group-hover:opacity-100 transition-opacity">تلقائي</span>
                              }
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-800">
                    <td className="px-4 py-4 text-right border-l border-slate-200" colSpan={2}>الاجمالي</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">{prodStats.totals.workingDays}</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">{prodStats.totals.wide.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">{prodStats.totals.bous.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 text-orange-700 bg-orange-50 tabular-nums">{prodStats.totals.external.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">{prodStats.totals.totalProduction.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 text-red-600 bg-red-50 tabular-nums">{prodStats.totals.scrap.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center text-indigo-700 bg-indigo-50 tabular-nums">
                      {(() => {
                        const effectiveTotal = prodStats.rows.reduce((a, r) => a + (deliveryOverrides[r.month] !== undefined ? deliveryOverrides[r.month] : r.deliveries), 0);
                        return effectiveTotal.toLocaleString();
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {prodStats.rows.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <Package className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">لا توجد بيانات انتاج في هذه السنة</p>
              </div>
            )}
          </div>

          {/* Summary Cards */}
          {prodStats.rows.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">المكن العريض</div>
                <div className="text-2xl font-bold text-slate-700 tabular-nums">{prodStats.totals.wide.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">كجم</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">اجمالي الانتاج</div>
                <div className="text-2xl font-bold text-slate-800 tabular-nums">{prodStats.totals.totalProduction.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">كجم</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">اجمالي السقط</div>
                <div className="text-2xl font-bold text-red-600 tabular-nums">{prodStats.totals.scrap.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">{prodStats.totals.totalProduction > 0 ? ((prodStats.totals.scrap / prodStats.totals.totalProduction) * 100).toFixed(1) + '% من الانتاج' : 'كجم'}</div>
              </div>
              <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-4 text-center">
                <div className="text-xs text-indigo-400 font-medium uppercase tracking-wide mb-2">صافي التسليمات</div>
                <div className="text-2xl font-bold text-indigo-700 tabular-nums">
                  {prodStats.rows.reduce((a, r) => a + (deliveryOverrides[r.month] !== undefined ? deliveryOverrides[r.month] : r.deliveries), 0).toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">كجم للعملاء</div>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'scrap' && (
        <div className="max-w-full mx-auto px-4 py-6" dir="rtl">
          {/* Scrap Report Full-Width Title Bar */}
          <div className="mb-4 bg-slate-800 rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h2 className="text-white text-xl font-bold tracking-wide">تقرير السقط السنوي</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">السنة:</span>
              <select
                value={scrapYear}
                onChange={e => setScrapYear(e.target.value)}
                className="bg-slate-700 text-white text-sm font-semibold border border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400 cursor-pointer hover:bg-slate-600 transition-colors"
              >
                {Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString()).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Main Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm" style={{ minWidth: `${Math.max(900, 320 + scrapStats.reasons.length * 110)}px` }}>
                <thead>
                  {/* Column Headers */}
                  <tr className="bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-wider">
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 40 }}>#</th>
                    <th className="px-4 py-3 text-right border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 110 }}>الشهر</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 80 }}>أيام التشغيل</th>
                    {scrapStats.reasons.map(r => (
                      <th key={r} className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 100 }}>{r}</th>
                    ))}
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap bg-red-50/50 text-red-700" style={{ minWidth: 110 }}>اجمالي سقط الشهر</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 110 }}>انتاج الشهر</th>
                    <th className="px-4 py-3 text-center border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 110 }}>نسبة السقط</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scrapStats.rows.map((row, idx) => {
                    const isHighScrap = row.scrapPercent > 2;
                    return (
                      <tr
                        key={row.month}
                        className="transition-colors hover:bg-slate-50/80 bg-white"
                      >
                        <td className="px-4 py-3 text-center text-slate-400 font-medium border-l border-slate-100">{idx + 1}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-700 border-l border-slate-100">{row.monthName}</td>
                        <td className="px-4 py-3 text-center font-medium text-slate-500 border-l border-slate-100 tabular-nums">{row.workingDays}</td>
                        {scrapStats.reasons.map(r => {
                          const val = row.scrapByReason[r] || 0;
                          return (
                            <td key={r} className="px-4 py-3 text-center tabular-nums border-l border-slate-100">
                              {val > 0
                                ? <span className="text-slate-700 font-medium">{val.toLocaleString()}</span>
                                : <span className="text-slate-300">-</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center font-bold text-red-600 border-l border-slate-100 bg-red-50/30 tabular-nums">
                          {row.totalScrap > 0 ? row.totalScrap.toLocaleString() : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-4 py-3 text-center font-medium text-slate-600 border-l border-slate-100 tabular-nums">
                          {row.production.toLocaleString()}
                        </td>
                        <td className={`px-4 py-3 text-center font-bold tabular-nums ${
                          isHighScrap ? 'text-red-600 bg-red-50/30' : 'text-emerald-600'
                        }`}>
                          {row.production > 0 ? row.scrapPercent.toFixed(1) + '%' : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* Totals Row */}
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-800">
                    <td className="px-4 py-4 text-center border-l border-slate-200" colSpan={2}>الاجمالي</td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">{scrapStats.totals.workingDays}</td>
                    {scrapStats.reasons.map(r => (
                      <td key={r} className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">
                        {(scrapStats.totals.byReason[r] || 0) > 0 ? scrapStats.totals.byReason[r].toLocaleString() : <span className="text-slate-300">-</span>}
                      </td>
                    ))}
                    <td className="px-4 py-4 text-center border-l border-slate-200 bg-red-50 text-red-700 tabular-nums">
                      {scrapStats.totals.totalScrap.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-center border-l border-slate-200 tabular-nums">
                      {scrapStats.totals.production.toLocaleString()}
                    </td>
                    <td className={`px-4 py-4 text-center tabular-nums font-bold ${
                      scrapStats.totals.production > 0 && (scrapStats.totals.totalScrap / scrapStats.totals.production * 100) > 2
                        ? 'text-red-600 bg-red-50' : 'text-emerald-600'
                    }`}>
                      {scrapStats.totals.production > 0
                        ? (scrapStats.totals.totalScrap / scrapStats.totals.production * 100).toFixed(1) + '%'
                        : '—'}
                    </td>
                  </tr>
                  {/* % of total scrap row */}
                  <tr className="bg-white border-t border-slate-100 text-xs text-slate-500">
                    <td className="px-4 py-3 text-center border-l border-slate-100" colSpan={2}>النسبة من اجمالي السقط</td>
                    <td className="px-4 py-3 text-center border-l border-slate-100">100%</td>
                    {scrapStats.reasons.map(r => {
                      const pct = scrapStats.totals.totalScrap > 0
                        ? ((scrapStats.totals.byReason[r] || 0) / scrapStats.totals.totalScrap * 100)
                        : 0;
                      return (
                        <td key={r} className="px-4 py-3 text-center border-l border-slate-100 font-medium tabular-nums">
                          {pct > 0 ? pct.toFixed(0) + '%' : <span className="text-slate-300">-</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center border-l border-slate-100 bg-red-50/30 font-bold text-red-600">100%</td>
                    <td className="px-4 py-3 text-center border-l border-slate-100"></td>
                    <td className="px-4 py-3 text-center"></td>
                  </tr>
                  {/* % of wide production row */}
                  <tr className="bg-slate-50/50 border-t border-slate-100 text-xs text-slate-500">
                    <td className="px-4 py-3 text-center border-l border-slate-100" colSpan={2}>النسبة من الممكن العريض</td>
                    <td className="px-4 py-3 text-center border-l border-slate-100">
                      {scrapStats.totals.production > 0
                        ? (scrapStats.totals.totalScrap / scrapStats.totals.production * 100).toFixed(1) + '%'
                        : '—'}
                    </td>
                    {scrapStats.reasons.map(r => {
                      const pct = scrapStats.totals.production > 0
                        ? ((scrapStats.totals.byReason[r] || 0) / scrapStats.totals.production * 100)
                        : 0;
                      return (
                        <td key={r} className="px-4 py-3 text-center border-l border-slate-100 font-medium tabular-nums">
                          {pct > 0 ? pct.toFixed(2) + '%' : <span className="text-slate-300">-</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center border-l border-slate-100 bg-red-50/30 font-semibold text-red-600">
                      {scrapStats.totals.production > 0
                        ? (scrapStats.totals.totalScrap / scrapStats.totals.production * 100).toFixed(1) + '%'
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center border-l border-slate-100"></td>
                    <td className="px-4 py-3 text-center"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {scrapStats.rows.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <Trash2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">لا توجد بيانات سقط في هذه السنة</p>
              </div>
            )}
          </div>

          {/* Year Totals Summary */}
          {scrapStats.rows.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">اجمالي السقط</div>
                <div className="text-2xl font-bold text-red-600 tabular-nums">{scrapStats.totals.totalScrap.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">كجم</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">اجمالي الانتاج</div>
                <div className="text-2xl font-bold text-slate-700 tabular-nums">{scrapStats.totals.production.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">كجم</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">نسبة السقط</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  scrapStats.totals.production > 0 && (scrapStats.totals.totalScrap / scrapStats.totals.production * 100) > 2
                    ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {scrapStats.totals.production > 0
                    ? (scrapStats.totals.totalScrap / scrapStats.totals.production * 100).toFixed(1) + '%'
                    : '—'}
                </div>
                <div className="text-xs text-slate-400 mt-1">من انتاج العريض</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">أيام التشغيل</div>
                <div className="text-2xl font-bold text-slate-700 tabular-nums">{scrapStats.totals.workingDays}</div>
                <div className="text-xs text-slate-400 mt-1">يوم تشغيل</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fabric Purchase Modal */}
      {showFabricModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-slate-800">إضافة شراء قماش</h3>
              <button onClick={() => setShowFabricModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم القماش</label>
                <input 
                  type="text"
                  value={fabricForm.name}
                  onChange={(e) => setFabricForm({...fabricForm, name: e.target.value})}
                  placeholder="مثال: كاتيون قطن"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">نوع القماش</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio"
                      name="type"
                      value="kham"
                      checked={fabricForm.type === 'kham'}
                      onChange={(e) => setFabricForm({...fabricForm, type: 'kham'})}
                      className="w-4 h-4"
                    />
                    <span className="text-slate-700 font-medium">خام</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio"
                      name="type"
                      value="jahez"
                      checked={fabricForm.type === 'jahez'}
                      onChange={(e) => setFabricForm({...fabricForm, type: 'jahez'})}
                      className="w-4 h-4"
                    />
                    <span className="text-slate-700 font-medium">جاهز</span>
                  </label>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">تاريخ الشراء</label>
                <input 
                  type="date"
                  value={fabricForm.purchaseDate}
                  onChange={(e) => setFabricForm({...fabricForm, purchaseDate: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">الكمية (كجم)</label>
                <input 
                  type="number"
                  value={fabricForm.quantity || ''}
                  onChange={(e) => setFabricForm({...fabricForm, quantity: parseFloat(e.target.value) || 0})}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button onClick={() => setShowFabricModal(false)}
                  className="flex-1 px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors">
                  إلغاء
                </button>
                <button onClick={handleAddFabricPurchase}
                  className="flex-1 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors">
                  حفظ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'fabric' && (
        <div className="max-w-full mx-auto px-4 py-6" dir="rtl">
          {/* Title Bar */}
          <div className="mb-4 bg-slate-800 rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <ShoppingCart className="w-5 h-5 text-blue-400" />
              <h2 className="text-white text-xl font-bold tracking-wide">شراء الأقمشة</h2>
            </div>
            <div className="flex items-center gap-3">
              {fabricLoading && <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />}
              {canEditFabric && (
                <button onClick={() => setShowFabricModal(true)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                  <ShoppingCart size={16} />
                  إضافة شراء
                </button>
              )}
              <span className="text-slate-400 text-sm">السنة:</span>
              <select
                value={fabricYear}
                onChange={e => setFabricYear(e.target.value)}
                className="bg-slate-700 text-white text-sm font-semibold border border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer hover:bg-slate-600 transition-colors"
              >
                {Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString()).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs font-bold tracking-wider">
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 36 }}>#</th>
                    <th className="px-4 py-3 text-right border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 150 }}>اسم القماش</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 100 }}>النوع</th>
                    <th className="px-4 py-3 text-center border-l border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 120 }}>تاريخ الشراء</th>
                    <th className="px-4 py-3 text-center border-b border-slate-200 whitespace-nowrap" style={{ minWidth: 100 }}>الكمية (كجم)</th>
                    {canEditFabric && <th className="px-4 py-3 text-center border-b border-l border-slate-200 whitespace-nowrap" style={{ minWidth: 60 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {/* خام Section */}
                  {fabricStats.kham.length > 0 && (
                    <>
                      <tr className="bg-blue-50 border-b border-slate-200">
                        <td colSpan={canEditFabric ? 6 : 5} className="px-4 py-3 font-bold text-slate-800 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                          القماش الخام
                        </td>
                      </tr>
                      {fabricStats.kham.map((fabric, idx) => (
                        <tr key={fabric.id} className="hover:bg-slate-50/50 border-b border-slate-100">
                          <td className="px-4 py-3 text-center text-slate-400 font-medium">{idx + 1}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-700">{fabric.name}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-medium">خام</span>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-600">{new Date(fabric.purchaseDate).toLocaleDateString('ar-EG')}</td>
                          <td className="px-4 py-3 text-center font-bold text-slate-700 tabular-nums">{fabric.quantity.toLocaleString()}</td>
                          {canEditFabric && (
                            <td className="px-4 py-3 text-center border-l border-slate-100">
                              <button onClick={() => handleDeleteFabricPurchase(fabric.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="حذف"><Trash2 size={14} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="bg-blue-50/50 border-b border-slate-200 font-bold">
                        <td colSpan={canEditFabric ? 5 : 4} className="px-4 py-3 text-right">إجمالي الخام</td>
                        <td className="px-4 py-3 text-center text-blue-700 tabular-nums">{fabricStats.totals.khamTotal.toLocaleString()}</td>
                      </tr>
                    </>
                  )}

                  {/* جاهز Section */}
                  {fabricStats.jahez.length > 0 && (
                    <>
                      <tr className="bg-amber-50 border-b border-slate-200">
                        <td colSpan={canEditFabric ? 6 : 5} className="px-4 py-3 font-bold text-slate-800 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-amber-600"></div>
                          القماش الجاهز
                        </td>
                      </tr>
                      {fabricStats.jahez.map((fabric, idx) => (
                        <tr key={fabric.id} className="hover:bg-slate-50/50 border-b border-slate-100">
                          <td className="px-4 py-3 text-center text-slate-400 font-medium">{idx + 1}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-700">{fabric.name}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-medium">جاهز</span>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-600">{new Date(fabric.purchaseDate).toLocaleDateString('ar-EG')}</td>
                          <td className="px-4 py-3 text-center font-bold text-slate-700 tabular-nums">{fabric.quantity.toLocaleString()}</td>
                          {canEditFabric && (
                            <td className="px-4 py-3 text-center border-l border-slate-100">
                              <button onClick={() => handleDeleteFabricPurchase(fabric.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="حذف"><Trash2 size={14} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="bg-amber-50/50 border-b border-slate-200 font-bold">
                        <td colSpan={canEditFabric ? 5 : 4} className="px-4 py-3 text-right">إجمالي الجاهز</td>
                        <td className="px-4 py-3 text-center text-amber-700 tabular-nums">{fabricStats.totals.jahezTotal.toLocaleString()}</td>
                      </tr>
                    </>
                  )}

                  {/* Total Row */}
                  {fabricStats.totals.totalCount > 0 && (
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                      <td colSpan={canEditFabric ? 5 : 4} className="px-4 py-4 text-right">الإجمالي الكلي</td>
                      <td className="px-4 py-4 text-center text-slate-800 tabular-nums">{fabricStats.totals.grandTotal.toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {fabricStats.totals.totalCount === 0 && (
              <div className="py-16 text-center text-slate-400">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">لا توجد مشتريات أقمشة في هذه السنة</p>
                <p className="text-sm mt-1">اضغط على "إضافة شراء" لبدء تسجيل المشتريات</p>
              </div>
            )}
          </div>

          {/* Summary Cards */}
          {fabricStats.totals.totalCount > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-4 text-center">
                <div className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-2">إجمالي الخام</div>
                <div className="text-2xl font-bold text-blue-700 tabular-nums">{fabricStats.totals.khamTotal.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">{fabricStats.totals.khamCount} أصناف</div>
              </div>
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4 text-center">
                <div className="text-xs text-amber-600 font-medium uppercase tracking-wide mb-2">إجمالي الجاهز</div>
                <div className="text-2xl font-bold text-amber-700 tabular-nums">{fabricStats.totals.jahezTotal.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">{fabricStats.totals.jahezCount} أصناف</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <div className="text-xs text-slate-600 font-medium uppercase tracking-wide mb-2">الإجمالي الكلي</div>
                <div className="text-2xl font-bold text-slate-800 tabular-nums">{fabricStats.totals.grandTotal.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">كجم</div>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'main' && <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        
        {/* Working Days Config */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-indigo-500" />
              <span className="text-slate-700 font-medium">أيام العمل المحتسبة:</span>
              <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">{stats.workingDays}</span>
              <span className="text-slate-400">من أصل {stats.totalDays} يوم</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={autoDetectOffDays}
                className="text-xs px-3 py-1.5 font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors">
                اكتشاف العطلات
              </button>
              <button onClick={() => setShowDaySelector(!showDaySelector)}
                className="text-xs px-3 py-1.5 font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors shadow-sm">
                {showDaySelector ? 'اخفاء التفاصيل' : 'تعديل الأيام'}
              </button>
              {excludedDays.size > 0 && (
                <button onClick={() => setExcludedDays(new Set())}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="إلغاء جميع العطلات">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          {showDaySelector && (
            <div className="px-5 py-4 bg-white flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {stats.dailyData.map(day => {
                const hasProduction = day.wide + day.bous > 0;
                return (
                  <button key={day.date} onClick={() => toggleExcludeDay(day.date)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-all font-medium flex items-center gap-1.5 ${
                      day.excluded 
                        ? 'bg-red-50 border-red-200 text-red-600 line-through decoration-red-400' 
                        : hasProduction
                          ? 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm'
                          : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    }`}>
                    {fmtDay(day.date)}
                    {!hasProduction && !day.excluded && <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-1 h-full bg-blue-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">المكن العريض</div>
            <div className="text-3xl font-bold text-slate-800">{fmt(stats.totalWide)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2 bg-slate-50 inline-block px-2 py-1 rounded">
              متوسط: <span className="text-blue-600">{fmt(stats.avgWide)}</span> / يوم
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1 h-full bg-emerald-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">البوص</div>
            <div className="text-3xl font-bold text-slate-800">{fmt(stats.totalBous)}</div>
            <div className="text-xs font-medium text-emerald-600 mt-2">انتاج تام</div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1 h-full bg-indigo-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">الداخلي (المجمع)</div>
            <div className="text-3xl font-bold text-indigo-600">{fmt(stats.totalInternal)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2">عريض + بوص</div>
          </div>
          
          <div className="bg-slate-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-white relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
            <div className="text-sm font-medium text-slate-400 mb-2">الاجمالي الكلي</div>
            <div className="text-3xl font-bold">{fmt(stats.grandTotal)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2 flex justify-between">
              <span>شامل الخارجي</span>
              <span className="text-emerald-400">+{((stats.totalExternal/stats.grandTotal)*100 || 0).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* External Production - Moved Below Totals and Styled */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
           {/* Section Header */}
           <button onClick={() => setShowExternalDetails(!showExternalDetails)}
             className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors bg-white group">
             <div className="flex items-center gap-4">
                <div className="p-2.5 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors">
                  <Factory className="w-6 h-6 text-orange-600" />
                </div>
                <div className="text-right">
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-orange-700 transition-colors">انتاج المصانع الخارجية</h3>
                  <p className="text-sm text-slate-500">اضغط لعرض التفاصيل حسب المصنع</p>
                </div>
             </div>
             <div className="flex items-center gap-4">
               <div className="flex flex-col items-end">
                 <span className="text-xs text-slate-400 font-medium">الاجمالي الخارجي</span>
                 <span className="text-xl font-bold text-orange-600 tabular-nums">{fmt(stats.totalExternal)}</span>
               </div>
               <div className={`text-slate-400 transition-transform duration-200 ${showExternalDetails ? 'rotate-180' : ''}`}>
                 <ChevronDown className="w-5 h-5" />
               </div>
             </div>
           </button>
           
           {/* Details Panel */}
           {showExternalDetails && (
             <div className="border-t border-slate-100 bg-slate-50 animate-in slide-in-from-top-1 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                  {stats.externalByFactory.length > 0 ? stats.externalByFactory.map(([factory, amount]) => (
                    <div key={factory} className="bg-white border border-slate-200 rounded-lg p-3 hover:border-orange-200 transition-colors flex items-center justify-between shadow-sm">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-xs font-bold text-orange-700">
                           {factory.substring(0,2)}
                         </div>
                         <span className="font-semibold text-slate-700">{factory}</span>
                       </div>
                       <span className="font-bold text-orange-600 tabular-nums">{fmt(amount)}</span>
                    </div>
                  )) : (
                     <div className="col-span-full py-8 text-center text-slate-400">
                        لا يوجد انتاج خارجي مسجل في هذه الفترة
                     </div>
                  )}
                </div>
             </div>
           )}
        </div>

        {/* Content Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Daily Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden lg:col-span-2">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">تفاصيل الانتاج اليومي</h3>
              <span className="text-xs font-medium bg-white border border-slate-200 text-slate-500 px-2.5 py-1 rounded-full">{stats.totalDays} يوم</span>
            </div>
            
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-sm">
                  <tr className="bg-slate-50 text-slate-500 text-xs border-b border-slate-200">
                    <th className="px-5 py-3 text-right font-semibold">التاريخ</th>
                    <th className="px-5 py-3 text-center font-semibold">العريض</th>
                    <th className="px-5 py-3 text-center font-semibold">البوص</th>
                    <th className="px-5 py-3 text-center font-semibold">خارجي</th>
                    <th className="px-5 py-3 text-center font-semibold bg-slate-100 text-slate-700">المجموع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stats.dailyData.map((day) => (
                    <tr key={day.date} 
                      className={`transition-colors hover:bg-slate-50 group ${day.excluded ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-5 py-3 font-medium text-slate-600">
                        <div className="flex items-center gap-2">
                          {day.excluded && <X className="w-3 h-3 text-red-500" />}
                          <span className={day.excluded ? 'line-through decoration-slate-300 text-slate-400' : ''}>{fmtDay(day.date)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-slate-700 font-medium">
                        {day.wide > 0 ? fmt(day.wide) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-emerald-600 font-medium">
                        {day.bous > 0 ? fmt(day.bous) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-orange-600 font-medium">
                        {day.external > 0 ? fmt(day.external) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums font-bold text-slate-800 bg-slate-50/50 group-hover:bg-slate-100/50 transition-colors border-l border-slate-100">
                        {fmt(day.wide + day.bous + day.external)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-white shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-slate-200 font-bold text-slate-800">
                  <tr>
                    <td className="px-5 py-3">المجموع</td>
                    <td className="px-5 py-3 text-center tabular-nums text-blue-600">{fmt(stats.totalWide)}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-emerald-600">{fmt(stats.totalBous)}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-orange-600">{fmt(stats.totalExternal)}</td>
                    <td className="px-5 py-3 text-center tabular-nums bg-slate-100">{fmt(stats.grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* External Details - REMOVED FROM GRID as it is now above */}
          {/* <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">...</div> */}

          {/* Scrap Details */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit lg:col-span-2">
            <button onClick={() => setShowScrapDetails(!showScrapDetails)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-800">تحليل السقط</div>
                  <div className="text-xs text-slate-500 mt-0.5">الكميات والأسباب</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                   <span className="text-sm font-bold text-slate-700">{fmt(stats.totalScrap)} كجم</span>
                   <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                       stats.scrapPercent > 2 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-green-100 text-green-700 border-green-200'
                     }`}>
                     {stats.scrapPercent.toFixed(1)}%
                   </span>
                </div>
                {showScrapDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>
            
            {showScrapDetails && (
              <div className="border-t border-slate-100 bg-slate-50 p-4 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {stats.scrapReasons.length > 0 ? stats.scrapReasons.map(([reason, amount]) => (
                    <div key={reason} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between shadow-sm">
                      <span className="text-slate-700 font-medium text-sm">{reason}</span>
                      <span className="font-bold text-red-600 bg-red-50 px-2 py-1 rounded text-sm">{fmt(amount)}</span>
                    </div>
                  )) : (
                    <div className="col-span-full py-4 text-center text-slate-400 text-sm">لا يوجد سقط مسجل في هذه الفترة</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Yearly Production */}
          <div className="bg-gradient-to-r from-blue-900 to-slate-800 rounded-xl shadow-md border border-blue-800/50 overflow-hidden lg:col-span-2 text-white relative">
            <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-x-10 -translate-y-10"></div>
            <div className="px-6 py-5 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/10 shadow-inner">
                  <BarChart3 className="w-6 h-6 text-blue-100" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">إجمالي الانتاج السنوي</h3>
                  <p className="text-blue-200 text-sm mt-0.5 font-medium">من 1/1/2026 حتى اليوم</p>
                </div>
              </div>
              <div className="text-right">
                 <div className="text-3xl font-bold tabular-nums tracking-tight">{fmt(yearlyTotal)}</div>
                 <div className="text-xs text-blue-300 font-medium mt-1 uppercase tracking-wider">كجم (شامل الخارجي)</div>
              </div>
            </div>
          </div>

        </div>
      </div>}

      {/* ─── Worker Scrap Analytics View ─── */}
      {view === 'workers' && (
        <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
          {/* Controls */}
          <div className="mb-5 bg-slate-800 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <BarChart2 className="w-5 h-5 text-green-400" />
              <h2 className="text-white text-xl font-bold">سقط العمال</h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Monthly / Yearly toggle */}
              <div className="flex rounded-lg overflow-hidden border border-slate-600">
                <button
                  onClick={() => setWorkerScrapPeriod('monthly')}
                  className={`px-4 py-1.5 text-sm font-semibold transition-colors ${workerScrapPeriod === 'monthly' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >شهري</button>
                <button
                  onClick={() => setWorkerScrapPeriod('yearly')}
                  className={`px-4 py-1.5 text-sm font-semibold transition-colors ${workerScrapPeriod === 'yearly' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >سنوي</button>
              </div>
              {/* Year */}
              <select
                value={workerScrapYear}
                onChange={e => setWorkerScrapYear(e.target.value)}
                className="bg-slate-700 text-white text-sm font-semibold border border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 cursor-pointer"
              >
                {Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString()).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {/* Month (only when monthly) */}
              {workerScrapPeriod === 'monthly' && (
                <select
                  value={workerScrapMonth}
                  onChange={e => setWorkerScrapMonth(e.target.value)}
                  className="bg-slate-700 text-white text-sm font-semibold border border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 cursor-pointer"
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const mm = String(i + 1).padStart(2, '0');
                    const name = new Date(2024, i, 1).toLocaleDateString('ar-EG', { month: 'long' });
                    return <option key={mm} value={mm}>{name}</option>;
                  })}
                </select>
              )}
            </div>
          </div>

          {/* Table Card */}
          <div className="rounded-2xl overflow-hidden shadow-lg border-2 border-[#6aaa64]">
            {/* Report Title */}
            <div className="py-5 px-4 text-center font-bold text-2xl" style={{ backgroundColor: '#b5d7a8', color: '#1a3c1a' }}>
              {workerScrapPeriod === 'monthly'
                ? `اجمالي سقط كل عامل لشهر ${new Date(Number(workerScrapYear), Number(workerScrapMonth) - 1, 1).toLocaleDateString('ar-EG', { month: 'long' })} ${workerScrapYear}`
                : `اجمالي سقط كل عامل لسنة ${workerScrapYear}`}
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-3 text-center font-bold text-base border-b-2 border-[#6aaa64]" style={{ backgroundColor: '#c9dfc9', color: '#1a3c1a' }}>
              <div className="py-3 border-l-2 border-[#6aaa64]">كمية السقط خلال {workerScrapPeriod === 'monthly' ? 'الشهر' : 'السنة'}</div>
              <div className="py-3 border-l-2 border-[#6aaa64]">اسم العامل</div>
              <div className="py-3"></div>
            </div>

            {/* Rows */}
            {workerStats.rows.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm bg-white">لا يوجد سقط مرتبط بعمال في هذه الفترة</div>
            ) : (
              workerStats.rows.map((row, idx) => (
                <div
                  key={row.name}
                  className="grid grid-cols-3 text-center items-center border-b border-[#b5d7a8]"
                  style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#e8f4e8' }}
                >
                  <div className="py-3 border-l-2 border-[#b5d7a8] font-bold text-lg text-slate-800 tabular-nums">{row.scrap % 1 === 0 ? row.scrap : row.scrap.toFixed(1)}</div>
                  <div className="py-3 border-l-2 border-[#b5d7a8] text-slate-700 font-medium">{row.name}</div>
                  <div className="py-3 font-bold text-slate-500">{idx + 1}</div>
                </div>
              ))
            )}

            {/* Total Footer */}
            <div className="grid grid-cols-3 text-center items-center border-t-2 border-[#6aaa64]" style={{ backgroundColor: '#f8f8f8' }}>
              <div className="py-4 border-l-2 border-[#6aaa64] font-bold text-2xl text-red-600 tabular-nums">
                {workerStats.total % 1 === 0 ? workerStats.total : workerStats.total.toFixed(1)}
              </div>
              <div className="py-4 border-l-2 border-[#6aaa64] font-bold text-slate-700 col-span-2 text-right pr-4">
                اجمالي سقط العمال خلال {workerScrapPeriod === 'monthly' ? 'الشهر' : 'السنة'}
              </div>
            </div>
          </div>

          {workerStats.rows.length > 0 && (
            <p className="text-xs text-slate-400 text-center mt-3">
              * يشمل فقط السجلات المرتبطة بعامل عبر "اهمال عامل"
            </p>
          )}
        </div>
      )}

      {/* ─── Client Orders Summary View ─── */}
      {view === 'clients' && (
        <div className="max-w-full mx-auto px-4 py-6" dir="rtl">
          {/* Title Bar */}
          <div className="mb-6 bg-white rounded-xl border border-slate-200 px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center border border-teal-100 shadow-sm">
                <Users className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <h2 className="text-slate-900 text-xl font-bold">طلبيات العملاء</h2>
                <p className="text-sm text-slate-500 mt-0.5 font-medium">متابعة حالة الطلبيات والتسليمات لكل عميل</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {clientOrdersLoading && <RefreshCw className="w-5 h-5 text-teal-600 animate-spin" />}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
                <span className="text-slate-600 text-sm font-medium">الموسم:</span>
                <select
                  value={selectedSeasonId}
                  onChange={e => setSelectedSeasonId(e.target.value)}
                  className="bg-transparent text-slate-900 text-sm font-bold focus:outline-none cursor-pointer"
                >
                  {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 900 }}>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-slate-600 text-xs font-bold uppercase tracking-wider">
                    <th className="px-4 py-4 text-center w-12">#</th>
                    <th className="px-4 py-4 text-center">كود العميل</th>
                    <th className="px-4 py-4 text-right">اسم العميل</th>
                    <th className="px-4 py-4 text-center">تاريخ استلام الاوردر</th>
                    <th className="px-4 py-4 text-center">الكمية المطلوبة</th>
                    <th className="px-4 py-4 text-center">ما تم تصنيعه</th>
                    <th className="px-4 py-4 text-center">المتبقى</th>
                    <th className="px-4 py-4 text-center">التسليمات</th>
                    <th className="px-4 py-4 text-center">متبقي تسليم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clientOrderRows.length === 0 && !clientOrdersLoading && (
                    <tr><td colSpan={9} className="py-16 text-center text-slate-400">
                      <Users className="w-12 h-12 mx-auto mb-4 text-slate-200" />
                      <p className="text-base font-medium">لا توجد طلبيات لهذا الموسم</p>
                    </td></tr>
                  )}
                  {clientOrderRows.map((row, idx) => {
                    const storedName = clientRealNames[row.clientId] || '';
                    const isEditing = editingRealNameId === row.clientId;
                    return (
                      <tr key={row.clientId} className="hover:bg-slate-50/80 transition-colors bg-white group/row">
                        <td className="px-4 py-3.5 text-center text-slate-400 font-medium tabular-nums">{idx + 1}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-md font-bold text-slate-700 bg-slate-100 border border-slate-200 text-xs shadow-sm">
                            {row.clientCode}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="text"
                                value={editingRealNameValue}
                                onChange={e => setEditingRealNameValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleSaveRealName(row.clientId, editingRealNameValue);
                                  if (e.key === 'Escape') setEditingRealNameId(null);
                                }}
                                placeholder="اسم العميل..."
                                className="flex-1 px-3 py-1.5 text-sm border border-teal-400 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-400/20 min-w-0 text-right shadow-sm"
                              />
                              <button onClick={() => handleSaveRealName(row.clientId, editingRealNameValue)} className="p-1.5 text-white bg-teal-600 rounded-md hover:bg-teal-700 shadow-sm transition-colors"><Check size={16} /></button>
                              <button onClick={() => setEditingRealNameId(null)} className="p-1.5 text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 border border-slate-200 transition-colors"><X size={16} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 group">
                              <span className="font-bold text-slate-800 text-base">{storedName || <span className="text-slate-400 font-normal text-sm">لم يتم التحديد</span>}</span>
                              {canEditFabric && (
                                <button
                                  onClick={() => { setEditingRealNameId(row.clientId); setEditingRealNameValue(storedName); }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md"
                                  title="تعديل اسم العميل"
                                ><Edit2 size={14} /></button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center text-slate-500 text-xs font-medium">
                          {row.orderDates.length > 0
                            ? <div className="flex flex-col gap-1 items-center">{[...new Set(row.orderDates)].map(d => <span key={d} className="bg-slate-50 border border-slate-100 rounded px-2 py-0.5 text-slate-600">{d}</span>)}</div>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center font-bold text-slate-700 tabular-nums text-base">{row.totalRequired > 0 ? row.totalRequired.toLocaleString() : <span className="text-slate-300 font-normal">-</span>}</td>
                        <td className="px-4 py-3.5 text-center font-bold text-teal-700 tabular-nums text-base">{row.totalManufactured > 0 ? row.totalManufactured.toLocaleString() : <span className="text-slate-300 font-normal">-</span>}</td>
                        <td className="px-4 py-3.5 text-center tabular-nums">
                          <span className={row.totalRemaining > 0 ? 'font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-100 text-sm' : 'text-slate-300'}>{row.totalRemaining > 0 ? row.totalRemaining.toLocaleString() : '-'}</span>
                        </td>
                        <td className="px-4 py-3.5 text-center font-bold text-indigo-600 tabular-nums text-base">{row.totalDeliveries > 0 ? row.totalDeliveries.toLocaleString() : <span className="text-slate-300 font-normal">-</span>}</td>
                        <td className="px-4 py-3.5 text-center tabular-nums">
                          <span className={row.deliveryRemaining > 0 ? 'font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-md border border-red-100 text-sm' : 'text-slate-300'}>{row.deliveryRemaining > 0 ? row.deliveryRemaining.toLocaleString() : '-'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {clientOrderRows.length > 0 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr className="text-slate-800 font-bold">
                      <td colSpan={4} className="px-4 py-4 text-left text-sm">الإجمالي الكلي</td>
                      <td className="px-4 py-4 text-center tabular-nums text-slate-900 text-base">{clientOrderRows.reduce((a, r) => a + r.totalRequired, 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-center tabular-nums text-teal-700 text-base">{clientOrderRows.reduce((a, r) => a + r.totalManufactured, 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-center tabular-nums text-orange-600 text-base">{clientOrderRows.reduce((a, r) => a + r.totalRemaining, 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-center tabular-nums text-indigo-600 text-base">{clientOrderRows.reduce((a, r) => a + r.totalDeliveries, 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-center tabular-nums text-red-600 text-base">{clientOrderRows.reduce((a, r) => a + r.deliveryRemaining, 0).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {canEditFabric && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 bg-white py-2 px-4 rounded-lg border border-slate-200 shadow-sm w-fit mx-auto">
              <Edit2 size={14} className="text-teal-500" />
              <span>اضغط على ايقونة التعديل بجوار اسم العميل لتغييره</span>
            </div>
          )}
        </div>
      )}

      {/* Hidden Print Template - Replicates Image Layout Correctly */}
      <div 
        ref={printRef}
        data-print-container
        style={{
          position: 'absolute',
          top: 0,
          left: -9999,
          width: '210mm',
          minHeight: '297mm',
          backgroundColor: '#fff',
          fontFamily: 'Arial, sans-serif',
          color: '#000',
          padding: '20px',
          direction: 'rtl',
          display: 'none' // will be made block by html2canvas
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '20px', fontWeight: 'bold', fontSize: '18px' }}>
          تقرير الانتاج المجمع من {new Date(startDate).toLocaleDateString('en-GB')} الى {new Date(endDate).toLocaleDateString('en-GB')}
        </div>

        <div style={{ border: '2px solid #000', marginBottom: '20px' }}>
          <PdfRow label="اجمالي انتاج المكن العريض" value={fmt(stats.totalWide)} />
          <PdfRow label={`متوسط انتاج اليوم للمكن العريض /${stats.workingDays}`} value={fmt(stats.avgWide)} />
          <PdfRow label="اجمالي انتاج البوص" value={fmt(stats.totalBous)} />
          <PdfRow label="اجمالي التصنيع في صالة الانتاج" value={fmt(stats.totalInternal)} />
          
          {stats.externalByFactory.map(([factory, amount]) => (
             <PdfRow key={factory} label={`اجمالي التصنيع في مصنع ${factory}`} value={fmt(amount)} />
          ))}

          {/* Spacer row if needed or just continue */}
          <div style={{ height: '20px', borderBottom: '2px solid #000', backgroundColor: '#fff' }}></div>

          <PdfRow label="اجمالي التصنيع الخارجي" value={fmt(stats.totalExternal)} />
          
          <div style={{ display: 'flex', borderBottom: '2px solid #000', backgroundColor: '#2563eb' }}>
             <div style={{ width: '35%', padding: '8px', textAlign: 'center', fontWeight: 'bold', color: '#fff', fontSize: '16px', borderRight: '2px solid #000' }}>
               {fmt(stats.grandTotal)}
             </div>
             <div style={{ width: '65%', padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#fff', fontSize: '16px' }}>
               اجمالي انتاج المصنع والتصنيع الخارجي
             </div>
          </div>

          <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
             <div style={{ width: '50%', borderRight: '2px solid #000' }}>
                 <div style={{ borderBottom: '2px solid #000', padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>كمية السقط</div>
                 <div style={{ padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>{fmt(stats.totalScrap)}</div>
             </div>
             <div style={{ width: '50%' }}>
                 <div style={{ borderBottom: '2px solid #000', padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>نسبة السقط من انتاج المكن العريض</div>
                 <div style={{ padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>{stats.scrapPercent.toFixed(1)}%</div>
             </div>
          </div>
          
           {/* Detailed Table Section resembling the bottom table in image */}
           <div style={{ marginTop: '0', borderBottom: '2px solid #000' }}>
              <div style={{ backgroundColor: '#e2e8f0', padding: '5px', textAlign: 'center', fontWeight: 'bold', borderBottom: '2px solid #000' }}>
                بيانات تفصيلية
              </div>
              
              <div style={{ display: 'flex', borderBottom: '2px solid #000', fontSize: '12px', fontWeight: 'bold', backgroundColor: '#fff' }}>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>المكن العريض</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>الخارجي</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>البوص</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center' }}>المجموع</div>
              </div>

               <div style={{ display: 'flex', borderBottom: '2px solid #000', fontSize: '14px', fontWeight: 'bold' }}>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalWide)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalExternal)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalBous)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center' }}>{fmt(stats.grandTotal)}</div>
              </div>
           </div>

        </div>
        
        <div style={{ textAlign: 'left', fontSize: '10px', color: '#666', marginTop: '10px' }}>
          تم استخراج التقرير في: {new Date().toLocaleString('ar-EG')}
        </div>
      </div>
    </div>
  );
};
