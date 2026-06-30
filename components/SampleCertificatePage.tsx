import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collectionGroup, collection, query, getDocs, updateDoc, setDoc, doc, where, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { db, storage } from '../services/firebase';
import { OrderRow } from '../types';
import {
  X, Printer, Plus, Minus, Trash2, ChevronDown, ChevronUp,
  RefreshCw, CheckCircle2, Ruler, Cpu, Layers, Droplets,
  FlaskConical, Image as ImageIcon, Sparkles, Upload
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CamStitch = 'knit' | 'tuck' | 'miss';

interface TathbeetData {
  timing: 'before' | 'after' | 'both';
  beforeWidth: string;
  beforeGsm: string;
  afterWidth: string;
  afterGsm: string;
}

const EMPTY_TATHBEET: TathbeetData = { timing: 'after', beforeWidth: '', beforeGsm: '', afterWidth: '', afterGsm: '' };

interface YarnRow {
  id: string;
  type: string;
  lotNumber: string;
  cones: string;
  percentage: string;
  yarnDetail: string;
  twistCount: string;
  feeders: string;
}

interface SampleCertData {
  sampleNumber: string;
  date: string;
  rawWeight: string; rawWidth: string;
  zeroWeight: string; zeroWidth: string;
  finishedWeight: string; finishedWidth: string;
  shrinkageLength: string; shrinkageWidth: string;
  swatchImageUrl: string;
  machineName: string; machineType: string; gauge: string; gog: string;
  needleCount: string; feederCount: string; centralGauge: string;
  dialHeight: string; tensionerGauge: string; tara: string;
  cylinderGauge: string; dialGauge: string; stitchLength: string; visco: string;
  yarns: YarnRow[];
  // Needle arrangement
  needleBedType: 'single' | 'double'; // single = cylinder only; double = dial + cylinder
  needleColumns: number;
  needleDialTracks: number;     // 2–4
  needleCylTracks: number;      // 2–4
  needleTracks: Record<string, boolean[]>;
  // Cam arrangement
  camBedType: 'single' | 'double';
  camColumns: number;
  camDialTracks: number;        // 2–4
  camCylTracks: number;         // 2–4
  camTracks: Record<string, CamStitch[]>;
  dyehouseSteps: Record<string, boolean>;
  tathbeet: TathbeetData;
  dyehouseNotes: string;
  // Archive / finalization
  storedClientName: string;
  storedMaterial: string;
  isFinalized: boolean;
  finalizedAt: string;
  finalizedBy: string;
}

const DEFAULT_NEEDLE_COLS = 12;
const DEFAULT_CAM_COLS    = 8;

const NEEDLE_TRACKS = ['d1','d2','d3','d4','c1','c2','c3','c4'] as const;
const CAM_TRACKS    = ['d4','d3','d2','d1','c1','c2','c3','c4'] as const;

const NEEDLE_TRACK_LABELS: Record<string, string> = {
  'd1': 'د تراك 1', 'd2': 'د تراك 2', 'd3': 'د تراك 3', 'd4': 'د تراك 4',
  'c1': 'س تراك 1', 'c2': 'س تراك 2', 'c3': 'س تراك 3', 'c4': 'س تراك 4',
};

const makeNeedleTracks = (cols: number): Record<string, boolean[]> =>
  Object.fromEntries(NEEDLE_TRACKS.map(t => [t, Array(cols).fill(false)]));

const makeCamTracks = (cols: number): Record<string, CamStitch[]> =>
  Object.fromEntries(CAM_TRACKS.map(t => [t, Array<CamStitch>(cols).fill('knit')]));

const EMPTY_CERT: SampleCertData = {
  sampleNumber: '', date: new Date().toISOString().split('T')[0],
  rawWeight: '', rawWidth: '', zeroWeight: '', zeroWidth: '',
  finishedWeight: '', finishedWidth: '', shrinkageLength: '', shrinkageWidth: '',
  swatchImageUrl: '',
  machineName: '', machineType: '', gauge: '', gog: '', needleCount: '',
  feederCount: '', centralGauge: '', dialHeight: '', tensionerGauge: '', tara: '',
  cylinderGauge: '', dialGauge: '', stitchLength: '', visco: '',
  yarns: [],
  needleBedType:    'single',
  needleColumns:    DEFAULT_NEEDLE_COLS,
  needleDialTracks: 4,
  needleCylTracks:  4,
  needleTracks:     makeNeedleTracks(DEFAULT_NEEDLE_COLS),
  camBedType:       'single',
  camColumns:       DEFAULT_CAM_COLS,
  camDialTracks:    4,
  camCylTracks:     4,
  camTracks:        makeCamTracks(DEFAULT_CAM_COLS),
  dyehouseSteps: {
    'تثبيت': false, 'صباغة': false, 'انزيم': false, 'كسر بياض': false,
    'عصارة': false, 'مجفف': false, 'رام': false, 'كسترة': false,
    'كربون': false, 'كومبكتور': false, 'قص براسل وتصميغ': false,
  },
  tathbeet:         { ...EMPTY_TATHBEET },
  dyehouseNotes:    '',
  storedClientName: '',
  storedMaterial:   '',
  isFinalized:      false,
  finalizedAt:      '',
  finalizedBy:      '',
};

// ─── SVG stitch symbols ───────────────────────────────────────────────────────

const KnitIcon = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" className="pointer-events-none">
    <polygon points="10,16 2,4 18,4" fill="currentColor" />
  </svg>
);
const TuckIcon = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" className="pointer-events-none">
    <path d="M3,4 L3,13 L17,13 L17,4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
  </svg>
);
const MissIcon = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" className="pointer-events-none">
    <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const CAM_CONFIG: Record<CamStitch, { label: string; Icon: React.FC; bg: string; text: string; border: string }> = {
  knit: { label: 'عادي (Knit)',     Icon: KnitIcon, bg: 'bg-white',     text: 'text-slate-700', border: 'border-slate-300' },
  tuck: { label: 'نصف طلعة (Tuck)', Icon: TuckIcon, bg: 'bg-blue-50',   text: 'text-blue-700',  border: 'border-blue-400'  },
  miss: { label: 'لغي (Miss)',      Icon: MissIcon, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-400' },
};
const CAM_CYCLE: CamStitch[] = ['knit', 'tuck', 'miss'];

// ─── Small cells ──────────────────────────────────────────────────────────────

/** Needle cell — dot when needle present, empty when absent */
function NeedleCell({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={active ? 'إبرة موجودة' : 'فراغ'}
      className={`w-7 h-7 rounded border-2 flex items-center justify-center transition-all hover:scale-110 active:scale-95 select-none
        ${active
          ? 'bg-slate-800 border-slate-800 text-white'
          : 'bg-white border-slate-300 hover:border-slate-400'}`}
    >
      {active && (
        <svg viewBox="0 0 10 10" width="8" height="8" className="pointer-events-none">
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

/** Cam cell — cycles knit/tuck/miss */
function CamCell({ value, onClick }: { value: CamStitch; onClick: () => void }) {
  const cfg = CAM_CONFIG[value];
  return (
    <button
      onClick={onClick}
      title={cfg.label}
      className={`w-7 h-7 rounded border-2 flex items-center justify-center transition-all hover:scale-110 active:scale-95 select-none ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <cfg.Icon />
    </button>
  );
}

// ─── Shared column-count control ──────────────────────────────────────────────
function ColControl({ count, onAdd, onRemove, label }: {
  count: number; onAdd: () => void; onRemove: () => void; label?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-xs font-semibold text-slate-600">{label}</span>}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
        <button onClick={onRemove} disabled={count <= 1}
          className="p-0.5 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"><Minus size={13} /></button>
        <span className="text-sm font-bold text-slate-700 w-6 text-center">{count}</span>
        <button onClick={onAdd}
          className="p-0.5 text-slate-400 hover:text-emerald-600 transition-colors"><Plus size={13} /></button>
      </div>
      <span className="text-xs text-slate-400">أضف أعمدة حسب الحاجة</span>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ id, title, subtitle, icon, accent, children, defaultOpen = true }: {
  id: string; title: string; subtitle: string; icon: React.ReactNode;
  accent: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${accent}`}>{icon}</div>
          <div className="text-right">
            <p className="font-bold text-slate-800 text-base">{title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function Field({ label, sublabel, children, className = '' }: {
  label: string; sublabel?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-semibold text-slate-600 leading-tight">
        {label}{sublabel && <span className="text-slate-400 font-normal ml-1 text-[11px]">({sublabel})</span>}
      </label>
      {children}
    </div>
  );
}

function Input({ unit, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  return (
    <div className="relative">
      <input {...props} dir="rtl"
        className={`w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm text-slate-800 transition-all ${unit ? 'pr-10' : ''} ${className}`} />
      {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{unit}</span>}
    </div>
  );
}

// ─── Tathbeet measurement fields — must be module-level so React doesn't
//     unmount/remount on every parent re-render (which kills input focus)
function TathbeetMeasFields({ prefix, label, tathbeet, onChange }: {
  prefix: 'before' | 'after';
  label: string;
  tathbeet: TathbeetData;
  onChange: (patch: Partial<TathbeetData>) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-teal-100 p-4 space-y-3">
      <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="العرض" sublabel="cm">
          <Input type="number" unit="cm" placeholder="0"
            value={(tathbeet as any)[`${prefix}Width`]}
            onChange={e => onChange({ [`${prefix}Width`]: e.target.value } as any)} />
        </Field>
        <Field label="الجرام" sublabel="g/m²">
          <Input type="number" unit="g" placeholder="0"
            value={(tathbeet as any)[`${prefix}Gsm`]}
            onChange={e => onChange({ [`${prefix}Gsm`]: e.target.value } as any)} />
        </Field>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SampleCertificatePage({ order, clientName, onClose, headerSlot, machines: machinesProp, activeSection = 'cert', userRole }: {
  order: OrderRow; clientName: string; onClose: () => void;
  headerSlot?: React.ReactNode;
  machines?: any[];
  activeSection?: 'cert' | 'knitting';
  userRole?: string;
}) {
  const [data, setData]      = useState<SampleCertData>({ ...EMPTY_CERT });
  const [saveStatus, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploading, setUploading] = useState(false);
  const [orderedGsm,   setOrderedGsm]   = useState<number | null>(null);
  const [orderedWidth, setOrderedWidth] = useState<number | null>(null);
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderRef   = useRef<any>(null);
  const fabricRef  = useRef<any>(null);

  const canEditCert     = ['admin', 'machine_technician'].includes(userRole ?? '');
  const canEditKnitting = ['admin', 'factory_manager'].includes(userRole ?? '');
  const imgInput   = useRef<HTMLInputElement>(null);

  // ── Load Firestore data + auto-fill yarn ──
  useEffect(() => {
    (async () => {
      // Load yarns collection to resolve yarnId → readable name
      const yarnSnap = await getDocs(collection(db, 'yarns'));
      const yarnMap: Record<string, string> = {};
      yarnSnap.docs.forEach(d => {
        const data = d.data() as any;
        const name = data.name || d.id;
        yarnMap[d.id] = name;
        if (data.yarnId) yarnMap[data.yarnId] = name;
      });

      // Load order document first, then fetch machine specs using the machine name from the doc
      const snap = await getDocs(query(collectionGroup(db, 'orders')));
      const docSnap = snap.docs.find(d => d.id === order.id);
      if (!docSnap) return;
      orderRef.current = docSnap.ref;

      // Read full order data from Firestore — fills in fields missing from the stub (e.g. from archive)
      const fullOrderData = docSnap.data() as any;
      if (fullOrderData.requiredGsm   != null) setOrderedGsm(fullOrderData.requiredGsm);
      if (fullOrderData.requiredWidth != null) setOrderedWidth(fullOrderData.requiredWidth);
      const machineName = order.machine || fullOrderData.machine || '';
      const yarnAllocations = order.yarnAllocations ?? fullOrderData.yarnAllocations ?? {};

      const machSnap = machineName
        ? await getDocs(query(collection(db, 'MachineSS'), where('name', '==', machineName)))
        : null;

      // Build machine spec overrides (only fill fields that are still empty)
      type MachineDefaults = Partial<Pick<SampleCertData, 'machineName'|'machineType'|'gauge'|'gog'|'needleCount'|'feederCount'>>;
      let machineDefaults: MachineDefaults = {};
      const firestoreMachine = machSnap && !machSnap.empty ? machSnap.docs[0].data() as any : null;
      const propMachine = machinesProp?.find((mm: any) => mm.name === machineName || mm.machineName === machineName);
      const m = firestoreMachine || propMachine || null;
      if (m) {
        machineDefaults = {
          machineName:  machineName,
          machineType:  m.type    || '',
          gauge:        m.dia     != null ? String(m.dia)     : '',
          gog:          m.gauge   != null ? String(m.gauge)   : '',
          needleCount:  m.needles != null ? String(m.needles) : '',
          feederCount:  m.feeders != null ? String(m.feeders) : '',
        };
      }

      // Cache fabric doc reference — try exact name match first, then fall back to code in brackets
      const fabricSnapName = await getDocs(query(collection(db, 'FabricSS'), where('name', '==', order.material)));
      if (!fabricSnapName.empty) {
        fabricRef.current = fabricSnapName.docs[0].ref;
      } else {
        const codeMatch = order.material?.match(/\[([^\]]+)\]/);
        if (codeMatch) {
          const fabricSnapCode = await getDocs(query(collection(db, 'FabricSS'), where('code', '==', codeMatch[1].trim())));
          if (!fabricSnapCode.empty) fabricRef.current = fabricSnapCode.docs[0].ref;
        }
      }

      const saved = fullOrderData.sampleCertificate as Partial<SampleCertData> | undefined;

      // Build yarn rows: always sync from yarnAllocations (source of truth for which yarns exist),
      // then overlay any user-entered data from the previously saved cert rows.
      const savedYarnMap: Record<string, YarnRow> = {};
      (saved?.yarns ?? []).forEach((y: any) => { savedYarnMap[y.id] = { lotNumber: '', ...y }; });

      let yarns: YarnRow[] = [];
      if (yarnAllocations && Object.keys(yarnAllocations).length) {
        yarns = Object.entries(yarnAllocations).map(([yarnId, allocs]) => {
          const prev = savedYarnMap[yarnId];
          return {
            id: yarnId,
            type: prev?.type || yarnMap[yarnId] || yarnId,
            lotNumber: prev?.lotNumber || (allocs as any[]).map((a: any) => a.lotNumber).filter(Boolean).join(', '),
            cones:      prev?.cones      ?? '',
            percentage: prev?.percentage ?? '',
            yarnDetail: prev?.yarnDetail ?? '',
            twistCount: prev?.twistCount ?? '',
            feeders:    prev?.feeders    ?? '',
          };
        });
      } else {
        yarns = Object.values(savedYarnMap);
      }
      if (!yarns.length) {
        yarns = [{ id: '1', type: '', lotNumber: '', cones: '', percentage: '', yarnDetail: '', twistCount: '', feeders: '' }];
      }

      if (saved) {
        setData({
          ...EMPTY_CERT,
          // Apply machine defaults first, then saved data wins (so manual edits always take priority)
          ...machineDefaults,
          ...saved,
          // Re-apply machine defaults only for fields still empty after saved data
          machineName:  saved.machineName  || machineDefaults.machineName  || '',
          machineType:  saved.machineType  || machineDefaults.machineType  || '',
          gauge:        saved.gauge        || machineDefaults.gauge        || '',
          gog:          saved.gog          || machineDefaults.gog          || '',
          needleCount:  saved.needleCount  || machineDefaults.needleCount  || '',
          feederCount:  saved.feederCount  || machineDefaults.feederCount  || '',
          yarns,
          // always keep identity fields current
          storedClientName: clientName,
          storedMaterial:   order.material,
          dyehouseSteps:    { ...EMPTY_CERT.dyehouseSteps, ...(saved.dyehouseSteps || {}) },
          tathbeet:         { ...EMPTY_TATHBEET, ...(saved.tathbeet || {}) },
          needleTracks:     { ...makeNeedleTracks(saved.needleColumns ?? DEFAULT_NEEDLE_COLS), ...(saved.needleTracks || {}) },
          camTracks:        { ...makeCamTracks(saved.camColumns ?? DEFAULT_CAM_COLS),          ...(saved.camTracks    || {}) },
          needleColumns:    saved.needleColumns    ?? DEFAULT_NEEDLE_COLS,
          camColumns:       saved.camColumns       ?? DEFAULT_CAM_COLS,
          needleBedType:    saved.needleBedType    ?? 'single',
          needleDialTracks: saved.needleDialTracks ?? 4,
          needleCylTracks:  saved.needleCylTracks  ?? 4,
          camBedType:       saved.camBedType       ?? 'single',
          camDialTracks:    saved.camDialTracks     ?? 4,
          camCylTracks:     saved.camCylTracks      ?? 4,
          isFinalized:      saved.isFinalized      ?? false,
          finalizedAt:      saved.finalizedAt      ?? '',
          finalizedBy:      saved.finalizedBy      ?? '',
        });
      } else {
        // New cert — seed machine specs + needle/cam structure from fabric if available
        const fabricData = fabricRef.current ? (await getDoc(fabricRef.current)).data() as any : null;
        const bedTypeKey = (machineDefaults.machineType || '').toLowerCase().includes('double') ? 'double' : 'single';
        const savedStructure = fabricData?.needleCamStructure?.[bedTypeKey];
        setData(prev => ({
          ...prev,
          ...machineDefaults,
          yarns,
          storedClientName: clientName,
          storedMaterial:   order.material,
          ...(savedStructure ? {
            needleBedType:    savedStructure.needleBedType    ?? prev.needleBedType,
            needleColumns:    savedStructure.needleColumns    ?? prev.needleColumns,
            needleDialTracks: savedStructure.needleDialTracks ?? prev.needleDialTracks,
            needleCylTracks:  savedStructure.needleCylTracks  ?? prev.needleCylTracks,
            needleTracks:     { ...makeNeedleTracks(savedStructure.needleColumns ?? DEFAULT_NEEDLE_COLS), ...(savedStructure.needleTracks || {}) },
            camBedType:       savedStructure.camBedType       ?? prev.camBedType,
            camColumns:       savedStructure.camColumns       ?? prev.camColumns,
            camDialTracks:    savedStructure.camDialTracks    ?? prev.camDialTracks,
            camCylTracks:     savedStructure.camCylTracks     ?? prev.camCylTracks,
            camTracks:        { ...makeCamTracks(savedStructure.camColumns ?? DEFAULT_CAM_COLS), ...(savedStructure.camTracks || {}) },
          } : {}),
        }));
      }
    })();
  }, [order.id]);

  // ── Auto-save ──
  const scheduleSave = useCallback((next: SampleCertData) => {
    if (!canEditCert && !canEditKnitting) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSave('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        if (!orderRef.current) {
          const snap = await getDocs(query(collectionGroup(db, 'orders')));
          const d = snap.docs.find(d => d.id === order.id);
          if (d) orderRef.current = d.ref;
        }
        if (orderRef.current) {
          await updateDoc(orderRef.current, { sampleCertificate: next });
          // Write needle/cam structure back to fabric doc so future reports start pre-filled
          if (fabricRef.current) {
            const bedTypeKey = next.needleBedType || 'single';
            await setDoc(fabricRef.current, {
              needleCamStructure: {
                [bedTypeKey]: {
                  needleBedType:    next.needleBedType,
                  needleColumns:    next.needleColumns,
                  needleDialTracks: next.needleDialTracks,
                  needleCylTracks:  next.needleCylTracks,
                  needleTracks:     next.needleTracks,
                  camBedType:       next.camBedType,
                  camColumns:       next.camColumns,
                  camDialTracks:    next.camDialTracks,
                  camCylTracks:     next.camCylTracks,
                  camTracks:        next.camTracks,
                },
              },
            }, { merge: true });
          }
          // Keep the dedicated index in sync (fast reads for archive)
          await setDoc(doc(db, 'sample_certificates', order.id), {
            orderId:        order.id,
            clientName:     next.storedClientName || clientName,
            material:       next.storedMaterial   || order.material,
            sampleNumber:   next.sampleNumber,
            date:           next.date,
            status:         next.isFinalized ? 'finalized' : 'draft',
            lastSavedAt:    new Date().toISOString(),
            finalizedAt:    next.finalizedAt    || '',
            finalizedBy:    next.finalizedBy    || '',
            rawWeight:      next.rawWeight,
            rawWidth:       next.rawWidth,
            finishedWeight: next.finishedWeight,
            finishedWidth:  next.finishedWidth,
          }, { merge: true });
          setSave('saved');
          setTimeout(() => setSave('idle'), 2000);
        }
      } catch { setSave('error'); }
    }, 1500);
  }, [order.id, clientName, order.material]);

  const update = useCallback(<K extends keyof SampleCertData>(key: K, value: SampleCertData[K]) => {
    setData(prev => { const next = { ...prev, [key]: value }; scheduleSave(next); return next; });
  }, [scheduleSave]);

  // ── Finalize ──
  const [finalizing, setFinalizing] = useState(false);
  const handleFinalize = async () => {
    if (finalizing) return;
    setFinalizing(true);
    try {
      if (!orderRef.current) {
        const snap = await getDocs(query(collectionGroup(db, 'orders')));
        const d = snap.docs.find(d => d.id === order.id);
        if (d) orderRef.current = d.ref;
      }
      if (!orderRef.current) return;
      const next: SampleCertData = {
        ...data,
        storedClientName: clientName,
        storedMaterial:   order.material,
        isFinalized:      true,
        finalizedAt:      new Date().toISOString(),
        finalizedBy:      getAuth().currentUser?.email || 'Unknown',
      };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await updateDoc(orderRef.current, { sampleCertificate: next });
      // Update the index collection immediately on finalize
      await setDoc(doc(db, 'sample_certificates', order.id), {
        orderId:        order.id,
        clientName:     clientName,
        material:       order.material,
        sampleNumber:   next.sampleNumber,
        date:           next.date,
        status:         'finalized',
        lastSavedAt:    next.finalizedAt,
        finalizedAt:    next.finalizedAt,
        finalizedBy:    next.finalizedBy,
        rawWeight:      next.rawWeight,
        rawWidth:       next.rawWidth,
        finishedWeight: next.finishedWeight,
        finishedWidth:  next.finishedWidth,
      }, { merge: true });
      setData(next);
      setSave('saved');
      setTimeout(() => setSave('idle'), 2000);
    } finally { setFinalizing(false); }
  };

  // ── Swatch image ──
  const uploadSwatch = async (file: File) => {
    setUploading(true);
    try {
      const r = ref(storage, `sampleCertificates/${order.id}/swatch-${Date.now()}`);
      await uploadBytes(r, file);
      update('swatchImageUrl', await getDownloadURL(r));
    } finally { setUploading(false); }
  };

  // ── Needle helpers ──
  const toggleNeedle = (track: string, i: number) => {
    setData(prev => {
      const cells = [...(prev.needleTracks[track] || Array(prev.needleColumns).fill(false))];
      cells[i] = !cells[i];
      const next = { ...prev, needleTracks: { ...prev.needleTracks, [track]: cells } };
      scheduleSave(next);
      return next;
    });
  };

  const addNeedleCol = () => setData(prev => {
    const cols = prev.needleColumns + 1;
    const tracks: Record<string, boolean[]> = {};
    NEEDLE_TRACKS.forEach(t => { tracks[t] = [...(prev.needleTracks[t] || Array(prev.needleColumns).fill(false)), false]; });
    const next = { ...prev, needleColumns: cols, needleTracks: tracks };
    scheduleSave(next); return next;
  });

  const removeNeedleCol = () => setData(prev => {
    if (prev.needleColumns <= 1) return prev;
    const cols = prev.needleColumns - 1;
    const tracks: Record<string, boolean[]> = {};
    NEEDLE_TRACKS.forEach(t => { tracks[t] = (prev.needleTracks[t] || []).slice(0, cols); });
    const next = { ...prev, needleColumns: cols, needleTracks: tracks };
    scheduleSave(next); return next;
  });

  // ── Cam helpers ──
  const cycleCam = (track: string, i: number) => {
    setData(prev => {
      const cells = [...(prev.camTracks[track] || Array(prev.camColumns).fill('knit'))] as CamStitch[];
      cells[i] = CAM_CYCLE[(CAM_CYCLE.indexOf(cells[i]) + 1) % CAM_CYCLE.length];
      const next = { ...prev, camTracks: { ...prev.camTracks, [track]: cells } };
      scheduleSave(next); return next;
    });
  };

  const addCamCol = () => setData(prev => {
    const cols = prev.camColumns + 1;
    const tracks: Record<string, CamStitch[]> = {};
    CAM_TRACKS.forEach(t => { tracks[t] = [...(prev.camTracks[t] || Array(prev.camColumns).fill('knit')), 'knit'] as CamStitch[]; });
    const next = { ...prev, camColumns: cols, camTracks: tracks };
    scheduleSave(next); return next;
  });

  const removeCamCol = () => setData(prev => {
    if (prev.camColumns <= 1) return prev;
    const cols = prev.camColumns - 1;
    const tracks: Record<string, CamStitch[]> = {};
    CAM_TRACKS.forEach(t => { tracks[t] = (prev.camTracks[t] || []).slice(0, cols) as CamStitch[]; });
    const next = { ...prev, camColumns: cols, camTracks: tracks };
    scheduleSave(next); return next;
  });

  // ── Yarn helpers ──
  const updateYarn = (id: string, field: keyof YarnRow, val: string) =>
    update('yarns', data.yarns.map(y => y.id === id ? { ...y, [field]: val } : y));
  const addYarn = () =>
    update('yarns', [...data.yarns, { id: Date.now().toString(), type: '', lotNumber: '', cones: '', percentage: '', yarnDetail: '', twistCount: '', feeders: '' }]);
  const removeYarn = (id: string) => {
    if (data.yarns.length <= 1) return;
    update('yarns', data.yarns.filter(y => y.id !== id));
  };

  const autoShrinkLen   = data.rawWeight && data.finishedWeight ? (((+data.rawWeight - +data.finishedWeight) / +data.rawWeight) * 100).toFixed(1) + '%' : '';
  const autoShrinkWidth = data.rawWidth  && data.finishedWidth  ? (((+data.rawWidth  - +data.finishedWidth)  / +data.rawWidth)  * 100).toFixed(1) + '%' : '';

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className={`border-b px-4 py-3 flex items-center justify-between gap-4 flex-shrink-0 transition-colors ${data.isFinalized ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><X size={20} /></button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={16} className={data.isFinalized ? 'text-emerald-500' : 'text-indigo-500'} />
              <span className="font-bold text-slate-800 text-base">
                {activeSection === 'knitting' ? 'Knitting Structure' : 'Sample Certificate'}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-sm text-slate-600">{order.material}</span>
              {data.isFinalized && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                  <CheckCircle2 size={11} /> معتمدة
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {clientName}
              {data.isFinalized && data.finalizedAt && (
                <span className="mr-2 text-emerald-500">· اعتمدت {new Date(data.finalizedAt).toLocaleDateString('ar-EG')}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!canEditCert && activeSection !== 'knitting' && (
            <span className="px-2.5 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg text-xs font-bold">View Only</span>
          )}
          {!canEditKnitting && activeSection === 'knitting' && (
            <span className="px-2.5 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg text-xs font-bold">View Only</span>
          )}
          {canEditCert && <span className="text-sm">
            {saveStatus === 'saving' && <span className="text-slate-400 flex items-center gap-1"><RefreshCw size={13} className="animate-spin" /> حفظ...</span>}
            {saveStatus === 'saved'  && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} /> تم الحفظ</span>}
            {saveStatus === 'error'  && <span className="text-red-500 text-xs">خطأ في الحفظ</span>}
          </span>}
          {canEditCert && !data.isFinalized && (
            <button onClick={handleFinalize} disabled={finalizing}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {finalizing ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              اعتماد نهائي
            </button>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
            <Printer size={15} /> طباعة
          </button>
        </div>
      </div>

      {headerSlot}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className={`${activeSection === 'knitting' ? 'w-full px-6' : 'max-w-4xl mx-auto px-4'} py-6 space-y-4`}>

          {activeSection === 'cert' && <div className={!canEditCert ? 'pointer-events-none select-none opacity-60' : ''}>
          {/* 1 · Header */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-indigo-50"><Sparkles size={16} className="text-indigo-600" /></div>
              <div>
                <p className="font-bold text-slate-800">بيانات العينة</p>
                <p className="text-xs text-slate-400">الحقول الملونة تعبأ تلقائياً من الطلب</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="اسم العميل">
                <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-800 font-medium">{clientName}</div>
              </Field>
              <Field label="اسم الخامة">
                <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-800 font-medium">{order.material}</div>
              </Field>
              <Field label="رقم العينة">
                <Input placeholder="S-001" value={data.sampleNumber} onChange={e => update('sampleNumber', e.target.value)} />
              </Field>
              <Field label="التاريخ">
                <Input type="date" value={data.date} onChange={e => update('date', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* 2 · Measurements */}
          <Section id="measurements" title="المقاسات" subtitle="خام · زيرو · جاهز"
            icon={<Ruler size={16} className="text-amber-600" />} accent="bg-amber-50">
            <div className="pt-4 space-y-4">

              {/* Ordered spec reference — fetched from order */}
              {(orderedGsm != null || orderedWidth != null) && (
                <div className="flex items-center gap-4 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide shrink-0">مواصفة العميل المطلوبة</span>
                  <div className="flex items-center gap-4 mr-2">
                    {orderedGsm != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-indigo-500">الوزن:</span>
                        <span className="text-sm font-bold text-indigo-800 font-mono">{orderedGsm} <span className="text-xs font-normal">g/m²</span></span>
                      </div>
                    )}
                    {orderedGsm != null && orderedWidth != null && <span className="w-px h-4 bg-indigo-200" />}
                    {orderedWidth != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-indigo-500">العرض:</span>
                        <span className="text-sm font-bold text-indigo-800 font-mono">{orderedWidth} <span className="text-xs font-normal">cm</span></span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                {([
                  { key: 'raw',      label: 'خام',  sub: 'Raw',      cls: 'border-slate-200  bg-slate-50   text-slate-700'  },
                  { key: 'zero',     label: 'زيرو', sub: 'Zero',     cls: 'border-blue-200   bg-blue-50    text-blue-700'   },
                  { key: 'finished', label: 'جاهز', sub: 'Finished', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                ] as const).map(col => (
                  <div key={col.key} className={`rounded-xl border p-4 space-y-3 ${col.cls}`}>
                    <p className="text-center font-bold text-sm">{col.label} <span className="text-xs font-normal opacity-60">({col.sub})</span></p>
                    <Field label="الوزن" sublabel="g/m²">
                      <Input type="number" placeholder="0" unit="g" className="bg-white"
                        value={(data as any)[`${col.key}Weight`]}
                        onChange={e => update(`${col.key}Weight` as any, e.target.value)} />
                    </Field>
                    <Field label="العرض" sublabel="cm">
                      <Input type="number" placeholder="0" unit="cm" className="bg-white"
                        value={(data as any)[`${col.key}Width`]}
                        onChange={e => update(`${col.key}Width` as any, e.target.value)} />
                    </Field>
                  </div>
                ))}
              </div>

              {(autoShrinkLen || autoShrinkWidth) && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                  <span className="text-xs font-semibold text-amber-700">الانكماش المحسوب تلقائياً:</span>
                  {autoShrinkLen   && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-mono">طولي: {autoShrinkLen}</span>}
                  {autoShrinkWidth && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-mono">عرضي: {autoShrinkWidth}</span>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="الانكماش الطولى" sublabel="يمكن تعديله">
                  <Input placeholder={autoShrinkLen || '5%'} value={data.shrinkageLength} onChange={e => update('shrinkageLength', e.target.value)} />
                </Field>
                <Field label="الانكماش العرضى" sublabel="يمكن تعديله">
                  <Input placeholder={autoShrinkWidth || '3%'} value={data.shrinkageWidth} onChange={e => update('shrinkageWidth', e.target.value)} />
                </Field>
              </div>
            </div>
          </Section>

          {/* 3 · Machine */}
          <Section id="machine" title="بيانات الماكينة" subtitle={order.machine ? `مجلوبة تلقائياً من بيانات ماكينة: ${order.machine}` : "المواصفات الفنية للماكينة"}
            icon={<Cpu size={16} className="text-purple-600" />} accent="bg-purple-50">
            <div className="pt-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="اسم الماكينة"><Input placeholder="ماكينة 1" value={data.machineName} onChange={e => update('machineName', e.target.value)} /></Field>
                <Field label="نوع الماكينة" sublabel="Type"><Input placeholder="Single Jersey" value={data.machineType} onChange={e => update('machineType', e.target.value)} /></Field>
                <Field label="القطر" sublabel="DIA (inch)"><Input type="number" placeholder="32" value={data.gauge} onChange={e => update('gauge', e.target.value)} /></Field>
                <Field label="الجوج" sublabel="Gauge"><Input type="number" placeholder="26" value={data.gog} onChange={e => update('gog', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field label="عدد الإبر" sublabel="Needles"><Input type="number" value={data.needleCount} onChange={e => update('needleCount', e.target.value)} /></Field>
                <Field label="عدد المواكيك" sublabel="Feeders"><Input type="number" value={data.feederCount} onChange={e => update('feederCount', e.target.value)} /></Field>
                <Field label="العيار المركزى"><Input value={data.centralGauge} onChange={e => update('centralGauge', e.target.value)} /></Field>
                <Field label="ارتفاع الدايل"><Input value={data.dialHeight} onChange={e => update('dialHeight', e.target.value)} /></Field>
                <Field label="عيار الشداد"><Input value={data.tensionerGauge} onChange={e => update('tensionerGauge', e.target.value)} /></Field>
              </div>
              <Field label="الطارة" sublabel="Tara" className="max-w-xs">
                <Input value={data.tara} onChange={e => update('tara', e.target.value)} />
              </Field>
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">قراءات الماكينة</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="عيار سلندر"><Input value={data.cylinderGauge} onChange={e => update('cylinderGauge', e.target.value)} /></Field>
                  <Field label="عيار دايل"><Input value={data.dialGauge} onChange={e => update('dialGauge', e.target.value)} /></Field>
                  <Field label="طول غرزة"><Input value={data.stitchLength} onChange={e => update('stitchLength', e.target.value)} /></Field>
                  <Field label="ويسكو"><Input value={data.visco} onChange={e => update('visco', e.target.value)} /></Field>
                </div>
              </div>
            </div>
          </Section>

          {/* 4 · Yarn — auto-filled from order */}
          <Section id="yarns" title="بيانات الغزول" subtitle="مجلوبة تلقائياً من بيانات الطلب"
            icon={<Layers size={16} className="text-rose-500" />} accent="bg-rose-50">
            <div className="pt-4 space-y-3">
              {data.yarns.map((yarn, idx) => (
                <div key={yarn.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative group">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">غزل #{idx + 1}</span>
                      {yarn.type && <span className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">{yarn.type}</span>}
                    </div>
                    {data.yarns.length > 1 && (
                      <button onClick={() => removeYarn(yarn.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <Field label="نوع الغزل">
                      <Input placeholder="كوتن 30/1" value={yarn.type} onChange={e => updateYarn(yarn.id,'type',e.target.value)} />
                    </Field>
                    <Field label="رقم اللوط" sublabel="Lot No.">
                      <Input placeholder="BEL YARN 100" value={yarn.lotNumber ?? ''} onChange={e => updateYarn(yarn.id,'lotNumber',e.target.value)} />
                    </Field>
                    <Field label="النسبة المئوية" sublabel="%">
                      <Input type="number" unit="%" value={yarn.percentage} onChange={e => updateYarn(yarn.id,'percentage',e.target.value)} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="عدد الكونات">
                      <Input type="number" value={yarn.cones} onChange={e => updateYarn(yarn.id,'cones',e.target.value)} />
                    </Field>
                    <Field label="نوع الغزل تفصيل">
                      <Input value={yarn.yarnDetail} onChange={e => updateYarn(yarn.id,'yarnDetail',e.target.value)} />
                    </Field>
                    <Field label="عدد الفتل بالمكوك">
                      <Input type="number" value={yarn.twistCount} onChange={e => updateYarn(yarn.id,'twistCount',e.target.value)} />
                    </Field>
                    <Field label="عدد المواكيك">
                      <Input type="number" value={yarn.feeders} onChange={e => updateYarn(yarn.id,'feeders',e.target.value)} />
                    </Field>
                  </div>
                </div>
              ))}
              <button onClick={addYarn}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-rose-200 text-rose-400 hover:text-rose-600 hover:border-rose-400 hover:bg-rose-50/30 transition-all flex items-center justify-center gap-2 text-sm font-medium">
                <Plus size={15} /> إضافة غزل
              </button>
            </div>
          </Section>
          </div>}

          {/* 5 · Needle Arrangement — Knitting Structure tab only */}
          <div className={!canEditKnitting ? 'pointer-events-none select-none opacity-60' : ''}>
          {activeSection === 'knitting' && <Section id="needles" title="ترتيب الإبر" subtitle="النقطة = إبرة — اختر نوع الماكينة وعدد التراكات"
            icon={<Sparkles size={16} className="text-sky-600" />} accent="bg-sky-50">
            <div className="pt-4 space-y-4">

              {/* Machine bed type toggle */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-600">نوع الماكينة:</span>
                {(['single','double'] as const).map(t => (
                  <button key={t} onClick={() => update('needleBedType', t)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${data.needleBedType === t
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-sky-300 hover:text-sky-600'}`}>
                    {t === 'single' ? 'Single (سلندر فقط)' : 'Double (دايل + سلندر)'}
                  </button>
                ))}
              </div>

              <ColControl count={data.needleColumns} onAdd={addNeedleCol} onRemove={removeNeedleCol} label="عدد الأعمدة:" />

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded border-2 border-slate-800 bg-slate-800 flex items-center justify-center">
                    <svg viewBox="0 0 10 10" width="7" height="7"><circle cx="5" cy="5" r="4" fill="white" /></svg>
                  </div>
                  <span>إبرة موجودة</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded border-2 border-slate-300 bg-white" />
                  <span>فراغ</span>
                </div>
              </div>

              {/* Col number header (reusable) */}
              {(() => {
                const ColNums = () => (
                  <div className="flex items-center gap-3">
                    <span className="w-20 shrink-0" />
                    <div className="flex gap-1">
                      {Array.from({ length: data.needleColumns }).map((_, i) => (
                        <div key={i} className="w-7 shrink-0 text-center text-[10px] font-mono text-slate-400 leading-none">{i + 1}</div>
                      ))}
                    </div>
                  </div>
                );

                // Tracks visible: d1..d{dialTracks} and c1..c{cylTracks}
                const dialKeys = (['d1','d2','d3','d4'] as const).slice(0, data.needleDialTracks);
                const cylKeys  = (['c1','c2','c3','c4'] as const).slice(0, data.needleCylTracks);

                const TrackRow = ({ track }: { track: string }) => (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-500 w-20 shrink-0 text-right">{NEEDLE_TRACK_LABELS[track]}</span>
                    <div className="flex gap-1">
                      {Array.from({ length: data.needleColumns }).map((_, i) => (
                        <NeedleCell key={i}
                          active={(data.needleTracks[track] || [])[i] === true}
                          onClick={() => toggleNeedle(track, i)} />
                      ))}
                    </div>
                  </div>
                );

                const TrackControl = ({ count, onInc, onDec }: { count: number; onInc: () => void; onDec: () => void }) => (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">تراكات:</span>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-0.5">
                      <button onClick={onDec} disabled={count <= 2} className="p-0.5 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"><Minus size={11} /></button>
                      <span className="text-xs font-bold w-4 text-center text-slate-700">{count}</span>
                      <button onClick={onInc} disabled={count >= 4} className="p-0.5 text-slate-400 hover:text-emerald-600 disabled:opacity-30 transition-colors"><Plus size={11} /></button>
                    </div>
                  </div>
                );

                return (
                  <>
                    {/* Dial — only shown for double */}
                    {data.needleBedType === 'double' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">دايل (Dial)</p>
                          <TrackControl count={data.needleDialTracks}
                            onInc={() => update('needleDialTracks', Math.min(4, data.needleDialTracks + 1))}
                            onDec={() => update('needleDialTracks', Math.max(2, data.needleDialTracks - 1))} />
                        </div>
                        <div className="overflow-x-auto pb-1">
                          <div className="space-y-1.5" style={{ minWidth: 'max-content' }}>
                            <ColNums />
                            {dialKeys.map(t => <TrackRow key={t} track={t} />)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Cylinder — always shown */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">سلندر (Cylinder)</p>
                        <TrackControl count={data.needleCylTracks}
                          onInc={() => update('needleCylTracks', Math.min(4, data.needleCylTracks + 1))}
                          onDec={() => update('needleCylTracks', Math.max(2, data.needleCylTracks - 1))} />
                      </div>
                      <div className="overflow-x-auto pb-1">
                        <div className="space-y-1.5" style={{ minWidth: 'max-content' }}>
                          <ColNums />
                          {cylKeys.map(t => <TrackRow key={t} track={t} />)}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

              <p className="text-[11px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                💡 انقر على الخلية لتفعيل أو إلغاء الإبرة
              </p>
            </div>
          </Section>}

          {/* 6 · Cam Arrangement — Knitting Structure tab only */}
          {activeSection === 'knitting' && <Section id="cams" title="ترتيب الكامات" subtitle="انقر لتغيير الغرزة — اختر نوع الماكينة وعدد التراكات"
            icon={<Cpu size={16} className="text-orange-500" />} accent="bg-orange-50">
            <div className="pt-4 space-y-4">

              {/* Machine bed type toggle */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-600">نوع الماكينة:</span>
                {(['single','double'] as const).map(t => (
                  <button key={t} onClick={() => update('camBedType', t)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${data.camBedType === t
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-orange-300 hover:text-orange-600'}`}>
                    {t === 'single' ? 'Single (سلندر فقط)' : 'Double (دايل + سلندر)'}
                  </button>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 flex-wrap">
                {(Object.entries(CAM_CONFIG) as [CamStitch, typeof CAM_CONFIG[CamStitch]][]).map(([t, cfg]) => (
                  <div key={t} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 text-xs font-medium ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                    <cfg.Icon />{cfg.label}
                  </div>
                ))}
              </div>

              <ColControl count={data.camColumns} onAdd={addCamCol} onRemove={removeCamCol} label="عدد الأعمدة:" />

              {(() => {
                const dialKeys = (['d4','d3','d2','d1'] as const).slice(0, data.camDialTracks);
                const cylKeys  = (['c1','c2','c3','c4'] as const).slice(0, data.camCylTracks);

                const CamColNums = () => (
                  <div className="flex items-center gap-3">
                    <span className="w-20 shrink-0" />
                    <div className="flex gap-1">
                      {Array.from({ length: data.camColumns }).map((_, i) => (
                        <div key={i} className="w-7 shrink-0 text-center text-[10px] font-mono text-slate-400 leading-none">{i + 1}</div>
                      ))}
                    </div>
                  </div>
                );

                const CamRow = ({ track }: { track: string }) => (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-500 w-20 shrink-0 text-right">{NEEDLE_TRACK_LABELS[track]}</span>
                    <div className="flex gap-1">
                      {Array.from({ length: data.camColumns }).map((_, i) => (
                        <CamCell key={i}
                          value={(data.camTracks[track]?.[i] as CamStitch) || 'knit'}
                          onClick={() => cycleCam(track, i)} />
                      ))}
                    </div>
                  </div>
                );

                const CamTrackControl = ({ count, onInc, onDec }: { count: number; onInc: () => void; onDec: () => void }) => (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">تراكات:</span>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-0.5">
                      <button onClick={onDec} disabled={count <= 2} className="p-0.5 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"><Minus size={11} /></button>
                      <span className="text-xs font-bold w-4 text-center text-slate-700">{count}</span>
                      <button onClick={onInc} disabled={count >= 4} className="p-0.5 text-slate-400 hover:text-emerald-600 disabled:opacity-30 transition-colors"><Plus size={11} /></button>
                    </div>
                  </div>
                );

                return (
                  <>
                    {data.camBedType === 'double' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">دايل (Dial)</p>
                          <CamTrackControl count={data.camDialTracks}
                            onInc={() => update('camDialTracks', Math.min(4, data.camDialTracks + 1))}
                            onDec={() => update('camDialTracks', Math.max(2, data.camDialTracks - 1))} />
                        </div>
                        <div className="overflow-x-auto pb-1">
                          <div className="space-y-1.5" style={{ minWidth: 'max-content' }}>
                            <CamColNums />
                            {dialKeys.map(t => <CamRow key={t} track={t} />)}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">سلندر (Cylinder)</p>
                        <CamTrackControl count={data.camCylTracks}
                          onInc={() => update('camCylTracks', Math.min(4, data.camCylTracks + 1))}
                          onDec={() => update('camCylTracks', Math.max(2, data.camCylTracks - 1))} />
                      </div>
                      <div className="overflow-x-auto pb-1">
                        <div className="space-y-1.5" style={{ minWidth: 'max-content' }}>
                          <CamColNums />
                          {cylKeys.map(t => <CamRow key={t} track={t} />)}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

            </div>
          </Section>}
          </div>

          {activeSection === 'cert' && <div className={!canEditCert ? 'pointer-events-none select-none opacity-60' : ''}>
          {/* 7 · Dyehouse */}
          <Section id="dyehouse" title="بيانات المصبغة" subtitle="خطوات العينة في المصبغة"
            icon={<Droplets size={16} className="text-indigo-500" />} accent="bg-indigo-50">
            <div className="pt-4 space-y-4">

              {/* Step toggle pills */}
              <div className="flex flex-wrap gap-2">
                {Object.keys(data.dyehouseSteps).map(step => {
                  const on = data.dyehouseSteps[step];
                  const isTathbeet = step === 'تثبيت';
                  return (
                    <button key={step}
                      onClick={() => update('dyehouseSteps', { ...data.dyehouseSteps, [step]: !on })}
                      className={`px-4 py-2 rounded-full text-sm font-medium border-2 transition-all ${on
                        ? isTathbeet
                          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                          : 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}>
                      {on && '✓ '}{step}
                    </button>
                  );
                })}
              </div>

              {/* تثبيت detail panel — shown when active */}
              {data.dyehouseSteps['تثبيت'] && (() => {
                const t = data.tathbeet;
                const setT = (patch: Partial<TathbeetData>) =>
                  update('tathbeet', { ...t, ...patch });

                return (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-teal-500" />
                      <p className="text-sm font-bold text-teal-800">تفاصيل التثبيت</p>
                    </div>

                    {/* Timing selector */}
                    <div>
                      <p className="text-xs font-semibold text-teal-700 mb-2">توقيت التثبيت:</p>
                      <div className="flex gap-2">
                        {([
                          { v: 'before', label: 'قبل الصباغة' },
                          { v: 'after',  label: 'بعد الصباغة'  },
                          { v: 'both',   label: 'قبل وبعد'     },
                        ] as { v: TathbeetData['timing']; label: string }[]).map(opt => (
                          <button key={opt.v} onClick={() => setT({ timing: opt.v })}
                            className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${t.timing === opt.v
                              ? 'bg-teal-600 text-white border-teal-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-teal-300 hover:text-teal-700'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Measurement fields — conditional on timing */}
                    <div className="space-y-3">
                      {(t.timing === 'before' || t.timing === 'both') && (
                        <TathbeetMeasFields prefix="before" label="قبل الصباغة" tathbeet={t} onChange={setT} />
                      )}
                      {(t.timing === 'after' || t.timing === 'both') && (
                        <TathbeetMeasFields prefix="after" label="بعد الصباغة" tathbeet={t} onChange={setT} />
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-600 mb-2">ملاحظات</p>
                <textarea rows={3} dir="rtl" placeholder="أي ملاحظات إضافية..."
                  value={data.dyehouseNotes} onChange={e => update('dyehouseNotes', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm text-slate-800 resize-none transition-all" />
              </div>
            </div>
          </Section>

          {/* 8 · Lab */}
          <Section id="lab" title="نتائج المعمل" subtitle="قراءات تفصيلية بعد الاختبار"
            icon={<FlaskConical size={16} className="text-teal-600" />} accent="bg-teal-50" defaultOpen={false}>
            <div className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="وزن خام"><Input type="number" value={data.rawWeight} onChange={e => update('rawWeight', e.target.value)} /></Field>
                <Field label="وزن زيرو"><Input type="number" value={data.zeroWeight} onChange={e => update('zeroWeight', e.target.value)} /></Field>
                <Field label="وزن مجهز"><Input type="number" value={data.finishedWeight} onChange={e => update('finishedWeight', e.target.value)} /></Field>
              </div>
            </div>
          </Section>

          <div className="h-8" />
          </div>}

        </div>
      </div>
    </div>
  );
}
