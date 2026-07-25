import React, { useState, useEffect, useMemo } from 'react';
import { collection, collectionGroup, query, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../services/firebase';
import {
  ArrowLeft, RefreshCw, Layers, TrendingUp, TrendingDown,
  AlertTriangle, Trash2, RotateCcw, ChevronDown, ChevronUp, Beaker, Info,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface YarnRow { type?: string; percentage?: string; feeders?: string; }

interface Cert {
  rawWeight?: string; rawWidth?: string;
  zeroWeight?: string; zeroWidth?: string;
  finishedWeight?: string; finishedWidth?: string;
  yarns?: YarnRow[];
  gauge?: string; gog?: string; stitchLength?: string; feederCount?: string; needleCount?: string;
  storedClientName?: string; storedMaterial?: string;
  sampleNumber?: string; date?: string; isFinalized?: boolean;
  // New Sample mode: multiple recipe attempts within one report. When present,
  // each one becomes its own analysis record — more data points to learn from.
  variants?: { id: string; label?: string; yarns?: YarnRow[]; stitchLength?: string;
    rawWeight?: string; rawWidth?: string; zeroWeight?: string; zeroWidth?: string;
    finishedWeight?: string; finishedWidth?: string }[];
}

interface Recipe {
  cottonCount: number | null;   // Ne 30 / 20
  lycraDenier: number | null;   // 40 / 70
  lycraPct: number | null;      // %
  hasLycra: boolean;
  others: string[];
}

interface Record {
  orderId: string;
  material: string;
  client: string;
  sampleNumber: string;
  date: string;
  finalized: boolean;
  isSample: boolean;
  recipe: Recipe;
  gauge: string; stitchLength: string; feeders: string;
  rawW: number | null; rawWd: number | null;
  zeroW: number | null; zeroWd: number | null;
  finW: number | null; finWd: number | null;
  relaxW: number | null;  relaxWd: number | null;   // Raw → Zero
  finishW: number | null; finishWd: number | null;  // Zero → Finished
  totalW: number | null;  totalWd: number | null;   // Raw → Finished
  hasRaw: boolean; hasZero: boolean; hasFinished: boolean;
  complete: boolean;      // enough to read a zero pattern (raw + zero)
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────────

// Arabic-Indic (٠-٩) and Persian (۰-۹) digits → Latin
const normDigits = (s: string) =>
  s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

const num = (v: any): number | null => {
  if (v == null) return null;
  const n = parseFloat(normDigits(String(v)).replace(/,/g, '').trim());
  return isFinite(n) ? n : null;
};

// signed percent change (new − old) / old × 100
const pctChange = (oldV: number | null, newV: number | null): number | null =>
  oldV != null && newV != null && oldV !== 0 ? ((newV - oldV) / oldV) * 100 : null;

function classifyYarns(yarns: YarnRow[] = []): Recipe {
  let cottonCount: number | null = null;
  let lycraDenier: number | null = null;
  let lycraPct: number | null = null;
  const others: string[] = [];

  for (const y of yarns) {
    const raw = (y.type || '').trim();
    if (!raw) continue;
    const t = normDigits(raw.toLowerCase());
    if (/ليكرا|lycra|spandex|سباندكس|elast/.test(t)) {
      const m = t.match(/(\d{2,3})/);           // denier: 40 / 70
      if (m) lycraDenier = parseInt(m[1], 10);
      const p = num(y.percentage);
      if (p != null) lycraPct = (lycraPct ?? 0) + p;
    } else if (/قطن|كوتن|cotton|ctn|كتن/.test(t)) {
      const m = t.match(/(\d{1,3})/);           // count: 30 / 20  (also "30/1" → 30)
      if (m) cottonCount = parseInt(m[1], 10);
    } else {
      others.push(raw);
    }
  }
  const hasLycra = lycraDenier != null || lycraPct != null;
  return { cottonCount, lycraDenier, lycraPct, hasLycra, others };
}

const recipeLabel = (r: Recipe): string => {
  const cot = r.cottonCount != null ? `Cotton ${r.cottonCount}` : (r.others[0] || 'Unspecified yarn');
  const lyc = r.hasLycra
    ? `Spandex ${r.lycraDenier ?? '?'}${r.lycraPct != null ? ` · ${round1(r.lycraPct)}%` : ''}`
    : 'No spandex';
  return `${cot}  +  ${lyc}`;
};

// group key: cotton count + lycra denier + rounded lycra% band
const recipeKey = (r: Recipe): string =>
  [
    r.cottonCount ?? (r.others[0] || 'x'),
    r.hasLycra ? `L${r.lycraDenier ?? '?'}` : 'NL',
    r.lycraPct != null ? `p${Math.round(r.lycraPct)}` : '',
  ].join('|');

const round1 = (n: number) => Math.round(n * 10) / 10;

const fmtPct = (n: number | null): string =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${round1(n)}%`;

const avg = (arr: (number | null)[]): number | null => {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// tolerant getDocs — a denied/missing collection returns empty instead of rejecting the whole load
const safeGet = (p: Promise<any>): Promise<{ docs: any[] }> =>
  p.then(s => ({ docs: s.docs })).catch(() => ({ docs: [] }));

// ─── Component ───────────────────────────────────────────────────────────────────

export function FabricPatternAnalysis({ userRole, onBack }: { userRole: string; onBack: () => void }) {
  const [records, setRecords] = useState<Record[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [openGroups, setOpenGroups]     = useState<Set<string>>(new Set());

  const isAdmin = userRole === 'admin';

  async function load() {
    setLoading(true);
    try {
      const [ordersSnap, samplesSnap, indexSnap, exclSnap] = await Promise.all([
        safeGet(getDocs(query(collectionGroup(db, 'orders')))),
        safeGet(getDocs(collection(db, 'fabric_samples'))),
        safeGet(getDocs(collection(db, 'sample_certificates'))),
        safeGet(getDocs(collection(db, 'analysis_exclusions'))),
      ]);

      const buildRecord = (id: string, cert: Cert, fallbackMaterial: string, isSample: boolean): Record => {
        const recipe = classifyYarns(cert.yarns);
        const rawW = num(cert.rawWeight),  rawWd = num(cert.rawWidth);
        const zeroW = num(cert.zeroWeight), zeroWd = num(cert.zeroWidth);
        const finW = num(cert.finishedWeight), finWd = num(cert.finishedWidth);
        return {
          orderId:      id,
          material:     cert.storedMaterial || fallbackMaterial || '—',
          client:       cert.storedClientName || (isSample ? 'Original Sample' : ''),
          sampleNumber: cert.sampleNumber || '',
          date:         cert.date || '',
          finalized:    !!cert.isFinalized,
          isSample,
          recipe,
          gauge:        cert.gog || cert.gauge || '',
          stitchLength: cert.stitchLength || '',
          feeders:      cert.feederCount || '',
          rawW, rawWd, zeroW, zeroWd, finW, finWd,
          relaxW:  pctChange(rawW, zeroW),   relaxWd:  pctChange(rawWd, zeroWd),
          finishW: pctChange(zeroW, finW),   finishWd: pctChange(zeroWd, finWd),
          totalW:  pctChange(rawW, finW),    totalWd:  pctChange(rawWd, finWd),
          hasRaw:      rawW != null || rawWd != null,
          hasZero:     zeroW != null || zeroWd != null,
          hasFinished: finW != null || finWd != null,
          complete: (rawW != null && zeroW != null) || (rawWd != null && zeroWd != null),
        };
      };

      const recs: Record[] = [];
      ordersSnap.docs.forEach(d => {
        const data = d.data() as any;
        const cert: Cert | undefined = data.sampleCertificate;
        if (cert) recs.push(buildRecord(d.id, cert, data.material || '', false));
      });
      samplesSnap.docs.forEach(d => {
        const data = d.data() as any;
        const cert: Cert | undefined = data.cert;
        if (!cert) return;
        const fallbackMaterial = data.storedMaterial || data.sampleCode || '';
        if (cert.variants && cert.variants.length) {
          // One analysis record per variant — same sample, different recipe attempts.
          cert.variants.forEach((v, idx) => {
            const label = v.label ? ` — ${v.label}` : (cert.variants!.length > 1 ? ` — #${idx + 1}` : '');
            recs.push(buildRecord(`${d.id}::${v.id}`, {
              ...cert,
              yarns: v.yarns, stitchLength: v.stitchLength,
              rawWeight: v.rawWeight, rawWidth: v.rawWidth,
              zeroWeight: v.zeroWeight, zeroWidth: v.zeroWidth,
              finishedWeight: v.finishedWeight, finishedWidth: v.finishedWidth,
              sampleNumber: (cert.sampleNumber || '') + label,
            }, fallbackMaterial, true));
          });
        } else {
          // Backward compat: old flat-shape sample, pre-variants
          recs.push(buildRecord(d.id, cert, fallbackMaterial, true));
        }
      });

      // Safety net: surface any indexed certificate the full-order read didn't return
      // (e.g. restricted rules). These carry raw/finished only — no zero/yarns.
      const seen = new Set(recs.map(r => r.orderId));
      indexSnap.docs.forEach(d => {
        if (seen.has(d.id)) return;
        const x = d.data() as any;
        recs.push(buildRecord(d.id, {
          rawWeight: x.rawWeight, rawWidth: x.rawWidth,
          finishedWeight: x.finishedWeight, finishedWidth: x.finishedWidth,
          storedMaterial: x.material, storedClientName: x.clientName,
          sampleNumber: x.sampleNumber, date: x.date,
          isFinalized: x.status === 'finalized',
        }, x.material || '', false));
      });

      recs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setRecords(recs);
      setExcluded(new Set(exclSnap.docs.map(d => d.id)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function exclude(orderId: string) {
    if (!isAdmin) return;
    setBusy(orderId);
    try {
      const email = getAuth().currentUser?.email || userRole;
      await setDoc(doc(db, 'analysis_exclusions', orderId), {
        excludedAt: new Date().toISOString(), excludedBy: email,
      });
      setExcluded(prev => new Set(prev).add(orderId));
    } finally { setBusy(null); }
  }

  async function restore(orderId: string) {
    if (!isAdmin) return;
    setBusy(orderId);
    try {
      await deleteDoc(doc(db, 'analysis_exclusions', orderId));
      setExcluded(prev => { const n = new Set(prev); n.delete(orderId); return n; });
    } finally { setBusy(null); }
  }

  const active       = useMemo(() => records.filter(r => !excluded.has(r.orderId)), [records, excluded]);
  const excludedRecs = useMemo(() => records.filter(r => excluded.has(r.orderId)), [records, excluded]);

  // ── Group active records by construction ──
  const groups = useMemo(() => {
    const map = new Map<string, Record[]>();
    active.forEach(r => {
      const k = recipeKey(r.recipe);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });
    return [...map.entries()]
      .map(([key, recs]) => ({
        key,
        label: recipeLabel(recs[0].recipe),
        recipe: recs[0].recipe,
        recs,
        relaxW:  avg(recs.map(r => r.relaxW)),
        relaxWd: avg(recs.map(r => r.relaxWd)),
        finishW: avg(recs.map(r => r.finishW)),
        finishWd: avg(recs.map(r => r.finishWd)),
        withZero: recs.filter(r => r.hasZero).length,
      }))
      .sort((a, b) => b.recs.length - a.recs.length);
  }, [active]);

  const completeCount   = active.filter(r => r.complete).length;
  const incompleteCount = active.length - completeCount;

  const toggleGroup = (k: string) =>
    setOpenGroups(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-3">
        <AlertTriangle size={40} className="opacity-30" />
        <p className="font-semibold">This page is available to admins only</p>
        <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">Back</button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-2">
              <ArrowLeft size={14} /> Fabric Archive
            </button>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5 tracking-tight">
              <Layers size={22} className="text-indigo-600" /> Zero Pattern Analysis
            </h1>
            <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
              Raw → Zero → Finished, grouped by construction (cotton + spandex). Grows automatically with every new report.
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 shadow-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* How to read */}
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
          <p className="text-[13px] text-indigo-900/90 leading-relaxed">
            On relaxation (Raw → Zero), weight should <strong className="text-emerald-700">increase (GSM ▲)</strong> and
            width should <strong className="text-rose-700"> decrease (▼)</strong>. The more spandex — by percentage or
            denier (70 pulls harder than 40) — the larger the shift. Compare a 1-meter sample's zero against its
            construction average below; if they match, the machine settings are correct.
          </p>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total reports',      value: active.length,    color: 'text-slate-900' },
            { label: 'Complete (w/ zero)', value: completeCount,    color: 'text-emerald-600' },
            { label: 'Incomplete',         value: incompleteCount,  color: 'text-amber-600' },
            { label: 'Excluded',           value: excludedRecs.length, color: 'text-rose-600' },
          ].map(t => (
            <div key={t.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm">
              <p className={`text-3xl font-bold ${t.color}`}>{t.value}</p>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-1">{t.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
            <RefreshCw size={18} className="animate-spin" /> Loading reports…
          </div>
        ) : active.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-16 flex flex-col items-center text-slate-400 gap-3">
            <Beaker size={36} className="opacity-30" />
            <p className="font-medium text-slate-500">No reports found</p>
            <p className="text-sm text-slate-400">Save a sample certificate and it will appear here automatically.</p>
          </div>
        ) : (
          <>
            {/* ── Pattern groups ── */}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Patterns by construction — {groups.length} {groups.length === 1 ? 'construction' : 'constructions'}
              </p>
              <div className="space-y-3">
                {groups.map(g => {
                  const open = openGroups.has(g.key);
                  return (
                    <div key={g.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      {/* Group header */}
                      <button onClick={() => toggleGroup(g.key)}
                        className="w-full flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-slate-50 transition-colors text-left">
                        <div className="flex items-center gap-3 min-w-0">
                          {open ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                          <span className="font-semibold text-slate-800 truncate">{g.label}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                            {g.recs.length} {g.recs.length === 1 ? 'report' : 'reports'} · {g.withZero} with zero
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          <Ratio label="Zero wt" value={g.relaxW} good="up" />
                          <Ratio label="Zero width" value={g.relaxWd} good="down" />
                          {g.finishW != null && <Ratio label="Fin wt" value={g.finishW} muted />}
                          {g.finishWd != null && <Ratio label="Fin width" value={g.finishWd} muted />}
                        </div>
                      </button>

                      {/* Predicted-zero hint */}
                      {open && (g.relaxW != null || g.relaxWd != null) && (
                        <div className="px-4 pb-2 -mt-1">
                          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                            Construction average:
                            {g.relaxW != null && <> zero weight ≈ raw weight × <strong className="font-mono text-slate-700">{round1(1 + g.relaxW / 100)}</strong></>}
                            {g.relaxWd != null && <> · zero width ≈ raw width × <strong className="font-mono text-slate-700">{round1(1 + g.relaxWd / 100)}</strong></>}
                          </p>
                        </div>
                      )}

                      {/* Group records table */}
                      {open && (
                        <div className="overflow-x-auto border-t border-slate-100">
                          <RecordsTable recs={g.recs} onExclude={exclude} busy={busy} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Excluded panel ── */}
            {excludedRecs.length > 0 && (
              <div className="bg-white rounded-xl border border-rose-200 overflow-hidden shadow-sm">
                <button onClick={() => setShowExcluded(s => !s)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-rose-50/50 text-left">
                  <span className="font-semibold text-rose-700 flex items-center gap-2">
                    <Trash2 size={15} /> Excluded from analysis ({excludedRecs.length})
                  </span>
                  {showExcluded ? <ChevronUp size={16} className="text-rose-400" /> : <ChevronDown size={16} className="text-rose-400" />}
                </button>
                {showExcluded && (
                  <div className="border-t border-rose-100 divide-y divide-slate-100">
                    {excludedRecs.map(r => (
                      <div key={r.orderId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-700 truncate">{r.material}</span>
                          <span className="text-slate-400 ml-2">· {r.client || '—'}</span>
                        </div>
                        <button onClick={() => restore(r.orderId)} disabled={busy === r.orderId}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 shrink-0">
                          <RotateCcw size={12} /> Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-400 text-center pt-2">
              Excluding a report doesn't delete it — it only hides it from this analysis and can be restored anytime.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

function Ratio({ label, value, good, muted }: { label: string; value: number | null; good?: 'up' | 'down'; muted?: boolean }) {
  if (value == null) return null;
  // "healthy" = weight goes up, width goes down on relaxation
  const healthy = good === 'up' ? value > 0 : good === 'down' ? value < 0 : true;
  const color = muted
    ? 'bg-slate-50 text-slate-500 border-slate-200'
    : healthy
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border font-mono ${color}`}>
      <span className="font-sans">{label}</span>
      <Icon size={11} /> {fmtPct(value)}
    </span>
  );
}

function RecordsTable({ recs, onExclude, busy }: { recs: Record[]; onExclude: (id: string) => void; busy: string | null }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400 bg-slate-50/60">
          {['Client / Sample', 'Gauge · Stitch', 'Raw (wt/wd)', 'Zero (wt/wd)', 'Finished (wt/wd)', 'Raw→Zero', 'Zero→Fin', ''].map((h, i) => (
            <th key={i} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {recs.map(r => (
          <tr key={r.orderId} className="hover:bg-slate-50/50">
            <td className="px-3 py-2">
              <div className="font-medium text-slate-700 flex items-center gap-1.5">
                {r.client || '—'}
                {r.isSample && <span className="text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">SAMPLE</span>}
              </div>
              <div className="text-slate-400 font-mono text-[10px]">{r.sampleNumber || r.material}</div>
            </td>
            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
              {r.gauge || '—'}{r.stitchLength ? ` · ${r.stitchLength}` : ''}
            </td>
            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{cell(r.rawW, r.rawWd)}</td>
            <td className="px-3 py-2 font-mono whitespace-nowrap">
              {r.hasZero
                ? <span className="text-blue-700 font-semibold">{cell(r.zeroW, r.zeroWd)}</span>
                : <span className="text-amber-500 text-[10px]">missing</span>}
            </td>
            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{cell(r.finW, r.finWd)}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              <span className={r.relaxW != null && r.relaxW > 0 ? 'text-emerald-600' : 'text-slate-500'}>{fmtPct(r.relaxW)}</span>
              <span className="text-slate-300"> / </span>
              <span className={r.relaxWd != null && r.relaxWd < 0 ? 'text-rose-600' : 'text-slate-500'}>{fmtPct(r.relaxWd)}</span>
            </td>
            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtPct(r.finishW)} / {fmtPct(r.finishWd)}</td>
            <td className="px-3 py-2 text-right">
              <button onClick={() => onExclude(r.orderId)} disabled={busy === r.orderId}
                title="Exclude from analysis"
                className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                <Trash2 size={13} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// weight / width cell
const cell = (w: number | null, wd: number | null): string => {
  const a = w != null ? `${round1(w)}` : '—';
  const b = wd != null ? `${round1(wd)}` : '—';
  return `${a} / ${b}`;
};
