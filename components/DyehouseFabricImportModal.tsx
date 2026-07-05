import React, { useState, useRef, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, AlertTriangle, Check, Loader2,
  ChevronUp, ChevronDown, Trash2, Link2, ClipboardPaste, RefreshCw
} from 'lucide-react';
import { OrderRow, DyeingBatch, Dyehouse } from '../types';
import { DataService } from '../services/dataService';
import {
  parseDyehouseWorkbook, parseDyehousePaste, parseDyehouseRows, reconcileParsedColors, computeReconcileDiff,
  MAPPABLE_FIELDS, ParsedColor, ParsedAccessory, ParseResult, ReconciledRow, ReconcileDiff,
} from '../utils/dyehouseExcelParser';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRow;
  dyehouses: Dyehouse[];
  /** Persist the fully-reconciled dyeing plan (new colors added, existing ones updated). */
  onImport: (nextDyeingPlan: DyeingBatch[]) => Promise<void> | void;
}

// How the user resolved a flagged conflict row before import can proceed.
type ConflictResolution =
  | { action: 'ignore' }                    // decrease conflict: skip this row, no changes applied
  | { action: 'correct' }                   // decrease conflict: apply the negative delta as a correction
  | { action: 'linkTo'; batchId: string }    // ambiguous conflict: link to a specific existing batch
  | { action: 'treatAsNew' };               // ambiguous conflict: create as a new color instead

type Step = 'upload' | 'review' | 'importing';

