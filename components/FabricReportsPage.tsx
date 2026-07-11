import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, collectionGroup, query, getDocs, orderBy, setDoc, doc, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { OrderRow, ProductionTicket } from '../types';
import { SampleCertificatePage } from './SampleCertificatePage';
import {
  Search, CheckCircle2, FileEdit, Calendar,
  ExternalLink, RefreshCw, ArrowLeft, Package,
  ChevronRight, User, Printer, ClipboardList, X, Layers
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CertEntry {
  orderId: string;
  clientName: string;
  material: string;
  sampleNumber: string;
  date: string;
  status: 'draft' | 'finalized';
  lastSavedAt: string;
  lastSavedBy?: string;
  finalizedAt: string;
  finalizedBy: string;
  rawWeight: string;
  rawWidth: string;
  finishedWeight: string;
  finishedWidth: string;
}

interface FabricGroup {
  material: string;
  code: string;
  label: string;
  certs: CertEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitMaterial(material: string): { code: string; label: string } {
  const m = material.match(/\[([^\]]+)\]/);
  if (m) {
    const code  = m[1].trim();
    const label = material.replace(m[0], '').replace(/\(خام\)/g, '').replace(/\bخام\b/g, '').trim() || code;
    return { code, label };
  }
  // No bracket — use first 20 chars as code, rest as label
  const parts = material.split(' ');
  const code  = parts[0] || material;
  const label = parts.slice(1).join(' ').trim() || code;
  return { code, label };
}

// ─── Report Viewer (tabbed: certificate + production order) ───────────────────

export function ReportViewer({
  order, clientName, cert, onClose, userRole, userName,
}: {
  order: OrderRow;
  clientName: string;
  cert: CertEntry;
  onClose: () => void;
  userRole?: string;
  userName?: string;
}) {
  const canSeeKnitting = ['admin', 'factory_manager'].includes(userRole ?? '');
  const [tab, setTab]           = useState<'cert' | 'production' | 'knitting'>('cert');
  const [ticket, setTicket]     = useState<ProductionTicket | null>(null);
  const [ticketLoaded, setTicketLoaded] = useState(false);
  const [fullOrder, setFullOrder] = useState<any | null>(null);
  const [yarnNames, setYarnNames] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const [ticketSnap, ordersSnap, yarnSnap] = await Promise.all([
          getDocs(query(collection(db, 'ProductionTickets'), where('orderId', '==', order.id))),
          getDocs(query(collectionGroup(db, 'orders'))),
          getDocs(collection(db, 'yarns')),  // 'yarns' collection has readable names
        ]);
        if (!ticketSnap.empty) {
          setTicket({ id: ticketSnap.docs[0].id, ...ticketSnap.docs[0].data() } as ProductionTicket);
        }
        const orderDoc = ordersSnap.docs.find(d => d.id === order.id);
        if (orderDoc) setFullOrder(orderDoc.data());
        const names: Record<string, string> = {};
        yarnSnap.docs.forEach(d => {
          const data = d.data() as any;
          // Yarn docs use id/yarnId as key, 'name' as the readable name
          names[d.id]          = data.name || d.id;
          if (data.yarnId) names[data.yarnId] = data.name || d.id;
        });
        setYarnNames(names);
      } finally {
        setTicketLoaded(true);
      }
    })();
  }, [order.id]);

  const hasPrinted = !!ticket;

  // ── Tab bar (injected into cert's headerSlot so it sits inside the fixed overlay) ──
  const TabBar = (
    <div style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb', borderTop: '1px solid #e5e7eb', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 0 }}>
      {([
        { key: 'cert',       label: 'Sample Certificate', icon: <ClipboardList size={13} /> },
        { key: 'production', label: 'Production Order',   icon: <Printer size={13} /> },
        ...(canSeeKnitting ? [{ key: 'knitting' as const, label: 'Knitting Structure', icon: <Layers size={13} /> }] : []),
      ] as { key: 'cert'|'production'|'knitting'; label: string; icon: React.ReactNode }[]).map(t => {
        const disabled = t.key === 'production' && !hasPrinted;
        const active   = tab === t.key;
        return (
          <button key={t.key}
            onClick={() => !disabled && setTab(t.key as 'cert'|'production'|'knitting')}
            title={disabled ? 'No production order printed for this fabric yet' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', fontSize: 12, fontWeight: 600,
              borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              color: active ? '#4f46e5' : disabled ? '#d1d5db' : '#6b7280',
              background: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'color .15s', whiteSpace: 'nowrap',
            }}>
            {t.icon} {t.label}
            {t.key === 'production' && ticketLoaded && !hasPrinted && (
              <span style={{ fontSize: 10, color: '#d1d5db', background: '#f9fafb', border: '1px solid #e5e7eb', padding: '1px 6px', borderRadius: 4, marginLeft: 2 }}>not printed</span>
            )}
          </button>
        );
      })}
    </div>
  );

  // ── Production order read-only view (exact same template as FabricProductionOrderModal) ──
  if (tab === 'production' && ticket) {
    const o = fullOrder || {};
    const yarnAllocations: Record<string, any[]> = o.yarnAllocations || {};
    const yarnEntries = Object.entries(yarnAllocations);
    const emptyRows   = Math.max(0, 4 - yarnEntries.length);

    // Dyehouse resolution — exact same logic as FabricProductionOrderModal
    const orderDefault         = o.dyehouse;
    const approvalDyehouses    = (o.dyeingPlan as any[] || []).flatMap((b: any) => (b.colorApprovals || [])).map((a: any) => a.dyehouseName).filter(Boolean);
    const batchDyehouses       = (o.dyeingPlan as any[] || []).map((b: any) => b.dyehouse).filter(Boolean);
    const hasUnassignedBatches = !o.dyeingPlan || (o.dyeingPlan as any[]).length === 0 || (o.dyeingPlan as any[]).some((b: any) => !b.dyehouse);
    const effectivelyUsedDefault = hasUnassignedBatches ? orderDefault : null;
    const dyehouseStr = (() => {
      const allSources = Array.from(new Set([
        ...(effectivelyUsedDefault ? [effectivelyUsedDefault] : []),
        ...approvalDyehouses,
        ...batchDyehouses,
      ].map((s: any) => s?.trim()).filter(Boolean)));
      return allSources.length > 0 ? allSources.join(' + ') : '---';
    })();

    const printedDate = ticket.printedAt
      ? new Date(ticket.printedAt).toLocaleDateString('en-GB')
      : o.lastPrintedAt
        ? new Date(o.lastPrintedAt).toLocaleDateString('en-GB')
        : new Date().toLocaleDateString('en-GB');

    return (
      <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="border-b px-4 py-3 flex items-center justify-between gap-4 flex-shrink-0 bg-white border-slate-200">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><X size={20} /></button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Printer size={16} className="text-slate-500" />
                <span className="font-bold text-slate-800 text-base">أمر تشغيل</span>
                <span className="text-slate-300">•</span>
                <span className="text-sm text-slate-600">{cert.material}</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{cert.clientName} · Read-only</p>
            </div>
          </div>
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-semibold">
            Read-only — changes must be made from the Orders page
          </span>
        </div>

        {TabBar}

        {/* Scrollable A4 body */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
          <div className="max-w-[210mm] mx-auto bg-white shadow-lg p-[7mm] min-h-[297mm] text-black text-xs" dir="rtl">

            {/* 1. Header */}
            <div className="flex border-b-2 border-slate-800 pb-1 mb-2 items-center min-h-[60px]">
              <div className="w-1/3 h-14 border-2 border-slate-800 flex items-center justify-center bg-slate-50" />
              <div className="w-1/3 flex flex-col items-center justify-center">
                <h1 className="text-lg font-bold border-2 border-slate-800 px-6 py-1 bg-slate-100 shadow-sm">أمر تشغيل</h1>
              </div>
              <div className="w-1/3 text-left pl-2">
                <div className="flex justify-end flex-col gap-1 text-xs font-bold">
                  <div className="flex items-center justify-end gap-2">
                    <span>التاريخ:</span>
                    <span className="border-b border-dotted border-slate-400 min-w-[100px] text-center">{printedDate}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Order Data */}
            <div className="mb-2">
              <div className="border-2 border-slate-800 bg-slate-200 text-center font-bold py-0.5 text-xs w-full mb-1">بيانات الأوردار</div>
              <div className="px-2 space-y-2">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-2 w-1/2">
                    <span className="font-bold whitespace-nowrap min-w-[60px]">العميل :</span>
                    <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-mono font-bold text-base">{cert.clientName}</span>
                  </div>
                  <div className="flex items-center gap-2 w-1/2">
                    <span className="font-bold whitespace-nowrap min-w-[70px]">نوع القماش :</span>
                    <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-bold">{cert.material}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-2 w-1/2">
                    <span className="font-bold whitespace-nowrap min-w-[60px]">رقم المكنة :</span>
                    <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-mono font-bold text-base">
                      {o.machine ||
                       (ticket.snapshot?.activeMachines?.length  ? ticket.snapshot.activeMachines.join(', ')  : null) ||
                       (ticket.snapshot?.plannedMachines?.length ? ticket.snapshot.plannedMachines.join(', ') : null) ||
                       '---'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 w-1/2">
                    <span className="font-bold whitespace-nowrap min-w-[60px]">المصبغة :</span>
                    <span className="border-b border-dotted border-slate-400 w-full text-right px-2 font-bold">{dyehouseStr}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Yarn table */}
            <div className="mb-2 border-2 border-slate-800 mt-2">
              <div className="bg-slate-200 border-b border-slate-800 flex font-bold text-xs">
                <div className="w-1/2 p-0.5 text-center border-l border-slate-800">الخيط</div>
                <div className="w-1/2 p-0.5 text-center">رقم اللوط</div>
              </div>
              {yarnEntries.map(([yarnId, allocations], idx) => (
                <div key={yarnId} className="flex border-b border-slate-300 text-sm last:border-0 min-h-[30px]">
                  <div className="w-1/2 p-1 border-l border-slate-800 pr-2 flex items-center">
                    <span className="font-bold ml-2 w-6">({idx + 1})</span>
                    <span className="font-bold">
                      {yarnNames[yarnId] ||
                       (yarnId.startsWith('manual_') ? `غزل ${parseInt(yarnId.replace('manual_',''),10)+1}` : yarnId)}
                    </span>
                  </div>
                  <div className="w-1/2 p-1 text-center font-mono font-bold flex items-center justify-center bg-slate-50">
                    {(allocations as any[]).map((a: any) => a.lotNumber).filter(Boolean).join(', ') || '-'}
                  </div>
                </div>
              ))}
              {Array.from({ length: emptyRows }).map((_, i) => (
                <div key={`e${i}`} className="flex border-b border-slate-300 text-sm last:border-0 min-h-[30px]">
                  <div className="w-1/2 p-1 border-l border-slate-800 pr-2 flex items-center">
                    <span className="font-bold ml-2 w-6">({yarnEntries.length + i + 1})</span>
                  </div>
                  <div className="w-1/2 p-1 bg-slate-50" />
                </div>
              ))}
            </div>

            {/* 4. Specs */}
            <div className="mb-2 mt-2">
              <div className="border-2 border-slate-800 bg-slate-200 text-center font-bold py-0.5 text-xs w-full mb-1">المواصفة</div>
              <div className="border-2 border-slate-800 text-sm">
                <div className="flex bg-slate-100 font-bold border-b border-slate-800 text-xs">
                  <div className="flex-1 p-1 text-center border-l border-slate-400">---</div>
                  <div className="flex-1 p-1 text-center border-l border-slate-400">مجهز</div>
                  <div className="flex-1 p-1 text-center border-l border-slate-400">خام</div>
                  <div className="flex-1 p-1 text-center">غسيل</div>
                </div>
                <div className="flex border-b border-slate-400">
                  <div className="flex-1 p-1 text-center font-bold bg-slate-50 border-l border-slate-400 flex items-center justify-center">الوزن</div>
                  <div className="flex-1 p-1 text-center font-mono font-bold text-lg border-l border-slate-400 flex items-center justify-center">{o.requiredGsm || ''}</div>
                  <div className="flex-1 p-1 border-l border-slate-400" />
                  <div className="flex-1 p-1" />
                </div>
                <div className="flex">
                  <div className="flex-1 p-1 text-center font-bold bg-slate-50 border-l border-slate-400 flex items-center justify-center">العرض</div>
                  <div className="flex-1 p-1 text-center font-mono font-bold text-lg border-l border-slate-400 flex items-center justify-center">{o.requiredWidth || ''}</div>
                  <div className="flex-1 p-1 border-l border-slate-400" />
                  <div className="flex-1 p-1" />
                </div>
              </div>
              <div className="border-x-2 border-b-2 border-slate-800 p-1 min-h-[40px] relative mt-0">
                <div className="absolute top-1 right-2 text-[10px] font-bold underline">بيانات الويسكو:</div>
              </div>
            </div>

            {/* Notes */}
            <div className="border-2 border-slate-800 p-2 min-h-[50px] relative mb-2">
              <div className="absolute top-1 right-2 text-[10px] font-bold underline">ملاحظات:</div>
              {ticket.snapshot?.notes && (
                <p className="mt-4 text-sm text-right pr-1">{ticket.snapshot.notes}</p>
              )}
            </div>

            {/* Quantities & Checkboxes */}
            <div className="flex border-2 border-slate-800 min-h-[55px] mb-2">
              <div className="w-2/3 border-l-2 border-slate-800 flex">
                <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                  <span className="text-[9px] font-bold text-slate-500 mb-0.5">إجمالي الكمية</span>
                  <span className="font-bold font-mono text-base">{ticket.snapshot?.requiredQty?.toLocaleString() || o.requiredQty || ''}</span>
                </div>
                <div className="flex-[1.5] border-l border-slate-400 flex flex-col items-center justify-center p-1">
                  <span className="text-[9px] font-bold text-slate-500 mb-0.5">اسم الإكسسوار</span>
                  <span className="font-bold text-[10px]">{o.accessory || '-'}</span>
                </div>
                <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                  <span className="text-[9px] font-bold text-slate-500 mb-0.5">كمية إكسسوار</span>
                  <span className="font-bold font-mono text-base">{o.accessoryQty || '0'}</span>
                </div>
                <div className="flex-1 border-l border-slate-400 flex flex-col items-center justify-center p-1">
                  <span className="text-[9px] font-bold text-slate-500 mb-0.5">كمية الحوض</span>
                  <span className="font-bold font-mono text-base"></span>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-1">
                  <span className="text-[9px] font-bold text-slate-500 mb-0.5">الأحواض</span>
                  <span className="font-bold font-mono text-base">{o.batchDeliveries || ''}</span>
                </div>
              </div>
              <div className="w-1/3 grid grid-cols-2 gap-1 p-1 bg-slate-50 font-bold text-xs items-center">
                {[
                  { label: 'مفتوح', checked: false },
                  { label: 'مقفول', checked: false },
                  { label: 'انتــاج', checked: true  },
                  { label: 'عينة',   checked: false },
                ].map(cb => (
                  <div key={cb.label} className="flex items-center gap-1">
                    <div className={`w-4 h-4 border-2 border-slate-800 flex items-center justify-center ${cb.checked ? 'bg-slate-800' : 'bg-white'}`}>
                      {cb.checked && <span className="text-white text-[10px]">✓</span>}
                    </div>
                    {cb.label}
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // ── Certificate / Knitting view — tab bar injected via headerSlot ──
  return (
    <SampleCertificatePage
      order={order}
      clientName={clientName}
      onClose={onClose}
      headerSlot={TabBar}
      activeSection={tab === 'knitting' ? 'knitting' : 'cert'}
      userRole={userRole}
      userName={userName}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FabricReportsPage({ userRole, userName }: { userRole: string; userName?: string }) {
  const [groups,   setGroups]   = useState<FabricGroup[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<FabricGroup | null>(null);
  const [opening,  setOpening]  = useState<{ order: OrderRow; clientName: string; cert: CertEntry } | null>(null);
  const [viewMode, setViewMode] = useState<'fabric' | 'date'>('fabric');
  const [dayFilter, setDayFilter] = useState<'all' | 'today' | '3days' | '7days'>('all');

  // Extracted so it can be re-run when returning from the editor (see onClose
  // below) — otherwise this list only ever reflects data from first mount,
  // and an edit that saved successfully would still look stale on return.
  const loadGroups = useCallback(async () => {
      setLoading(true);
      try {
        // ── 1. Build clientId → name map ─────────────────────────────────
        const clientsSnap = await getDocs(collection(db, 'clients'));
        const clientNames = new Map<string, string>();
        clientsSnap.docs.forEach(d => {
          const data = d.data() as any;
          clientNames.set(d.id, data.name || data.clientName || '');
        });

        // ── 2. Read fast index ────────────────────────────────────────────
        const indexSnap = await getDocs(
          query(collection(db, 'sample_certificates'), orderBy('lastSavedAt', 'desc'))
        );
        const indexMap = new Map<string, CertEntry>();
        indexSnap.docs.forEach(d => indexMap.set(d.id, { orderId: d.id, ...d.data() } as CertEntry));

        // ── 3. Backfill from orders (one-time migration) ──────────────────
        const ordersSnap = await getDocs(query(collectionGroup(db, 'orders')));
        const backfills: Promise<void>[] = [];
        ordersSnap.docs.forEach(d => {
          const orderData   = d.data() as any;
          const cert        = orderData.sampleCertificate;
          if (!cert) return;

          // Resolve client name: stored field → parent doc → clients map → fallback
          const parentClientId  = d.ref.parent?.parent?.id || '';
          const resolvedClient  =
            cert.storedClientName ||
            clientNames.get(parentClientId) ||
            '';

          if (indexMap.has(d.id)) {
            // Update existing index entry if client name was missing
            const existing = indexMap.get(d.id)!;
            if (!existing.clientName && resolvedClient) {
              existing.clientName = resolvedClient;
              indexMap.set(d.id, existing);
              backfills.push(
                setDoc(doc(db, 'sample_certificates', d.id), { clientName: resolvedClient }, { merge: true })
              );
            }
            return;
          }

          const entry: CertEntry = {
            orderId:        d.id,
            clientName:     resolvedClient,
            material:       cert.storedMaterial || orderData.material || '',
            sampleNumber:   cert.sampleNumber   || '',
            date:           cert.date           || '',
            status:         cert.isFinalized ? 'finalized' : 'draft',
            lastSavedAt:    cert.finalizedAt || cert.date || new Date().toISOString(),
            lastSavedBy:    cert.finalizedBy || '', // legacy embedded certs only tracked the finalizer, not draft-time edits
            finalizedAt:    cert.finalizedAt || '',
            finalizedBy:    cert.finalizedBy || '',
            rawWeight:      cert.rawWeight      || '',
            rawWidth:       cert.rawWidth       || '',
            finishedWeight: cert.finishedWeight || '',
            finishedWidth:  cert.finishedWidth  || '',
          };
          indexMap.set(d.id, entry);
          backfills.push(setDoc(doc(db, 'sample_certificates', d.id), entry, { merge: true }));
        });
        if (backfills.length) await Promise.all(backfills);

        // ── 4. Group by material ──────────────────────────────────────────
        const groupMap = new Map<string, CertEntry[]>();
        [...indexMap.values()].forEach(c => {
          const key = c.material || 'غير محدد';
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key)!.push(c);
        });

        const built: FabricGroup[] = [...groupMap.entries()].map(([material, certs]) => ({
          material,
          ...splitMaterial(material),
          certs: certs.sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt)),
        })).sort((a, b) => a.code.localeCompare(b.code));

        setGroups(built);
        // If a fabric's detail view is open, re-point it at the fresh data too —
        // otherwise it keeps showing the pre-edit snapshot it was opened with.
        setSelected(prev => (prev ? (built.find(g => g.material === prev.material) || prev) : prev));
      } finally {
        setLoading(false);
      }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const openCert = (cert: CertEntry) => {
    setOpening({
      cert,
      order: {
        id: cert.orderId, material: cert.material,
        machine: '', requiredQty: 0, accessory: '', manufacturedQty: 0,
        remainingQty: 0, orderReceiptDate: '', startDate: '', endDate: '',
        scrapQty: 0, others: '', notes: '', batchDeliveries: 0, accessoryDeliveries: 0,
      } as OrderRow,
      clientName: cert.clientName,
    });
  };

  const q = search.toLowerCase();
  const filtered = groups.filter(g =>
    !search ||
    g.code.toLowerCase().includes(q) ||
    g.label.toLowerCase().includes(q) ||
    g.material.toLowerCase().includes(q)
  );

  // ── "By Date" view — every report across every fabric, grouped by the day
  //    it was done (finalizedAt for approved certs, lastSavedAt otherwise). ──
  // NOTE: this hook must run on every render — it's declared before the early
  // returns below (if (opening)/if (selected)) so the hook order never changes.
  const dayGroupedCerts = useMemo(() => {
    const now = Date.now();
    const cutoff = dayFilter === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : dayFilter === '3days' ? now - 3 * 86400000
      : dayFilter === '7days' ? now - 7 * 86400000
      : null;

    const flat = groups.flatMap(g => g.certs.map(c => ({
      ...c,
      fabricCode: g.code,
      fabricLabel: g.label,
      displayDate: (c.status === 'finalized' && c.finalizedAt) ? c.finalizedAt : c.lastSavedAt,
    })))
      .filter(c => !search || c.fabricCode.toLowerCase().includes(q) || c.fabricLabel.toLowerCase().includes(q)
        || c.material.toLowerCase().includes(q) || (c.clientName || '').toLowerCase().includes(q))
      .filter(c => c.displayDate && (!cutoff || new Date(c.displayDate).getTime() >= cutoff))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate));

    const groupsByDay = new Map<string, typeof flat>();
    flat.forEach(c => {
      const dayKey = new Date(c.displayDate).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      if (!groupsByDay.has(dayKey)) groupsByDay.set(dayKey, []);
      groupsByDay.get(dayKey)!.push(c);
    });
    return [...groupsByDay.entries()];
  }, [groups, search, dayFilter]);
  const totalDateFiltered = dayGroupedCerts.reduce((s, [, certs]) => s + certs.length, 0);

  if (opening) {
    return (
      <ReportViewer
        order={opening.order}
        clientName={opening.clientName}
        cert={opening.cert}
        onClose={() => { setOpening(null); loadGroups(); }}
        userRole={userRole}
        userName={userName}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DETAIL VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (selected) {
    const finCount  = selected.certs.filter(c => c.status === 'finalized').length;
    const dftCount  = selected.certs.length - finCount;
    return (
      <div style={{ height: '100%', overflowY: 'auto', background: '#f8f9fc' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>

          {/* Back */}
          <button onClick={() => setSelected(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b7280', marginBottom: 28, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ArrowLeft size={14} /> Fabric Archive
          </button>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '4px 10px', borderRadius: 6 }}>
                {selected.code}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: finCount > 0 ? '#059669' : '#d97706', background: finCount > 0 ? '#ecfdf5' : '#fffbeb', border: `1px solid ${finCount > 0 ? '#a7f3d0' : '#fde68a'}`, padding: '4px 10px', borderRadius: 6 }}>
                {finCount > 0 ? `${finCount} Approved` : 'Draft only'}
              </span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.3 }}>{selected.label}</h1>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>{selected.material}</p>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 36 }}>
            {[
              { label: 'Total Records', value: selected.certs.length,  color: '#111827' },
              { label: 'Approved',      value: finCount,               color: '#059669' },
              { label: 'Drafts',        value: dftCount,               color: '#d97706' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 32, fontWeight: 800, color: s.color, margin: '0 0 4px 0' }}>{s.value}</p>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Customer rows */}
          <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>Customer Records</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selected.certs.map(cert => {
              const isFin = cert.status === 'finalized';
              return (
                <div key={cert.orderId}
                  className="group"
                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, transition: 'box-shadow .15s' }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>

                  {/* Status dot */}
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: isFin ? '#10b981' : '#f59e0b', flexShrink: 0 }} />

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
                        {cert.clientName || 'Unknown Client'}
                      </span>
                      {cert.sampleNumber && (
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb', padding: '2px 7px', borderRadius: 5 }}>
                          {cert.sampleNumber}
                        </span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 700, color: isFin ? '#059669' : '#d97706', background: isFin ? '#ecfdf5' : '#fffbeb', padding: '2px 8px', borderRadius: 5 }}>
                        {isFin ? 'Approved' : 'Draft'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
                      {cert.rawWeight      && <span>Raw <strong style={{ color: '#374151' }}>{cert.rawWeight} g/m²</strong></span>}
                      {cert.finishedWeight && <span>Finished <strong style={{ color: '#374151' }}>{cert.finishedWeight} g/m²</strong></span>}
                      {cert.rawWidth       && <span>Width <strong style={{ color: '#374151' }}>{cert.rawWidth} cm</strong></span>}
                      {cert.finishedWidth  && <span>Fin. Width <strong style={{ color: '#374151' }}>{cert.finishedWidth} cm</strong></span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={10} />
                        {isFin && cert.finalizedAt
                          ? new Date(cert.finalizedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
                          : cert.lastSavedAt
                            ? new Date(cert.lastSavedAt).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
                            : '—'}
                      </span>
                    </div>
                  </div>

                  <button onClick={() => openCert(cert)}
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#fff', background: '#111827', border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#111827')}>
                    Open Report <ExternalLink size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  INDEX VIEW
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f8f9fc' }}>
      <div style={{ maxWidth: 1024, margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 36, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 2, margin: '0 0 4px 0' }}>Archive</p>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 4px 0' }}>Fabric Reports</h1>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
              {groups.length} fabric{groups.length !== 1 ? 's' : ''} · {groups.reduce((a, g) => a + g.certs.length, 0)} total records
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* View mode toggle */}
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
              {([['fabric', 'By Fabric'], ['date', 'By Date']] as const).map(([mode, label]) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: viewMode === mode ? '#fff' : 'transparent',
                    color: viewMode === mode ? '#111827' : '#6b7280',
                    boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                placeholder={viewMode === 'date' ? 'Search code, name, or client...' : 'Search code or name...'}
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 36, paddingRight: 16, paddingTop: 10, paddingBottom: 10, fontSize: 13, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.06)', outline: 'none', width: 240 }} />
            </div>
          </div>
        </div>

        {/* Day filter — only relevant in "By Date" mode */}
        {viewMode === 'date' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
            {([['all', 'All Time'], ['today', 'Today'], ['3days', 'Last 3 Days'], ['7days', 'Last 7 Days']] as const).map(([f, label]) => (
              <button key={f} onClick={() => setDayFilter(f)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  border: dayFilter === f ? '1px solid #4f46e5' : '1px solid #e5e7eb',
                  background: dayFilter === f ? '#eef2ff' : '#fff',
                  color: dayFilter === f ? '#4f46e5' : '#6b7280',
                }}>
                <Calendar size={12} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* Grid / Day-grouped list */}
        {viewMode === 'date' ? (
          loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: '#9ca3af' }}>
              <RefreshCw size={16} className="animate-spin" />
              <span style={{ fontSize: 14 }}>Loading archive...</span>
            </div>
          ) : totalDateFiltered === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: '#9ca3af' }}>
              <Calendar size={36} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>No reports in this range</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {dayGroupedCerts.map(([day, certs]) => (
                <div key={day}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{day}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 20 }}>{certs.length}</span>
                    <div style={{ flex: 1, height: 1, background: '#f3f4f6' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {certs.map(cert => {
                      const isFin = cert.status === 'finalized';
                      return (
                        <div key={cert.orderId}
                          style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, transition: 'box-shadow .15s' }}
                          onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)')}
                          onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isFin ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '2px 8px', borderRadius: 5 }}>
                                {cert.fabricCode}
                              </span>
                              <span style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{cert.clientName || 'Unknown Client'}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: isFin ? '#059669' : '#d97706', background: isFin ? '#ecfdf5' : '#fffbeb', padding: '2px 8px', borderRadius: 5 }}>
                                {isFin ? 'Approved' : 'Draft'}
                              </span>
                            </div>
                            <p style={{ fontSize: 12, color: '#6b7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.fabricLabel}</p>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#9ca3af' }}>
                              <Calendar size={10} />
                              {new Date(cert.displayDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {userRole === 'admin' && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: cert.lastSavedBy ? '#b1b8c4' : '#d1d5db', fontStyle: cert.lastSavedBy ? 'normal' : 'italic' }}
                                title={cert.lastSavedBy ? 'Last worked on by' : 'No editor recorded — saved before this was tracked'}>
                                <User size={9} />
                                {cert.lastSavedBy ? cert.lastSavedBy.split('@')[0] : 'unknown'}
                              </span>
                            )}
                          </div>
                          <button onClick={() => openCert(cert)}
                            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#fff', background: '#111827', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                            Open <ExternalLink size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
        loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: '#9ca3af' }}>
            <RefreshCw size={16} className="animate-spin" />
            <span style={{ fontSize: 14 }}>Loading archive...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: '#9ca3af' }}>
            <Package size={36} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{search ? 'No fabrics match your search' : 'No fabrics yet'}</p>
            <p style={{ fontSize: 13, margin: 0, opacity: 0.7 }}>Save a sample certificate — it will appear here automatically</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filtered.map(g => {
              const finalized = g.certs.filter(c => c.status === 'finalized').length;
              const drafts    = g.certs.length - finalized;
              const clients   = [...new Set(g.certs.map(c => c.clientName).filter(Boolean))];
              return (
                <button key={g.material} onClick={() => setSelected(g)}
                  style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '20px 20px 16px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0, transition: 'box-shadow .15s, border-color .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.1)'; e.currentTarget.style.borderColor = '#d1d5db'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e5e7eb'; }}>

                  {/* Top: code + arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '4px 9px', borderRadius: 6 }}>
                      {g.code}
                    </span>
                    <ChevronRight size={14} style={{ color: '#d1d5db' }} />
                  </div>

                  {/* Label */}
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {g.label}
                  </p>

                  {/* Clients */}
                  {clients.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '10px 0 14px' }}>
                      {clients.slice(0, 3).map(c => (
                        <span key={c} style={{ fontSize: 11, color: '#4b5563', background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <User size={9} /> {c}
                        </span>
                      ))}
                      {clients.length > 3 && (
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>+{clients.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid #f3f4f6', paddingTop: 12, marginTop: 'auto' }}>
                    {finalized > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#059669' }}>
                        <CheckCircle2 size={10} /> {finalized} approved
                      </span>
                    )}
                    {drafts > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#d97706' }}>
                        <FileEdit size={10} /> {drafts} draft{drafts > 1 ? 's' : ''}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
                      {g.certs.length} record{g.certs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
        )}
      </div>
    </div>
  );
}
