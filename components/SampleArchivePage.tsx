import React, { useState, useEffect } from 'react';
import { collection, collectionGroup, query, getDocs, orderBy, setDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { OrderRow } from '../types';
import { SampleCertificatePage } from './SampleCertificatePage';
import {
  Archive, Search, CheckCircle2, Calendar, User,
  Ruler, ExternalLink, RefreshCw, FileEdit
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CertIndex {
  orderId: string;
  clientName: string;
  material: string;
  sampleNumber: string;
  date: string;
  status: 'draft' | 'finalized';
  lastSavedAt: string;
  finalizedAt: string;
  finalizedBy: string;
  rawWeight: string;
  rawWidth: string;
  finishedWeight: string;
  finishedWidth: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function SampleArchivePage({ userRole }: { userRole: string }) {
  const [certs, setCerts]     = useState<CertIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<'all' | 'finalized' | 'draft'>('all');
  const [opening, setOpening] = useState<{ order: OrderRow; clientName: string } | null>(null);

  // ── Load: fast index first, then backfill from orders for any that predate the index ──
  useEffect(() => {
    (async () => {
      try {
        // 1. Read the fast index
        const indexSnap = await getDocs(
          query(collection(db, 'sample_certificates'), orderBy('lastSavedAt', 'desc'))
        );
        const indexMap = new Map<string, CertIndex>();
        indexSnap.docs.forEach(d => indexMap.set(d.id, { orderId: d.id, ...d.data() } as CertIndex));

        // 2. Scan orders for certs not yet in the index (one-time migration)
        const ordersSnap = await getDocs(query(collectionGroup(db, 'orders')));
        const backfillWrites: Promise<void>[] = [];

        ordersSnap.docs.forEach(d => {
          const orderData = d.data() as any;
          const cert = orderData.sampleCertificate;
          if (!cert) return;
          if (indexMap.has(d.id)) return; // already indexed

          const entry: CertIndex = {
            orderId:        d.id,
            clientName:     cert.storedClientName || '',
            material:       cert.storedMaterial   || orderData.material || '',
            sampleNumber:   cert.sampleNumber     || '',
            date:           cert.date             || '',
            status:         cert.isFinalized ? 'finalized' : 'draft',
            lastSavedAt:    cert.finalizedAt || cert.date || '',
            finalizedAt:    cert.finalizedAt || '',
            finalizedBy:    cert.finalizedBy || '',
            rawWeight:      cert.rawWeight        || '',
            rawWidth:       cert.rawWidth         || '',
            finishedWeight: cert.finishedWeight   || '',
            finishedWidth:  cert.finishedWidth    || '',
          };
          indexMap.set(d.id, entry);
          // Backfill the index so future loads are instant
          backfillWrites.push(
            setDoc(doc(db, 'sample_certificates', d.id), entry, { merge: true })
          );
        });

        if (backfillWrites.length) await Promise.all(backfillWrites);

        const all = [...indexMap.values()].sort((a, b) =>
          b.lastSavedAt.localeCompare(a.lastSavedAt)
        );
        setCerts(all);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Open a cert: build a minimal stub OrderRow ──
  const openCert = (cert: CertIndex) => {
    const stubOrder: OrderRow = {
      id:              cert.orderId,
      material:        cert.material,
      machine:         '',
      requiredQty:     0,
      accessory:       '',
      manufacturedQty: 0,
      remainingQty:    0,
      orderReceiptDate:'',
      startDate:       '',
      endDate:         '',
      scrapQty:        0,
      others:          '',
      notes:           '',
      batchDeliveries: 0,
      accessoryDeliveries: 0,
    };
    setOpening({ order: stubOrder, clientName: cert.clientName });
  };

  // ── Filters ──
  const filtered = certs.filter(c => {
    if (filter === 'finalized' && c.status !== 'finalized') return false;
    if (filter === 'draft'     && c.status !== 'draft')     return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.material.toLowerCase().includes(q) ||
      c.clientName.toLowerCase().includes(q) ||
      c.sampleNumber.toLowerCase().includes(q)
    );
  });

  const totalFinalized = certs.filter(c => c.status === 'finalized').length;
  const totalDraft     = certs.filter(c => c.status === 'draft').length;

  if (opening) {
    return (
      <SampleCertificatePage
        order={opening.order}
        clientName={opening.clientName}
        onClose={() => setOpening(null)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50"><Archive size={20} className="text-emerald-600" /></div>
              <div>
                <p className="font-bold text-slate-800 text-base">أرشيف شهادات العينات</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={11} /> {totalFinalized} معتمدة
                  </span>
                  <span className="text-xs text-amber-500 font-medium flex items-center gap-1">
                    <FileEdit size={11} /> {totalDraft} مسودة
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Status filter */}
              {(['all','finalized','draft'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${filter === f
                    ? f === 'finalized' ? 'bg-emerald-600 text-white border-emerald-600'
                      : f === 'draft'  ? 'bg-amber-500  text-white border-amber-500'
                      : 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {f === 'all' ? 'الكل' : f === 'finalized' ? 'معتمدة' : 'مسودات'}
                </button>
              ))}

              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input dir="rtl" placeholder="بحث..."
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="pr-8 pl-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none transition-all w-44" />
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
            <RefreshCw size={18} className="animate-spin" /> جاري التحميل...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-20 flex flex-col items-center text-slate-400 gap-3">
            <Archive size={40} className="opacity-20" />
            <p className="text-base font-medium">{search || filter !== 'all' ? 'لا نتائج مطابقة' : 'لا توجد شهادات بعد'}</p>
            <p className="text-sm opacity-70">افتح شهادة من صفحة الطلبات وابدأ التعبئة — ستظهر هنا تلقائياً</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(cert => {
              const isFinalized = cert.status === 'finalized';
              return (
                <div key={cert.orderId}
                  className={`bg-white rounded-xl border hover:shadow-md transition-all overflow-hidden group ${isFinalized ? 'border-emerald-200 hover:border-emerald-300' : 'border-amber-200 hover:border-amber-300'}`}>

                  {/* Status stripe */}
                  <div className={`h-1 ${isFinalized ? 'bg-emerald-500' : 'bg-amber-400'}`} />

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 truncate">{cert.material || '—'}</span>
                          {cert.sampleNumber && (
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-mono">{cert.sampleNumber}</span>
                          )}
                          {isFinalized ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <CheckCircle2 size={10} /> معتمدة
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              <FileEdit size={10} /> مسودة
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1">
                          <User size={12} />{cert.clientName || '—'}
                        </p>
                      </div>
                      <button onClick={() => openCert(cert)}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors opacity-0 group-hover:opacity-100 ${isFinalized
                          ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                          : 'text-amber-700  bg-amber-50  hover:bg-amber-100  border-amber-200'}`}>
                        <ExternalLink size={12} /> فتح
                      </button>
                    </div>

                    {/* Measurements */}
                    {(cert.rawWeight || cert.finishedWeight || cert.rawWidth || cert.finishedWidth) && (
                      <div className="flex items-center gap-3 mb-3 text-xs text-slate-500 flex-wrap">
                        <Ruler size={11} className="shrink-0" />
                        {cert.rawWeight      && <span>خام: <strong className="text-slate-700">{cert.rawWeight} g</strong></span>}
                        {cert.finishedWeight && <span>جاهز: <strong className="text-slate-700">{cert.finishedWeight} g</strong></span>}
                        {cert.rawWidth       && <span>عرض خام: <strong className="text-slate-700">{cert.rawWidth} cm</strong></span>}
                        {cert.finishedWidth  && <span>عرض جاهز: <strong className="text-slate-700">{cert.finishedWidth} cm</strong></span>}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 pt-3 mt-1">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {isFinalized && cert.finalizedAt
                          ? new Date(cert.finalizedAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
                          : cert.lastSavedAt
                            ? 'آخر حفظ ' + new Date(cert.lastSavedAt).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })
                            : '—'}
                      </span>
                      {isFinalized && cert.finalizedBy && (
                        <span className="flex items-center gap-1"><User size={11} />{cert.finalizedBy}</span>
                      )}
                    </div>
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