const today = () => new Date().toISOString().split('T')[0];
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export const DyehouseFabricImportModal: React.FC<Props> = ({ isOpen, onClose, order, dyehouses, onImport }) => {
  const [step, setStep] = useState<Step>('upload');
  const [colors, setColors] = useState<ParsedColor[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [distinctDyehouses, setDistinctDyehouses] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // rawName -> dyehouseId
  const [remember, setRemember] = useState<Record<string, boolean>>({}); // rawName -> save alias?
  const [parseError, setParseError] = useState('');
  // Retained for manual column mapping (re-parse without re-reading the source)
  const [rows, setRows] = useState<any[][] | null>(null);
  const [colorGrid, setColorGrid] = useState<string[][] | undefined>(undefined);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [headerMap, setHeaderMap] = useState<Record<string, number>>({});
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  // Fields that had no auto-detected column, captured once at the initial parse
  // (like distinctDyehouses) so resolving one doesn't make it vanish from the
  // list — it just turns green, same as the dyehouse-alias linking above it.
  const [neededFields, setNeededFields] = useState<string[]>([]);
  // Reconciliation against this order's EXISTING colors — keyed by parsed color id.
  // Computed once per parse (not live-recomputed on manual edits), same convention
  // as neededFields above. A parsed color absent from this map (e.g. one created
  // via promote/demote after parsing) is implicitly treated as 'new'.
  const [reconcileMap, setReconcileMap] = useState<Record<string, ReconciledRow>>({});
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ConflictResolution>>({});
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false);
  const aliasesRef = useRef<{ rawName: string; dyehouseId: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      // reset on close
      setStep('upload');
      setColors([]);
      setWarnings([]);
      setDistinctDyehouses([]);
      setMapping({});
      setRemember({});
      setParseError('');
      setRows(null);
      setColorGrid(undefined);
      setOverrides({});
      setHeaderMap({});
      setHeaderRow([]);
      setNeededFields([]);
      setReconcileMap({});
      setConflictResolutions({});
      setMismatchAcknowledged(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const dyehouseById = (id: string) => dyehouses.find(d => d.id === id);
  const fieldLabel = (f: string) => MAPPABLE_FIELDS.find(x => x.field === f)?.label || f;

  // Resolve dyehouse aliases for the raw names in a parse result, using the
  // already-fetched alias list (aliasesRef) so re-parsing stays synchronous.
  const resolveDyehouseMapping = (distinct: string[]) => {
    const aliasMap: Record<string, string> = {};
    const rememberMap: Record<string, boolean> = {};
    distinct.forEach(raw => {
      const a = aliasesRef.current.find(x => x.rawName.trim() === raw.trim());
      if (a) aliasMap[raw] = a.dyehouseId;
      else { const d = dyehouses.find(d => d.name.trim() === raw.trim()); if (d) aliasMap[raw] = d.id; }
      rememberMap[raw] = true;
    });
    setMapping(aliasMap);
    setRemember(rememberMap);
  };

  // Push a parse result into the review state (colors, columns, dyehouse mapping).
  // Does NOT touch neededFields — that list is frozen at the initial parse (see applyResult)
  // so a field stays visible (just turns green) once the user links it, instead of disappearing.
  const commitResult = (result: ParseResult) => {
    setColors(result.colors);
    setWarnings(result.warnings);
    setDistinctDyehouses(result.distinctDyehouses);
    setHeaderMap(result.headerMap);
    setHeaderRow(result.headerRow);
    resolveDyehouseMapping(result.distinctDyehouses);

    // Match pasted/uploaded rows against this order's existing colors so the
    // same sheet can be re-imported later to reconcile sent/received updates
    // instead of only ever adding brand-new colors.
    const reconciled = reconcileParsedColors(result.colors, order.dyeingPlan || []);
    const map: Record<string, ReconciledRow> = {};
    reconciled.forEach(r => { map[r.parsed.id] = r; });
    setReconcileMap(map);
    setConflictResolutions({});
    setMismatchAcknowledged(false);
  };

  // Shared: take a ParseResult (from file OR paste), resolve dyehouse aliases,
  // and move to the review step. Both entry points funnel through here.
  const applyResult = async (result: ParseResult, emptyMsg: string): Promise<boolean> => {
    if (result.colors.length === 0) {
      setParseError(result.warnings[0] || emptyMsg);
      return false;
    }
    aliasesRef.current = await DataService.getDyehouseAliases().catch(() => []);
    setRows(result.rows || null);
    setColorGrid(result.colorGrid);
    setOverrides({});
    setNeededFields(MAPPABLE_FIELDS.filter(f => !(f.field in result.headerMap)).map(f => f.field));
    commitResult(result);
    setStep('review');
    return true;
  };

  // Manually map an unrecognized column to a field (or clear a mapping) → re-parse.
  const setColumnMapping = (field: string, colIndex: number) => {
    if (!rows) return;
    const next = { ...overrides };
    if (colIndex < 0) delete next[field]; else next[field] = colIndex;
    setOverrides(next);
    commitResult(parseDyehouseRows(rows, colorGrid, next));
  };

  const handleFile = async (file: File) => {
    setParseError('');
    try {
      const buf = await file.arrayBuffer();
      await applyResult(parseDyehouseWorkbook(buf), 'لم يتم العثور على أي ألوان في الملف.');
    } catch (err: any) {
      console.error('Parse error', err);
      setParseError('تعذّر قراءة الملف. تأكد أنه ملف Excel صالح (.xlsx).');
    }
  };

  // Paste-from-Excel: read the clipboard's HTML (structure + colours) and text.
  const handlePaste = async (e: React.ClipboardEvent) => {
    setParseError('');
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    try {
      await applyResult(parseDyehousePaste(html, text), 'لم يتم العثور على أي ألوان في الخلايا الملصقة.');
    } catch (err) {
      console.error('Paste parse error', err);
      setParseError('تعذّر قراءة الخلايا الملصقة. تأكد من نسخها من إكسل مع صف العناوين.');
    }
  };

  // ---- editing helpers ----
  const updateColor = (id: string, patch: Partial<ParsedColor>) =>
    setColors(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const deleteColor = (id: string) =>
    setColors(prev => prev.filter(c => c.id !== id));

  const updateAccessory = (colorId: string, accId: string, patch: Partial<ParsedAccessory>) =>
    setColors(prev => prev.map(c => c.id === colorId
      ? { ...c, accessories: c.accessories.map(a => a.id === accId ? { ...a, ...patch } : a) }
      : c));

  const deleteAccessory = (colorId: string, accId: string) =>
    setColors(prev => prev.map(c => c.id === colorId
      ? { ...c, accessories: c.accessories.filter(a => a.id !== accId) }
      : c));

  // promote an accessory to a standalone color (inserted right after its parent)
  const promoteAccessory = (colorId: string, accId: string) =>
    setColors(prev => {
      const idx = prev.findIndex(c => c.id === colorId);
      if (idx === -1) return prev;
      const parent = prev[idx];
      const acc = parent.accessories.find(a => a.id === accId);
      if (!acc) return prev;
      const newColor: ParsedColor = {
        id: crypto.randomUUID(), color: acc.name, colorHex: '', quantity: 0, colorApproval: '',
        dyehouseColorName: '', rawDyehouse: parent.rawDyehouse, dispatchNumber: parent.dispatchNumber,
        dateSent: parent.dateSent, quantitySent: acc.sent, received: acc.received, formationDate: parent.formationDate,
        notes: '', receivedFlag: false, accessories: [], rowIndex: acc.rowIndex,
      };
      const next = [...prev];
      next[idx] = { ...parent, accessories: parent.accessories.filter(a => a.id !== accId) };
      next.splice(idx + 1, 0, newColor);
      return next;
    });

  // demote a color into an accessory of the previous color
  const demoteColor = (colorId: string) =>
    setColors(prev => {
      const idx = prev.findIndex(c => c.id === colorId);
      if (idx <= 0) return prev;
      const c = prev[idx];
      const prevColor = prev[idx - 1];
      const acc: ParsedAccessory = { id: crypto.randomUUID(), name: c.color, sent: c.quantitySent, received: c.received, rowIndex: c.rowIndex };
      const next = [...prev];
      next[idx - 1] = { ...prevColor, accessories: [...prevColor.accessories, acc] };
      next.splice(idx, 1);
      return next;
    });

  // A parsed color absent from reconcileMap (e.g. one just created via promote/demote) is 'new'.
  const rowState = (c: ParsedColor): ReconciledRow => reconcileMap[c.id] || { parsed: c, state: 'new' };

  // Build a brand-new DyeingBatch from a parsed row (unchanged from the original import logic).
  const buildNewBatch = (c: ParsedColor): DyeingBatch => {
    const dye = c.rawDyehouse ? dyehouseById(mapping[c.rawDyehouse]) : undefined;
    const accessorySent = round2(c.accessories.reduce((s, a) => s + (a.sent || 0), 0));
    const accessoryReceived = round2(c.accessories.reduce((s, a) => s + (a.received || 0), 0));
    const hasSent = c.quantitySent > 0 || accessorySent > 0;
    const hasReceived = (c.received || 0) > 0 || accessoryReceived > 0;
    const sentDate = c.dateSent || today();

    return {
      id: crypto.randomUUID(),
      color: c.color,
      colorHex: c.colorHex || undefined,
      quantity: c.quantity || 0,
      machine: '',
      notes: c.notes || '',
      colorApproval: c.colorApproval || undefined,
      dyehouse: dye?.name || '',
      dispatchNumber: c.dispatchNumber || undefined,
      dateSent: c.dateSent || undefined,
      formationDate: c.formationDate || undefined,
      // Raw & accessory sent are recorded once, via sentEvents / the accessories
      // array. Leaving these legacy fields set would double-count in the live row.
      quantitySentRaw: undefined,
      quantitySentAccessory: undefined,
      sentEvents: hasSent ? [{
        id: crypto.randomUUID(), date: sentDate, quantity: c.quantitySent || 0, accessorySent: 0, notes: c.notes || '',
      }] : [],
      receiveEvents: hasReceived ? [{
        id: crypto.randomUUID(), date: sentDate, quantityRaw: c.received || 0, quantityAccessory: accessoryReceived || 0, notes: c.notes || '',
      }] : [],
      accessories: c.accessories.map(a => ({
        id: a.id, name: a.name, sent: a.sent || 0, received: a.received || 0,
        dateSent: c.dateSent || undefined, dispatchNumber: c.dispatchNumber || undefined, formationDate: c.formationDate || undefined,
      })),
      status: hasReceived ? 'received' : hasSent ? 'sent' : 'pending',
    };
  };

  // Apply a computed diff onto an EXISTING batch — only ever adds new sent/receive
  // events and fills in fields that were blank; never overwrites something already
  // recorded (so a partial re-paste, or a paste against a batch someone edited
  // in-app since, can't clobber real data).
  const applyDiffToBatch = (existing: DyeingBatch, c: ParsedColor, diff: ReconcileDiff): DyeingBatch => {
    const dye = c.rawDyehouse ? dyehouseById(mapping[c.rawDyehouse]) : undefined;
    const eventDate = c.dateSent || today();

    const sentEvents = [...(existing.sentEvents || [])];
    if (Math.abs(diff.sentDelta) >= 0.01) {
      sentEvents.push({
        id: crypto.randomUUID(), date: eventDate, quantity: diff.sentDelta, accessorySent: 0,
        notes: diff.sentDelta < 0 ? 'تصحيح من استيراد إكسل' : (c.notes || ''),
      });
    }
    const receiveEvents = [...(existing.receiveEvents || [])];
    if (Math.abs(diff.receivedDelta) >= 0.01) {
      receiveEvents.push({
        id: crypto.randomUUID(), date: eventDate, quantityRaw: diff.receivedDelta, quantityAccessory: 0,
        notes: diff.receivedDelta < 0 ? 'تصحيح من استيراد إكسل' : (c.notes || ''),
      });
    }

    const accessories = [...(existing.accessories || [])];
    diff.accessoryDiffs.forEach(a => {
      if (a.isNew) {
        if (a.sentChanged || a.receivedChanged) {
          accessories.push({
            id: crypto.randomUUID(), name: a.name, sent: a.sent, received: a.received,
            dateSent: c.dateSent || undefined, dispatchNumber: c.dispatchNumber || undefined, formationDate: c.formationDate || undefined,
          });
        }
      } else if (a.existingId && (a.sentChanged || a.receivedChanged)) {
        const idx = accessories.findIndex(x => x.id === a.existingId);
        if (idx !== -1) {
          accessories[idx] = {
            ...accessories[idx],
            sent: a.sentChanged ? a.sent : accessories[idx].sent,
            received: a.receivedChanged ? a.received : accessories[idx].received,
          };
        }
      }
    });

    const hasSent = (c.quantitySent || 0) > 0 || accessories.some(a => (a.sent || 0) > 0);
    const hasReceived = (c.received || 0) > 0 || accessories.some(a => (a.received || 0) > 0);

    return {
      ...existing,
      dispatchNumber: diff.fillsDispatch ? (c.dispatchNumber || existing.dispatchNumber) : existing.dispatchNumber,
      dateSent: diff.fillsDate ? (c.dateSent || existing.dateSent) : existing.dateSent,
      formationDate: diff.fillsFormationDate ? (c.formationDate || existing.formationDate) : existing.formationDate,
      colorApproval: diff.fillsApproval ? (c.colorApproval || existing.colorApproval) : existing.colorApproval,
      notes: diff.fillsNotes ? (c.notes || existing.notes) : existing.notes,
      dyehouse: existing.dyehouse || dye?.name || existing.dyehouse,
      sentEvents, receiveEvents, accessories,
      status: hasReceived ? 'received' : hasSent ? 'sent' : (existing.status || 'pending'),
    };
  };

  // ---- derived reconciliation stats ----
  const reconciledRows = colors.map(rowState);
  const newCount = reconciledRows.filter(r => r.state === 'new').length;
  const updateCount = reconciledRows.filter(r => r.state === 'update').length;
  const unchangedCount = reconciledRows.filter(r => r.state === 'unchanged').length;
  const conflictRows = reconciledRows.filter(r => r.state === 'conflict');
  const unresolvedConflicts = conflictRows.filter(r => !conflictResolutions[r.parsed.id]);
  const orderHasExistingColors = (order.dyeingPlan || []).length > 0;
  // Nothing pasted matched anything already on this order — likely the wrong sheet.
  const showMismatchWarning = orderHasExistingColors && newCount > 0 && (updateCount + unchangedCount) === 0 && conflictRows.length === 0;

  // ---- validation ----
  const unmappedDyehouses = distinctDyehouses.filter(raw => !mapping[raw]);
  const unresolvedFields = neededFields.filter(f => !(f in headerMap));
  // Missing dates/notes/etc. don't block import (unlike the dyehouse, which is
  // required to route the batch) — they're just informational until linked.
  const canImport = unmappedDyehouses.length === 0 && colors.length > 0
    && unresolvedConflicts.length === 0 && (!showMismatchWarning || mismatchAcknowledged);

  const handleImport = async () => {
    setStep('importing');
    try {
      // save aliases the user chose to remember
      await Promise.all(distinctDyehouses.map(async raw => {
        const id = mapping[raw];
        if (id && remember[raw]) {
          const d = dyehouseById(id);
          if (d) await DataService.saveDyehouseAlias(raw, d.id, d.name).catch(() => {});
        }
      }));

      const nextPlan = (order.dyeingPlan || []).map(b => ({ ...b }));
      const newBatches: DyeingBatch[] = [];

      for (const c of colors) {
        const rec = rowState(c);
        const resolution = conflictResolutions[c.id];

        if (rec.state === 'unchanged') continue; // safe no-op — batch stays exactly as recorded

        if (rec.state === 'new') {
          newBatches.push(buildNewBatch(c));
          continue;
        }

        if (rec.state === 'conflict') {
          if (rec.conflictReason === 'decrease') {
            if (!resolution || resolution.action === 'ignore') continue; // skip — don't touch recorded history
            // action === 'correct': apply as-is; diff already carries the negative delta
            const idx = nextPlan.findIndex(b => b.id === rec.matchedBatchId);
            if (idx === -1) { newBatches.push(buildNewBatch(c)); continue; }
            nextPlan[idx] = applyDiffToBatch(nextPlan[idx], c, rec.diff!);
            continue;
          }
          // ambiguous
          if (!resolution) continue; // guarded by canImport, but stay safe
          if (resolution.action === 'treatAsNew') {
            newBatches.push(buildNewBatch(c));
          } else if (resolution.action === 'linkTo') {
            const idx = nextPlan.findIndex(b => b.id === resolution.batchId);
            if (idx === -1) { newBatches.push(buildNewBatch(c)); continue; }
            const diff = computeReconcileDiff(c, nextPlan[idx]);
            nextPlan[idx] = applyDiffToBatch(nextPlan[idx], c, diff);
          }
          continue;
        }

        // rec.state === 'update'
        const idx = nextPlan.findIndex(b => b.id === rec.matchedBatchId);
        if (idx === -1) { newBatches.push(buildNewBatch(c)); continue; }
        nextPlan[idx] = applyDiffToBatch(nextPlan[idx], c, rec.diff!);
      }

      await onImport([...nextPlan, ...newBatches]);
      onClose();
    } catch (err) {
      console.error('Import failed', err);
      setParseError('فشل الاستيراد. حاول مرة أخرى.');
      setStep('review');
    }
  };

  const totalAccessories = colors.reduce((s, c) => s + c.accessories.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg"><FileSpreadsheet size={22} /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">استيراد بيانات المصبغة من إكسل</h2>
              <p className="text-xs text-slate-500">{order.material || 'طلبية'} — رفع ملف أو لصق الخلايا مباشرة</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {step === 'upload' && (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-full max-w-lg space-y-4">
                {/* Option 1 — upload a file */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors"
                >
                  <Upload className="w-9 h-9 mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-slate-700">اسحب ملف Excel هنا أو اضغط للاختيار</p>
                  <p className="text-xs text-slate-500 mt-1">صيغة .xlsx — صف الألوان يتبعه صف الاكسسوار (مثل "15% ريبس شتوي")</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

                {/* Divider */}
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px bg-slate-200 flex-1" /> أو <div className="h-px bg-slate-200 flex-1" />
                </div>

                {/* Option 2 — paste cells */}
                <div className="border-2 border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50/30">
                  <div className="flex items-center gap-2 mb-2 text-indigo-700">
                    <ClipboardPaste size={18} />
                    <p className="font-semibold text-sm">الصق الخلايا مباشرة من إكسل</p>
                  </div>
                  <textarea
                    onPaste={handlePaste}
                    value=""
                    onChange={() => {}}
                    placeholder="انقر هنا ثم الصق (Ctrl + V) الخلايا المنسوخة — انسخ صف العناوين مع البيانات، وتُلتقط ألوان الخلايا تلقائياً."
                    className="w-full h-20 rounded-lg border border-indigo-200 bg-white p-3 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none placeholder:text-slate-400"
                    dir="rtl"
                  />
                </div>

                {parseError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    <AlertTriangle size={16} /> {parseError}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              {/* Mismatch warning — nothing pasted matched any of this order's existing colors */}
              {showMismatchWarning && (
                <div className="border-2 border-red-300 bg-red-50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
                    <AlertTriangle size={18} />
                    لم يتم التعرف على أي من الألوان الملصقة كألوان موجودة في هذه الطلبية
                  </div>
                  <p className="text-xs text-red-600">
                    هذه الطلبية تحتوي بالفعل على {(order.dyeingPlan || []).length} لون مسجّل، لكن لا شيء في الجدول الذي أدخلته يطابقها.
                    تأكد أنك نسخت الجدول الصحيح لهذه الطلبية قبل المتابعة — وإلا فسيتم إضافة كل هذه الألوان كألوان جديدة منفصلة.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-red-700 font-medium cursor-pointer">
                    <input type="checkbox" checked={mismatchAcknowledged} onChange={e => setMismatchAcknowledged(e.target.checked)} />
                    نعم، هذا هو الجدول الصحيح لهذه الطلبية — متابعة رغم ذلك
                  </label>
                </div>
              )}

              {/* Summary */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{colors.length} لون</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{totalAccessories} اكسسوار</span>
                {newCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">{newCount} جديد</span>
                )}
                {updateCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-1">
                    <RefreshCw size={11} /> {updateCount} تحديث
                  </span>
                )}
                {unchangedCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 font-medium">{unchangedCount} بدون تغيير</span>
                )}
                {conflictRows.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-1">
                    <AlertTriangle size={12} /> {conflictRows.length} تعارض يحتاج مراجعة
                  </span>
                )}
                {unmappedDyehouses.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                    <AlertTriangle size={12} /> {unmappedDyehouses.length} مصبغة بحاجة لربط
                  </span>
                )}
                {unresolvedFields.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium flex items-center gap-1">
                    <Link2 size={12} /> {unresolvedFields.length} عمود بحاجة لربط
                  </span>
                )}
              </div>

              {/* Matching & linking — dyehouse names and any field the parser couldn't
                  auto-place, side by side so both are handled together up front. */}
              {(distinctDyehouses.length > 0 || neededFields.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* Dyehouse alias mapping */}
                  {distinctDyehouses.length > 0 && (
                    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                      <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700">
                        <Link2 size={15} /> ربط أسماء المصابغ
                      </div>
                      <div className="space-y-2">
                        {distinctDyehouses.map(raw => (
                          <div key={raw} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className={`px-2 py-1 rounded font-medium ${mapping[raw] ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {raw}
                            </span>
                            <span className="text-slate-400">←</span>
                            <select
                              value={mapping[raw] || ''}
                              onChange={(e) => setMapping(m => ({ ...m, [raw]: e.target.value }))}
                              className="border border-slate-300 rounded px-2 py-1 text-sm bg-white min-w-[160px]"
                            >
                              <option value="">— اختر المصبغة —</option>
                              {dyehouses.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                              <input type="checkbox" checked={remember[raw] ?? true}
                                onChange={(e) => setRemember(r => ({ ...r, [raw]: e.target.checked }))} />
                              تذكّر هذا الربط
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Column linking — fields the parser found no matching header for.
                      Point each one at the correct pasted/uploaded column so its data isn't lost. */}
                  {neededFields.length > 0 && (
                    <div className="border border-indigo-200 rounded-lg p-3 bg-indigo-50/40">
                      <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-indigo-700">
                        <Link2 size={15} /> ربط الأعمدة غير المتطابقة
                      </div>
                      <p className="text-xs text-slate-500 mb-2">لم يتم العثور على هذه البيانات تلقائياً — حدّد العمود الصحيح من الخلايا التي أدخلتها:</p>
                      <div className="space-y-2">
                        {neededFields.map(field => {
                          const resolvedIdx = headerMap[field];
                          const isResolved = resolvedIdx !== undefined;
                          return (
                            <div key={field} className="flex flex-wrap items-center gap-2 text-sm">
                              <span className={`px-2 py-1 rounded font-medium ${isResolved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {fieldLabel(field)}
                              </span>
                              <span className="text-slate-400">←</span>
                              <select
                                value={resolvedIdx ?? ''}
                                onChange={(e) => setColumnMapping(field, e.target.value === '' ? -1 : Number(e.target.value))}
                                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white min-w-[180px]"
                              >
                                <option value="">— اختر العمود —</option>
                                {headerRow.map((text, idx) => text.trim() ? <option key={idx} value={idx}>{text}</option> : null)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800 space-y-1">
                  {warnings.map((w, i) => <div key={i} className="flex items-center gap-1"><AlertTriangle size={12} /> {w}</div>)}
                </div>
              )}

              {/* Colors table — styled to mirror the live dyeing-plan row */}
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">اللون</th>
                      <th className="px-3 py-2 text-right font-medium w-24">موافقة اللون</th>
                      <th className="px-3 py-2 text-right font-medium w-24">رقم الازن</th>
                      <th className="px-3 py-2 text-center font-medium w-32">تاريخ التشكيل</th>
                      <th className="px-3 py-2 text-center font-medium w-32">تاريخ الارسال</th>
                      <th className="px-3 py-2 text-right font-medium w-28">المصبغة</th>
                      <th className="px-3 py-2 text-center font-medium w-16">مطلوب</th>
                      <th className="px-3 py-2 text-center font-medium w-16">اكسسوار</th>
                      <th className="px-3 py-2 text-center font-medium w-24">مرسل</th>
                      <th className="px-3 py-2 text-center font-medium w-16">مستلم</th>
                      <th className="px-3 py-2 text-center font-medium w-24">متبقي</th>
                      <th className="px-3 py-2 text-center font-medium w-24">الحالة</th>
                      <th className="px-3 py-2 text-right font-medium">ملاحظات</th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {colors.map((c, ci) => {
                      const accSent = round2(c.accessories.reduce((s, a) => s + (a.sent || 0), 0));
                      const accReceived = round2(c.accessories.reduce((s, a) => s + (a.received || 0), 0));
                      const hasSent = c.quantitySent > 0 || accSent > 0;
                      const hasReceived = (c.received || 0) > 0 || accReceived > 0;
                      const remRaw = Math.max(0, round2((c.quantitySent || 0) - (c.received || 0)));
                      const remAcc = Math.max(0, round2(accSent - accReceived));
                      const dyeId = c.rawDyehouse ? mapping[c.rawDyehouse] : '';
                      const rec = rowState(c);
                      const rowTint = rec.state === 'conflict' ? 'bg-red-50/60 hover:bg-red-50'
                        : rec.state === 'update' ? 'bg-blue-50/40 hover:bg-blue-50/60'
                        : rec.state === 'unchanged' ? 'bg-slate-50/40 opacity-70 hover:opacity-100'
                        : 'hover:bg-slate-50/60';
                      return (
                      <React.Fragment key={c.id}>
                        <tr className={rowTint}>
                          {/* color + swatch */}
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              {rec.state !== 'new' && (
                                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                  rec.state === 'update' ? 'bg-blue-100 text-blue-700'
                                    : rec.state === 'unchanged' ? 'bg-slate-200 text-slate-500'
                                    : 'bg-red-100 text-red-700'
                                }`} title={
                                  rec.state === 'update' ? 'تحديث للون موجود'
                                    : rec.state === 'unchanged' ? 'لا تغيير — يطابق السجل الحالي'
                                    : 'تعارض يحتاج مراجعة'
                                }>
                                  {rec.state === 'update' ? 'تحديث' : rec.state === 'unchanged' ? '=' : '⚠'}
                                </span>
                              )}
                              <div className="relative overflow-hidden w-5 h-5 rounded-full border border-slate-200 shadow-sm shrink-0 hover:scale-110 transition-transform">
                                <input type="color" value={c.colorHex || '#ffffff'}
                                  onChange={e => updateColor(c.id, { colorHex: e.target.value })}
                                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 m-0 border-none cursor-pointer"
                                  title="اختر اللون" />
                              </div>
                              <input value={c.color} onChange={e => updateColor(c.id, { color: e.target.value })}
                                className="w-full px-1 py-1 bg-transparent outline-none text-right font-medium focus:bg-blue-50 rounded" placeholder="اللون..." />
                            </div>
                          </td>
                          {/* approval */}
                          <td className="px-2 py-1">
                            <input value={c.colorApproval} onChange={e => updateColor(c.id, { colorApproval: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-xs text-indigo-800 focus:bg-blue-50 rounded" placeholder="..." />
                          </td>
                          {/* dispatch */}
                          <td className="px-2 py-1">
                            <input value={c.dispatchNumber} onChange={e => updateColor(c.id, { dispatchNumber: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-right focus:bg-blue-50 rounded" placeholder="رقم..." />
                          </td>
                          {/* formation date */}
                          <td className="px-1 py-1">
                            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(c.formationDate) ? c.formationDate : ''}
                              onChange={e => updateColor(c.id, { formationDate: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-[10px] font-mono text-slate-700 focus:bg-blue-50 rounded" />
                          </td>
                          {/* sent date */}
                          <td className="px-1 py-1">
                            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(c.dateSent) ? c.dateSent : ''}
                              onChange={e => updateColor(c.id, { dateSent: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-center text-[10px] font-mono text-slate-700 focus:bg-blue-50 rounded" />
                          </td>
                          {/* dyehouse */}
                          <td className="px-2 py-1 text-xs text-right">
                            {c.rawDyehouse
                              ? <span className={dyeId ? 'text-slate-700 font-medium' : 'text-amber-600'}>
                                  {dyeId ? dyehouseById(dyeId)?.name : c.rawDyehouse}
                                </span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          {/* required */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.quantity || ''} onChange={e => updateColor(c.id, { quantity: Number(e.target.value) })}
                              className="w-14 px-1 py-1 bg-transparent outline-none text-center focus:bg-blue-50 rounded" />
                          </td>
                          {/* accessory marker */}
                          <td className="px-2 py-1 text-center">
                            {c.accessories.length > 0
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-bold">{c.accessories.length}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          {/* sent */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.quantitySent || ''} onChange={e => updateColor(c.id, { quantitySent: Number(e.target.value) })}
                              className="w-16 px-1 py-1 bg-transparent outline-none text-center font-semibold text-blue-700 focus:bg-blue-50 rounded" />
                            {accSent > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {accSent}+</div>}
                          </td>
                          {/* received */}
                          <td className="px-2 py-1 text-center">
                            <input type="number" value={c.received || ''} onChange={e => updateColor(c.id, { received: Number(e.target.value) })}
                              className="w-16 px-1 py-1 bg-transparent outline-none text-center font-semibold text-emerald-700 focus:bg-blue-50 rounded" placeholder="—" />
                            {accReceived > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {accReceived}+</div>}
                          </td>
                          {/* remaining */}
                          <td className="px-2 py-1 text-center">
                            {hasSent ? (
                              <>
                                <span className="font-semibold text-orange-600">{remRaw}</span>
                                {accSent > 0 && <div className="text-[9px] text-amber-600 font-bold leading-none">ACC {remAcc}+</div>}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {/* status */}
                          <td className="px-2 py-1 text-center">
                            {hasReceived
                              ? <span className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-700">مستلم</span>
                              : hasSent
                                ? <span className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">تم الارسال</span>
                                : <span className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-100 text-indigo-600">بانتظار</span>}
                          </td>
                          {/* notes */}
                          <td className="px-2 py-1">
                            <input value={c.notes} onChange={e => updateColor(c.id, { notes: e.target.value })}
                              className="w-full px-1 py-1 bg-transparent outline-none text-right text-xs focus:bg-blue-50 rounded" placeholder="ملاحظات..." />
                          </td>
                          {/* actions */}
                          <td className="px-1 py-1 whitespace-nowrap">
                            {ci > 0 && (
                              <button title="اجعله اكسسوار للون السابق" onClick={() => demoteColor(c.id)}
                                className="p-1 text-slate-300 hover:text-indigo-600"><ChevronDown size={13} /></button>
                            )}
                            <button title="حذف اللون" onClick={() => deleteColor(c.id)}
                              className="p-1 text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                        {rec.state === 'unchanged' && (
                          <tr className="bg-slate-50/30 text-[11px] text-slate-400">
                            <td colSpan={14} className="px-3 py-1">
                              <span className="inline-flex items-center gap-1"><Check size={11} className="text-slate-300" /> لا تغيير — يطابق السجل الحالي</span>
                            </td>
                          </tr>
                        )}
                        {rec.state === 'update' && rec.diff && (() => {
                          const d = rec.diff;
                          const parts: string[] = [];
                          if (Math.abs(d.sentDelta) >= 0.01) parts.push(`مرسل ${d.sentDelta > 0 ? '+' : ''}${d.sentDelta}`);
                          if (Math.abs(d.receivedDelta) >= 0.01) parts.push(`مستلم ${d.receivedDelta > 0 ? '+' : ''}${d.receivedDelta}`);
                          if (d.fillsDispatch) parts.push('إضافة رقم الاذن');
                          if (d.fillsDate) parts.push('إضافة تاريخ الارسال');
                          if (d.fillsFormationDate) parts.push('إضافة تاريخ التشكيل');
                          if (d.fillsApproval) parts.push('إضافة موافقة اللون');
                          return (
                            <tr className="bg-blue-50/40 text-[11px] text-blue-700">
                              <td colSpan={14} className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold px-1.5 py-0.5 rounded bg-blue-100 shrink-0">تحديث للون موجود</span>
                                  {parts.map((p, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-white border border-blue-200">{p}</span>)}
                                  {d.accessoryDiffs.filter(a => a.isNew || a.sentChanged || a.receivedChanged).map((a, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                                      {a.isNew ? `اكسسوار جديد: ${a.name}` : `${a.name}: ${a.sentChanged ? `مرسل←${a.sent}` : ''} ${a.receivedChanged ? `مستلم←${a.received}` : ''}`}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                        {rec.state === 'conflict' && rec.conflictReason === 'decrease' && rec.diff && (() => {
                          const d = rec.diff;
                          const resolution = conflictResolutions[c.id];
                          return (
                            <tr className="bg-red-50 text-[11px] text-red-700">
                              <td colSpan={14} className="px-3 py-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <AlertTriangle size={13} className="shrink-0" />
                                  <span className="font-bold">تعارض: القيمة الملصقة أقل من المسجل حالياً</span>
                                  {d.sentDelta < -0.01 && <span className="px-1.5 py-0.5 rounded bg-white border border-red-200">مرسل {d.sentDelta}</span>}
                                  {d.receivedDelta < -0.01 && <span className="px-1.5 py-0.5 rounded bg-white border border-red-200">مستلم {d.receivedDelta}</span>}
                                  <select
                                    value={resolution?.action || ''}
                                    onChange={e => setConflictResolutions(m => ({
                                      ...m,
                                      [c.id]: e.target.value === 'correct' ? { action: 'correct' } : e.target.value === 'ignore' ? { action: 'ignore' } : undefined as any,
                                    }))}
                                    className="border border-red-300 rounded px-2 py-1 bg-white text-red-700 min-w-[220px]"
                                  >
                                    <option value="">— اختر كيفية المعالجة —</option>
                                    <option value="ignore">تجاهل هذا الصف (لا تغيير)</option>
                                    <option value="correct">تطبيق كتصحيح (تقليل السجل)</option>
                                  </select>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                        {rec.state === 'conflict' && rec.conflictReason === 'ambiguous' && rec.candidates && (() => {
                          const resolution = conflictResolutions[c.id];
                          const linkedId = resolution?.action === 'linkTo' ? resolution.batchId : '';
                          const value = resolution?.action === 'treatAsNew' ? '__new__' : linkedId;
                          return (
                            <tr className="bg-amber-50 text-[11px] text-amber-700">
                              <td colSpan={14} className="px-3 py-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <AlertTriangle size={13} className="shrink-0" />
                                  <span className="font-bold">تعارض: عدة ألوان مطابقة — حدد المقصود</span>
                                  <select
                                    value={value}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setConflictResolutions(m => ({
                                        ...m,
                                        [c.id]: v === '__new__' ? { action: 'treatAsNew' } : v ? { action: 'linkTo', batchId: v } : undefined as any,
                                      }));
                                    }}
                                    className="border border-amber-300 rounded px-2 py-1 bg-white text-amber-700 min-w-[260px]"
                                  >
                                    <option value="">— اختر —</option>
                                    {rec.candidates.map(cand => (
                                      <option key={cand.id} value={cand.id}>
                                        {cand.color} — {cand.dispatchNumber ? `ازن #${cand.dispatchNumber}` : 'بدون ارسال بعد'} — {cand.quantity} كجم
                                      </option>
                                    ))}
                                    <option value="__new__">معاملته كلون جديد منفصل</option>
                                  </select>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                        {c.accessories.map(a => (
                          <tr key={a.id} className="bg-slate-50/50 text-xs">
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1 pr-7">
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 font-medium shrink-0">اكسسوار</span>
                                <input value={a.name} onChange={e => updateAccessory(c.id, a.id, { name: e.target.value })}
                                  className="w-full px-1 py-0.5 bg-transparent outline-none text-right focus:bg-blue-50 rounded" />
                              </div>
                            </td>
                            <td colSpan={7}></td>
                            <td className="px-2 py-1 text-center">
                              <input type="number" value={a.sent || ''} onChange={e => updateAccessory(c.id, a.id, { sent: Number(e.target.value) })}
                                className="w-16 px-1 py-0.5 bg-transparent outline-none text-center text-amber-700 font-semibold focus:bg-blue-50 rounded" />
                            </td>
                            <td className="px-2 py-1 text-center">
                              <input type="number" value={a.received || ''} onChange={e => updateAccessory(c.id, a.id, { received: Number(e.target.value) })}
                                className="w-16 px-1 py-0.5 bg-transparent outline-none text-center text-emerald-700 font-semibold focus:bg-blue-50 rounded" placeholder="—" />
                            </td>
                            <td colSpan={3}></td>
                            <td className="px-1 py-1 whitespace-nowrap">
                              <button title="اجعله لون مستقل" onClick={() => promoteAccessory(c.id, a.id)}
                                className="p-1 text-slate-300 hover:text-indigo-600"><ChevronUp size={13} /></button>
                              <button title="حذف الاكسسوار" onClick={() => deleteAccessory(c.id, a.id)}
                                className="p-1 text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parseError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <AlertTriangle size={16} /> {parseError}
                </div>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p>جارٍ الاستيراد...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="flex items-center justify-between p-4 border-t border-slate-100">
            <button onClick={() => setStep('upload')} className="text-sm text-slate-500 hover:text-slate-700">رجوع</button>
            <button onClick={handleImport} disabled={!canImport}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                canImport ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}>
              <Check size={16} />
              {updateCount > 0
                ? `تطبيق ${newCount > 0 ? `${newCount} جديد + ` : ''}${updateCount} تحديث${unchangedCount > 0 ? ` (${unchangedCount} بدون تغيير)` : ''}`
                : `استيراد ${colors.length} لون`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
